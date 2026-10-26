-- تعديل جدول warehouses لربطه بـ auth.users
-- لتفعيل نظام الهوية الكامل

-- 1. إزالة القيود القديمة
ALTER TABLE warehouses DROP CONSTRAINT IF EXISTS warehouses_pkey CASCADE;

-- 2. حذف العمود id الحالي
ALTER TABLE warehouses DROP COLUMN IF EXISTS id;

-- 3. إضافة عمود id جديد يربط بـ auth.users
ALTER TABLE warehouses ADD COLUMN id UUID REFERENCES auth.users(id) PRIMARY KEY;

-- 4. إزالة الأعمدة غير الضرورية
ALTER TABLE warehouses DROP COLUMN IF EXISTS password;
ALTER TABLE warehouses DROP COLUMN IF EXISTS confirm_password;

-- 5. تحديث الفهارس
DROP INDEX IF EXISTS idx_warehouses_email;
DROP INDEX IF EXISTS idx_warehouses_phone;
DROP INDEX IF EXISTS idx_warehouses_email_phone;
DROP INDEX IF EXISTS idx_warehouses_governorate;

-- 6. إنشاء فهارس جديدة
CREATE INDEX idx_warehouses_email ON warehouses(email);
CREATE INDEX idx_warehouses_phone ON warehouses(phone);
CREATE INDEX idx_warehouses_governorate ON warehouses(governorate);
CREATE INDEX idx_warehouses_store_name ON warehouses(store_name);

-- 7. تحديث إحصائيات الجدول
ANALYZE warehouses;

-- 8. عرض هيكل الجدول الجديد
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'warehouses' 
ORDER BY ordinal_position;
