// يطبّق ملفات SQL بالترتيب على هدف dbTarget().
//
//   node scripts/apply-migrations.mjs                      # كل ملفات supabase/migrations
//   node scripts/apply-migrations.mjs <file> [file...]     # الملفات المحددة فقط
//
// مهم: مجلد الهجرات يحمل تاريخ النظام السابق (‎202610…‎) وهو مهاجر لا تأسيسي:
// ملفاته تفترض مخططًا و`auth.users` قائمين، ولا تُشغَّل على قاعدة فارغة. البناء
// من الصفر يكون دائمًا من 20261108000001 ثم 20261108000002 (كما في CI).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { dbTarget } from './db-target.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dir, '..', 'supabase', 'migrations');
const { label, options } = dbTarget();

if (!options.password) {
  console.error('كلمة مرور القاعدة غير مضبوطة (SUPABASE_DB_PASSWORD أو PGPASSWORD).');
  process.exit(2);
}

const requested = process.argv.slice(2);
const files = requested.length
  ? requested.map((p) => path.resolve(process.cwd(), p)).sort()
  : fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => path.join(migrationsDir, f))
      .sort();

if (!files.length) {
  console.error(`لا ملفات هجرة في ${migrationsDir}`);
  process.exit(2);
}

const client = new pg.Client({ ...options, statement_timeout: 120000 });
try {
  await client.connect();
} catch (e) {
  console.error('فشل الاتصال:', e.message);
  process.exit(2);
}

try {
  for (const file of files) {
    await client.query(fs.readFileSync(file, 'utf8'));
    console.log(`مطبَّق: ${path.basename(file)}`);
  }
  console.log(`\n${files.length} هجرة على ${label}`);
} catch (e) {
  console.error('فشل تطبيق الهجرة:', e.message);
  await client.end();
  process.exit(1);
}
await client.end();
