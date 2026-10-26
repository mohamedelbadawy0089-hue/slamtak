-- ============================================
-- إعداد RLS لجدول المنتجات (products) باستخدام warehouse_id
-- ============================================

-- 1. التأكد من وجود عمود warehouse_id
ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS warehouse_id TEXT;

-- 2. إزالة أي Foreign Key Constraint قديم
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_user_id_fkey;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_warehouse_id_fkey;

-- 3. تفعيل RLS الإجباري
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;

-- 4. حذف جميع السياسات القديمة
DROP POLICY IF EXISTS "products_select_own" ON products;
DROP POLICY IF EXISTS "products_insert_own" ON products;
DROP POLICY IF EXISTS "products_update_own" ON products;
DROP POLICY IF EXISTS "products_delete_own" ON products;
DROP POLICY IF EXISTS "products_select_warehouse" ON products;
DROP POLICY IF EXISTS "products_insert_warehouse" ON products;
DROP POLICY IF EXISTS "products_update_warehouse" ON products;
DROP POLICY IF EXISTS "products_delete_warehouse" ON products;
DROP POLICY IF EXISTS "Allow anonymous access" ON products;
DROP POLICY IF EXISTS "Users can view own" ON products;
DROP POLICY IF EXISTS "Users can insert own" ON products;
DROP POLICY IF EXISTS "Users can update own" ON products;
DROP POLICY IF EXISTS "Users can delete own" ON products;

-- 5. إنشاء دالة مساعدة لجلب warehouse_id من auth
CREATE OR REPLACE FUNCTION get_auth_warehouse_id()
RETURNS TEXT AS $$
BEGIN
    RETURN auth.uid()::text;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. إنشاء سياسات RLS صارمة باستخدام warehouse_id
-- سياسة القراءة: المخزن يرى فقط منتجاته
CREATE POLICY "products_select_warehouse" ON products
    FOR SELECT
    USING (warehouse_id = get_auth_warehouse_id());

-- سياسة الإضافة: مع شرط WITH CHECK لمنع ID مخزن آخر
CREATE POLICY "products_insert_warehouse" ON products
    FOR INSERT
    WITH CHECK (warehouse_id = get_auth_warehouse_id());

-- سياسة التحديث: فقط منتجات المخزن الحالي
CREATE POLICY "products_update_warehouse" ON products
    FOR UPDATE
    USING (warehouse_id = get_auth_warehouse_id())
    WITH CHECK (warehouse_id = get_auth_warehouse_id());

-- سياسة الحذف: فقط منتجات المخزن الحالي
CREATE POLICY "products_delete_warehouse" ON products
    FOR DELETE
    USING (warehouse_id = get_auth_warehouse_id());

-- 7. تريجر تلقائي لتعيين warehouse_id الافتراضي
CREATE OR REPLACE FUNCTION auto_set_warehouse_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.warehouse_id IS NULL OR NEW.warehouse_id = '' THEN
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

-- 8. تعطيل التريجر مؤقتاً للـ service role (إذا لزم الأمر)
COMMENT ON FUNCTION auto_set_warehouse_id() IS 'يضبط warehouse_id تلقائياً من auth.uid()';

-- 9. إضافة للـ Realtime publication
BEGIN;
  ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS products;
  ALTER PUBLICATION supabase_realtime ADD TABLE products;
COMMIT;

-- 10. تحديث القيم الموجودة (اختياري - إذا كان هناك بيانات قديمة)
-- UPDATE products SET warehouse_id = user_id WHERE warehouse_id IS NULL AND user_id IS NOT NULL;

SELECT '✅ RLS for products (warehouse_id) configured successfully!' as result;
