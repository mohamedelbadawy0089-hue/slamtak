-- تحديث الصلاحيات - ربط الصلاحيات في جدول user_warehouses
-- Permissions update

-- تحديث الصلاحيات قبل إضافة موظف جديد
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_warehouses
    WHERE permissions IS NULL OR permissions = 'null'::jsonb
  ) THEN
    UPDATE public.user_warehouses
    SET permissions = '{}'
    WHERE permissions IS NULL OR permissions = 'null'::jsonb;
  END IF;
END $$;

-- صلاحيات تبديل الملفات
GRANT UPDATE (permissions) ON public.user_warehouses TO authenticated;
GRANT SELECT (permissions) ON public.user_warehouses TO authenticated;

-- مثال استخدام permissions في الجدول
COMMENT ON COLUMN public.user_warehouses.permissions IS
  'صلاحيات دقيقة لكل مستخدم داخل هذا المخزن بصيغة JSON';
