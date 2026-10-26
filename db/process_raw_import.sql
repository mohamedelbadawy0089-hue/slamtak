-- Create import_logs table and a function to process raw imports
-- Usage: SELECT * FROM public.process_raw_import(raw_jsonb, '00000000-0000-0000-0000-000000000000'::uuid);

CREATE TABLE IF NOT EXISTS import_logs (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    row_index INTEGER,
    warehouse_id UUID,
    raw_row JSONB,
    error TEXT
);

CREATE OR REPLACE FUNCTION public.map_header_to_product_column(h TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE lower(trim($1))
        WHEN 'السعر' THEN 'public_price'
        WHEN 'سعر' THEN 'public_price'
        WHEN 'سعر البيع' THEN 'public_price'
        WHEN 'سعر_البيع' THEN 'public_price'
        WHEN 'ثمن' THEN 'public_price'
        WHEN 'السعر العام' THEN 'public_price'
        WHEN 'unit_price' THEN 'public_price'
        WHEN 'price' THEN 'public_price'
        WHEN 'cost' THEN 'public_price'
        WHEN 'public_price' THEN 'public_price'
        WHEN 'الكمية' THEN 'quantity'
        WHEN 'كمية' THEN 'quantity'
        WHEN 'العدد' THEN 'quantity'
        WHEN 'qty' THEN 'quantity'
        WHEN 'quantity' THEN 'quantity'
        WHEN 'عدد' THEN 'quantity'
        WHEN 'stock' THEN 'quantity'
        WHEN 'المخزون' THEN 'quantity'
        WHEN 'available_qty' THEN 'quantity'
        WHEN 'الاسم' THEN 'trade_name'
        WHEN 'اسم' THEN 'trade_name'
        WHEN 'اسم المنتج' THEN 'trade_name'
        WHEN 'اسم الصنف' THEN 'trade_name'
        WHEN 'اسم الدواء' THEN 'trade_name'
        WHEN 'الاسم التجاري' THEN 'trade_name'
        WHEN 'اسم تجاري' THEN 'trade_name'
        WHEN 'product_name' THEN 'trade_name'
        WHEN 'product' THEN 'trade_name'
        WHEN 'product name' THEN 'trade_name'
        WHEN 'trade name' THEN 'trade_name'
        WHEN 'tradename' THEN 'trade_name'
        WHEN 'trade_name' THEN 'trade_name'
        WHEN 'batch number' THEN 'batch_number'
        WHEN 'batchnumber' THEN 'batch_number'
        WHEN 'batch_number' THEN 'batch_number'
        WHEN 'batch' THEN 'batch_number'
        WHEN 'التشغيلة' THEN 'batch_number'
        WHEN 'تشغيلة' THEN 'batch_number'
        WHEN 'barcode' THEN 'batch_number'
        WHEN 'باركود' THEN 'batch_number'
        WHEN 'رمز' THEN 'batch_number'
        WHEN 'كود' THEN 'batch_number'
        WHEN 'code' THEN 'batch_number'
        WHEN 'تاريخ الانتاج' THEN 'production_date'
        WHEN 'تاريخ_الانتاج' THEN 'production_date'
        WHEN 'تاريخ الإنتاج' THEN 'production_date'
        WHEN 'production_date' THEN 'production_date'
        WHEN 'manufacture_date' THEN 'production_date'
        WHEN 'تاريخ الانتهاء' THEN 'expiry_date'
        WHEN 'تاريخ_الانتهاء' THEN 'expiry_date'
        WHEN 'تاريخ الصلاحية' THEN 'expiry_date'
        WHEN 'تاريخ_الصلاحية' THEN 'expiry_date'
        WHEN 'expiry_date' THEN 'expiry_date'
        WHEN 'expiry' THEN 'expiry_date'
        WHEN 'الخصم' THEN 'sales_discount'
        WHEN 'خصم البيع' THEN 'sales_discount'
        WHEN 'الخصم المئوي' THEN 'sales_discount'
        WHEN 'discount' THEN 'sales_discount'
        WHEN 'نسبة_الخصم' THEN 'sales_discount'
        WHEN 'discount_percent' THEN 'sales_discount'
        WHEN 'discount_rate' THEN 'sales_discount'
        WHEN 'purchase_discount' THEN 'purchase_discount'
        WHEN 'warehouse' THEN 'warehouse_id'
        WHEN 'warehouse_id' THEN 'warehouse_id'
        WHEN 'warehouse id' THEN 'warehouse_id'
        WHEN 'مخزن' THEN 'warehouse_id'
        WHEN 'معرف المخزن' THEN 'warehouse_id'
        WHEN 'معرف_المخزن' THEN 'warehouse_id'
        WHEN 'category' THEN 'category'
        WHEN 'القسم' THEN 'category'
        WHEN 'الصنف' THEN 'category'
        WHEN 'brand' THEN 'category'
        WHEN 'العلامة التجارية' THEN 'category'
        WHEN 'manufacturer' THEN 'category'
        WHEN 'الشركة المصنعة' THEN 'category'
        WHEN 'unit' THEN 'category'
        WHEN 'وحدة' THEN 'category'
        WHEN 'quantity_type' THEN 'category'
        ELSE lower(regexp_replace($1, '\\s+', '_', 'g'))
    END;
$$;

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
                       WHEN 'batchnumber' THEN 'batch_number'
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
        (SELECT column_name
         FROM information_schema.columns c
         JOIN candidates cand ON lower(c.column_name) = cand.candidate
         WHERE table_name = 'drugs'
           AND lower(c.column_name) IN (SELECT candidate FROM candidates)
         ORDER BY CASE WHEN lower(c.column_name) = cand.requested THEN 0 ELSE 1 END
         LIMIT 1),
        lower(trim($1))
    );
