// أداة تطبيق/فحص SQL على Supabase الحيّ عبر Management API (مؤقتة — خارج git).
// تقرأ التوكن من البيئة فقط ولا تكتبه في ملف أبداً.
//   node .wrangler/tmp/live-sql.mjs --probe "select ..."
//   node .wrangler/tmp/live-sql.mjs --apply path/to/file.sql [--only=substr]
import { readFileSync } from 'fs';

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN غير موجود في البيئة'); process.exit(2); }

const REF = process.env.SUPABASE_PROJECT_REF || 'iksjhjxwphmvthryfeae';
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;
const H = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };

async function q(query, timeout = 180000) {
  for (let a = 0; ; a++) {
    let r, text;
    try {
      r = await fetch(API, { method: 'POST', headers: H, body: JSON.stringify({ query }), signal: AbortSignal.timeout(timeout) });
      text = await r.text();
    } catch (e) {
      if (a < 3) { await new Promise(s => setTimeout(s, 2000 * (a + 1))); continue; }
      return { ok: false, status: 0, rows: [], message: 'network: ' + e.message };
    }
    if (r.status === 429 && a < 4) { await new Promise(s => setTimeout(s, 1500 * (a + 1))); continue; }
    let rows = [], message = '';
    try { const j = JSON.parse(text); Array.isArray(j) ? rows = j : (message = j.message || JSON.stringify(j)); }
    catch { message = text.slice(0, 800); }
    return { ok: r.ok, status: r.status, rows, message };
  }
}

function splitStatements(sql) {
  const out = []; let buf = ''; let i = 0; const n = sql.length;
  while (i < n) {
    const ch = sql[i]; const two = sql.substr(i, 2);
    if (two === '--') { while (i < n && sql[i] !== '\n') i++; continue; }
    if (two === '/*') { const e = sql.indexOf('*/', i + 2); i = e === -1 ? n : e + 2; continue; }
    if (ch === "'") { buf += ch; i++; while (i < n) { buf += sql[i]; if (sql[i] === "'") { if (sql[i + 1] === "'") { buf += sql[++i]; i++; break; } i++; break; } i++; } continue; }
    if (ch === '$') { const m = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i)); if (m) { const tag = m[0]; const end = sql.indexOf(tag, i + tag.length); buf += sql.slice(i, end === -1 ? n : end + tag.length); i = end === -1 ? n : end + tag.length; continue; } }
    if (ch === ';') { if (buf.trim()) out.push(buf.trim()); buf = ''; i++; continue; }
    buf += ch; i++;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const mode = process.argv[2];

if (mode === '--probe' || mode === '--count') {
  const res = await q(process.argv[3]);
  if (!res.ok) { console.error(`HTTP ${res.status}: ${res.message}`); process.exit(1); }
  if (mode === '--count') { console.log(JSON.stringify(res.rows)); process.exit(0); }
  if (!res.rows.length) { console.log('(no rows)'); process.exit(0); }
  const keys = Object.keys(res.rows[0]);
  console.log(keys.join(' | '));
  for (const r of res.rows) console.log(keys.map(k => String(r[k] ?? '')).join(' | '));
  process.exit(0);
}

if (mode === '--apply') {
  const file = process.argv[3];
  const onlyArg = process.argv.find(a => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length) : null;
  const sql = readFileSync(file, 'utf8');
  const stmts = splitStatements(sql).filter(s => !only || s.toLowerCase().includes(only.toLowerCase()));
  console.log(`${file} — ${stmts.length} statements`);

  const t0 = Date.now();
  const res = await q('begin;\n' + stmts.join(';\n') + ';\ncommit;', 300000);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.ok) { console.log(`  OK (${secs}s)`); process.exit(0); }

  console.log(`  FAILED (${secs}s): ${res.message}\n  locating failing statement inside a rolled-back transaction ...`);

  const probe = (a, b) => q('begin;\n' + stmts.slice(a, b).join(';\n') + ';\nrollback;', 180000);
  const whole = await probe(0, stmts.length);
  if (whole.ok) { console.error('  could not locate: whole file succeeded inside a rolled-back transaction'); process.exit(1); }
  let a = 0, b = stmts.length;
  while (b - a > 1) { const mid = Math.floor((a + b) / 2); const r = await probe(a, mid); r.ok ? a = mid : b = mid; }
  const one = await probe(a, a + 1);
  console.error(`FAILING STATEMENT ${a + 1}/${stmts.length}: ${one.message}`);
  console.error('--- statement text (first 25 lines) ---');
  console.error(stmts[a].split('\n').slice(0, 25).join('\n'));
  console.error('--- (all attempts ran inside begin/rollback; nothing applied) ---');
  process.exit(1);
}

console.error('usage: --probe "<sql>" | --count "<sql>" | --apply <file.sql> [--only=substr]');
process.exit(64);
