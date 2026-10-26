// اختبار أتمتة أقسام inventory_movements داخل معاملة ثم ROLLBACK (بدون أي حفظ على الإنتاج)
// الاستخدام: node supabase/tests/run-autopartition-test.mjs [--apply]
//
// بدون --apply : يشغّل الترحيل داخل BEGIN (مرتين لإثبات التكرار الآمن) ثم اختبارات
//               التحقق ثم ROLLBACK، ويعيد التحقق من أن أي كائن لم يُحفظ.
// مع --apply   : يُثبّت الترحيل (الدالة + جدولة pg_cron + الأقسام) ثم يجري اختبارات
//               التحقق داخل معاملة تُلغى بالكامل.
//
// يغطي:
//   A1 الدالة auto_create_monthly_partitions() موجودة وترجع jsonb بشروط التغطية
//   A2 القسم الافتراضي (DEFAULT) موجود كشبكة أمان
//   A3 تغطية 37 نطاقاً: الشهر الجاري + الأشهر الـ 36 القادمة
//   A4 إعادة التوليد: حذف قسم مستقبلي ثم استرجاعه بنفس المدى
//   A5 التكرار الآمن: استدعاء ثانٍ لا ينشئ شيئاً (created_count = 0)
//   A6 جدولة pg_cron: وظيفة واحدة باسم ثابت في اليوم الأول من كل شهر 00:00 UTC
//   A7 مسار الحركات: تاريخ بعيد يذهب للقسم الافتراضي وتاريخ مغطى يذهب لقسم شهريه
//   A8 الصلاحيات: الدالة محجوبة على authenticated (إنشاء أقات DDL)
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const token = readFileSync(join(ROOT, 'secrets/SUPABASE_ACCESS_TOKEN'), 'utf8').trim();
const MIGRATION = join(ROOT, 'supabase/migrations/202610260001_auto_partitioning.sql');
const API = 'https://api.supabase.com/v1/projects/iksjhjxwphmvthryfeae/database/query';

async function run(query) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(180000),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = [{ raw: text }]; }
  return { ok: res.ok, status: res.status, data };
}

