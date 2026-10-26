-- حذف الدالة القديمة إذا وجدت
DROP FUNCTION IF EXISTS batch_process_drugs_with_batch_number(UUID, JSONB);

-- دالة RPC محسّنة لمعالجة دفعات المنتجات مع التحقق من (اسم المنتج + رقم التشغيلة)
-- الشروط:
-- 1. مفتاح أساسي: (tradeName + batchNumber)
-- 2. تطابق نفس التشغيلة: تحديث الأسعار والتواريخ + جمع الكميات
-- 3. تشغيلة مختلفة: إضافة سطر جديد
-- التحسينات:
-- - زيادة timeout إلى 120 ثانية
-- - تحسين الاستعلامات الداخلية
-- - معالجة أخطاء أفضل

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
    -- زيادة timeout إلى 120 ثانية للتعامل مع الدفعات الكبيرة
    SET LOCAL statement_timeout = '120s';
    
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
            
            -- البحث عن منتج موجود بنفس المفتاح المركب باستخدام استعلام محسّن
            SELECT product_data INTO v_existing_product
            FROM warehouse_products_flexible
            WHERE warehouse_id = p_warehouse_id
            AND (product_data->>'tradeName') = v_trade_name
            AND COALESCE(product_data->>'batchNumber', '') = v_batch_number
            LIMIT 1
            FOR UPDATE; -- قفل الصف لمنع التعارضات
            
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
    
EXCEPTION WHEN OTHERS THEN
    -- في حالة حدوث خطأ عام، إرجاع تفاصيل الخطأ
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM,
        'sqlstate', SQLSTATE,
        'inserted', COALESCE(v_inserted_count, 0),
        'updated', COALESCE(v_updated_count, 0),
        'skipped', COALESCE(v_skipped_count, 0),
        'errors', jsonb_build_object(
            'message', SQLERRM,
            'sqlstate', SQLSTATE
        )
    );
END;
$$;

-- إنشاء فهرس لتحسين أداء البحث على المفتاح المركب
-- استخدام B-tree بدلاً من GIN لأننا نبحث بالمساواة
CREATE INDEX IF NOT EXISTS idx_warehouse_products_composite_key 
ON warehouse_products_flexible (
    (product_data->>'tradeName'),
    (product_data->>'batchNumber')
);

-- إضافة فهرس على warehouse_id لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_warehouse_products_warehouse_id 
ON warehouse_products_flexible (warehouse_id);

-- التعليق على الدالة
COMMENT ON FUNCTION batch_process_drugs_with_batch_number IS 
'معالجة دفعات المنتجات مع التحقق من (اسم المنتج + رقم التشغيلة) - تحديث مع جمع الكميات أو إضافة جديد';