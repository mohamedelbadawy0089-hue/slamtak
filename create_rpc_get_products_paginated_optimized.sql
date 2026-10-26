-- ============================================================
-- Final publish-ready SQL for Supabase
-- API contract kept compatible with existing stock.html RPC usage
-- ============================================================

-- 1) Optional index set for warehouse-scoped pagination/search
CREATE INDEX IF NOT EXISTS idx_wh_flex_warehouse_created_at
    ON public.warehouse_products_flexible (warehouse_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wh_flex_warehouse_trade_name
    ON public.warehouse_products_flexible (
        warehouse_id,
        COALESCE(product_data->>'trade_name', product_data->>'tradeName', '')
    );

CREATE INDEX IF NOT EXISTS idx_wh_flex_warehouse_batch_number
    ON public.warehouse_products_flexible (
        warehouse_id,
        COALESCE(product_data->>'batch_number', product_data->>'batchNumber', '')
    );

CREATE INDEX IF NOT EXISTS idx_wh_flex_warehouse_category
    ON public.warehouse_products_flexible (
        warehouse_id,
        COALESCE(product_data->>'category', '')
    );

CREATE INDEX IF NOT EXISTS idx_wh_flex_warehouse_supplier
    ON public.warehouse_products_flexible (
        warehouse_id,
        COALESCE(product_data->>'supplier', '')
    );

CREATE INDEX IF NOT EXISTS idx_wh_flex_product_data_gin
    ON public.warehouse_products_flexible USING GIN (product_data);

-- 2) Drop and recreate the RPC function
DROP FUNCTION IF EXISTS public.get_products_paginated_optimized(
    UUID,
    INTEGER,
    INTEGER,
    TEXT,
    TEXT,
    TEXT
) CASCADE;

CREATE OR REPLACE FUNCTION public.get_products_paginated_optimized(
    p_warehouse_id UUID,
    p_limit INTEGER DEFAULT 250,
    p_offset INTEGER DEFAULT 0,
    p_search TEXT DEFAULT NULL,
    p_sort_field TEXT DEFAULT 'created_at',
    p_sort_dir TEXT DEFAULT 'desc'
)
RETURNS TABLE (
    id UUID,
    warehouse_id UUID,
    product_data JSONB,
    created_at TIMESTAMPTZ,
    page INTEGER,
    total_rows BIGINT,
    page_count INTEGER,
    has_more BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_limit INTEGER := GREATEST(COALESCE(p_limit, 250), 1);
    v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
    v_search TEXT := NULLIF(TRIM(COALESCE(p_search, '')), '');
    v_sort_field TEXT := LOWER(COALESCE(p_sort_field, 'created_at'));
    v_sort_dir TEXT := LOWER(COALESCE(p_sort_dir, 'desc'));
    v_order_sql TEXT;
    v_where_sql TEXT;
    v_count_sql TEXT;
    v_total_rows BIGINT := 0;
    v_page_no INTEGER := 1;
    v_page_count INTEGER := 0;
    v_has_more BOOLEAN := FALSE;
BEGIN
    IF v_sort_dir NOT IN ('asc', 'desc') THEN
        v_sort_dir := 'desc';
    END IF;

    CASE v_sort_field
        WHEN 'trade_name' THEN
            v_order_sql := 'COALESCE(wpf.product_data->>''trade_name'', wpf.product_data->>''tradeName'', '''')';
        WHEN 'batch_number' THEN
            v_order_sql := 'COALESCE(wpf.product_data->>''batch_number'', wpf.product_data->>''batchNumber'', '''')';
        WHEN 'category' THEN
            v_order_sql := 'COALESCE(wpf.product_data->>''category'', '''')';
        WHEN 'supplier' THEN
            v_order_sql := 'COALESCE(wpf.product_data->>''supplier'', '''')';
        WHEN 'quantity' THEN
            v_order_sql := 'COALESCE((wpf.product_data->>''quantity'')::NUMERIC, 0)';
        WHEN 'public_price' THEN
            v_order_sql := 'COALESCE((wpf.product_data->>''public_price'')::NUMERIC, (wpf.product_data->>''price'')::NUMERIC, 0)';
        ELSE
            v_order_sql := 'wpf.created_at';
    END CASE;

    v_where_sql := '
        (
            $2 IS NULL
            OR trim($2) = ''''
            OR COALESCE(wpf.product_data->>''trade_name'', wpf.product_data->>''tradeName'', '''') ILIKE ''%'' || $2 || ''%''
            OR COALESCE(wpf.product_data->>''batch_number'', wpf.product_data->>''batchNumber'', '''') ILIKE ''%'' || $2 || ''%''
            OR COALESCE(wpf.product_data->>''category'', '''') ILIKE ''%'' || $2 || ''%''
            OR COALESCE(wpf.product_data->>''supplier'', '''') ILIKE ''%'' || $2 || ''%''
        )';

    v_count_sql := format(
        'SELECT COUNT(*)
         FROM public.warehouse_products_flexible AS wpf
         WHERE wpf.warehouse_id = $1
           AND %s',
        v_where_sql
    );

    EXECUTE v_count_sql INTO v_total_rows USING p_warehouse_id, v_search;

    v_page_no := FLOOR(v_offset / v_limit) + 1;
    v_page_count := CASE
        WHEN v_total_rows = 0 THEN 0
        ELSE CEIL(v_total_rows::NUMERIC / v_limit)
    END;
    v_has_more := (v_offset + v_limit) < v_total_rows;

    RETURN QUERY EXECUTE format(
        '
        SELECT
            wpf.id,
            wpf.warehouse_id,
            wpf.product_data,
            wpf.created_at,
            $5::INTEGER AS page,
            $8::BIGINT AS total_rows,
            $9::INTEGER AS page_count,
            $10::BOOLEAN AS has_more
        FROM public.warehouse_products_flexible AS wpf
        WHERE wpf.warehouse_id = $1
          AND %s
        ORDER BY %s %s, wpf.created_at DESC
        LIMIT $3 OFFSET $4
        ',
        v_where_sql,
        v_order_sql,
        v_sort_dir
    )
    USING p_warehouse_id, v_search, v_limit, v_offset, v_page_no, v_limit, v_offset, v_total_rows, v_page_count, v_has_more;
END;
$$;

-- 3) Permissions for Supabase client access
GRANT EXECUTE ON FUNCTION public.get_products_paginated_optimized(
    UUID,
    INTEGER,
    INTEGER,
    TEXT,
    TEXT,
    TEXT
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_products_paginated_optimized(
    UUID,
    INTEGER,
    INTEGER,
    TEXT,
    TEXT,
    TEXT
) TO anon;

-- 4) Quick verification
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name = 'get_products_paginated_optimized';
