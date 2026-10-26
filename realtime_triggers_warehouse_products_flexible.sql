-- تفعيل التحديث اللحظي لجدول warehouse_products_flexible
-- هذه Triggers تقوم بالإشعار عند أي تغيير في الجدول

-- 1. إنشاء دالة للإشعار عند الإضافة
CREATE OR REPLACE FUNCTION notify_warehouse_products_flexible_insert()
RETURNS TRIGGER AS $$
BEGIN
    -- إشعار بالتغيير مع معرف المخزن والمنتج
    PERFORM pg_notify(
        'warehouse_products_flexible_changes',
        json_build_object(
            'action', 'INSERT',
            'warehouse_id', NEW.warehouse_id::TEXT,
            'product_id', NEW.id::TEXT,
            'product_data', NEW.product_data,
            'timestamp', NOW()
        )::TEXT
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. إنشاء دالة للإشعار عند التعديل
CREATE OR REPLACE FUNCTION notify_warehouse_products_flexible_update()
RETURNS TRIGGER AS $$
BEGIN
    -- إشعار بالتغيير مع معرف المخزن والمنتج
    PERFORM pg_notify(
        'warehouse_products_flexible_changes',
        json_build_object(
            'action', 'UPDATE',
            'warehouse_id', NEW.warehouse_id::TEXT,
            'product_id', NEW.id::TEXT,
            'old_data', OLD.product_data,
            'new_data', NEW.product_data,
            'timestamp', NOW()
        )::TEXT
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. إنشاء دالة للإشعار عند الحذف
CREATE OR REPLACE FUNCTION notify_warehouse_products_flexible_delete()
RETURNS TRIGGER AS $$
BEGIN
    -- إشعار بالتغيير مع معرف المخزن والمنتج
    PERFORM pg_notify(
        'warehouse_products_flexible_changes',
        json_build_object(
            'action', 'DELETE',
            'warehouse_id', OLD.warehouse_id::TEXT,
            'product_id', OLD.id::TEXT,
            'product_data', OLD.product_data,
            'timestamp', NOW()
        )::TEXT
    );
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- 4. حذف Triggers القديمة إذا وجدت
DROP TRIGGER IF EXISTS on_warehouse_products_flexible_insert ON warehouse_products_flexible;
DROP TRIGGER IF EXISTS on_warehouse_products_flexible_update ON warehouse_products_flexible;
DROP TRIGGER IF EXISTS on_warehouse_products_flexible_delete ON warehouse_products_flexible;

-- 5. إنشاء Trigger للإشعار عند الإضافة
CREATE TRIGGER on_warehouse_products_flexible_insert
AFTER INSERT ON warehouse_products_flexible
FOR EACH ROW
EXECUTE FUNCTION notify_warehouse_products_flexible_insert();

-- 6. إنشاء Trigger للإشعار عند التعديل
CREATE TRIGGER on_warehouse_products_flexible_update
AFTER UPDATE ON warehouse_products_flexible
FOR EACH ROW
EXECUTE FUNCTION notify_warehouse_products_flexible_update();

-- 7. إنشاء Trigger للإشعار عند الحذف
CREATE TRIGGER on_warehouse_products_flexible_delete
AFTER DELETE ON warehouse_products_flexible
FOR EACH ROW
EXECUTE FUNCTION notify_warehouse_products_flexible_delete();

-- 8. التحقق من إنشاء Triggers بنجاح
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_timing
FROM information_schema.triggers
WHERE event_object_table = 'warehouse_products_flexible'
ORDER BY trigger_name;
