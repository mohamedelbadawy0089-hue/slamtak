-- ============================================================
-- RPC Function لإنشاء مخزن افتراضي للمستخدم
-- ============================================================
-- هذه الدالة يمكن استدعاؤها من التطبيق لإنشاء مخزن للمستخدم
-- مفيدة إذا كنت تريد التحكم في توقيت إنشاء المخزن من التطبيق
-- ============================================================

-- إنشاء دالة لإنشاء مخزن افتراضي
CREATE OR REPLACE FUNCTION create_default_warehouse(
    p_user_id UUID,
    p_warehouse_name VARCHAR DEFAULT 'المخزن الافتراضي',
    p_language VARCHAR DEFAULT 'ar'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_warehouse_id UUID;
    warehouse_exists BOOLEAN;
BEGIN
    -- التحقق من أن المستخدم مسجل
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'User not found',
            'warehouse_id', NULL
        );
    END IF;

    -- التحقق من وجود مخزن مسبقاً للمستخدم
    SELECT EXISTS(
        SELECT 1 FROM warehouses 
        WHERE user_id = p_user_id
    ) INTO warehouse_exists;

    IF warehouse_exists THEN
        -- إرجاع المخزن الموجود بدلاً من إنشاء جديد
        SELECT id INTO new_warehouse_id
        FROM warehouses
        WHERE user_id = p_user_id
        LIMIT 1;

        RETURN json_build_object(
            'success', true,
            'message', 'Warehouse already exists',
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
        p_warehouse_name,
        NULL,
        'مخزن تم إنشاؤه تلقائياً',
        p_language,
        '{}'
    )
    RETURNING id INTO new_warehouse_id;

    RETURN json_build_object(
        'success', true,
        'message', 'Warehouse created successfully',
        'warehouse_id', new_warehouse_id,
        'is_new', true
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM,
            'sqlstate', SQLSTATE,
            'warehouse_id', NULL
        );
END;
$$;

-- منح صلاحية التنفيذ للمستخدمين المسجلين
GRANT EXECUTE ON FUNCTION create_default_warehouse(UUID, VARCHAR, VARCHAR) TO authenticated;

-- ============================================================
-- مثال على الاستخدام من SQL
-- ============================================================
-- SELECT create_default_warehouse('user-uuid-here', 'مخزني', 'ar');

-- ============================================================
-- مثال على الاستخدام من JavaScript
-- ============================================================
/*
const { data, error } = await supabase
  .rpc('create_default_warehouse', {
    p_user_id: userId,
    p_warehouse_name: 'مخزني الرئيسي',
    p_language: 'ar'
  });

if (error) {
  console.error('Error:', error);
} else {
  console.log('Warehouse ID:', data.warehouse_id);
}
*/
