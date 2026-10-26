-- إنشاء جدول الأدوية في Supabase
-- قم بتشغيل هذا الملف في SQL Editor في لوحة تحكم Supabase

-- حذف الجدول إذا كان موجوداً (لإعادة إنشائه بشكل صحيح)
DROP TABLE IF EXISTS drugs CASCADE;

-- إنشاء جدول drugs
CREATE TABLE drugs (
    id BIGSERIAL PRIMARY KEY,
    "batchNumber" VARCHAR(255),
    "tradeName" VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL,
    "public_price" DECIMAL(10, 2) NOT NULL,
    "purchase_discount" DECIMAL(5, 2) DEFAULT 0,
    "sales_discount" DECIMAL(5, 2) DEFAULT 0,
    "net_price" DECIMAL(10, 2) NOT NULL,
    "production_date" DATE,
    "expiry_date" DATE,
    category VARCHAR(255),
    supplier VARCHAR(255),
    "invoice_date" DATE,
    "invoice_number" VARCHAR(255),
    "supplier_invoice" VARCHAR(255),
    "warehouse_id" VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- إنشاء فهرس للبحث السريع
CREATE INDEX IF NOT EXISTS idx_drugs_batchnumber ON drugs("batchNumber");
CREATE INDEX IF NOT EXISTS idx_drugs_tradename ON drugs("tradeName");
CREATE INDEX IF NOT EXISTS idx_drugs_warehouse_id ON drugs("warehouse_id");
CREATE INDEX IF NOT EXISTS idx_drugs_expiry_date ON drugs("expiry_date");

-- إنشاء INDEX مخصص عالي الكفاءة لتسريع عمليات المطابقة والـ UPSERT الفورية
CREATE INDEX IF NOT EXISTS idx_drugs_upsert_composite ON drugs("tradeName", "warehouse_id", "batchNumber");

-- إضافة قيد فريد مركب على tradeName, warehouse_id, batchNumber لتمكين Upsert لكل مخزن على حدة
DO $$
BEGIN
    -- حذف CONSTRAINT القديم إذا كان موجوداً
    ALTER TABLE drugs DROP CONSTRAINT IF EXISTS unique_trade_name_warehouse;

    -- إعادة إنشاء CONSTRAINT الجديد المركب
    ALTER TABLE drugs ADD CONSTRAINT unique_trade_name_warehouse_batch UNIQUE ("tradeName", "warehouse_id", "batchNumber");
EXCEPTION
    WHEN OTHERS THEN
        -- في حالة حدوث أي خطأ، استمر
        RAISE NOTICE 'Error handling unique constraint: %', SQLERRM;
END $$;

-- تفعيل Row Level Security (RLS) للعزل الأمني بين المخازن
ALTER TABLE drugs ENABLE ROW LEVEL SECURITY;

-- إنشاء سياسة أمنية لمنع الوصول إلى بيانات مخزن آخر نهائياً
CREATE POLICY "Users can only access their own warehouse data"
ON drugs
FOR ALL
USING (
    warehouse_id IN (
        SELECT warehouse_id
        FROM user_warehouses
        WHERE user_id = auth.uid()
    )
);

-- إنشاء سياسة أمنية لمنع الإدراج في مخزن آخر نهائياً
CREATE POLICY "Users can only insert into their own warehouse"
ON drugs
FOR INSERT
WITH CHECK (
    warehouse_id IN (
        SELECT warehouse_id
        FROM user_warehouses
        WHERE user_id = auth.uid()
    )
);

-- إنشاء سياسة أمنية لمنع التعديل على بيانات مخزن آخر نهائياً
CREATE POLICY "Users can only update their own warehouse data"
ON drugs
FOR UPDATE
USING (
    warehouse_id IN (
        SELECT warehouse_id
        FROM user_warehouses
        WHERE user_id = auth.uid()
    )
);

-- إنشاء سياسة أمنية لمنع الحذف من بيانات مخزن آخر نهائياً
CREATE POLICY "Users can only delete their own warehouse data"
ON drugs
FOR DELETE
USING (
    warehouse_id IN (
        SELECT warehouse_id
        FROM user_warehouses
        WHERE user_id = auth.uid()
    )
);

-- إضافة تعليقات للأعمدة
COMMENT ON COLUMN drugs."batchNumber" IS 'رقم التشغيلة (Batch Number)';
COMMENT ON COLUMN drugs."tradeName" IS 'اسم الصنف التجاري';
COMMENT ON COLUMN drugs.quantity IS 'الكمية';
COMMENT ON COLUMN drugs."public_price" IS 'السعر العام';
COMMENT ON COLUMN drugs."purchase_discount" IS 'خصم الشراء';
COMMENT ON COLUMN drugs."sales_discount" IS 'خصم البيع';
COMMENT ON COLUMN drugs."net_price" IS 'السعر بعد الخصم';
COMMENT ON COLUMN drugs."production_date" IS 'تاريخ الإنتاج';
COMMENT ON COLUMN drugs."expiry_date" IS 'تاريخ الانتهاء';
COMMENT ON COLUMN drugs.category IS 'التصنيف';
COMMENT ON COLUMN drugs.supplier IS 'المورد';
COMMENT ON COLUMN drugs."invoice_date" IS 'تاريخ الفاتورة';
COMMENT ON COLUMN drugs."invoice_number" IS 'رقم الفاتورة';
COMMENT ON COLUMN drugs."supplier_invoice" IS 'رقم فاتورة المورد';
COMMENT ON COLUMN drugs."warehouse_id" IS 'معرف المستودع';

-- إنشاء جدول ربط المستخدمين بالمستودعات أولاً
CREATE TABLE IF NOT EXISTS user_warehouses (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    warehouse_id VARCHAR(255) NOT NULL,
    warehouse_name VARCHAR(255),
    phone VARCHAR(20),
    governorate VARCHAR(100),
    admin_key VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, warehouse_id)
);

