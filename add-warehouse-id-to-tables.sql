-- ============================================
-- إضافة warehouse_id للجداول المفقودة
-- ============================================

-- 1. إضافة warehouse_id لجدول تاريخ حالات الطلبات
-- (لتتبع أي مخزن قام بتغيير حالة الطلب)
ALTER TABLE order_status_history 
ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;

-- 2. إضافة warehouse_id لجدول تتبع التوصيل
-- (لتتبع عمليات التوصيل الخاصة بكل مخزن)
ALTER TABLE delivery_tracking 
ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;

-- ============================================
-- إنشاء Index للبحث السريع
-- ============================================

-- Index للبحث السريع حسب warehouse_id في order_status_history
CREATE INDEX IF NOT EXISTS idx_order_status_history_warehouse_id 
ON order_status_history(warehouse_id);

-- Index للبحث السريع حسب warehouse_id في delivery_tracking
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_warehouse_id 
ON delivery_tracking(warehouse_id);

-- ============================================
-- إضافة Index للـ sales إذا لم يكن موجوداً
-- ============================================
CREATE INDEX IF NOT EXISTS idx_sales_warehouse_id 
ON sales(warehouse_id);

-- ============================================
-- تحديث قيود RLS للجداول المُعدلة
-- ============================================

-- تفعيل RLS على الجداول المُحدثة
ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_tracking ENABLE ROW LEVEL SECURITY;

-- سياسة RLS: كل مخزن يرى سجلاته فقط
-- حذف السياسة إذا كانت موجودة ثم إنشاؤها
DROP POLICY IF EXISTS order_status_history_isolation_policy ON order_status_history;
CREATE POLICY order_status_history_isolation_policy ON order_status_history
    FOR ALL
    USING (warehouse_id = current_setting('app.current_warehouse_id')::UUID);

DROP POLICY IF EXISTS delivery_tracking_isolation_policy ON delivery_tracking;
CREATE POLICY delivery_tracking_isolation_policy ON delivery_tracking
    FOR ALL
    USING (warehouse_id = current_setting('app.current_warehouse_id')::UUID);

-- ============================================
-- إضافة user_id للجداول المفقودة (لتتبع المستخدم)
-- ============================================

ALTER TABLE order_status_history 
ADD COLUMN IF NOT EXISTS user_id TEXT;

ALTER TABLE delivery_tracking 
ADD COLUMN IF NOT EXISTS user_id TEXT;

-- ============================================
-- تحديث الجداول القائمة إذا لم يكن warehouse_id موجوداً
-- ============================================

-- التأكد من أن products يحتوي على warehouse_id
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS warehouse_id TEXT DEFAULT 'default' REFERENCES warehouses(id) ON DELETE CASCADE;

-- التأكد من أن orders يحتوي على warehouse_id
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE;

-- التأكد من أن sales يحتوي على warehouse_id
ALTER TABLE sales 
ADD COLUMN IF NOT EXISTS warehouse_id TEXT;

-- ============================================
-- إنشاء Index إضافية للأداء
-- ============================================

-- Index للبحث السريع حسب user_id
CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_user_id ON sales(user_id);

-- ============================================
-- إشعار إتمام التحديث
-- ============================================
SELECT '✅ تم إضافة warehouse_id و user_id للجداول بنجاح!' AS message;
