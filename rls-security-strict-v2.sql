-- =====================================================
-- سياسات أمان مشددة (Strict Security) - الإصدار المُصلح
-- =====================================================

-- 1. تفعيل RLS على جميع الجداول
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- 2. حذف جميع السياسات القديمة
DROP POLICY IF EXISTS "warehouses_select_own" ON warehouses;
DROP POLICY IF EXISTS "warehouses_insert_own" ON warehouses;
DROP POLICY IF EXISTS "warehouses_update_own" ON warehouses;
DROP POLICY IF EXISTS "warehouses_delete_own" ON warehouses;
DROP POLICY IF EXISTS "warehouses_deny_anon" ON warehouses;

DROP POLICY IF EXISTS "products_select_own_warehouse" ON products;
DROP POLICY IF EXISTS "products_insert_own_warehouse" ON products;
DROP POLICY IF EXISTS "products_update_own_warehouse" ON products;
DROP POLICY IF EXISTS "products_delete_own_warehouse" ON products;
DROP POLICY IF EXISTS "products_deny_anon" ON products;

-- =====================================================
-- سياسات warehouses (مخازن) - صارمة
-- =====================================================

CREATE POLICY "warehouses_select_own"
ON warehouses
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "warehouses_insert_own"
ON warehouses
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "warehouses_update_own"
ON warehouses
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "warehouses_delete_own"
ON warehouses
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- =====================================================
-- دالة مساعدة للتحقق من ملكية المخزن
-- =====================================================
CREATE OR REPLACE FUNCTION check_warehouse_ownership(p_warehouse_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM warehouses 
        WHERE id = p_warehouse_id 
        AND user_id = p_user_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- سياسات products (منتجات) - صارمة جداً
-- =====================================================

CREATE POLICY "products_select_own_warehouse"
ON products
FOR SELECT
TO authenticated
USING (
    warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.uid())
);

CREATE POLICY "products_insert_own_warehouse"
ON products
FOR INSERT
TO authenticated
WITH CHECK (
    warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.uid())
);

CREATE POLICY "products_update_own_warehouse"
ON products
FOR UPDATE
TO authenticated
USING (
    warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.uid())
)
WITH CHECK (
    warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.uid())
);

CREATE POLICY "products_delete_own_warehouse"
ON products
FOR DELETE
TO authenticated
USING (
    warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.uid())
);

-- =====================================================
-- منع الوصول من المستخدمين غير المسجلين (Anon)
-- =====================================================
CREATE POLICY "warehouses_deny_anon"
ON warehouses
FOR ALL
TO anon
USING (false);

CREATE POLICY "products_deny_anon"
ON products
FOR ALL
TO anon
USING (false);

-- =====================================================
-- إضافة عمود user_id للمنتجات (إذا لم يكن موجوداً)
-- =====================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- =====================================================
-- فهارس للأمان والأداء
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_warehouses_user_id ON warehouses(user_id);
CREATE INDEX IF NOT EXISTS idx_products_warehouse_id ON products(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);

-- =====================================================
-- رسالة نجاح
-- =====================================================
SELECT '✅ تم تطبيق سياسات الأمان المشددة بنجاح!' as status;
