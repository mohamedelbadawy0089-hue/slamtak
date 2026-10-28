-- إدارة الصلاحيات - إضافة عمود permissions JSON وربط التلقائي
-- Complete permissions management

-- 1) إضافة عمود permissions JSONB لجدول user_warehouses
ALTER TABLE public.user_warehouses ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT '{}'::jsonb;

-- 2) تحديث جميع الصفوف الموجودة لتكون قيمتها '{}' (بدلاً من NULL)
UPDATE public.user_warehouses SET permissions = '{}'::jsonb WHERE permissions IS NULL;

-- 3) فهرس على العمود (اختياري)
CREATE INDEX IF NOT EXISTS idx_user_warehouses_permissions ON public.user_warehouses USING GIN (permissions);

-- 4) منح الصلاحيات
GRANT SELECT ON public.user_warehouses TO authenticated;
GRANT UPDATE (permissions) ON public.user_warehouses TO authenticated;

-- 5) تحديث دالة الربط التلقائي
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
    INSERT INTO public.user_warehouses (id, user_id, warehouse_id, tenant_id, is_default, permissions)
    VALUES (gen_random_uuid(), NEW.id, v_warehouse_id, v_tenant_id, true, '{}'::jsonb)
    ON CONFLICT (user_id, warehouse_id) DO NOTHING;
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
    INSERT INTO public.user_warehouses (id, user_id, warehouse_id, tenant_id, is_default, permissions)
    VALUES (gen_random_uuid(), NEW.id, v_warehouse_id, v_tenant_id, true, '{}'::jsonb)
    ON CONFLICT (user_id, warehouse_id) DO NOTHING;
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

-- ملاحظات الصلاحيات
COMMENT ON COLUMN public.user_warehouses.permissions IS
  'صلاحيات دقيقة لكل مستخدم داخل هذا المخزن بصيغة JSON';
