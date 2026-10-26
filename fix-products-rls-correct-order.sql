-- ============================================
-- إصلاح RLS لجدول products - الترتيب الصحيح
-- ============================================

-- 1. حذف جميع السياسات القديمة أولاً (يجب حذفها قبل تعديل العمود)
DROP POLICY IF EXISTS "products_select_own" ON products;
DROP POLICY IF EXISTS "products_insert_own" ON products;
DROP POLICY IF EXISTS "products_update_own" ON products;
DROP POLICY IF EXISTS "products_delete_own" ON products;
DROP POLICY IF EXISTS "products_select_warehouse" ON products;
DROP POLICY IF EXISTS "products_insert_warehouse" ON products;
DROP POLICY IF EXISTS "products_update_warehouse" ON products;
DROP POLICY IF EXISTS "products_delete_warehouse" ON products;
DROP POLICY IF EXISTS "products_select_own_warehouse" ON products;
DROP POLICY IF EXISTS "products_insert_own_warehouse" ON products;
DROP POLICY IF EXISTS "products_update_own_warehouse" ON products;
DROP POLICY IF EXISTS "products_delete_own_warehouse" ON products;
DROP POLICY IF EXISTS "Allow anonymous access" ON products;
DROP POLICY IF EXISTS "Users can view own" ON products;
DROP POLICY IF EXISTS "Users can insert own" ON products;
DROP POLICY IF EXISTS "Users can update own" ON products;
DROP POLICY IF EXISTS "Users can delete own" ON products;
DROP POLICY IF EXISTS "warehouse_isolation_select" ON products;
DROP POLICY IF EXISTS "warehouse_isolation_insert" ON products;
DROP POLICY IF EXISTS "warehouse_isolation_update" ON products;
DROP POLICY IF EXISTS "warehouse_isolation_delete" ON products;

-- 2. حذف جميع الـ Triggers
DROP TRIGGER IF EXISTS auto_set_product_user_id ON products;
DROP TRIGGER IF EXISTS auto_set_warehouse_id ON products;
DROP TRIGGER IF EXISTS set_warehouse_id ON products;
DROP TRIGGER IF EXISTS set_user_id ON products;

-- 3. حذف جميع الدوال
DROP FUNCTION IF EXISTS auto_set_product_user_id();
DROP FUNCTION IF EXISTS auto_set_warehouse_id();
DROP FUNCTION IF EXISTS get_warehouse_id();
DROP FUNCTION IF EXISTS get_auth_user_id();
DROP FUNCTION IF EXISTS get_auth_warehouse_id();

-- 4. إزالة أي Foreign Key Constraints
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_user_id_fkey;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_warehouse_id_fkey;

-- 5. الآن يمكن تغيير نوع العمود (بعد حذف السياسات)
ALTER TABLE products 
ALTER COLUMN warehouse_id TYPE TEXT USING warehouse_id::text;

-- 6. تفعيل RLS الإجباري
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;

-- 7. إنشاء سياسات RLS جديدة (بعد تغيير نوع العمود)
CREATE POLICY "warehouse_isolation_select" ON products
    FOR SELECT
    USING (warehouse_id = auth.uid()::text);

CREATE POLICY "warehouse_isolation_insert" ON products
    FOR INSERT
    WITH CHECK (warehouse_id = auth.uid()::text);

CREATE POLICY "warehouse_isolation_update" ON products
    FOR UPDATE
    USING (warehouse_id = auth.uid()::text)
    WITH CHECK (warehouse_id = auth.uid()::text);

CREATE POLICY "warehouse_isolation_delete" ON products
    FOR DELETE
    USING (warehouse_id = auth.uid()::text);

-- 8. إضافة للـ Realtime
BEGIN;
  ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS products;
  ALTER PUBLICATION supabase_realtime ADD TABLE products;
COMMIT;

SELECT '✅ RLS fixed! Policies dropped, column altered, policies recreated.' as result;
