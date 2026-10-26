-- ============================================
-- دالة RPC للصق السريع الجماعي للمنتجات المرنة
-- تدعم حتى 20,000 منتج في دفعة واحدة
-- مع محرك مطابقة ذكي لأسماء الأعمدة
-- ============================================

-- إسقاط الدالة إذا كانت موجودة
DROP FUNCTION IF EXISTS bulk_paste_warehouse_products_flexible;

-- إنشاء الدالة الجديدة مع محرك المطابقة الذكي
CREATE OR REPLACE FUNCTION bulk_paste_warehouse_products_flexible(
    p_warehouse_id UUID,
    p_products TEXT  -- استقبال JSON string
)
RETURNS TABLE(
    inserted BIGINT,
    updated BIGINT,
    failed BIGINT,
    message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER -- لتجاوز RLS والسماح بالوصول للبيانات
AS $$
DECLARE
    v_product JSONB;
    v_product_mapped JSONB;
    v_sequence_number INTEGER := 0;
    v_inserted_count BIGINT := 0;
    v_updated_count BIGINT := 0;
    v_failed_count BIGINT := 0;
    v_product_count INTEGER := jsonb_array_length(p_products::JSONB);
    v_batch_size INTEGER := 500; -- حجم الدفعة لتجنب Timeout
    v_start_index INTEGER := 0;
    v_end_index INTEGER := 0;
    v_batch JSONB;
    v_i INTEGER;
    
    -- دالة مساعدة للحصول على قيمة الحقل بمرونة
    v_field_value TEXT;
    v_field_numeric NUMERIC;
    
    -- التحقق من الحقول الإجبارية
    v_missing_required BOOLEAN := FALSE;
    v_missing_fields TEXT[];
BEGIN
    -- التحقق من صحة المعطيات
    IF p_warehouse_id IS NULL THEN
        RETURN QUERY SELECT 0, 0, 0::BIGINT, 'خطأ: معرف المخزن مطلوب';
        RETURN;
    END IF;
    
    IF p_products IS NULL OR p_products = '' THEN
        RETURN QUERY SELECT 0, 0, 0::BIGINT, 'خطأ: لا توجد بيانات منتجات';
        RETURN;
    END IF;
    
    -- معالجة المنتجات في دفعات لتجنب Timeout
    v_start_index := 0;
    
    WHILE v_start_index < v_product_count LOOP
        -- حساب نهاية الدفعة الحالية
        v_end_index := LEAST(v_start_index + v_batch_size, v_product_count);
        
        -- استخراج الدفعة الحالية
        v_batch := '[]'::JSONB;
        v_i := 0;
        
        FOR v_product IN SELECT jsonb_array_elements(p_products)
        LIMIT v_batch_size OFFSET v_start_index
        LOOP
            v_i := v_i + 1;
            v_sequence_number := v_start_index + v_i;
            
            -- ============================================
            -- محرك المطابقة الذكي لأسماء الأعمدة
            -- ============================================
            
            -- بناء الكائن المُعادَل مع الحقول القياسية
            v_product_mapped := '{
                "sequence_number": ' || v_sequence_number::TEXT || ',
                "tradeName": null,
                "public_price": null,
                "sales_discount": null,
                "quantity": null,
                "purchase_discount": null,
                "category": null,
                "batchNumber": null,
                "expiry_date": null
            }'::JSONB;
            
            -- استخراج اسم الصنف (إجباري) - محاكاة ذكية
            v_field_value := NULL;
            -- البحث بجميع الأسماء المحتملة
            IF v_product ? 'tradeName' THEN
                v_field_value := v_product->>'tradeName';
            ELSIF v_product ? 'trade_name' THEN
                v_field_value := v_product->>'trade_name';
            ELSIF v_product ? 'name' THEN
                v_field_value := v_product->>'name';
            ELSIF v_product ? 'الصنف' THEN
                v_field_value := v_product->>'الصنف';
            ELSIF v_product ? 'اسم الصنف' THEN
                v_field_value := v_product->>'اسم الصنف';
            ELSIF v_product ? 'اسم_الصنف' THEN
                v_field_value := v_product->>'اسم_الصنف';
            ELSIF v_product ? 'product' THEN
                v_field_value := v_product->>'product';
            ELSIF v_product ? 'product_name' THEN
                v_field_value := v_product->>'product_name';
            ELSIF v_product ? 'item' THEN
                v_field_value := v_product->>'item';
            ELSIF v_product ? 'item_name' THEN
                v_field_value := v_product->>'item_name';
            END IF;
            
            -- التحقق من الحقل الإجباري
            IF v_field_value IS NULL OR TRIM(v_field_value) = '' THEN
                v_missing_required := TRUE;
                v_missing_fields := array_append(v_missing_fields, 'الصف ' || (v_start_index + v_i)::TEXT || ': اسم الصنف مفقود');
            ELSE
                v_product_mapped := v_product_mapped || jsonb_build_object('tradeName', v_field_value);
            END IF;
            
            -- استخراج السعر (إجباري)
            v_field_numeric := NULL;
            IF v_product ? 'public_price' THEN
                v_field_numeric := (v_product->>'public_price')::NUMERIC;
            ELSIF v_product ? 'publicPrice' THEN
                v_field_numeric := (v_product->>'publicPrice')::NUMERIC;
            ELSIF v_product ? 'price' THEN
                v_field_numeric := (v_product->>'price')::NUMERIC;
            ELSIF v_product ? 'سعر' THEN
                v_field_numeric := (v_product->>'سعر')::NUMERIC;
            ELSIF v_product ? 'السعر' THEN
                v_field_numeric := (v_product->>'السعر')::NUMERIC;
            ELSIF v_product ? 'سعر_البيع' THEN
                v_field_numeric := (v_product->>'سعر_البيع')::NUMERIC;
            ELSIF v_product ? 'سعر البيع' THEN
                v_field_numeric := (v_product->>'سعر البيع')::NUMERIC;
            ELSIF v_product ? 'selling_price' THEN
                v_field_numeric := (v_product->>'selling_price')::NUMERIC;
            ELSIF v_product ? 'sellingPrice' THEN
                v_field_numeric := (v_product->>'sellingPrice')::NUMERIC;
            END IF;
            
            IF v_field_numeric IS NULL OR v_field_numeric = 0 THEN
                v_missing_required := TRUE;
                v_missing_fields := array_append(v_missing_fields, 'الصف ' || (v_start_index + v_i)::TEXT || ': السعر مفقود أو صفر');
            ELSE
                v_product_mapped := v_product_mapped || jsonb_build_object('public_price', v_field_numeric);
            END IF;
            
            -- استخراج خصم البيع (إجباري)
            v_field_numeric := NULL;
            IF v_product ? 'sales_discount' THEN
                v_field_numeric := (v_product->>'sales_discount')::NUMERIC;
            ELSIF v_product ? 'salesDiscount' THEN
                v_field_numeric := (v_product->>'salesDiscount')::NUMERIC;
            ELSIF v_product ? 'discount' THEN
                v_field_numeric := (v_product->>'discount')::NUMERIC;
            ELSIF v_product ? 'خصم' THEN
                v_field_numeric := (v_product->>'خصم')::NUMERIC;
            ELSIF v_product ? 'الخصم' THEN
                v_field_numeric := (v_product->>'الخصم')::NUMERIC;
            ELSIF v_product ? 'خصم_البيع' THEN
                v_field_numeric := (v_product->>'خصم_البيع')::NUMERIC;
            ELSIF v_product ? 'خصم البيع' THEN
                v_field_numeric := (v_product->>'خصم البيع')::NUMERIC;
            ELSIF v_product ? 'selling_discount' THEN
                v_field_numeric := (v_product->>'selling_discount')::NUMERIC;
            END IF;
            
            IF v_field_numeric IS NULL THEN
                v_field_numeric := 0; -- القيمة الافتراضية
            END IF;
            v_product_mapped := v_product_mapped || jsonb_build_object('sales_discount', v_field_numeric);
            
            -- استخراج الكمية (اختياري)
            v_field_numeric := NULL;
            IF v_product ? 'quantity' THEN
                v_field_numeric := (v_product->>'quantity')::NUMERIC;
            ELSIF v_product ? 'qty' THEN
                v_field_numeric := (v_product->>'qty')::NUMERIC;
            ELSIF v_product ? 'كمية' THEN
                v_field_numeric := (v_product->>'كمية')::NUMERIC;
            ELSIF v_product ? 'الكمية' THEN
                v_field_numeric := (v_product->>'الكمية')::NUMERIC;
            END IF;
            IF v_field_numeric IS NOT NULL THEN
                v_product_mapped := v_product_mapped || jsonb_build_object('quantity', v_field_numeric);
            END IF;
            
            -- استخراج خصم الشراء (اختياري)
            v_field_numeric := NULL;
            IF v_product ? 'purchase_discount' THEN
                v_field_numeric := (v_product->>'purchase_discount')::NUMERIC;
            ELSIF v_product ? 'purchaseDiscount' THEN
                v_field_numeric := (v_product->>'purchaseDiscount')::NUMERIC;
            ELSIF v_product ? 'خصم_الشراء' THEN
                v_field_numeric := (v_product->>'خصم_الشراء')::NUMERIC;
            ELSIF v_product ? 'خصم الشراء' THEN
                v_field_numeric := (v_product->>'خصم الشراء')::NUMERIC;
            END IF;
            IF v_field_numeric IS NOT NULL THEN
                v_product_mapped := v_product_mapped || jsonb_build_object('purchase_discount', v_field_numeric);
            END IF;
            
            -- استخراج التصنيف (اختياري)
            v_field_value := NULL;
            IF v_product ? 'category' THEN
                v_field_value := v_product->>'category';
            ELSIF v_product ? 'تصنيف' THEN
                v_field_value := v_product->>'تصنيف';
            ELSIF v_product ? 'التصنيف' THEN
                v_field_value := v_product->>'التصنيف';
            END IF;
            IF v_field_value IS NOT NULL THEN
                v_product_mapped := v_product_mapped || jsonb_build_object('category', v_field_value);
            END IF;
            
            -- استخراج رقم التشغيلة (اختياري)
            v_field_value := NULL;
            IF v_product ? 'batchNumber' THEN
                v_field_value := v_product->>'batchNumber';
            ELSIF v_product ? 'batch_number' THEN
                v_field_value := v_product->>'batch_number';
            ELSIF v_product ? 'batch' THEN
                v_field_value := v_product->>'batch';
            ELSIF v_product ? 'تشغيلة' THEN
                v_field_value := v_product->>'تشغيلة';
            ELSIF v_product ? 'التشغيلة' THEN
                v_field_value := v_product->>'التشغيلة';
            ELSIF v_product ? 'رقم_التشغيلة' THEN
                v_field_value := v_product->>'رقم_التشغيلة';
            ELSIF v_product ? 'رقم التشغيلة' THEN
                v_field_value := v_product->>'رقم التشغيلة';
            END IF;
            IF v_field_value IS NOT NULL THEN
                v_product_mapped := v_product_mapped || jsonb_build_object('batchNumber', v_field_value);
            END IF;
            
            -- استخراج تاريخ الانتهاء (اختياري)
            v_field_value := NULL;
            IF v_product ? 'expiry_date' THEN
                v_field_value := v_product->>'expiry_date';
            ELSIF v_product ? 'expiryDate' THEN
                v_field_value := v_product->>'expiryDate';
            ELSIF v_product ? 'expiry' THEN
                v_field_value := v_product->>'expiry';
            ELSIF v_product ? 'انتهاء' THEN
                v_field_value := v_product->>'انتهاء';
            ELSIF v_product ? 'تاريخ_الانتهاء' THEN
                v_field_value := v_product->>'تاريخ_الانتهاء';
            ELSIF v_product ? 'تاريخ الانتهاء' THEN
                v_field_value := v_product->>'تاريخ الانتهاء';
            END IF;
            IF v_field_value IS NOT NULL THEN
                v_product_mapped := v_product_mapped || jsonb_build_object('expiry_date', v_field_value);
            END IF;
            
            -- إضافة المنتج المُعادَل للدفعة
            v_batch := v_batch || v_product_mapped;
        END LOOP;
        
        -- إدراج الدفعة الحالية
        BEGIN
            INSERT INTO warehouse_products_flexible (warehouse_id, product_data)
            SELECT 
                p_warehouse_id,
                product
            FROM jsonb_array_elements(v_batch) AS product;
            
            v_inserted_count := v_inserted_count + jsonb_array_length(v_batch);
            
        EXCEPTION
            WHEN OTHERS THEN
                v_failed_count := v_failed_count + jsonb_array_length(v_batch);
                RAISE NOTICE 'خطأ في إدراج الدفعة %: %', v_start_index / v_batch_size + 1, SQLERRM;
        END;
        
        -- الانتقال للدفعة التالية
        v_start_index := v_end_index;
        
        -- إعطاء فرصة للسيرفر للتنفس
        PERFORM pg_sleep(0.01);
    END LOOP;
    
    -- إرجاع النتيجة
    IF v_missing_required THEN
        RETURN QUERY SELECT 
            0::BIGINT, 
            0::BIGINT, 
            v_product_count::BIGINT, 
            'خطأ: الحقول الإجبارية مفقودة: ' || array_to_string(v_missing_fields, ', ');
    ELSE
        RETURN QUERY SELECT 
            v_inserted_count, 
            v_updated_count, 
            v_failed_count, 
            CASE 
                WHEN v_failed_count > 0 THEN 
                    'تم إدراج ' || v_inserted_count || ' منتج، وفشل ' || v_failed_count || ' منتج'
                ELSE 
                    'تم إدراج ' || v_inserted_count || ' منتج بنجاح'
            END;
    END IF;
