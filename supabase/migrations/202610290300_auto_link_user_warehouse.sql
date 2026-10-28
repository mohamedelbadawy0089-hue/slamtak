-- ربط تلقائي للمستخدم بالمخزن عند إنشاء حساب جديد
-- Auto-link user to warehouse on signup

-- إنشاء دالة لربط المستخدم بالمخزن تلقائياً
CREATE OR REPLACE FUNCTION public.handle_new_user_warehouse()
RETURNS TRIGGER AS $$
DECLARE
  v_tenant_id uuid;
  v_warehouse_id uuid;
  v_warehouse_count int;
BEGIN
  -- التحقق من وجود مستودع افتراضي
  SELECT COUNT(*) INTO v_warehouse_count FROM public.warehouses WHERE is_main = true;
  
  IF v_warehouse_count = 0 THEN
    -- إنشاء tenant افتراضي
    v_tenant_id := gen_random_uuid();
    
    -- إنشاء مستودع افتراضي
    INSERT INTO public.warehouses (id, tenant_id, name, is_main, created_at)
    VALUES (gen_random_uuid(), v_tenant_id, 'المخزن الرئيسي', true, now())
    RETURNING id, tenant_id INTO v_warehouse_id, v_tenant_id;
    
    -- إنشاء ملف تعريف للمستخدم إذا لم يكن موجوداً
    INSERT INTO public.profiles (id, role)
    VALUES (NEW.id, 'manager')
    ON CONFLICT (id) DO NOTHING;
    
    -- ربط المستخدم بالمخزن
    INSERT INTO public.user_warehouses (user_id, warehouse_id)
    VALUES (NEW.id, v_warehouse_id)
    ON CONFLICT DO NOTHING;
  ELSE
    -- استخدام المستودع الرئيسي الموجود
    SELECT id, tenant_id INTO v_warehouse_id, v_tenant_id 
    FROM public.warehouses 
    WHERE is_main = true 
    LIMIT 1;
    
    -- إنشاء ملف تعريف للمستخدم إذا لم يكن موجوداً
    INSERT INTO public.profiles (id, role)
    VALUES (NEW.id, 'manager')
    ON CONFLICT (id) DO NOTHING;
    
    -- ربط المستخدم بالمخزن إذا لم يكن مربوطاً
    INSERT INTO public.user_warehouses (user_id, warehouse_id)
    VALUES (NEW.id, v_warehouse_id)
    ON CONFLICT DO NOTHING;
  END IF;
  
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- في حالة حدوث خطأ، لا نوقف عملية التسجيل
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- إنشاء المشغل على جدول auth.users
DROP TRIGGER IF EXISTS on_auth_user_created_link_warehouse ON auth.users;
CREATE TRIGGER on_auth_user_created_link_warehouse
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_warehouse();

-- منح الصلاحيات اللازمة
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON public.warehouses TO authenticated;
GRANT ALL ON public.user_warehouses TO authenticated;
GRANT ALL ON public.profiles TO authenticated;