-- إضافة الحقول الجديدة إذا لم تكن موجودة (للجداول الموجودة بالفعل)
DO $$
BEGIN
    -- إضافة حقل warehouse_id إذا لم يكن موجوداً
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_warehouses' AND column_name = 'warehouse_id'
    ) THEN
        ALTER TABLE user_warehouses ADD COLUMN warehouse_id VARCHAR(255);
    END IF;

    -- إضافة حقل warehouse_name إذا لم يكن موجوداً
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_warehouses' AND column_name = 'warehouse_name'
    ) THEN
        ALTER TABLE user_warehouses ADD COLUMN warehouse_name VARCHAR(255);
    END IF;

    -- إضافة حقل phone إذا لم يكن موجوداً
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_warehouses' AND column_name = 'phone'
    ) THEN
        ALTER TABLE user_warehouses ADD COLUMN phone VARCHAR(20);
    END IF;

    -- إضافة حقل governorate إذا لم يكن موجوداً
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_warehouses' AND column_name = 'governorate'
    ) THEN
        ALTER TABLE user_warehouses ADD COLUMN governorate VARCHAR(100);
    END IF;

    -- إضافة حقل admin_key إذا لم يكن موجوداً
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_warehouses' AND column_name = 'admin_key'
    ) THEN
        ALTER TABLE user_warehouses ADD COLUMN admin_key VARCHAR(255);
    END IF;

    -- إضافة UNIQUE constraint إذا لم يكن موجوداً
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'user_warehouses' AND constraint_type = 'UNIQUE'
    ) THEN
        ALTER TABLE user_warehouses ADD CONSTRAINT user_warehouses_user_id_warehouse_id_key UNIQUE (user_id, warehouse_id);
    END IF;
END $$;

-- تفعيل RLS لجدول user_warehouses
ALTER TABLE user_warehouses ENABLE ROW LEVEL SECURITY;

-- سياسة للقراءة: المستخدم يمكنه قراءة ارتباطاته فقط
DROP POLICY IF EXISTS "Users can view their own warehouse associations" ON user_warehouses;
CREATE POLICY "Users can view their own warehouse associations"
ON user_warehouses FOR SELECT
USING (auth.uid() = user_id);

-- سياسة للإضافة: المستخدم يمكنه إضافة ارتباطاته فقط
DROP POLICY IF EXISTS "Users can insert their own warehouse associations" ON user_warehouses;
CREATE POLICY "Users can insert their own warehouse associations"
ON user_warehouses FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- سياسة خاصة للـ Trigger لتجاوز RLS
-- هذه السياسة تسمح للـ Trigger بإدخال البيانات في user_warehouses
DROP POLICY IF EXISTS "Trigger bypass policy for user_warehouses" ON user_warehouses;
CREATE POLICY "Trigger bypass policy for user_warehouses"
ON user_warehouses FOR INSERT
TO postgres
WITH CHECK (true);

