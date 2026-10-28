-- =====================================================================================
-- 202610290334_payroll_staff_read.sql
-- سياسة قراءة إضافية لسجل الموظفين داخل نطاق الرواتب.
--
-- السبب: سياسة warehouse_employees_read الحالية تسمح بالقراءة للموظف نفسه أو لمدير المخزن
-- فقط. فمستخدم يملك payroll.view (ولا يدير المخزن) كان يرى بنود الرواتب بأرقام موظفين
-- بلا أسماء، ولا يستطيع اختيار موظف عند إضافة بند.
--
-- الإضافة: قراءة سجل الموظفين لمن يملك payroll.view في نفس المخزن. لا تمنح أي صلاحية
-- كتابة، ولا تتجاوز سياسة القراءة الحالية (السياسات permissive تتجمع، والفرض على
-- payroll_items نفسه يبقى كما هو).
-- آمن للتشغيل المتكرر.
-- =====================================================================================

DROP POLICY IF EXISTS warehouse_employees_payroll_read ON public.warehouse_employees;
CREATE POLICY warehouse_employees_payroll_read ON public.warehouse_employees
  FOR SELECT TO authenticated
  USING (public.has_permission('payroll.view', warehouse_id));

SELECT count(*) AS staff_select_policies
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'warehouse_employees' AND cmd = 'SELECT';
