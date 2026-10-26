-- ============================================
-- إصلاح RLS للسماح بالوصول المجهول (Anonymous)
-- ============================================

-- 1. تفعيل RLS
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- 2. حذف جميع السياسات القديمة
DROP POLICY IF EXISTS "Users can view own products" ON products;
DROP POLICY IF EXISTS "Users can insert own products" ON products;
DROP POLICY IF EXISTS "Users can update own products" ON products;
DROP POLICY IF EXISTS "Users can delete own products" ON products;
DROP POLICY IF EXISTS "Allow anonymous access" ON products;

-- 3. إنشاء سياسة واحدة تسمح للجميع بالوصول (لأننا نستخدم anon key)
-- هذا مؤقت لحل مشكلة 401
CREATE POLICY "Allow anonymous access" ON products
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- 4. التأكد من أن العمود user_id موجود ومن نوع TEXT
ALTER TABLE products ADD COLUMN IF NOT EXISTS user_id TEXT;

-- 5. إنشاء indexes
CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_products_warehouse ON products(warehouse_id);

-- ============================================
-- شغل هذا الكود في Supabase Dashboard SQL Editor
-- ثم اختبر الصفحة مرة أخرى
-- ============================================
