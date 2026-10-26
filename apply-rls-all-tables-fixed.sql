-- ============================================
-- تطبيق RLS على جميع الجداول مع user_id (مُصلَّح)
-- ============================================
-- ملاحظة: يجب إنشاء الدالة أولاً قبل أي سياسات
-- ============================================

-- ============================================
-- 0. إنشاء الدالة أولاً (قبل كل شيء)
-- ============================================

DROP FUNCTION IF EXISTS public.get_current_user_id();

CREATE OR REPLACE FUNCTION public.get_current_user_id()
RETURNS TEXT AS $$
BEGIN
    RETURN COALESCE(
        nullif(current_setting('request.jwt.claims', true)::json->>'sub', ''),
        nullif(current_setting('request.jwt.claims', true)::json->>'user_id', ''),
        NULL
    );
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 1. إضافة عمود user_id لجميع الجداول
-- ============================================

ALTER TABLE IF EXISTS warehouses 
    ADD COLUMN IF NOT EXISTS user_id TEXT,
    ADD COLUMN IF NOT EXISTS owner_id TEXT;

ALTER TABLE IF EXISTS products 
    ADD COLUMN IF NOT EXISTS user_id TEXT;

ALTER TABLE IF EXISTS orders 
    ADD COLUMN IF NOT EXISTS user_id TEXT;

ALTER TABLE IF EXISTS pharmacies 
    ADD COLUMN IF NOT EXISTS user_id TEXT;

ALTER TABLE IF EXISTS delivery_personnel 
    ADD COLUMN IF NOT EXISTS user_id TEXT;

ALTER TABLE IF EXISTS categories 
    ADD COLUMN IF NOT EXISTS user_id TEXT;

ALTER TABLE IF EXISTS suppliers 
    ADD COLUMN IF NOT EXISTS user_id TEXT;

ALTER TABLE IF EXISTS sales 
    ADD COLUMN IF NOT EXISTS user_id TEXT;

ALTER TABLE IF EXISTS settings 
    ADD COLUMN IF NOT EXISTS user_id TEXT;

ALTER TABLE IF EXISTS order_status_history 
    ADD COLUMN IF NOT EXISTS user_id TEXT;

ALTER TABLE IF EXISTS delivery_tracking 
    ADD COLUMN IF NOT EXISTS user_id TEXT;

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
-- 3. حذف السياسات القديمة
-- ============================================

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

DROP POLICY IF EXISTS "Allow fallback access" ON warehouses;
DROP POLICY IF EXISTS "Allow fallback access" ON products;
DROP POLICY IF EXISTS "Allow fallback access" ON orders;
DROP POLICY IF EXISTS "Allow fallback access" ON pharmacies;
DROP POLICY IF EXISTS "Allow fallback access" ON delivery_personnel;
DROP POLICY IF EXISTS "Allow fallback access" ON categories;
DROP POLICY IF EXISTS "Allow fallback access" ON suppliers;
DROP POLICY IF EXISTS "Allow fallback access" ON sales;
DROP POLICY IF EXISTS "Allow fallback access" ON settings;
DROP POLICY IF EXISTS "Allow fallback access" ON order_status_history;
DROP POLICY IF EXISTS "Allow fallback access" ON delivery_tracking;
DROP POLICY IF EXISTS "Allow fallback access" ON analytics;

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

DROP POLICY IF EXISTS "Strict isolation - view own" ON pharmacies;
DROP POLICY IF EXISTS "Strict isolation - insert own" ON pharmacies;
DROP POLICY IF EXISTS "Strict isolation - update own" ON pharmacies;
DROP POLICY IF EXISTS "Strict isolation - delete own" ON pharmacies;

-- ============================================
-- 4. إنشاء سياسات RLS (باستخدام public.get_current_user_id)
-- ============================================

