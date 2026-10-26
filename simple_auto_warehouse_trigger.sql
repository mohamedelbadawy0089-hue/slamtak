-- ============================================================
-- دالة وتريجر بسيط لإنشاء مخزن تلقائياً عند تسجيل مستخدم
-- ============================================================
-- يعتمد فقط على الأعمدة الفعلية الموجودة في قاعدة البيانات
-- ============================================================

-- ============================================================
-- 1. دالة لتوليد كود مخزن فريد
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
        -- توليد كود عشوائي (مثال: WH-12345)
        new_code := 'WH-' || LPAD(FLOOR(RANDOM() * 99999)::TEXT, 5, '0');

        -- التحقق من عدم وجود الكود
        SELECT EXISTS(
            SELECT 1 FROM warehouses WHERE warehouse_code = new_code
        ) INTO code_exists;

        IF NOT code_exists THEN
            RETURN new_code;
        END IF;

        -- إذا وصلنا للحد الأقصى من المحاولات، نرجع NULL
        IF attempt >= max_attempts THEN
            RETURN NULL;
        END IF;
    END LOOP;
END;
$$;

-- ============================================================
-- 2. دالة Trigger لإنشاء مخزن عند إدخال مستخدم جديد
-- ============================================================
CREATE OR REPLACE FUNCTION create_warehouse_on_user_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- إدخال سجل مخزن جديد باستخدام الأعمدة الفعلية فقط
    INSERT INTO warehouses (
        id,
        user_id,
        warehouse_name,
        warehouse_code
    ) VALUES (
        NEW.id,
        NEW.id,
        COALESCE(NEW.name, 'المخزن الافتراضي'),
        generate_unique_warehouse_code()
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
-- 3. إنشاء Trigger على جدول users
-- ============================================================
DROP TRIGGER IF EXISTS trigger_create_warehouse_on_user_insert ON users;
CREATE TRIGGER trigger_create_warehouse_on_user_insert
    AFTER INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION create_warehouse_on_user_insert();

-- ============================================================
-- 4. التحقق من نجاح التفعيل
-- ============================================================
SELECT 
    'Trigger created successfully' as status,
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE trigger_name = 'trigger_create_warehouse_on_user_insert';

-- ============================================================
-- 5. اختبار (اختياري - يمكنك إزالة هذا الجزء)
-- ============================================================
-- INSERT INTO users (id, email, name) VALUES 
--     (gen_random_uuid(), 'test@example.com', 'مخزن الاختبار');
-- سيتم إنشاء مخزن تلقائياً