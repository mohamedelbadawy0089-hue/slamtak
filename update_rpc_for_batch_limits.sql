-- ============================================================
-- تحديث دالة RPC لدعم الدفعات الصغيرة وتجنب حدود Payload Size
-- ============================================================

-- 1. تحديث دالة batch_process_drugs لتعمل مع الدفعات الصغيرة
CREATE OR REPLACE FUNCTION batch_process_drugs_safe(
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
    v_drug_count INTEGER;
BEGIN
    -- التحقق من حجم البيانات (حماية من الدفعات الضخمة)
    v_drug_count := jsonb_array_length(p_drugs);
    
    IF v_drug_count > 1000 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format('حجم الدفعة كبير جداً (%s عنصر). يجب تقسيمها إلى دفعات أصغر من 1000 عنصر', v_drug_count),
            'max_allowed', 1000,
            'received', v_drug_count
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
    EXCEPTION
        WHEN OTHERS THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Invalid warehouse_id format'
            );
    END;

    -- التحقق من وجود البيانات
    IF p_drugs IS NULL OR v_drug_count = 0 THEN
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
                CONTINUE;
            END IF;

            -- استخراج الأسعار وحساب net_price في السيرفر
            v_public_price := COALESCE((v_drug->>'public_price')::DECIMAL(10, 2), 0);
            v_sales_discount := COALESCE((v_drug->>'sales_discount')::DECIMAL(5, 2), 0);
            v_net_price := v_public_price * (1 - v_sales_discount / 100);

            -- استخراج الكمية
            v_quantity := COALESCE((v_drug->>'quantity')::INTEGER, 0);

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
                    v_updated_count := v_updated_count + 1;
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
        'filtered', v_filtered_count,
        'total_received', v_drug_count
    );

    -- إذا كانت هناك أخطاء، نجعل النجاح false
    IF v_error_count > 0 THEN
        v_result := v_result || jsonb_build_object('success', false);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- 2. دالة RPC جديدة للتعامل مع الدفعات الكبيرة عبر تقسيمها داخلياً
CREATE OR REPLACE FUNCTION batch_process_drugs_large(
    p_warehouse_id TEXT,
    p_drugs JSONB,
    p_batch_size INTEGER DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
    v_total_drugs INTEGER;
    v_batches JSONB[];
    v_current_batch JSONB := '[]'::JSONB;
    v_batch_index INTEGER := 0;
    v_results JSONB[] := '{}';
    v_final_result JSONB;
    v_batch_result JSONB;
BEGIN
    -- التحقق من وجود البيانات
    v_total_drugs := jsonb_array_length(p_drugs);
    
    IF v_total_drugs IS NULL OR v_total_drugs = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'No drugs to process'
        );
    END IF;
    
    -- تقسيم البيانات إلى دفعات
    FOR i IN 0..v_total_drugs-1 LOOP
        v_current_batch := v_current_batch || (p_drugs->i);
        
        -- إذا وصلنا لحجم الدفعة أو نهاية البيانات
        IF jsonb_array_length(v_current_batch) >= p_batch_size OR i = v_total_drugs-1 THEN
            v_batch_index := v_batch_index + 1;
            
            -- معالجة الدفعة الحالية
            v_batch_result := batch_process_drugs_safe(p_warehouse_id, v_current_batch);
            v_results := array_append(v_results, v_batch_result);
            
            -- إعادة تهيئة الدفعة
            v_current_batch := '[]'::JSONB;
            
            -- إضافة تأخير بسيط بين الدفعات لتجنب الضغط على قاعدة البيانات
            IF v_batch_index < CEIL(v_total_drugs::FLOAT / p_batch_size) THEN
                PERFORM pg_sleep(0.01); -- 10ms تأخير
            END IF;
        END IF;
    END LOOP;
    
    -- تجميع النتائج
    v_final_result := jsonb_build_object(
        'success', true,
        'total_batches', v_batch_index,
        'total_drugs', v_total_drugs,
        'batch_size', p_batch_size,
        'batches', array_to_json(v_results)
    );
    
    RETURN v_final_result;
END;
$$ LANGUAGE plpgsql;

-- 3. دالة مساعدة للتحقق من حجم البيانات قبل الإرسال
CREATE OR REPLACE FUNCTION validate_payload_size(
    p_data JSONB,
    p_max_size_kb INTEGER DEFAULT 1000
)
RETURNS JSONB AS $$
DECLARE
    v_data_size_bytes INTEGER;
    v_data_size_kb NUMERIC;
BEGIN
    -- حساب حجم البيانات بالبايت
    v_data_size_bytes := octet_length(p_data::text);
    v_data_size_kb := v_data_size_bytes / 1024.0;
    
    RETURN jsonb_build_object(
        'size_bytes', v_data_size_bytes,
        'size_kb', round(v_data_size_kb, 2),
        'max_size_kb', p_max_size_kb,
        'is_within_limit', v_data_size_kb <= p_max_size_kb,
        'recommended_batch_size', CASE 
            WHEN v_data_size_kb <= 100 THEN 1000
            WHEN v_data_size_kb <= 500 THEN 500
            WHEN v_data_size_kb <= 1000 THEN 250
            ELSE 100
        END,
        'message', CASE 
            WHEN v_data_size_kb <= p_max_size_kb THEN 
                'الحجم مقبول'
            ELSE 
                format('حجم البيانات كبير جداً (%s KB). يجب تقسيمها إلى دفعات أصغر', round(v_data_size_kb, 2))
        END
    );
