-- ============================================
-- إصلاح RLS لجدول products - عزل بيانات صارم
-- ============================================

-- 1. التأكد من وجود عمود warehouse_id
ALTER TABLE IF EXISTS products 
ADD COLUMN IF NOT EXISTS warehouse_id TEXT;

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

-- 7. إنشاء سياسات RLS مباشرة باستخدام auth.uid()
-- سياسة القراءة: المخزن يرى فقط منتجاته
CREATE POLICY "warehouse_isolation_select" ON products
    FOR SELECT
    USING (warehouse_id = auth.uid()::text);

-- سياسة الإضافة: مع شرط WITH CHECK صارم
CREATE POLICY "warehouse_isolation_insert" ON products
    FOR INSERT
    WITH CHECK (warehouse_id = auth.uid()::text);

-- سياسة التحديث: فقط منتجات المخزن الحالي
CREATE POLICY "warehouse_isolation_update" ON products
    FOR UPDATE
    USING (warehouse_id = auth.uid()::text)
    WITH CHECK (warehouse_id = auth.uid()::text);

-- سياسة الحذف: فقط منتجات المخزن الحالي
CREATE POLICY "warehouse_isolation_delete" ON products
    FOR DELETE
    USING (warehouse_id = auth.uid()::text);

-- 8. تعيين القيمة الافتراضية لـ warehouse_id (إذا كان العمود فارغاً)
-- ملاحظة: auth.uid() لا يعمل في DEFAULT، لذا نستخدم Trigger أو نتركه للكود
-- لكن نضع default على NULL للسماح للكود بإدخاله

-- 9. إضافة للـ Realtime publication
BEGIN;
  ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS products;
  ALTER PUBLICATION supabase_realtime ADD TABLE products;
COMMIT;

SELECT '✅ RLS for products configured successfully! warehouse_id = auth.uid()::text' as result;
