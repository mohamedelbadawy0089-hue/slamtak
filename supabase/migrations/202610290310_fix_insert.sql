-- تحديث إدخالات الأدوار - إضافة name_ar
-- Update role inserts

-- تحديث تعريف الأدوار لإضافة name_ar
DO $$
DECLARE
  v_role record;
BEGIN
  FOR v_role IN SELECT id, name, description FROM public.roles WHERE name_ar IS NULL OR name_ar = '' LOOP
    UPDATE public.roles 
    SET name_ar = v_role.name, description = COALESCE(v_role.description, '')
    WHERE id = v_role.id;
  END LOOP;
END $$;

-- إضافة قيم name_ar لجميع الصفوف الموجودة
UPDATE public.roles SET name_ar = name WHERE name_ar IS NULL OR name_ar = '';

-- جعل العمود nullable آخر مرة
ALTER TABLE public.roles ALTER COLUMN name_ar DROP NOT NULL;

COMMENT ON COLUMN public.roles.name_ar IS 'اسم الدور بالعربية';
