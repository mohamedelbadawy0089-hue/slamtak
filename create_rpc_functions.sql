-- RPC Functions لنظام الأداء الصاروخي
-- هذه الدوال تعالج البيانات داخل PostgreSQL مباشرة لتحسين الأداء

-- تفعيل امتداد pg_trgm للبحث المرن (Fuzzy Search)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- إنشاء TYPE لتجميع المنتجات بدون batch_number
DROP TYPE IF EXISTS product_summary CASCADE;
CREATE TYPE product_summary AS (
    trade_name TEXT,
    total_quantity NUMERIC,
    public_price NUMERIC,
    purchase_discount NUMERIC,
    sales_discount NUMERIC,
    net_price NUMERIC,
    production_date DATE,
    expiry_date DATE,
    category TEXT
);

-- حذف الدوال القديمة لتجنب تضارب الأسماء
DROP FUNCTION IF EXISTS batch_insert_drugs(TEXT, JSONB);
DROP FUNCTION IF EXISTS batch_insert_drugs(UUID, JSONB);
DROP FUNCTION IF EXISTS batch_process_drugs(TEXT, JSONB);
DROP FUNCTION IF EXISTS search_drugs(TEXT, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS search_drugs(UUID, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS get_warehouse_stats(UUID);
DROP FUNCTION IF EXISTS delete_all_current_warehouse_drugs(TEXT);

-- إزالة قيد unique القديم الذي يتعارض مع Partial Unique Index
ALTER TABLE drugs DROP CONSTRAINT IF EXISTS drugs_tradename_warehouse_id_key;

-- إنشاء Partial Unique Index للمنتجات العامة (بدون batch_number)
DROP INDEX IF EXISTS idx_drugs_unique_general_product;
CREATE UNIQUE INDEX idx_drugs_unique_general_product
ON drugs ("tradeName", warehouse_id)
WHERE batch_number IS NULL;

-- إنشاء GIN Index مع pg_trgm للبحث المرن (Fuzzy Search)
DROP INDEX IF EXISTS idx_drugs_trade_name_trgm;
CREATE INDEX idx_drugs_trade_name_trgm
ON drugs USING GIN ("tradeName" gin_trgm_ops);

DROP INDEX IF EXISTS idx_drugs_batch_number_trgm;
CREATE INDEX idx_drugs_batch_number_trgm
ON drugs USING GIN (batch_number gin_trgm_ops);

DROP INDEX IF EXISTS idx_drugs_category_trgm;
CREATE INDEX idx_drugs_category_trgm
ON drugs USING GIN (category gin_trgm_ops);

-- إنشاء GIN Index للبحث السريع في النصوص (tradeName, batchNumber, category)
DROP INDEX IF EXISTS idx_drugs_gin_search;
CREATE INDEX idx_drugs_gin_search
ON drugs USING GIN (
    to_tsvector('arabic', COALESCE("tradeName", '') || ' ' || COALESCE(batch_number, '') || ' ' || COALESCE(category, ''))
);

-- إنشاء Index للبحث البسيط في tradeName (ILIKE)
DROP INDEX IF EXISTS idx_drugs_trade_name;
CREATE INDEX idx_drugs_trade_name
ON drugs ("tradeName");

-- إنشاء Index للبحث في batch_number
DROP INDEX IF EXISTS idx_drugs_batch_number;
CREATE INDEX idx_drugs_batch_number
ON drugs (batch_number);

-- إنشاء Index للبحث في category
DROP INDEX IF EXISTS idx_drugs_category;
CREATE INDEX idx_drugs_category
ON drugs (category);

-- إنشاء Index للبحث في warehouse_id (مهم للفصل بين المخازن)
DROP INDEX IF EXISTS idx_drugs_warehouse_id;
CREATE INDEX idx_drugs_warehouse_id
ON drugs (warehouse_id);

-- RPC Function لمعالجة البيانات في دفعات مع ON CONFLICT الذكي (بدون DELETE)
CREATE OR REPLACE FUNCTION batch_process_drugs(
    p_warehouse_id TEXT,
    p_drugs JSONB
)
RETURNS JSONB AS $$
DECLARE
    v_drug JSONB;
    v_result JSONB := '{"success": true, "inserted": 0, "updated": 0, "errors": [], "filtered": 0}'::JSONB;
    v_inserted_count INTEGER := 0;
    v_updated_count INTEGER := 0;
    v_error_count INTEGER := 0;
    v_filtered_count INTEGER := 0;
    v_warehouse_id UUID;
    v_batch_number TEXT;
    v_trade_name TEXT;
    v_public_price DECIMAL(10, 2);
    v_sales_discount DECIMAL(5, 2);
    v_net_price DECIMAL(10, 2);
    v_quantity INTEGER;
BEGIN
    -- التحقق من وجود warehouse_id
    IF p_warehouse_id IS NULL OR p_warehouse_id = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'warehouse_id is required'
        );
    END IF;

    -- تحويل warehouse_id من TEXT إلى UUID
    BEGIN
        v_warehouse_id := p_warehouse_id::UUID;
    EXCEPTION
        WHEN OTHERS THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Invalid warehouse_id format'
            );
    END;

    -- التحقق من وجود البيانات
    IF p_drugs IS NULL OR jsonb_array_length(p_drugs) = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'No drugs to process'
        );
    END IF;

    -- معالجة كل دواء في الدفعة
    FOR v_drug IN SELECT * FROM jsonb_array_elements(p_drugs) LOOP
        BEGIN
            -- استخراج البيانات الأساسية
            v_batch_number := v_drug->>'batchNumber';
            v_trade_name := v_drug->>'tradeName';

            -- تصفية: تجاهل الصفوف بدون tradeName
            IF v_trade_name IS NULL OR v_trade_name = '' THEN
                v_filtered_count := v_filtered_count + 1;
                RAISE NOTICE 'Filtered out row without tradeName';
                CONTINUE;
            END IF;

            -- استخراج الأسعار وحساب net_price في السيرفر
            v_public_price := COALESCE((v_drug->>'public_price')::DECIMAL(10, 2), 0);
            v_sales_discount := COALESCE((v_drug->>'sales_discount')::DECIMAL(5, 2), 0);
            v_net_price := v_public_price * (1 - v_sales_discount / 100);

            -- استخراج الكمية
            v_quantity := COALESCE((v_drug->>'quantity')::INTEGER, 0);

            -- Debug: تسجيل قيم المعالجة
            RAISE NOTICE 'Processing drug: batchNumber=%, tradeName=%, public_price=%, discount=%, net_price=%', 
                v_batch_number, v_trade_name, v_public_price, v_sales_discount, v_net_price;

            -- إذا كان المنتج عاماً (بدون batch_number)، استخدم ON CONFLICT مع UPDATE
            IF v_batch_number IS NULL OR v_batch_number = '' THEN
                INSERT INTO drugs (
                    warehouse_id,
                    batch_number,
                    "tradeName",
                    public_price,
                    net_price,
                    production_date,
                    expiry_date,
                    quantity,
                    purchase_discount,
                    sales_discount,
                    category,
                    created_at,
                    updated_at
                ) VALUES (
                    v_warehouse_id,
                    NULL,
                    v_trade_name,
                    v_public_price,
                    v_net_price,
                    (v_drug->>'production_date')::DATE,
                    (v_drug->>'expiry_date')::DATE,
                    v_quantity,
                    COALESCE((v_drug->>'purchase_discount')::DECIMAL(5, 2), 0),
                    v_sales_discount,
                    v_drug->>'category',
                    NOW(),
                    NOW()
                ) ON CONFLICT ("tradeName", warehouse_id) WHERE batch_number IS NULL
                DO UPDATE SET
                    quantity = drugs.quantity + EXCLUDED.quantity,
                    public_price = EXCLUDED.public_price,
                    net_price = EXCLUDED.net_price,
                    production_date = EXCLUDED.production_date,
                    expiry_date = EXCLUDED.expiry_date,
                    purchase_discount = EXCLUDED.purchase_discount,
                    sales_discount = EXCLUDED.sales_discount,
                    category = EXCLUDED.category,
                    updated_at = NOW();

                -- التحقق مما إذا كان إدراج أو تحديث
                IF FOUND THEN
                    -- إذا كان الصف موجوداً مسبقاً، نعتبره تحديث
                    SELECT COUNT(*) INTO v_updated_count
                    FROM drugs
                    WHERE "tradeName" = v_drug->>'tradeName'
                    AND warehouse_id = v_warehouse_id
                    AND batch_number IS NULL
                    AND updated_at > NOW() - INTERVAL '1 second';

                    IF v_updated_count > 0 THEN
                        v_updated_count := v_updated_count + 1;
                    ELSE
                        v_inserted_count := v_inserted_count + 1;
                    END IF;
                ELSE
                    v_inserted_count := v_inserted_count + 1;
                END IF;
            ELSE
                -- المنتج مع batch_number: إضافة كصف جديد دائماً
                INSERT INTO drugs (
                    warehouse_id,
                    batch_number,
                    "tradeName",
                    public_price,
                    net_price,
                    production_date,
                    expiry_date,
                    quantity,
                    purchase_discount,
                    sales_discount,
                    category,
                    created_at,
                    updated_at
                ) VALUES (
                    v_warehouse_id,
                    v_batch_number,
                    v_trade_name,
                    v_public_price,
                    v_net_price,
                    (v_drug->>'production_date')::DATE,
                    (v_drug->>'expiry_date')::DATE,
                    v_quantity,
                    COALESCE((v_drug->>'purchase_discount')::DECIMAL(5, 2), 0),
                    v_sales_discount,
                    v_drug->>'category',
                    NOW(),
                    NOW()
                ) ON CONFLICT DO NOTHING;

                v_inserted_count := v_inserted_count + 1;
            END IF;
        EXCEPTION
            WHEN OTHERS THEN
                v_error_count := v_error_count + 1;
                v_result := v_result || jsonb_build_object(
                    'errors', COALESCE(v_result->'errors', '[]'::jsonb) || jsonb_build_array(
                        jsonb_build_object(
                            'drug', v_drug,
                            'error', SQLERRM
                        )
                    )
                );
        END;
    END LOOP;

    -- تحديث النتيجة
    v_result := v_result || jsonb_build_object(
        'inserted', v_inserted_count,
        'updated', v_updated_count,
        'errors_count', v_error_count,
        'filtered', v_filtered_count
    );

    -- إذا كانت هناك أخطاء، نجعل النجاح false
    IF v_error_count > 0 THEN
        v_result := v_result || jsonb_build_object('success', false);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.resolve_drug_column_name(canonical_name TEXT)