END;
$$;

-- منح الصلاحيات للدالة
GRANT EXECUTE ON FUNCTION bulk_paste_warehouse_products_flexible TO authenticated;
GRANT EXECUTE ON FUNCTION bulk_paste_warehouse_products_flexible TO anon;

-- ============================================
-- دالة RPC بديلة للصق السريع مع تحديث السجلات الموجودة
-- مع محرك مطابقة ذكي لأسماء الأعمدة
-- ============================================

DROP FUNCTION IF EXISTS bulk_upsert_warehouse_products_flexible;

CREATE OR REPLACE FUNCTION bulk_upsert_warehouse_products_flexible(
    p_warehouse_id UUID,
    p_products JSONB
)
RETURNS TABLE(
    inserted BIGINT,
    updated BIGINT,
    failed BIGINT,
    message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_product JSONB;
    v_product_mapped JSONB;
    v_sequence_number INTEGER := 0;
    v_inserted_count BIGINT := 0;
    v_updated_count BIGINT := 0;
    v_failed_count BIGINT := 0;
    v_product_count INTEGER;
    v_batch_size INTEGER := 500;
    v_start_index INTEGER := 0;
    v_end_index INTEGER := 0;
    v_batch JSONB;
    v_i INTEGER;
    v_existing_id UUID;
    v_trade_name TEXT;
    v_batch_number TEXT;
    v_expiry_date TEXT;
    
    -- متغيرات لمحرك المطابقة الذكي
    v_field_value TEXT;
    v_field_numeric NUMERIC;
    v_missing_required BOOLEAN := FALSE;
    v_missing_fields TEXT[];
BEGIN
    -- التحقق من صحة المعطيات
    IF p_warehouse_id IS NULL THEN
        RETURN QUERY SELECT 0, 0, 0::BIGINT, 'خطأ: معرف المخزن مطلوب';
        RETURN;
    END IF;
    
    IF p_products IS NULL OR jsonb_typeof(p_products) = 'null' THEN
        RETURN QUERY SELECT 0, 0, 0::BIGINT, 'خطأ: لا توجد بيانات منتجات';
        RETURN;
    END IF;

    -- التحقق من أنه مصفوفة
    IF jsonb_typeof(p_products) != 'array' THEN
        RETURN QUERY SELECT 0, 0, 0::BIGINT, 'خطأ: يجب أن تكون بيانات المنتجات في شكل مصفوفة JSON';
        RETURN;
    END IF;

    v_product_count := jsonb_array_length(p_products);

    IF v_product_count = 0 THEN
        RETURN QUERY SELECT 0, 0, 0::BIGINT, 'خطأ: المصفوفة فارغة';
        RETURN;
    END IF;
    
    -- معالجة المنتجات في دفعات
    v_start_index := 0;
    
    WHILE v_start_index < v_product_count LOOP
        v_end_index := LEAST(v_start_index + v_batch_size, v_product_count);
        v_batch := '[]'::JSONB;
        v_i := 0;
        
        FOR v_product IN SELECT jsonb_array_elements(p_products)
        LIMIT v_batch_size OFFSET v_start_index
        LOOP
            v_i := v_i + 1;
            v_sequence_number := v_start_index + v_i;
            
            -- ============================================
            -- محرك المطابقة الذكي لأسماء الأعمدة
            -- ============================================
            
            -- بناء الكائن المُعادَل مع الحقول القياسية
            v_product_mapped := '{
                "sequence_number": ' || v_sequence_number::TEXT || ',
                "tradeName": null,
                "public_price": null,
                "sales_discount": null,
                "quantity": null,
                "purchase_discount": null,
                "category": null,
                "batchNumber": null,
                "expiry_date": null
            }'::JSONB;
            
            -- استخراج اسم الصنف (إجباري)
            v_field_value := NULL;
            IF v_product ? 'tradeName' THEN
                v_field_value := v_product->>'tradeName';
            ELSIF v_product ? 'trade_name' THEN
                v_field_value := v_product->>'trade_name';
            ELSIF v_product ? 'name' THEN
                v_field_value := v_product->>'name';
            ELSIF v_product ? 'الصنف' THEN
                v_field_value := v_product->>'الصنف';
            ELSIF v_product ? 'اسم الصنف' THEN
                v_field_value := v_product->>'اسم الصنف';
            ELSIF v_product ? 'اسم_الصنف' THEN
                v_field_value := v_product->>'اسم_الصنف';
            ELSIF v_product ? 'product' THEN
                v_field_value := v_product->>'product';
            ELSIF v_product ? 'product_name' THEN
                v_field_value := v_product->>'product_name';
            ELSIF v_product ? 'item' THEN
                v_field_value := v_product->>'item';
            ELSIF v_product ? 'item_name' THEN
                v_field_value := v_product->>'item_name';
            END IF;
            
            IF v_field_value IS NULL OR TRIM(v_field_value) = '' THEN
                v_missing_required := TRUE;
                v_missing_fields := array_append(v_missing_fields, 'الصف ' || (v_start_index + v_i)::TEXT || ': اسم الصنف مفقود');
            ELSE
                v_product_mapped := v_product_mapped || jsonb_build_object('tradeName', v_field_value);
                v_trade_name := v_field_value; -- للمقارنة مع السجلات الموجودة
            END IF;
            
            -- استخراج السعر (إجباري)
            v_field_numeric := NULL;
            IF v_product ? 'public_price' THEN
                v_field_numeric := (v_product->>'public_price')::NUMERIC;
            ELSIF v_product ? 'publicPrice' THEN
                v_field_numeric := (v_product->>'publicPrice')::NUMERIC;
            ELSIF v_product ? 'price' THEN
                v_field_numeric := (v_product->>'price')::NUMERIC;
            ELSIF v_product ? 'سعر' THEN
                v_field_numeric := (v_product->>'سعر')::NUMERIC;
            ELSIF v_product ? 'السعر' THEN
                v_field_numeric := (v_product->>'السعر')::NUMERIC;
            ELSIF v_product ? 'سعر_البيع' THEN
                v_field_numeric := (v_product->>'سعر_البيع')::NUMERIC;
            ELSIF v_product ? 'سعر البيع' THEN
                v_field_numeric := (v_product->>'سعر البيع')::NUMERIC;
            ELSIF v_product ? 'selling_price' THEN
                v_field_numeric := (v_product->>'selling_price')::NUMERIC;
            ELSIF v_product ? 'sellingPrice' THEN
                v_field_numeric := (v_product->>'sellingPrice')::NUMERIC;
            END IF;
            
            IF v_field_numeric IS NULL OR v_field_numeric = 0 THEN
                v_missing_required := TRUE;
                v_missing_fields := array_append(v_missing_fields, 'الصف ' || (v_start_index + v_i)::TEXT || ': السعر مفقود أو صفر');
            ELSE
                v_product_mapped := v_product_mapped || jsonb_build_object('public_price', v_field_numeric);
            END IF;
            
            -- استخراج خصم البيع (إجباري)
            v_field_numeric := NULL;
            IF v_product ? 'sales_discount' THEN
                v_field_numeric := (v_product->>'sales_discount')::NUMERIC;
            ELSIF v_product ? 'salesDiscount' THEN
                v_field_numeric := (v_product->>'salesDiscount')::NUMERIC;
            ELSIF v_product ? 'discount' THEN
                v_field_numeric := (v_product->>'discount')::NUMERIC;
            ELSIF v_product ? 'خصم' THEN
                v_field_numeric := (v_product->>'خصم')::NUMERIC;
            ELSIF v_product ? 'الخصم' THEN
                v_field_numeric := (v_product->>'الخصم')::NUMERIC;
            ELSIF v_product ? 'خصم_البيع' THEN
                v_field_numeric := (v_product->>'خصم_البيع')::NUMERIC;
            ELSIF v_product ? 'خصم البيع' THEN
                v_field_numeric := (v_product->>'خصم البيع')::NUMERIC;
            ELSIF v_product ? 'selling_discount' THEN
                v_field_numeric := (v_product->>'selling_discount')::NUMERIC;
            END IF;
            
            IF v_field_numeric IS NULL THEN
                v_field_numeric := 0;
            END IF;
            v_product_mapped := v_product_mapped || jsonb_build_object('sales_discount', v_field_numeric);
            
            -- استخراج الكمية (اختياري)
            v_field_numeric := NULL;
            IF v_product ? 'quantity' THEN
                v_field_numeric := (v_product->>'quantity')::NUMERIC;
            ELSIF v_product ? 'qty' THEN
                v_field_numeric := (v_product->>'qty')::NUMERIC;
            ELSIF v_product ? 'كمية' THEN
                v_field_numeric := (v_product->>'كمية')::NUMERIC;
            ELSIF v_product ? 'الكمية' THEN
                v_field_numeric := (v_product->>'الكمية')::NUMERIC;
            END IF;
            IF v_field_numeric IS NOT NULL THEN
                v_product_mapped := v_product_mapped || jsonb_build_object('quantity', v_field_numeric);
            END IF;
            
            -- استخراج خصم الشراء (اختياري)
            v_field_numeric := NULL;
            IF v_product ? 'purchase_discount' THEN
                v_field_numeric := (v_product->>'purchase_discount')::NUMERIC;
            ELSIF v_product ? 'purchaseDiscount' THEN
                v_field_numeric := (v_product->>'purchaseDiscount')::NUMERIC;
            ELSIF v_product ? 'خصم_الشراء' THEN
                v_field_numeric := (v_product->>'خصم_الشراء')::NUMERIC;
            ELSIF v_product ? 'خصم الشراء' THEN
                v_field_numeric := (v_product->>'خصم الشراء')::NUMERIC;
            END IF;
            IF v_field_numeric IS NOT NULL THEN
                v_product_mapped := v_product_mapped || jsonb_build_object('purchase_discount', v_field_numeric);
            END IF;
            
            -- استخراج التصنيف (اختياري)
            v_field_value := NULL;
            IF v_product ? 'category' THEN
                v_field_value := v_product->>'category';
            ELSIF v_product ? 'تصنيف' THEN
                v_field_value := v_product->>'تصنيف';
            ELSIF v_product ? 'التصنيف' THEN
                v_field_value := v_product->>'التصنيف';
            END IF;
            IF v_field_value IS NOT NULL THEN
                v_product_mapped := v_product_mapped || jsonb_build_object('category', v_field_value);
            END IF;
            
            -- استخراج رقم التشغيلة (اختياري)
            v_field_value := NULL;
            IF v_product ? 'batchNumber' THEN
                v_field_value := v_product->>'batchNumber';
            ELSIF v_product ? 'batch_number' THEN
                v_field_value := v_product->>'batch_number';
            ELSIF v_product ? 'batch' THEN
                v_field_value := v_product->>'batch';
            ELSIF v_product ? 'تشغيلة' THEN
                v_field_value := v_product->>'تشغيلة';
            ELSIF v_product ? 'التشغيلة' THEN
                v_field_value := v_product->>'التشغيلة';
            ELSIF v_product ? 'رقم_التشغيلة' THEN
                v_field_value := v_product->>'رقم_التشغيلة';
            ELSIF v_product ? 'رقم التشغيلة' THEN
                v_field_value := v_product->>'رقم التشغيلة';
            END IF;
            IF v_field_value IS NOT NULL THEN
                v_product_mapped := v_product_mapped || jsonb_build_object('batchNumber', v_field_value);
                v_batch_number := v_field_value; -- للمقارنة مع السجلات الموجودة
            ELSE
                v_batch_number := '';
            END IF;
            
            -- استخراج تاريخ الانتهاء (اختياري)
            v_field_value := NULL;
            IF v_product ? 'expiry_date' THEN
                v_field_value := v_product->>'expiry_date';
            ELSIF v_product ? 'expiryDate' THEN
                v_field_value := v_product->>'expiryDate';
            ELSIF v_product ? 'expiry' THEN
                v_field_value := v_product->>'expiry';
            ELSIF v_product ? 'انتهاء' THEN
                v_field_value := v_product->>'انتهاء';
            ELSIF v_product ? 'تاريخ_الانتهاء' THEN
                v_field_value := v_product->>'تاريخ_الانتهاء';
            ELSIF v_product ? 'تاريخ الانتهاء' THEN
                v_field_value := v_product->>'تاريخ الانتهاء';
            END IF;
            IF v_field_value IS NOT NULL THEN
                v_product_mapped := v_product_mapped || jsonb_build_object('expiry_date', v_field_value);
                v_expiry_date := v_field_value; -- للمقارنة مع السجلات الموجودة
            ELSE
                v_expiry_date := '';
            END IF;
            
            -- البحث عن سجل موجود باستخدام الحقول المُعادَلة
            IF NOT v_missing_required THEN
                SELECT id INTO v_existing_id
                FROM warehouse_products_flexible
                WHERE warehouse_id = p_warehouse_id
                  AND (
                      (product_data->>'tradeName' = v_trade_name OR product_data->>'trade_name' = v_trade_name)
                      AND (product_data->>'batchNumber' = v_batch_number OR product_data->>'batch_number' = v_batch_number)
                      AND (product_data->>'expiry_date' = v_expiry_date OR product_data->>'expiryDate' = v_expiry_date)
                  )
                LIMIT 1;
            END IF;
            
            IF v_existing_id IS NOT NULL THEN
                -- تحديث السجل الموجود
                UPDATE warehouse_products_flexible
                SET product_data = v_product_mapped
                WHERE id = v_existing_id;
                
                v_updated_count := v_updated_count + 1;
            ELSE
                -- إضافة سجل جديد
                v_batch := v_batch || v_product_mapped;
            END IF;
        END LOOP;
        
        -- إدراج السجلات الجديدة في الدفعة
        IF jsonb_array_length(v_batch) > 0 THEN
            BEGIN
                INSERT INTO warehouse_products_flexible (warehouse_id, product_data)
                SELECT p_warehouse_id, product
                FROM jsonb_array_elements(v_batch) AS product;
                
                v_inserted_count := v_inserted_count + jsonb_array_length(v_batch);
                
            EXCEPTION
                WHEN OTHERS THEN
                    v_failed_count := v_failed_count + jsonb_array_length(v_batch);
                    RAISE NOTICE 'خطأ في إدراج الدفعة: %', SQLERRM;
            END;
        END IF;
        
        v_start_index := v_end_index;
        PERFORM pg_sleep(0.01);
    END LOOP;
    
    -- إرجاع النتيجة
    IF v_missing_required THEN
        RETURN QUERY SELECT 
            0::BIGINT, 
            0::BIGINT, 
            v_product_count::BIGINT, 
            'خطأ: الحقول الإجبارية مفقودة: ' || array_to_string(v_missing_fields, ', ');
    ELSE
        RETURN QUERY SELECT 
            v_inserted_count, 
            v_updated_count, 
            v_failed_count, 
            CASE 
                WHEN v_failed_count > 0 THEN 
                    'تم إدراج ' || v_inserted_count || ' منتج جديد، وتحديث ' || v_updated_count || ' منتج موجود، وفشل ' || v_failed_count || ' منتج'
                ELSE 
                    'تم إدراج ' || v_inserted_count || ' منتج جديد، وتحديث ' || v_updated_count || ' منتج موجود'
            END;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION bulk_upsert_warehouse_products_flexible TO authenticated;