const ASSERTIONS = `
do $autop$
declare
  v_from constant date := date_trunc('month', now())::date;
  v_json jsonb;
  v_missing int := 0;
  v_name text;
  v_bound text;
  v_cnt int;
  v_schedule text;
  v_command text;
  d date;
  near_ts timestamptz := v_from + make_interval(months => 8) + interval '15 days + 10 hours';
begin
  ---------------------------------------------------------------- A1) الدالة
  if to_regprocedure('public.auto_create_monthly_partitions()') is null then
    raise exception 'A1 فشل: الدالة auto_create_monthly_partitions غير موجودة';
  end if;

  select public.auto_create_monthly_partitions() into v_json;
  if v_json is null or jsonb_typeof(v_json) <> 'object' then
    raise exception 'A1 فشل: الدالة لا ترجع jsonb (%)', coalesce(v_json::text, 'null');
  end if;
  if coalesce((v_json->>'months_future')::int, 0) <> 36 then
    raise exception 'A1 فشل: months_future = % (المتوقع 36)', v_json->>'months_future';
  end if;
  if coalesce((v_json->>'default_partition')::boolean, false) <> true then
    raise exception 'A1 فشل: الدالة لا تؤكد وجود القسم الافتراضي';
  end if;

  ---------------------------------------------------------------- A2) القسم الافتراضي
  if not exists (
    select 1 from pg_inherits ih join pg_class c on c.oid = ih.inhrelid
     where ih.inhparent = 'public.inventory_movements'::regclass
       and pg_get_expr(c.relpartbound, c.oid) like '%DEFAULT%'
  ) then
    raise exception 'A2 فشل: القسم الافتراضي (DEFAULT) غير موجود';
  end if;

  ---------------------------------------------------------------- A3) تغطية 37 نطاقاً
  for i in 0 .. 36 loop
    d := v_from + make_interval(months => i);
    if not exists (
      select 1 from pg_inherits ih join pg_class c on c.oid = ih.inhrelid
       where ih.inhparent = 'public.inventory_movements'::regclass
         and c.relname = 'inventory_movements_' || to_char(d, 'YYYY_MM')
    ) then
      v_missing := v_missing + 1;
    end if;
  end loop;
  if v_missing > 0 then
    raise exception 'A3 فشل: % من (الشهر الجاري + 36 شهراً) بلا قسم', v_missing;
  end if;

  ---------------------------------------------------------------- A4) إعادة التوليد بعد حذف
  d := v_from + make_interval(months => 30);
  execute format('drop table public.inventory_movements_%s', to_char(d, 'YYYY_MM'));
  if exists (
    select 1 from pg_inherits ih join pg_class c on c.oid = ih.inhrelid
     where ih.inhparent = 'public.inventory_movements'::regclass
       and c.relname = 'inventory_movements_' || to_char(d, 'YYYY_MM')
  ) then
    raise exception 'A4 فشل: لم يُحذف قسم الاختبار';
  end if;

  select public.auto_create_monthly_partitions() into v_json;
  select c.relname, pg_get_expr(c.relpartbound, c.oid) into v_name, v_bound
    from pg_inherits ih join pg_class c on c.oid = ih.inhrelid
   where ih.inhparent = 'public.inventory_movements'::regclass
     and c.relname = 'inventory_movements_' || to_char(d, 'YYYY_MM');
  if v_name is null then
    raise exception 'A4 فشل: الدالة لم تعد إنشاء القسم المحذوف (%)', to_char(d, 'YYYY_MM');
  end if;
  if v_bound is null or v_bound not like 'FOR VALUES FROM (%' || to_char(d, 'YYYY-MM-DD') || '%'
                     or v_bound not like '%TO (%' || to_char(d + interval '1 month', 'YYYY-MM-DD') || '%' then
    raise exception 'A4 فشل: مدى القسم المُعاد غير صحيح (%)', coalesce(v_bound, 'null');
  end if;
  if coalesce((v_json->>'created_count')::int, 0) < 1 then
    raise exception 'A4 فشل: created_count = % بعد حذف قسم', v_json->>'created_count';
  end if;

  ---------------------------------------------------------------- A5) التكرار الآمن
  select public.auto_create_monthly_partitions() into v_json;
  if coalesce((v_json->>'created_count')::int, -1) <> 0 then
    raise exception 'A5 فشل: استدعاء متكرر أنشأ أقساماً موجودة (created_count = %)', v_json->>'created_count';
  end if;
  if coalesce((v_json->>'existing_count')::int, 0) < 37 then
    raise exception 'A5 فشل: existing_count = % (المتوقع 37 على الأقل)', v_json->>'existing_count';
  end if;

  ---------------------------------------------------------------- A6) جدولة pg_cron
  if to_regclass('cron.job') is null then
    raise exception 'A6 فشل: امتداد pg_cron غير مثبت — الجدولة غير مفعّلة';
  end if;

  select count(*) into v_cnt from cron.job where jobname = 'wms_auto_create_monthly_partitions';
  if v_cnt <> 1 then
    raise exception 'A6 فشل: عدد وظائف الجدولة = % (المتوقع 1 — لا تضاعف)', v_cnt;
  end if;

  select schedule, command into v_schedule, v_command
    from cron.job where jobname = 'wms_auto_create_monthly_partitions';
  if v_schedule is distinct from '0 0 1 * *' then
    raise exception 'A6 فشل: موعد الجدولة "%" (المتوقع "0 0 1 * *" = اليوم الأول 00:00)', v_schedule;
  end if;
  if v_command not like '%public.auto_create_monthly_partitions()%' then
    raise exception 'A6 فشل: أمر الجدولة لا يستدعي الدالة (%)', v_command;
  end if;

  ---------------------------------------------------------------- A7) مسار الحركات
  -- حركة بتاريخ بعيد خارج كل الأقسام الشهرية → القسم الافتراضي (شبكة الأمان)
  insert into public.inventory_movements (tenant_id, warehouse_id, product_id, movement_type, quantity, created_at, notes)
    values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'in', 1, '2035-05-10 10:00:00+00', 'autop-far-future');

  select c.relname into v_name
    from public.inventory_movements im join pg_class c on c.oid = im.tableoid
   where im.created_at = '2035-05-10 10:00:00+00';
  if v_name is distinct from 'inventory_movements_default' then
    raise exception 'A7 فشل: الحركة البعيدة وقعت في % بدل القسم الافتراضي', coalesce(v_name, 'null');
  end if;

  -- حركة بتاريخ مغطى → قسم شهرها
  insert into public.inventory_movements (tenant_id, warehouse_id, product_id, movement_type, quantity, created_at, notes)
    values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'in', 1, near_ts, 'autop-covered-month');

  select c.relname into v_name
    from public.inventory_movements im join pg_class c on c.oid = im.tableoid
   where im.created_at = near_ts;
  if v_name is distinct from 'inventory_movements_' || to_char(date_trunc('month', near_ts), 'YYYY_MM') then
    raise exception 'A7 فشل: الحركة المغطاة وقعت في % بدل %',
      coalesce(v_name, 'null'), 'inventory_movements_' || to_char(date_trunc('month', near_ts), 'YYYY_MM');
  end if;

  ---------------------------------------------------------------- A8) الصلاحيات
  begin
    execute 'set local role authenticated';
    perform public.auto_create_monthly_partitions();
    raise exception 'A8 فشل: الدالة متاحة على authenticated رغم أنها تنشئ أقسام DDL';
  exception
    when insufficient_privilege then null; -- المتوقع تماماً
    when raise_exception then
      if sqlerrm like 'A8 فشل:%' then raise; end if;
      raise; -- أي خطأ آخر (مثل 42501 بمعنى آخر) يبقى فشلاً
  end;
  execute 'reset role';

  raise notice '✅ جميع اختبارات أتمتة الأقسام نجحت';
end $autop$;

select 'AUTO_PARTITION_OK' as marker;
`;

