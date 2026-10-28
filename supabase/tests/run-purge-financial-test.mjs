// اختبار الحذف التلقائي للسجلات المالية — 202610270002_purge_financial_records.sql
//
// كل ما يُنشأ هنا يُحذف أو يُلغى داخل المعاملة نفسها: لا شيء يبقى على الإنتاج.
// الجزء الأكبر من التحققات يجري داخل القاعدة (دالة _purge_selftest) ويرفض بـ
// استثناء عند أي فشل؛ وهذا الملف يشغّلها ويقرأ تقريرها ويتحقق من:
//   P1 الدالة تشمل financial_tables الستة (الفواتير/القيود/المقبوضات/المرتجعات)
//   P2 حُذفت سجلات أقدم من 12 شهراً وبقيت الحديثة (يتحقق منه داخل القاعدة)
//   P3 بنود القيد التابعة حُذفت مع الأب عبر cascade
//   P4 أرصدة العملاء لم تتغير أثناء الحذف (مشغّلات الأرصدة معطّلة خلاله)
//   P5 مشغّلات الحذف عادت مفعّلة بعد التنفيذ (تُفحص داخل القاعدة)
//   P6 التصريحات: anon/authenticated ممنوعان من الحذف، service_role مسموح
//   P7 مهمة pg_cron اليومية (03:00) موجودة ومفعّلة
//
// الاستخدام: node supabase/tests/run-purge-financial-test.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const token = readFileSync(join(ROOT, 'secrets/SUPABASE_ACCESS_TOKEN'), 'utf8').trim();
const API = 'https://api.supabase.com/v1/projects/iksjhjxwphmvthryfeae/database/query';
const SELFTEST_SQL = readFileSync(
  join(ROOT, 'supabase/tests/purge-financial-selftest.sql'),
  'utf8'
);

const FINANCIAL_TABLES = [
  'sales_invoices', 'purchase_invoices', 'journal_entries',
  'general_ledger', 'payments', 'returns',
];

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

async function main() {
  // ---- P6 الصلاحيات قبل أي شيء
  const priv = await run(`
    select p.proname, r.rolname,
           has_function_privilege(r.rolname, p.oid, 'execute') as can
      from pg_proc p
      join pg_roles r on r.rolname in ('anon','authenticated','service_role')
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('p_purge_old_data','p_purge_old_data_auto')
     order by 1, 2;`);
  if (!priv.ok) {
    fail('تعذر قراءة صلاحيات الدوال:', JSON.stringify(priv.data).slice(0, 300));
  } else {
    const rows = Array.isArray(priv.data) ? priv.data : [];
    const bad = rows.filter((r) => (r.rolname === 'service_role') !== r.can);
    if (rows.length === 0) fail('P6: لم تُعثر على دوال الحذف في القاعدة');
    else if (bad.length) fail('P6: صلاحيات غير صحيحة:', JSON.stringify(bad));
    else ok('P6: service_role فقط يملك تنفيذ الحذف، وanon/authenticated ممنوعان');
  }

  // ---- P7 مهمة الجدولة
  const cron = await run(
    `select jobname, schedule, active from cron.job where jobname = 'slamtak_purge_old_data';`
  );
  if (!cron.ok) {
    fail('تعذر قراءة مهمة pg_cron:', JSON.stringify(cron.data).slice(0, 300));
  } else {
    const job = firstRow(cron.data);
    if (!job) fail('P7: مهمة slamtak_purge_old_data غير موجودة');
    else if (!job.active || job.schedule !== '0 3 * * *')
      fail('P7: المهمة ليست كما هو متوقع:', JSON.stringify(job));
    else ok('P7: مهمة pg_cron موجودة ومفعّلة (0 3 * * *)');
  }

  // ---- P1..P5: تشغيل الاختبار داخل القاعدة
  let created = false;
  try {
    const c = await run(SELFTEST_SQL);
    if (!c.ok) {
      fail('تعذر إنشاء دالة الاختبار:', JSON.stringify(c.data).slice(0, 400));
      return;
    }
    created = true;

    const r = await run('select public._purge_selftest() as r;');
    if (!r.ok) {
      // دالة الاختبار ترفع استثناءً عند أي فشل — يظهر هنا
      fail('فشل اختبار الحذف التلقائي:', JSON.stringify(r.data).slice(0, 800));
      return;
    }

    const res = firstRow(r.data)?.r;
    if (!res || res.status !== 'ok') {
      fail('نتيجة غير متوقعة من الاختبار:', JSON.stringify(res).slice(0, 500));
      return;
    }
    ok('الاختبار الداخلي نجح: القديم حُذف، الحديث بقي، الأرصدة ثابتة، المشغّلات عادت مفعّلة');

    const rep = res.purge_report || {};
    const by = rep.by_table || {};

    // P1
    const ft = Array.isArray(rep.financial_tables) ? rep.financial_tables : [];
    const missing = FINANCIAL_TABLES.filter((t) => !ft.includes(t));
    if (missing.length) fail('P1: جداول مالية غائبة من نطاق الحذف:', missing.join(', '));
    else ok(`P1: نطاق الحذف يشمل الجداول المالية الستة: ${ft.join(', ')}`);

    if (rep.dry_run !== false) fail('P2: التقرير يشير إلى dry_run — لم يحدث حذف فعلي');
    else ok(`P2: حذف فعلي بحدّ زمني ${rep.cutoff} ومدة احتفاظ ${rep.retention_months} شهراً`);

    // P3
    const casc = by['journal_entry_lines (cascade)'] ?? 0;
    if (!(casc >= 1)) fail('P3: لم تُحذف بنود القيد التابعة مع الأب، العدّ =', casc);
    else ok(`P3: بنود القيد التابعة حُذفت مع الأب (cascade = ${casc})`);

    // P4
    const b0 = Number(res.balance_before_insert);
    const b1 = Number(res.balance_after_gl_insert);
    const b2 = Number(res.balance_after_purge);
    if (!(b1 === b0 + 100)) fail(`P4: مُنشئ الأرصدة لم يعمل عند الإدراج: ${b0} -> ${b1}`);
    else if (b2 !== b1) fail(`P4: تغيّرت أرصدة العملاء أثناء الحذف: ${b1} -> ${b2}`);
    else ok(`P4: أرصدة العملاء لم تتغير أثناء الحذف (${b0} -> ${b1} -> ${b2})`);

    // P5 (تحقق داخل القاعدة، نؤكد أن التقرير أُرجع كاملاً)
    if (!(Number(rep.total_rows) >= 6)) {
      fail('P5: تقرير الحذف لا يشمل كل الجداول، total_rows =', rep.total_rows);
    } else {
      ok(`P5: تقرير الحذف يضم ${rep.total_rows} صفاً من الجداول المالية وبنودها`);
    }
  } finally {
    if (created) {
      const d = await run('drop function if exists public._purge_selftest();');
      if (!d.ok) console.error('⚠️ تعذر حذف دالة الاختبار المؤقتة:', JSON.stringify(d.data).slice(0, 300));
      else ok('تنظيف: حُذفت دالة الاختبار المؤقتة من القاعدة');
    }
  }
}

await main();
if (failed) {
  console.error(`\n❌ فشل ${failed} تحقق(ات) في اختبار الحذف التلقائي`);
  process.exit(1);
}
console.log('\n✅ اختبار الحذف التلقائي للسجلات المالية نجح بالكامل');