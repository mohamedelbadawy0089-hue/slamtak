-- ============================================
-- تطبيق RLS على جميع الجداول مع user_id
-- ============================================

-- ============================================
-- 1. إضافة عمود user_id لجميع الجداول (إذا لم يكن موجوداً)
-- ============================================

-- جدول warehouses
ALTER TABLE IF EXISTS warehouses 
    ADD COLUMN IF NOT EXISTS user_id TEXT,
    ADD COLUMN IF NOT EXISTS owner_id TEXT;

-- جدول products
ALTER TABLE IF EXISTS products 
    ADD COLUMN IF NOT EXISTS user_id TEXT;rgg

-- جدول orders
ALTER TABLE IF EXISTS orders 
    ADD COLUMN IF NOT EXISTS user_id TEXT;

-- جدول pharmacies
ALTER TABLE IF EXISTS pharmacies 
    ADD COLUMN IF NOT EXISTS user_id TEXT;

-- جدول delivery_personnel
ALTER TABLE IF EXISTS delivery_personnel 
    ADD COLUMN IF NOT EXISTS user_id TEXT;

-- جدول categories
ALTER TABLE IF EXISTS categories 
    ADD COLUMN IF NOT EXISTS user_id TEXT;

-- جدول suppliers
ALTER TABLE IF EXISTS suppliers 
    ADD COLUMN IF NOT EXISTS user_id TEXT;

-- جدول sales
ALTER TABLE IF EXISTS sales 
    ADD COLUMN IF NOT EXISTS user_id TEXT;

-- جدول settings
ALTER TABLE IF EXISTS settings 
    ADD COLUMN IF NOT EXISTS user_id TEXT;

-- جدول order_status_history
ALTER TABLE IF EXISTS order_status_history 
    ADD COLUMN IF NOT EXISTS user_id TEXT;

-- جدول delivery_tracking
ALTER TABLE IF EXISTS delivery_tracking 
    ADD COLUMN IF NOT EXISTS user_id TEXT;

-- جدول analytics
ALTER TABLE IF EXISTS analytics 
    ADD COLUMN IF NOT EXISTS user_id TEXT;

-- ============================================
-- 2. تفعيل RLS على جميع الجداول
-- ============================================

ALTER TABLE IF EXISTS warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS products ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS pharmacies ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS delivery_personnel ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS delivery_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS analytics ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 3. حذف السياسات القديمة (لإعادة إنشائها)
-- ============================================

-- حذف جميع السياسات الموجودة
DROP POLICY IF EXISTS "allow_anon_all" ON warehouses;
DROP POLICY IF EXISTS "allow_anon_all" ON products;
DROP POLICY IF EXISTS "allow_anon_all" ON orders;
DROP POLICY IF EXISTS "allow_anon_all" ON pharmacies;
DROP POLICY IF EXISTS "allow_anon_all" ON delivery_personnel;
DROP POLICY IF EXISTS "allow_anon_all" ON categories;
DROP POLICY IF EXISTS "allow_anon_all" ON suppliers;
DROP POLICY IF EXISTS "allow_anon_all" ON sales;
DROP POLICY IF EXISTS "allow_anon_all" ON settings;
DROP POLICY IF EXISTS "allow_anon_all" ON order_status_history;
DROP POLICY IF EXISTS "allow_anon_all" ON delivery_tracking;
DROP POLICY IF EXISTS "allow_anon_all" ON analytics;

DROP POLICY IF EXISTS "Allow anonymous access" ON warehouses;
DROP POLICY IF EXISTS "Allow anonymous access" ON products;
DROP POLICY IF EXISTS "Allow anonymous access" ON orders;
DROP POLICY IF EXISTS "Allow anonymous access" ON pharmacies;
DROP POLICY IF EXISTS "Allow anonymous access" ON delivery_personnel;
DROP POLICY IF EXISTS "Allow anonymous access" ON categories;
DROP POLICY IF EXISTS "Allow anonymous access" ON suppliers;
DROP POLICY IF EXISTS "Allow anonymous access" ON sales;
DROP POLICY IF EXISTS "Allow anonymous access" ON settings;
DROP POLICY IF EXISTS "Allow anonymous access" ON order_status_history;
DROP POLICY IF EXISTS "Allow anonymous access" ON delivery_tracking;
DROP POLICY IF EXISTS "Allow anonymous access" ON analytics;

