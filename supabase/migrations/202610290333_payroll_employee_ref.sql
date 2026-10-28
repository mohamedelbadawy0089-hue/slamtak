-- =====================================================================================
-- 202610290333_payroll_employee_ref.sql
-- إصلاح مرجع الموظف في بنود الرواتب.
--
-- المشكلة: payroll_items.employee_id كان يشير إلى public.employees، وهو جدول قديم
-- لا يحتوي أي صفوف في قاعدة البيانات الحيّة، ويتطلب user_id إلزاميًا مرتبطًا بـ profiles.
-- بينما سجل الموظفين الفعلي المستخدم في الواجهة هو public.warehouse_employees
-- (الاسم الكامل، اسم المستخدم، الدور، الصلاحيات، الحالة).
--
-- النتيجة: لا يمكن عمليًا إنشاء بند راتب لأي موظف. الإصلاح: نقل المفتاح الأجنبي إلى
-- warehouse_employees(id) — آمن لأن payroll_items فارغ (يُتحقق من ذلك قبل التنفيذ).
-- =====================================================================================

DO $mig$
DECLARE
  v_items int;
BEGIN
  SELECT count(*) INTO v_items FROM public.payroll_items;
  IF v_items > 0 THEN
    RAISE EXCEPTION 'الجدول payroll_items يحتوي % صفًا؛ راجع المراجع يدويًا قبل نقل المفتاح الأجنبي', v_items
      USING ERRCODE = '0A000';
  END IF;

  ALTER TABLE public.payroll_items DROP CONSTRAINT IF EXISTS payroll_items_employee_id_fkey;
  ALTER TABLE public.payroll_items DROP CONSTRAINT IF EXISTS payroll_items_employee_fkey;

  ALTER TABLE public.payroll_items
    ADD CONSTRAINT payroll_items_employee_fkey
    FOREIGN KEY (employee_id) REFERENCES public.warehouse_employees(id) ON DELETE RESTRICT;
END
$mig$;

CREATE INDEX IF NOT EXISTS ix_payroll_items_employee ON public.payroll_items (employee_id);

SELECT
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'payroll_items_employee_fkey') AS employee_fk,
  (SELECT count(*) FROM public.warehouse_employees) AS staff_rows;
