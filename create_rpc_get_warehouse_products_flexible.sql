-- حذف جميع نسخ الدالة القديمة
DROP FUNCTION IF EXISTS get_warehouse_products_flexible CASCADE;

-- إنشاء دالة RPC لجلب المنتجات من الجدول المرن مع دعم البحث
-- هذه الدالة تحسن الأداء وتتجاوز قيود RLS
-- تدعم البحث الفوري في جميع الحقول المهمة

CREATE OR REPLACE FUNCTION get_warehouse_products_flexible(
    p_warehouse_id UUID,
    p_limit INTEGER DEFAULT 1000,
    p_offset INTEGER DEFAULT 0,
    p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    warehouse_id UUID,
    product_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        wpf.id,
        wpf.warehouse_id,
        wpf.product_data,
        wpf.created_at
    FROM warehouse_products_flexible wpf
    WHERE wpf.warehouse_id = p_warehouse_id
    AND (
        p_search IS NULL 
        OR 
        (
            -- البحث في جميع الحقول المهمة
            wpf.product_data->>'trade_name' ILIKE '%' || p_search || '%'
            OR wpf.product_data->>'tradeName' ILIKE '%' || p_search || '%'
            OR wpf.product_data->>'batch_number' ILIKE '%' || p_search || '%'
            OR wpf.product_data->>'batchNumber' ILIKE '%' || p_search || '%'
            OR wpf.product_data->>'category' ILIKE '%' || p_search || '%'
            OR wpf.product_data->>'supplier' ILIKE '%' || p_search || '%'
        )
    )
    -- الترتيب حسب sequence_number للحفاظ على الترتيب الأصلي من الإكسيل
    ORDER BY (wpf.product_data->>'sequence_number')::BIGINT ASC NULLS LAST
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

-- منح الصلاحيات للوصول للدالة
GRANT EXECUTE ON FUNCTION get_warehouse_products_flexible TO authenticated;
GRANT EXECUTE ON FUNCTION get_warehouse_products_flexible TO anon;

-- التحقق من إنشاء الدالة
SELECT 
    routine_name,
    routine_type
FROM information_schema.routines
WHERE routine_name = 'get_warehouse_products_flexible';
