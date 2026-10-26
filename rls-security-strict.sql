-- =====================================================
-- سياسات أمان مشددة (Strict Security) للمخازن المتعددة
-- =====================================================

-- 1. تفعيل امتداد التشفير (إذا لم يكن مفعلاً)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. تفعيل RLS على جميع الجداول
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY; -- إذا كان ممكناً

-- 3. حذف جميع السياسات القديمة
DROP POLICY IF EXISTS "warehouses_select_own" ON warehouses;
DROP POLICY IF EXISTS "warehouses_insert_own" ON warehouses;
DROP POLICY IF EXISTS "warehouses_update_own" ON warehouses;
DROP POLICY IF EXISTS "warehouses_delete_own" ON warehouses;

DROP POLICY IF EXISTS "products_select_own_warehouse" ON products;
DROP POLICY IF EXISTS "products_insert_own_warehouse" ON products;
DROP POLICY IF EXISTS "products_update_own_warehouse" ON products;
DROP POLICY IF EXISTS "products_delete_own_warehouse" ON products;

-- =====================================================
-- سياسات warehouses (مخازن) - صارمة
-- =====================================================

-- SELECT: المستخدم يرى مخزنه فقط (user_id = auth.uid)
CREATE POLICY "warehouses_select_own"
ON warehouses
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
);

-- INSERT: المستخدم يضيف مخزناً بـ user_id الخاص به فقط
CREATE POLICY "warehouses_insert_own"
ON warehouses
FOR INSERT
TO authenticated
WITH CHECK (
    user_id = auth.uid() AND
    user_id IS NOT NULL
);

-- UPDATE: المستخدم يعدل مخزنه فقط
CREATE POLICY "warehouses_update_own"
ON warehouses
FOR UPDATE
TO authenticated
USING (
    user_id = auth.uid()
)
WITH CHECK (
    user_id = auth.uid()
);

-- DELETE: المستخدم يحذف مخزنه فقط
CREATE POLICY "warehouses_delete_own"
ON warehouses
FOR DELETE
TO authenticated
USING (
    user_id = auth.uid()
);

-- =====================================================
-- سياسات products (منتجات) - صارمة جداً
-- =====================================================

-- دالة مساعدة للتحقق من ملكية المخزن
CREATE OR REPLACE FUNCTION check_warehouse_ownership(p_warehouse_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM warehouses 
        WHERE id = p_warehouse_id 
        AND user_id = p_user_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- SELECT: رؤية المنتجات التابعة لمخزن المستخدم فقط
CREATE POLICY "products_select_own_warehouse"
ON products
FOR SELECT
TO authenticated
USING (
    check_warehouse_ownership(warehouse_id, auth.uid())
);

-- INSERT: إضافة منتج فقط إذا كان المستخدم يملك المخزن
CREATE POLICY "products_insert_own_warehouse"
ON products
FOR INSERT
TO authenticated
WITH CHECK (
    check_warehouse_ownership(warehouse_id, auth.uid())
);

-- UPDATE: تعديل منتجات المخزن المملوك فقط
CREATE POLICY "products_update_own_warehouse"
ON products
FOR UPDATE
TO authenticated
USING (
    check_warehouse_ownership(warehouse_id, auth.uid())
)
WITH CHECK (
    check_warehouse_ownership(warehouse_id, auth.uid())
);

-- DELETE: حذف منتجات المخزن المملوك فقط
CREATE POLICY "products_delete_own_warehouse"
ON products
FOR DELETE
TO authenticated
USING (
    check_warehouse_ownership(warehouse_id, auth.uid())
);

-- =====================================================
-- تشفير admin_key (إعدادات الجدول)
-- =====================================================

-- إضافة عمود للتشفير (إذا لم يكن موجوداً)
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS admin_key_hash TEXT;

-- دالة لتشفير admin_key عند الإدخال
CREATE OR REPLACE FUNCTION encrypt_admin_key()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.admin_key IS NOT NULL THEN
        -- تشفير باستخدام bcrypt (لا يمكن عكسه)
        NEW.admin_key_hash := crypt(NEW.admin_key, gen_salt('bf', 10));
        -- مسح النص الواضح
        NEW.admin_key := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- تفعيل التشفير عند الإدخال
DROP TRIGGER IF EXISTS encrypt_admin_key_trigger ON warehouses;
CREATE TRIGGER encrypt_admin_key_trigger
    BEFORE INSERT OR UPDATE ON warehouses
    FOR EACH ROW
    EXECUTE FUNCTION encrypt_admin_key();

-- دالة للتحقق من admin_key
CREATE OR REPLACE FUNCTION verify_admin_key(p_warehouse_id UUID, p_input_key TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    stored_hash TEXT;
BEGIN
    SELECT admin_key_hash INTO stored_hash
    FROM warehouses
    WHERE id = p_warehouse_id;
    
    IF stored_hash IS NULL THEN
        RETURN FALSE;
    END IF;
    
    RETURN crypt(p_input_key, stored_hash) = stored_hash;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- Validation Server-Side للمنتجات
-- =====================================================

-- دالة للتحقق من صحة المنتج قبل الإدخال
CREATE OR REPLACE FUNCTION validate_product_ownership()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id UUID;
    v_warehouse_user_id UUID;
BEGIN
    -- جلب user_id الحالي
    v_user_id := auth.uid();
    
    -- التحقق من أن المستخدم مسجل الدخول
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User not authenticated';
    END IF;
    
    -- جلب user_id الخاص بمالك المخزن
    SELECT user_id INTO v_warehouse_user_id
    FROM warehouses
    WHERE id = NEW.warehouse_id;
    
    -- التحقق من أن المستخدم يملك المخزن
    IF v_warehouse_user_id IS NULL OR v_warehouse_user_id != v_user_id THEN
        RAISE EXCEPTION 'User does not own this warehouse';
    END IF;
    
    -- التحقق من وجود warehouse_id
    IF NEW.warehouse_id IS NULL THEN
        RAISE EXCEPTION 'Warehouse ID is required';
    END IF;
    
    -- تعيين user_id تلقائياً
    NEW.user_id := v_user_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- تفعيل التحقق عند إدخال منتج
DROP TRIGGER IF EXISTS validate_product_trigger ON products;
CREATE TRIGGER validate_product_trigger
    BEFORE INSERT OR UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION validate_product_ownership();

-- إضافة عمود user_id للمنتجات (إذا لم يكن موجوداً)
ALTER TABLE products ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- =====================================================
-- منع الوصول من المستخدمين غير المسجلين (Anon)
-- =====================================================

-- سياسة رفض الوصول لـ anon على warehouses
CREATE POLICY "warehouses_deny_anon"
ON warehouses
FOR ALL
TO anon
USING (false);

-- سياسة رفض الوصول لـ anon على products
CREATE POLICY "products_deny_anon"
ON products
FOR ALL
TO anon
USING (false);

-- =====================================================
-- فهارس للأمان والأداء
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_warehouses_user_id ON warehouses(user_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_admin_key_hash ON warehouses(admin_key_hash);
CREATE INDEX IF NOT EXISTS idx_products_warehouse_id ON products(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);

-- =====================================================
-- رسالة نجاح
-- =====================================================
SELECT '✅ تم تطبيق سياسات الأمان المشددة بنجاح!' as status;
SELECT '🔐 التشفير: admin_key يتم تشفيره تلقائياً' as encryption_status;
SELECT '🛡️ Validation: المنتجات تُتحقق server-side' as validation_status;