RETURNS TEXT
LANGUAGE sql AS $$
    WITH candidates AS (
        SELECT lower(trim($1)) AS requested,
               unnest(ARRAY[
                   lower(trim($1)),
                   CASE lower(trim($1))
                       WHEN 'trade_name' THEN 'tradeName'
                       WHEN 'tradename' THEN 'tradeName'
                       WHEN 'tradeName' THEN 'trade_name'
                       WHEN 'batch_number' THEN 'batchNumber'
                       WHEN 'batchnumber' THEN 'batch_number'
                       WHEN 'batchNumber' THEN 'batch_number'
                       WHEN 'public_price' THEN 'publicPrice'
                       WHEN 'publicprice' THEN 'public_price'
                       WHEN 'publicPrice' THEN 'public_price'
                       WHEN 'sales_discount' THEN 'salesDiscount'
                       WHEN 'salesdiscount' THEN 'sales_discount'
                       WHEN 'salesDiscount' THEN 'sales_discount'
                       WHEN 'purchase_discount' THEN 'purchaseDiscount'
                       WHEN 'purchasediscount' THEN 'purchase_discount'
                       WHEN 'purchaseDiscount' THEN 'purchase_discount'
                       WHEN 'production_date' THEN 'productionDate'
                       WHEN 'productiondate' THEN 'production_date'
                       WHEN 'productionDate' THEN 'production_date'
                       WHEN 'expiry_date' THEN 'expiryDate'
                       WHEN 'expirydate' THEN 'expiry_date'
                       WHEN 'expiryDate' THEN 'expiry_date'
                       WHEN 'warehouse_id' THEN 'warehouseId'
                       WHEN 'warehouseid' THEN 'warehouse_id'
                       WHEN 'warehouseId' THEN 'warehouse_id'
                       ELSE NULL
                   END
               ]) AS candidate
    )
    SELECT COALESCE(
        (SELECT c.column_name
         FROM information_schema.columns c
         JOIN candidates cand ON lower(c.column_name) = cand.candidate
         WHERE table_name = 'drugs'
           AND lower(c.column_name) IN (SELECT candidate FROM candidates)
         ORDER BY CASE WHEN lower(c.column_name) = cand.requested THEN 0 ELSE 1 END
         LIMIT 1),
        lower(trim($1))
    );
