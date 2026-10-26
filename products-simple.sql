-- =====================================================
-- نسخة مبسطة جداً - بدون أي دوال
-- =====================================================

-- 1. إضافة الأعمدة المطلوبة
ALTER TABLE products ADD COLUMN IF NOT EXISTS local_id TEXT UNIQUE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'synced';

-- 2. فهارس للأداء (ضروري للـ Upsert)
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_local_id ON products(local_id);
CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_products_warehouse_id ON products(warehouse_id);

-- 3. تفعيل RLS
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- 4. حذف السياسات القديمة (إذا وجدت)
DROP POLICY IF EXISTS "products_select_own" ON products;
DROP POLICY IF EXISTS "products_insert_own" ON products;
DROP POLICY IF EXISTS "products_update_own" ON products;
DROP POLICY IF EXISTS "products_delete_own" ON products;

-- 5. سياسات RLS بسيطة - المستخدم يرى منتجات مخزنه فقط
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
);

CREATE POLICY "products_delete_own"
ON products FOR DELETE
TO authenticated
USING (
    warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.uid())
);

-- 6. رسالة نجاح
SELECT '✅ تم تجهيز جدول products للمزامنة الذكية!' as status;
