-- صلاحيات الوصول للنظام RBAC - RLS policies
-- RLS policies for RBAC system

-- 1) صلاحيات للقراءة
DO $$
BEGIN
  DROP POLICY IF EXISTS "authenticated_can_read_permissions" ON public.permissions;
  CREATE POLICY "authenticated_can_read_permissions" ON public.permissions
    FOR SELECT TO authenticated
    USING (true);

  DROP POLICY IF EXISTS "authenticated_can_read_roles" ON public.roles;
  CREATE POLICY "authenticated_can_read_roles" ON public.roles
    FOR SELECT TO authenticated
    USING (true);

  DROP POLICY IF EXISTS "authenticated_can_read_role_permissions" ON public.role_permissions;
  CREATE POLICY "authenticated_can_read_role_permissions" ON public.role_permissions
    FOR SELECT TO authenticated
    USING (true);

  DROP POLICY IF EXISTS "authenticated_can_read_user_roles" ON public.user_roles;
  CREATE POLICY "authenticated_can_read_user_roles" ON public.user_roles
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('super_admin', 'admin')
    ));

  DROP POLICY IF EXISTS "admins_can_manage_user_roles" ON public.user_roles;
  CREATE POLICY "admins_can_manage_user_roles" ON public.user_roles
    FOR ALL TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('super_admin', 'admin')
    ))
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('super_admin', 'admin')
    ));
END $$;

-- 2) ربط الصلاحيات مع user_warehouses
DO $$
BEGIN
  -- إضافة عمود رابط جديد
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_warehouses' AND column_name = 'role_id'
  ) THEN
    ALTER TABLE public.user_warehouses ADD COLUMN role_id uuid REFERENCES public.roles(id);
  END IF;
END $$;

-- 3) تحديث الصلاحيات الافتراضية
UPDATE public.user_warehouses SET role_id = (
  SELECT id FROM public.roles WHERE name = 'employee' LIMIT 1
) WHERE role_id IS NULL;

-- 4) دالة للتحقق من الصلاحية
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

-- 5) صلاحيات إضافية
GRANT EXECUTE ON FUNCTION public.has_permission(text, uuid) TO authenticated;

COMMENT ON FUNCTION public.has_permission(text, uuid) IS
  'التحقق مما إذا كان المستخدم لديه صلاحية محددة داخل مخزن معين';
