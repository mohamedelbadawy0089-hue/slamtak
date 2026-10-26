-- ============================================================
-- إزالة Trigger القديم (إن وجد) لتجنب التعارضات
-- ============================================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

-- ============================================================
-- حل بديل: استخدام RPC Function آمنة
-- ============================================================
-- بدلاً من trigger مباشر على auth.users، سنستخدم RPC function
-- يتم استدعاؤها من التطبيق بعد التسجيل الناجح
-- هذا أفضل لأنه:
-- 1. لا يسبب فشل في عملية التسجيل
-- 2. يعطي تحكماً أفضل في معالجة الأخطاء
-- 3. يعمل بشكل موثوق مع RLS
-- ============================================================

-- 1. تفعيل RLS على جدول users (إذا لم يكن مفعلاً)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 2. سياسات للسماح للمستخدمين بإدارة بياناتهم
DROP POLICY IF EXISTS "Users can insert their own data" ON users;
CREATE POLICY "Users can insert their own data"
    ON users FOR INSERT
    WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can view their own data" ON users;
CREATE POLICY "Users can view their own data"
    ON users FOR SELECT
    USING (auth.uid() = id);

-- 3. دالة لإنشاء سجل المستخدم والمخزن (بعد التسجيل)
CREATE OR REPLACE FUNCTION setup_user_after_signup(
    p_user_id UUID,
    p_email VARCHAR,
    p_phone VARCHAR DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_warehouse_id UUID;
    user_exists BOOLEAN;
BEGIN
    -- التحقق من أن المستخدم هو صاحب الطلب
    IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Unauthorized',
            'message', 'User not authenticated or invalid user ID'
        );
    END IF;

    -- إدراج المستخدم في جدول users
    INSERT INTO users (id, email, phone)
    VALUES (p_user_id, p_email, p_phone)
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        phone = EXCLUDED.phone;

    -- التحقق من وجود مخزن مسبقاً
    SELECT EXISTS(
        SELECT 1 FROM warehouses
        WHERE user_id = p_user_id
    ) INTO user_exists;

    IF user_exists THEN
        -- إرجاع المخزن الموجود
        SELECT id INTO new_warehouse_id
        FROM warehouses
        WHERE user_id = p_user_id
        LIMIT 1;

        RETURN json_build_object(
            'success', true,
            'message', 'User already has a warehouse',
            'warehouse_id', new_warehouse_id,
            'is_new', false
        );
    END IF;

    -- إنشاء مخزن جديد
    INSERT INTO warehouses (
        user_id,
        warehouse_name,
        warehouse_code,
        description,
        language,
        settings
    ) VALUES (
        p_user_id,
        'المخزن الافتراضي',
        NULL,
        'مخزن تم إنشاؤه تلقائياً عند التسجيل',
        'ar',
        '{}'
    )
    RETURNING id INTO new_warehouse_id;

    RETURN json_build_object(
        'success', true,
        'message', 'User and warehouse created successfully',
        'warehouse_id', new_warehouse_id,
        'is_new', true
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM,
            'sqlstate', SQLSTATE
        );
END;
$$;

-- منح صلاحية التنفيذ للمستخدمين المسجلين
GRANT EXECUTE ON FUNCTION setup_user_after_signup(UUID, VARCHAR, VARCHAR) TO authenticated;

-- ============================================================
-- دالة للحصول على معرف المخزن للمستخدم الحالي
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_warehouse_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    warehouse_id UUID;
BEGIN
    -- الحصول على معرف المستخدم الحالي
    IF auth.uid() IS NULL THEN
        RETURN NULL;
    END IF;

    -- الحصول على معرف المخزن للمستخدم
    SELECT id INTO warehouse_id
    FROM warehouses
    WHERE user_id = auth.uid()
    LIMIT 1;

    RETURN warehouse_id;
END;
$$;

-- منح صلاحية التنفيذ للمستخدمين المسجلين
GRANT EXECUTE ON FUNCTION get_user_warehouse_id() TO authenticated;

-- ============================================================
-- التحقق من نجاح التفعيل
-- ============================================================
SELECT
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';

-- ============================================================
-- ملاحظات مهمة:
-- ============================================================
-- 1. هذا Trigger سيعمل عند تسجيل مستخدم جديد عبر Supabase Auth
-- 2. سيتم إنشاء مخزن تلقائياً مع اسم "المخزن الافتراضي"
-- 3. يمكن للمستخدم تعديل اسم المخزن لاحقاً
-- 4. إذا كان لديك مستخدمين مسجلين مسبقاً، يمكنك إنشاء مخازن لهم يدوياً:
--    INSERT INTO warehouses (user_id, warehouse_name, description, language, settings)
--    SELECT id, 'المخزن الافتراضي', 'مخزن تم إنشاؤه يدوياً', 'ar', '{}'
--    FROM users
--    WHERE id NOT IN (SELECT user_id FROM warehouses);
-- ============================================================