-- Trigger تلقائي لإضافة سجل في جدول user_warehouses عند إنشاء مستخدم جديد
-- هذا Trigger يقرأ البيانات الحقيقية من metadata ويسجلها في قاعدة البيانات
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- إدخال سجل في user_warehouses باستخدام البيانات الحقيقية من metadata
    DECLARE
        v_warehouse_id TEXT;
        v_warehouse_name TEXT;
        v_phone TEXT;
        v_governorate TEXT;
        v_admin_key TEXT;
    BEGIN
        -- قراءة البيانات الحقيقية من metadata
        v_warehouse_name := NEW.raw_user_meta_data->>'warehouse_name';
        v_phone := NEW.raw_user_meta_data->>'phone';
        v_governorate := NEW.raw_user_meta_data->>'governorate';
        v_admin_key := NEW.raw_user_meta_data->>'admin_key';

        -- توليد warehouse_id فريد
        v_warehouse_id := gen_random_uuid()::TEXT;

        -- إدخال السجل في user_warehouses مع تجاوز RLS
        PERFORM set_config('request.jwt.claim.sub', NEW.id::TEXT, true);

        -- إدخال بدون ON CONFLICT لتجنب مشاكل constraint
        INSERT INTO user_warehouses (user_id, warehouse_id, warehouse_name, phone, governorate, admin_key)
        VALUES (NEW.id, v_warehouse_id, v_warehouse_name, v_phone, v_governorate, v_admin_key);

        RETURN NEW;
    EXCEPTION
        WHEN unique_violation THEN
            -- إذا كان السجل موجوداً بالفعل، تجاهل الخطأ
            RETURN NEW;
        WHEN OTHERS THEN
            -- في حالة حدوث أي خطأ آخر، لا نوقف عملية إنشاء المستخدم
            RETURN NEW;
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- إضافة سجل للمستخدم الحالي يدوياً (للمستخدمين المسجلين بالفعل)
-- استبدل user_id بمعرف المستخدم الفعلي
INSERT INTO user_warehouses (user_id, warehouse_id)
VALUES ('994ef771-fb59-472d-a448-b61a273da2e8', gen_random_uuid()::TEXT)
ON CONFLICT (user_id) DO NOTHING;

-- تفعيل Row Level Security لحماية البيانات لجدول drugs
ALTER TABLE drugs ENABLE ROW LEVEL SECURITY;

-- سياسة للقراءة: المستخدم يمكنه قراءة منتجات مخزنه فقط
DROP POLICY IF EXISTS "Users can view their own warehouse products" ON drugs;
CREATE POLICY "Users can view their own warehouse products"
ON drugs FOR SELECT
USING (
    warehouse_id = (
        SELECT warehouse_id
        FROM user_warehouses
        WHERE user_id = auth.uid()
        LIMIT 1
    )
);

-- سياسة للإضافة الصارمة: المستخدم يمكنه إضافة منتجات لمخزنه فقط
-- هذه السياسة تمنع أي محاولة لإدخال منتجات في مخزن آخر
DROP POLICY IF EXISTS "Users can insert products for their own warehouse ONLY" ON drugs;
CREATE POLICY "Users can insert products for their own warehouse ONLY"
ON drugs FOR INSERT
WITH CHECK (
    warehouse_id IN (
        SELECT warehouse_id
        FROM user_warehouses
        WHERE user_id = auth.uid()
    )
    AND
    auth.uid() IS NOT NULL
);

-- سياسة التعديل الصارمة: المستخدم يمكنه تعديل منتجات مخزنه فقط
-- هذه السياسة تمنع أي مخزن من تعديل منتجات مخزن آخر نهائياً
-- USING: يتحقق أن السطر المراد تعديله ينتمي لمخزن المستخدم الحالي
-- WITH CHECK: يمنع تغيير warehouse_id إلى قيمة أخرى أثناء التعديل
DROP POLICY IF EXISTS "Users can update their own warehouse products ONLY" ON drugs;
CREATE POLICY "Users can update their own warehouse products ONLY"
ON drugs FOR UPDATE
USING (
    warehouse_id IN (
        SELECT warehouse_id
        FROM user_warehouses
        WHERE user_id = auth.uid()
    )
    AND
    auth.uid() IS NOT NULL
)
WITH CHECK (
    warehouse_id IN (
        SELECT warehouse_id
        FROM user_warehouses
        WHERE user_id = auth.uid()
    )
    AND
    auth.uid() IS NOT NULL
);

