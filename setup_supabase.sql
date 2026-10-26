-- إنشاء جدول المنتجات الصيدلية في Supabase
CREATE TABLE IF NOT EXISTS pharmacy_products (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    quantity INTEGER DEFAULT 0,
    discount DECIMAL(5,2) NOT NULL CHECK (discount >= 0 AND discount <= 100),
    price DECIMAL(10, 2) NOT NULL CHECK (price >= 0),
    production_date DATE,
    expiry_date DATE,
    warehouse_id TEXT NOT NULL DEFAULT 'default' REFERENCES warehouses(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- إضافة فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_pharmacy_products_name ON pharmacy_products(name);
CREATE INDEX IF NOT EXISTS idx_pharmacy_products_created_at ON pharmacy_products(created_at);
