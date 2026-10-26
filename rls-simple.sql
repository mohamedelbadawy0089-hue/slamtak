-- =====================================================
-- سياسات أمان بسيطة وفعّالة (بدون دوال)
-- =====================================================

-- 1. تفعيل RLS
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- 2. حذف السياسات القديمة
DROP POLICY IF EXISTS "warehouses_select_own" ON warehouses;
DROP POLICY IF EXISTS "warehouses_insert_own" ON warehouses;
DROP POLICY IF EXISTS "warehouses_update_own" ON warehouses;
DROP POLICY IF EXISTS "warehouses_delete_own" ON warehouses;
DROP POLICY IF EXISTS "warehouses_deny_anon" ON warehouses;

DROP POLICY IF EXISTS "products_select_own" ON products;
DROP POLICY IF EXISTS "products_insert_own" ON products;
DROP POLICY IF EXISTS "products_update_own" ON products;
DROP POLICY IF EXISTS "products_delete_own" ON products;
DROP POLICY IF EXISTS "products_deny_anon" ON products;

-- 3. سياسات warehouses - المستخدم يرى بياناته فقط
CREATE POLICY "warehouses_select_own"
ON warehouses FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "warehouses_insert_own"
ON warehouses FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "warehouses_update_own"
ON warehouses FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "warehouses_delete_own"
ON warehouses FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- 4. سياسات products - المستخدم يرى منتجات مخزنه فقط
CREATE POLICY "products_select_own"
ON products FOR SELECT
TO authenticated
USING (
    warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.uid())
);

CREATE POLICY "products_insert_own"
ON products FOR INSERT
TO authenticated
WITH CHECK (
    warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.uid())
);

CREATE POLICY "products_update_own"
ON products FOR UPDATE
TO authenticated
USING (
    warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.uid())
)
WITH CHECK (
    warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.uid())
);

CREATE POLICY "products_delete_own"
ON products FOR DELETE
TO authenticated
USING (
    warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.uid())
);

-- 5. منع Anon (غير مسجل)
CREATE POLICY "warehouses_deny_anon"
ON warehouses FOR ALL TO anon USING (false);

CREATE POLICY "products_deny_anon"
ON products FOR ALL TO anon USING (false);

-- 6. فهارس
CREATE INDEX IF NOT EXISTS idx_warehouses_user_id ON warehouses(user_id);
CREATE INDEX IF NOT EXISTS idx_products_warehouse_id ON products(warehouse_id);

-- 7. نجاح
SELECT '✅ تم تفعيل الأمان بنجاح!' as status;
