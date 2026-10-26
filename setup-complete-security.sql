-- ============================================
-- Complete Security Setup - إعداد الأمان الشامل
-- ============================================

-- ============================================
-- 1. جدول المستخدمين (users/warehouses)
-- ============================================
-- التأكد من وجود عمود user_id أو warehouse_id
ALTER TABLE IF EXISTS pharmacies 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

ALTER TABLE IF EXISTS products 
ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES auth.users(id);

-- ============================================
-- 2. تفعيل RLS الإجباري
-- ============================================
ALTER TABLE pharmacies ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmacies FORCE ROW LEVEL SECURITY;

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;

-- ============================================
-- 3. حذف جميع السياسات القديمة
-- ============================================
-- للصيدليات
DROP POLICY IF EXISTS "pharmacies_select_own" ON pharmacies;
DROP POLICY IF EXISTS "pharmacies_insert_own" ON pharmacies;
DROP POLICY IF EXISTS "pharmacies_update_own" ON pharmacies;
DROP POLICY IF EXISTS "pharmacies_delete_own" ON pharmacies;
DROP POLICY IF EXISTS "Allow all" ON pharmacies;
DROP POLICY IF EXISTS "Users can view own" ON pharmacies;

-- للمنتجات
DROP POLICY IF EXISTS "products_select_own" ON products;
DROP POLICY IF EXISTS "products_insert_own" ON products;
DROP POLICY IF EXISTS "products_update_own" ON products;
DROP POLICY IF EXISTS "products_delete_own" ON products;
DROP POLICY IF EXISTS "products_select_warehouse" ON products;
DROP POLICY IF EXISTS "products_insert_warehouse" ON products;
DROP POLICY IF EXISTS "products_update_warehouse" ON products;
DROP POLICY IF EXISTS "products_delete_warehouse" ON products;
DROP POLICY IF EXISTS "Allow all" ON products;
DROP POLICY IF EXISTS "warehouse_isolation_select" ON products;
DROP POLICY IF EXISTS "warehouse_isolation_insert" ON products;
DROP POLICY IF EXISTS "warehouse_isolation_update" ON products;
DROP POLICY IF EXISTS "warehouse_isolation_delete" ON products;
DROP POLICY IF EXISTS "Allow warehouse owners to manage products" ON products;

-- ============================================
-- 4. إنشاء سياسات RLS صارمة
-- ============================================

-- 🏥 سياسات الصيدليات (user_id)
CREATE POLICY "pharmacies_select_own" ON pharmacies
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "pharmacies_insert_own" ON pharmacies
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "pharmacies_update_own" ON pharmacies
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "pharmacies_delete_own" ON pharmacies
    FOR DELETE USING (user_id = auth.uid());

-- 📦 سياسات المنتجات (warehouse_id)
CREATE POLICY "products_select_warehouse" ON products
    FOR SELECT USING (warehouse_id = auth.uid());

CREATE POLICY "products_insert_warehouse" ON products
    FOR INSERT WITH CHECK (warehouse_id = auth.uid());

CREATE POLICY "products_update_warehouse" ON products
    FOR UPDATE USING (warehouse_id = auth.uid());

CREATE POLICY "products_delete_warehouse" ON products
    FOR DELETE USING (warehouse_id = auth.uid());

-- ============================================
-- 5. تعيين القيم الافتراضية (DEFAULT)
-- ============================================
ALTER TABLE pharmacies 
ALTER COLUMN user_id SET DEFAULT auth.uid();

ALTER TABLE products 
ALTER COLUMN warehouse_id SET DEFAULT auth.uid();

-- ============================================
-- 6. تفعيل Realtime
-- ============================================
BEGIN;
  ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS pharmacies;
  ALTER PUBLICATION supabase_realtime ADD TABLE pharmacies;
  
  ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS products;
  ALTER PUBLICATION supabase_realtime ADD TABLE products;
COMMIT;

-- ============================================
-- 7. إنشاء دوال مساعدة (اختياري)
-- ============================================
CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS UUID AS $$
BEGIN
    RETURN auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 8. حماية إضافية: منع تحديث user_id
-- ============================================
CREATE OR REPLACE FUNCTION prevent_user_id_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.user_id IS DISTINCT FROM NEW.user_id THEN
        RAISE EXCEPTION 'Changing user_id is not allowed';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_user_id_change ON pharmacies;
CREATE TRIGGER prevent_user_id_change
    BEFORE UPDATE ON pharmacies
    FOR EACH ROW
    EXECUTE FUNCTION prevent_user_id_change();

DROP TRIGGER IF EXISTS prevent_warehouse_id_change ON products;
CREATE TRIGGER prevent_warehouse_id_change
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION prevent_user_id_change();

-- ============================================
-- التحقق من الإعداد
-- ============================================
SELECT 
    'Security setup complete!' as status,
    (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'pharmacies') as pharmacy_policies,
    (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'products') as product_policies;
