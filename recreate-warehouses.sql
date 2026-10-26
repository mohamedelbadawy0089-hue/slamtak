-- =====================================================
-- الحل الأمثل: حذف وإعادة إنشاء جدول warehouses بالكامل
-- =====================================================

-- 1. حذف الجدول القديم إذا موجود (مع الاعتماديات)
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS warehouses CASCADE;

-- 2. إنشاء جدول warehouses بالهيكل الصحيح
CREATE TABLE warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    warehouse_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    governorate TEXT NOT NULL,
    admin_key TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. إضافة تعليقات
COMMENT ON COLUMN warehouses.admin_key IS 'كلمة سر المدير للوصول للإعدادات الحساسة';
COMMENT ON COLUMN warehouses.user_id IS 'مفتاح المستخدم في نظام المصادقة (Supabase Auth)';

-- 4. إنشاء جدول products المرتبط
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    quantity INTEGER DEFAULT 0,
    category TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 5. تفعيل RLS
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- 6. سياسات warehouses
CREATE POLICY "المستخدم يمكنه رؤية مخزنه فقط"
ON warehouses FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "المستخدم يمكنه إنشاء مخزن خاص به"
ON warehouses FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "المستخدم يمكنه تعديل مخزنه فقط"
ON warehouses FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "المستخدم يمكنه حذف مخزنه فقط"
ON warehouses FOR DELETE USING (user_id = auth.uid());

-- 7. سياسات products
CREATE POLICY "المنتجات تابعة للمخزن"
ON products FOR SELECT USING (
    warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.uid())
);

CREATE POLICY "إضافة منتج للمخزن"
ON products FOR INSERT WITH CHECK (
    warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.uid())
);

CREATE POLICY "تعديل منتجات المخزن"
ON products FOR UPDATE USING (
    warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.uid())
);

CREATE POLICY "حذف منتجات المخزن"
ON products FOR DELETE USING (
    warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.uid())
);

-- 8. إنشاء الفهارس
CREATE INDEX idx_warehouses_user_id ON warehouses(user_id);
CREATE INDEX idx_warehouses_email ON warehouses(email);
CREATE INDEX idx_products_warehouse_id ON products(warehouse_id);

-- 9. التحقق
SELECT '✅ تم إعادة إنشاء الجداول بنجاح!' as status;
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'warehouses';
