-- سياسات أمان صارمة لمنع أي مخزن من مسح دليفري مخزن آخر

-- 1. تفعيل RLS على الجدول
ALTER TABLE delivery ENABLE ROW LEVEL SECURITY;

-- 2. إلغاء جميع السياسات القديمة إن وجدت
DROP POLICY IF EXISTS "Users can view their delivery" ON delivery;
DROP POLICY IF EXISTS "Users can insert their delivery" ON delivery;
DROP POLICY IF EXISTS "Users can update their delivery" ON delivery;
DROP POLICY IF EXISTS "Users can delete their delivery" ON delivery;
DROP POLICY IF EXISTS "Users can manage their delivery" ON delivery;

-- 3. سياسة SELECT - رؤية البيانات الخاصة فقط
CREATE POLICY "Users can view their delivery" ON delivery
    FOR SELECT
    USING (user_id = auth.uid());

-- 4. سياسة INSERT - إضافة بيانات للمستخدم فقط
CREATE POLICY "Users can insert their delivery" ON delivery
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- 5. سياسة UPDATE - تعديل البيانات الخاصة فقط
CREATE POLICY "Users can update their delivery" ON delivery
    FOR UPDATE
    USING (user_id = auth.uid());

-- 6. سياسة DELETE - حذف البيانات الخاصة فقط ⛔
CREATE POLICY "Users can delete their delivery" ON delivery
    FOR DELETE
    USING (user_id = auth.uid());

-- 7. إجبار عمود user_id على أن يكون UUID
ALTER TABLE delivery 
    ALTER COLUMN user_id TYPE UUID,
    ALTER COLUMN user_id SET NOT NULL;

-- 8. إضافة تعليق توضيحي
COMMENT ON TABLE delivery IS 'Delivery persons table with strict RLS - users can only access their own data';
