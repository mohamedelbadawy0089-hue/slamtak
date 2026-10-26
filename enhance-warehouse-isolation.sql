-- تعزيز عزل واستقلالية بيانات المخازن
-- Enhanced Warehouse Isolation & Data Persistence

-- 1. إضافة أعمدة بيانات المورد لجدول المخزون الرئيسي
ALTER TABLE warehouse_inventory 
ADD COLUMN IF NOT EXISTS supplier_name TEXT,
ADD COLUMN IF NOT EXISTS supplier_phone TEXT,
ADD COLUMN IF NOT EXISTS supplier_address TEXT,
ADD COLUMN IF NOT EXISTS invoice_number TEXT,
ADD COLUMN IF NOT EXISTS purchase_date DATE;

-- 2. إضافة أعمدة بيانات المورد لجدول المنتجات المخصصة
ALTER TABLE warehouse_custom_products 
ADD COLUMN IF NOT EXISTS supplier_name TEXT,
ADD COLUMN IF NOT EXISTS supplier_phone TEXT,
ADD COLUMN IF NOT EXISTS supplier_address TEXT,
ADD COLUMN IF NOT EXISTS invoice_number TEXT,
ADD COLUMN IF NOT EXISTS purchase_date DATE;

-- 3. إنشاء فهرسة لتسريع البحث عن المنتجات المثبتة
CREATE INDEX IF NOT EXISTS idx_warehouse_inventory_name 
ON warehouse_inventory USING gin(to_tsvector('arabic', COALESCE(master_products.name_en, '')));

CREATE INDEX IF NOT EXISTS idx_warehouse_custom_products_name 
ON warehouse_custom_products USING gin(to_tsvector('arabic', name_en));

-- 4. تحديث سياسات RLS لضمان العزل الكامل
DROP POLICY IF EXISTS "Users can only see their own inventory" ON warehouse_inventory;
DROP POLICY IF EXISTS "Users can only insert their own inventory" ON warehouse_inventory;
DROP POLICY IF EXISTS "Users can only update their own inventory" ON warehouse_inventory;
DROP POLICY IF EXISTS "Users can only delete their own inventory" ON warehouse_inventory;

CREATE POLICY "Warehouse isolation - SELECT" ON warehouse_inventory 
FOR SELECT USING (warehouse_id IN (
    SELECT id FROM warehouses 
    WHERE user_id = auth.uid()
));

CREATE POLICY "Warehouse isolation - INSERT" ON warehouse_inventory 
FOR INSERT WITH CHECK (warehouse_id IN (
    SELECT id FROM warehouses 
    WHERE user_id = auth.uid()
));

CREATE POLICY "Warehouse isolation - UPDATE" ON warehouse_inventory 
FOR UPDATE USING (warehouse_id IN (
    SELECT id FROM warehouses 
    WHERE user_id = auth.uid()
));

CREATE POLICY "Warehouse isolation - DELETE" ON warehouse_inventory 
FOR DELETE USING (warehouse_id IN (
    SELECT id FROM warehouses 
    WHERE user_id = auth.uid()
));

-- 5. تحديث سياسات المنتجات المخصصة
DROP POLICY IF EXISTS "Users can only see their own custom products" ON warehouse_custom_products;
DROP POLICY IF EXISTS "Users can only insert their own custom products" ON warehouse_custom_products;
DROP POLICY IF EXISTS "Users can only update their own custom products" ON warehouse_custom_products;
DROP POLICY IF EXISTS "Users can only delete their own custom products" ON warehouse_custom_products;

CREATE POLICY "Custom products isolation - SELECT" ON warehouse_custom_products 
FOR SELECT USING (warehouse_id IN (
    SELECT id FROM warehouses 
    WHERE user_id = auth.uid()
));

CREATE POLICY "Custom products isolation - INSERT" ON warehouse_custom_products 
FOR INSERT WITH CHECK (warehouse_id IN (
    SELECT id FROM warehouses 
    WHERE user_id = auth.uid()
));

CREATE POLICY "Custom products isolation - UPDATE" ON warehouse_custom_products 
FOR UPDATE USING (warehouse_id IN (
    SELECT id FROM warehouses 
    WHERE user_id = auth.uid()
));

CREATE POLICY "Custom products isolation - DELETE" ON warehouse_custom_products 
FOR DELETE USING (warehouse_id IN (
    SELECT id FROM warehouses 
    WHERE user_id = auth.uid()
));

-- 6. إضافة عمود is_permanent لتثبيت السجلات
ALTER TABLE warehouse_inventory 
ADD COLUMN IF NOT EXISTS is_permanent BOOLEAN DEFAULT true;

ALTER TABLE warehouse_custom_products 
ADD COLUMN IF NOT EXISTS is_permanent BOOLEAN DEFAULT true;

-- 7. إنشاء دالة للبحث المتقدم في المنتجات المثبتة
CREATE OR REPLACE FUNCTION search_permanent_products(
    search_term TEXT,
    warehouse_uuid UUID
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    type TEXT,
    quantity INTEGER,
    price NUMERIC,
    discount NUMERIC,
    batch_number TEXT,
    expiry_date DATE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        wi.id,
        mp.name_en as name,
        'master' as type,
        wi.quantity,
        wi.price,
        wi.discount,
        wi.batch_number,
        wi.expiry_date
    FROM warehouse_inventory wi
    JOIN master_products mp ON wi.master_product_id = mp.id
    WHERE wi.warehouse_id = warehouse_uuid
    AND wi.is_permanent = true
    AND (
        to_tsvector('arabic', mp.name_en) @@ plainto_tsquery('arabic', search_term)
        OR mp.name_en ILIKE '%' || search_term || '%'
    )
    
    UNION ALL
    
    SELECT 
        wcp.id,
        wcp.name_en as name,
        'custom' as type,
        wcp.quantity,
        wcp.price,
        wcp.discount,
        wcp.batch_number,
        wcp.expiry_date
    FROM warehouse_custom_products wcp
    WHERE wcp.warehouse_id = warehouse_uuid
    AND wcp.is_permanent = true
    AND (
        to_tsvector('arabic', wcp.name_en) @@ plainto_tsquery('arabic', search_term)
        OR wcp.name_en ILIKE '%' || search_term || '%'
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN warehouse_inventory.is_permanent IS 'سجل دائم لا يتم حذفه عند نفاد الكمية';
COMMENT ON COLUMN warehouse_custom_products.is_permanent IS 'سجل دائم لا يتم حذفه عند نفاد الكمية';
