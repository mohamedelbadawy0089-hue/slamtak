-- ============================================
-- إنشاء جميع جداول Supabase لتطبيق سلامتك
-- ============================================

-- ============================================
-- إصلاح: إضافة الأعمدة المفقودة إذا كانت الجداول موجودة
-- ============================================

-- إضافة أعمدة مفقودة في جدول products
ALTER TABLE IF EXISTS products 
    ADD COLUMN IF NOT EXISTS product_name TEXT,
    ADD COLUMN IF NOT EXISTS prod_date DATE,
    ADD COLUMN IF NOT EXISTS exp_date DATE,
    ADD COLUMN IF NOT EXISTS unlimited BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS is_unlimited BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS low_stock_alert INTEGER DEFAULT 10,
    ADD COLUMN IF NOT EXISTS min_stock INTEGER DEFAULT 10,
    ADD COLUMN IF NOT EXISTS added_date TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- إضافة أعمدة مفقودة في جدول orders
ALTER TABLE IF EXISTS orders 
    ADD COLUMN IF NOT EXISTS order_num TEXT,
    ADD COLUMN IF NOT EXISTS order_status TEXT DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS pharmacy TEXT,
    ADD COLUMN IF NOT EXISTS total DECIMAL(10,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS user_id TEXT;

-- ============================================
-- 1. جدول المخازن (Warehouses)
-- ============================================
CREATE TABLE IF NOT EXISTS warehouses (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'المخزن الرئيسي',
    phone TEXT,
    email TEXT,
    address TEXT,
    gps_location JSONB, -- {lat: number, lng: number}
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 2. جدول المنتجات (Products)
-- ============================================
CREATE TABLE IF NOT EXISTS products (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    -- اسم المنتج (يدعم الاسم العربي)
    name TEXT NOT NULL,
    product_name TEXT, -- للتوافق مع الكود القديم
    
    -- الأسعار
    price DECIMAL(10, 2) NOT NULL CHECK (price >= 0) DEFAULT 0,
    cost_price DECIMAL(10,2) CHECK (cost_price >= 0) DEFAULT 0,
    discount DECIMAL(5,2) CHECK (discount >= 0 AND discount <= 100) DEFAULT 0,
    
    -- الكمية والمخزون
    quantity INTEGER DEFAULT 0 CHECK (quantity >= 0),
    is_unlimited BOOLEAN DEFAULT false,
    unlimited BOOLEAN DEFAULT false, -- للتوافق
    low_stock_alert INTEGER DEFAULT 10,
    min_stock INTEGER DEFAULT 10,
    
    -- الباركود
    barcode TEXT UNIQUE,
    
    -- التواريخ
    production_date DATE,
    prod_date DATE, -- للتوافق
    expiry_date DATE,
    exp_date DATE, -- للتوافق
    added_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- التصنيف والوصف
    category TEXT DEFAULT 'أدوية',
    description TEXT,
    
    -- المورد
    supplier TEXT,
    
    -- هوية المخزن والمستخدم
    warehouse_id TEXT DEFAULT 'default' REFERENCES warehouses(id) ON DELETE CASCADE,
    user_id TEXT,
    
    -- التواريخ
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 3. جدول الطلبات (Orders)
-- ============================================
CREATE TABLE IF NOT EXISTS orders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- رقم الطلب
    order_number TEXT,
    order_num TEXT, -- للتوافق
    
    -- هوية المخزن
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
    user_id TEXT,
    
    -- بيانات الصيدلية
    pharmacy_name TEXT NOT NULL DEFAULT 'صيدلية مجهولة',
    pharmacy TEXT, -- للتوافق
    pharmacy_phone TEXT,
    pharmacy_address TEXT,
    pharmacy_gps JSONB, -- {lat: number, lng: number}
    
    -- حالة الطلب
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'completed', 'rejected', 'cancelled', 'delivered', 'processing')),
    order_status TEXT DEFAULT 'pending', -- للتوافق
    
    -- المبلغ الإجمالي
    total_amount DECIMAL(10,2) DEFAULT 0,
    total DECIMAL(10,2) DEFAULT 0, -- للتوافق
    
    -- عدد الأصناف والمنتجات
    items_count INTEGER DEFAULT 0,
    products JSONB DEFAULT '[]', -- Array of products with details
    items JSONB DEFAULT '[]', -- للتوافق
    
    -- التواريخ
    order_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- التوصيل
    delivery_person_id UUID,
    delivery_status TEXT DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'assigned', 'picked_up', 'delivered', 'failed', 'in_transit')),
    delivery_notes TEXT,
    notes TEXT
);

