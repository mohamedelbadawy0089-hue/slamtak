-- ============================================================
-- RPC Function محسنة: الحذف الآمن لجميع منتجات المخزن
-- ============================================================
-- هذه الدالة محسنة مع:
-- 1. تسجيل مفصل للعمليات
-- 2. التحقق من الحذف الفعلي
-- 3. معالجة أفضل للأخطاء
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
    product_count_before INTEGER;
    product_count_after INTEGER;
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

    RAISE NOTICE 'Current user: %', current_user_id;

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

    RAISE NOTICE 'Actual warehouse ID: %', actual_warehouse_id;

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

    RAISE NOTICE 'Ownership verified. User % owns warehouse %', current_user_id, actual_warehouse_id;

    -- حساب عدد المنتجات قبل الحذف
    SELECT COUNT(*) INTO product_count_before
    FROM warehouse_products_flexible
    WHERE warehouse_id = actual_warehouse_id;

    RAISE NOTICE 'Products before deletion: %', product_count_before;

    -- حذف جميع المنتجات من المخزن المملوك للمستخدم الحالي
    DELETE FROM warehouse_products_flexible
    WHERE warehouse_id = actual_warehouse_id;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RAISE NOTICE 'DELETE command affected % rows', deleted_count;

    -- التحقق من الحذف الفعلي
    SELECT COUNT(*) INTO product_count_after
    FROM warehouse_products_flexible
    WHERE warehouse_id = actual_warehouse_id;

    RAISE NOTICE 'Products after deletion: %', product_count_after;

    -- إذا كانت هناك منتجات متبقية، فهذا يعني أن الحذف لم يكتمل
    IF product_count_after > 0 THEN
        RAISE WARNING 'Deletion incomplete. % products still remain', product_count_after;
    END IF;

    RETURN json_build_object(
        'success', true,
        'deleted_count', deleted_count,
        'warehouse_id', actual_warehouse_id,
        'user_id', current_user_id,
        'products_before', product_count_before,
        'products_after', product_count_after,
        'message', CASE
            WHEN product_count_after = 0 THEN 'All products deleted successfully'
            ELSE 'Some products may remain. Please check.'
        END
    );

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Deletion failed: %', SQLERRM;
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
-- اختبار الدالة (اختياري)
-- ============================================================
-- SELECT delete_all_warehouse_products('YOUR_WAREHOUSE_ID');