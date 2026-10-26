-- 1. إزالة المنتجات القديمة (حسب طلب المستخدم)
DROP TABLE IF EXISTS products CASCADE;

-- 2. جدول الدليل العام للأدوية (Master Products)
-- يحتوي على الأدوية القياسية ولا يمكن للمخازن التعديل عليه
CREATE TABLE IF NOT EXISTS master_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name_en TEXT NOT NULL,
    active_ingredient TEXT,
    concentration TEXT,
    pharmaceutical_form TEXT,
    manufacturer TEXT,
    base_price_egp NUMERIC(10, 2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- لا توجد سياسات RLS معقدة هنا، الجميع يمكنه القراءة فقط (إذا أردنا قفله، نجعله مقروءاً فقط للمستخدمين المسجلين)
ALTER TABLE master_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated read access" ON master_products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow anon read access" ON master_products FOR SELECT TO anon USING (true);
-- فقط المدراء (أو Service Role) يمكنهم الإضافة/التعديل عبر السكربت، لذا لا سياسات إدخال عامة

-- 3. جدول مخزون المخازن (Warehouse Inventory)
-- يربط المخزن بدواء من الدليل العام ويحتوي على تفاصيل المخزون الخاصة به
CREATE TABLE IF NOT EXISTS warehouse_inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id UUID NOT NULL,
    master_product_id UUID NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
    batch_number TEXT,
    quantity INTEGER DEFAULT 0,
    price NUMERIC(10, 2) NOT NULL,
    discount NUMERIC(5, 2) DEFAULT 0,
    expiry_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE warehouse_inventory ENABLE ROW LEVEL SECURITY;
-- سياسات العزل (Isolation)
CREATE POLICY "Users can only see their own inventory" ON warehouse_inventory FOR SELECT USING (auth.uid() = warehouse_id);
CREATE POLICY "Users can only insert their own inventory" ON warehouse_inventory FOR INSERT WITH CHECK (auth.uid() = warehouse_id);
CREATE POLICY "Users can only update their own inventory" ON warehouse_inventory FOR UPDATE USING (auth.uid() = warehouse_id);
CREATE POLICY "Users can only delete their own inventory" ON warehouse_inventory FOR DELETE USING (auth.uid() = warehouse_id);

-- 4. جدول المنتجات المخصصة للمخازن (Warehouse Custom Products)
-- المنتجات التي لم يجدها المخزن في الدليل العام وأضافها بنفسه
CREATE TABLE IF NOT EXISTS warehouse_custom_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id UUID NOT NULL,
    name_en TEXT NOT NULL,
    active_ingredient TEXT,
    concentration TEXT,
    pharmaceutical_form TEXT,
    batch_number TEXT,
    quantity INTEGER DEFAULT 0,
    price NUMERIC(10, 2) NOT NULL,
    discount NUMERIC(5, 2) DEFAULT 0,
    expiry_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE warehouse_custom_products ENABLE ROW LEVEL SECURITY;
-- سياسات العزل (Isolation)
CREATE POLICY "Users can only see their own custom products" ON warehouse_custom_products FOR SELECT USING (auth.uid() = warehouse_id);
CREATE POLICY "Users can only insert their own custom products" ON warehouse_custom_products FOR INSERT WITH CHECK (auth.uid() = warehouse_id);
CREATE POLICY "Users can only update their own custom products" ON warehouse_custom_products FOR UPDATE USING (auth.uid() = warehouse_id);
CREATE POLICY "Users can only delete their own custom products" ON warehouse_custom_products FOR DELETE USING (auth.uid() = warehouse_id);

-- Indexes لتسريع البحث
CREATE INDEX IF NOT EXISTS idx_master_products_name ON master_products(name_en);
CREATE INDEX IF NOT EXISTS idx_warehouse_inventory_wid ON warehouse_inventory(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_custom_products_wid ON warehouse_custom_products(warehouse_id);