-- ============================================
-- 4. جدول مندوبي التوصيل (Delivery Personnel)
-- ============================================
CREATE TABLE IF NOT EXISTS delivery_personnel (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    address TEXT,
    is_active BOOLEAN DEFAULT true,
    current_orders_count INTEGER DEFAULT 0,
    total_delivered INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 5. جدول تاريخ حالات الطلبات (Order Status History)
-- ============================================
CREATE TABLE IF NOT EXISTS order_status_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    old_status TEXT,
    new_status TEXT NOT NULL,
    changed_by UUID,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 6. جدول تتبع التوصيل (Delivery Tracking)
-- ============================================
CREATE TABLE IF NOT EXISTS delivery_tracking (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    delivery_person_id UUID REFERENCES delivery_personnel(id),
    status TEXT NOT NULL CHECK (status IN ('assigned', 'picked_up', 'in_transit', 'delivered', 'failed')),
    location JSONB, -- {lat: number, lng: number, address: text}
    notes TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 7. جدول الفئات (Categories)
-- ============================================
CREATE TABLE IF NOT EXISTS categories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 8. جدول الموردين (Suppliers)
-- ============================================
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 9. جدول المبيعات (Sales)
-- ============================================
CREATE TABLE IF NOT EXISTS sales (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
    total_price DECIMAL(10,2) NOT NULL CHECK (total_price >= 0),
    discount_amount DECIMAL(10,2) DEFAULT 0 CHECK (discount_amount >= 0),
    customer_name TEXT,
    customer_phone TEXT,
    payment_method TEXT DEFAULT 'نقدي',
    sale_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    warehouse_id TEXT,
    user_id TEXT
);

-- ============================================
-- 10. جدول الإعدادات (Settings)
-- ============================================
CREATE TABLE IF NOT EXISTS settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Indexes للأداء
-- ============================================

-- Products Indexes
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_product_name ON products(product_name);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_warehouse_id ON products(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at);

-- Orders Indexes
CREATE INDEX IF NOT EXISTS idx_orders_warehouse_id ON orders(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_order_status ON orders(order_status);
CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_pharmacy_name ON orders(pharmacy_name);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);

-- Delivery Personnel Indexes
CREATE INDEX IF NOT EXISTS idx_delivery_personnel_warehouse_id ON delivery_personnel(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_delivery_personnel_phone ON delivery_personnel(phone);
CREATE INDEX IF NOT EXISTS idx_delivery_personnel_is_active ON delivery_personnel(is_active);

-- Order Status History Indexes
CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id ON order_status_history(order_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_created_at ON order_status_history(created_at);

-- Delivery Tracking Indexes
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_order_id ON delivery_tracking(order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_delivery_person_id ON delivery_tracking(delivery_person_id);
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_timestamp ON delivery_tracking(timestamp);

-- Sales Indexes
CREATE INDEX IF NOT EXISTS idx_sales_product_id ON sales(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_warehouse_id ON sales(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales(sale_date);

-- ============================================
-- RLS (Row Level Security) - للوصول المجهول
-- ============================================

-- تفعيل RLS على جميع الجداول
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_personnel ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- حذف السياسات القديمة إن وجدت
DROP POLICY IF EXISTS "Allow anonymous access" ON warehouses;
DROP POLICY IF EXISTS "Allow anonymous access" ON products;
DROP POLICY IF EXISTS "Allow anonymous access" ON orders;
DROP POLICY IF EXISTS "Allow anonymous access" ON delivery_personnel;
DROP POLICY IF EXISTS "Allow anonymous access" ON order_status_history;
DROP POLICY IF EXISTS "Allow anonymous access" ON delivery_tracking;
DROP POLICY IF EXISTS "Allow anonymous access" ON sales;
DROP POLICY IF EXISTS "Allow anonymous access" ON categories;
DROP POLICY IF EXISTS "Allow anonymous access" ON suppliers;
DROP POLICY IF EXISTS "Allow anonymous access" ON settings;

-- إنشاء سياسة للوصول المجهول على جميع الجداول
-- ملاحظة: هذه السياسة تسمح للجميع بالوصول لأننا نستخدم anon key
CREATE POLICY "Allow anonymous access" ON warehouses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anonymous access" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anonymous access" ON orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anonymous access" ON delivery_personnel FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anonymous access" ON order_status_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anonymous access" ON delivery_tracking FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anonymous access" ON sales FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anonymous access" ON categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anonymous access" ON suppliers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anonymous access" ON settings FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- Functions and Triggers
-- ============================================

-- دالة لتحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers للتحديث التلقائي
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_warehouses_updated_at BEFORE UPDATE ON warehouses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_delivery_personnel_updated_at BEFORE UPDATE ON delivery_personnel
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- دالة لتسجيل تغيير حالة الطلب
CREATE OR REPLACE FUNCTION log_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, notes)
        VALUES (NEW.id, OLD.status, NEW.status, NEW.user_id, 'Status changed automatically');
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER order_status_change_log AFTER UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION log_order_status_change();

-- ============================================
-- إدخال بيانات أولية
-- ============================================

-- مخزن افتراضي
INSERT INTO warehouses (id, name, phone, email, address, is_active)
VALUES ('default', 'المخزن الرئيسي', '01234567890', 'warehouse@slamtak.com', 'القاهرة، مصر', true)
ON CONFLICT (id) DO NOTHING;

-- فئات المنتجات
INSERT INTO categories (name, description) VALUES 
    ('أدوية', 'الأدوية والمستحضرات الطبية'),
    ('مستلزمات طبية', 'المستلزمات والمعدات الطبية'),
    ('فيتامينات', 'الفيتامينات والمكملات الغذائية'),
    ('مستحضرات تجميل', 'مستحضرات التجميل والعناية بالبشرة'),
    ('أخرى', 'منتجات متنوعة')
ON CONFLICT (name) DO NOTHING;

-- موردين
INSERT INTO suppliers (name, phone, email, address) VALUES 
    ('المورد الرئيسي', '01234567890', 'main@supplier.com', 'القاهرة، مصر'),
    ('مورد الأدوية', '01123456789', 'meds@supplier.com', 'الإسكندرية، مصر'),
    ('مورد المستلزمات', '01098765432', 'supplies@supplier.com', 'الجيزة، مصر')
ON CONFLICT DO NOTHING;

-- إعدادات
INSERT INTO settings (key, value, description) VALUES 
    ('company_name', 'سلامتك', 'اسم الشركة'),
    ('currency', 'جنيه مصري', 'العملة الافتراضية'),
    ('tax_rate', '0.14', 'نسبة الضريبة'),
    ('low_stock_alert', '10', 'حد المخزون المنخفض'),
    ('backup_enabled', 'true', 'تفعيل النسخ الاحتياطي'),
    ('auto_save', 'true', 'الحفظ التلقائي')
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- Views للإحصائيات
-- ============================================

-- إحصائيات المنتجات
CREATE OR REPLACE VIEW product_statistics AS
SELECT 
    COUNT(*) as total_products,
    SUM(price * quantity) as total_value,
    AVG(price) as average_price,
    MIN(price) as min_price,
    MAX(price) as max_price,
    SUM(quantity) as total_quantity,
    COUNT(CASE WHEN quantity < 10 THEN 1 END) as low_stock_count
FROM products;

-- المبيعات الشهرية
CREATE OR REPLACE VIEW monthly_sales AS
SELECT 
    DATE_TRUNC('month', sale_date) as month,
    COUNT(*) as total_sales,
    SUM(total_price) as total_revenue,
    AVG(total_price) as average_sale
FROM sales
GROUP BY DATE_TRUNC('month', sale_date)
ORDER BY month DESC;

-- طلبات حسب الحالة
CREATE OR REPLACE VIEW orders_by_status AS
SELECT 
    COALESCE(status, order_status) as status,
    COUNT(*) as count,
    SUM(COALESCE(total_amount, total, 0)) as total_value
FROM orders
GROUP BY COALESCE(status, order_status);

-- ============================================
-- Functions للبحث
-- ============================================

-- البحث في المنتجات
CREATE OR REPLACE FUNCTION search_products(search_term TEXT)
RETURNS TABLE (
    id UUID,
    name TEXT,
    price DECIMAL,
    quantity INTEGER,
    barcode TEXT,
    category TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        COALESCE(p.name, p.product_name) as name,
        p.price,
        p.quantity,
        p.barcode,
        p.category
    FROM products p
    WHERE 
        p.name ILIKE '%' || search_term || '%' OR
        p.product_name ILIKE '%' || search_term || '%' OR
        p.barcode ILIKE '%' || search_term || '%' OR
        p.category ILIKE '%' || search_term || '%'
    ORDER BY p.name;
END;
$$ LANGUAGE plpgsql;

-- المنتجات منخفضة المخزون
CREATE OR REPLACE FUNCTION get_low_stock_products()
RETURNS TABLE (
    id UUID,
    name TEXT,
    current_quantity INTEGER,
    min_quantity INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        COALESCE(p.name, p.product_name) as name,
        p.quantity as current_quantity,
        COALESCE(p.min_stock, p.low_stock_alert, 10) as min_quantity
    FROM products p
    WHERE p.quantity < COALESCE(p.min_stock, p.low_stock_alert, 10)
    ORDER BY p.quantity ASC;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- انتهاء السكربت
-- ============================================
