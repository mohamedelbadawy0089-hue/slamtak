import { readFileSync } from 'fs';

// فحص ما إذا كانت هجرة نظام المبيعات (part1/part2/part3) مطبَّقة فعلاً على مشروع Supabase.
// الاستخدام: node supabase/verify-sales-migration.mjs
// يقرأ مفاتيح البيئة من .env.local إن وُجد، وإلا من متغيرات النظام.

function loadEnv() {
  const out = {};
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      if (line.startsWith('#') || !line.trim()) continue;
      const i = line.indexOf('=');
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch (_) {}
  return out;
}

const env = { ...loadEnv(), ...process.env };
const URL_ = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY غير معرّفين');
  process.exit(2);
}

const h = { apikey: KEY, Authorization: 'Bearer ' + KEY };

// كائنات الهجرة: جداول + دوال (المُتحقَّق منها عبر REST API فقط)
const TABLES = ['sales_quotes', 'sales_quote_items', 'sales_invoices', 'sales_invoice_items', 'returns', 'return_items', 'payments'];
const FUNCS = {
  p_sale_next_number: { p_prefix: 'SQ', p_warehouse_id: '00000000-0000-0000-0000-000000000000' },
  p_sale_approve_invoice: { p_invoice_id: '00000000-0000-0000-0000-000000000000', p_user_id: '00000000-0000-0000-0000-000000000000' },
  p_sale_record_payment: { p_invoice_id: '00000000-0000-0000-0000-000000000000', p_amount: 1, p_method: 'cash', p_notes: '', p_user_id: '00000000-0000-0000-0000-000000000000' },
  p_sale_create_return: { p_invoice_id: '00000000-0000-0000-0000-000000000000', p_items: [], p_reason: 'verify', p_user_id: '00000000-0000-0000-0000-000000000000' },
};

const results = [];
for (const t of TABLES) {
  const r = await fetch(`${URL_}/rest/v1/${t}?select=id&limit=0`, { headers: h });
  results.push({ kind: 'جدول', name: t, ok: r.ok, detail: r.ok ? 'موجود' : `HTTP ${r.status}` });
}
for (const [fn, args] of Object.entries(FUNCS)) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  let body = {};
  try { body = await r.json(); } catch (_) {}
  const missing = body.code === 'PGRST202' || r.status === 404;
  // وجود الدالة ⇒ أي استجابة أخرى غير PGRST202 (حتى خطأ تنفيذ/منطق يعني أن الدالة موجودة)
  results.push({ kind: 'دالة', name: fn, ok: !missing, detail: missing ? 'غير موجودة' : `موجودة (HTTP ${r.status})` });
}

let applied = 0;
console.log('=== حالة الهجرة: supabase/migrations/part1_sales_tables.sql + part2_sales_functions.sql + part3_sales_policies.sql ===');
for (const r of results) {
  if (r.ok) applied++;
  console.log(`${r.ok ? '✅ مطبَّق' : '❌ ناقص'} | ${r.kind} ${r.name} — ${r.detail}`);
}
console.log(`\nالنتيجة: ${applied}/${results.length} كائناً من كائنات الهجرة الأساسية (جداول+دوال) مطبَّقة.`);

if (applied < results.length) {
  console.log(`
⚠️ الهجرة غير مكتملة على قاعدة البيانات الحية.
السبب: الدالة exec_sql غير موجودة ولا توجد صلة Postgres مباشرة في هذه البيئة،
لذلك لا يمكن تنفيذ SQL DDL تلقائياً من هنا.

الخطوات لتطبيق الملف كاملاً:
  1. افتح محرر SQL في لوحة تحكم Supabase:
     ${URL_.replace('https://', 'https://')}/sql/editor
  2. انسخ محتوى كل ملف ونفّذه بالترتيب — مرة واحدة لكل ملف:
     1) supabase/migrations/part1_sales_tables.sql     (الجداول والفهارس)
     2) supabase/migrations/part2_sales_functions.sql  (الدوال الذرية)
     3) supabase/migrations/part3_sales_policies.sql   (منع الحذف + RLS والصلاحيات)
     (idempotent: create table if not exists + create or replace + أطراف exception)
     (بديل: الملف الموحد supabase/migrations/20261019_sales_system.sql يعادل الثلاثة مجتمعة)
  3. أعد تشغيل هذا السكربت للتأكد:
     node supabase/verify-sales-migration.mjs`);
  process.exit(1);
}
console.log('\n✅ كل كائنات الهجرة الأساسية موجودة.');
