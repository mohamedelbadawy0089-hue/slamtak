-- ============================================================
-- نظام المخزن الأوتوماتيكي الكامل - Supabase
-- ============================================================
-- هذا الملف يحتوي على كل ما تحتاجه لإنشاء نظام مخزن أوتوماتيكي:
-- 1. RPC function لإنشاء مخزن للمستخدم
-- 2. RPC function للحصول على معرف المخزن للمستخدم الحالي
-- 3. RPC function للحذف الآمن للمنتجات
-- 4. سياسات RLS مناسبة
-- 5. Trigger للتحقق من وجود مخزن عند تسجيل الدخول
-- ============================================================

-- ============================================================
-- 0. إضافة الأعمدة المفقودة إلى جدول warehouses
-- ============================================================
DO $$
BEGIN
    -- إضافة warehouse_code
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'warehouses'
        AND column_name = 'warehouse_code'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN warehouse_code VARCHAR(50) UNIQUE;
        RAISE NOTICE 'Added warehouse_code column to warehouses table';
    ELSE
        RAISE NOTICE 'warehouse_code column already exists';
    END IF;

    -- إضافة description
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'warehouses'
        AND column_name = 'description'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN description TEXT;
        RAISE NOTICE 'Added description column to warehouses table';
    ELSE
        RAISE NOTICE 'description column already exists';
    END IF;

    -- إضافة language
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'warehouses'
        AND column_name = 'language'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN language VARCHAR(10) DEFAULT 'ar';
        RAISE NOTICE 'Added language column to warehouses table';
    ELSE
        RAISE NOTICE 'language column already exists';
    END IF;

    -- إضافة settings
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'warehouses'
        AND column_name = 'settings'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN settings JSONB DEFAULT '{}';
        RAISE NOTICE 'Added settings column to warehouses table';
    ELSE
        RAISE NOTICE 'settings column already exists';
    END IF;

    -- إضافة created_at
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'warehouses'
        AND column_name = 'created_at'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        RAISE NOTICE 'Added created_at column to warehouses table';
    ELSE
        RAISE NOTICE 'created_at column already exists';
    END IF;

    -- إضافة updated_at
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'warehouses'
        AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        RAISE NOTICE 'Added updated_at column to warehouses table';
    ELSE
        RAISE NOTICE 'updated_at column already exists';
    END IF;
END $$;

-- إنشاء فهارس للأعمدة الجديدة لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_warehouses_code ON warehouses(warehouse_code);

-- ============================================================
-- دالة لتوليد كود مخزن فريد
-- ============================================================
CREATE OR REPLACE FUNCTION generate_warehouse_code()
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
-- 1. تفعيل RLS على جدول users (إذا لم يكن مفعلاً)
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. سياسات RLS لجدول users
-- ============================================================
-- المستخدم يمكنه إضافة بياناته الخاصة
DROP POLICY IF EXISTS "Users can insert their own data" ON users;
CREATE POLICY "Users can insert their own data"
    ON users FOR INSERT
    WITH CHECK (auth.uid() = id);

-- المستخدم يمكنه رؤية بياناته الخاصة
DROP POLICY IF EXISTS "Users can view their own data" ON users;
CREATE POLICY "Users can view their own data"
    ON users FOR SELECT
    USING (auth.uid() = id);

-- المستخدم يمكنه تعديل بياناته الخاصة
DROP POLICY IF EXISTS "Users can update their own data" ON users;
CREATE POLICY "Users can update their own data"
    ON users FOR UPDATE
    USING (auth.uid() = id);

-- ============================================================
-- 3. سياسات RLS لجدول warehouses (محسنة)
-- ============================================================
-- السماح للمستخدم بإنشاء مخزن خاص به
DROP POLICY IF EXISTS "Users can create warehouses" ON warehouses;
CREATE POLICY "Users can create warehouses"
    ON warehouses FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- السماح للمستخدم برؤية مخازنه فقط
DROP POLICY IF EXISTS "Users can view their own warehouses" ON warehouses;
CREATE POLICY "Users can view their own warehouses"
    ON warehouses FOR SELECT
    USING (auth.uid() = user_id);

-- السماح للمستخدم بتعديل مخازنه
DROP POLICY IF EXISTS "Users can update their own warehouses" ON warehouses;
CREATE POLICY "Users can update their own warehouses"
    ON warehouses FOR UPDATE
    USING (auth.uid() = user_id);

-- السماح للمستخدم بحذف مخازنه
DROP POLICY IF EXISTS "Users can delete their own warehouses" ON warehouses;
CREATE POLICY "Users can delete their own warehouses"
    ON warehouses FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================
-- 4. RPC Function: إعداد المستخدم والمخزن بعد التسجيل
-- ============================================================
DROP FUNCTION IF EXISTS setup_user_after_signup(UUID, VARCHAR, VARCHAR);

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

    -- إنشاء مخزن جديد مع توليد كود تلقائياً
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
        generate_warehouse_code(),
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