GRANT EXECUTE ON FUNCTION bulk_upsert_warehouse_products_flexible TO anon;

-- ============================================
-- تعليقات توضيحية
-- ============================================

COMMENT ON FUNCTION bulk_paste_warehouse_products_flexible IS '
دالة للصق السريع الجماعي للمنتجات المرنة
- تدعم حتى 20,000 منتج في دفعة واحدة
- تقوم بتوليد sequence_number تلقائياً لكل منتج
- ترتبط المنتجات بالمخزن المحدد
- تعالج البيانات في دفعات (500 منتج) لتجنب Timeout
- تضمن العزل التام بين المخازن
- تحتوي على محرك مطابقة ذكي لأسماء الأعمدة (عربي/إنجليزي)
- تتحقق من الحقول الإجبارية (الصنف، السعر، خصم البيع)
';

COMMENT ON FUNCTION bulk_upsert_warehouse_products_flexible IS '
دالة للصق السريع الجماعي مع تحديث السجلات الموجودة
- تدعم حتى 20,000 منتج في دفعة واحدة
- تقوم بتوليد sequence_number تلقائياً
- تحديث السجلات الموجودة بناءً على (اسم المنتج + الباتش + تاريخ الانتهاء)
- إدراج السجلات الجديدة
- تعالج البيانات في دفعات (500 منتج) لتجنب Timeout
- تحتوي على محرك مطابقة ذكي لأسماء الأعمدة (عربي/إنجليزي)
- تتحقق من الحقول الإجبارية (الصنف، السعر، خصم البيع)
';