$$;

-- RPC Function للبحث مع دعم الأعمدة snake_case و camelCase
CREATE OR REPLACE FUNCTION search_drugs(
    p_warehouse_id TEXT,
    p_search_term VARCHAR DEFAULT NULL,
    p_batch_number VARCHAR DEFAULT NULL,
    p_trade_name VARCHAR DEFAULT NULL,
    p_limit INTEGER DEFAULT 50000,
    p_offset INTEGER DEFAULT 0
)
RETURNS JSONB AS $$
DECLARE
    v_data JSONB;
    v_warehouse_id UUID;
    v_trade_col TEXT;
    v_batch_col TEXT;
    v_public_price_col TEXT;
    v_net_price_col TEXT;
    v_production_date_col TEXT;
    v_expiry_date_col TEXT;
    v_quantity_col TEXT;
    v_purchase_discount_col TEXT;
    v_sales_discount_col TEXT;
    v_category_col TEXT;
    v_where_clause TEXT := '';
    v_sql TEXT;
BEGIN
    IF p_warehouse_id IS NULL OR p_warehouse_id = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'warehouse_id is required'
        );
    END IF;

    BEGIN
        v_warehouse_id := p_warehouse_id::UUID;
    EXCEPTION
        WHEN OTHERS THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Invalid warehouse_id format'
            );
    END;

    v_trade_col := resolve_drug_column_name('trade_name');
    v_batch_col := resolve_drug_column_name('batch_number');
    v_public_price_col := resolve_drug_column_name('public_price');
    v_net_price_col := resolve_drug_column_name('net_price');
    v_production_date_col := resolve_drug_column_name('production_date');
    v_expiry_date_col := resolve_drug_column_name('expiry_date');
    v_quantity_col := resolve_drug_column_name('quantity');
    v_purchase_discount_col := resolve_drug_column_name('purchase_discount');
    v_sales_discount_col := resolve_drug_column_name('sales_discount');
    v_category_col := resolve_drug_column_name('category');

    IF p_search_term IS NOT NULL AND trim(p_search_term) <> '' THEN
        v_where_clause := v_where_clause || format(
            ' AND (lower(%I) LIKE lower(%L) OR lower(%I) LIKE lower(%L) OR lower(%I) LIKE lower(%L))',
            v_trade_col, '%' || trim(p_search_term) || '%',
            v_batch_col, '%' || trim(p_search_term) || '%',
            v_category_col, '%' || trim(p_search_term) || '%'
        );
    END IF;

    IF p_batch_number IS NOT NULL AND trim(p_batch_number) <> '' THEN
        v_where_clause := v_where_clause || format(
            ' AND lower(%I) = lower(%L)',
            v_batch_col, trim(p_batch_number)
        );
    END IF;

    IF p_trade_name IS NOT NULL AND trim(p_trade_name) <> '' THEN
        v_where_clause := v_where_clause || format(
            ' AND lower(%I) LIKE lower(%L)',
            v_trade_col, '%' || trim(p_trade_name) || '%'
        );
    END IF;

    v_sql := format(
        'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb)
         FROM (
            SELECT id,
                   warehouse_id,
                   %I AS "batchNumber",
                   %I AS "tradeName",
                   %I AS public_price,
                   %I AS net_price,
                   %I AS production_date,
                   %I AS expiry_date,
                   %I AS quantity,
                   %I AS purchase_discount,
                   %I AS sales_discount,
                   %I AS category,
                   created_at,
                   updated_at
            FROM drugs
            WHERE warehouse_id::text = %L%s
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
         ) t',
        v_batch_col,
        v_trade_col,
        v_public_price_col,
        v_net_price_col,
        v_production_date_col,
        v_expiry_date_col,
        v_quantity_col,
        v_purchase_discount_col,
        v_sales_discount_col,
        v_category_col,
        v_warehouse_id,
        v_where_clause,
        p_limit,
        p_offset
    );

    EXECUTE v_sql INTO v_data;

    IF v_data IS NULL THEN
        v_data := '[]'::JSONB;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'data', v_data,
        'count', jsonb_array_length(v_data)
    );
