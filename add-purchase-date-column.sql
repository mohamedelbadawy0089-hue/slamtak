-- إضافة حقل تاريخ الشراء لجدول المخزون
-- Add purchase date column to warehouse inventory table

-- إضافة العمود لجدول المخزون الرئيسي
ALTER TABLE warehouse_inventory 
ADD COLUMN purchase_date DATE;

-- إضافة العمود لجدول المنتجات المخصصة  
ALTER TABLE warehouse_custom_products 
ADD COLUMN purchase_date DATE;

-- إنشاء فهرس لتحسين أداء البحث والتقارير
CREATE INDEX idx_warehouse_inventory_purchase_date 
ON warehouse_inventory(purchase_date);

CREATE INDEX idx_warehouse_custom_products_purchase_date 
ON warehouse_custom_products(purchase_date);

-- تحديث السياسات لتشمل الحقل الجديد
-- Update RLS policies to include the new field

-- سياسة القراءة للصيدلية
CREATE POLICY "Pharmacies can view inventory with purchase date"
ON warehouse_inventory FOR SELECT
USING (warehouse_id IN (
    SELECT id FROM warehouses 
    WHERE owner_id = auth.uid()
    OR id IN (
        SELECT warehouse_id FROM warehouse_pharmacy_access 
        WHERE pharmacy_id = auth.uid()
    )
));

-- سياسة التعديل للمخزن
CREATE POLICY "Warehouses can insert inventory with purchase date"
ON warehouse_inventory FOR INSERT
WITH CHECK (warehouse_id IN (
    SELECT id FROM warehouses 
    WHERE owner_id = auth.uid()
));

CREATE POLICY "Warehouses can update inventory with purchase date"
ON warehouse_inventory FOR UPDATE
USING (warehouse_id IN (
    SELECT id FROM warehouses 
    WHERE owner_id = auth.uid()
));

-- سياسات للمنتجات المخصصة
CREATE POLICY "Warehouses can insert custom products with purchase date"
ON warehouse_custom_products FOR INSERT
WITH CHECK (warehouse_id IN (
    SELECT id FROM warehouses 
    WHERE owner_id = auth.uid()
));

CREATE POLICY "Warehouses can update custom products with purchase date"
ON warehouse_custom_products FOR UPDATE
USING (warehouse_id IN (
    SELECT id FROM warehouses 
    WHERE owner_id = auth.uid()
));

COMMENT ON COLUMN warehouse_inventory.purchase_date IS 'تاريخ شراء المنتج من المورد';
COMMENT ON COLUMN warehouse_custom_products.purchase_date IS 'تاريخ شراء المنتج المخصص من المورد';
