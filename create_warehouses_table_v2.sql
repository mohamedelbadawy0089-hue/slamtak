-- إنشاء جدول warehouses في Supabase
-- هذا الجدول سيحتوي على معلومات المخازن المسجلة

CREATE TABLE IF NOT EXISTS warehouses (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(255) UNIQUE NOT NULL,
    governorate VARCHAR(255),
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- إنشاء Indexes لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_warehouses_email ON warehouses(email);
CREATE INDEX IF NOT EXISTS idx_warehouses_phone ON warehouses(phone);
CREATE INDEX IF NOT EXISTS idx_warehouses_governorate ON warehouses(governorate);

-- إنشاء Trigger لتحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_warehouses_updated_at
BEFORE UPDATE ON warehouses
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT ALL ON warehouses TO authenticated;
GRANT ALL ON warehouses TO anon;
GRANT ALL ON warehouses TO service_role;

-- ملاحظات:
-- 1. يجب تشغيل هذا الملف في Supabase SQL Editor
-- 2. هذا الجدول سيستخدم لتسجيل المخازن الجديدة
-- 3. كل مخزن سيحصل على UUID فريد من Supabase
