-- إنشاء جداول Supabase لنظام سلامتك
-- Created: 2026-05-11

-- جدول المنتجات المخصصة (المخزن الخاص)
CREATE TABLE IF NOT EXISTS warehouse_custom_products (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    warehouse_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name_en TEXT NOT NULL,
    name_ar TEXT,
    batch_number TEXT,
    quantity INTEGER DEFAULT 0,
    price DECIMAL(10,2) DEFAULT 0.00,
    discount DECIMAL(5,2) DEFAULT 0.00,
    production_date DATE,
    expiry_date DATE,
    category TEXT DEFAULT 'مخصص',
    supplier_name TEXT,
    supplier_phone TEXT,
    supplier_address TEXT,
    invoice_number TEXT,
    purchase_date DATE,
    is_permanent BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- جدول المبيعات
CREATE TABLE IF NOT EXISTS sales (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    warehouse_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id UUID REFERENCES warehouse_custom_products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    customer_name TEXT,
    customer_phone TEXT,
    sale_date DATE DEFAULT CURRENT_DATE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- جدول فواتير المشتريات
CREATE TABLE IF NOT EXISTS purchase_invoices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    warehouse_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    invoice_number TEXT NOT NULL,
    supplier_name TEXT,
    invoice_date DATE DEFAULT CURRENT_DATE,
    total_amount DECIMAL(10,2) DEFAULT 0.00,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- جدول أصناف فواتير المشتريات
CREATE TABLE IF NOT EXISTS purchase_invoice_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    invoice_id UUID NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
    product_name TEXT NOT NULL,
    batch_number TEXT,
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    discount_percent DECIMAL(5,2) DEFAULT 0.00,
    price_after_discount DECIMAL(10,2) NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    production_date DATE,
    expiry_date DATE,
    category TEXT DEFAULT 'مخصص',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- جدول المستخدمين الإضافي (إذا احتجنا بيانات إضافية)
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    pharmacy_name TEXT,
    pharmacy_address TEXT,
    pharmacy_phone TEXT,
    license_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- إنشاء فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_warehouse_custom_products_warehouse_id ON warehouse_custom_products(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_custom_products_name_en ON warehouse_custom_products(name_en);
CREATE INDEX IF NOT EXISTS idx_warehouse_custom_products_is_permanent ON warehouse_custom_products(is_permanent);
CREATE INDEX IF NOT EXISTS idx_sales_warehouse_id ON sales(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_warehouse_id ON purchase_invoices(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_invoice_number ON purchase_invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_items_invoice_id ON purchase_invoice_items(invoice_id);

-- إنشاء سياسات RLS (Row Level Security)
ALTER TABLE warehouse_custom_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- سياسات للمنتجات المخصصة
CREATE POLICY "Users can view their own products" ON warehouse_custom_products
    FOR SELECT USING (auth.uid() = warehouse_id);

CREATE POLICY "Users can insert their own products" ON warehouse_custom_products
    FOR INSERT WITH CHECK (auth.uid() = warehouse_id);

CREATE POLICY "Users can update their own products" ON warehouse_custom_products
    FOR UPDATE USING (auth.uid() = warehouse_id);

CREATE POLICY "Users can delete their own products" ON warehouse_custom_products
    FOR DELETE USING (auth.uid() = warehouse_id);

-- سياسات للمبيعات
CREATE POLICY "Users can view their own sales" ON sales
    FOR SELECT USING (auth.uid() = warehouse_id);

CREATE POLICY "Users can insert their own sales" ON sales
    FOR INSERT WITH CHECK (auth.uid() = warehouse_id);

CREATE POLICY "Users can update their own sales" ON sales
    FOR UPDATE USING (auth.uid() = warehouse_id);

CREATE POLICY "Users can delete their own sales" ON sales
    FOR DELETE USING (auth.uid() = warehouse_id);

-- سياسات لفواتير المشتريات
CREATE POLICY "Users can view their own purchase invoices" ON purchase_invoices
    FOR SELECT USING (auth.uid() = warehouse_id);

CREATE POLICY "Users can insert their own purchase invoices" ON purchase_invoices
    FOR INSERT WITH CHECK (auth.uid() = warehouse_id);

CREATE POLICY "Users can update their own purchase invoices" ON purchase_invoices
    FOR UPDATE USING (auth.uid() = warehouse_id);

CREATE POLICY "Users can delete their own purchase invoices" ON purchase_invoices
    FOR DELETE USING (auth.uid() = warehouse_id);

-- سياسات لأصناف فواتير المشتريات
CREATE POLICY "Users can view their own invoice items" ON purchase_invoice_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM purchase_invoices 
            WHERE purchase_invoices.id = purchase_invoice_items.invoice_id 
            AND purchase_invoices.warehouse_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert their own invoice items" ON purchase_invoice_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM purchase_invoices 
            WHERE purchase_invoices.id = purchase_invoice_items.invoice_id 
            AND purchase_invoices.warehouse_id = auth.uid()
        )
    );

CREATE POLICY "Users can update their own invoice items" ON purchase_invoice_items
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM purchase_invoices 
            WHERE purchase_invoices.id = purchase_invoice_items.invoice_id 
            AND purchase_invoices.warehouse_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete their own invoice items" ON purchase_invoice_items
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM purchase_invoices 
            WHERE purchase_invoices.id = purchase_invoice_items.invoice_id 
            AND purchase_invoices.warehouse_id = auth.uid()
        )
    );

-- سياسات لملفات المستخدمين
CREATE POLICY "Users can view their own profile" ON user_profiles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile" ON user_profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile" ON user_profiles
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own profile" ON user_profiles
    FOR DELETE USING (auth.uid() = user_id);

-- إنشاء دوال مساعدة
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- إنشاء triggers لتحديث updated_at تلقائياً
CREATE TRIGGER update_warehouse_custom_products_updated_at
    BEFORE UPDATE ON warehouse_custom_products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_purchase_invoices_updated_at
    BEFORE UPDATE ON purchase_invoices
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- إضافة تعليقات توضيحية للجداول
COMMENT ON TABLE warehouse_custom_products IS 'جدول المنتجات المخصصة للمخزن الخاص';
COMMENT ON TABLE sales IS 'جدول المبيعات';
COMMENT ON TABLE purchase_invoices IS 'جدول فواتير المشتريات';
COMMENT ON TABLE purchase_invoice_items IS 'جدول أصناف فواتير المشتريات';
COMMENT ON TABLE user_profiles IS 'جدول ملفات المستخدمين الإضافية';

-- إضافة قيود للتحقق من البيانات
ALTER TABLE warehouse_custom_products 
    ADD CONSTRAINT check_quantity_positive CHECK (quantity >= 0),
    ADD CONSTRAINT check_price_positive CHECK (price >= 0),
    ADD CONSTRAINT check_discount_range CHECK (discount >= 0 AND discount <= 100);

ALTER TABLE sales 
    ADD CONSTRAINT check_sales_quantity_positive CHECK (quantity > 0),
    ADD CONSTRAINT check_sales_unit_price_positive CHECK (unit_price >= 0),
    ADD CONSTRAINT check_sales_total_price_positive CHECK (total_price >= 0);

ALTER TABLE purchase_invoice_items 
    ADD CONSTRAINT check_items_quantity_positive CHECK (quantity > 0),
    ADD CONSTRAINT check_items_unit_price_positive CHECK (unit_price >= 0),
    ADD CONSTRAINT check_items_total_price_positive CHECK (total_amount >= 0),
    ADD CONSTRAINT check_items_discount_range CHECK (discount_percent >= 0 AND discount_percent <= 100);

-- إنشاء بيانات أولية (اختياري)
-- يمكنك إضافة بيانات أولية هنا إذا كان ذلك ضرورياً