$$;

CREATE OR REPLACE FUNCTION public.process_raw_import(raw_data JSONB, target_warehouse_id UUID)
RETURNS TABLE(imported_count INT, skipped_count INT)
LANGUAGE plpgsql AS $$
DECLARE
    arr_len INT;
    hdr JSONB;
    hdr_type TEXT;
    i INT;
    j INT;
    headers TEXT[] := ARRAY[]::TEXT[];
    row_json JSONB;
    colname TEXT;
    mapped_col TEXT;
    v_val TEXT;
    v_imported INT := 0;
    v_skipped INT := 0;
    v_trade_name TEXT;
    v_batch_number TEXT;
    v_public_price NUMERIC;
    v_quantity INTEGER;
    v_sales_discount NUMERIC;
    v_production_date DATE;
    v_expiry_date DATE;
    v_category TEXT;
    v_row_count INT;
    v_error TEXT;
    v_trade_col TEXT;
    v_batch_col TEXT;
    v_public_price_col TEXT;
    v_quantity_col TEXT;
    v_sales_discount_col TEXT;
    v_production_date_col TEXT;
    v_expiry_date_col TEXT;
    v_category_col TEXT;
    v_warehouse_col TEXT;
    v_net_price_col TEXT;
    v_purchase_discount_col TEXT;
    v_warehouse_type TEXT;
    v_warehouse_value TEXT;

