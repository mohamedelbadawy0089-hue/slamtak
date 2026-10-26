-- ============================================
-- نظام العزل التام (Strict Data Isolation)
-- ============================================
-- هذا الملف يُنشئ سياسات RLS صارمة بدون أي ثغرات
-- لا يسمح بالوصول إلا إذا كان user_id مطابقاً للمستخدم الحالي
-- ============================================

-- ============================================
-- 1. دالة الحصول على معرف المستخدم (JWT)
-- ============================================

CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS TEXT AS $$
BEGIN
    -- جلب user_id من JWT claims
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
-- 2. تفعيل RLS الإجباري على جميع الجداول
-- ============================================

ALTER TABLE IF EXISTS warehouses FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS products FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS orders FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS pharmacies FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS delivery_personnel FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS categories FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS suppliers FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sales FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS settings FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS order_status_history FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS delivery_tracking FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS analytics FORCE ROW LEVEL SECURITY;

-- ============================================
-- 3. حذف جميع السياسات القديمة (بما فيها الفallback)
-- ============================================

DO $$
DECLARE
    tbl text;
    tables text[] := ARRAY['warehouses', 'products', 'orders', 'pharmacies', 
                          'delivery_personnel', 'categories', 'suppliers', 
                          'sales', 'settings', 'order_status_history', 
                          'delivery_tracking', 'analytics'];
BEGIN
    FOREACH tbl IN ARRAY tables
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "%%" ON %I', 'allow_anon_all', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "%%" ON %I', 'Allow anonymous access', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "%%" ON %I', 'Allow fallback access', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "%%" ON %I', 'Users can view own', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "%%" ON %I', 'Users can insert own', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "%%" ON %I', 'Users can update own', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "%%" ON %I', 'Users can delete own', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "%%" ON %I', 'Users can view own ' || tbl, tbl);
        EXECUTE format('DROP POLICY IF EXISTS "%%" ON %I', 'Users can insert own ' || tbl, tbl);
        EXECUTE format('DROP POLICY IF EXISTS "%%" ON %I', 'Users can update own ' || tbl, tbl);
        EXECUTE format('DROP POLICY IF EXISTS "%%" ON %I', 'Users can delete own ' || tbl, tbl);
    END LOOP;
END $$;

-- ============================================
-- 4. إنشاء سياسات صارمة (بدون fallback)
-- ============================================

