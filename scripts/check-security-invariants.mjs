// فحص ثوابت الأمان على قاعدة البيانات الحية (للقراءة فقط).
// يُشغّل scripts/check-security-invariants.sql ويُرجع رمز خروج 1 عند أي FAIL.
// التشغيل: SUPABASE_DB_PASSWORD=... node scripts/check-security-invariants.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { dbTarget } from './db-target.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const sqlFile = path.join(dir, 'check-security-invariants.sql');
const { label, options } = dbTarget();

if (!options.password) {
  console.error('SUPABASE_DB_PASSWORD (أو PGPASSWORD) غير مضبوط — لا يمكن فحص القاعدة. لا تتجاوز الفحص، اضبط المتغيّر ثم أعد التشغيل.');
  process.exit(2);
}

const client = new pg.Client({ ...options, statement_timeout: 30000 });

try {
  await client.connect();
} catch (e) {
  console.error('فشل الاتصال:', e.message);
  process.exit(2);
}

let rows;
try {
  ({ rows } = await client.query(fs.readFileSync(sqlFile, 'utf8')));
} catch (e) {
  console.error('فشل تنفيذ الفحص:', e.message);
  await client.end();
  process.exit(2);
}
await client.end();

const fails = rows.filter((r) => r.result === 'FAIL');
for (const r of rows) {
  const detail = r.result === 'PASS' ? '' : `  ← الفعلي ${r.actual} والمتوقع ${r.expected} — ${r.note}`;
  console.log(`${r.result}  ${r.check_name}${detail}`);
}

console.log(`\n${rows.length - fails.length}/${rows.length} فحصًا ناجحًا على ${label}`);

if (fails.length) {
  console.error(`\n${fails.length} انحرافًا أمنيًّا — أوقف النشر وأصلح السبب:`);
  for (const f of fails) console.error(`- ${f.check_name}: ${f.note}`);
  process.exit(1);
}
