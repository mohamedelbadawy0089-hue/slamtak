-- صلاحيات الوصول للصلاحيات (RLS policies)
-- RLS policies for permissions

-- 1) ضمان وجود عمود permissions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_warehouses' AND column_name = 'permissions'
  ) THEN
    ALTER TABLE public.user_warehouses ADD COLUMN permissions jsonb DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- 2) تحديث القيم الفارغة
UPDATE public.user_warehouses SET permissions = '{}'::jsonb WHERE permissions IS NULL;

-- 3) سياسات RLS للصلاحيات
DO $$
BEGIN
  -- سياسة لقراءة الصلاحيات الخاصة بالمستخدم
  DROP POLICY IF EXISTS "users_can_read_own_permissions" ON public.user_warehouses;
  CREATE POLICY "users_can_read_own_permissions" ON public.user_warehouses
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id OR EXISTS (
      SELECT 1 FROM public.warehouses w
      WHERE w.id = user_warehouses.warehouse_id
      AND w.manager_id = auth.uid()
    ));

  -- سياسة لتحديث الصلاحيات (فقط للمديرين)
  DROP POLICY IF EXISTS "admins_can_update_permissions" ON public.user_warehouses;
  CREATE POLICY "admins_can_update_permissions" ON public.user_warehouses
    FOR UPDATE TO authenticated
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

-- 4) ملاحظات
COMMENT ON COLUMN public.user_warehouses.permissions IS
  'صلاحيات دقيقة لكل مستخدم داخل هذا المخزن بصيغة JSON';
