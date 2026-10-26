-- =====================================================
-- سياسات أمان شاملة (RLS) للمخازن المتعددة المستقلة
-- =====================================================

-- 1. تفعيل RLS على جدول warehouses
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

-- 2. حذف السياسات القديمة
DROP POLICY IF EXISTS "warehouses_select_own" ON warehouses;
DROP POLICY IF EXISTS "warehouses_insert_own" ON warehouses;
DROP POLICY IF EXISTS "warehouses_update_own" ON warehouses;
DROP POLICY IF EXISTS "warehouses_delete_own" ON warehouses;

-- 3. سياسات RLS لجدول warehouses

-- SELECT: المستخدم يرى مخزنه فقط (بناءً على auth.uid)
CREATE POLICY "warehouses_select_own"
ON warehouses
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- INSERT: المستخدم ينشئ مخزناً مرتبطاً به فقط
CREATE POLICY "warehouses_insert_own"
ON warehouses
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- UPDATE: المستخدم يعدل مخزنه فقط
CREATE POLICY "warehouses_update_own"
ON warehouses
FOR UPDATE
TO authenticated
USING (user_id = auth.uid());

-- DELETE: المستخدم يحذف مخزنه فقط
CREATE POLICY "warehouses_delete_own"
ON warehouses
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- =====================================================
-- سياسات RLS لجدول products (عزل تام بين المخازن)
-- =====================================================

-- 1. تفعيل RLS على products
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- 2. حذف السياسات القديمة
DROP POLICY IF EXISTS "products_select_own_warehouse" ON products;
DROP POLICY IF EXISTS "products_insert_own_warehouse" ON products;
DROP POLICY IF EXISTS "products_update_own_warehouse" ON products;
DROP POLICY IF EXISTS "products_delete_own_warehouse" ON products;

-- 3. سياسات RLS لجدول products

-- SELECT: المستخدم يرى منتجات مخزنه فقط
CREATE POLICY "products_select_own_warehouse"
ON products
FOR SELECT
TO authenticated
USING (
    warehouse_id IN (
        SELECT id FROM warehouses WHERE user_id = auth.uid()
    )
);

-- INSERT: المستخدم يضيف منتجات لمخزنه فقط
CREATE POLICY "products_insert_own_warehouse"
ON products
FOR INSERT
TO authenticated
WITH CHECK (
    warehouse_id IN (
        SELECT id FROM warehouses WHERE user_id = auth.uid()
    )
);

-- UPDATE: المستخدم يعدل منتجات مخزنه فقط
CREATE POLICY "products_update_own_warehouse"
ON products
FOR UPDATE
TO authenticated
USING (
    warehouse_id IN (
        SELECT id FROM warehouses WHERE user_id = auth.uid()
    )
);

-- DELETE: المستخدم يحذف منتجات مخزنه فقط
CREATE POLICY "products_delete_own_warehouse"
ON products
FOR DELETE
TO authenticated
USING (
    warehouse_id IN (
        SELECT id FROM warehouses WHERE user_id = auth.uid()
    )
);

-- =====================================================
-- رسالة نجاح
-- =====================================================
SELECT '✅ تم تطبيق سياسات الأمان بنجاح! كل مخزن معزول تماماً.' as status;

-- التحقق من السياسات
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies 
WHERE tablename IN ('warehouses', 'products')
ORDER BY tablename, policyname;
