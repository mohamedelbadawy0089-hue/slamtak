-- =====================================================================================
-- 202610290332_payroll_items_engine.sql
-- محرك بنود مسير الرواتب على الخادم:
--   1) استثناء موثوق واحد في rbac_enforce: مفتاح جلسة app.rbac_system لا يضبطه إلا
--      دالة SECURITY DEFINER أدناه (لا يمكن ضبطه من الواجهة أو عبر PostgREST)،
--      ويُستخدم فقط لتحديث إجماليات المسير من بنوده.
--   2) payroll_item_compute(): صافي البند = الأساسي + البدلات − الخصومات، ويُرفض السالب.
--   3) payroll_sync_totals(): إعادة حساب إجماليات المسير بعد أي إضافة/تعديل/حذف بند.
--   4) payroll_items_lock(): بنود المسير غير قابلة للتعديل/الحذف بعد خروجه من المسودة.
--   5) payroll_runs_immutable(): لا تغيير للفترة أو الإجماليات في مسير معتمد/مدفوع.
--   6) فهرس على payroll_items(payroll_run_id).
-- آمن للتشغيل المتكرر.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1) rbac_enforce: نفس المنطق + استثناء النظام الموثوق
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rbac_enforce()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_module text := coalesce(nullif(TG_ARGV[0], ''), '');
  v_perm   text := nullif(TG_ARGV[1], '');
  v_action text;
  v_wh     uuid;
  v_row    jsonb;
  v_known  boolean;
BEGIN
  -- بلا جلسة مستخدم: service_role أو مهمة خلفية أو هجرة
  IF auth.uid() IS NULL OR v_module = '' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- استثناء محصور: عمليات نظامية داخل دوال SECURITY DEFINER (مزامنة إجماليات الرواتب)
  IF coalesce(current_setting('app.rbac_system', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;

  BEGIN
    v_wh := nullif(v_row ->> 'warehouse_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_wh := NULL;
  END;

  v_action := CASE TG_OP
                WHEN 'INSERT' THEN 'create'
                WHEN 'UPDATE' THEN 'update'
                WHEN 'DELETE' THEN 'delete'
                ELSE lower(TG_OP)
              END;
  v_perm := coalesce(v_perm, v_module || '.' || v_action);

  SELECT EXISTS (SELECT 1 FROM public.permissions p WHERE p.name = public.rbac_normalize(v_perm))
    INTO v_known;
  IF NOT v_known THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF public.has_permission(v_perm, v_wh) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  RAISE EXCEPTION 'غير مصرح: % على % تتطلب صلاحية %', v_action, TG_TABLE_NAME, v_perm
    USING ERRCODE = '42501',
          HINT = 'اطلب من مدير المخزن منحك هذه الصلاحية من صفحة الأدوار والصلاحيات.';
END
$fn$;

-- -------------------------------------------------------------------------------------
-- 2) صافي البند يُحسب على الخادم (لا يُقبل من الواجهة كمصدر ثقة)
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_item_compute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  NEW.net_salary := coalesce(NEW.base_salary, 0)
                    + coalesce(NEW.allowances, 0)
                    - coalesce(NEW.deductions, 0);

  IF NEW.net_salary < 0 THEN
    RAISE EXCEPTION 'صافي بند الراتب سالب (%): الخصومات أكبر من الأساسي + البدلات', NEW.net_salary
      USING ERRCODE = '23514',
            HINT = 'راجع مبالغ البند قبل الحفظ.';
  END IF;

  RETURN NEW;
END
$fn$;

-- -------------------------------------------------------------------------------------
-- 3) إجماليات المسير تُشتق من بنوده فقط
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_sync_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_run   uuid := coalesce(NEW.payroll_run_id, OLD.payroll_run_id);
  v_gross numeric(14,2) := 0;
  v_ded   numeric(14,2) := 0;
  v_net   numeric(14,2) := 0;
BEGIN
  SELECT coalesce(sum(coalesce(base_salary,0) + coalesce(allowances,0)), 0),
         coalesce(sum(coalesce(deductions,0)), 0),
         coalesce(sum(coalesce(net_salary,0)), 0)
    INTO v_gross, v_ded, v_net
    FROM public.payroll_items
   WHERE payroll_run_id = v_run;

  PERFORM set_config('app.rbac_system', 'on', true);
  UPDATE public.payroll_runs
     SET total_gross      = v_gross,
         total_deductions = v_ded,
         total_net        = v_net,
         updated_at       = now()
   WHERE id = v_run;
  PERFORM set_config('app.rbac_system', '', true);

  RETURN NULL;
END
$fn$;

-- -------------------------------------------------------------------------------------
-- 4) قفل بنود المسير بعد المسودة
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_items_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_run    uuid := coalesce(NEW.payroll_run_id, OLD.payroll_run_id);
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.payroll_runs WHERE id = v_run;

  -- صف الأب غير موجود ⇒ حذف متسلسل للمسير نفسه؛ اتركه للمفتاح الأجنبي
  IF v_status IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'مسير الرواتب مقفل (%). لا يمكن إضافة أو تعديل أو حذف بنوده بعد الاعتماد أو الدفع.', v_status
      USING ERRCODE = '42501',
            HINT = 'أنشئ تسوية موثقة بدل تعديل مسير معتمد.';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$fn$;