const STATE_SQL = `select
  (select count(*) from pg_inherits ih join pg_class c on c.oid = ih.inhrelid
    where ih.inhparent = 'public.inventory_movements'::regclass) as partition_count,
  (select count(*) from pg_proc where proname = 'auto_create_monthly_partitions') as fn_count,
  (select to_regclass('cron.job') is not null) as cron_installed,
  (select exists (
     select 1 from pg_inherits ih join pg_class c on c.oid = ih.inhrelid
      where ih.inhparent = 'public.inventory_movements'::regclass
        and pg_get_expr(c.relpartbound, c.oid) like '%DEFAULT%')) as has_default`;

const ALLOWED = process.argv.includes('--apply');
const migrationSql = readFileSync(MIGRATION, 'utf8');

function show(label, res) {
  console.error(label, res.status);
  console.error(typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 1).slice(0, 6000));
}

function hasMarker(res) {
  return JSON.stringify(res.data || '').includes('AUTO_PARTITION_OK');
}

if (ALLOWED) {
  console.log('▶ تطبيق ترحيل أتمتة الأقسام على الإنتاج...');
  const applied = await run(migrationSql);
  if (!applied.ok) { show('❌ فشل التطبيق:', applied); process.exit(1); }

  console.log('▶ التحقق من الترحيل المُطبَّق داخل معاملة ثم ROLLBACK...');
  const verified = await run('BEGIN;\n' + ASSERTIONS + '\nROLLBACK;\n');
  if (!verified.ok) { show('❌ فشل التحقق:', verified); process.exit(1); }
  if (!hasMarker(verified)) { show('❌ التحقق لم يكتمل (لا علامة النجاح):', verified); process.exit(1); }

  const post = await run(STATE_SQL);
  console.log('الحالة بعد التطبيق:', JSON.stringify(post.data));
  console.log('✅ طُبّق الترحيل واجتاز اختبارات التحقق — ولا توجد بيانات اختبار محفوظة في الإنتاج');
  process.exit(0);
}

const pre = await run(STATE_SQL);
if (!pre.ok) { console.error('❌ تعذر قراءة الحالة قبل الاختبار:', JSON.stringify(pre.data).slice(0, 800)); process.exit(1); }
const preState = pre.data && pre.data[0];

console.log('▶ تشغيل ترحيل أتمتة الأقسام (مرتين لإثبات التكرار الآمن) داخل معاملة ثم ROLLBACK...');
const res = await run('BEGIN;\n' + migrationSql + '\n' + migrationSql + '\n' + ASSERTIONS + '\nROLLBACK;\n');
if (!res.ok) { show('❌ فشل:', res); process.exit(1); }
if (!hasMarker(res)) { show('❌ الاختبار لم يكتمل (لا علامة النجاح):', res); process.exit(1); }

const post = await run(STATE_SQL);
const row = post.data && post.data[0];
if (!row || !preState) {
  console.error('❌ تعذر التحقق من حالة القاعدة بعد ROLLBACK:', JSON.stringify(post.data, null, 1).slice(0, 1000));
  process.exit(1);
}
if (JSON.stringify(row) !== JSON.stringify(preState)) {
  console.error('❌ ROLLBACK لم يُلغي كل التغييرات:', { before: preState, after: row });
  process.exit(1);
}
console.log('الاستجابة:', JSON.stringify(res.data).slice(0, 1200));
console.log('✅ نجاح: الترحيل يعمل (ومتكرر آمن) داخل معاملة ويلغي كلياً عند ROLLBACK — لا حفظ على الإنتاج');
