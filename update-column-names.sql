-- ============================================
-- تحديث أسماء الأعمدة لتتوافق مع حقول HTML
-- الكمية، المنتج، كسور، رقم صحيح، خصم، الانتاج (يوم/شهر/سنة)، الانتهاء (يوم/شهر/سنة)
-- ============================================

-- 1. إعادة تسمية العمود name إلى product_name
ALTER TABLE products RENAME COLUMN name TO product_name;

-- 2. إضافة عمود كسور (اختياري)
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_frac INTEGER CHECK (price_frac >= 0 AND price_frac <= 99);

-- 3. إضافة عمود رقم صحيح (إجباري - للسعر)
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_int INTEGER NOT NULL DEFAULT 0 CHECK (price_int >= 0);

-- 4. حذف عمود السعر القديم (اختياري - إذا أردت الاحتفاظ به للتوافق، اتركه)
-- ALTER TABLE products DROP COLUMN IF EXISTS price;

-- ============================================
-- التحقق من التعديلات
-- ============================================
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns
WHERE table_name = 'products' 
ORDER BY ordinal_position;