END;
$$ LANGUAGE plpgsql;

-- RPC Function للحصول على إحصائيات المخزن
CREATE OR REPLACE FUNCTION get_warehouse_stats(
    p_warehouse_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_total_drugs INTEGER;
    v_total_quantity INTEGER;
    v_expiring_soon INTEGER;
    v_expired INTEGER;
BEGIN
    -- التحقق من وجود warehouse_id
    IF p_warehouse_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'warehouse_id is required'
        );
    END IF;
    
    -- إجمالي عدد الأدوية
    SELECT COUNT(*) INTO v_total_drugs
    FROM drugs
    WHERE warehouse_id = p_warehouse_id;
    
    -- إجمالي الكمية
    SELECT COALESCE(SUM(quantity), 0) INTO v_total_quantity
    FROM drugs
    WHERE warehouse_id = p_warehouse_id;
    
    -- الأدوية التي تنتهي قريباً (خلال 30 يوم)
    SELECT COUNT(*) INTO v_expiring_soon
    FROM drugs
    WHERE warehouse_id = p_warehouse_id
    AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days';
    
    -- الأدوية المنتهية
    SELECT COUNT(*) INTO v_expired
    FROM drugs
    WHERE warehouse_id = p_warehouse_id
    AND expiry_date < CURRENT_DATE;
    
    RETURN jsonb_build_object(
        'success', true,
        'total_drugs', v_total_drugs,
        'total_quantity', v_total_quantity,
        'expiring_soon', v_expiring_soon,
        'expired', v_expired
    );
END;
$$ LANGUAGE plpgsql;

-- RPC Function لحذف جميع أدوية المخزن الحالي
CREATE OR REPLACE FUNCTION delete_all_current_warehouse_drugs(
    p_warehouse_id TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_warehouse_id UUID;
    v_deleted_count INTEGER;
BEGIN
    -- التحقق من وجود warehouse_id
    IF p_warehouse_id IS NULL OR p_warehouse_id = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'warehouse_id is required'
        );
    END IF;

    -- تحويل warehouse_id من TEXT إلى UUID
    BEGIN
        v_warehouse_id := p_warehouse_id::UUID;
    EXCEPTION
        WHEN OTHERS THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Invalid warehouse_id format'
            );
    END;

    -- حذف جميع الأدوية الخاصة بالمخزن
    DELETE FROM drugs
    WHERE warehouse_id = v_warehouse_id;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'deleted_count', v_deleted_count
    );
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION batch_process_drugs TO authenticated;
GRANT EXECUTE ON FUNCTION search_drugs TO authenticated;
GRANT EXECUTE ON FUNCTION get_warehouse_stats TO authenticated;
GRANT EXECUTE ON FUNCTION delete_all_current_warehouse_drugs TO authenticated;

-- دالة مساعدة لتحويل التواريخ
CREATE OR REPLACE FUNCTION convert_date_string(p_date_str TEXT)
RETURNS DATE AS $$
BEGIN
    -- إذا كان فارغاً أو قصيراً جداً
    IF p_date_str IS NULL OR TRIM(p_date_str) = '' OR LENGTH(TRIM(p_date_str)) < 3 THEN
        RETURN NULL;
    END IF;
    
    -- محاولة التحويل المباشر
    BEGIN
        RETURN p_date_str::DATE;
    EXCEPTION
        WHEN OTHERS THEN
            -- محاولة تحويل تنسيق شهر/سنة (مثل 12/2026)
            BEGIN
                IF p_date_str ~ '^\d{1,2}/\d{4}$' THEN
                    RETURN (regexp_split_to_array(p_date_str, '/'))[2] || '-' || LPAD((regexp_split_to_array(p_date_str, '/'))[1], 2, '0') || '-01'::DATE;
                ELSE
                    RETURN NULL;
                END IF;
            EXCEPTION
                WHEN OTHERS THEN
                    RETURN NULL;
            END;
    END;
END;
$$ LANGUAGE plpgsql;

