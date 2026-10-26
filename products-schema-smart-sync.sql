-- =====================================================
-- تعديل جدول products لدعم المزامنة الذكية
-- =====================================================

-- 1. إضافة عمود local_id للتعرف على المنتجات المحلية
ALTER TABLE products ADD COLUMN IF NOT EXISTS local_id TEXT UNIQUE;

-- 2. إضافة عمود user_id للتعرف على المالك
ALTER TABLE products ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- 3. إضافة عمود status لحالة المزامنة (اختياري - للتتبع)
ALTER TABLE products ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'synced';

-- 4. فهرس للبحث السريع
CREATE INDEX IF NOT EXISTS idx_products_local_id ON products(local_id);
CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);

-- 5. فهرس مركب للـ upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_local_id_user 
ON products(local_id, user_id);

-- =====================================================
-- سياسات RLS محدثة للمزامنة الذكية
-- =====================================================

-- حذف السياسات القديمة
DROP POLICY IF EXISTS "products_select_own" ON products;
DROP POLICY IF EXISTS "products_insert_own" ON products;
DROP POLICY IF EXISTS "products_update_own" ON products;
DROP POLICY IF EXISTS "products_delete_own" ON products;
DROP POLICY IF EXISTS "products_upsert_own" ON products;

-- سياسة SELECT: رؤية منتجات المخزن المملوك
CREATE POLICY "products_select_own"
ON products FOR SELECT
TO authenticated
USING (
    warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.uid())
);

-- سياسة INSERT: إضافة منتج للمخزن المملوك
CREATE POLICY "products_insert_own"
ON products FOR INSERT
TO authenticated
WITH CHECK (
    warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.uid())
    AND user_id = auth.uid()
);

-- سياسة UPDATE: تعديل منتجات المخزن المملوك
CREATE POLICY "products_update_own"
ON products FOR UPDATE
TO authenticated
USING (
    warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.uid())
)
WITH CHECK (
    warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.uid())
    AND user_id = auth.uid()
);

-- سياسة DELETE: حذف منتجات المخزن المملوك
CREATE POLICY "products_delete_own"
ON products FOR DELETE
TO authenticated
USING (
    warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.uid())
);

-- =====================================================
-- دالة للتحقق من الملكية قبل الإدخال
-- =====================================================
CREATE OR REPLACE FUNCTION validate_product_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- التحقق من أن المستخدم يملك المخزن
    IF NOT EXISTS (
        SELECT 1 FROM warehouses 
        WHERE id = NEW.warehouse_id 
        AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'User does not own this warehouse';
    END IF;
    
    -- تعيين user_id تلقائياً
    NEW.user_id := auth.uid();
    
    RETURN NEW;
END;
$$;

-- تفعيل التحقق
DROP TRIGGER IF EXISTS validate_product_trigger ON products;
CREATE TRIGGER validate_product_trigger
    BEFORE INSERT OR UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION validate_product_ownership();

-- =====================================================
-- رسالة نجاح
-- =====================================================
SELECT '✅ تم تجهيز جدول products للمزامنة الذكية!' as status;
