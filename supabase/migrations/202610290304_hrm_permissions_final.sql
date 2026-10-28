-- إدارة الموظفين والصلاحيات - تحسينات تلو الأخرى
-- Employee management and permissions improvements

-- 1) التأكد من وجود العمود permissions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_warehouses' AND column_name = 'permissions'
  ) THEN
    ALTER TABLE public.user_warehouses ADD COLUMN permissions jsonb DEFAULT '{}'::jsonb;
  END IF;
  
  -- تحديث القيم الفارغة
  UPDATE public.user_warehouses SET permissions = '{}'::jsonb WHERE permissions IS NULL;
END $$;

-- 2) فهرس
CREATE INDEX IF NOT EXISTS idx_user_warehouses_permissions ON public.user_warehouses USING GIN (permissions);

-- 3) صلاحيات RLS
DO $$
BEGIN
  DROP POLICY IF EXISTS "users_can_read_own_permissions" ON public.user_warehouses;
  CREATE POLICY "users_can_read_own_permissions" ON public.user_warehouses
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id OR EXISTS (
      SELECT 1 FROM public.warehouses w
      WHERE w.id = user_warehouses.warehouse_id
      AND w.manager_id = auth.uid()
    ));

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

-- 4) ربط المستخدمين الموجودة
DO $$
DECLARE
  v_warehouse_id uuid;
  v_tenant_id uuid;
  v_warehouse_count int;
BEGIN
  SELECT COUNT(*) INTO v_warehouse_count FROM public.warehouses WHERE is_main = true OR name ILIKE '%رئيس%';
  
  IF v_warehouse_count = 0 THEN
    v_tenant_id := gen_random_uuid();
    v_warehouse_id := gen_random_uuid();
    INSERT INTO public.warehouses (id, tenant_id, name, is_main, created_at)
    VALUES (v_warehouse_id, v_tenant_id, 'المخزن الرئيسي', true, now());
  ELSE
    SELECT id, tenant_id INTO v_warehouse_id, v_tenant_id 
    FROM public.warehouses 
    WHERE is_main = true OR name ILIKE '%رئيس%'
    ORDER BY is_main DESC NULLS LAST
    LIMIT 1;
  END IF;
  
  INSERT INTO public.profiles (id, role)
  SELECT DISTINCT au.id, 'manager'
  FROM auth.users au
  WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = au.id)
  ON CONFLICT (id) DO NOTHING;
  
  INSERT INTO public.user_warehouses (user_id, warehouse_id, tenant_id, is_default, permissions)
  SELECT DISTINCT au.id, v_warehouse_id, v_tenant_id, true, '{}'::jsonb
  FROM auth.users au
  WHERE NOT EXISTS (SELECT 1 FROM public.user_warehouses uw WHERE uw.user_id = au.id)
  ON CONFLICT DO NOTHING;
END $$;

-- 5) تحديث الدالة التلقائية
CREATE OR REPLACE FUNCTION public.handle_new_user_warehouse()
RETURNS TRIGGER AS $$
DECLARE
  v_tenant_id uuid;
  v_warehouse_id uuid;
  v_warehouse_count int;
BEGIN
  SELECT COUNT(*) INTO v_warehouse_count FROM public.warehouses WHERE is_main = true;
  
  IF v_warehouse_count = 0 THEN
    v_tenant_id := gen_random_uuid();
    INSERT INTO public.warehouses (id, tenant_id, name, is_main, created_at)
    VALUES (gen_random_uuid(), v_tenant_id, 'المخزن الرئيسي', true, now())
    RETURNING id, tenant_id INTO v_warehouse_id, v_tenant_id;
  ELSE
    SELECT id, tenant_id INTO v_warehouse_id, v_tenant_id 
    FROM public.warehouses 
    WHERE is_main = true 
    LIMIT 1;
  END IF;
  
  INSERT INTO public.profiles (id, role)
  VALUES (NEW.id, 'manager')
  ON CONFLICT (id) DO NOTHING;
  
  INSERT INTO public.user_warehouses (user_id, warehouse_id, permissions)
  VALUES (NEW.id, v_warehouse_id, '{}'::jsonb)
  ON CONFLICT (user_id, warehouse_id) DO NOTHING;
  
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_link_warehouse ON auth.users;
CREATE TRIGGER on_auth_user_created_link_warehouse
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_warehouse();

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, UPDATE (permissions) ON public.user_warehouses TO authenticated;
GRANT SELECT ON public.warehouses TO authenticated;
GRANT SELECT ON public.profiles TO authenticated;

COMMENT ON COLUMN public.user_warehouses.permissions IS
  'صلاحيات دقيقة لكل مستخدم داخل هذا المخزن بصيغة JSON';