-- سياسة الحذف الصارمة: المستخدم يمكنه حذف منتجات مخزنه فقط
-- هذه السياسة تمنع أي مخزن من حذف منتجات مخزن آخر نهائياً
-- USING: يتحقق أن السطر المراد حذفه ينتمي لمخزن المستخدم الحالي
DROP POLICY IF EXISTS "Users can delete their own warehouse products ONLY" ON drugs;
CREATE POLICY "Users can delete their own warehouse products ONLY"
ON drugs FOR DELETE
USING (
    warehouse_id IN (
        SELECT warehouse_id
        FROM user_warehouses
        WHERE user_id = auth.uid()
    )
    AND
    auth.uid() IS NOT NULL
);

-- إضافة قيود التحقق الصارمة للحقول المالية الإجبارية فقط
-- منع القيم الفارغة أو السالبة للسعر العام
ALTER TABLE drugs DROP CONSTRAINT IF EXISTS check_public_price_not_null;
ALTER TABLE drugs ADD CONSTRAINT check_public_price_not_null CHECK ("public_price" IS NOT NULL AND "public_price" >= 0);

-- منع القيم الفارغة أو السالبة لخصم البيع
ALTER TABLE drugs DROP CONSTRAINT IF EXISTS check_sales_discount_not_null;
ALTER TABLE drugs ADD CONSTRAINT check_sales_discount_not_null CHECK ("sales_discount" IS NOT NULL AND "sales_discount" >= 0);

-- منع القيم السالبة للسعر بعد الخصم
ALTER TABLE drugs DROP CONSTRAINT IF EXISTS check_net_price_not_null;
ALTER TABLE drugs ADD CONSTRAINT check_net_price_not_null CHECK ("net_price" IS NOT NULL AND "net_price" >= 0);

-- جعل الحقول الاختيارية قابلة للقيم الفارغة
ALTER TABLE drugs ALTER COLUMN "batchNumber" DROP NOT NULL;
ALTER TABLE drugs ALTER COLUMN quantity DROP NOT NULL;
ALTER TABLE drugs ALTER COLUMN "purchase_discount" DROP NOT NULL;
ALTER TABLE drugs ALTER COLUMN "production_date" DROP NOT NULL;
ALTER TABLE drugs ALTER COLUMN "expiry_date" DROP NOT NULL;
ALTER TABLE drugs ALTER COLUMN category DROP NOT NULL;
ALTER TABLE drugs ALTER COLUMN supplier DROP NOT NULL;
ALTER TABLE drugs ALTER COLUMN "invoice_date" DROP NOT NULL;
ALTER TABLE drugs ALTER COLUMN "invoice_number" DROP NOT NULL;
ALTER TABLE drugs ALTER COLUMN "supplier_invoice" DROP NOT NULL;

-- تغيير نوع حقول التواريخ من VARCHAR(7) إلى DATE (لأن الواجهة تضيف يوم 01 تلقائياً)
ALTER TABLE drugs ALTER COLUMN "production_date" TYPE DATE;
ALTER TABLE drugs ALTER COLUMN "expiry_date" TYPE DATE;
ALTER TABLE drugs ALTER COLUMN "invoice_date" TYPE DATE;

