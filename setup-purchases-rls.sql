-- ============================================
-- تفعيل RLS لنظام المشتريات - كل مخزن يرى بياناته فقط
-- ============================================

-- ============================================
-- 1. تفعيل RLS على الجداول الرئيسية
-- ============================================

-- تفعيل RLS على جدول المنتجات
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- تفعيل RLS على جدول المخازن
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

-- تفعيل RLS على جدول المشتريات (إذا كان موجوداً)
-- ملاحظة: قد يكون لديك جدول purchases أو تستخدم جدول products مع نوع "مشتريات"
-- إذا كان لديك جدول منفصل للمشتريات، قم بإلغاء التعليق التالي:
-- ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 2. سياسات RLS للمنتجات (Products)
-- ============================================

-- حذف السياسات القديمة إن وجدت
DROP POLICY IF EXISTS products_select_policy ON products;
DROP POLICY IF EXISTS products_insert_policy ON products;
DROP POLICY IF EXISTS products_update_policy ON products;
DROP POLICY IF EXISTS products_delete_policy ON products;
DROP POLICY IF EXISTS products_all_policy ON products;
DROP POLICY IF EXISTS products_isolation_policy ON products;

-- سياسة SELECT: المستخدم يرى منتجات مخزنه فقط
CREATE POLICY products_select_policy ON products
    FOR SELECT
    USING (
        warehouse_id = current_setting('app.current_warehouse_id', true)::UUID 
        OR warehouse_id IS NULL
    );

-- سياسة INSERT: المستخدم يضيف منتجات لمخزنه فقط
CREATE POLICY products_insert_policy ON products
    FOR INSERT
    WITH CHECK (
        warehouse_id = current_setting('app.current_warehouse_id', true)::UUID
    );

-- سياسة UPDATE: المستخدم يعدل منتجات مخزنه فقط
CREATE POLICY products_update_policy ON products
    FOR UPDATE
    USING (
        warehouse_id = current_setting('app.current_warehouse_id', true)::UUID
    );

-- سياسة DELETE: المستخدم يحذف منتجات مخزنه فقط
CREATE POLICY products_delete_policy ON products
    FOR DELETE
    USING (
        warehouse_id = current_setting('app.current_warehouse_id', true)::UUID
    );

-- ============================================
-- 3. سياسات RLS للمخازن (Warehouses)
-- ============================================

-- حذف السياسات القديمة
DROP POLICY IF EXISTS warehouses_select_policy ON warehouses;
DROP POLICY IF EXISTS warehouses_insert_policy ON warehouses;
DROP POLICY IF EXISTS warehouses_update_policy ON warehouses;
DROP POLICY IF EXISTS warehouses_delete_policy ON warehouses;

-- سياسة SELECT: المستخدم يرى مخزنه فقط
CREATE POLICY warehouses_select_policy ON warehouses
    FOR SELECT
    USING (
        id = current_setting('app.current_warehouse_id', true)::UUID
        OR id = auth.uid()
    );

-- سياسة INSERT: السماح بإنشاء مخزن جديد (للمستخدمين المسجلين)
CREATE POLICY warehouses_insert_policy ON warehouses
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- سياسة UPDATE: المستخدم يعدل مخزنه فقط
CREATE POLICY warehouses_update_policy ON warehouses
    FOR UPDATE
    USING (
        id = current_setting('app.current_warehouse_id', true)::UUID
        OR id = auth.uid()
    );

-- ============================================
-- 4. سياسات إضافية للمبيعات (Sales) إذا كانت موجودة
-- ============================================

-- تفعيل RLS على المبيعات
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

-- حذف السياسات القديمة
DROP POLICY IF EXISTS sales_select_policy ON sales;
DROP POLICY IF EXISTS sales_insert_policy ON sales;

-- سياسة المبيعات: كل مخزن يرى مبيعاته فقط
CREATE POLICY sales_select_policy ON sales
    FOR SELECT
    USING (
        warehouse_id = current_setting('app.current_warehouse_id', true)::UUID
    );

CREATE POLICY sales_insert_policy ON sales
    FOR INSERT
    WITH CHECK (
        warehouse_id = current_setting('app.current_warehouse_id', true)::UUID
    );

-- ============================================
-- 5. سياسات الطلبات (Orders)
-- ============================================

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_select_policy ON orders;
DROP POLICY IF EXISTS orders_insert_policy ON orders;

CREATE POLICY orders_select_policy ON orders
    FOR SELECT
    USING (
        warehouse_id = current_setting('app.current_warehouse_id', true)::UUID
    );

CREATE POLICY orders_insert_policy ON orders
    FOR INSERT
    WITH CHECK (
        warehouse_id = current_setting('app.current_warehouse_id', true)::UUID
    );

-- ============================================
-- 6. إنشاء Index للأداء
-- ============================================

CREATE INDEX IF NOT EXISTS idx_products_warehouse_lookup ON products(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_orders_warehouse_lookup ON orders(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_sales_warehouse_lookup ON sales(warehouse_id);

-- ============================================
-- 7. دالة مساعدة لتعيين warehouse_id للجلسة
-- ============================================

CREATE OR REPLACE FUNCTION set_warehouse_id(warehouse_id TEXT)
RETURNS void AS $$
BEGIN
    PERFORM set_config('app.current_warehouse_id', warehouse_id, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- إشعار إتمام الإعداد
-- ============================================
SELECT '✅ تم تفعيل RLS وإنشاء السياسات بنجاح!' AS message;
