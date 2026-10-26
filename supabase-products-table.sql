-- ===== جدول المنتجات في Supabase =====
-- نفذ هذا الكود في SQL Editor في Supabase

-- حذف الجدول القديم إذا كان موجوداً (اختياري)
-- DROP TABLE IF EXISTS products CASCADE;

-- إنشاء جدول المنتجات
CREATE TABLE IF NOT EXISTS products (
    -- المعرف الفريد (يتم إنشاؤه تلقائياً)
    id BIGSERIAL PRIMARY KEY,
    
    -- اسم المنتج (مطلوب - إجباري)
    name TEXT NOT NULL,
    
    -- الكمية (اختياري)
    quantity INTEGER DEFAULT 0,
    
    -- الخصم (إجباري)
    discount DECIMAL(5, 2) NOT NULL CHECK (discount >= 0 AND discount <= 100),
    
    -- السعر (إجباري)
    price DECIMAL(10, 2) NOT NULL CHECK (price >= 0),
    
    -- تاريخ الإنتاج (اختياري)
    production_date DATE,
    
    -- تاريخ الانتهاء (اختياري)
    expiry_date DATE,
    
    -- معرف المخزن (مطلوب - Foreign Key إلى warehouses)
    warehouse_id TEXT NOT NULL DEFAULT 'default' REFERENCES warehouses(id) ON DELETE CASCADE,
    
    -- تاريخ الإضافة (يتم إنشاؤه تلقائياً)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- تاريخ آخر تحديث (يتم تحديثه تلقائياً)
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- إنشاء فهارس للبحث السريع
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_warehouse ON products(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_expiry_date ON products(expiry_date);

-- إنشاء دالة لتحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- إنشاء Trigger لتحديث updated_at عند التعديل
DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- تفعيل Row Level Security (RLS)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- سياسة للسماح بالقراءة للجميع
CREATE POLICY "Enable read access for all users" ON products
    FOR SELECT USING (true);

-- سياسة للسماح بالإضافة للجميع (للتطوير فقط)
CREATE POLICY "Enable insert access for all users" ON products
    FOR INSERT WITH CHECK (true);

-- سياسة للسماح بالتحديث للجميع (للتطوير فقط)
CREATE POLICY "Enable update access for all users" ON products
    FOR UPDATE USING (true);

-- سياسة للسماح بالحذف للجميع (للتطوير فقط)
CREATE POLICY "Enable delete access for all users" ON products
    FOR DELETE USING (true);

-- إضافة بيانات تجريبية (اختياري)
INSERT INTO products (name, quantity, price, discount, production_date, expiry_date, warehouse_id)
VALUES 
    ('باراسيتامول', 100, 25.50, 10, '2024-01-01', '2026-01-01', 'warehouse_1'),
    ('أسبرين', 50, 15.75, 5, '2024-02-01', '2026-02-01', 'warehouse_1'),
    ('فيتامين سي', 200, 30.00, 15, '2024-03-01', '2026-03-01', 'warehouse_1')
ON CONFLICT DO NOTHING;

-- التحقق من البيانات
SELECT * FROM products ORDER BY created_at DESC LIMIT 10;

-- عرض معلومات الجدول
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'products'
ORDER BY ordinal_position;
