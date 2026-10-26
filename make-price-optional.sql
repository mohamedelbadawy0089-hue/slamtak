-- ============================================
-- تعديل جدول المنتجات لجعل السعر اختياري (يقبل NULL)
-- ============================================

-- 1. إزالة قيد NOT NULL من عمود السعر
ALTER TABLE products 
    ALTER COLUMN price DROP NOT NULL;

-- 2. تعديل القيد CHECK ليسمح بـ NULL أيضًا
ALTER TABLE products 
    DROP CONSTRAINT IF EXISTS products_price_check;

-- 3. إضافة قيد جديد يسمح بـ NULL أو قيمة >= 0
ALTER TABLE products 
    ADD CONSTRAINT products_price_check 
    CHECK (price IS NULL OR price >= 0);

-- 4. تعيين قيمة افتراضية NULL
ALTER TABLE products 
    ALTER COLUMN price SET DEFAULT NULL;

-- ============================================
-- التحقق من التعديل
-- ============================================
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'products' AND column_name = 'price';
