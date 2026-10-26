-- الخطوة 1: تشغيل هذا الاستعلام أولاً للحصول على القيم الفعلية
SELECT id, email FROM auth.users;

-- الخطوة 2: تشغيل هذا الاستعلام لعرض المخازن المسجلة
SELECT * FROM user_warehouses;

-- الخطوة 3: بعد الحصول على القيم الفعلية من الاستعلامات أعلاه، استخدمها لإضافة سجل جديد
-- مثال: إذا كان USER_ID = '64762cc4-1044-4f6b-ba41-33bfc1d6de7f' و WAREHOUSE_ID = '64762cc4-1044-4f6b-ba41-33bfc1d6de7f'
-- استبدل القيم أدناه بالقيم الفعلية من النتائج، ثم قم بإزالة التعليق من السطر التالي

-- INSERT INTO user_warehouses (id, user_id, warehouse_name, created_at)
-- VALUES ('ACTUAL_WAREHOUSE_ID', 'ACTUAL_USER_ID', 'اسم المخزن', NOW());