-- دالة معالجة البيانات الخام من Excel على السيرفر (Server-side)
CREATE OR REPLACE FUNCTION process_bulk_excel_data(
    p_raw_data TEXT,
    p_warehouse_id TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_warehouse_id UUID;
    v_rows TEXT[];
    v_row TEXT;
    v_columns TEXT[];
    v_drug RECORD;
    v_count INTEGER := 0;
    v_error_message TEXT;
    v_has_headers BOOLEAN;
    v_start_index INTEGER;
    v_header_map JSONB;
    -- متغيرات للمطابقة الديناميكية
    v_col_batchNumber INTEGER := 0;
    v_col_tradeName INTEGER := 0;
    v_col_quantity INTEGER := 0;
    v_col_public_price INTEGER := 0;
    v_col_purchase_discount INTEGER := 0;
    v_col_sales_discount INTEGER := 0;
    v_col_production_date INTEGER := 0;
    v_col_expiry_date INTEGER := 0;
    v_col_category INTEGER := 0;
    v_header_lower TEXT;
BEGIN
    -- زيادة timeout للدالة إلى 10 دقائق لمعالجة كميات كبيرة
    SET LOCAL statement_timeout = '10min';
    -- التحقق من وجود البيانات
    IF p_raw_data IS NULL OR p_raw_data = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'No data provided'
        );
    END IF;

    -- التحقق من وجود warehouse_id
    IF p_warehouse_id IS NULL OR p_warehouse_id = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'warehouse_id is required'
        );
    END IF;

    -- تحويل warehouse_id من TEXT إلى UUID
    BEGIN
        v_warehouse_id := p_warehouse_id::UUID;
        RAISE NOTICE 'process_bulk_excel_data: warehouse_id = %', v_warehouse_id;
    EXCEPTION
        WHEN OTHERS THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Invalid warehouse_id format'
            );
    END;

    -- تقسيم النص إلى صفوف
    v_rows := regexp_split_to_array(p_raw_data, E'\n');
    
    -- التحقق من وجود صفوف
    IF array_length(v_rows, 1) IS NULL OR array_length(v_rows, 1) = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'No rows found in data'
        );
    END IF;

    -- التحقق من الصف الأول إذا كان يحتوي على عناوين
    v_row := v_rows[1];
    v_columns := regexp_split_to_array(v_row, E'\t');
    
    -- التحقق من وجود عناوين (إذا كانت القيم غير رقمية)
    v_has_headers := false;
    FOR i IN 1..array_length(v_columns, 1) LOOP
        IF v_columns[i] IS NOT NULL AND v_columns[i] != '' THEN
            -- محاولة تحويل القيمة إلى رقم
            BEGIN
                PERFORM v_columns[i]::FLOAT;
            EXCEPTION
                WHEN OTHERS THEN
                    v_has_headers := true;
                    EXIT;
            END;
        END IF;
    END LOOP;

    -- تحديد بداية البيانات (تخطي العناوين إذا وجدت)
    v_start_index := CASE WHEN v_has_headers THEN 2 ELSE 1 END;

    -- المطابقة الديناميكية للأعمدة من العناوين
    IF v_has_headers THEN
        FOR i IN 1..array_length(v_columns, 1) LOOP
            v_header_lower := LOWER(TRIM(v_columns[i]));
            
            -- مطابقة عمود التشغيلة
            IF v_header_lower IN ('batch', 'batchnumber', 'تشغيلة', 'التشغيلة') THEN
                v_col_batchNumber := i;
            -- مطابقة عمود الصنف (معاملة كـ TEXT خالص)
            ELSIF v_header_lower IN ('name', 'tradename', 'صنف', 'الصنف') THEN
                v_col_tradeName := i;
            -- مطابقة عمود الكمية
            ELSIF v_header_lower IN ('qty', 'quantity', 'كمية', 'الكمية') THEN
                v_col_quantity := i;
            -- مطابقة عمود السعر
            ELSIF v_header_lower IN ('price', 'public_price', 'سعر', 'السعر') THEN
                v_col_public_price := i;
            -- مطابقة عمود خصم الشراء
            ELSIF v_header_lower IN ('pdisc', 'purchase_discount', 'خصم شراء', 'خصم الشراء (%)') THEN
                v_col_purchase_discount := i;
            -- مطابقة عمود خصم البيع
            ELSIF v_header_lower IN ('sdisc', 'sales_discount', 'خصم بيع', 'خصم البيع (%)') THEN
                v_col_sales_discount := i;
            -- مطابقة عمود تاريخ الإنتاج
            ELSIF v_header_lower IN ('prod', 'production_date', 'تاريخ إنتاج', 'تاريخ الانتاج') THEN
                v_col_production_date := i;
            -- مطابقة عمود تاريخ الانتهاء
            ELSIF v_header_lower IN ('exp', 'expiry_date', 'تاريخ انتهاء', 'تاريخ الانتهاء') THEN
                v_col_expiry_date := i;
            -- مطابقة عمود التصنيف
            ELSIF v_header_lower IN ('cat', 'category', 'تصنيف', 'التصنيف') THEN
                v_col_category := i;
            END IF;
        END LOOP;
    ELSE
        -- إذا لم توجد عناوين، استخدم الترتيب الافتراضي
        v_col_batchNumber := 1;
        v_col_tradeName := 2;
        v_col_quantity := 3;
        v_col_public_price := 4;
        v_col_purchase_discount := 5;
        v_col_sales_discount := 6;
        v_col_production_date := 7;
        v_col_expiry_date := 8;
        v_col_category := 9;
    END IF;

    -- معالجة البيانات باستخدام batch insert (كل 10 صف في مرة واحدة لتجنب timeout)
    -- Trigger سيقوم بحساب net_price تلقائياً
    DECLARE
        v_batch_values TEXT[];
        v_current_batch_with_batch TEXT[] := '{}';
        v_current_batch_no_batch TEXT[] := '{}';
        v_batch_size_with_batch INTEGER := 0;
        v_batch_size_no_batch INTEGER := 0;
        v_max_batch_size INTEGER := 500;
        v_value_text TEXT;
        v_has_batch BOOLEAN;
        v_trade_name TEXT;
        v_quantity NUMERIC;
        v_public_price NUMERIC;
        v_purchase_discount NUMERIC;
        v_sales_discount NUMERIC;
        v_net_price NUMERIC;
        v_production_date DATE;
        v_expiry_date DATE;
        v_category TEXT;
        v_product_summaries product_summary[];
        v_found_summary BOOLEAN;
        v_summary_index INTEGER;
    BEGIN
        -- التحقق من أن المصفوفة ليست فارغة
        IF v_rows IS NULL OR array_length(v_rows, 1) IS NULL THEN
            RETURN jsonb_build_object(
                'success', true,
                'processed_count', 0,
                'has_headers', v_has_headers
            );
        END IF;

        -- التحقق من أن v_start_index ضمن النطاق
        IF v_start_index > array_length(v_rows, 1) THEN
            RETURN jsonb_build_object(
                'success', true,
                'processed_count', 0,
                'has_headers', v_has_headers
            );
        END IF;

        FOR i IN v_start_index..array_length(v_rows, 1) LOOP
            v_row := v_rows[i];
            CONTINUE WHEN v_row IS NULL OR v_row = '';

            v_columns := regexp_split_to_array(v_row, E'\t');

            -- التحقق من وجود batch_number
            v_has_batch := COALESCE(v_columns[v_col_batchNumber], '') IS NOT NULL AND COALESCE(v_columns[v_col_batchNumber], '') != '';

            -- استخراج القيم
            v_trade_name := COALESCE(v_columns[v_col_tradeName], '');
            v_quantity := CASE WHEN v_columns[v_col_quantity] = '' OR v_columns[v_col_quantity] = 'متوفر' THEN 0 ELSE COALESCE(v_columns[v_col_quantity]::FLOAT, 0) END;
            v_public_price := COALESCE(v_columns[v_col_public_price]::FLOAT, 0);
            v_purchase_discount := COALESCE(v_columns[v_col_purchase_discount]::FLOAT, 0);
            v_sales_discount := COALESCE(v_columns[v_col_sales_discount]::FLOAT, 0);
            v_net_price := (v_public_price * (1 - v_sales_discount / 100))::NUMERIC(10,2);
            v_production_date := convert_date_string(v_columns[v_col_production_date]);
            v_expiry_date := convert_date_string(v_columns[v_col_expiry_date]);
            v_category := COALESCE(v_columns[v_col_category], '');

            -- بناء قيمة واحدة للإدخال
            v_value_text := format(
                '(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, NOW(), NOW())',
                COALESCE(v_columns[v_col_batchNumber], ''),
                v_trade_name,
                v_quantity,
                v_public_price,
                v_purchase_discount,
                v_sales_discount,
                v_net_price,
                v_production_date,
                v_expiry_date,
                v_category,
                v_warehouse_id
            );

            -- فصل الصفوف حسب وجود batch_number
            IF v_has_batch THEN
                -- مع batch_number: INSERT مع ON CONFLICT للتحديث الذكي
                v_current_batch_with_batch := array_append(v_current_batch_with_batch, v_value_text);
                v_batch_size_with_batch := v_batch_size_with_batch + 1;

                -- إرسال الـ batch عند الوصول للحد الأقصى
                IF v_batch_size_with_batch >= v_max_batch_size THEN
                    EXECUTE format(
                        'INSERT INTO drugs ("batchNumber", "tradeName", quantity, "public_price", "purchase_discount", "sales_discount", net_price, production_date, expiry_date, category, warehouse_id, created_at, updated_at) VALUES %s ON CONFLICT ("batchNumber", "tradeName", warehouse_id) DO NOTHING',
                        array_to_string(v_current_batch_with_batch, ', ')
                    );
                    v_current_batch_with_batch := '{}';
                    v_batch_size_with_batch := 0;
                END IF;
            ELSE
                -- بدون batch_number: تجميع البيانات في المصفوفة
                v_found_summary := false;
                v_summary_index := 1;

                -- البحث عن ملخص موجود لنفس المنتج
                WHILE v_summary_index <= array_length(v_product_summaries, 1) AND NOT v_found_summary LOOP
                    IF v_product_summaries[v_summary_index].trade_name = v_trade_name THEN
                        v_found_summary := true;
                        -- جمع الكمية وتحديث البيانات
                        v_product_summaries[v_summary_index].total_quantity := v_product_summaries[v_summary_index].total_quantity + v_quantity;
                        -- تحديث البيانات بالقيم الأحدث
                        v_product_summaries[v_summary_index].public_price := v_public_price;
                        v_product_summaries[v_summary_index].purchase_discount := v_purchase_discount;
                        v_product_summaries[v_summary_index].sales_discount := v_sales_discount;
                        v_product_summaries[v_summary_index].net_price := v_net_price;
                        v_product_summaries[v_summary_index].production_date := v_production_date;
                        v_product_summaries[v_summary_index].expiry_date := v_expiry_date;
                        v_product_summaries[v_summary_index].category := v_category;
                    END IF;
                    v_summary_index := v_summary_index + 1;
                END LOOP;

                -- إذا لم يتم العثور على ملخص، إنشاء جديد
                IF NOT v_found_summary THEN
                    v_product_summaries := array_append(v_product_summaries, ROW(
                        v_trade_name,
                        v_quantity,
                        v_public_price,
                        v_purchase_discount,
                        v_sales_discount,
                        v_net_price,
                        v_production_date,
                        v_expiry_date,
                        v_category
                    )::product_summary);
                END IF;
            END IF;

            v_count := v_count + 1;
        END LOOP;

        -- إدراج المنتجات بدون batch_number من المصفوفة
        FOR i IN 1..array_length(v_product_summaries, 1) LOOP
            v_value_text := format(
                '(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, NOW(), NOW())',
                '',
                v_product_summaries[i].trade_name,
                v_product_summaries[i].total_quantity,
                v_product_summaries[i].public_price,
                v_product_summaries[i].purchase_discount,
                v_product_summaries[i].sales_discount,
                v_product_summaries[i].net_price,
                v_product_summaries[i].production_date,
                v_product_summaries[i].expiry_date,
                v_product_summaries[i].category,
                v_warehouse_id
            );
            v_current_batch_no_batch := array_append(v_current_batch_no_batch, v_value_text);
            v_batch_size_no_batch := v_batch_size_no_batch + 1;

            -- إرسال الـ batch عند الوصول للحد الأقصى
            IF v_batch_size_no_batch >= v_max_batch_size THEN
                EXECUTE format(
                    'INSERT INTO drugs ("batchNumber", "tradeName", quantity, "public_price", "purchase_discount", "sales_discount", net_price, production_date, expiry_date, category, warehouse_id, created_at, updated_at) VALUES %s ON CONFLICT ("tradeName", warehouse_id) WHERE batch_number IS NULL DO UPDATE SET quantity = drugs.quantity + EXCLUDED.quantity, "public_price" = EXCLUDED."public_price", "purchase_discount" = EXCLUDED."purchase_discount", "sales_discount" = EXCLUDED."sales_discount", net_price = EXCLUDED.net_price, production_date = EXCLUDED.production_date, expiry_date = EXCLUDED.expiry_date, category = EXCLUDED.category, updated_at = NOW()',
                    array_to_string(v_current_batch_no_batch, ', ')
                );
                v_current_batch_no_batch := '{}';
                v_batch_size_no_batch := 0;
            END IF;
        END LOOP;
        
        -- إرسال الـ batch المتبقي للصفوف مع batch_number
        IF v_batch_size_with_batch > 0 THEN
            EXECUTE format(
                'INSERT INTO drugs ("batchNumber", "tradeName", quantity, "public_price", "purchase_discount", "sales_discount", net_price, production_date, expiry_date, category, warehouse_id, created_at, updated_at) VALUES %s ON CONFLICT ("batchNumber", "tradeName", warehouse_id) DO NOTHING',
                array_to_string(v_current_batch_with_batch, ', ')
            );
        END IF;
        
        -- إرسال الـ batch المتبقي للصفوف بدون batch_number
        IF v_batch_size_no_batch > 0 THEN
            EXECUTE format(
                'INSERT INTO drugs ("batchNumber", "tradeName", quantity, "public_price", "purchase_discount", "sales_discount", net_price, production_date, expiry_date, category, warehouse_id, created_at, updated_at) VALUES %s ON CONFLICT ("tradeName", warehouse_id) WHERE batch_number IS NULL DO UPDATE SET quantity = drugs.quantity + EXCLUDED.quantity, "public_price" = EXCLUDED."public_price", "purchase_discount" = EXCLUDED."purchase_discount", "sales_discount" = EXCLUDED."sales_discount", net_price = EXCLUDED.net_price, production_date = EXCLUDED.production_date, expiry_date = EXCLUDED.expiry_date, category = EXCLUDED.category, updated_at = NOW()',
                array_to_string(v_current_batch_no_batch, ', ')
            );
        END IF;
    END;

    RETURN jsonb_build_object(
        'success', true,
        'processed_count', v_count,
        'has_headers', v_has_headers
    );