-- -------------------------------------------------------------------------------------
-- 5) لا تغيير للفترة أو الإجماليات بعد الاعتماد/الدفع
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_runs_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF OLD.status NOT IN ('approved', 'paid') THEN
    RETURN NEW;
  END IF;

  IF NEW.period_start    IS DISTINCT FROM OLD.period_start
     OR NEW.period_end      IS DISTINCT FROM OLD.period_end
     OR NEW.total_gross     IS DISTINCT FROM OLD.total_gross
     OR NEW.total_deductions IS DISTINCT FROM OLD.total_deductions
     OR NEW.total_net       IS DISTINCT FROM OLD.total_net THEN
    RAISE EXCEPTION 'مسير رواتب مقفل (%): لا يمكن تعديل الفترة أو الإجماليات بعد الاعتماد', OLD.status
      USING ERRCODE = '42501',
            HINT = 'استخدم مستندًا تصحيحيًا أو تسوية موثقة.';
  END IF;

  RETURN NEW;
END
$fn$;

-- -------------------------------------------------------------------------------------
-- 6) تركيب المُشغّلات والفهرس
-- -------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_payroll_items_run ON public.payroll_items (payroll_run_id);

DROP TRIGGER IF EXISTS payroll_items_compute ON public.payroll_items;
CREATE TRIGGER payroll_items_compute
  BEFORE INSERT OR UPDATE ON public.payroll_items
  FOR EACH ROW EXECUTE FUNCTION public.payroll_item_compute();

DROP TRIGGER IF EXISTS payroll_items_lock ON public.payroll_items;
CREATE TRIGGER payroll_items_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_items
  FOR EACH ROW EXECUTE FUNCTION public.payroll_items_lock();

DROP TRIGGER IF EXISTS payroll_items_sync ON public.payroll_items;
CREATE TRIGGER payroll_items_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.payroll_items
  FOR EACH ROW EXECUTE FUNCTION public.payroll_sync_totals();

DROP TRIGGER IF EXISTS payroll_runs_immutable ON public.payroll_runs;
CREATE TRIGGER payroll_runs_immutable
  BEFORE UPDATE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.payroll_runs_immutable();

-- دوال المُشغّلات لا تُستدعى مباشرة
REVOKE ALL ON FUNCTION public.payroll_item_compute()     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_sync_totals()      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_items_lock()       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_runs_immutable()   FROM PUBLIC;

-- -------------------------------------------------------------------------------------
-- 7) ملخّص
-- -------------------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('payroll_items_compute','payroll_items_lock','payroll_items_sync','payroll_runs_immutable')
      AND NOT tgisinternal) AS payroll_triggers,
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'ix_payroll_items_run') AS run_index,
  (SELECT count(*) FROM public.permissions WHERE is_enforced) AS enforced_perms;