END;
$$ LANGUAGE plpgsql;

-- 4. دالة RPC شاملة مع التحقق التلقائي والتقسيم
CREATE OR REPLACE FUNCTION smart_batch_process_drugs(
    p_warehouse_id TEXT,
    p_drugs JSONB
)
RETURNS JSONB AS $$
DECLARE
    v_size_check JSONB;
    v_recommended_batch_size INTEGER;
    v_result JSONB;
BEGIN
    -- التحقق من حجم البيانات
    v_size_check := validate_payload_size(p_drugs, 1000);
    
    IF NOT (v_size_check->>'is_within_limit')::BOOLEAN THEN
        -- استخدام الدفعات الكبيرة مع التقسيم التلقائي
        v_recommended_batch_size := (v_size_check->>'recommended_batch_size')::INTEGER;
        
        v_result := batch_process_drugs_large(
            p_warehouse_id,
            p_drugs,
            v_recommended_batch_size
        );
        
        -- إضافة معلومات التحقق بالحجم
        v_result := v_result || jsonb_build_object(
            'size_check', v_size_check,
            'used_large_batch', true
        );
    ELSE
        -- استخدام الدفعات الصغيرة المباشرة
        v_result := batch_process_drugs_safe(p_warehouse_id, p_drugs);
        
        -- إضافة معلومات التحقق بالحجم
        v_result := v_result || jsonb_build_object(
            'size_check', v_size_check,
            'used_large_batch', false
        );
    END IF;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- 5. تحديث الصلاحيات
GRANT EXECUTE ON FUNCTION batch_process_drugs_safe TO authenticated;
GRANT EXECUTE ON FUNCTION batch_process_drugs_large TO authenticated;
GRANT EXECUTE ON FUNCTION validate_payload_size TO authenticated;
GRANT EXECUTE ON FUNCTION smart_batch_process_drugs TO authenticated;

-- 6. إنشاء عرض (View) لمراقبة أداء الدفعات
CREATE OR REPLACE VIEW batch_processing_stats AS
SELECT 
    DATE(created_at) as processing_date,
    COUNT(*) as total_batches,
    SUM(jsonb_array_length(p_drugs)) as total_drugs_processed,
    AVG(jsonb_array_length(p_drugs)) as avg_batch_size,
    MIN(jsonb_array_length(p_drugs)) as min_batch_size,
    MAX(jsonb_array_length(p_drugs)) as max_batch_size
FROM (
    SELECT 
        created_at,
        p_drugs
    FROM batch_processing_log -- تحتاج لإنشاء هذا الجدول إذا لم يكن موجوداً
    WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
) as subquery
GROUP BY DATE(created_at)
ORDER BY processing_date DESC;

-- 7. جدول لتسجيل عمليات المعالجة (اختياري)
CREATE TABLE IF NOT EXISTS batch_processing_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    warehouse_id UUID NOT NULL,
    batch_size INTEGER NOT NULL,
    total_drugs INTEGER NOT NULL,
    processing_time_ms INTEGER,
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Trigger لتسجيل عمليات المعالجة
CREATE OR REPLACE FUNCTION log_batch_processing()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO batch_processing_log (
        warehouse_id,
        batch_size,
        total_drugs,
        created_at
    ) VALUES (
        NEW.warehouse_id,
        jsonb_array_length(NEW.p_drugs),
        jsonb_array_length(NEW.p_drugs),
        NOW()
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ملاحظات:
-- 1. هذه الدوال تحل مشكلة حدود Payload Size في Supabase RPC
-- 2. smart_batch_process_drugs هي الدالة الرئيسية الموصى باستخدامها
-- 3. تقوم الدوال تلقائياً بتقسيم البيانات الكبيرة إلى دفعات صغيرة
-- 4. هناك حماية ضد الدفعات الضخمة التي قد تتسبب في فشل العملية
-- 5. يمكن مراقبة الأداء عبر batch_processing_stats view

-- ============================================================
-- كيفية الاستخدام:
-- ============================================================

/*
-- 1. الاستخدام الأساسي (مع تقسيم تلقائي):
SELECT smart_batch_process_drugs(
    'warehouse-uuid-here',
    '[{"tradeName": "Product 1", ...}, ...]'::JSONB
);

-- 2. التحقق من حجم البيانات قبل الإرسال:
SELECT validate_payload_size(
    '[{"tradeName": "Product 1", ...}, ...]'::JSONB,
    1000 -- الحد الأقصى بالكيلوبايت
);

-- 3. مراقبة الإحصائيات:
SELECT * FROM batch_processing_stats;
*/