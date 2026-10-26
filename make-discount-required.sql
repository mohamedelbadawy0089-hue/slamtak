-- ============================================
-- جعل حقل الخصم إجباري (NOT NULL) في Supabase
-- ============================================

-- 1. تحديث الصفوف التي تحتوي على NULL في عمود discount
UPDATE products 
    SET discount = 0 
    WHERE discount IS NULL;

-- 2. إضافة قيد NOT NULL على عمود discount
ALTER TABLE products 
    ALTER COLUMN discount SET NOT NULL;

-- 3. التأكد من وجود قيمة افتراضية
ALTER TABLE products 
    ALTER COLUMN discount SET DEFAULT 0;

-- ============================================
-- التحقق من التعديل
-- ============================================
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'products' AND column_name = 'discount';