GRANT EXECUTE ON FUNCTION setup_user_after_signup(UUID, VARCHAR, VARCHAR) TO authenticated;

-- ============================================================
-- 5. RPC Function: الحصول على معرف المخزن للمستخدم الحالي
-- ============================================================
DROP FUNCTION IF EXISTS get_user_warehouse_id();

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

GRANT EXECUTE ON FUNCTION get_user_warehouse_id() TO authenticated;

-- ============================================================
-- 6. RPC Function: الحذف الآمن لجميع منتجات المخزن
-- ============================================================
DROP FUNCTION IF EXISTS delete_all_warehouse_products(UUID);

CREATE OR REPLACE FUNCTION delete_all_warehouse_products(
    p_warehouse_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    deleted_count INTEGER := 0;
    warehouse_owner_id UUID;
    current_user_id UUID;
    actual_warehouse_id UUID;
BEGIN
    -- الحصول على معرف المستخدم الحالي
    current_user_id := auth.uid();

    IF current_user_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'User not authenticated',
            'sqlstate', '42501',
            'deleted_count', 0,
            'warehouse_id', p_warehouse_id
        );
    END IF;

    -- إذا لم يتم توفير معرف المخزن، حصل عليه من المستخدم الحالي
    IF p_warehouse_id IS NULL THEN
        SELECT id INTO actual_warehouse_id
        FROM warehouses
        WHERE user_id = current_user_id
        LIMIT 1;

        IF actual_warehouse_id IS NULL THEN
            RETURN json_build_object(
                'success', false,
                'error', 'No warehouse found for current user',
                'sqlstate', 'P0002',
                'deleted_count', 0,
                'warehouse_id', NULL
            );
        END IF;
    ELSE
        -- التحقق مما إذا كان المعرف المقدم هو معرف مستخدم (للتوافقية)
        IF EXISTS (SELECT 1 FROM users WHERE id = p_warehouse_id) THEN
            SELECT id INTO actual_warehouse_id
            FROM warehouses
            WHERE user_id = p_warehouse_id
            LIMIT 1;

            IF actual_warehouse_id IS NULL THEN
                RETURN json_build_object(
                    'success', false,
                    'error', 'No warehouse found for this user',
                    'sqlstate', 'P0002',
                    'deleted_count', 0,
                    'warehouse_id', NULL
                );
            END IF;
        ELSE
            -- افترض أنه معرف مخزن
            actual_warehouse_id := p_warehouse_id;
        END IF;
    END IF;

    -- التحقق من وجود المخزن وملكيته للمستخدم الحالي
    SELECT user_id INTO warehouse_owner_id
    FROM warehouses
    WHERE id = actual_warehouse_id;

    IF warehouse_owner_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Warehouse not found',
            'sqlstate', 'P0002',
            'deleted_count', 0,
            'warehouse_id', actual_warehouse_id
        );
    END IF;

    -- التحقق من أن المستخدم الحالي هو مالك المخزن
    IF warehouse_owner_id != current_user_id THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Access denied: You do not own this warehouse',
            'sqlstate', '42501',
            'deleted_count', 0,
            'warehouse_id', actual_warehouse_id
        );
    END IF;

    -- حذف جميع المنتجات من المخزن المملوك للمستخدم الحالي
    DELETE FROM warehouse_products_flexible
    WHERE warehouse_id = actual_warehouse_id;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN json_build_object(
        'success', true,
        'deleted_count', deleted_count,
        'warehouse_id', actual_warehouse_id,
        'user_id', current_user_id
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM,
            'sqlstate', SQLSTATE,
            'deleted_count', deleted_count,
            'warehouse_id', actual_warehouse_id,
            'user_id', current_user_id
        );
END;
$$;

GRANT EXECUTE ON FUNCTION delete_all_warehouse_products(UUID) TO authenticated;

-- ============================================================
-- 7. إنشاء مخازن للمستخدمين الحاليين (لمرة واحدة)
-- ============================================================
INSERT INTO warehouses (
    user_id,
    warehouse_name,
    warehouse_code,
    description,
    language,
    settings
)
SELECT
    u.id,
    'المخزن الافتراضي',
    generate_warehouse_code(),
    'مخزن تم إنشاؤه يدوياً للمستخدم الموجود',
    'ar',
    '{}'
FROM users u
WHERE u.id NOT IN (
    SELECT user_id
    FROM warehouses
    WHERE user_id IS NOT NULL
);

-- ============================================================
-- 8. التحقق من التفعيل
-- ============================================================
SELECT 
    'Functions Created Successfully' as status,
    'setup_user_after_signup' as function1,
    'get_user_warehouse_id' as function2,
    'delete_all_warehouse_products' as function3;

SELECT 
    'Warehouses Created for Existing Users' as status,
    COUNT(*) as total_warehouses
FROM warehouses;

SELECT 
    'RLS Policies Enabled' as status,
    schemaname,
    tablename,
    policyname
FROM pg_policies
WHERE tablename IN ('users', 'warehouses')
ORDER BY tablename, policyname;