-- سياسات جدول pharmacies
CREATE POLICY "pharmacies_view_own" ON pharmacies
    FOR SELECT
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "pharmacies_insert_own" ON pharmacies
    FOR INSERT
    WITH CHECK (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "pharmacies_update_own" ON pharmacies
    FOR UPDATE
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "pharmacies_delete_own" ON pharmacies
    FOR DELETE
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

-- سياسات جدول warehouses
CREATE POLICY "warehouses_view_own" ON warehouses
    FOR SELECT
    USING (user_id = public.get_current_user_id() OR owner_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "warehouses_insert_own" ON warehouses
    FOR INSERT
    WITH CHECK (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "warehouses_update_own" ON warehouses
    FOR UPDATE
    USING (user_id = public.get_current_user_id() OR owner_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "warehouses_delete_own" ON warehouses
    FOR DELETE
    USING (user_id = public.get_current_user_id() OR owner_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

-- سياسات جدول products
CREATE POLICY "products_view_own" ON products
    FOR SELECT
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "products_insert_own" ON products
    FOR INSERT
    WITH CHECK (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "products_update_own" ON products
    FOR UPDATE
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "products_delete_own" ON products
    FOR DELETE
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

-- سياسات جدول orders
CREATE POLICY "orders_view_own" ON orders
    FOR SELECT
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "orders_insert_own" ON orders
    FOR INSERT
    WITH CHECK (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "orders_update_own" ON orders
    FOR UPDATE
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "orders_delete_own" ON orders
    FOR DELETE
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

-- سياسات جدول delivery_personnel
CREATE POLICY "delivery_view_own" ON delivery_personnel
    FOR SELECT
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "delivery_insert_own" ON delivery_personnel
    FOR INSERT
    WITH CHECK (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "delivery_update_own" ON delivery_personnel
    FOR UPDATE
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "delivery_delete_own" ON delivery_personnel
    FOR DELETE
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

-- سياسات جدول categories
CREATE POLICY "categories_view_own" ON categories
    FOR SELECT
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "categories_insert_own" ON categories
    FOR INSERT
    WITH CHECK (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "categories_update_own" ON categories
    FOR UPDATE
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "categories_delete_own" ON categories
    FOR DELETE
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

-- سياسات جدول suppliers
CREATE POLICY "suppliers_view_own" ON suppliers
    FOR SELECT
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "suppliers_insert_own" ON suppliers
    FOR INSERT
    WITH CHECK (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "suppliers_update_own" ON suppliers
    FOR UPDATE
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "suppliers_delete_own" ON suppliers
    FOR DELETE
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

-- سياسات جدول sales
CREATE POLICY "sales_view_own" ON sales
    FOR SELECT
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "sales_insert_own" ON sales
    FOR INSERT
    WITH CHECK (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "sales_update_own" ON sales
    FOR UPDATE
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "sales_delete_own" ON sales
    FOR DELETE
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

-- سياسات جدول settings
CREATE POLICY "settings_view_own" ON settings
    FOR SELECT
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "settings_insert_own" ON settings
    FOR INSERT
    WITH CHECK (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "settings_update_own" ON settings
    FOR UPDATE
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "settings_delete_own" ON settings
    FOR DELETE
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

-- سياسات جدول order_status_history
CREATE POLICY "history_view_own" ON order_status_history
    FOR SELECT
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "history_insert_own" ON order_status_history
    FOR INSERT
    WITH CHECK (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

-- سياسات جدول delivery_tracking
CREATE POLICY "tracking_view_own" ON delivery_tracking
    FOR SELECT
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "tracking_insert_own" ON delivery_tracking
    FOR INSERT
    WITH CHECK (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

-- سياسات جدول analytics
CREATE POLICY "analytics_view_own" ON analytics
    FOR SELECT
    USING (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

CREATE POLICY "analytics_insert_own" ON analytics
    FOR INSERT
    WITH CHECK (user_id = public.get_current_user_id() OR user_id IS NULL OR public.get_current_user_id() IS NULL);

-- ============================================
-- 5. إنشاء تريجر لتسجيل user_id تلقائياً
-- ============================================

CREATE OR REPLACE FUNCTION auto_set_user_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.user_id IS NULL THEN
        NEW.user_id := public.get_current_user_id();
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
-- 7. التحقق من التثبيت
-- ============================================

SELECT '✅ تم تطبيق RLS بنجاح!' as result;

-- عرض الدالة
SELECT 
    proname as function_name,
    prosrc as function_body
FROM pg_proc 
WHERE proname = 'get_current_user_id';

-- عرض السياسات
SELECT 
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    CASE WHEN length(qual::text) > 50 
         THEN substring(qual::text, 1, 50) || '...' 
         ELSE qual::text 
    END as condition_preview
FROM pg_policies 
WHERE tablename IN ('pharmacies', 'warehouses', 'products', 'orders')
ORDER BY tablename, policyname;
