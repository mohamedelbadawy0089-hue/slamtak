-- ============================================
-- حل مشكلة نوع UUID vs TEXT في Foreign Key
-- ============================================

-- 1. حذف القيد القديم إذا كان موجوداً
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_warehouse_id_fkey;
ALTER TABLE products DROP CONSTRAINT IF EXISTS fk_products_warehouse;

-- 2. حذف جدول warehouses القديم وإعادة إنشائه بنوع TEXT
-- (احذف هذا السطر إذا كان هناك بيانات مهمة في warehouses)
DROP TABLE IF EXISTS warehouses;

-- 3. إنشاء جدول warehouses جديد بنوع TEXT
CREATE TABLE warehouses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. تغيير نوع العمود في products إلى TEXT
ALTER TABLE products ALTER COLUMN warehouse_id TYPE TEXT;

-- 5. إضافة مخزن افتراضي
INSERT INTO warehouses (id, name) 
VALUES ('default', 'المخزن الافتراضي');

-- 5. تحديث المنتجات التي لها warehouse_id غير صالح
UPDATE products 
SET warehouse_id = 'default' 
WHERE warehouse_id IS NULL 
   OR warehouse_id = '' 
   OR warehouse_id NOT IN (SELECT id FROM warehouses);

-- 6. إنشاء Foreign Key جديد
ALTER TABLE products 
ADD CONSTRAINT fk_products_warehouse 
FOREIGN KEY (warehouse_id) 
REFERENCES warehouses(id) 
ON DELETE CASCADE 
ON UPDATE CASCADE;

-- التحقق
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('products', 'warehouses') 
AND column_name IN ('warehouse_id', 'id');
