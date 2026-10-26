-- ============================================================
-- إعادة تفعيل RLS الآمن على warehouse_products_flexible
-- شغّل هذا الملف في Supabase SQL Editor
-- ============================================================

-- ============================================================
-- STEP 1: دالة SECURITY DEFINER للتحقق من ملكية المخزن
-- تعمل بصلاحيات مرتفعة لتتجاوز RLS داخلياً
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_warehouse_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id 
    FROM public.warehouses 
    WHERE user_id = auth.uid();
$$;

-- ============================================================
-- STEP 2: دالة SECURITY DEFINER للتحقق هل warehouse_id خاص بالمستخدم
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_my_warehouse(wid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM public.warehouses 
        WHERE id = wid 
        AND user_id = auth.uid()
    );
$$;

-- ============================================================
-- STEP 3: تفعيل RLS على warehouse_products_flexible
-- ============================================================

ALTER TABLE warehouse_products_flexible ENABLE ROW LEVEL SECURITY;

-- حذف أي سياسات قديمة
DROP POLICY IF EXISTS "Unified flexible warehouse products policy" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can insert products in their warehouses" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can view products in their warehouses" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can update products in their warehouses" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can delete products in their warehouses" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "warehouse_products_isolation" ON warehouse_products_flexible;

-- إنشاء السياسة الموحدة باستخدام دالة SECURITY DEFINER
CREATE POLICY "warehouse_products_isolation"
ON warehouse_products_flexible
FOR ALL
USING (public.is_my_warehouse(warehouse_id))
WITH CHECK (public.is_my_warehouse(warehouse_id));

-- ============================================================
-- STEP 4: تفعيل RLS على warehouses مع سياسة صحيحة
-- ============================================================

ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

-- حذف السياسات القديمة
DROP POLICY IF EXISTS "warehouses_open_policy" ON warehouses;
DROP POLICY IF EXISTS "owner_isolation_warehouses" ON warehouses;

-- سياسة العرض: كل مستخدم يرى مخزنه فقط
CREATE POLICY "warehouses_select_own"
ON warehouses FOR SELECT
USING (user_id = auth.uid());

-- سياسة الإضافة: يمكن للجميع إضافة مخزن (للتسجيل)
CREATE POLICY "warehouses_insert_own"
ON warehouses FOR INSERT
WITH CHECK (true);

-- سياسة التعديل: يعدّل مخزنه فقط
CREATE POLICY "warehouses_update_own"
ON warehouses FOR UPDATE
USING (user_id = auth.uid());

-- سياسة الحذف: يحذف مخزنه فقط
CREATE POLICY "warehouses_delete_own"
ON warehouses FOR DELETE
USING (user_id = auth.uid());

-- ============================================================
-- STEP 5: تحديث المخزن الحالي لربطه بـ auth.uid()
-- (شغّل هذا بعد تسجيل الدخول لربط المخزن بحسابك)
-- ============================================================

UPDATE warehouses
SET user_id = auth.uid()
WHERE id = '9ada75e9-7260-4e7b-b38e-25fe8c233a67'
AND user_id IS NULL;

-- ============================================================
-- STEP 6: التحقق من نجاح الإعداد
-- ============================================================

-- اختبار: هل الدالة تعمل؟
SELECT public.is_my_warehouse('9ada75e9-7260-4e7b-b38e-25fe8c233a67') AS is_my_warehouse;

-- عرض السياسات المفعّلة
SELECT 
    schemaname,
    tablename,
    policyname,
    cmd,
    qual
FROM pg_policies
WHERE tablename IN ('warehouse_products_flexible', 'warehouses')
ORDER BY tablename, policyname;

SELECT '✅ RLS تم تفعيله بنجاح على warehouse_products_flexible' AS status;
