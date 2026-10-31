// توليد SQL لمحاذاة الجداول الستة الموجودة (شكل قديم) مع تعريفات الملفات الثلاثة.
// يضيف الأعمدة الناقصة فقط — لا يحذف ولا يُعيد تسمية شيئاً (يحافظ على مشغّلات RBAC ودوال الدخول).
import { readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';

const FILES = ['202610280100_automation_engine', '202610290100_pricing_promotions_system', '202610290200_hrm_system'];
const TARGETS = ['automation_rules', 'price_lists', 'price_list_items', 'promotions', 'employees', 'payroll_runs'];

// --- 1) استخراج كتل CREATE TABLE ---
const blocks = {};
for (const f of FILES) {
  const sql = readFileSync(`supabase/migrations/${f}.sql`, 'utf8');
  const re = /create table if not exists public\.([a-z_]+)\s*\(([\s\S]*?)\n\);/gi;
  let m;
  while ((m = re.exec(sql))) blocks[m[1]] = m[2];
}

// --- 2) فصل التعريفات على فواصل مستوى علوي فقط ---
function splitTop(body) {
  const out = []; let buf = '', depth = 0, inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) { buf += ch; if (ch === "'") { if (body[i + 1] === "'") { buf += body[++i]; } else inStr = false; } continue; }
    if (ch === "'") { inStr = true; buf += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out.map(s => s.trim()).filter(Boolean);
}

// --- 3) أعمدة القاعدة الحالية ---
let out = '';
try {
  out = execFileSync('node', ['.wrangler/tmp/pgcli/run.mjs', '--probe',
    `select table_name, column_name from information_schema.columns where table_schema='public' and table_name in (${TARGETS.map(t => `'${t}'`).join(',')})`],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
} catch (e) { console.error('probe failed: ' + (e.stderr || e.message)); process.exit(1); }
const have = {};
for (const l of out.split('\n').slice(1)) {
  if (!l.includes('|')) continue;
  const [t, c] = l.split('|').map(s => s.trim());
  (have[t] = have[t] || []).push(c);
}

// --- 4) توليد ALTER ---
const stmts = [], fks = [], skipped = [];
for (const t of TARGETS) {
  if (!blocks[t]) { console.error('لا كتلة CREATE لـ ' + t); continue; }
  const parts = splitTop(blocks[t]);
  for (const part of parts) {
    if (/^(primary key|foreign key|unique|check|constraint)\b/i.test(part)) {
      if (/^foreign key/i.test(part)) fks.push(`ALTER TABLE public.${t} ADD CONSTRAINT ${part};`);
      continue;
    }
    const m = /^"?([a-z_][a-z0-9_]*)"?\s+([\s\S]+)$/.exec(part);
    if (!m) { skipped.push(`${t}: ${part.slice(0, 60)}`); continue; }
    const [, name, rest] = m;
    if ((have[t] || []).includes(name)) continue;
    if (/\bprimary key\b/i.test(rest)) { skipped.push(`${t}.${name}: يحوي PRIMARY KEY (تخطّي — الجدول له PK أصلاً)`); continue; }
    stmts.push(`ALTER TABLE public.${t} ADD COLUMN IF NOT EXISTS ${name} ${rest.replace(/\s+/g, ' ').trim()};`);
  }
}

const header = `-- محاذاة الجداول الستة الموجودة مع تعريفات الملفات الثلاثة (مولّد آلياً)\n-- لا يحذف شيئاً؛ يضيف الأعمدة الناقصة فقط.\n`;
writeFileSync('.wrangler/tmp/align.sql', header + stmts.join('\n') + (fks.length ? '\n\n-- قيود مفاتيح أجنبية قد تتخطاها القوائم لأن الجدول موجود:\n' + fks.join('\n') : '') + '\n');

console.log(`أعمدة ستُضاف: ${stmts.length}`);
for (const t of TARGETS) {
  const n = stmts.filter(s => s.startsWith(`ALTER TABLE public.${t} `)).length;
  console.log(`  ${t}: +${n} عمود (من ${blocks[t] ? splitTop(blocks[t]).length : 0} تعريف)`);
}
if (fks.length) console.log(`قيود FK مُولّدة: ${fks.length}\n` + fks.map(s => '  ' + s).join('\n'));
if (skipped.length) console.log('متخطّى:\n' + skipped.map(s => '  ' + s).join('\n'));