EXCEPTION
    WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
        RETURN jsonb_build_object(
            'success', false,
            'error', v_error_message,
            'processed_count', v_count
        );
END;
$$ LANGUAGE plpgsql;

-- Grant permission for the new function
GRANT EXECUTE ON FUNCTION process_bulk_excel_data TO authenticated;

-- ============================================
-- دالة لجمع كميات المنتجات بدون تشغيلة
-- ============================================
CREATE OR REPLACE FUNCTION merge_duplicate_products(p_warehouse_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_merged_count INTEGER := 0;
BEGIN
    -- جمع كميات المنتجات بدون batch_number وتحديث البيانات
    WITH duplicates AS (
        SELECT
            "tradeName",
            warehouse_id,
            SUM(quantity) as total_quantity,
            MAX("public_price") as public_price,
            MAX("purchase_discount") as purchase_discount,
            MAX("sales_discount") as sales_discount,
            MAX(net_price) as net_price,
            MAX(production_date) as production_date,
            MAX(expiry_date) as expiry_date,
            MAX(category) as category
        FROM drugs
        WHERE warehouse_id = p_warehouse_id
        AND batch_number IS NULL
        GROUP BY "tradeName", warehouse_id
        HAVING COUNT(*) > 1
    )
    UPDATE drugs d
    SET
        quantity = dup.total_quantity,
        "public_price" = dup.public_price,
        "purchase_discount" = dup.purchase_discount,
        "sales_discount" = dup.sales_discount,
        net_price = dup.net_price,
        production_date = dup.production_date,
        expiry_date = dup.expiry_date,
        category = dup.category,
        updated_at = NOW()
    FROM duplicates dup
    WHERE d."tradeName" = dup."tradeName"
    AND d.warehouse_id = dup.warehouse_id
    AND d.batch_number IS NULL
    AND d.id = (
        SELECT MIN(id)
        FROM drugs d2
        WHERE d2."tradeName" = dup."tradeName"
        AND d2.warehouse_id = dup.warehouse_id
        AND d2.batch_number IS NULL
    );

    -- حذف الصفوف المكررة (الصفوف التي لم يتم تحديثها)
    DELETE FROM drugs d
    WHERE d.warehouse_id = p_warehouse_id
    AND d.batch_number IS NULL
    AND d.id NOT IN (
        SELECT MIN(id)
        FROM drugs d2
        WHERE d2.warehouse_id = p_warehouse_id
        AND d2.batch_number IS NULL
        GROUP BY d2."tradeName", d2.warehouse_id
    );

    GET DIAGNOSTICS v_merged_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'merged_count', v_merged_count
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', SQLERRM
        );
