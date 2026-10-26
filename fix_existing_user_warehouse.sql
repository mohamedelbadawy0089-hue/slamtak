-- ============================================================
-- إصلاح مخزن المستخدم الحالي وتحديث البيانات
-- ============================================================
-- هذا السكريبت يقوم بما يلي:
-- 1. التحقق من وجود مستخدم بمعرف محدد
-- 2. إنشاء مخزن له إذا لم يكن موجوداً
-- 3. إرجاع معرف المخزن الصحيح
-- ============================================================

-- التحقق من المستخدم وإنشاء مخزن له
-- استبدل '00970023-0726-45c3-98a4-a320ec1d21e3' بمعرف المستخدم الخاص بك
DO $$
DECLARE
    v_user_id UUID := '00970023-0726-45c3-98a4-a320ec1d21e3'; -- معرف المستخدم من localStorage
    v_warehouse_id UUID;
    v_user_exists BOOLEAN;
BEGIN
    -- التحقق من وجود المستخدم
    SELECT EXISTS(SELECT 1 FROM users WHERE id = v_user_id) INTO v_user_exists;
    
    IF v_user_exists THEN
        RAISE NOTICE 'User exists: %', v_user_id;
        
        -- التحقق من وجود مخزن للمستخدم
        SELECT id INTO v_warehouse_id
        FROM warehouses
        WHERE user_id = v_user_id
        LIMIT 1;
        
        IF v_warehouse_id IS NULL THEN
            -- إنشاء مخزن جديد للمستخدم
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
                NULL,
                'مخزن تم إنشاؤه لإصلاح البيانات',
                'ar',
                '{}'
            )
            RETURNING id INTO v_warehouse_id;
            
            RAISE NOTICE 'Created new warehouse for user: %', v_warehouse_id;
        ELSE
            RAISE NOTICE 'Warehouse already exists: %', v_warehouse_id;
        END IF;
        
        RAISE NOTICE '========================================';
        RAISE NOTICE 'User ID: %', v_user_id;
        RAISE NOTICE 'Warehouse ID: %', v_warehouse_id;
        RAISE NOTICE '========================================';
        RAISE NOTICE 'استخدم هذا المعرف في localStorage: currentWarehouseId = %', v_warehouse_id;
    ELSE
        RAISE NOTICE 'User does not exist: %', v_user_id;
    END IF;
END $$;

-- عرض المستخدمين ومخازنهم الحالية
SELECT 
    u.id as user_id,
    u.email,
    w.id as warehouse_id,
    w.warehouse_name,
    w.created_at as warehouse_created
FROM users u
LEFT JOIN warehouses w ON u.id = w.user_id
ORDER BY u.created_at DESC;

-- ============================================================
-- للتحديث من JavaScript:
-- بعد تنفيذ هذا السكريبت، استخدم الكود التالي في وحدة التحكم:
-- localStorage.setItem('currentWarehouseId', 'ACTUAL_WAREHOUSE_ID');
-- localStorage.setItem('current_warehouse_id', 'ACTUAL_WAREHOUSE_ID');
-- ============================================================
