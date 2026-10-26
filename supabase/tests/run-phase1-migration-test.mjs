// اختبار ترحيل المرحلة 1 داخل معاملة ثم ROLLBACK (بدون أي حفظ على الإنتاج)
// الاستخدام: node supabase/tests/run-phase1-migration-test.mjs [--apply]
//
// بدون --apply : يشغّل الترحيل داخل BEGIN ثم يُجري اختبارات تحققيق ثم ROLLBACK
//               ويعيد التحقق من أن أي كائن لم يُحفظ.
// مع --apply   : يشغّل الترحيل تطبيقاً دائماً (بدون ROLLBACK).
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const token = readFileSync(join(ROOT, 'secrets/SUPABASE_ACCESS_TOKEN'), 'utf8').trim();
const MIGRATION = join(ROOT, 'supabase/migrations/202610250001_phase1_receiving_inventory.sql');
const API = 'https://api.supabase.com/v1/projects/iksjhjxwphmvthryfeae/database/query';

async function run(query) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = [{ raw: text }]; }
  return { ok: res.ok, status: res.status, data };
}

const ASSERTIONS = `
do $assert$
begin
  -- 1) قسم افتراضي + قسم للشهر الحالي لسجل الحركات
  if not exists (
    select 1 from pg_inherits ih join pg_class c on c.oid = ih.inhrelid
     where ih.inhparent = 'public.inventory_movements'::regclass
       and pg_get_expr(c.relpartbound, c.oid) like '%DEFAULT%'
  ) then
    raise exception 'فشل: قسم افتراضي (DEFAULT) غير موجود لسجل الحركات';
  end if;

  if not exists (
    select 1 from pg_inherits ih join pg_class c on c.oid = ih.inhrelid
     where ih.inhparent = 'public.inventory_movements'::regclass
       and c.relname = 'inventory_movements_' || to_char(now(), 'YYYY_MM')
  ) then
    raise exception 'فشل: لا يوجد قسم للشهر الحالي';
  end if;

  -- 2) سجل غير قابل للتعديل
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.inventory_movements'::regclass
       and tgname = 'inventory_movements_no_mutation' and tgisinternal = false
  ) then
    raise exception 'فشل: مانع تعديل السجل غير موجود';
  end if;

  -- 3) قيود المخزون
  if not exists (
    select 1 from pg_constraint
     where conname = 'ck_inventory_bucket_balance' and conrelid = 'public.inventory'::regclass
  ) then
    raise exception 'فشل: قيد توازن حالات المخزون غير موجود';
  end if;

  -- 4) أعمدة الحالات
  if not exists (select 1 from information_schema.columns
                  where table_name = 'inventory' and column_name = 'staging_quantity') then
    raise exception 'فشل: عمود staging_quantity غير موجود';
  end if;

  -- 5) دوال الترحيل الذرية
  if to_regprocedure('public.wms_gr_post(uuid,uuid)') is null then
    raise exception 'فشل: دالة wms_gr_post غير موجودة';
  end if;
  if to_regprocedure('public.wms_gr_create(uuid,jsonb,text,uuid)') is null then
    raise exception 'فشل: دالة wms_gr_create غير موجودة';
  end if;

  -- 6) السجل يقبل حركة بتاريخ اليوم (كان يفشل قبل الإصلاح)
  begin
    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, movement_type, quantity, notes)
    values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'receipt', 1, 'dry-run');
  exception when others then
    raise exception 'فشل: إدراج حركة بتاريخ اليوم (%)', SQLERRM;
  end;

  -- 7) السجل يرفض التعديل
  begin
    update public.inventory_movements set quantity = 999 where notes = 'dry-run';
    raise exception 'فشل: تم السماح بتعديل حركة في السجل';
  exception
    when raise_exception then
      if sqlerrm like 'فشل%' then raise; end if;
    when others then
      null; -- متوقع: append-only
  end;

  -- 8) السجل يرفض الحذف
  begin
    delete from public.inventory_movements where notes = 'dry-run';
    raise exception 'فشل: تم السماح بحذف حركة من السجل';
  exception
    when raise_exception then
      if sqlerrm like 'فشل%' then raise; end if;
    when others then
      null;
  end;

  raise notice '✅ جميع اختبارات الترحيل نجحت';
end $assert$;
`;

const STATE_SQL = `select
  to_regprocedure('public.wms_gr_post(uuid,uuid)') is not null as fn_exists,
  exists (select 1 from pg_constraint where conname = 'ck_inventory_bucket_balance') as constraint_exists,
  exists (select 1 from pg_inherits ih join pg_class c on c.oid = ih.inhrelid
           where ih.inhparent = 'public.inventory_movements'::regclass
             and pg_get_expr(c.relpartbound, c.oid) like '%DEFAULT%') as default_partition_exists`;

const ALLOWED = process.argv.includes('--apply');

// لقطة قبل التشغيل — حتى يعمل الاختبار قبل التطبيق وبعده
globalThis.__preState = null;
if (!ALLOWED) {
  const pre = await run(STATE_SQL);
  if (!pre.ok) {
    console.error('❌ تعذر قراءة الحالة قبل الاختبار:', JSON.stringify(pre.data).slice(0, 800));
    process.exit(1);
  }
  globalThis.__preState = pre.data && pre.data[0];
}

const sql = ALLOWED
  ? readFileSync(MIGRATION, 'utf8') + '\n' + ASSERTIONS
  : 'BEGIN;\n' + readFileSync(MIGRATION, 'utf8') + '\n' + ASSERTIONS + '\nROLLBACK;\n';

console.log(ALLOWED ? '▶ تطبيق الترحيل على الإنتاج...' : '▶ تشغيل الترحيل داخل معاملة ثم ROLLBACK...');
const res = await run(sql);

if (!res.ok) {
  console.error('❌ فشل:', res.status);
  console.error(typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 1).slice(0, 4000));
  process.exit(1);
}
const notices = (Array.isArray(res.data) ? res.data : [])
  .map((r) => r && (r.notice || r.message || r.W || ''))
  .filter(Boolean);
console.log('الاستجابة:', JSON.stringify(res.data).slice(0, 1200));

if (ALLOWED) {
  console.log('✅ طُبّق الترحيل على قاعدة الإنتاج');
  process.exit(0);
}

// التحقق من أن التغييرات لم تُحفظ (الحالة بعد = الحالة قبل)
const post = await run(STATE_SQL);
const row = post.data && post.data[0];
const pre = globalThis.__preState;
if (!row || !pre) {
  console.error('❌ تعذر التحقق من حالة القاعدة بعد ROLLBACK:', JSON.stringify(post.data).slice(0, 1000));
  process.exit(1);
}
if (JSON.stringify(row) !== JSON.stringify(pre)) {
  console.error('❌ ROLLBACK لم يُلغي كل التغييرات:', { before: pre, after: row });
  process.exit(1);
}
console.log('✅ نجاح: الترحيل يعمل داخل معاملة ويلغي كلياً عند ROLLBACK (لا حفظ على الإنتاج)');
console.log('✅ جميع اختبارات الترحيل نجحت (dry-run)');
