-- سكريبت SQL نظيف وصافٍ بالكامل لتهيئة قاعدة بيانات Supabase للتعامل الأوتوماتيكي مع ملايين الأصناف
-- هذا السكريبت يركز فقط على جدول drugs ودالة RPC المؤتمتة

-- إنشاء INDEX مخصص عالي الكفاءة لتسريع عمليات المطابقة والـ UPSERT الفورية
CREATE INDEX IF NOT EXISTS idx_drugs_upsert_composite ON drugs("tradeName", "warehouse_id", "batchNumber");

-- إضافة قيد فريد مركب على tradeName, warehouse_id, batchNumber لتمكين Upsert
DO $$
BEGIN
    -- حذف CONSTRAINT القديم الثنائي إذا كان موجوداً
    ALTER TABLE drugs DROP CONSTRAINT IF EXISTS unique_trade_name_warehouse;

    -- حذف CONSTRAINT القديم الثلاثي إذا كان موجوداً
    ALTER TABLE drugs DROP CONSTRAINT IF EXISTS unique_trade_name_warehouse_batch;

    -- إعادة إنشاء CONSTRAINT الجديد المركب
    ALTER TABLE drugs ADD CONSTRAINT unique_trade_name_warehouse_batch UNIQUE ("tradeName", "warehouse_id", "batchNumber");
EXCEPTION
    WHEN OTHERS THEN
        -- في حالة حدوث أي خطأ، استمر
        RAISE NOTICE 'Error handling unique constraint: %', SQLERRM;
END $$;

-- إنشاء دالة RPC المؤتمتة (enterprise_bulk_upsert) للتعامل مع دفعات ضخمة
-- هذه الدالة تستقبل مصفوفة jsonb وتحللها داخلياً في الـ RAM بمعدل فائق السرعة
CREATE OR REPLACE FUNCTION enterprise_bulk_upsert(products_chunk jsonb)
RETURNS VOID AS $$
DECLARE
    product_record RECORD;
    clean_trade_name TEXT;
    clean_batch_number TEXT;
    clean_category TEXT;
    default_batch_number TEXT := 'بدون';
BEGIN
    -- التكرار على كل منتج في المصفوفة باستخدام jsonb_to_recordset
    FOR product_record IN SELECT * FROM jsonb_to_recordset(products_chunk) AS r(
        "batchNumber" TEXT,
        "tradeName" TEXT,
        quantity INTEGER,
        "public_price" DECIMAL,
        "purchase_discount" DECIMAL,
        "sales_discount" DECIMAL,
        "net_price" DECIMAL,
        "production_date" DATE,
        "expiry_date" DATE,
        category TEXT,
        supplier TEXT,
        "invoice_date" DATE,
        "warehouse_id" TEXT
    ) LOOP
        -- عمل TRIM وتنظيف لاسم المنتج ورقم التشغيل والتصنيف
        clean_trade_name := TRIM(COALESCE(product_record."tradeName", ''));
        clean_batch_number := TRIM(COALESCE(product_record."batchNumber", ''));
        clean_category := TRIM(COALESCE(product_record.category, ''));

        -- إذا كانت خانة الـ batchNumber فارغة، يتم وضع القيمة الافتراضية "بدون"
        IF clean_batch_number IS NULL OR clean_batch_number = '' THEN
            clean_batch_number := default_batch_number;
        END IF;

        -- إدراج أو تحديث المنتج مع تجميع الكميات تراكمياً عند حدوث تعارض
        INSERT INTO drugs (
            "batchNumber",
            "tradeName",
            quantity,
            "public_price",
            "purchase_discount",
            "sales_discount",
            "net_price",
            "production_date",
            "expiry_date",
            category,
            supplier,
            "invoice_date",
            "warehouse_id",
            created_at,
            updated_at
        ) VALUES (
            clean_batch_number,
            clean_trade_name,
            COALESCE(product_record.quantity, 0),
            COALESCE(product_record."public_price", 0),
            COALESCE(product_record."purchase_discount", 0),
            COALESCE(product_record."sales_discount", 0),
            COALESCE(product_record."net_price", 0),
            product_record."production_date",
            product_record."expiry_date",
            clean_category,
            TRIM(COALESCE(product_record.supplier, '')),
            product_record."invoice_date",
            product_record."warehouse_id",
            NOW(),
            NOW()
        )
        ON CONFLICT ON CONSTRAINT unique_trade_name_warehouse_batch
        DO UPDATE SET
            quantity = drugs.quantity + EXCLUDED.quantity,
            "public_price" = EXCLUDED."public_price",
            "purchase_discount" = EXCLUDED."purchase_discount",
            "sales_discount" = EXCLUDED."sales_discount",
            "net_price" = EXCLUDED."net_price",
            "production_date" = EXCLUDED."production_date",
            "expiry_date" = EXCLUDED."expiry_date",
            category = EXCLUDED.category,
            supplier = EXCLUDED.supplier,
            "invoice_date" = EXCLUDED."invoice_date",
            updated_at = NOW();
    END LOOP;

    RETURN;
END;
$$ LANGUAGE plpgsql;

-- منح صلاحيات التنفيذ الكاملة للأدوار المستهدفة لتحديث الـ Schema Cache فوراً
GRANT EXECUTE ON FUNCTION enterprise_bulk_upsert(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION enterprise_bulk_upsert(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION enterprise_bulk_upsert(jsonb) TO service_role;

-- إضافة تعليق نهائي
COMMENT ON TABLE drugs IS 'جدول الأدوية للتعامل مع ملايين الأصناف';
COMMENT ON FUNCTION enterprise_bulk_upsert(jsonb) IS 'دالة RPC المؤتمتة للتعامل مع دفعات ضخمة من الأدوية';

-- انتهاء إعداد قاعدة البيانات
