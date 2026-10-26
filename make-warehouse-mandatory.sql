-- ============================================
-- جعل warehouse_id إجبارياً في Supabase
-- ============================================

-- 1. إضافة العمود إذا لم يكن موجوداً
ALTER TABLE products ADD COLUMN IF NOT EXISTS warehouse_id TEXT;

-- 2. تحديث السجلات الموجودة التي ليس لها warehouse_id
UPDATE products SET warehouse_id = 'default' WHERE warehouse_id IS NULL OR warehouse_id = '';

-- 3. جعل العمود إجبارياً
ALTER TABLE products ALTER COLUMN warehouse_id SET NOT NULL;

-- 4. إضافة قيد افتراضي
ALTER TABLE products ALTER COLUMN warehouse_id SET DEFAULT 'default';

-- ============================================
-- الخيار 1: تغيير نوع warehouse_id إلى TEXT
-- ============================================

-- 1. تغيير نوع العمود إلى TEXT (للتوافق مع الكود)
ALTER TABLE products ALTER COLUMN warehouse_id TYPE TEXT;

-- 2. تحديث السجلات الموجودة التي ليس لها warehouse_id
UPDATE products SET warehouse_id = 'default' WHERE warehouse_id IS NULL OR warehouse_id = '';

-- 3. جعل العمود إجبارياً (NOT NULL)
ALTER TABLE products ALTER COLUMN warehouse_id SET NOT NULL;

-- 4. تعيين قيمة افتراضية
ALTER TABLE products ALTER COLUMN warehouse_id SET DEFAULT 'default';

-- التحقق من التعديل
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'products' AND column_name = 'warehouse_id';
