// Usage: node scripts/apply-sql.mjs <file.sql>
// ينفّذ ملف SQL على قاعدة البيانات الحيّة عبر Supabase Management API.
import { readFileSync } from 'fs';

const token = readFileSync('secrets/SUPABASE_ACCESS_TOKEN', 'utf8').trim();
const file = process.argv[2];
if (!file) { console.error('usage: node scripts/apply-sql.mjs <file.sql>'); process.exit(1); }
const sql = readFileSync(file, 'utf8');

const res = await fetch('https://api.supabase.com/v1/projects/iksjhjxwphmvthryfeae/database/query', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
  signal: AbortSignal.timeout(120000),
});

const body = await res.text();
console.log('HTTP ' + res.status);
console.log(body.slice(0, 4000));
process.exit(res.ok ? 0 : 1);