END;
$$ LANGUAGE plpgsql;

-- Grant permission for the merge function
GRANT EXECUTE ON FUNCTION merge_duplicate_products TO authenticated;

-- ============================================
-- دالة process_drug_entry لمعالجة إدخال المنتجات
-- ============================================
CREATE OR REPLACE FUNCTION process_drug_entry(
    p_batch_number TEXT,
    p_trade_name TEXT,
    p_quantity NUMERIC,
    p_public_price NUMERIC,
    p_purchase_discount NUMERIC,
    p_sales_discount NUMERIC,
    p_production_date DATE,
    p_expiry_date DATE,
    p_category TEXT,
    p_warehouse_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_net_price NUMERIC;
BEGIN
    -- حساب net_price
    v_net_price := (p_public_price * (1 - COALESCE(p_sales_discount, 0) / 100))::NUMERIC(10,2);

    -- التحقق من وجود batch_number
    IF p_batch_number IS NOT NULL AND p_batch_number != '' THEN
        -- مع batch_number: INSERT دائماً لسطر جديد
        INSERT INTO drugs (
            "batchNumber",
            "tradeName",
            quantity,
            "public_price",
            "purchase_discount",
            "sales_discount",
            net_price,
            production_date,
            expiry_date,
            category,
            warehouse_id,
            created_at,
            updated_at
        ) VALUES (
            p_batch_number,
            p_trade_name,
            p_quantity,
            p_public_price,
            p_purchase_discount,
            p_sales_discount,
            v_net_price,
            p_production_date,
            p_expiry_date,
            p_category,
            p_warehouse_id,
            NOW(),
            NOW()
        );
    ELSE
        -- بدون batch_number: INSERT مع ON CONFLICT لجمع الكميات وتحديث البيانات
        INSERT INTO drugs (
            "batchNumber",
            "tradeName",
            quantity,
            "public_price",
            "purchase_discount",
            "sales_discount",
            net_price,
            production_date,
            expiry_date,
            category,
            warehouse_id,
            created_at,
            updated_at
        ) VALUES (
            NULL,
            p_trade_name,
            p_quantity,
            p_public_price,
            p_purchase_discount,
            p_sales_discount,
            v_net_price,
            p_production_date,
            p_expiry_date,
            p_category,
            p_warehouse_id,
            NOW(),
            NOW()
        ) ON CONFLICT ("tradeName", warehouse_id) WHERE batch_number IS NULL
        DO UPDATE SET
            quantity = drugs.quantity + EXCLUDED.quantity,
            "public_price" = EXCLUDED."public_price",
            "purchase_discount" = EXCLUDED."purchase_discount",
            "sales_discount" = EXCLUDED."sales_discount",
            net_price = EXCLUDED.net_price,
            production_date = EXCLUDED.production_date,
            expiry_date = EXCLUDED.expiry_date,
            category = EXCLUDED.category,
            updated_at = NOW();
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Product processed successfully'
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', SQLERRM
        );
