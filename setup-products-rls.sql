-- ============================================
-- إعداد RLS لجدول المنتجات (products)
-- ============================================

-- 1. التأكد من وجود عمود warehouse_id
ALTER TABLE products ADD COLUMN IF NOT EXISTS warehouse_id TEXT;

-- 2. إزالة أي Foreign Key Constraint
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_warehouse_id_fkey;

-- 3. تفعيل RLS الإجباري
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;

-- 4. حذف جميع السياسات القديمة (user_id و warehouse_id)
DROP POLICY IF EXISTS "products_select_own" ON products;
DROP POLICY IF EXISTS "products_insert_own" ON products;
DROP POLICY IF EXISTS "products_update_own" ON products;
DROP POLICY IF EXISTS "products_delete_own" ON products;
DROP POLICY IF EXISTS "Allow anonymous access" ON products;
DROP POLICY IF EXISTS "Users can view own" ON products;
DROP POLICY IF EXISTS "Users can insert own" ON products;
DROP POLICY IF EXISTS "Users can update own" ON products;
DROP POLICY IF EXISTS "Users can delete own" ON products;
DROP POLICY IF EXISTS "products_select_warehouse" ON products;
DROP POLICY IF EXISTS "products_insert_warehouse" ON products;
DROP POLICY IF EXISTS "products_update_warehouse" ON products;
DROP POLICY IF EXISTS "products_delete_warehouse" ON products;

-- 5. إنشاء دالة مساعدة لجلب warehouse_id من auth
CREATE OR REPLACE FUNCTION get_warehouse_id()
RETURNS TEXT AS $$
BEGIN
    RETURN auth.uid()::text;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. إنشاء سياسات RLS صارمة باستخدام warehouse_id
CREATE POLICY "products_select_warehouse" ON products
    FOR SELECT
    USING (warehouse_id = get_warehouse_id() OR warehouse_id IS NULL);

CREATE POLICY "products_insert_warehouse" ON products
    FOR INSERT
    WITH CHECK (warehouse_id = get_warehouse_id() OR warehouse_id IS NULL);

CREATE POLICY "products_update_warehouse" ON products
    FOR UPDATE
    USING (warehouse_id = get_warehouse_id())
    WITH CHECK (warehouse_id = get_warehouse_id());

CREATE POLICY "products_delete_warehouse" ON products
    FOR DELETE
    USING (warehouse_id = get_warehouse_id());

-- 7. تريجر تلقائي لتعيين warehouse_id من supabase.auth
CREATE OR REPLACE FUNCTION auto_set_warehouse_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.warehouse_id IS NULL THEN
        NEW.warehouse_id = auth.uid()::text;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS auto_set_warehouse_id ON products;
DROP TRIGGER IF EXISTS auto_set_product_user_id ON products;
CREATE TRIGGER auto_set_warehouse_id
    BEFORE INSERT ON products
    FOR EACH ROW
    EXECUTE FUNCTION auto_set_warehouse_id();

-- 8. إضافة للـ Realtime publication
BEGIN;
  -- إزالة من publication إذا موجود
  ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS products;
  -- إضافة للpublication
  ALTER PUBLICATION supabase_realtime ADD TABLE products;
COMMIT;

SELECT '✅ RLS for products configured successfully!' as result;
