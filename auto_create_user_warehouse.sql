-- إضافة سياسة RLS على user_warehouses تسمح للمستخدمين بقراءة مخازنهم فقط
DROP POLICY IF EXISTS "user_warehouses_select_policy" ON user_warehouses;
CREATE POLICY "user_warehouses_select_policy" ON user_warehouses
    FOR SELECT USING (user_id = auth.uid());

-- إضافة سياسة RLS على user_warehouses تسمح للمستخدمين بإدراج مخازنهم فقط
DROP POLICY IF EXISTS "user_warehouses_insert_policy" ON user_warehouses;
CREATE POLICY "user_warehouses_insert_policy" ON user_warehouses
    FOR INSERT WITH CHECK (user_id = auth.uid());

-- تعديل سياسة INSERT على drugs للسماح بالإدراج إذا كان warehouse_id موجوداً في user_warehouses للمستخدم الحالي
-- أو إذا كان warehouse_id غير موجود (للسماح بالإنشاء التلقائي)
DROP POLICY IF EXISTS "drugs_insert_policy" ON drugs;
CREATE POLICY "drugs_insert_policy" ON drugs
    FOR INSERT WITH CHECK (
        warehouse_id IS NULL OR
        EXISTS (
            SELECT 1 FROM user_warehouses 
            WHERE id = warehouse_id::uuid AND user_id = auth.uid()
        )
    );

-- إزالة Trigger القديم لأننا نستخدم المنطق على جانب العميل الآن
DROP TRIGGER IF EXISTS trigger_auto_create_user_warehouse ON drugs;
DROP FUNCTION IF EXISTS auto_create_user_warehouse();
