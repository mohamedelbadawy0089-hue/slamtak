-- ============================================================
-- ضمان إنشاء المخازن أوتوماتيكياً للمستخدمين الحاليين والجدد
-- ============================================================

-- ============================================================
-- 1. إنشاء مخزن للمستخدم الحالي إذا لم يكن موجوداً
-- ============================================================
DO $$
DECLARE
    v_user_id UUID;
    v_warehouse_id UUID;
    v_warehouse_exists BOOLEAN;
BEGIN
    -- الحصول على معرف المستخدم الحالي
    SELECT id INTO v_user_id
    FROM users
    LIMIT 1;

    IF v_user_id IS NULL THEN
        RAISE NOTICE 'No users found in the database';
        RETURN;
    END IF;

    -- التحقق من وجود مخزن للمستخدم
    SELECT EXISTS(
        SELECT 1 FROM warehouses WHERE user_id = v_user_id
    ) INTO v_warehouse_exists;

    IF NOT v_warehouse_exists THEN
        -- إنشاء مخزن جديد
        INSERT INTO warehouses (
            user_id,
            warehouse_name,
            warehouse_code,
            description,
            language,
            settings
        ) VALUES (
            v_user_id,
            'المخزن الافتراضي',
            generate_unique_warehouse_code(),
            'مخزن تم إنشاؤه تلقائياً',
            'ar',
            '{}'
        )
        RETURNING id INTO v_warehouse_id;

        RAISE NOTICE 'Created warehouse % for user %', v_warehouse_id, v_user_id;
    ELSE
        -- الحصول على معرف المخزن الموجود
        SELECT id INTO v_warehouse_id
        FROM warehouses
        WHERE user_id = v_user_id
        LIMIT 1;

        RAISE NOTICE 'Warehouse % already exists for user %', v_warehouse_id, v_user_id;
    END IF;
END $$;

-- ============================================================
-- 2. التأكد من وجود دالة توليد الكود
-- ============================================================
CREATE OR REPLACE FUNCTION generate_unique_warehouse_code()
RETURNS VARCHAR(50)
LANGUAGE plpgsql
AS $$
DECLARE
    new_code VARCHAR(50);
    code_exists BOOLEAN;
    max_attempts INTEGER := 10;
    attempt INTEGER := 0;
BEGIN
    LOOP
        attempt := attempt + 1;
        new_code := 'WH-' || LPAD(FLOOR(RANDOM() * 99999)::TEXT, 5, '0');

        SELECT EXISTS(
            SELECT 1 FROM warehouses WHERE warehouse_code = new_code
        ) INTO code_exists;

        IF NOT code_exists THEN
            RETURN new_code;
        END IF;

        IF attempt >= max_attempts THEN
            RETURN NULL;
        END IF;
    END LOOP;
END;
$$;

-- ============================================================
-- 3. التأكد من وجود Trigger للإنشاء الأوتوماتيكي
-- ============================================================
CREATE OR REPLACE FUNCTION auto_create_warehouse_for_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- إنشاء مخزن تلقائياً للمستخدم الجديد
    INSERT INTO warehouses (
        user_id,
        warehouse_name,
        warehouse_code,
        description,
        language,
        settings
    ) VALUES (
        NEW.id,
        'المخزن الافتراضي',
        generate_unique_warehouse_code(),
        'مخزن تم إنشاؤه تلقائياً عند التسجيل',
        'ar',
        '{}'
    );

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
    -- في حالة الخطأ، نرجع NEW لمنع فشل الإدخال
    RAISE WARNING 'Failed to create warehouse for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- ============================================================
-- 4. إنشاء Trigger على جدول users
-- ============================================================
DROP TRIGGER IF EXISTS trigger_auto_create_warehouse ON users;
CREATE TRIGGER trigger_auto_create_warehouse
    AFTER INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_warehouse_for_user();

-- ============================================================
-- 5. عرض النتائج
-- ============================================================
SELECT 
    '✅ Auto warehouse creation setup completed' as status;

-- عرض المستخدمين والمخازن
SELECT 
    u.id as user_id,
    u.email,
    w.id as warehouse_id,
    w.warehouse_name,
    w.warehouse_code
FROM users u
LEFT JOIN warehouses w ON u.id = w.user_id;

-- عرض عدد المنتجات لكل مخزن
SELECT 
    warehouse_id,
    COUNT(*) as product_count
FROM warehouse_products_flexible
GROUP BY warehouse_id
ORDER BY product_count DESC;