-- إنشاء دالة لتحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- تطبيق Trigger على جدول drugs لتحديث updated_at تلقائياً
DROP TRIGGER IF EXISTS update_drugs_updated_at ON drugs;
CREATE TRIGGER update_drugs_updated_at
BEFORE UPDATE ON drugs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- تطبيق Trigger على جدول user_warehouses لتحديث updated_at تلقائياً
DROP TRIGGER IF EXISTS update_user_warehouses_updated_at ON user_warehouses;
CREATE TRIGGER update_user_warehouses_updated_at
BEFORE UPDATE ON user_warehouses
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- إنشاء دالة للبحث الذكي عن الأدوية
CREATE OR REPLACE FUNCTION search_drugs(search_term TEXT)
RETURNS TABLE (
    id BIGINT,
    "tradeName" VARCHAR(255),
    quantity INTEGER,
    "public_price" DECIMAL(10, 2),
    "net_price" DECIMAL(10, 2),
    "expiry_date" DATE,
    category VARCHAR(255)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        d.id,
        d."tradeName",
        d.quantity,
        d."public_price",
        d."net_price",
        d."expiry_date",
        d.category
    FROM drugs d
    WHERE 
        d.warehouse_id = (
            SELECT warehouse_id 
            FROM user_warehouses 
            WHERE user_id = auth.uid() 
            LIMIT 1
        )
        AND (
            d."tradeName" ILIKE '%' || search_term || '%'
            OR d."batchNumber" ILIKE '%' || search_term || '%'
            OR d.category ILIKE '%' || search_term || '%'
            OR d.supplier ILIKE '%' || search_term || '%'
        )
    ORDER BY d."tradeName";
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- إنشاء دالة للحصول على إحصائيات المخزن
CREATE OR REPLACE FUNCTION get_warehouse_stats()
RETURNS TABLE (
    total_products BIGINT,
    low_stock_products BIGINT,
    expired_products BIGINT,
    expiring_soon_products BIGINT,
    total_value DECIMAL(20, 2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as total_products,
        COUNT(*) FILTER (WHERE quantity < 10) as low_stock_products,
        COUNT(*) FILTER (WHERE "expiry_date" < CURRENT_DATE) as expired_products,
        COUNT(*) FILTER (WHERE "expiry_date" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days') as expiring_soon_products,
        COALESCE(SUM("net_price" * quantity), 0) as total_value
    FROM drugs
    WHERE 
        warehouse_id = (
            SELECT warehouse_id 
            FROM user_warehouses 
            WHERE user_id = auth.uid() 
            LIMIT 1
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- إنشاء سياسة للسماح بتنفيذ الدوال المساعدة
GRANT EXECUTE ON FUNCTION update_updated_at_column() TO authenticated;
GRANT EXECUTE ON FUNCTION search_drugs(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_warehouse_stats() TO authenticated;

-- إنشاء دالة RPC العملاقة (enterprise_bulk_upsert) للتعامل مع دفعات ضخمة
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
    -- التكرار على كل منتج في المصفوفة
    FOR product_record IN SELECT * FROM jsonb_array_elements(products_chunk) LOOP
        -- عمل TRIM وتنظيف لاسم المنتج ورقم التشغيل والتصنيف
        clean_trade_name := TRIM(COALESCE(product_record->>'tradeName', ''));
        clean_batch_number := TRIM(COALESCE(product_record->>'batchNumber', ''));
        clean_category := TRIM(COALESCE(product_record->>'category', ''));

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
            COALESCE((product_record->>'quantity')::INTEGER, 0),
            COALESCE((product_record->>'public_price')::DECIMAL(10, 2), 0),
            COALESCE((product_record->>'purchase_discount')::DECIMAL(5, 2), 0),
            COALESCE((product_record->>'sales_discount')::DECIMAL(5, 2), 0),
            COALESCE((product_record->>'net_price')::DECIMAL(10, 2), 0),
            (product_record->>'production_date')::DATE,
            (product_record->>'expiry_date')::DATE,
            clean_category,
            TRIM(COALESCE(product_record->>'supplier', '')),
            (product_record->>'invoice_date')::DATE,
            product_record->>'warehouse_id',
            NOW(),
            NOW()
        )
        ON CONFLICT ("tradeName", "warehouse_id", "batchNumber")
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- منح صلاحيات التنفيذ للأدوار المستهدفة
GRANT EXECUTE ON FUNCTION enterprise_bulk_upsert(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION enterprise_bulk_upsert(jsonb) TO anon;

-- إنشاء Storage Bucket لحفظ الملفات (إذا لزم الأمر)
-- ملاحظة: يجب تفعيل Storage في Supabase أولاً
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', true)
ON CONFLICT (id) DO NOTHING;

-- سياسات أمان Storage
CREATE POLICY "Users can upload to their own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'documents'
    AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view their own files"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'documents'
    AND auth.uid()::text = (storage.foldername(name))[1]
);

-- إضافة تعليق نهائي
COMMENT ON TABLE drugs IS 'جدول الأدوية والمنتجات في المخزن';
COMMENT ON TABLE user_warehouses IS 'جدول ربط المستخدمين بالمستودعات للعزل الأمني';

-- انتهاء إعداد قاعدة البيانات
