-- Migration script to fix timeout issues in batch_process_drugs_with_batch_number
-- Run this in your Supabase SQL editor

-- Step 1: Drop the old function
DROP FUNCTION IF EXISTS batch_process_drugs_with_batch_number(UUID, JSONB);

-- Step 2: Create optimized indexes first
DROP INDEX IF EXISTS idx_warehouse_products_composite_key;
CREATE INDEX idx_warehouse_products_composite_key 
ON warehouse_products_flexible (
    ((product_data->>'tradeName') TEXT),
    ((product_data->>'batchNumber') TEXT)
);

DROP INDEX IF EXISTS idx_warehouse_products_warehouse_id;
CREATE INDEX idx_warehouse_products_warehouse_id 
ON warehouse_products_flexible (warehouse_id);

-- Step 3: Create the optimized function with timeout protection
CREATE FUNCTION batch_process_drugs_with_batch_number(
    p_warehouse_id UUID,
    p_drugs JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_drug_record JSONB;
    v_existing_product JSONB;
    v_trade_name TEXT;
    v_batch_number TEXT;
    v_quantity NUMERIC;
    v_existing_quantity NUMERIC;
    v_new_quantity NUMERIC;
    v_product_data JSONB;
    v_inserted_count BIGINT := 0;
    v_updated_count BIGINT := 0;
    v_skipped_count BIGINT := 0;
    v_error_array JSONB := '[]'::JSONB;
    v_error_record JSONB;
    v_drugs_array JSONB;
BEGIN
    -- تعيين timeout للدالة لتجنب timeout في السيرفر
    SET LOCAL statement_timeout = '30s';

    -- التحقق من صحة المعاملات
    IF p_drugs IS NULL OR jsonb_typeof(p_drugs) != 'array' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invalid input: p_drugs must be a JSONB array',
            'inserted', 0,
            'updated', 0,
            'skipped', 0,
            'errors', '[]'::JSONB
        );
    END IF;

    IF jsonb_array_length(p_drugs) = 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'inserted', 0,
            'updated', 0,
            'skipped', 0,
            'errors', '[]'::JSONB
        );
    END IF;

    -- معالجة كل منتج في الدفعة
    FOR i IN 0..jsonb_array_length(p_drugs) - 1 LOOP
        v_drug_record := p_drugs->i;
        
        BEGIN
            -- استخراج البيانات
            v_trade_name := v_drug_record->>'tradeName';
            v_batch_number := COALESCE(v_drug_record->>'batchNumber', '');
            v_quantity := COALESCE((v_drug_record->>'quantity')::NUMERIC, 0);
            
            -- البحث عن منتج موجود بنفس المفتاح المركب
            SELECT product_data INTO v_existing_product
            FROM warehouse_products_flexible
            WHERE warehouse_id = p_warehouse_id
            AND (product_data->>'tradeName') = v_trade_name
            AND COALESCE(product_data->>'batchNumber', '') = v_batch_number
            LIMIT 1;
            
            IF v_existing_product IS NOT NULL THEN
                -- المنتج موجود بنفس التشغيلة: تحديث + جمع الكميات
                v_existing_quantity := COALESCE((v_existing_product->>'quantity')::NUMERIC, 0);
                v_new_quantity := v_existing_quantity + v_quantity;
                
                -- تحديث البيانات مع جمع الكمية
                UPDATE warehouse_products_flexible
                SET product_data = jsonb_build_object(
                    'tradeName', v_trade_name,
                    'batchNumber', v_batch_number,
                    'quantity', v_new_quantity,
                    'public_price', COALESCE((v_drug_record->>'public_price')::NUMERIC, (v_existing_product->>'public_price')::NUMERIC),
                    'sales_discount', COALESCE((v_drug_record->>'sales_discount')::NUMERIC, (v_existing_product->>'sales_discount')::NUMERIC),
                    'net_price', COALESCE((v_drug_record->>'net_price')::NUMERIC, (v_existing_product->>'net_price')::NUMERIC),
                    'purchase_discount', COALESCE((v_drug_record->>'purchase_discount')::NUMERIC, (v_existing_product->>'purchase_discount')::NUMERIC),
                    'production_date', COALESCE(v_drug_record->>'production_date', v_existing_product->>'production_date'),
                    'expiry_date', COALESCE(v_drug_record->>'expiry_date', v_existing_product->>'expiry_date'),
                    'category', COALESCE(v_drug_record->>'category', v_existing_product->>'category'),
                    'supplier', COALESCE(v_drug_record->>'supplier', v_existing_product->>'supplier'),
                    'updated_at', NOW()
                ),
                updated_at = NOW()
                WHERE warehouse_id = p_warehouse_id
                AND (product_data->>'tradeName') = v_trade_name
                AND COALESCE(product_data->>'batchNumber', '') = v_batch_number;
                
                v_updated_count := v_updated_count + 1;
                
            ELSE
                -- المنتج غير موجود أو بتشغيلة مختلفة: إضافة سطر جديد
                v_product_data := jsonb_build_object(
                    'tradeName', v_trade_name,
                    'batchNumber', v_batch_number,
                    'quantity', v_quantity,
                    'public_price', COALESCE((v_drug_record->>'public_price')::NUMERIC, 0),
                    'sales_discount', COALESCE((v_drug_record->>'sales_discount')::NUMERIC, 0),
                    'net_price', COALESCE((v_drug_record->>'net_price')::NUMERIC, 0),
                    'purchase_discount', COALESCE((v_drug_record->>'purchase_discount')::NUMERIC, 0),
                    'production_date', v_drug_record->>'production_date',
                    'expiry_date', v_drug_record->>'expiry_date',
                    'category', v_drug_record->>'category',
                    'supplier', v_drug_record->>'supplier',
                    'created_at', NOW(),
                    'updated_at', NOW()
                );
                
                INSERT INTO warehouse_products_flexible (warehouse_id, product_data)
                VALUES (p_warehouse_id, v_product_data);
                
                v_inserted_count := v_inserted_count + 1;
            END IF;
            
        EXCEPTION WHEN OTHERS THEN
            -- تسجيل الأخطاء
            v_error_record := jsonb_build_object(
                'index', i,
                'tradeName', v_trade_name,
                'batchNumber', v_batch_number,
                'error', SQLERRM,
                'sqlstate', SQLSTATE
            );
            v_error_array := v_error_array || v_error_record;
            v_skipped_count := v_skipped_count + 1;
        END;
    END LOOP;
    
    -- إرجاع النتائج كـ JSONB
    RETURN jsonb_build_object(
        'success', true,
        'inserted', v_inserted_count,
        'updated', v_updated_count,
        'skipped', v_skipped_count,
        'errors', v_error_array
    );
END;
$$;

-- Step 4: Add comment
COMMENT ON FUNCTION batch_process_drugs_with_batch_number IS 
'معالجة دفعات المنتجات مع التحقق من (اسم المنتج + رقم التشغيلة) - تحديث مع جمع الكميات أو إضافة جديد - محسّن لتجنب timeout';

-- Verify the function was created
SELECT 
    'Function created successfully' as status,
    routine_name,
    routine_type
FROM information_schema.routines 
WHERE routine_name = 'batch_process_drugs_with_batch_number';
