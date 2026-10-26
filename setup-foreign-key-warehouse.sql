-- ============================================
-- إنشاء Foreign Key بين products و warehouses
-- ============================================

-- 1. التحقق من وجود جدول warehouses وإنشاؤه إذا لم يكن موجوداً
CREATE TABLE IF NOT EXISTS warehouses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. توحيد أنواع الأعمدة (تحويل كلاهما إلى TEXT)
ALTER TABLE warehouses ALTER COLUMN id TYPE TEXT;
ALTER TABLE products ALTER COLUMN warehouse_id TYPE TEXT;

-- 3. إضافة مخزن افتراضي إذا لم يكن موجوداً
INSERT INTO warehouses (id, name) 
VALUES ('default', 'المخزن الافتراضي')
ON CONFLICT (id) DO NOTHING;

-- 4. تنظيف البيانات: تصحيح المنتجات التي لها warehouse_id غير موجود
UPDATE products 
SET warehouse_id = 'default' 
WHERE warehouse_id NOT IN (SELECT id FROM warehouses) 
   OR warehouse_id IS NULL 
   OR warehouse_id = '';

-- 5. حذف القيد القديم إذا كان موجوداً
ALTER TABLE products DROP CONSTRAINT IF EXISTS fk_products_warehouse;

-- 6. إنشاء Foreign Key مع Cascade Delete
ALTER TABLE products 
ADD CONSTRAINT fk_products_warehouse 
FOREIGN KEY (warehouse_id) 
REFERENCES warehouses(id) 
ON DELETE CASCADE 
ON UPDATE CASCADE;

-- 7. التحقق من إنشاء القيد
SELECT 
    tc.constraint_name, 
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    rc.delete_rule
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints AS rc
    ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
    AND tc.table_name = 'products';

-- عرض البيانات للتحقق
SELECT 'المخازن:' as info, COUNT(*) as count FROM warehouses;
SELECT 'المنتجات:' as info, COUNT(*) as count FROM products;
