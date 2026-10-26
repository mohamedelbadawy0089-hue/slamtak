-- ============================================================
-- RPC function محسنة لإنشاء المستخدم والمخزن مع ربط user_id صحيح
-- ============================================================

DROP FUNCTION IF EXISTS setup_user_after_signup;

CREATE OR REPLACE FUNCTION setup_user_after_signup(
    p_user_id UUID,
    p_email TEXT,
    p_phone TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_exists BOOLEAN;
    v_warehouse_id UUID;
    v_warehouse_code VARCHAR(50);
BEGIN
    -- التحقق من وجود المستخدم في جدول users العام
    SELECT EXISTS(
        SELECT 1 FROM users WHERE id = p_user_id
    ) INTO v_user_exists;

    -- إنشاء سجل المستخدم إذا لم يكن موجوداً
    IF NOT v_user_exists THEN
        INSERT INTO users (
            id,
            email,
            phone,
            created_at
        ) VALUES (
            p_user_id,
            p_email,
            p_phone,
            NOW()
        );
    END IF;

    -- التحقق من وجود مخزن للمستخدم
    SELECT id INTO v_warehouse_id
    FROM warehouses
    WHERE user_id = p_user_id
    LIMIT 1;

    -- إنشاء مخزن جديد إذا لم يكن موجوداً
    IF v_warehouse_id IS NULL THEN
        -- توليد كود مخزن فريد
        v_warehouse_code := 'WH-' || LPAD(FLOOR(RANDOM() * 99999)::TEXT, 5, '0');

        -- التأكد من عدم تكرار الكود
        WHILE EXISTS (SELECT 1 FROM warehouses WHERE warehouse_code = v_warehouse_code) LOOP
            v_warehouse_code := 'WH-' || LPAD(FLOOR(RANDOM() * 99999)::TEXT, 5, '0');
        END LOOP;

        -- إنشاء المخزن مع ربط user_id صحيح
        INSERT INTO warehouses (
            user_id,
            warehouse_name,
            warehouse_code,
            description,
            language,
            settings,
            created_at
        ) VALUES (
            p_user_id,
            'المخزن الافتراضي',
            v_warehouse_code,
            'مخزن تم إنشاؤه تلقائياً عند التسجيل',
            'ar',
            '{}',
            NOW()
        )
        RETURNING id INTO v_warehouse_id;
    END IF;

    RETURN json_build_object(
        'success', true,
        'user_id', p_user_id,
        'warehouse_id', v_warehouse_id,
        'message', 'User and warehouse setup completed successfully'
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM,
            'user_id', p_user_id,
            'warehouse_id', NULL
        );
END;
$$;

GRANT EXECUTE ON FUNCTION setup_user_after_signup TO authenticated;

-- ============================================================
-- التحقق من تفعيل الدالة
-- ============================================================
SELECT 
    '✅ Improved setup_user_after_signup function created' as status,
    'Will link user_id correctly to warehouse' as mechanism;