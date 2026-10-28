-- =====================================================================================
-- 202610290335_payroll_settlements.sql
-- تسويات موثقة لمسيرات الرواتب المعتمدة أو المدفوعة.
--
-- المشكلة التي يحلها: مُشغّل payroll_runs_immutable يمنع تغيير إجماليات المسير بعد
-- الاعتماد (وهذا مطلوب)، ومُشغّل payroll_items_lock يمنع تعديل بنوده. بدون مستند
-- تصحيحي يصبح أي خطأ في مسير معتمد غير قابل للمعالجة.
--
-- الحل: جدول payroll_settlements + دالة payroll_run_settle():
--   * التسوية مستند مستقل (مبلغ موقّع + سبب إلزامي + منشئ + وقت) ولا تُعدّل ولا تُحذف.
--   * صافي المسير = صافي البنود + مجموع التسويات (يُعاد حسابه على الخادم).
--   * تُقبل فقط على مسير معتمد/مدفوع، وبصلاحية payroll.approve على مخزن المسير.
--   * الكتابة المباشرة على الجدول ممنوعة (RLS بلا سياسات كتابة)؛ التسوية تمر بالدالة فقط.
--   * كل تسوية تُسجّل في audit_logs.
-- آمن للتشغيل المتكرر.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1) مخزن المسير (لدعم سياسة RLS دون استعلام متداخل على نفس الجدول)
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_run_warehouse(p_run uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT warehouse_id FROM public.payroll_runs WHERE id = p_run;
$fn$;

-- -------------------------------------------------------------------------------------
-- 2) جدول التسويات
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_settlements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  employee_id    uuid REFERENCES public.warehouse_employees(id) ON DELETE SET NULL,
  kind           text NOT NULL CHECK (kind IN ('bonus','deduction','correction')),
  amount         numeric(14,2) NOT NULL,
  reason         text NOT NULL,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_settlement_amount_nonzero CHECK (amount <> 0),
  CONSTRAINT payroll_settlement_kind_sign CHECK (
    (kind = 'bonus'      AND amount > 0) OR
    (kind = 'deduction'  AND amount < 0) OR
    (kind = 'correction' AND amount <> 0)
  ),
  CONSTRAINT payroll_settlement_reason CHECK (
    char_length(btrim(reason)) >= 5 AND char_length(reason) <= 500
  )
);

CREATE INDEX IF NOT EXISTS ix_payroll_settlements_run
  ON public.payroll_settlements (payroll_run_id);
CREATE INDEX IF NOT EXISTS ix_payroll_settlements_employee
  ON public.payroll_settlements (employee_id);

ALTER TABLE public.payroll_settlements ENABLE ROW LEVEL SECURITY;

-- قراءة فقط لمن يملك payroll.view على مخزن المسير
DROP POLICY IF EXISTS payroll_settlements_read ON public.payroll_settlements;
CREATE POLICY payroll_settlements_read ON public.payroll_settlements
  FOR SELECT TO authenticated
  USING (public.has_permission('payroll.view', public.payroll_run_warehouse(payroll_run_id)));

-- لا سياسات INSERT/UPDATE/DELETE عن قصد: التسوية تُنشأ عبر payroll_run_settle فقط،
-- وبذلك لا يستطيع العميل تزوير مبلغ أو منشئ أو تجاوز فحص الحالة والصلاحية.
DROP POLICY IF EXISTS payroll_settlements_no_write ON public.payroll_settlements;