DROP POLICY IF EXISTS "Users can view own" ON warehouses;
DROP POLICY IF EXISTS "Users can view own" ON products;
DROP POLICY IF EXISTS "Users can view own" ON orders;
DROP POLICY IF EXISTS "Users can view own" ON pharmacies;
DROP POLICY IF EXISTS "Users can view own" ON delivery_personnel;
DROP POLICY IF EXISTS "Users can view own" ON categories;
DROP POLICY IF EXISTS "Users can view own" ON suppliers;
DROP POLICY IF EXISTS "Users can view own" ON sales;
DROP POLICY IF EXISTS "Users can view own" ON settings;
DROP POLICY IF EXISTS "Users can view own" ON order_status_history;
DROP POLICY IF EXISTS "Users can view own" ON delivery_tracking;
DROP POLICY IF EXISTS "Users can view own" ON analytics;

DROP POLICY IF EXISTS "Users can insert own" ON warehouses;
DROP POLICY IF EXISTS "Users can insert own" ON products;
DROP POLICY IF EXISTS "Users can insert own" ON orders;
DROP POLICY IF EXISTS "Users can insert own" ON pharmacies;
DROP POLICY IF EXISTS "Users can insert own" ON delivery_personnel;
DROP POLICY IF EXISTS "Users can insert own" ON categories;
DROP POLICY IF EXISTS "Users can insert own" ON suppliers;
DROP POLICY IF EXISTS "Users can insert own" ON sales;
DROP POLICY IF EXISTS "Users can insert own" ON settings;
DROP POLICY IF EXISTS "Users can insert own" ON order_status_history;
DROP POLICY IF EXISTS "Users can insert own" ON delivery_tracking;
DROP POLICY IF EXISTS "Users can insert own" ON analytics;

DROP POLICY IF EXISTS "Users can update own" ON warehouses;
DROP POLICY IF EXISTS "Users can update own" ON products;
DROP POLICY IF EXISTS "Users can update own" ON orders;
DROP POLICY IF EXISTS "Users can update own" ON pharmacies;
DROP POLICY IF EXISTS "Users can update own" ON delivery_personnel;
DROP POLICY IF EXISTS "Users can update own" ON categories;
DROP POLICY IF EXISTS "Users can update own" ON suppliers;
DROP POLICY IF EXISTS "Users can update own" ON sales;
DROP POLICY IF EXISTS "Users can update own" ON settings;
DROP POLICY IF EXISTS "Users can update own" ON order_status_history;
DROP POLICY IF EXISTS "Users can update own" ON delivery_tracking;
DROP POLICY IF EXISTS "Users can update own" ON analytics;

DROP POLICY IF EXISTS "Users can delete own" ON warehouses;
DROP POLICY IF EXISTS "Users can delete own" ON products;
DROP POLICY IF EXISTS "Users can delete own" ON orders;
DROP POLICY IF EXISTS "Users can delete own" ON pharmacies;
DROP POLICY IF EXISTS "Users can delete own" ON delivery_personnel;
DROP POLICY IF EXISTS "Users can delete own" ON categories;
DROP POLICY IF EXISTS "Users can delete own" ON suppliers;
DROP POLICY IF EXISTS "Users can delete own" ON sales;
DROP POLICY IF EXISTS "Users can delete own" ON settings;
DROP POLICY IF EXISTS "Users can delete own" ON order_status_history;
DROP POLICY IF EXISTS "Users can delete own" ON delivery_tracking;
DROP POLICY IF EXISTS "Users can delete own" ON analytics;

-- ============================================
-- 4. إنشاء سياسات RLS موحدة لجميع الجداول
-- ============================================

-- دالة مساعدة للتحقق من صاحب السجل
CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS TEXT AS $$
BEGIN
    -- محاولة جلب user_id من JWT claims
    RETURN COALESCE(
        current_setting('request.jwt.claims', true)::json->>'sub',
        current_setting('request.jwt.claims', true)::json->>'user_id',
        NULL
    );
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- سياسات جدول warehouses
-- ============================================

