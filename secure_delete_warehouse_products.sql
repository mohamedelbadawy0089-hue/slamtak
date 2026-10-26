-- ============================================================
-- RPC Function آمنة لحذف جميع منتجات المخزن
-- ============================================================
-- الأمان:
-- 1. SECURITY DEFINER لتجاوز RLS مع التحقق الصريح من الملكية
-- 2. التحقق من auth.uid() للمستخدم الحالي
-- 3. التحقق من أن المخزن مملوك للمستخدم الحالي
-- 4. التحقق من وجود المخزن
-- 5. حذف المنتجات من المخزن المملوك للمستخدم فقط
-- 6. يمكن قبول معرف المستخدم أو معرف المخزن (لتوافقية أفضل)
-- ============================================================

-- Drop all overloads of the old function
DROP FUNCTION IF EXISTS delete_all_warehouse_products(UUID);
DROP FUNCTION IF EXISTS delete_all_warehouse_products(UUID, INTEGER);

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

    RAISE NOTICE 'Starting deletion for warehouse_id: %, user_id: %', actual_warehouse_id, current_user_id;

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

    RAISE NOTICE 'Ownership verified. Proceeding with deletion...';

    -- حذف جميع المنتجات من المخزن المملوك للمستخدم الحالي
    DELETE FROM warehouse_products_flexible
    WHERE warehouse_id = actual_warehouse_id;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Deletion complete. Total deleted: %', deleted_count;

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

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION delete_all_warehouse_products(UUID) TO authenticated;