-- -------------------------------------------------------------------------------------
-- 3) إعادة حساب الإجماليات = بنود + تسويات (دالة واحدة تُستخدم من كل المسارات)
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_recalc_totals(p_run uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_gross numeric(14,2) := 0;
  v_ded   numeric(14,2) := 0;
  v_base  numeric(14,2) := 0;
  v_adj   numeric(14,2) := 0;
  v_net   numeric(14,2) := 0;
BEGIN
  SELECT coalesce(sum(coalesce(base_salary, 0) + coalesce(allowances, 0)), 0),
         coalesce(sum(coalesce(deductions, 0)), 0),
         coalesce(sum(coalesce(net_salary, 0)), 0)
    INTO v_gross, v_ded, v_base
    FROM public.payroll_items
   WHERE payroll_run_id = p_run;

  SELECT coalesce(sum(amount), 0)
    INTO v_adj
    FROM public.payroll_settlements
   WHERE payroll_run_id = p_run;

  v_net := v_base + v_adj;

  IF v_net < 0 THEN
    RAISE EXCEPTION 'صافي المسير يصبح سالبًا (%): التسويات الخصمية أكبر من المستحق', v_net
      USING ERRCODE = '23514',
            HINT = 'قلّل مبلغ الخصم أو سجّل مكافأة/تصحيحًا مقابلًا.';
  END IF;

  -- استثناء موثوق ومحصور: المفتاح لا يُضبط من العميل ولا عبر PostgREST
  PERFORM set_config('app.rbac_system', 'on', true);
  UPDATE public.payroll_runs
     SET total_gross      = v_gross,
         total_deductions = v_ded,
         total_net        = v_net,
         updated_at       = now()
   WHERE id = p_run;
  PERFORM set_config('app.rbac_system', '', true);
END
$fn$;

-- مزامنة البنود تمر بالدالة المشتركة (لتشمل التسويات دائمًا)
CREATE OR REPLACE FUNCTION public.payroll_sync_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM public.payroll_recalc_totals(coalesce(NEW.payroll_run_id, OLD.payroll_run_id));
  RETURN NULL;
END
$fn$;

-- -------------------------------------------------------------------------------------
-- 4) ثبات المسير المعتمد: يبقى ممنوعًا إلا داخل دالة نظامية موثوقة
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

  -- المفتاح يُضبط فقط داخل payroll_recalc_totals (SECURITY DEFINER)
  IF coalesce(current_setting('app.rbac_system', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.period_start     IS DISTINCT FROM OLD.period_start
     OR NEW.period_end       IS DISTINCT FROM OLD.period_end
     OR NEW.total_gross      IS DISTINCT FROM OLD.total_gross
     OR NEW.total_deductions IS DISTINCT FROM OLD.total_deductions
     OR NEW.total_net        IS DISTINCT FROM OLD.total_net THEN
    RAISE EXCEPTION 'مسير رواتب مقفل (%): لا يمكن تعديل الفترة أو الإجماليات بعد الاعتماد', OLD.status
      USING ERRCODE = '42501',
            HINT = 'استخدم تسوية موثقة (payroll_run_settle) بدل تعديل المسير.';
  END IF;

  RETURN NEW;
END
$fn$;

-- -------------------------------------------------------------------------------------
-- 5) دالة تسجيل التسوية
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_run_settle(
  p_run      uuid,
  p_amount   numeric,
  p_reason   text,
  p_employee uuid DEFAULT NULL,
  p_kind     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor  uuid := auth.uid();
  v_wh     uuid;
  v_status text;
  v_tenant uuid;
  v_emp_wh uuid;
  v_kind   text;
  v_amount numeric(14,2);
  v_id     uuid;
  v_net    numeric(14,2);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'تسجيل التسوية يتطلب جلسة مستخدم' USING ERRCODE = '42501';
  END IF;

  SELECT warehouse_id, tenant_id, status
    INTO v_wh, v_tenant, v_status
    FROM public.payroll_runs
   WHERE id = p_run
     FOR UPDATE;

  IF v_wh IS NULL THEN
    RAISE EXCEPTION 'مسير الرواتب غير موجود' USING ERRCODE = 'P0002';
  END IF;

  IF v_status NOT IN ('approved', 'paid') THEN
    RAISE EXCEPTION 'التسويات تُسجل على مسير معتمد أو مدفوع فقط (الحالة الحالية: %)', v_status
      USING ERRCODE = '23514',
            HINT = 'عدّل بنود المسودة مباشرة قبل الاعتماد.';
  END IF;

  IF NOT public.has_permission('payroll.approve', v_wh) THEN
    RAISE EXCEPTION 'غير مصرح: تسوية مسير معتمد تتطلب صلاحية payroll.approve'
      USING ERRCODE = '42501',
            HINT = 'اطلب من مدير المخزن منحك صلاحية اعتماد الرواتب.';
  END IF;

  IF p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'مبلغ التسوية يجب أن يكون غير صفري' USING ERRCODE = '23514';
  END IF;

  v_amount := round(p_amount, 2);
  IF v_amount = 0 THEN
    RAISE EXCEPTION 'مبلغ التسوية يقرّب إلى صفر؛ أدخل مبلغًا أكبر' USING ERRCODE = '23514';
  END IF;

  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'سبب التسوية إلزامي (5 أحرف على الأقل)' USING ERRCODE = '23514';
  END IF;

  IF p_employee IS NOT NULL THEN
    SELECT e.warehouse_id INTO v_emp_wh
      FROM public.warehouse_employees e WHERE e.id = p_employee;
    IF v_emp_wh IS NULL THEN
      RAISE EXCEPTION 'الموظف غير موجود في سجل الموظفين' USING ERRCODE = 'P0002';
    END IF;
    IF v_emp_wh <> v_wh THEN
      RAISE EXCEPTION 'الموظف تابع لمخزن آخر ولا يمكن ربطه بتسوية هذا المسير'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_kind := coalesce(nullif(btrim(coalesce(p_kind, '')), ''),
                     CASE WHEN v_amount > 0 THEN 'bonus' ELSE 'deduction' END);

  INSERT INTO public.payroll_settlements (payroll_run_id, employee_id, kind, amount, reason, created_by)
  VALUES (p_run, p_employee, v_kind, v_amount, btrim(p_reason), v_actor)
  RETURNING id INTO v_id;

  PERFORM public.payroll_recalc_totals(p_run);
  SELECT total_net INTO v_net FROM public.payroll_runs WHERE id = p_run;

  INSERT INTO public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
  VALUES (v_tenant, v_actor, v_wh, 'payroll_settlement_created', 'payroll_settlements', v_id,
          jsonb_build_object('payroll_run_id', p_run, 'employee_id', p_employee, 'kind', v_kind,
                             'amount', v_amount, 'reason', btrim(p_reason), 'total_net', v_net));

  RETURN jsonb_build_object('settlement_id', v_id, 'kind', v_kind, 'amount', v_amount, 'total_net', v_net);
END
$fn$;

-- التسوية لا تُعدّل ولا تُحذف من أي مسار
CREATE OR REPLACE FUNCTION public.payroll_settlement_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- الحذف مسموح فقط مع حذف المسير نفسه (CASCADE)؛ لا حذف فردي ولا تعديل
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.payroll_runs WHERE id = OLD.payroll_run_id) THEN
      RAISE EXCEPTION 'التسويات الموثقة لا تُحذف؛ سجّل تسوية عكسية بدل الحذف'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'التسويات الموثقة غير قابلة للتعديل؛ سجّل تسوية تصحيحية'
    USING ERRCODE = '42501';
END
$fn$;

DROP TRIGGER IF EXISTS payroll_settlements_immutable ON public.payroll_settlements;
CREATE TRIGGER payroll_settlements_immutable
  BEFORE UPDATE OR DELETE ON public.payroll_settlements
  FOR EACH ROW EXECUTE FUNCTION public.payroll_settlement_immutable();

-- -------------------------------------------------------------------------------------
-- 6) الصلاحيات
-- -------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.payroll_recalc_totals(uuid)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_sync_totals()        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_runs_immutable()     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_settlement_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_run_settle(uuid, numeric, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_run_settle(uuid, numeric, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_run_warehouse(uuid) TO authenticated;

-- -------------------------------------------------------------------------------------
-- 7) ملخّص
-- -------------------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('payroll_settlements_immutable','payroll_items_sync','payroll_runs_immutable')
      AND NOT tgisinternal) AS triggers_ready,
  (SELECT count(*) FROM pg_policy WHERE polname = 'payroll_settlements_read') AS settlement_read_policy,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payroll_settlements') AS settlement_columns;
