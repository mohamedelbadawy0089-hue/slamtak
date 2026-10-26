-- إنشاء جدول المنتجات
CREATE TABLE IF NOT EXISTS products (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    price DECIMAL(10, 2) NOT NULL CHECK (price >= 0),
    quantity INTEGER DEFAULT 0 CHECK (quantity >= 0),
    discount DECIMAL(5,2) NOT NULL CHECK (discount >= 0 AND discount <= 100),
    barcode TEXT UNIQUE,
    -- تاريخ الإنتاج (عمود واحد - اختياري)
    production_date DATE,
    
    -- تاريخ الانتهاء (عمود واحد - اختياري)
    expiry_date DATE,
    warehouse_id TEXT NOT NULL DEFAULT 'default' REFERENCES warehouses(id) ON DELETE CASCADE,
    category TEXT DEFAULT 'أدوية',
    description TEXT,
    supplier TEXT,
    cost_price DECIMAL(10,2) CHECK (cost_price >= 0),
    min_stock INTEGER DEFAULT 10 CHECK (min_stock >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    user_id TEXT
);

-- إنشاء جدول الفئات
CREATE TABLE IF NOT EXISTS categories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- إنشاء جدول الموردين
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- إنشاء جدول المبيعات
CREATE TABLE IF NOT EXISTS sales (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
    total_price DECIMAL(10,2) NOT NULL CHECK (total_price >= 0),
    discount_amount DECIMAL(10,2) DEFAULT 0 CHECK (discount_amount >= 0),
    customer_name TEXT,
    customer_phone TEXT,
    payment_method TEXT DEFAULT 'نقدي',
    sale_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    user_id TEXT
);

-- إنشاء جدول المشتريات
CREATE TABLE IF NOT EXISTS purchases (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_cost DECIMAL(10,2) NOT NULL CHECK (unit_cost >= 0),
    total_cost DECIMAL(10,2) NOT NULL CHECK (total_cost >= 0),
    supplier_id UUID REFERENCES suppliers(id),
    purchase_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    invoice_number TEXT,
    user_id TEXT
);

-- إنشاء جدول المخزون
CREATE TABLE IF NOT EXISTS inventory (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id UUID REFERENCES products(id) ON DELETE CASCADE UNIQUE,
    current_quantity INTEGER NOT NULL DEFAULT 0 CHECK (current_quantity >= 0),
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    min_quantity INTEGER DEFAULT 10 CHECK (min_quantity >= 0),
    max_quantity INTEGER DEFAULT 1000 CHECK (max_quantity >= 0)
);

-- إنشاء جدول المستخدمين
CREATE TABLE IF NOT EXISTS users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'manager', 'user')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE
);

-- إنشاء جدول الإعدادات
CREATE TABLE IF NOT EXISTS settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- إنشاء فهرس للبحث السريع
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_product_id ON sales(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_purchases_product_id ON purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_product_id ON inventory(product_id);

-- إنشاء دالة لتحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- إنشاء تريجر لتحديث updated_at في جدول المنتجات
CREATE TRIGGER update_products_updated_at 
    BEFORE UPDATE ON products 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- إدخال بيانات أولية
INSERT INTO categories (name, description) VALUES 
    ('أدوية', 'الأدوية والمستحضرات الطبية'),
    ('مستلزمات طبية', 'المستلزمات والمعدات الطبية'),
    ('فيتامينات', 'الفيتامينات والمكملات الغذائية'),
    ('مستحضرات تجميل', 'مستحضرات التجميل والعناية بالبشرة'),
    ('أخرى', 'منتجات متنوعة')
ON CONFLICT (name) DO NOTHING;

INSERT INTO suppliers (name, phone, email, address) VALUES 
    ('المورد الرئيسي', '01234567890', 'main@supplier.com', 'القاهرة، مصر'),
    ('مورد الأدوية', '01123456789', 'meds@supplier.com', 'الإسكندرية، مصر'),
    ('مورد المستلزمات', '01098765432', 'supplies@supplier.com', 'الجيزة، مصر')
ON CONFLICT DO NOTHING;

INSERT INTO settings (key, value, description) VALUES 
    ('company_name', 'الصيدلية الذكية', 'اسم الشركة'),
    ('currency', 'جنيه مصري', 'العملة الافتراضية'),
    ('tax_rate', '0.14', 'نسبة الضريبة'),
    ('low_stock_alert', '10', 'حد المخزون المنخفض'),
    ('backup_enabled', 'true', 'تفعيل النسخ الاحتياطي'),
    ('auto_save', 'true', 'الحفظ التلقائي')
ON CONFLICT (key) DO NOTHING;

-- إنشاء سياسة أمان (RLS) للجدول
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;

-- سياسات الوصول للمنتجات
CREATE POLICY "Users can view products" ON products FOR SELECT USING (true);
CREATE POLICY "Users can insert products" ON products FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update products" ON products FOR UPDATE USING (true);
CREATE POLICY "Users can delete products" ON products FOR DELETE USING (true);

-- سياسات الوصول للمبيعات
CREATE POLICY "Users can view sales" ON sales FOR SELECT USING (true);
CREATE POLICY "Users can insert sales" ON sales FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update their sales" ON sales FOR UPDATE USING (true);

-- سياسات الوصول للمشتريات
CREATE POLICY "Users can view purchases" ON purchases FOR SELECT USING (true);
CREATE POLICY "Users can insert purchases" ON purchases FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update their purchases" ON purchases FOR UPDATE USING (true);

-- سياسات الوصول للمخزون
CREATE POLICY "Users can view inventory" ON inventory FOR SELECT USING (true);
CREATE POLICY "Users can update inventory" ON inventory FOR UPDATE USING (true);

-- إنشاء دالة للبحث المتقدم
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
        p.name,
        p.price,
        p.quantity,
        p.barcode,
        p.category
    FROM products p
    WHERE 
        p.name ILIKE '%' || search_term || '%' OR
        p.barcode ILIKE '%' || search_term || '%' OR
        p.category ILIKE '%' || search_term || '%'
    ORDER BY 
        CASE WHEN p.name ILIKE search_term THEN 1 ELSE 2 END,
        p.name;
END;
$$ LANGUAGE plpgsql;

-- إنشاء دالة للحصول على المنتجات منخفضة المخزون
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
        p.name,
        p.quantity as current_quantity,
        COALESCE(i.min_quantity, 10) as min_quantity
    FROM products p
    LEFT JOIN inventory i ON p.id = i.product_id
    WHERE p.quantity < COALESCE(i.min_quantity, 10)
    ORDER BY p.quantity ASC;
END;
$$ LANGUAGE plpgsql;

-- إنشاء عرض للإحصائيات
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

-- إنشاء عرض للمبيعات الشهرية
CREATE OR REPLACE VIEW monthly_sales AS
SELECT 
    DATE_TRUNC('month', sale_date) as month,
    COUNT(*) as total_sales,
    SUM(total_price) as total_revenue,
    AVG(total_price) as average_sale
FROM sales
GROUP BY DATE_TRUNC('month', sale_date)
ORDER BY month DESC;
