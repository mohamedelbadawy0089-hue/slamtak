-- 1. حذف الصفوف المكررة بناءً على الاسم ورابط الموقع
-- Deduplication based on name and location_url
DELETE FROM public.egypt_pharmacies_static a
USING public.egypt_pharmacies_static b
WHERE a.ctid < b.ctid
  AND a.name = b.name
  AND a.location_url = b.location_url;

-- 2. إضافة قيد الفرادة لمنع التكرار مستقبلاً
-- Add UNIQUE constraint to prevent future duplicates
ALTER TABLE public.egypt_pharmacies_static
ADD CONSTRAINT unique_pharmacy_name_location UNIQUE (name, location_url);

-- 3. تحديث الفهارس لضمان أفضل أداء بعد التنظيف
ANALYZE public.egypt_pharmacies_static;

-- استعلام للتأكد من العدد النهائي
SELECT count(*) as final_count FROM public.egypt_pharmacies_static;
