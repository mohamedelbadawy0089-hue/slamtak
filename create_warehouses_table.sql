
-- إنشاء جدول المخازن في Supabase
-- قم بتنفيذ هذا الكود في لوحة تحكم Supabase

CREATE TABLE IF NOT EXISTS warehouses (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    store_name VARCHAR(255) NOT NULL,
    phone VARCHAR(11) UNIQUE NOT NULL CHECK (phone ~ '^[0-9]{11}$'),
    governorate VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    password VARCHAR(255) NOT NULL,
    confirm_password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- إضافة فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_warehouses_email ON warehouses(email);
CREATE INDEX IF NOT EXISTS idx_warehouses_phone ON warehouses(phone);
CREATE INDEX IF NOT EXISTS idx_warehouses_store_name ON warehouses(store_name);
CREATE INDEX IF NOT EXISTS idx_warehouses_governorate ON warehouses(governorate);

-- تفعيل Row Level Security (RLS)
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

-- سياسة للسماح بالوصول الكامل للمستخدمين المجهولين (anon)
DROP POLICY IF EXISTS "Enable anonymous access" ON warehouses;
CREATE POLICY "Enable anonymous access" ON warehouses
    FOR ALL USING (true)
    WITH CHECK (true);

-- سياسة للسماح للمستخدمين المصادق عليهم بالوصول الكامل
DROP POLICY IF EXISTS "Enable authenticated access" ON warehouses;
CREATE POLICY "Enable authenticated access" ON warehouses
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- التحقق من إنشاء الجدول
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'warehouses'
ORDER BY ordinal_position;
