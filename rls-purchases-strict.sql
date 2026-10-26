-- ============================================
-- RLS صارم لمنع أي مخزن من التسجيل في حساب آخر
-- ============================================

-- ============================================
-- 1. جدول المشتريات (Purchases) - إنشاء إذا لم يكن موجوداً
-- ============================================

CREATE TABLE IF NOT EXISTS purchases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    product_name TEXT NOT NULL,
    quantity INTEGER,
    price DECIMAL(10, 2) NOT NULL,
    discount DECIMAL(10, 2) DEFAULT 0,
    total DECIMAL(10, 2) NOT NULL,
    supplier_name TEXT,
    production_date DATE,
    expiry_date DATE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ============================================
-- 2. تفعيل RLS الصارم على جدول المشتريات
-- ============================================

ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 3. سياسات RLS الصارمة (STRICT ISOLATION)
-- ============================================

-- حذف السياسات القديمة إن وجدت
DROP POLICY IF EXISTS purchases_select_isolation ON purchases;
DROP POLICY IF EXISTS purchases_insert_isolation ON purchases;
DROP POLICY IF EXISTS purchases_update_isolation ON purchases;
DROP POLICY IF EXISTS purchases_delete_isolation ON purchases;

-- ✅ سياسة SELECT: المخزن يرى مشترياته فقط
CREATE POLICY purchases_select_isolation ON purchases
    FOR SELECT
    USING (
        warehouse_id = current_setting('app.current_warehouse_id', true)::UUID
    );

-- ✅ سياسة INSERT: التحقق الصارم من warehouse_id (منع التسجيل لحساب آخر)
-- WITH CHECK: يتحقق من أن warehouse_id المرسل يطابق warehouse_id الجلسة
CREATE POLICY purchases_insert_isolation ON purchases
    FOR INSERT
    WITH CHECK (
        warehouse_id = current_setting('app.current_warehouse_id', true)::UUID
    );

-- ✅ سياسة UPDATE: التحقق من warehouse_id قبل التعديل
-- USING: للتحقق من الصفوف المسموح بتعديلها
-- WITH CHECK: للتحقق من البيانات الجديدة
CREATE POLICY purchases_update_isolation ON purchases
    FOR UPDATE
    USING (
        warehouse_id = current_setting('app.current_warehouse_id', true)::UUID
    )
    WITH CHECK (
        warehouse_id = current_setting('app.current_warehouse_id', true)::UUID
    );

-- ✅ سياسة DELETE: التحقق من warehouse_id قبل الحذف
CREATE POLICY purchases_delete_isolation ON purchases
    FOR DELETE
    USING (
        warehouse_id = current_setting('app.current_warehouse_id', true)::UUID
    );

-- ============================================
-- 4. تحديث الجداول الموجودة بنفس السياسة الصارمة
-- ============================================

-- تحديث جدول المنتجات بسياسة WITH CHECK إضافية
DROP POLICY IF EXISTS products_insert_isolation ON products;

CREATE POLICY products_insert_isolation ON products
    FOR INSERT
    WITH CHECK (
        warehouse_id = current_setting('app.current_warehouse_id', true)::UUID
    );

-- تحديث جدول المبيعات بسياسة WITH CHECK إضافية  
DROP POLICY IF EXISTS sales_insert_isolation ON sales;

CREATE POLICY sales_insert_isolation ON sales
    FOR INSERT
    WITH CHECK (
        warehouse_id = current_setting('app.current_warehouse_id', true)::UUID
    );

-- تحديث جدول الطلبات بسياسة WITH CHECK إضافية
DROP POLICY IF EXISTS orders_insert_isolation ON orders;

CREATE POLICY orders_insert_isolation ON orders
    FOR INSERT
    WITH CHECK (
        warehouse_id = current_setting('app.current_warehouse_id', true)::UUID
    );

-- ============================================
-- 5. إنشاء Index للأداء
-- ============================================

CREATE INDEX IF NOT EXISTS idx_purchases_warehouse_id ON purchases(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_purchases_created_at ON purchases(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_product_name ON purchases(product_name);

-- ============================================
-- 6. دالة مساعدة لتعيين warehouse_id للجلسة
-- ============================================

CREATE OR REPLACE FUNCTION set_warehouse_id(warehouse_id UUID)
RETURNS void AS $$
BEGIN
    PERFORM set_config('app.current_warehouse_id', warehouse_id::TEXT, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 7. تفعيل updated_at تلقائياً
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_purchases_updated_at ON purchases;
CREATE TRIGGER update_purchases_updated_at
    BEFORE UPDATE ON purchases
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- إشعار إتمام الإعداد
-- ============================================
SELECT '✅ تم تفعيل RLS الصارم على جدول المشتريات وجميع الجداول!' AS message;
SELECT '🔒 لا يمكن لأي مخزن التسجيل في حساب مخزن آخر (WITH CHECK محقق)' AS security_note;
