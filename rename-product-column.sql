-- ============================================
-- تنظيف أعمدة اسم المنتج - الاحتفاظ بعمود name فقط
-- ============================================

-- 1. حذف عمود product_name_ar إذا كان موجوداً
ALTER TABLE products DROP COLUMN IF EXISTS product_name_ar;

-- 2. إضافة عمود name إذا لم يكن موجوداً
ALTER TABLE products ADD COLUMN IF NOT EXISTS name TEXT;

-- 3. نقل البيانات من product_name إلى name (إذا كان product_name موجوداً)
UPDATE products SET name = product_name WHERE name IS NULL OR name = '';

-- 4. حذف عمود product_name بعد نقل البيانات
ALTER TABLE products DROP COLUMN IF EXISTS product_name;

-- 5. جعل عمود name إجبارياً
ALTER TABLE products ALTER COLUMN name SET NOT NULL;

-- التحقق من التعديل
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'products' AND column_name IN ('name', 'product_name', 'product_name_ar');
