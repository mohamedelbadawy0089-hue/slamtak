-- ============================================
-- إعداد RLS Policies مع user_id
-- ============================================

-- 1. إضافة عمود user_id (إذا لم يكن موجوداً)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS user_id UUID;

-- 2. إنشاء index للبحث السريع
CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_products_warehouse ON products(warehouse_id);

-- 3. تفعيل Row Level Security
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- 4. حذف السياسات القديمة (إن وجدت)
DROP POLICY IF EXISTS "Allow all read" ON products;
DROP POLICY IF EXISTS "Allow all insert" ON products;
DROP POLICY IF EXISTS "Allow all update" ON products;
DROP POLICY IF EXISTS "Allow all delete" ON products;
DROP POLICY IF EXISTS "Users can view own products" ON products;
DROP POLICY IF EXISTS "Users can insert own products" ON products;
DROP POLICY IF EXISTS "Users can update own products" ON products;
DROP POLICY IF EXISTS "Users can delete own products" ON products;

-- 5. إنشاء سياسات RLS جديدة基于 user_id

-- السياسة 1: السماح بالقراءة فقط للمنتجات الخاصة بالمستخدم
CREATE POLICY "Users can view own products" ON products
    FOR SELECT
    USING (user_id = auth.uid()::text OR user_id IS NULL);

-- السياسة 2: السماح بالإضافة فقط للمستخدم صاحب المنتج
CREATE POLICY "Users can insert own products" ON products
    FOR INSERT
    WITH CHECK (user_id = auth.uid()::text);

-- السياسة 3: السماح بالتحديث فقط للمنتجات الخاصة بالمستخدم
CREATE POLICY "Users can update own products" ON products
    FOR UPDATE
    USING (user_id = auth.uid()::text OR user_id IS NULL);

-- السياسة 4: السماح بالحذف فقط للمنتجات الخاصة بالمستخدم
CREATE POLICY "Users can delete own products" ON products
    FOR DELETE
    USING (user_id = auth.uid()::text OR user_id IS NULL);

-- ============================================
-- التعليمات:
-- 1. افتح Supabase Dashboard: https://app.supabase.com
-- 2. اختر مشروعك
-- 3. اذهب إلى SQL Editor
-- 4. الصق هذا الكود واضغط Run
-- 5. تأكد من عدم وجود أخطاء
-- ============================================
