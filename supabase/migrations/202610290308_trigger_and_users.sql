-- الربط التلقائي للمستخدمين وتحديثات الدوال
-- Auto-link users and function updates

-- 1) تحديث دالة الربط التلقائي
CREATE OR REPLACE FUNCTION public.handle_new_user_warehouse()
RETURNS TRIGGER AS $$
DECLARE
  v_tenant_id uuid;
  v_warehouse_id uuid;
  v_warehouse_count int;
  v_role_id uuid;
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
  
  -- الحصول على دور افتراضي
  SELECT id INTO v_role_id FROM public.roles WHERE name = 'employee' LIMIT 1;
  
  IF v_role_id IS NULL THEN
    v_role_id := (SELECT id FROM public.roles LIMIT 1);
  END IF;
  
  -- ربط المستخدم بالمخزن مع الصلاحيات
  INSERT INTO public.user_warehouses (user_id, warehouse_id, permissions, role_id)
  VALUES (NEW.id, v_warehouse_id, '{}'::jsonb, v_role_id)
  ON CONFLICT (user_id, warehouse_id) DO NOTHING;
  
  -- إنشاء دخول افتراضي في user_roles
  IF v_role_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, warehouse_id, role_id)
    VALUES (NEW.id, v_warehouse_id, v_role_id)
    ON CONFLICT (user_id, warehouse_id, role_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2) إعادة إنشاء المشغل
DROP TRIGGER IF EXISTS on_auth_user_created_link_warehouse ON auth.users;
CREATE TRIGGER on_auth_user_created_link_warehouse
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_warehouse();

-- 3) ربط المستخدمين الموجودة
DO $$
DECLARE
  v_warehouse_id uuid;
  v_tenant_id uuid;
  v_warehouse_count int;
  v_role_id uuid;
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
  
  -- ملفات تعريف
  INSERT INTO public.profiles (id, role)
  SELECT DISTINCT au.id, 'manager'
  FROM auth.users au
  WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = au.id)
  ON CONFLICT (id) DO NOTHING;
  
  -- الحصول على الدور الافتراضي
  SELECT id INTO v_role_id FROM public.roles WHERE name = 'employee' LIMIT 1;
  IF v_role_id IS NULL THEN
    SELECT id INTO v_role_id FROM public.roles LIMIT 1;
  END IF;
  
  -- الربط مع الصلاحيات
  INSERT INTO public.user_warehouses (user_id, warehouse_id, permissions, role_id)
  SELECT DISTINCT au.id, v_warehouse_id, '{}'::jsonb, v_role_id
  FROM auth.users au
  WHERE NOT EXISTS (SELECT 1 FROM public.user_warehouses uw WHERE uw.user_id = au.id)
  ON CONFLICT DO NOTHING;
  
  -- user_roles
  IF v_role_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, warehouse_id, role_id, assigned_by)
    SELECT DISTINCT au.id, v_warehouse_id, v_role_id, au.id
    FROM auth.users au
    WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = au.id AND ur.warehouse_id = v_warehouse_id)
    ON CONFLICT (user_id, warehouse_id, role_id) DO NOTHING;
  END IF;
END $$;

-- 4) صلاحيات إضافية
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_warehouses TO authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(text, uuid) TO authenticated;

-- 5) ملاحظات
COMMENT ON TRIGGER on_auth_user_created_link_warehouse ON auth.users IS
  'يربط المستخدم الجديد تلقائياً بالمخزن الرئيسي ويمنحه دوراً افتراضياً';