-- دالة مساعدة للتحقق من الملكية
CREATE OR REPLACE FUNCTION is_owner(record_user_id TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN record_user_id IS NOT NULL 
        AND record_user_id = get_current_user_id()
        AND get_current_user_id() IS NOT NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- سياسات جدول pharmacies (صيدليات)
-- ============================================

-- SELECT: فقط إذا كان user_id مطابقاً
CREATE POLICY "Strict isolation - view own" ON pharmacies
    FOR SELECT
    USING (is_owner(user_id));

-- INSERT: يجب أن يكون user_id مطابقاً للمستخدم الحالي
CREATE POLICY "Strict isolation - insert own" ON pharmacies
    FOR INSERT
    WITH CHECK (is_owner(user_id));

-- UPDATE: فقط إذا كان user_id مطابقاً
CREATE POLICY "Strict isolation - update own" ON pharmacies
    FOR UPDATE
    USING (is_owner(user_id))
    WITH CHECK (is_owner(user_id));

-- DELETE: فقط إذا كان user_id مطابقاً
CREATE POLICY "Strict isolation - delete own" ON pharmacies
    FOR DELETE
    USING (is_owner(user_id));

-- ============================================
-- سياسات جدول warehouses (المخازن)
-- ============================================

CREATE POLICY "Strict isolation - view warehouses" ON warehouses
    FOR SELECT
    USING (is_owner(user_id) OR is_owner(owner_id));

CREATE POLICY "Strict isolation - insert warehouses" ON warehouses
    FOR INSERT
    WITH CHECK (is_owner(user_id));

CREATE POLICY "Strict isolation - update warehouses" ON warehouses
    FOR UPDATE
    USING (is_owner(user_id) OR is_owner(owner_id))
    WITH CHECK (is_owner(user_id) OR is_owner(owner_id));

CREATE POLICY "Strict isolation - delete warehouses" ON warehouses
    FOR DELETE
    USING (is_owner(user_id) OR is_owner(owner_id));

-- ============================================
-- سياسات جدول products (المنتجات)
-- ============================================

CREATE POLICY "Strict isolation - view products" ON products
    FOR SELECT
    USING (is_owner(user_id));

CREATE POLICY "Strict isolation - insert products" ON products
    FOR INSERT
    WITH CHECK (is_owner(user_id));

CREATE POLICY "Strict isolation - update products" ON products
    FOR UPDATE
    USING (is_owner(user_id))
    WITH CHECK (is_owner(user_id));

CREATE POLICY "Strict isolation - delete products" ON products
    FOR DELETE
    USING (is_owner(user_id));

-- ============================================
-- سياسات جدول orders (الطلبات)
-- ============================================

CREATE POLICY "Strict isolation - view orders" ON orders
    FOR SELECT
    USING (is_owner(user_id));

CREATE POLICY "Strict isolation - insert orders" ON orders
    FOR INSERT
    WITH CHECK (is_owner(user_id));

CREATE POLICY "Strict isolation - update orders" ON orders
    FOR UPDATE
    USING (is_owner(user_id))
    WITH CHECK (is_owner(user_id));

CREATE POLICY "Strict isolation - delete orders" ON orders
    FOR DELETE
    USING (is_owner(user_id));

-- ============================================
-- سياسات الجداول الأخرى
-- ============================================

-- categories
CREATE POLICY "Strict view categories" ON categories FOR SELECT USING (is_owner(user_id));
CREATE POLICY "Strict insert categories" ON categories FOR INSERT WITH CHECK (is_owner(user_id));
CREATE POLICY "Strict update categories" ON categories FOR UPDATE USING (is_owner(user_id)) WITH CHECK (is_owner(user_id));
CREATE POLICY "Strict delete categories" ON categories FOR DELETE USING (is_owner(user_id));

-- suppliers
CREATE POLICY "Strict view suppliers" ON suppliers FOR SELECT USING (is_owner(user_id));
CREATE POLICY "Strict insert suppliers" ON suppliers FOR INSERT WITH CHECK (is_owner(user_id));
CREATE POLICY "Strict update suppliers" ON suppliers FOR UPDATE USING (is_owner(user_id)) WITH CHECK (is_owner(user_id));
CREATE POLICY "Strict delete suppliers" ON suppliers FOR DELETE USING (is_owner(user_id));

-- sales
CREATE POLICY "Strict view sales" ON sales FOR SELECT USING (is_owner(user_id));
CREATE POLICY "Strict insert sales" ON sales FOR INSERT WITH CHECK (is_owner(user_id));
CREATE POLICY "Strict update sales" ON sales FOR UPDATE USING (is_owner(user_id)) WITH CHECK (is_owner(user_id));
CREATE POLICY "Strict delete sales" ON sales FOR DELETE USING (is_owner(user_id));

-- settings
CREATE POLICY "Strict view settings" ON settings FOR SELECT USING (is_owner(user_id));
CREATE POLICY "Strict insert settings" ON settings FOR INSERT WITH CHECK (is_owner(user_id));
CREATE POLICY "Strict update settings" ON settings FOR UPDATE USING (is_owner(user_id)) WITH CHECK (is_owner(user_id));
CREATE POLICY "Strict delete settings" ON settings FOR DELETE USING (is_owner(user_id));

-- delivery_personnel
CREATE POLICY "Strict view delivery" ON delivery_personnel FOR SELECT USING (is_owner(user_id));
CREATE POLICY "Strict insert delivery" ON delivery_personnel FOR INSERT WITH CHECK (is_owner(user_id));
CREATE POLICY "Strict update delivery" ON delivery_personnel FOR UPDATE USING (is_owner(user_id)) WITH CHECK (is_owner(user_id));
CREATE POLICY "Strict delete delivery" ON delivery_personnel FOR DELETE USING (is_owner(user_id));

-- order_status_history
CREATE POLICY "Strict view history" ON order_status_history FOR SELECT USING (is_owner(user_id));
CREATE POLICY "Strict insert history" ON order_status_history FOR INSERT WITH CHECK (is_owner(user_id));

-- delivery_tracking
CREATE POLICY "Strict view tracking" ON delivery_tracking FOR SELECT USING (is_owner(user_id));
CREATE POLICY "Strict insert tracking" ON delivery_tracking FOR INSERT WITH CHECK (is_owner(user_id));

-- analytics
CREATE POLICY "Strict view analytics" ON analytics FOR SELECT USING (is_owner(user_id));
CREATE POLICY "Strict insert analytics" ON analytics FOR INSERT WITH CHECK (is_owner(user_id));

-- ============================================
-- 5. تريجر تلقائي لتعيين user_id عند الإدراج
-- ============================================

CREATE OR REPLACE FUNCTION auto_set_user_id_strict()
RETURNS TRIGGER AS $$
DECLARE
    current_user TEXT;
BEGIN
    current_user := get_current_user_id();
    
    IF current_user IS NULL THEN
        RAISE EXCEPTION 'Access denied: user_id is required but no authenticated user found';
    END IF;
    
    -- تعيين user_id إذا كان فارغاً
    IF NEW.user_id IS NULL THEN
        NEW.user_id := current_user;
    END IF;
    
    -- التحقق من أن user_id المُدخل يطابق المستخدم الحالي
    IF NEW.user_id != current_user THEN
        RAISE EXCEPTION 'Access denied: cannot insert record for another user. Current: %, Attempted: %', current_user, NEW.user_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- تطبيق التريجر على جميع الجداول
DROP TRIGGER IF EXISTS auto_set_user_id_strict ON warehouses;
CREATE TRIGGER auto_set_user_id_strict BEFORE INSERT ON warehouses
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id_strict();

DROP TRIGGER IF EXISTS auto_set_user_id_strict ON products;
CREATE TRIGGER auto_set_user_id_strict BEFORE INSERT ON products
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id_strict();

DROP TRIGGER IF EXISTS auto_set_user_id_strict ON orders;
CREATE TRIGGER auto_set_user_id_strict BEFORE INSERT ON orders
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id_strict();

DROP TRIGGER IF EXISTS auto_set_user_id_strict ON pharmacies;
CREATE TRIGGER auto_set_user_id_strict BEFORE INSERT ON pharmacies
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id_strict();

DROP TRIGGER IF EXISTS auto_set_user_id_strict ON delivery_personnel;
CREATE TRIGGER auto_set_user_id_strict BEFORE INSERT ON delivery_personnel
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id_strict();

DROP TRIGGER IF EXISTS auto_set_user_id_strict ON categories;
CREATE TRIGGER auto_set_user_id_strict BEFORE INSERT ON categories
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id_strict();

DROP TRIGGER IF EXISTS auto_set_user_id_strict ON suppliers;
CREATE TRIGGER auto_set_user_id_strict BEFORE INSERT ON suppliers
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id_strict();

DROP TRIGGER IF EXISTS auto_set_user_id_strict ON sales;
CREATE TRIGGER auto_set_user_id_strict BEFORE INSERT ON sales
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id_strict();

DROP TRIGGER IF EXISTS auto_set_user_id_strict ON settings;
CREATE TRIGGER auto_set_user_id_strict BEFORE INSERT ON settings
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id_strict();

DROP TRIGGER IF EXISTS auto_set_user_id_strict ON order_status_history;
CREATE TRIGGER auto_set_user_id_strict BEFORE INSERT ON order_status_history
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id_strict();

DROP TRIGGER IF EXISTS auto_set_user_id_strict ON delivery_tracking;
CREATE TRIGGER auto_set_user_id_strict BEFORE INSERT ON delivery_tracking
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id_strict();

DROP TRIGGER IF EXISTS auto_set_user_id_strict ON analytics;
CREATE TRIGGER auto_set_user_id_strict BEFORE INSERT ON analytics
    FOR EACH ROW EXECUTE FUNCTION auto_set_user_id_strict();

-- ============================================
-- 6. إنشاء فهارس للأداء
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
-- 7. إعداد Real-time للعزل
-- ============================================

-- تفعيل Real-time على الجداول
ALTER PUBLICATION supabase_realtime ADD TABLE warehouses;
ALTER PUBLICATION supabase_realtime ADD TABLE products;
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE pharmacies;
ALTER PUBLICATION supabase_realtime ADD TABLE delivery_personnel;
ALTER PUBLICATION supabase_realtime ADD TABLE categories;
ALTER PUBLICATION supabase_realtime ADD TABLE suppliers;
ALTER PUBLICATION supabase_realtime ADD TABLE sales;
ALTER PUBLICATION supabase_realtime ADD TABLE settings;
ALTER PUBLICATION supabase_realtime ADD TABLE order_status_history;
ALTER PUBLICATION supabase_realtime ADD TABLE delivery_tracking;
ALTER PUBLICATION supabase_realtime ADD TABLE analytics;

SELECT 'تم تطبيق نظام العزل التام بنجاح! 🛡️' as result;
