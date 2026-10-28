-- إدارة الصلاحيات - إضافة عمود permissions JSON
-- Add permissions column to user_warehouses

-- 1) إضافة عمود permissions JSONB لجدول user_warehouses
ALTER TABLE public.user_warehouses ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT '{}'::jsonb;

-- 2) فهرس على العمود (اختياري)
CREATE INDEX IF NOT EXISTS idx_user_warehouses_permissions ON public.user_warehouses USING GIN (permissions);

-- 3) تحديث جميع الصفوف الموجودة لتكون قيمتها '{}'
UPDATE public.user_warehouses SET permissions = '{}' WHERE permissions IS NULL;

-- 4) صلاحيات القراءة والكتابة للأدوار
GRANT SELECT ON public.user_warehouses TO authenticated;
GRANT UPDATE (permissions) ON public.user_warehouses TO authenticated;

-- 5) مثال: تخصيص صلاحيات لنظام الصلاحيات المخصصة
-- الاحترافية: إضافة واجهة وراء هذه الصلاحيات من الكود
-- يعلن كود الواجهة ('public/app.js') المهام التالية:
-- - استرداد قائمة الصلاحيات 
-- - تخزينها في المكونات وإظهار الإجراءات للمستخدم
-- - إلغاء الصلاحيات عند التحديث أو منع الوصول

COMMENT ON COLUMN public.user_warehouses.permissions IS
  'صلاحيات دقيقة لكل مستخدم داخل هذا المخزن بصيغة JSON';
