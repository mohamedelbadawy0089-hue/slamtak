-- 202610290314_rbac_read_policies.sql
-- سياسات قراءة آمنة تسمح للواجهة بحساب صلاحيات المستخدم فعليًا:
--   user_warehouses (عضويته) ← role_id ← role_permissions ← permissions
-- بدون هذه السياسات تُرجع role_permissions صفر صفوف لمستخدم authenticated
-- (RLS مفعّل بدون أي سياسة) فتظهر الواجهة بلا أي صلاحية.
-- لا تفتح أي كتابة جديدة: كل السياسات هنا للقراءة فقط.

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.permissions      TO authenticated;
GRANT SELECT ON public.roles            TO authenticated;
GRANT SELECT ON public.role_permissions TO authenticated;
GRANT SELECT ON public.user_roles       TO authenticated;

-- 1) الصلاحيات والأدوار وروابطها: مرجع عام غير حساس للقراءة فقط
DROP POLICY IF EXISTS rb_permissions_read ON public.permissions;
CREATE POLICY rb_permissions_read ON public.permissions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS rb_roles_read ON public.roles;
CREATE POLICY rb_roles_read ON public.roles
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS rb_role_permissions_read ON public.role_permissions;
CREATE POLICY rb_role_permissions_read ON public.role_permissions
  FOR SELECT TO authenticated USING (true);

-- 2) عضوية المخازن: المستخدم يرى عضويته، ومدير المخزن/المدير العام يرى مخزنه
DROP POLICY IF EXISTS rb_user_warehouses_read ON public.user_warehouses;
CREATE POLICY rb_user_warehouses_read ON public.user_warehouses
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.warehouses w
       WHERE w.id = user_warehouses.warehouse_id
         AND w.manager_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid()
         AND p.role IN ('super_admin', 'admin', 'owner')
    )
  );

-- 3) أدوار المستخدمين: المستخدم يرى أدواره
DROP POLICY IF EXISTS rb_user_roles_read_own ON public.user_roles;
CREATE POLICY rb_user_roles_read_own ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 4) تحقق: وجود السياسات المطلوبة
DO $do$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(x.tbl || '.' || x.pol, ', ') INTO v_missing
    FROM (VALUES ('permissions', 'rb_permissions_read'),
                 ('roles', 'rb_roles_read'),
                 ('role_permissions', 'rb_role_permissions_read'),
                 ('user_warehouses', 'rb_user_warehouses_read'),
                 ('user_roles', 'rb_user_roles_read_own')) AS x(tbl, pol)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename  = x.tbl
        AND p.policyname = x.pol
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'سياسات مفقودة بعد الإنشاء: %', v_missing;
  END IF;

  RAISE NOTICE 'سياسات القراءة للصلاحيات جاهزة';
END
$do$;
