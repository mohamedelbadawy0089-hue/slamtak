-- ============================================================
-- إنشاء RPC function بسيط للجلب من warehouse_products_flexible فقط
-- ============================================================

DROP FUNCTION IF EXISTS get_warehouse_products_flexible;

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
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
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
        wpf.created_at,
        wpf.updated_at
    FROM warehouse_products_flexible wpf
    WHERE wpf.warehouse_id = p_warehouse_id
    ORDER BY wpf.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION get_warehouse_products_flexible TO authenticated;

-- ============================================================
-- التحقق من عدد السجلات في الجدول
-- ============================================================
SELECT 
    'warehouse_products_flexible' as table_name,
    COUNT(*) as record_count
FROM warehouse_products_flexible;