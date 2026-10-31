// تدقيق ثابت: كل حمولات INSERT في الواجهة مقابل أعمدة NOT NULL بلا قيمة افتراضية.
//   node .wrangler/tmp/pgcli/audit-inserts.mjs
import pg from 'pg';
import { readFileSync } from 'fs';

const PWD = process.env.SUPABASE_DB_PASSWORD;
if (!PWD) { console.error('SUPABASE_DB_PASSWORD غير موجود في البيئة'); process.exit(2); }
const HOST = process.env.SUPABASE_DB_HOST || 'db.iksjhjxwphmvthryfeae.supabase.co';
const PORT = Number(process.env.SUPABASE_DB_PORT || 6543);

const c = new pg.Client({ host: HOST, port: PORT, user: 'postgres', password: PWD, database: 'postgres',
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
await c.connect();

const FILES = ['public/app.js', 'public/module-pages.js'];

// ---------- استخراج مواقع الإدراج ----------
function extractObject(text, startIdx) {
  // startIdx: موضع '{' — يُرجَع { keys:Set, spread:bool, end:number }
  // يلتقط المفاتيح الصريحة (a:) والمختصرة (a,) — ويميّز بينهما وبين المُعرّفات داخل القيم.
  let i = startIdx, depth = 0, spread = false;
  let paren = 0, bracket = 0, expectKey = false;
  const keys = new Set();
  const isIdStart = (c) => c && /[A-Za-z_$]/.test(c);
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {           // تخطّي السلاسل
      const q = ch; i++;
      while (i < text.length) { if (text[i] === '\\') { i += 2; continue; } if (text[i] === q) break; i++; }
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e === -1 ? text.length : e + 1; continue; }
    if (ch === '(') { paren++; continue; }
    if (ch === ')') { paren = Math.max(0, paren - 1); continue; }
    if (depth === 1 && ch === '[') {
      if (expectKey) { const e = text.indexOf(']', i); if (e !== -1) i = e; keys.add('«مفتاح محسوب»'); expectKey = false; continue; }
      bracket++; continue;
    }
    if (depth === 1 && ch === ']') { bracket = Math.max(0, bracket - 1); expectKey = bracket === 0 && paren === 0; continue; }
    if (ch === '{') { depth++; expectKey = depth === 1; continue; }
    if (ch === '}') {
      depth--; expectKey = false;
      if (depth === 0) return { keys, spread, end: i };
      continue;
    }
    if (depth !== 1 || paren || bracket) continue;
    if (ch === ',') { expectKey = true; continue; }
    if (text.startsWith('...', i)) { spread = true; i += 2; expectKey = false; continue; }
    if (isIdStart(ch)) {
      const ident = /^[A-Za-z_$][\w$]*/.exec(text.slice(i))[0];
      const isProp = expectKey || /^\s*:/.test(text.slice(i + ident.length));
      if (isProp) keys.add(ident);
      i += ident.length - 1;
      expectKey = false;
      continue;
    }
  }
  return { keys, spread, end: text.length };
}

function findInserts(file) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const sites = [];

  // نمط 1: mpInsert(client, "table", {
  for (let li = 0; li < lines.length; li++) {
    const m = /mpInsert\(\s*[^,]+,\s*["']([A-Za-z_][\w]*)["']\s*,\s*\{/.exec(lines.slice(li, li + 3).join('\n'));
    if (m) {
      const idx = text.indexOf(m[0], lines.slice(0, li).join('\n').length);
      const braceAt = text.indexOf('{', idx + m[0].length - 1);
      const o = extractObject(text, braceAt);
      sites.push({ file, line: li + 1, table: m[1], keys: o.keys, spread: o.spread });
    }
  }

  // نمط 2: .from("table") .... .insert({
  const fromRe = /\.from\(\s*["']([A-Za-z_][\w]*)["']\s*\)/g;
  let mm;
  while ((mm = fromRe.exec(text)) !== null) {
    const tail = text.slice(mm.index + mm[0].length, mm.index + mm[0].length + 400);
    const line = text.slice(0, mm.index).split('\n').length;
    // .insert({ ... }) أو .insert([{ ... }]) — كلاهما حمولة حرفية
    const lit = /^(\s|\/\/[^\n]*\n)*\.insert\(\s*\[?\s*\{/.exec(tail);
    if (lit) {
      const braceAt = mm.index + mm[0].length + lit[0].length - 1;
      const o = extractObject(text, braceAt);
      sites.push({ file, line, table: mm[1], keys: o.keys, spread: o.spread });
      continue;
    }
    // .insert([payload]) — حمولة مُعرّفة كمتغيّر: تُعلَّم لفحص يدوي
    const dyn = /^(\s|\/\/[^\n]*\n)*\.insert\(\s*\[?\s*([A-Za-z_$][\w$]*)/.exec(tail);
    if (dyn) sites.push({ file, line, table: mm[1], keys: null, spread: false, dynamic: dyn[2] });
  }
  return sites;
}

const sites = FILES.flatMap(findInserts);
const tables = [...new Set(sites.map(s => s.table))].sort();

// ---------- أعمدة إلزامية من القاعدة ----------
const req = await c.query(`
  SELECT table_name, column_name
    FROM information_schema.columns
   WHERE table_schema='public'
     AND is_nullable='NO' AND column_default IS NULL
     AND is_identity='NO' AND is_generated='NEVER'
     AND table_name = ANY($1)
   ORDER BY table_name, ordinal_position`, [tables]);

const required = {};
for (const r of req.rows) (required[r.table_name] ??= []).push(r.column_name);

// جداول بلا عمود مفتاح أساسي فعلي (لتفادي False positives) + المشغّلات قبل الإدراج
// (تشخيص)
console.error(`[debug] tables=${tables.length}: ${tables.join(', ')}`);
console.error(`[debug] required rows=${req.rows.length}`);

const triggers = await c.query(`
  SELECT t.event_object_table AS tbl, t.trigger_name, t.action_statement
    FROM information_schema.triggers t
   WHERE t.trigger_schema='public' AND t.event_manipulation='INSERT'
     AND t.event_object_table = ANY($1)`, [tables]);
const trigByTable = {};
for (const r of triggers.rows) (trigByTable[r.tbl] ??= []).push(r.trigger_name);

console.log(`إجمالي مواقع الإدراج: ${sites.length} على ${tables.length} جدولاً\n`);

// أعمدة تُملأ عملياً بواسطة مشغّل BEFORE INSERT — مُتحقَّق منها بقراءة جسم المشغّل، فلا تُعدّ نقصاً.
const filledByTrigger = {
  user_warehouses: ['tenant_id'],   // tg_user_warehouses_fill(): تجلب tenant_id من المخزن إن كانت NULL
};

let problems = 0;
const seen = new Set();
for (const s of sites) {
  const reqCols = required[s.table] || [];
  const tag = `${s.file}:${s.line} → ${s.table}`;
  if (!s.keys) {
    console.log(`✋ ${tag}: حمولة مُعرّفة كمتغيّر (${s.dynamic}) — الأعمدة الإلزامية للمراجعة اليدوية: ${reqCols.join(', ') || '—'}`);
    continue;
  }
  const missingAll = reqCols.filter(col => !s.keys.has(col));
  const filled = (filledByTrigger[s.table] || []).filter(col => missingAll.includes(col));
  const missing = missingAll.filter(col => !filled.includes(col));
  const fillNote = filled.length ? `   (تُملأها المشغّل: ${filled.join(', ')} — مُتحقَّق)` : '';
  if (!reqCols.length) {
    console.log(`— ${tag}: لا أعمدة إلزامية ✔`);
    continue;
  }
  if (!missing.length) {
    const why = filled.length ? ` (بما فيها ${filled.join(', ')} تُملأها المشغّل — مُتحقَّق)` : '';
    if (!s.spread && ![...s.keys].some(k => k.startsWith('«'))) console.log(`✔ ${tag}: ${reqCols.length} إلزامية كلها مغطاة${why}`);
    else console.log(`? ${tag}: تبدو مكتملة لكن فيها spread/مفتاح محسوب — تحقّق يدوياً`);
    continue;
  }
  problems++;
  const uniqKey = `${s.table}:${missing.join(',')}`;
  console.log(`✖ ${tag}`);
  console.log(`    ناقص: ${missing.join(', ')}${fillNote}   (مفاتيح الحمولة: ${[...s.keys].slice(0, 14).join(', ')}${s.spread ? ' + ...spread' : ''})`);
  if (trigByTable[s.table]) console.log(`    مشغّلات قبل الإدراج على الجدول: ${[...new Set(trigByTable[s.table])].join(', ')}`);
  seen.add(uniqKey);
}
console.log(`\nالمشكلات الفريدة: ${seen.size} — مواقع فيها نقص: ${problems}`);
await c.end();
