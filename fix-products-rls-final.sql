-- ============================================
-- إصلاح RLS لجدول products - حل مشكلة UUID vs TEXT
-- ============================================

-- 1. تغيير نوع عمود warehouse_id إلى TEXT للتوافق مع auth.uid()::text
ALTER TABLE IF EXISTS products 
ALTER COLUMN warehouse_id TYPE TEXT USING warehouse_id::text;

-- 2. إزالة أي Foreign Key Constraints
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_user_id_fkey;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_warehouse_id_fkey;

-- 3. حذف جميع الـ Triggers القديمة
DROP TRIGGER IF EXISTS auto_set_product_user_id ON products;
DROP TRIGGER IF EXISTS auto_set_warehouse_id ON products;
DROP TRIGGER IF EXISTS set_warehouse_id ON products;
DROP TRIGGER IF EXISTS set_user_id ON products;

-- 4. حذف جميع الدوال القديمة
DROP FUNCTION IF EXISTS auto_set_product_user_id();
DROP FUNCTION IF EXISTS auto_set_warehouse_id();
DROP FUNCTION IF EXISTS get_warehouse_id();
DROP FUNCTION IF EXISTS get_auth_user_id();
DROP FUNCTION IF EXISTS get_auth_warehouse_id();

-- 5. تفعيل RLS الإجباري
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;

-- 6. حذف جميع السياسات القديمة
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
DROP POLICY IF EXISTS "warehouse_isolation_select" ON products;
DROP POLICY IF EXISTS "warehouse_isolation_insert" ON products;
DROP POLICY IF EXISTS "warehouse_isolation_update" ON products;
DROP POLICY IF EXISTS "warehouse_isolation_delete" ON products;

-- 7. إنشاء سياسات RLS باستخدام CAST للتأكد من التوافق
-- سياسة القراءة
CREATE POLICY "warehouse_isolation_select" ON products
    FOR SELECT
    USING (warehouse_id::text = auth.uid()::text);

-- سياسة الإضافة
CREATE POLICY "warehouse_isolation_insert" ON products
    FOR INSERT
    WITH CHECK (warehouse_id::text = auth.uid()::text);

-- سياسة التحديث
CREATE POLICY "warehouse_isolation_update" ON products
    FOR UPDATE
    USING (warehouse_id::text = auth.uid()::text)
    WITH CHECK (warehouse_id::text = auth.uid()::text);

-- سياسة الحذف
CREATE POLICY "warehouse_isolation_delete" ON products
    FOR DELETE
    USING (warehouse_id::text = auth.uid()::text);

-- 8. إضافة للـ Realtime publication
BEGIN;
  ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS products;
  ALTER PUBLICATION supabase_realtime ADD TABLE products;
COMMIT;

SELECT '✅ RLS fixed! warehouse_id and auth.uid() both cast to TEXT' as result;