BEGIN
    SET LOCAL statement_timeout = '1800s';

    IF raw_data IS NULL THEN
        RETURN QUERY SELECT 0, 0;
        RETURN;
    END IF;

    IF jsonb_typeof(raw_data) <> 'array' THEN
        RAISE EXCEPTION 'raw_data must be a JSON array (array-of-arrays or array-of-objects)';
    END IF;

    arr_len := jsonb_array_length(raw_data);
    IF arr_len = 0 THEN
        RETURN QUERY SELECT 0, 0;
        RETURN;
    END IF;

    hdr := raw_data -> 0;
    hdr_type := jsonb_typeof(hdr);

    v_trade_col := resolve_drug_column_name('trade_name');
    v_batch_col := resolve_drug_column_name('batch_number');
    v_public_price_col := resolve_drug_column_name('public_price');
    v_quantity_col := resolve_drug_column_name('quantity');
    v_sales_discount_col := resolve_drug_column_name('sales_discount');
    v_production_date_col := resolve_drug_column_name('production_date');
    v_expiry_date_col := resolve_drug_column_name('expiry_date');
    v_category_col := resolve_drug_column_name('category');
    v_warehouse_col := resolve_drug_column_name('warehouse_id');
    v_net_price_col := resolve_drug_column_name('net_price');
    v_purchase_discount_col := resolve_drug_column_name('purchase_discount');

    SELECT data_type INTO v_warehouse_type
    FROM information_schema.columns
    WHERE table_name = 'drugs' AND column_name = v_warehouse_col
    LIMIT 1;

    IF v_warehouse_type IS NULL OR v_warehouse_type IN ('character varying', 'varchar', 'text', 'character') THEN
        v_warehouse_value := quote_literal(target_warehouse_id::text);
    ELSE
        v_warehouse_value := quote_literal(target_warehouse_id::text) || '::' || v_warehouse_type;
    END IF;

    CREATE TEMP TABLE import_stage (
        trade_name TEXT,
        batch_number TEXT,
        public_price NUMERIC,
        quantity INTEGER,
        sales_discount NUMERIC,
        production_date DATE,
        expiry_date DATE,
        category TEXT
    ) ON COMMIT DROP;

    IF hdr_type = 'array' THEN
        -- first element is an array of headers
        FOR i IN 0..jsonb_array_length(hdr)-1 LOOP
            headers := headers || trim(both '"' FROM hdr->>i);
        END LOOP;

        FOR j IN 1..arr_len-1 LOOP
            row_json := raw_data -> j;
            v_trade_name := NULL;
            v_batch_number := NULL;
            v_public_price := NULL;
            v_quantity := 0;
            v_sales_discount := 0;
            v_production_date := NULL;
            v_expiry_date := NULL;
            v_category := NULL;

            FOR i IN 1..array_length(headers, 1) LOOP
                colname := headers[i];
                mapped_col := map_header_to_product_column(colname);
                v_val := row_json ->> (i - 1);

                IF mapped_col = 'trade_name' AND COALESCE(trim(v_val), '') <> '' THEN
                    v_trade_name := trim(v_val);
                ELSIF mapped_col = 'batch_number' AND COALESCE(trim(v_val), '') <> '' THEN
                    v_batch_number := trim(v_val);
                ELSIF mapped_col = 'public_price' AND COALESCE(trim(v_val), '') <> '' THEN
                    BEGIN
                        v_public_price := NULLIF(trim(v_val), '')::NUMERIC;
                    EXCEPTION WHEN OTHERS THEN
                        v_public_price := NULL;
                    END;
                ELSIF mapped_col = 'quantity' AND COALESCE(trim(v_val), '') <> '' THEN
                    BEGIN
                        v_quantity := NULLIF(trim(v_val), '')::INTEGER;
                    EXCEPTION WHEN OTHERS THEN
                        v_quantity := 0;
                    END;
                ELSIF mapped_col = 'sales_discount' AND COALESCE(trim(v_val), '') <> '' THEN
                    BEGIN
                        v_sales_discount := NULLIF(trim(v_val), '')::NUMERIC;
                    EXCEPTION WHEN OTHERS THEN
                        v_sales_discount := 0;
                    END;
                ELSIF mapped_col = 'production_date' AND COALESCE(trim(v_val), '') <> '' THEN
                    BEGIN
                        v_production_date := NULLIF(trim(v_val), '')::DATE;
                    EXCEPTION WHEN OTHERS THEN
                        v_production_date := NULL;
                    END;
                ELSIF mapped_col = 'expiry_date' AND COALESCE(trim(v_val), '') <> '' THEN
                    BEGIN
                        v_expiry_date := NULLIF(trim(v_val), '')::DATE;
                    EXCEPTION WHEN OTHERS THEN
                        v_expiry_date := NULL;
                    END;
                ELSIF mapped_col = 'category' AND COALESCE(trim(v_val), '') <> '' THEN
                    v_category := trim(v_val);
                END IF;
            END LOOP;

            IF COALESCE(trim(v_trade_name), '') = '' THEN
                v_skipped := v_skipped + 1;
                INSERT INTO import_logs(row_index, warehouse_id, raw_row, error)
                VALUES (j, target_warehouse_id, row_json, 'Missing trade_name');
                CONTINUE;
            END IF;

            IF v_public_price IS NULL OR v_public_price <= 0 THEN
                v_skipped := v_skipped + 1;
                INSERT INTO import_logs(row_index, warehouse_id, raw_row, error)
                VALUES (j, target_warehouse_id, row_json, 'Missing or invalid public_price');
                CONTINUE;
            END IF;

            INSERT INTO import_stage(
                trade_name,
                batch_number,
                public_price,
                quantity,
                sales_discount,
                production_date,
                expiry_date,
                category
            ) VALUES (
                v_trade_name,
                COALESCE(v_batch_number, 'بدون'),
                v_public_price,
                COALESCE(v_quantity, 0),
                COALESCE(v_sales_discount, 0),
                v_production_date,
                v_expiry_date,
                v_category
            );
        END LOOP;

        INSERT INTO drugs (
            warehouse_id,
            batch_number,
            trade_name,
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
        )
        SELECT
            target_warehouse_id,
            COALESCE(import_stage.batch_number, 'بدون'),
            import_stage.trade_name,
            import_stage.public_price,
            import_stage.public_price * (1 - COALESCE(import_stage.sales_discount, 0) / 100),
            import_stage.production_date,
            import_stage.expiry_date,
            COALESCE(import_stage.quantity, 0),
            0,
            COALESCE(import_stage.sales_discount, 0),
            import_stage.category,
            NOW(),
            NOW()
        FROM import_stage;

        GET DIAGNOSTICS v_row_count = ROW_COUNT;
        v_imported := v_imported + v_row_count;

    ELSIF hdr_type = 'object' THEN
        -- array of objects: each element is a row
        FOR j IN 0..arr_len-1 LOOP
            row_json := raw_data -> j;
            v_trade_name := NULL;
            v_batch_number := NULL;
            v_public_price := NULL;
            v_quantity := 0;
            v_sales_discount := 0;
            v_production_date := NULL;
            v_expiry_date := NULL;
            v_category := NULL;

            FOR colname IN SELECT key FROM jsonb_each_text(row_json) LOOP
                mapped_col := map_header_to_product_column(colname.key);
                v_val := row_json ->> colname.key;

                IF mapped_col = 'trade_name' AND COALESCE(trim(v_val), '') <> '' THEN
                    v_trade_name := trim(v_val);
                ELSIF mapped_col = 'batch_number' AND COALESCE(trim(v_val), '') <> '' THEN
                    v_batch_number := trim(v_val);
                ELSIF mapped_col = 'public_price' AND COALESCE(trim(v_val), '') <> '' THEN
                    BEGIN
                        v_public_price := NULLIF(trim(v_val), '')::NUMERIC;
                    EXCEPTION WHEN OTHERS THEN
                        v_public_price := NULL;
                    END;
                ELSIF mapped_col = 'quantity' AND COALESCE(trim(v_val), '') <> '' THEN
                    BEGIN
                        v_quantity := NULLIF(trim(v_val), '')::INTEGER;
                    EXCEPTION WHEN OTHERS THEN
                        v_quantity := 0;
                    END;
                ELSIF mapped_col = 'sales_discount' AND COALESCE(trim(v_val), '') <> '' THEN
                    BEGIN
                        v_sales_discount := NULLIF(trim(v_val), '')::NUMERIC;
                    EXCEPTION WHEN OTHERS THEN
                        v_sales_discount := 0;
                    END;
                ELSIF mapped_col = 'production_date' AND COALESCE(trim(v_val), '') <> '' THEN
                    BEGIN
                        v_production_date := NULLIF(trim(v_val), '')::DATE;
                    EXCEPTION WHEN OTHERS THEN
                        v_production_date := NULL;
                    END;
                ELSIF mapped_col = 'expiry_date' AND COALESCE(trim(v_val), '') <> '' THEN
                    BEGIN
                        v_expiry_date := NULLIF(trim(v_val), '')::DATE;
                    EXCEPTION WHEN OTHERS THEN
                        v_expiry_date := NULL;
                    END;
                ELSIF mapped_col = 'category' AND COALESCE(trim(v_val), '') <> '' THEN
                    v_category := trim(v_val);
                END IF;
            END LOOP;

            IF COALESCE(trim(v_trade_name), '') = '' OR v_public_price IS NULL OR v_public_price <= 0 THEN
                v_skipped := v_skipped + 1;
                INSERT INTO import_logs(row_index, warehouse_id, raw_row, error)
                VALUES (j, target_warehouse_id, row_json, 'Missing trade_name or public_price');
                CONTINUE;
            END IF;

            INSERT INTO import_stage(
                trade_name,
                batch_number,
                public_price,
                quantity,
                sales_discount,
                production_date,
                expiry_date,
                category
            ) VALUES (
                v_trade_name,
                COALESCE(v_batch_number, 'بدون'),
                v_public_price,
                COALESCE(v_quantity, 0),
                COALESCE(v_sales_discount, 0),
                v_production_date,
                v_expiry_date,
                v_category
            );
        END LOOP;

        INSERT INTO drugs (
            warehouse_id,
            batch_number,
            trade_name,
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
        )
        SELECT
            target_warehouse_id,
            COALESCE(import_stage.batch_number, 'بدون'),
            import_stage.trade_name,
            import_stage.public_price,
            import_stage.public_price * (1 - COALESCE(import_stage.sales_discount, 0) / 100),
            import_stage.production_date,
            import_stage.expiry_date,
            COALESCE(import_stage.quantity, 0),
            0,
            COALESCE(import_stage.sales_discount, 0),
            import_stage.category,
            NOW(),
            NOW()
        FROM import_stage;

        GET DIAGNOSTICS v_row_count = ROW_COUNT;
        v_imported := v_imported + v_row_count;
    ELSE
        RAISE EXCEPTION 'Unsupported header element type: %', hdr_type;
    END IF;

    RETURN QUERY SELECT v_imported, v_skipped;
END;
$$ SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.process_raw_import(JSONB, UUID) TO public;
