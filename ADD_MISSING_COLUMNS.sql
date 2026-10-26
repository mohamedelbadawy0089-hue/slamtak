-- ============================================================
-- إضافة الأعمدة المفقودة إلى جدول warehouses
-- ============================================================

-- إضافة warehouse_code
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS warehouse_code VARCHAR(50) UNIQUE;

-- إضافة description
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS description TEXT;

-- إضافة language
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'ar';

-- إضافة settings
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';

-- إضافة created_at
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- إضافة updated_at
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- ============================================================
-- التحقق من الأعمدة
-- ============================================================
SELECT 
    column_name,
    data_type
FROM information_schema.columns
WHERE table_name = 'warehouses'
ORDER BY ordinal_position;