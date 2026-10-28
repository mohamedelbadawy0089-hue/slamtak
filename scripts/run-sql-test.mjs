// Usage: node scripts/run-sql-test.mjs <file.sql>
// ينفّذ ملف اختبار SQL ويطبع الفاشل فقط، ويخرج بكود 1 عند أي فشل.
import { readFileSync } from 'fs';
const token = readFileSync('secrets/SUPABASE_ACCESS_TOKEN', 'utf8').trim();
const file = process.argv[2];
const sql = readFileSync(file, 'utf8');
const res = await fetch('https://api.supabase.com/v1/projects/iksjhjxwphmvthryfeae/database/query', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
  signal: AbortSignal.timeout(180000),
});
const text = await res.text();
if (!res.ok) { console.error('HTTP ' + res.status + '\n' + text.slice(0, 1200)); process.exit(1); }
let rows = [];
try { rows = JSON.parse(text); } catch { rows = []; }
const checks = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === 'object' && 'ok' in r);
const failed = checks.filter((r) => r.ok === false);
console.log(file.replace('supabase/tests/', '') + ': ' + (checks.length - failed.length) + '/' + checks.length + ' ok');
for (const f of failed) console.log('  ✗ ' + f.name + ' — ' + f.detail);
process.exit(failed.length ? 1 : 0);
