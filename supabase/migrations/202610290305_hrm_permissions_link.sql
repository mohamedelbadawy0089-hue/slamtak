-- ربط الفوري للمستخدمين الموجودة وإضافة الصلاحيات
-- Link existing users and add permissions

DO $$
DECLARE
  v_warehouse_id uuid;
  v_tenant_id uuid;
  v_warehouse_count int;
BEGIN
  -- التحقق من وجود مستودع رئيسي
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
  
  -- إنشاء ملفات تعريف وربط من auth.users
  INSERT INTO public.profiles (id, role)
  SELECT DISTINCT au.id, 'manager'
  FROM auth.users au
  WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = au.id)
  ON CONFLICT (id) DO NOTHING;
  
  -- ربط من auth.users مع الصلاحيات
  INSERT INTO public.user_warehouses (user_id, warehouse_id, tenant_id, is_default, permissions)
  SELECT DISTINCT au.id, v_warehouse_id, v_tenant_id, true, '{}'::jsonb
  FROM auth.users au
  WHERE NOT EXISTS (SELECT 1 FROM public.user_warehouses uw WHERE uw.user_id = au.id)
  ON CONFLICT DO NOTHING;
  
  RAISE NOTICE 'تم الربط بنجاح';
END $$;

-- تحديث الصلاحيات للصفوف الموجودة
UPDATE public.user_warehouses SET permissions = '{}'::jsonb WHERE permissions IS NULL;
