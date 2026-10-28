// اختبار إصلاح مشغّل الفترة المالية على journal_entries
//   202610270003_fix_journal_entry_period_trigger.sql
//
// يشغّل سكربت journal-period-trigger-test.sql داخل معاملة واحدة ثم ROLLBACK،
// فلا يبقى أي أثر على الإنتاج. التحققات داخل السكربت:
//   T1 قيد داخل فترة مُقفلة لنفس المؤسسة يُرفض (بنفس رسالة الخطأ)
//   T2 قيد خارج أي فترة مُقفلة يُقبل — وهذا ما كان مستحيلاً قبل الإصلاح
//        (الدالة القديمة كانت تقارن uuid بـ date وترسمع:
//         operator does not exist: uuid = date)
//   T3 فترة مُقفلة تابعة لمؤسسة أخرى لا تمنع مؤسستنا
//   T4 general_ledger (period_id uuid) ما زالت مرفوضة على فترة مُقفلة
//   T5 سطر أستاذ بلا فترة (period_id null) يُقبل
// والمشغّل الآن يستدعي f_block_closed_period_by_date بدل الدالة القديمة.
//
// الاستخدام: node supabase/tests/run-journal-period-trigger-test.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const token = readFileSync(join(ROOT, 'secrets/SUPABASE_ACCESS_TOKEN'), 'utf8').trim();
const API = 'https://api.supabase.com/v1/projects/iksjhjxwphmvthryfeae/database/query';
const TEST_SQL = readFileSync(
  join(ROOT, 'supabase/tests/journal-period-trigger-test.sql'),
  'utf8'
);

async function run(query) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(180000),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = [{ raw: text }]; }
  return { ok: res.ok, status: res.status, data };
}

const firstRow = (d) => (Array.isArray(d) ? d[0] : null);
let failed = 0;
const ok = (msg) => console.log(`✅ ${msg}`);
const fail = (...args) => { failed += 1; console.error(`❌ ${args.join(' ')}`); };

// ---- تعريف المشغّل النهائي
const trig = await run(`
  select pg_get_triggerdef(t.oid) as def
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'journal_entries'
     and t.tgname = 'trg_block_closed_period_je';`);
if (!trig.ok) {
  fail('تعذر قراءة تعريف المشغّل:', JSON.stringify(trig.data).slice(0, 300));
} else {
  const def = firstRow(trig.data)?.def || '';
  if (!/f_block_closed_period_by_date/.test(def)) {
    fail('المشغّل ما زال يستدعي الدالة القديمة (المشكلة موجودة):', def || '(غير موجود)');
  } else if (!/BEFORE INSERT OR UPDATE ON public\.journal_entries/.test(def)) {
    fail('تعريف المشغّل غير متوقع:', def);
  } else {
    ok('المشغّل يستدعي f_block_closed_period_by_date على journal_entries');
  }
}

// ---- تشغيل اختبارات السلوك (داخل معاملة ثم ROLLBACK)
const t = await run(TEST_SQL);
if (!t.ok) {
  fail('فشل اختبار المشغّل:', JSON.stringify(t.data).slice(0, 800));
} else {
  const row = firstRow(t.data);
  if (!row || row.marker !== 'TRGTEST-ALL-OK') {
    fail('نتيجة غير متوقعة (لم يُنفَّذ السكربت كاملاً):', JSON.stringify(row).slice(0, 400));
  } else if (Number(row.je_left) !== 0 || Number(row.gl_left) !== 0 || Number(row.fp_left) !== 0) {
    fail('تبقّت بيانات اختبار على الإنتاج:', JSON.stringify(row));
  } else {
    ok('T1–T5 نجحت: رفض فترة مُقفلة، وقبول الفترة المفتوحة، وعزل المؤسسات، وسلوك general_ledger محفوظ');
    ok('ROLLBACK كامل: لا بقايا في journal_entries / general_ledger / financial_periods');
  }
}

if (failed) {
  console.error(`\n❌ فشل ${failed} تحقق(ات) في اختبار مشغّل journal_entries`);
  process.exit(1);
}
console.log('\n✅ اختبار إصلاح مشغّل الفترة المالية على journal_entries نجح');