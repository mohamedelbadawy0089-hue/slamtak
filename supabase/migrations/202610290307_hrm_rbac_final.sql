-- نظام الصلاحيات المخصصة - دمج نهائي
-- Dedicated permissions system - final integration

-- 1) جدول الصلاحيات
CREATE TABLE IF NOT EXISTS public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  category text NOT NULL DEFAULT 'general',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2) جدول الأدوار
CREATE TABLE IF NOT EXISTS public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3) جدول تعيينات الصلاحيات للأدوار
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- 4) جدول تعيينات الأدوار للمستخدمين
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, warehouse_id, role_id)
);

-- 5) بيانات افتراضية
INSERT INTO public.roles (name, description, is_system) VALUES
  ('super_admin', 'مدير النظام - صلاحيات كاملة', true),
  ('admin', 'مدير المخزن - صلاحيات إدارية', true),
  ('manager', 'مدير القسم - صلاحيات محدودة', true),
  ('employee', 'موظف - صلاحيات أساسية', true),
  ('viewer', 'مشاهد فقط - صلاحيات القراءة', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.permissions (name, description, category) VALUES
  ('employees.manage', 'إدارة الموظفين', 'hr'),
  ('employees.view', 'عرض الموظفين', 'hr'),
  ('sales.manage', 'إدارة المبيعات', 'sales'),
  ('sales.view', 'عرض المبيعات', 'sales'),
  ('purchases.manage', 'إدارة المشتريات', 'purchases'),
  ('purchases.view', 'عرض المشتريات', 'purchases'),
  ('inventory.manage', 'إدارة المخزون', 'inventory'),
  ('inventory.view', 'عرض المخزون', 'inventory'),
  ('warehouse.manage', 'إدارة المخازن', 'warehouse'),
  ('warehouse.view', 'عرض المخازن', 'warehouse'),
  ('settings.manage', 'إدارة الإعدادات', 'settings'),
  ('reports.view', 'عرض التقارير', 'reports')
ON CONFLICT DO NOTHING;

-- 6) تعيين الصلاحيات الافتراضية
DO $$
DECLARE
  v_super_admin uuid;
  v_admin uuid;
  v_manager uuid;
  v_employee uuid;
  v_viewer uuid;
BEGIN
  SELECT id INTO v_super_admin FROM public.roles WHERE name = 'super_admin' LIMIT 1;
  SELECT id INTO v_admin FROM public.roles WHERE name = 'admin' LIMIT 1;
  SELECT id INTO v_manager FROM public.roles WHERE name = 'manager' LIMIT 1;
  SELECT id INTO v_employee FROM public.roles WHERE name = 'employee' LIMIT 1;
  SELECT id INTO v_viewer FROM public.roles WHERE name = 'viewer' LIMIT 1;

  IF v_super_admin IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_super_admin, id FROM public.permissions
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_admin IS NOT NULL OR v_manager IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT unnest(ARRAY[v_admin, v_manager]), id FROM public.permissions
    WHERE category != 'settings'
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_employee IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_employee, id FROM public.permissions
    WHERE category IN ('hr', 'sales', 'purchases', 'inventory')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_viewer IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_viewer, id FROM public.permissions
    WHERE name LIKE '%view'
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- 7) صلاحيات RLS
DO $$
BEGIN
  DROP POLICY IF EXISTS "authenticated_can_read_permissions" ON public.permissions;
  CREATE POLICY "authenticated_can_read_permissions" ON public.permissions
    FOR SELECT TO authenticated USING (true);

  DROP POLICY IF EXISTS "authenticated_can_read_roles" ON public.roles;
  CREATE POLICY "authenticated_can_read_roles" ON public.roles
    FOR SELECT TO authenticated USING (true);

  DROP POLICY IF EXISTS "authenticated_can_read_role_permissions" ON public.role_permissions;
  CREATE POLICY "authenticated_can_read_role_permissions" ON public.role_permissions
    FOR SELECT TO authenticated USING (true);

  DROP POLICY IF EXISTS "authenticated_can_read_user_roles" ON public.user_roles;
  CREATE POLICY "authenticated_can_read_user_roles" ON public.user_roles
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'admin')
    ));

  DROP POLICY IF EXISTS "admins_can_manage_user_roles" ON public.user_roles;
  CREATE POLICY "admins_can_manage_user_roles" ON public.user_roles
    FOR ALL TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'admin')
    ))
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'admin')
    ));
END $$;

-- 8) دالة التحقق من الصلاحية
CREATE OR REPLACE FUNCTION public.has_permission(p_permission text, p_warehouse_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_warehouses uw
    JOIN public.user_roles ur ON uw.user_id = ur.user_id
    JOIN public.role_permissions rp ON ur.role_id = rp.role_id
    JOIN public.permissions p ON rp.permission_id = p.id
    WHERE uw.user_id = auth.uid()
      AND uw.warehouse_id = p_warehouse_id
      AND p.name = p_permission
      AND ur.is_active = true
  )
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('super_admin', 'admin')
  );
$$;

-- 9) تحديث user_warehouses
ALTER TABLE public.user_warehouses ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.roles(id);

UPDATE public.user_warehouses SET role_id = (
  SELECT id FROM public.roles WHERE name = 'employee' LIMIT 1
) WHERE role_id IS NULL;

-- 10) صلاحيات إضافية
GRANT SELECT ON public.permissions TO authenticated;
GRANT SELECT ON public.roles TO authenticated;
GRANT SELECT ON public.role_permissions TO authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(text, uuid) TO authenticated;

COMMENT ON TABLE public.permissions IS 'الصلاحيات المخصصة للنظام';
COMMENT ON TABLE public.roles IS 'أدوار المستخدمين في النظام';
COMMENT ON TABLE public.role_permissions IS 'تعيين الصلاحيات للأدوار';
COMMENT ON TABLE public.user_roles IS 'تعيين الأدوار للمستخدمين داخل كل مخزن';
COMMENT ON FUNCTION public.has_permission(text, uuid) IS 'التحقق مما إذا كان المستخدم لديه صلاحية محددة داخل مخزن معين';
