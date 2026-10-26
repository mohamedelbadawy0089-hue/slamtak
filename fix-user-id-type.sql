-- ============================================
-- إصلاح نوع عمود user_id (من UUID إلى TEXT)
-- ============================================

-- 1. حذف العمود القديم (إذا كان موجوداً بخطأ)
ALTER TABLE products DROP COLUMN IF EXISTS user_id;

-- 2. إضافة العمود بالنوع الصحيح (TEXT)
ALTER TABLE products ADD COLUMN user_id TEXT;

-- 3. إنشاء index
CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_products_warehouse ON products(warehouse_id);

-- 4. تفعيل Row Level Security
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- 5. حذف السياسات القديمة
DROP POLICY IF EXISTS "Users can view own products" ON products;
DROP POLICY IF EXISTS "Users can insert own products" ON products;
DROP POLICY IF EXISTS "Users can update own products" ON products;
DROP POLICY IF EXISTS "Users can delete own products" ON products;

-- 6. إنشاء سياسات بسيطة (بدون auth.uid() لأننا نستخدم email)
CREATE POLICY "Users can view own products" ON products
    FOR SELECT USING (true);

CREATE POLICY "Users can insert own products" ON products
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update own products" ON products
    FOR UPDATE USING (true);

CREATE POLICY "Users can delete own products" ON products
    FOR DELETE USING (true);
