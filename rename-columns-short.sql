-- ============================================
-- إعادة تسمية الأعمدة إلى اختصارات قصيرة
-- ============================================

-- 1. حذف القيد Foreign Key القديم (لتجنب أخطاء التبعية)
ALTER TABLE products DROP CONSTRAINT IF EXISTS fk_products_warehouse;

-- 2. إعادة تسمية الأعمدة
ALTER TABLE products RENAME COLUMN name TO n;
ALTER TABLE products RENAME COLUMN price TO p;
ALTER TABLE products RENAME COLUMN quantity TO q;
ALTER TABLE products RENAME COLUMN discount TO d;
ALTER TABLE products RENAME COLUMN production_date TO pd;
ALTER TABLE products RENAME COLUMN expiry_date TO ed;
ALTER TABLE products RENAME COLUMN warehouse_id TO wid;

-- 3. إعادة إنشاء Foreign Key مع العمود الجديد wid
ALTER TABLE products 
ADD CONSTRAINT fk_products_warehouse 
FOREIGN KEY (wid) 
REFERENCES warehouses(id) 
ON DELETE CASCADE 
ON UPDATE CASCADE;

-- 4. تحديث الفهارس
DROP INDEX IF EXISTS idx_products_name;
DROP INDEX IF EXISTS idx_products_warehouse;
DROP INDEX IF EXISTS idx_products_expiry_date;

CREATE INDEX IF NOT EXISTS idx_products_n ON products(n);
CREATE INDEX IF NOT EXISTS idx_products_wid ON products(wid);
CREATE INDEX IF NOT EXISTS idx_products_ed ON products(ed);

-- التحقق من التعديل
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'products' 
ORDER BY ordinal_position;
