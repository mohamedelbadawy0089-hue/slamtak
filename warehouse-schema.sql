-- =====================================================
-- إنشاء جدول المخازن (warehouses) مع جميع الحقول المطلوبة
-- =====================================================

-- 1. إنشاء الجدول الأساسي
CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    warehouse_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    governorate TEXT NOT NULL,
    admin_key TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. إضافة تعليقات للأعمدة (اختياري)
COMMENT ON COLUMN warehouses.admin_key IS 'كلمة سر المدير للوصول للإعدادات الحساسة';
COMMENT ON COLUMN warehouses.user_id IS 'مفتاح المستخدم في نظام المصادقة (Supabase Auth)';

-- =====================================================
-- ربط جدول المنتجات (products) بجدول المخازن
-- =====================================================

-- التأكد من وجود عمود warehouse_id في جدول products
-- إذا لم يكن موجوداً، أضفه
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'products' 
        AND column_name = 'warehouse_id'
    ) THEN
        ALTER TABLE products ADD COLUMN warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE;
    END IF;
END $$;

-- =====================================================
-- إعدادات الأمان (Row Level Security - RLS)
-- =====================================================

-- 1. تفعيل RLS على جدول warehouses
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

-- 2. حذف السياسات القديمة إذا وجدت (لتجنب التكرار)
DROP POLICY IF EXISTS "المستخدم يمكنه رؤية مخزنه فقط" ON warehouses;
DROP POLICY IF EXISTS "المستخدم يمكنه إنشاء مخزن خاص به" ON warehouses;
DROP POLICY IF EXISTS "المستخدم يمكنه تعديل مخزنه فقط" ON warehouses;
DROP POLICY IF EXISTS "المستخدم يمكنه حذف مخزنه فقط" ON warehouses;

-- 3. إنشاء سياسات RLS جديدة

-- سياسة SELECT: المستخدم يمكنه رؤية مخزنه فقط
CREATE POLICY "المستخدم يمكنه رؤية مخزنه فقط"
ON warehouses
FOR SELECT
USING (user_id = auth.uid());

-- سياسة INSERT: المستخدم يمكنه إنشاء مخزن خاص به
CREATE POLICY "المستخدم يمكنه إنشاء مخزن خاص به"
ON warehouses
FOR INSERT
WITH CHECK (user_id = auth.uid());

-- سياسة UPDATE: المستخدم يمكنه تعديل مخزنه فقط
CREATE POLICY "المستخدم يمكنه تعديل مخزنه فقط"
ON warehouses
FOR UPDATE
USING (user_id = auth.uid());

-- سياسة DELETE: المستخدم يمكنه حذف مخزنه فقط
CREATE POLICY "المستخدم يمكنه حذف مخزنه فقط"
ON warehouses
FOR DELETE
USING (user_id = auth.uid());

-- =====================================================
-- إعدادات RLS لجدول products (للتأكد من العلاقة)
-- =====================================================

-- تفعيل RLS على products إذا لم يكن مفعلاً
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- حذف السياسات القديمة
DROP POLICY IF EXISTS "المنتجات تابعة للمخزن" ON products;
DROP POLICY IF EXISTS "إضافة منتج للمخزن" ON products;
DROP POLICY IF EXISTS "تعديل منتجات المخزن" ON products;
DROP POLICY IF EXISTS "حذف منتجات المخزن" ON products;

-- سياسة SELECT: رؤية المنتجات التابعة للمخزن
CREATE POLICY "المنتجات تابعة للمخزن"
ON products
FOR SELECT
USING (
    warehouse_id IN (
        SELECT id FROM warehouses WHERE user_id = auth.uid()
    )
);

-- سياسة INSERT: إضافة منتج للمخزن
CREATE POLICY "إضافة منتج للمخزن"
ON products
FOR INSERT
WITH CHECK (
    warehouse_id IN (
        SELECT id FROM warehouses WHERE user_id = auth.uid()
    )
);

-- سياسة UPDATE: تعديل منتجات المخزن
CREATE POLICY "تعديل منتجات المخزن"
ON products
FOR UPDATE
USING (
    warehouse_id IN (
        SELECT id FROM warehouses WHERE user_id = auth.uid()
    )
);

-- سياسة DELETE: حذف منتجات المخزن
CREATE POLICY "حذف منتجات المخزن"
ON products
FOR DELETE
USING (
    warehouse_id IN (
        SELECT id FROM warehouses WHERE user_id = auth.uid()
    )
);

-- =====================================================
-- إنشاء فهرس للبحث السريع
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_warehouses_user_id ON warehouses(user_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_email ON warehouses(email);
CREATE INDEX IF NOT EXISTS idx_products_warehouse_id ON products(warehouse_id);

-- =====================================================
-- رسالة نجاح
-- =====================================================
SELECT '✅ تم إنشاء جدول warehouses وربطه بـ products بنجاح!' as status;
