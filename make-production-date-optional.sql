-- ============================================
-- جعل جميع حقول تاريخ الإنتاج اختيارية (يوم، شهر، سنة)
-- ============================================

-- 1. إضافة عمود يوم الإنتاج (اختياري)
ALTER TABLE products 
    ADD COLUMN IF NOT EXISTS production_day INTEGER CHECK (production_day >= 1 AND production_day <= 31);

-- 2. إضافة عمود شهر الإنتاج (اختياري)
ALTER TABLE products 
    ADD COLUMN IF NOT EXISTS production_month INTEGER CHECK (production_month >= 1 AND production_month <= 12);

-- 3. إضافة عمود سنة الإنتاج (اختياري)
ALTER TABLE products 
    ADD COLUMN IF NOT EXISTS production_year INTEGER CHECK (production_year >= 2000 AND production_year <= 2100);

-- 4. تحويل البيانات الموجودة من production_date إلى الأعمدة المنفصلة
UPDATE products 
    SET production_day = EXTRACT(DAY FROM production_date),
        production_month = EXTRACT(MONTH FROM production_date),
        production_year = EXTRACT(YEAR FROM production_date)
    WHERE production_date IS NOT NULL;

-- ============================================
-- التحقق من التعديلات
-- ============================================
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns
WHERE table_name = 'products' 
    AND column_name IN ('production_day', 'production_month', 'production_year')
ORDER BY ordinal_position;
