-- ============================================================
-- اختبار الحذف المباشر للتحقق من المشكلة
-- ============================================================
-- هذا السكريبت يختبر الحذف مباشرة من SQL
-- لمعرفة ما إذا كانت المشكلة في الواجهة أو في قاعدة البيانات
-- ============================================================

-- 1. جلب معرف المخزن الحالي تلقائياً
DO $$
DECLARE
    v_warehouse_id UUID;
    v_product_count INTEGER;
BEGIN
    -- الحصول على معرف المخزن
    SELECT id INTO v_warehouse_id
    FROM warehouses
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_warehouse_id IS NULL THEN
        RAISE NOTICE 'No warehouse found';
        RETURN;
    END IF;

    RAISE NOTICE 'Testing deletion for warehouse: %', v_warehouse_id;

    -- عرض عدد المنتجات قبل الحذف
    SELECT COUNT(*) INTO v_product_count
    FROM warehouse_products_flexible
    WHERE warehouse_id = v_warehouse_id;

    RAISE NOTICE 'Products before deletion: %', v_product_count;

    -- حذف المنتجات
    DELETE FROM warehouse_products_flexible
    WHERE warehouse_id = v_warehouse_id;

    -- عرض عدد المنتجات بعد الحذف
    SELECT COUNT(*) INTO v_product_count
    FROM warehouse_products_flexible
    WHERE warehouse_id = v_warehouse_id;

    RAISE NOTICE 'Products after deletion: %', v_product_count;

    IF v_product_count = 0 THEN
        RAISE NOTICE '✅ Deletion successful in SQL - Problem is in the frontend';
    ELSE
        RAISE NOTICE '❌ Deletion failed in SQL - Problem is in the database';
    END IF;
END $$;

-- ============================================================
-- عرض النتائج بشكل واضح
-- ============================================================
SELECT 
    'Current warehouse' as info,
    id as warehouse_id,
    warehouse_name,
    user_id
FROM warehouses
ORDER BY created_at DESC
LIMIT 1;

SELECT 
    'Products in warehouse' as info,
    COUNT(*) as product_count,
    warehouse_id
FROM warehouse_products_flexible
WHERE warehouse_id = (SELECT id FROM warehouses ORDER BY created_at DESC LIMIT 1)
GROUP BY warehouse_id;

-- ============================================================
-- التعليمات:
-- 1. نفذ هذا السكريبت في Supabase SQL Editor
-- 2. انسخ النتائج وأرسلها لي
-- 3. اقرأ الرسائل في قسم "Messages" لمعرفة النتيجة
-- ============================================================