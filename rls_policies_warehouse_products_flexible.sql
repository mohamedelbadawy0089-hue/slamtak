-- سياسات RLS محسنة لجدول warehouse_products_flexible
-- تعتمد على التحقق الصريح من warehouse_id لضمان الأمان وعزل البيانات

-- 1. تفعيل RLS على الجدول
ALTER TABLE warehouse_products_flexible ENABLE ROW LEVEL SECURITY;

-- 2. إزالة السياسات القديمة إذا وجدت
DROP POLICY IF EXISTS "Users can view products in their warehouses" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can insert products in their warehouses" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can update products in their warehouses" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can delete products in their warehouses" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can view products via direct join" ON warehouse_products_flexible;

-- 3. سياسة محسنة للقراءة (SELECT)
-- تسمح للمستخدم برؤية المنتجات التي تنتمي لمخازنه فقط
CREATE POLICY "Users can view products in their warehouses"
    ON warehouse_products_flexible FOR SELECT
    USING (
        warehouse_id IN (
            SELECT id FROM warehouses 
            WHERE user_id = auth.uid()
        )
    );

-- 4. سياسة محسنة للإضافة (INSERT)
-- تسمح للمستخدم بإضافة منتجات لمخازنه فقط
CREATE POLICY "Users can insert products in their warehouses"
    ON warehouse_products_flexible FOR INSERT
    WITH CHECK (
        warehouse_id IN (
            SELECT id FROM warehouses 
            WHERE user_id = auth.uid()
        )
    );

-- 5. سياسة محسنة للتعديل (UPDATE)
-- تسمح للمستخدم بتعديل المنتجات التي تنتمي لمخازنه فقط
CREATE POLICY "Users can update products in their warehouses"
    ON warehouse_products_flexible FOR UPDATE
    USING (
        warehouse_id IN (
            SELECT id FROM warehouses 
            WHERE user_id = auth.uid()
        )
    )
    WITH CHECK (
        warehouse_id IN (
            SELECT id FROM warehouses 
            WHERE user_id = auth.uid()
        )
    );

-- 6. سياسة محسنة للحذف (DELETE)
-- تسمح للمستخدم بحذف المنتجات التي تنتمي لمخازنه فقط
CREATE POLICY "Users can delete products in their warehouses"
    ON warehouse_products_flexible FOR DELETE
    USING (
        warehouse_id IN (
            SELECT id FROM warehouses 
            WHERE user_id = auth.uid()
        )
    );

-- 7. سياسة بديلة للقراءة باستخدام JOIN مباشر (أكثر كفاءة)
-- هذه السياسة تستخدم JOIN مباشر بدلاً من EXISTS لتحسين الأداء
CREATE POLICY "Users can view products via direct join"
    ON warehouse_products_flexible FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM warehouses w
            WHERE w.id = warehouse_products_flexible.warehouse_id
            AND w.user_id = auth.uid()
        )
    );

-- 8. إضافة فهرس مركب لتحسين أداء الاستعلامات مع RLS
CREATE INDEX IF NOT EXISTS idx_warehouse_products_warehouse_id_user_id 
    ON warehouse_products_flexible(warehouse_id);

-- 9. إضافة فهرس على user_id في جدول warehouses لتحسين أداء JOIN
CREATE INDEX IF NOT EXISTS idx_warehouses_user_id 
    ON warehouses(user_id);

-- 10. التحقق من تفعيل RLS
SELECT 
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'warehouse_products_flexible';
