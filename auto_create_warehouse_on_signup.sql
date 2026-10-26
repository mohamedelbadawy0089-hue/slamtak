-- ============================================================
-- إنشاء مخزن تلقائياً عند تسجيل مستخدم جديد
-- ============================================================
-- ملاحظة: في Supabase، لا يمكن إنشاء trigger مباشرة على auth.users
-- لذلك سنستخدم إحدى الطريقتين:
-- 1. دالة RPC لإنشاء مخزن للمستخدم الحالي
-- 2. Trigger على جدول users المحلي (إذا كان موجوداً)
-- ============================================================

-- ============================================================
-- الطريقة 1: دالة RPC لإنشاء مخزن للمستخدم الحالي
-- ============================================================
-- يمكن استدعاء هذه الدالة من JavaScript بعد نجاح التسجيل
-- ============================================================

CREATE OR REPLACE FUNCTION create_warehouse_for_current_user(
    p_warehouse_name TEXT DEFAULT 'المخزن الرئيسي',
    p_warehouse_code TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_warehouse_id UUID;
    current_user_id UUID;
BEGIN
    -- الحصول على معرف المستخدم الحالي
    current_user_id := auth.uid();
    
    IF current_user_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'User not authenticated',
            'warehouse_id', NULL
        );
    END IF;

    RAISE NOTICE 'Creating warehouse for user_id: %', current_user_id;

    -- التحقق من وجود مخزن للمستخدم بالفعل
    IF EXISTS (
        SELECT 1 FROM warehouses 
        WHERE user_id = current_user_id
        LIMIT 1
    ) THEN
        -- إرجاع المخزن الموجود
        SELECT id INTO new_warehouse_id
        FROM warehouses
        WHERE user_id = current_user_id
        LIMIT 1;
        
        RETURN json_build_object(
            'success', true,
            'message', 'Warehouse already exists',
            'warehouse_id', new_warehouse_id,
            'user_id', current_user_id
        );
    END IF;

    -- إنشاء مخزن جديد للمستخدم
    INSERT INTO warehouses (
        user_id,
        warehouse_name,
        warehouse_code,
        description,
        language,
        settings,
        created_at,
        updated_at
    ) VALUES (
        current_user_id,
        p_warehouse_name,
        p_warehouse_code,
        'المخزن الافتراضي',
        'ar',
        '{}'::jsonb,
        NOW(),
        NOW()
    ) RETURNING id INTO new_warehouse_id;

    RAISE NOTICE 'Warehouse created with ID: %', new_warehouse_id;

    RETURN json_build_object(
        'success', true,
        'message', 'Warehouse created successfully',
        'warehouse_id', new_warehouse_id,
        'user_id', current_user_id
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM,
            'sqlstate', SQLSTATE,
            'warehouse_id', NULL,
            'user_id', current_user_id
        );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION create_warehouse_for_current_user(TEXT, TEXT) TO authenticated;

-- ============================================================
-- الطريقة 2: Trigger على جدول users المحلي (إذا كان موجوداً)
-- ============================================================
-- هذا يعمل فقط إذا كان لديك جدول users محلي يربط بـ auth.users
-- ============================================================

-- أولاً، التحقق من وجود جدول users المحلي
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'users' 
        AND table_schema = 'public'
    ) THEN
        -- إنشاء الدالة للـ trigger
        CREATE OR REPLACE FUNCTION auto_create_warehouse_on_user_insert()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public
        AS $$
        DECLARE
            new_warehouse_id UUID;
        BEGIN
            -- التحقق من وجود مخزن للمستخدم بالفعل
            IF NOT EXISTS (
                SELECT 1 FROM warehouses 
                WHERE user_id = NEW.id
                LIMIT 1
            ) THEN
                -- إنشاء مخزن جديد للمستخدم
                INSERT INTO warehouses (
                    user_id,
                    warehouse_name,
                    warehouse_code,
                    description,
                    language,
                    settings,
                    created_at,
                    updated_at
                ) VALUES (
                    NEW.id,
                    'المخزن الرئيسي',
                    NULL,
                    'المخزن الافتراضي',
                    'ar',
                    '{}'::jsonb,
                    NOW(),
                    NOW()
                ) RETURNING id INTO new_warehouse_id;
                
                RAISE NOTICE 'Auto-created warehouse % for user %', new_warehouse_id, NEW.id;
            END IF;
            
            RETURN NEW;
        END;
        $$;

        -- إنشاء الـ trigger
        DROP TRIGGER IF EXISTS on_user_insert_create_warehouse ON users;
        CREATE TRIGGER on_user_insert_create_warehouse
        AFTER INSERT ON users
        FOR EACH ROW
        EXECUTE FUNCTION auto_create_warehouse_on_user_insert();
        
        RAISE NOTICE 'Trigger created on users table for auto-creating warehouses';
    ELSE
        RAISE NOTICE 'Local users table does not exist. Use RPC method instead.';
    END IF;
END $$;