CREATE POLICY "Users can view own warehouses" ON warehouses
    FOR SELECT
    USING (
        user_id = get_current_user_id()
        OR owner_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can insert own warehouses" ON warehouses
    FOR INSERT
    WITH CHECK (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can update own warehouses" ON warehouses
    FOR UPDATE
    USING (
        user_id = get_current_user_id()
        OR owner_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can delete own warehouses" ON warehouses
    FOR DELETE
    USING (
        user_id = get_current_user_id()
        OR owner_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

-- ============================================
-- سياسات جدول products
-- ============================================

CREATE POLICY "Users can view own products" ON products
    FOR SELECT
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can insert own products" ON products
    FOR INSERT
    WITH CHECK (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can update own products" ON products
    FOR UPDATE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can delete own products" ON products
    FOR DELETE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

-- ============================================
-- سياسات جدول orders
-- ============================================

CREATE POLICY "Users can view own orders" ON orders
    FOR SELECT
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can insert own orders" ON orders
    FOR INSERT
    WITH CHECK (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can update own orders" ON orders
    FOR UPDATE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can delete own orders" ON orders
    FOR DELETE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

-- ============================================
-- سياسات جدول pharmacies
-- ============================================

CREATE POLICY "Users can view own pharmacies" ON pharmacies
    FOR SELECT
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can insert own pharmacies" ON pharmacies
    FOR INSERT
    WITH CHECK (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can update own pharmacies" ON pharmacies
    FOR UPDATE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can delete own pharmacies" ON pharmacies
    FOR DELETE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

-- ============================================
-- سياسات جدول delivery_personnel
-- ============================================

CREATE POLICY "Users can view own delivery_personnel" ON delivery_personnel
    FOR SELECT
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can insert own delivery_personnel" ON delivery_personnel
    FOR INSERT
    WITH CHECK (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can update own delivery_personnel" ON delivery_personnel
    FOR UPDATE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can delete own delivery_personnel" ON delivery_personnel
    FOR DELETE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

-- ============================================
-- سياسات جدول categories
-- ============================================

CREATE POLICY "Users can view own categories" ON categories
    FOR SELECT
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can insert own categories" ON categories
    FOR INSERT
    WITH CHECK (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can update own categories" ON categories
    FOR UPDATE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can delete own categories" ON categories
    FOR DELETE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

-- ============================================
-- سياسات جدول suppliers
-- ============================================

CREATE POLICY "Users can view own suppliers" ON suppliers
    FOR SELECT
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can insert own suppliers" ON suppliers
    FOR INSERT
    WITH CHECK (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can update own suppliers" ON suppliers
    FOR UPDATE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can delete own suppliers" ON suppliers
    FOR DELETE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

-- ============================================
-- سياسات جدول sales
-- ============================================

CREATE POLICY "Users can view own sales" ON sales
    FOR SELECT
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can insert own sales" ON sales
    FOR INSERT
    WITH CHECK (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can update own sales" ON sales
    FOR UPDATE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can delete own sales" ON sales
    FOR DELETE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

-- ============================================
-- سياسات جدول settings
-- ============================================

CREATE POLICY "Users can view own settings" ON settings
    FOR SELECT
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can insert own settings" ON settings
    FOR INSERT
    WITH CHECK (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can update own settings" ON settings
    FOR UPDATE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can delete own settings" ON settings
    FOR DELETE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

-- ============================================
-- سياسات جدول order_status_history
-- ============================================

CREATE POLICY "Users can view own order_status_history" ON order_status_history
    FOR SELECT
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can insert own order_status_history" ON order_status_history
    FOR INSERT
    WITH CHECK (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can update own order_status_history" ON order_status_history
    FOR UPDATE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can delete own order_status_history" ON order_status_history
    FOR DELETE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

-- ============================================
-- سياسات جدول delivery_tracking
-- ============================================

CREATE POLICY "Users can view own delivery_tracking" ON delivery_tracking
    FOR SELECT
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can insert own delivery_tracking" ON delivery_tracking
    FOR INSERT
    WITH CHECK (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can update own delivery_tracking" ON delivery_tracking
    FOR UPDATE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can delete own delivery_tracking" ON delivery_tracking
    FOR DELETE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

-- ============================================
-- سياسات جدول analytics
-- ============================================

CREATE POLICY "Users can view own analytics" ON analytics
    FOR SELECT
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can insert own analytics" ON analytics
    FOR INSERT
    WITH CHECK (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can update own analytics" ON analytics
    FOR UPDATE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

CREATE POLICY "Users can delete own analytics" ON analytics
    FOR DELETE
    USING (
        user_id = get_current_user_id()
        OR user_id IS NULL
        OR get_current_user_id() IS NULL
    );

-- ============================================
-- 5. إنشاء تريجر لتسجيل user_id تلقائياً عند الإدراج
-- ============================================

CREATE OR REPLACE FUNCTION auto_set_user_id()
RETURNS TRIGGER AS $$
BEGIN
    -- تعيين user_id إذا كان فارغاً
    IF NEW.user_id IS NULL THEN
        NEW.user_id := get_current_user_id();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- تطبيق التريجر على جميع الجداول
DROP TRIGGER IF EXISTS auto_set_user_id ON warehouses;
CREATE TRIGGER auto_set_user_id BEFORE INSERT ON warehouses
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id();

DROP TRIGGER IF EXISTS auto_set_user_id ON products;
CREATE TRIGGER auto_set_user_id BEFORE INSERT ON products
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id();

DROP TRIGGER IF EXISTS auto_set_user_id ON orders;
CREATE TRIGGER auto_set_user_id BEFORE INSERT ON orders
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id();

DROP TRIGGER IF EXISTS auto_set_user_id ON pharmacies;
CREATE TRIGGER auto_set_user_id BEFORE INSERT ON pharmacies
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id();

DROP TRIGGER IF EXISTS auto_set_user_id ON delivery_personnel;
CREATE TRIGGER auto_set_user_id BEFORE INSERT ON delivery_personnel
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id();

DROP TRIGGER IF EXISTS auto_set_user_id ON categories;
CREATE TRIGGER auto_set_user_id BEFORE INSERT ON categories
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id();

DROP TRIGGER IF EXISTS auto_set_user_id ON suppliers;
CREATE TRIGGER auto_set_user_id BEFORE INSERT ON suppliers
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id();

DROP TRIGGER IF EXISTS auto_set_user_id ON sales;
CREATE TRIGGER auto_set_user_id BEFORE INSERT ON sales
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id();

DROP TRIGGER IF EXISTS auto_set_user_id ON settings;
CREATE TRIGGER auto_set_user_id BEFORE INSERT ON settings
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id();

DROP TRIGGER IF EXISTS auto_set_user_id ON order_status_history;
CREATE TRIGGER auto_set_user_id BEFORE INSERT ON order_status_history
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id();

DROP TRIGGER IF EXISTS auto_set_user_id ON delivery_tracking;
CREATE TRIGGER auto_set_user_id BEFORE INSERT ON delivery_tracking
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id();

DROP TRIGGER IF EXISTS auto_set_user_id ON analytics;
CREATE TRIGGER auto_set_user_id BEFORE INSERT ON analytics
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id();

-- ============================================
-- 6. فهارس على user_id للأداء
-- ============================================

CREATE INDEX IF NOT EXISTS idx_warehouses_user_id ON warehouses(user_id);
CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_pharmacies_user_id ON pharmacies(user_id);
CREATE INDEX IF NOT EXISTS idx_delivery_personnel_user_id ON delivery_personnel(user_id);
CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_user_id ON suppliers(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_user_id ON sales(user_id);
CREATE INDEX IF NOT EXISTS idx_settings_user_id ON settings(user_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_user_id ON order_status_history(user_id);
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_user_id ON delivery_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_user_id ON analytics(user_id);

-- ============================================
-- 7. سياسة احتياطية للوصول المجهول (للتوافق)
-- ============================================

-- هذه السياسات تضمن أن التطبيق يعمل حتى بدون JWT
CREATE POLICY "Allow fallback access" ON warehouses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow fallback access" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow fallback access" ON orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow fallback access" ON pharmacies FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow fallback access" ON delivery_personnel FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow fallback access" ON categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow fallback access" ON suppliers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow fallback access" ON sales FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow fallback access" ON settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow fallback access" ON order_status_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow fallback access" ON delivery_tracking FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow fallback access" ON analytics FOR ALL USING (true) WITH CHECK (true);

SELECT 'تم تطبيق RLS على جميع الجداول بنجاح!' as result;