END;
$$ LANGUAGE plpgsql;

-- Grant permission for process_drug_entry
GRANT EXECUTE ON FUNCTION process_drug_entry TO authenticated;

-- ملاحظات:
-- 1. يجب تشغيل هذا الملف في Supabase SQL Editor
-- 2. تأكد من أن جدول drugs موجود ويدعم Partitioning
-- 3. هذه الدوال تستخدم warehouse_id لضمان توجيه الاستعلام للـ Partition الصحيح
-- 4. الدوال تدعم معالجة الأخطاء وإرجاع تفاصيل الأخطاء
-- 5. دالة process_bulk_excel_data تعالج البيانات الخام من Excel على السيرفر

-- ============================================
-- Trigger لحساب السعر بعد الخصم تلقائياً
-- ============================================

-- التحقق من وجود عمود final_price وإضافته إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'drugs' 
        AND column_name = 'final_price'
    ) THEN
        ALTER TABLE drugs ADD COLUMN final_price NUMERIC(10,2);
    END IF;
END $$;

-- إنشاء دالة لحساب السعر بعد الخصم
CREATE OR REPLACE FUNCTION calculate_final_price()
RETURNS TRIGGER AS $$
BEGIN
    -- حساب final_price = public_price * (1 - sales_discount / 100)
    IF NEW."public_price" IS NOT NULL THEN
        NEW.final_price := (NEW."public_price" * (1 - COALESCE(NEW.sales_discount, 0) / 100))::NUMERIC(10,2);
    ELSE
        NEW.final_price := NULL;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- إنشاء Trigger يعمل BEFORE INSERT OR UPDATE على جدول drugs
DROP TRIGGER IF EXISTS trg_calculate_final_price ON drugs;
DROP TRIGGER IF EXISTS trigger_calculate_final_price ON drugs;
CREATE TRIGGER trg_calculate_final_price
BEFORE INSERT OR UPDATE ON drugs
FOR EACH ROW
EXECUTE FUNCTION calculate_final_price();
