-- إصلاح خطأ عدم وجود عمود category
-- Run this script to add the missing category column

-- أولاً، تحقق مما إذا كان العمود موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'warehouse_custom_products' 
        AND column_name = 'category'
    ) THEN
        -- إضافة عمود category إذا لم يكن موجوداً
        ALTER TABLE warehouse_custom_products 
        ADD COLUMN category TEXT DEFAULT 'مخصص';
        
        RAISE NOTICE 'تم إضافة عمود category بنجاح';
    ELSE
        RAISE NOTICE 'عمود category موجود بالفعل';
    END IF;
END $$;

-- تحديث البيانات الموجودة لضمان وجود قيم افتراضية
UPDATE warehouse_custom_products 
SET category = 'مخصص' 
WHERE category IS NULL OR category = '';

-- إضافة فهرس للعمود الجديد لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_warehouse_custom_products_category 
ON warehouse_custom_products(category);

-- تحديث التعليق التوضيحي للجدول
COMMENT ON COLUMN warehouse_custom_products.category IS 'تصنيف المنتج (مخصص، دواء، مكمل غذائي، إلخ)';

-- التحقق من وجود جدول product_categories وإنشاؤه إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_name = 'product_categories'
    ) THEN
        -- إنشاء جدول product_categories إذا لم يكن موجوداً
        CREATE TABLE product_categories (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            warehouse_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            description TEXT,
            color TEXT DEFAULT '#6366f1',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        -- تفعيل RLS
        ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
        
        -- إضافة سياسات الأمان
        CREATE POLICY "Users can view their own categories" ON product_categories
            FOR SELECT USING (auth.uid() = warehouse_id);
            
        CREATE POLICY "Users can insert their own categories" ON product_categories
            FOR INSERT WITH CHECK (auth.uid() = warehouse_id);
            
        CREATE POLICY "Users can update their own categories" ON product_categories
            FOR UPDATE USING (auth.uid() = warehouse_id);
            
        CREATE POLICY "Users can delete their own categories" ON product_categories
            FOR DELETE USING (auth.uid() = warehouse_id);
        
        RAISE NOTICE 'تم إنشاء جدول product_categories بنجاح';
    ELSE
        RAISE NOTICE 'جدول product_categories موجود بالفعل';
    END IF;
END $$;

-- التحقق من وجود الفئات الافتراضية
INSERT INTO product_categories (warehouse_id, name, description, color) 
SELECT 
    DISTINCT warehouse_id,
    'مخصص',
    'منتجات مخصصة',
    '#6366f1'
FROM warehouse_custom_products 
WHERE warehouse_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- تحديث المنتجات لاستخدام الفئات الصحيحة
UPDATE warehouse_custom_products 
SET category = CASE 
    WHEN category IS NULL OR category = '' THEN 'مخصص'
    ELSE category
END;

-- عرض ملخص التغييرات
SELECT 
    'warehouse_custom_products' as table_name,
    COUNT(*) as total_products,
    COUNT(CASE WHEN category IS NOT NULL AND category != '' THEN 1 END) as products_with_category
FROM warehouse_custom_products;

DO $$
BEGIN
    RAISE NOTICE 'تم إصلاح عمود category بنجاح. يمكن الآن استخدام حقل التصنيف في جميع الاستعلامات.';
END $$;
