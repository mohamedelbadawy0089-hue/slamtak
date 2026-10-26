-- ============================================
-- جعل حقول تاريخ الإنتاج (يوم، شهر، سنة) اختيارية في جدول موجود
-- ============================================

-- إضافة أعمدة الإنتاج (جميعها اختيارية - بدون NOT NULL)
ALTER TABLE products 
    ADD COLUMN IF NOT EXISTS production_day INTEGER CHECK (production_day >= 1 AND production_day <= 31);

ALTER TABLE products 
    ADD COLUMN IF NOT EXISTS production_month INTEGER CHECK (production_month >= 1 AND production_month <= 12);

ALTER TABLE products 
    ADD COLUMN IF NOT EXISTS production_year INTEGER CHECK (production_year >= 2000 AND production_year <= 2100);

-- ============================================
-- التحقق من التعديل
-- ============================================
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns
WHERE table_name = 'products' 
    AND column_name IN ('production_day', 'production_month', 'production_year')
ORDER BY ordinal_position;
