-- ============================================
-- إضافة عمود user_id إلى جدول products
-- ============================================

-- 1. إضافة العمود (إذا لم يكن موجوداً)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS user_id UUID;

-- 2. إنشاء index للبحث السريع
CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);

-- 3. تحديث الصلاحيات (Row Level Security)
-- تفعيل RLS إذا لم يكن مفعلاً
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- 4. إنشاء سياسة للسماح بالقراءة للجميع
DROP POLICY IF EXISTS "Allow all read" ON products;
CREATE POLICY "Allow all read" ON products
    FOR SELECT
    USING (true);

-- 5. إنشاء سياسة للسماح بالإضافة
DROP POLICY IF EXISTS "Allow all insert" ON products;
CREATE POLICY "Allow all insert" ON products
    FOR INSERT
    WITH CHECK (true);

-- 6. إنشاء سياسة للسماح بالتحديث
DROP POLICY IF EXISTS "Allow all update" ON products;
CREATE POLICY "Allow all update" ON products
    FOR UPDATE
    USING (true);

-- 7. إنشاء سياسة للسماح بالحذف
DROP POLICY IF EXISTS "Allow all delete" ON products;
CREATE POLICY "Allow all delete" ON products
    FOR DELETE
    USING (true);

-- ============================================
-- التعليمات:
-- 1. افتح Supabase Dashboard: https://app.supabase.com
-- 2. اختر مشروعك
-- 3. اذهب إلى SQL Editor
-- 4. الصق هذا الكود واضغط Run
-- ============================================
