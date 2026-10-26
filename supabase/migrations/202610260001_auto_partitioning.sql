-- =====================================================================================
-- (202610260001) أتمتة أقسام سجل الحركات: توليد شهري + جدولة pg_cron + قسم افتراضي
--
-- 1) public.auto_create_monthly_partitions():
--    توليد أقسام شهرية منتظمة لجدول public.inventory_movements (مفتاح القسمة RANGE (created_at))
--    للأشهر الـ 36 القادمة إضافة إلى الشهر الجاري، بشكل متكرر آمن (idempotent):
--    يتحقق من المدى الفعلي للقسم ولا من اسمه فقط، فلا يصطدم أبداً بقسم موجود
--    ولا يحاول إنشاء نطاق متداخل.
-- 2) جدولة الدالة بـ pg_cron لتُشغَّل في اليوم الأول من كل شهر (00:00 UTC) فتولّد
--    الأقسام المستقبلية بلا تدخل يدوي؛ كل تشغيل يمد النطاق 37 شهراً من لحظته،
--    فيبقى دائماً متقدماً على الوقت.
-- 3) القسم الافتراضي (DEFAULT) يبقى شبكة أمان لأي حركة لا تقع في نطاق قسم شهري،
--    وتُنشأ إن غاب.
--
-- ملاحظات:
--   * pg_cron مُحمّل مسبقاً في shared_preload_libraries على هذا المشروع، لذا يكفي
--     تثبيت الامتداد لتعمل الجدولة فعلياً.
--   * اسم الوظيفة ثابت، وإعادة الجدولة تلغي الوظيفة القديمة أولاً فلا تتضاعف.
--   * pg_cron يجدول بتوقيت UTC.
--
-- الاختبار (dry-run ثم ROLLBACK): node supabase/tests/run-autopartition-test.mjs
-- التطبيق النهائي:               node supabase/tests/run-autopartition-test.mjs --apply
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1) دالة توليد الأقسام الشهرية
-- -------------------------------------------------------------------------------------
create or replace function public.auto_create_monthly_partitions()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_future constant int := 36;                       -- الأشهر القادمة (إضافة إلى الشهر الجاري)
  v_from   constant date := date_trunc('month', now())::date;
  v_created   text[] := array[]::text[];
  v_existing  int := 0;
  v_has_default boolean;
  v_prefix text;
  d date;
  m text;
begin
  -- (أ) القسم الافتراضي: شبكة أمان لأي حركة خارج الأقسام الشهرية
  select exists (
    select 1 from pg_inherits ih
      join pg_class c on c.oid = ih.inhrelid
     where ih.inhparent = 'public.inventory_movements'::regclass
       and pg_get_expr(c.relpartbound, c.oid) like '%DEFAULT%'
  ) into v_has_default;

  if not v_has_default then
    execute 'create table if not exists public.inventory_movements_default partition of public.inventory_movements default';
    v_has_default := true;
  end if;

  -- (ب) الأقسام الشهرية: الشهر الجاري حتى الشهر التالي لآخر شهر مغطى
  for i in 0 .. v_future loop
    d := v_from + make_interval(months => i);
    m := to_char(d, 'YYYY_MM');

    -- المطابقة على المدى الفعلي للقسم (وليس على اسمه) — تمنع:
    --   • إعادة إنشاء قسم موجود، و
    --   • محاولة إنشاء نطاق متداخل مع قسم أُعيد تسميته أو أُنشئ باسم مختلف.
    v_prefix := 'FOR VALUES FROM (''' || to_char(d, 'YYYY-MM-DD');

    if exists (
      select 1 from pg_inherits ih
        join pg_class c on c.oid = ih.inhrelid
       where ih.inhparent = 'public.inventory_movements'::regclass
         and pg_get_expr(c.relpartbound, c.oid) like v_prefix || '%'
    ) then
      v_existing := v_existing + 1;
    else
      execute format(
        'create table public.inventory_movements_%s partition of public.inventory_movements for values from (%L) to (%L)',
        m, d, (d + interval '1 month')::date
      );
      v_created := v_created || m;
    end if;
  end loop;

  return jsonb_build_object(
    'months_future', v_future,
    'range_from', v_from,
    'range_to', (v_from + make_interval(months => v_future))::date,
    'created_count', coalesce(array_length(v_created, 1), 0),
    'created', coalesce(to_jsonb(v_created), '[]'::jsonb),
    'existing_count', v_existing,
    'default_partition', v_has_default
  );
end;
$fn$;

comment on function public.auto_create_monthly_partitions() is
  'توليد أقسام شهرية لـ inventory_movements للأشهر الـ 36 القادمة (idempotent) وضبط القسم الافتراضي — تُجدول شهرياً عبر pg_cron.';

-- الصلاحية: إنشاء أقسام DDL، فلا يُنفَّذ من الأدوار العامة
revoke all on function public.auto_create_monthly_partitions() from public, anon, authenticated;
grant execute on function public.auto_create_monthly_partitions() to service_role;

-- -------------------------------------------------------------------------------------
-- 2) تثبيت امتداد الجدولة (blok منفصل: يُجمَّع جسماً بعد تثبيت الامتداد)
-- -------------------------------------------------------------------------------------
do $autop_ext$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension if not exists pg_cron with schema cron;
    exception when others then
      raise warning 'auto_partitioning: تعذر تثبيت امتداد pg_cron (%) — ثبّته من لوحة Supabase ثم أعد تشغيل الترحيل', SQLERRM;
      return;
    end;
  end if;
end $autop_ext$;

-- -------------------------------------------------------------------------------------
-- 3) الجدولة: اليوم الأول من كل شهر الساعة 00:00 UTC
-- -------------------------------------------------------------------------------------
do $autop_cron$
begin
  -- إعادة الجدولة بلا تضاعف: إلغاء الوظيفة المسماة أولاً إن كانت موجودة
  if exists (select 1 from cron.job where jobname = 'wms_auto_create_monthly_partitions') then
    perform cron.unschedule('wms_auto_create_monthly_partitions');
  end if;

  perform cron.schedule(
    'wms_auto_create_monthly_partitions',
    '0 0 1 * *',
    'select public.auto_create_monthly_partitions()'
  );
end $autop_cron$;
