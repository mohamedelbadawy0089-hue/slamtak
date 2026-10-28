-- ربط المستخدمين الموجودين بالمخزن الرئيسي
-- Link existing users to main warehouse

DO $$
DECLARE
  v_warehouse_id uuid;
  v_tenant_id uuid;
  v_user_record RECORD;
  v_warehouse_count int;
BEGIN
  -- التحقق من وجود مستودع رئيسي
  SELECT COUNT(*) INTO v_warehouse_count FROM public.warehouses WHERE is_main = true;
  
  IF v_warehouse_count = 0 THEN
    -- إنشاء مستودع رئيسي
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
  
  -- ربط جميع المستخدمين الموجودين بدون ربط بمخزن
  FOR v_user_record IN 
    SELECT DISTINCT au.id 
    FROM auth.users au
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_warehouses uw WHERE uw.user_id = au.id
    )
  LOOP
    -- إنشاء ملف تعريف إذا لم يكن موجوداً
    INSERT INTO public.profiles (id, role)
    VALUES (v_user_record.id, 'manager')
    ON CONFLICT (id) DO NOTHING;
    
    -- ربط بالمخزن (محاولة مع الأعمدة الشائعة)
    BEGIN
      INSERT INTO public.user_warehouses (user_id, warehouse_id, is_default, tenant_id)
      VALUES (v_user_record.id, v_warehouse_id, true, v_tenant_id)
      ON CONFLICT DO NOTHING;
    EXCEPTION
      WHEN OTHERS THEN
        BEGIN
          INSERT INTO public.user_warehouses (user_id, warehouse_id)
          VALUES (v_user_record.id, v_warehouse_id)
          ON CONFLICT DO NOTHING;
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;
    END;
  END LOOP;
  
  RAISE NOTICE 'تم ربط المستخدمين بالمخزن الرئيسي بنجاح';
END $$;
