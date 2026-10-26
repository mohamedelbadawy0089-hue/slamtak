-- ============================================================
-- إعادة تفعيل RLS بفاعلية على جدول warehouse_products_flexible
-- وضمان عزل بيانات ومنتجات كل مخزن بشكل كامل داخل حسابه الخاص
-- ============================================================

-- STEP 1: إنشاء دالة SECURITY DEFINER للتحقق من ملكية المخزن
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

-- دالة إضافية للحصول على قائمة معرفات مخازن المستخدم
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

-- STEP 2: تفعيل RLS على جدول warehouse_products_flexible
ALTER TABLE warehouse_products_flexible ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_products_flexible FORCE ROW LEVEL SECURITY;

-- حذف السياسات القديمة إن وجدت
DROP POLICY IF EXISTS "Unified flexible warehouse products policy" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can insert products in their warehouses" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can view products in their warehouses" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can update products in their warehouses" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can delete products in their warehouses" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "Users can view products via direct join" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "warehouse_products_isolation" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "warehouse_products_select_policy" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "warehouse_products_insert_policy" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "warehouse_products_update_policy" ON warehouse_products_flexible;
DROP POLICY IF EXISTS "warehouse_products_delete_policy" ON warehouse_products_flexible;

-- STEP 3: إنشاء سياسات RLS صريحة ومؤمنة تماماً لجدول warehouse_products_flexible

-- سياسة العرض (SELECT): المنتجات التابعة لمخزن المستخدم الحالي فقط
CREATE POLICY "warehouse_products_select_policy"
ON warehouse_products_flexible
FOR SELECT
USING (public.is_my_warehouse(warehouse_id));

-- سياسة الإضافة (INSERT): إضافة منتجات لمخزن المستخدم الحالي فقط
CREATE POLICY "warehouse_products_insert_policy"
ON warehouse_products_flexible
FOR INSERT
WITH CHECK (public.is_my_warehouse(warehouse_id));

-- سياسة التعديل (UPDATE): تعديل منتجات مخزن المستخدم الحالي فقط
CREATE POLICY "warehouse_products_update_policy"
ON warehouse_products_flexible
FOR UPDATE
USING (public.is_my_warehouse(warehouse_id))
WITH CHECK (public.is_my_warehouse(warehouse_id));

-- سياسة الحذف (DELETE): حذف منتجات مخزن المستخدم الحالي فقط
CREATE POLICY "warehouse_products_delete_policy"
ON warehouse_products_flexible
FOR DELETE
USING (public.is_my_warehouse(warehouse_id));

-- STEP 4: تفعيل وتأمين RLS على جدول warehouses لضمان الربط السليم
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouses_select_own" ON warehouses;
DROP POLICY IF EXISTS "warehouses_insert_own" ON warehouses;
DROP POLICY IF EXISTS "warehouses_update_own" ON warehouses;
DROP POLICY IF EXISTS "warehouses_delete_own" ON warehouses;

CREATE POLICY "warehouses_select_own"
ON warehouses FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "warehouses_insert_own"
ON warehouses FOR INSERT
WITH CHECK (user_id = auth.uid() OR auth.uid() IS NOT NULL);

CREATE POLICY "warehouses_update_own"
ON warehouses FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "warehouses_delete_own"
ON warehouses FOR DELETE
USING (user_id = auth.uid());

-- STEP 5: إنشاء الفهارس لضمان أعلى أداء للاستعلامات مع RLS
CREATE INDEX IF NOT EXISTS idx_warehouse_products_flexible_warehouse_id 
ON warehouse_products_flexible(warehouse_id);

CREATE INDEX IF NOT EXISTS idx_warehouses_user_id 
ON warehouses(user_id);

-- STEP 6: التحقق من نجاح تفعيل السياسات
SELECT 
    tablename,
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename IN ('warehouse_products_flexible', 'warehouses')
ORDER BY tablename, policyname;
