-- ============================================================
-- دالة RPC فائقة السرعة لمعالجة إضافة وتحديث المنتجات حسب رقم التشغيلة
-- ============================================================

-- 1. إنشـاء فهرس مركب مخصص لتسريع المطابقة الفورية (Index Lookup)
CREATE INDEX IF NOT EXISTS idx_wh_products_flex_lookup 
ON warehouse_products_flexible (
    warehouse_id, 
    (COALESCE(product_data->>'trade_name', product_data->>'tradeName', '')),
    (COALESCE(product_data->>'batch_number', product_data->>'batchNumber', ''))
);

-- 2. دالة RPC لجلب كافة منتجات المخزن مع دعم الصفحات (Pagination) والتمرير التلقائي (Infinite Scroll)
CREATE OR REPLACE FUNCTION public.get_warehouse_products_flexible(
    p_warehouse_id UUID,
    p_limit INT DEFAULT 1000,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    warehouse_id UUID,
    product_data JSONB,
    created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id, warehouse_id, product_data, created_at
    FROM public.warehouse_products_flexible
    WHERE warehouse_id = p_warehouse_id
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET p_offset;
$$;

-- 3. دالة RPC لعمليات الحفظ والتحديث الذكية (Upsert)
CREATE OR REPLACE FUNCTION public.upsert_warehouse_products_flexible(
    p_warehouse_id UUID,
    p_products JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item JSONB;
    v_trade_name TEXT;
    v_batch_number TEXT;
    v_new_qty NUMERIC;
    v_new_price NUMERIC;
    v_sales_discount NUMERIC;
    v_purchase_discount NUMERIC;
    v_expiry_date TEXT;
    v_existing_id UUID;
    v_existing_data JSONB;
    v_existing_qty NUMERIC;
    v_updated_data JSONB;
    v_inserted_count INT := 0;
    v_updated_count INT := 0;
BEGIN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_products)
    LOOP
        -- توحيد استخراج حقول الاسم والتشغيلة
        v_trade_name := TRIM(COALESCE(v_item->>'trade_name', v_item->>'tradeName', ''));
        v_batch_number := TRIM(COALESCE(v_item->>'batch_number', v_item->>'batchNumber', ''));
        
        IF v_trade_name = '' THEN
            CONTINUE;
        END IF;

        v_new_qty := COALESCE((v_item->>'quantity')::NUMERIC, 0);
        v_new_price := COALESCE((v_item->>'public_price')::NUMERIC, (v_item->>'price')::NUMERIC, 0);
        v_sales_discount := COALESCE((v_item->>'sales_discount')::NUMERIC, (v_item->>'discount')::NUMERIC, 0);
        v_purchase_discount := COALESCE((v_item->>'purchase_discount')::NUMERIC, 0);
        v_expiry_date := COALESCE(v_item->>'expiry_date', v_item->>'expiryDate', '');

        -- توحيد المفاتيح داخل product_data لضمان الاتساق
        v_item := v_item || jsonb_build_object(
            'trade_name', v_trade_name,
            'batch_number', v_batch_number,
            'quantity', v_new_qty,
            'public_price', v_new_price,
            'price', v_new_price,
            'sales_discount', v_sales_discount,
            'discount', v_sales_discount,
            'purchase_discount', v_purchase_discount,
            'expiry_date', v_expiry_date
        );

        IF v_batch_number <> '' THEN
            -- ----------------------------------------------------
            -- حالة 1: وجود رقم تشغيلة (Batch Number)
            -- البحث في الفهرس عن السطر الموحد لنفس التشغيلة
            -- ----------------------------------------------------
            SELECT id, product_data INTO v_existing_id, v_existing_data
            FROM warehouse_products_flexible
            WHERE warehouse_id = p_warehouse_id
              AND COALESCE(product_data->>'trade_name', product_data->>'tradeName', '') = v_trade_name
              AND COALESCE(product_data->>'batch_number', product_data->>'batchNumber', '') = v_batch_number
            LIMIT 1;

            IF v_existing_id IS NOT NULL THEN
                v_existing_qty := COALESCE((v_existing_data->>'quantity')::NUMERIC, 0);
                v_updated_data := v_existing_data || jsonb_build_object(
                    'quantity', v_existing_qty + v_new_qty,
                    'public_price', v_new_price,
                    'price', v_new_price,
                    'sales_discount', v_sales_discount,
                    'discount', v_sales_discount,
                    'purchase_discount', v_purchase_discount,
                    'expiry_date', v_expiry_date,
                    'updated_at', NOW()
                );

                UPDATE warehouse_products_flexible
                SET product_data = v_updated_data,
                    updated_at = NOW()
                WHERE id = v_existing_id;

                v_updated_count := v_updated_count + 1;
            ELSE
                INSERT INTO warehouse_products_flexible (
                    warehouse_id,
                    product_data
                ) VALUES (
                    p_warehouse_id,
                    v_item
                );

                v_inserted_count := v_inserted_count + 1;
            END IF;

        ELSE
            -- ----------------------------------------------------
            -- حالة 2: عدم وجود رقم تشغيلة (بدون Batch Number)
            -- تعديل البيانات المالية والانتهاء وتراكم (جمع) الكمية فقط
            -- ----------------------------------------------------
            SELECT id, product_data INTO v_existing_id, v_existing_data
            FROM warehouse_products_flexible
            WHERE warehouse_id = p_warehouse_id
              AND COALESCE(product_data->>'trade_name', product_data->>'tradeName', '') = v_trade_name
              AND COALESCE(product_data->>'batch_number', product_data->>'batchNumber', '') = ''
            LIMIT 1;

            IF v_existing_id IS NOT NULL THEN
                v_existing_qty := COALESCE((v_existing_data->>'quantity')::NUMERIC, 0);
                v_updated_data := v_existing_data || jsonb_build_object(
                    'quantity', v_existing_qty + v_new_qty,
                    'public_price', v_new_price,
                    'price', v_new_price,
                    'sales_discount', v_sales_discount,
                    'discount', v_sales_discount,
                    'purchase_discount', v_purchase_discount,
                    'expiry_date', v_expiry_date,
                    'updated_at', NOW()
                );

                UPDATE warehouse_products_flexible
                SET product_data = v_updated_data,
                    updated_at = NOW()
                WHERE id = v_existing_id;

                v_updated_count := v_updated_count + 1;
            ELSE
                INSERT INTO warehouse_products_flexible (
                    warehouse_id,
                    product_data
                ) VALUES (
                    p_warehouse_id,
                    v_item
                );

                v_inserted_count := v_inserted_count + 1;
            END IF;

        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'inserted', v_inserted_count,
        'updated', v_updated_count
    );
END;
$$;
