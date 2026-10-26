-- إزالة أي سياسات قديمة متعارضة
DROP POLICY IF EXISTS "Unified flexible warehouse products policy" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can insert products in their warehouses" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can view products in their warehouses" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can update products in their warehouses" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can delete products in their warehouses" ON warehouse_products_flexible;

-- إنشاء سياسة موحدة لا تعتمد على أي دوال خارجية (Functions) بل تستخدم استعلام مباشر وآمن
CREATE POLICY "Unified flexible warehouse products policy"
ON warehouse_products_flexible
FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM warehouses 
        WHERE warehouses.id = warehouse_products_flexible.warehouse_id 
        AND warehouses.user_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM warehouses 
        WHERE warehouses.id = warehouse_id 
        AND warehouses.user_id = auth.uid()
    )
);

-- التأكد من تفعيل RLS على الجدول
ALTER TABLE warehouse_products_flexible ENABLE ROW LEVEL SECURITY;
