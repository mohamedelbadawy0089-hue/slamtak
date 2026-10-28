-- إصلاح جدول الأدوار - إضافة name_ar
-- Fix roles table - add name_ar column

-- 1) إضافة عمود name_ar
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'roles' AND column_name = 'name_ar'
  ) THEN
    ALTER TABLE public.roles ADD COLUMN name_ar text NOT NULL DEFAULT '';
  END IF;
END $$;

-- 2) تحديث القيم الفارغة
UPDATE public.roles SET name_ar = name WHERE name_ar = '' OR name_ar IS NULL;

-- 3) جعل العمود nullable أو إضافة قيم صحيحة لجميع الصفوف
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.roles WHERE name_ar IS NULL OR name_ar = ''
  ) THEN
    UPDATE public.roles SET name_ar = name WHERE name_ar IS NULL OR name_ar = '';
  END IF;
END $$;

-- 4) جعل العمود nullable بعد التحديث
ALTER TABLE public.roles ALTER COLUMN name_ar DROP NOT NULL;

-- 5) السماح بالقيمة ''
UPDATE public.roles SET name_ar = name WHERE name_ar IS NULL OR name_ar = '';
