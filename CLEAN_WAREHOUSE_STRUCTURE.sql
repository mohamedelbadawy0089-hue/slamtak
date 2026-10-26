-- ============================================================
-- تحديث بنية العمل لتعتمد كلياً على warehouse_products_flexible
-- ============================================================
-- هذا السكريبت يقوم بـ:
-- 1. إنشاء دالة حذف بسيطة تعتمد على auth.uid() فقط
-- 2. تنظيف الجداول القديمة لمرة واحدة
-- 3. تحديث سياسات RLS
-- 4. تأكيد الاعتماد على الجدول الرئيسي فقط
-- ============================================================

-- ============================================================
-- 1. دالة حذف بسيطة تعتمد على auth.uid() فقط
-- ============================================================
DROP FUNCTION IF EXISTS delete_my_warehouse_products();

CREATE OR REPLACE FUNCTION delete_my_warehouse_products()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count INTEGER := 0;
    current_user_id UUID;
    warehouse_id UUID;
BEGIN
    -- الحصول على معرف المستخدم الحالي
    current_user_id := auth.uid();

    IF current_user_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'User not authenticated',
            'deleted_count', 0
        );
    END IF;

    -- الحصول على معرف مخزن المستخدم مع تحديد الجدول بشكل صريح
    SELECT w.id INTO warehouse_id
    FROM public.warehouses w
    WHERE w.user_id = current_user_id
    LIMIT 1;

    IF warehouse_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'No warehouse found for current user',
            'deleted_count', 0
        );
    END IF;

    -- حذف جميع منتجات المستخدم من الجدول الرئيسي فقط مع تحديد الجدول بشكل صريح
    DELETE FROM public.warehouse_products_flexible
    WHERE public.warehouse_products_flexible.warehouse_id = warehouse_id;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN json_build_object(
        'success', true,
        'deleted_count', deleted_count,
        'warehouse_id', warehouse_id,
        'user_id', current_user_id,
        'message', 'All products deleted successfully'
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM,
            'deleted_count', 0
        );
END;
$$;

GRANT EXECUTE ON FUNCTION delete_my_warehouse_products() TO authenticated;

-- ============================================================
-- 2. تنظيف الجداول القديمة لمرة واحدة
-- ============================================================

-- حذف جدول warehouse_custom_products إذا كان موجوداً
DROP TABLE IF EXISTS warehouse_custom_products CASCADE;

-- حذف جدول warehouse_inventory إذا كان موجوداً
DROP TABLE IF EXISTS warehouse_inventory CASCADE;

-- حذف جدول drugs إذا كان موجوداً (الجدول القديم)
DROP TABLE IF EXISTS drugs CASCADE;

-- ============================================================
-- 3. تحديث سياسات RLS للجدول الرئيسي
-- ============================================================

-- تفعيل RLS على الجدول الرئيسي
ALTER TABLE warehouse_products_flexible ENABLE ROW LEVEL SECURITY;

-- إزالة جميع السياسات القديمة
DROP POLICY IF EXISTS "Users can view products in their warehouses" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can insert products in their warehouses" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can update products in their warehouses" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can delete products in their warehouses" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can view products via direct join" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can view their warehouse products" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can insert warehouse products" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can update warehouse products" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can delete warehouse products" ON warehouse_products_flexible;

-- سياسة القراءة: المستخدم يرى منتجات مخازنه فقط
CREATE POLICY "Users can view their warehouse products"
    ON warehouse_products_flexible FOR SELECT
    USING (
        warehouse_id IN (
            SELECT id FROM public.warehouses
            WHERE user_id = auth.uid()
        )
    );

-- سياسة الإضافة: المستخدم يضيف منتجات لمخازنه فقط
CREATE POLICY "Users can insert warehouse products"
    ON warehouse_products_flexible FOR INSERT
    WITH CHECK (
        warehouse_id IN (
            SELECT id FROM public.warehouses
            WHERE user_id = auth.uid()
        )
    );

-- سياسة التعديل: المستخدم يعدل منتجات مخازنه فقط
CREATE POLICY "Users can update warehouse products"
    ON warehouse_products_flexible FOR UPDATE
    USING (
        warehouse_id IN (
            SELECT id FROM public.warehouses
            WHERE user_id = auth.uid()
        )
    )
    WITH CHECK (
        warehouse_id IN (
            SELECT id FROM public.warehouses
            WHERE user_id = auth.uid()
        )
    );

-- سياسة الحذف: المستخدم يحذف منتجات مخازنه فقط
CREATE POLICY "Users can delete warehouse products"
    ON warehouse_products_flexible FOR DELETE
    USING (
        warehouse_id IN (
            SELECT id FROM public.warehouses
            WHERE user_id = auth.uid()
        )
    );

-- ============================================================
-- 4. التحقق من البنية النظيفة
-- ============================================================

-- عرض الجداول المتبقية
SELECT 
    'Remaining tables' as info,
    table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- عرض المنتجات في الجدول الرئيسي
SELECT 
    'Products in main table' as info,
    COUNT(*) as total_products,
    COUNT(DISTINCT warehouse_id) as warehouses_with_products
FROM warehouse_products_flexible;

-- عرض سياسات RLS للجدول الرئيسي
SELECT 
    'RLS policies on main table' as info,
    policyname,
    permissive,
    cmd
FROM pg_policies
WHERE tablename = 'warehouse_products_flexible'
ORDER BY policyname;

-- ============================================================
-- 5. التحقق من نجاح العملية
-- ============================================================
SELECT 
    '✅ Structure cleanup completed' as status,
    'Main table: warehouse_products_flexible' as main_table,
    'Function: delete_my_warehouse_products' as delete_function,
    'Old tables removed' as cleanup_status;