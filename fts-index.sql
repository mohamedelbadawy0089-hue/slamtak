-- =====================================================
-- Full Text Search (FTS) Indexes for Millions of Products
-- يدعم البحث في ملايين المنتجات بسرعة البرق
-- =====================================================

-- 1. إنشاء extension للبحث النصي الكامل
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 2. إنشاء عمود مُحسّن للبحث النصي (tsvector)
-- هذا العمود يخزن النص بشكل مُفهرس للبحث السريع
ALTER TABLE products ADD COLUMN IF NOT EXISTS name_tsv tsvector;

-- 3. تحديث العمود المُفهرس للمنتجات الموجودة
UPDATE products 
SET name_tsv = to_tsvector('arabic', coalesce(name, ''));

-- 4. إنشاء دالة لتحديث الفهرس تلقائياً
CREATE OR REPLACE FUNCTION update_name_tsv()
RETURNS TRIGGER AS $$
BEGIN
    NEW.name_tsv := to_tsvector('arabic', coalesce(NEW.name, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. إنشاء trigger لتحديث الفهرس عند إضافة أو تعديل منتج
DROP TRIGGER IF EXISTS trigger_update_name_tsv ON products;
CREATE TRIGGER trigger_update_name_tsv
    BEFORE INSERT OR UPDATE OF name ON products
    FOR EACH ROW
    EXECUTE FUNCTION update_name_tsv();

-- 6. إنشاء GIN Index للبحث النصي الكامل (الأسرع للملايين!)
CREATE INDEX IF NOT EXISTS idx_products_fts 
ON products USING gin(name_tsv);

-- 7. إنشاء GIN Index للبحث المشابه (pg_trgm)
CREATE INDEX IF NOT EXISTS idx_products_name_trgm 
ON products USING gin(name gin_trgm_ops);

-- 8. إنشاء Index مركب للبحث داخل المخزن
CREATE INDEX IF NOT EXISTS idx_products_warehouse_name 
ON products(warehouse_id, name);

-- 9. إنشاء Index للـ warehouse_id (للفلاتر السريعة)
CREATE INDEX IF NOT EXISTS idx_products_warehouse 
ON products(warehouse_id);

-- 10. إنشاء Index للتاريخ (للترتيب)
CREATE INDEX IF NOT EXISTS idx_products_created_at 
ON products(created_at DESC);

-- =====================================================
-- اختبار الأداء
-- =====================================================

-- اختبار FTS
EXPLAIN ANALYZE
SELECT * FROM products 
WHERE name_tsv @@ to_tsquery('arabic', 'باراسيتامول');

-- اختبار البحث المشابه
EXPLAIN ANALYZE
SELECT * FROM products 
WHERE name %> 'باراسيتامول';

-- =====================================================
-- ملاحظات:
-- - GIN Index: الأفضل للبحث النصي في ملايين السجلات
-- - pg_trgm: يدعم البحث المشابه (fuzzy search)
-- - tsvector: يحول النص إلى كلمات مفتاحية مُفهرسة
-- =====================================================
