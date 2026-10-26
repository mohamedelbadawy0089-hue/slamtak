-- تفعيل RLS
ALTER TABLE delivery ENABLE ROW LEVEL SECURITY;

-- سياسة العرض
CREATE POLICY "delivery_select_policy" ON delivery
    FOR SELECT USING (user_id = auth.uid());

-- سياسة الإضافة
CREATE POLICY "delivery_insert_policy" ON delivery
    FOR INSERT WITH CHECK (user_id = auth.uid());

-- سياسة التعديل
CREATE POLICY "delivery_update_policy" ON delivery
    FOR UPDATE USING (user_id = auth.uid());

-- سياسة الحذف
CREATE POLICY "delivery_delete_policy" ON delivery
    FOR DELETE USING (user_id = auth.uid());
