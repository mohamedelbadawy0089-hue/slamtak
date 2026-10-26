-- تفعيل Row Level Security (RLS) لجدول warehouses
-- لضمان خصوصية بيانات كل مخزن

-- 1. تفعيل RLS على جدول warehouses
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

-- 2. حذف السياسات القديمة إذا وجدت
DROP POLICY IF EXISTS "Users can view their own warehouse" ON warehouses;
DROP POLICY IF EXISTS "Users can insert their own warehouse" ON warehouses;
DROP POLICY IF EXISTS "Users can update their own warehouse" ON warehouses;
DROP POLICY IF EXISTS "Users can delete their own warehouse" ON warehouses;

-- 3. سياسة القراءة - المستخدمون يمكنهم رؤية بياناتهم فقط
CREATE POLICY "Users can view their own warehouse" ON warehouses
    FOR SELECT USING (
        auth.uid()::text = email OR 
        auth.role() = 'service_role'
    );

-- 4. سياسة الإدخال - المستخدمون يمكنهم إدخال بياناتهم فقط
CREATE POLICY "Users can insert their own warehouse" ON warehouses
    FOR INSERT WITH CHECK (
        auth.uid()::text = email OR 
        auth.role() = 'service_role'
    );

-- 5. سياسة التعديل - المستخدمون يمكنهم تعديل بياناتهم فقط
CREATE POLICY "Users can update their own warehouse" ON warehouses
    FOR UPDATE USING (
        auth.uid()::text = email OR 
        auth.role() = 'service_role'
    );

-- 6. سياسة الحذف - المستخدمون يمكنهم حذف بياناتهم فقط
CREATE POLICY "Users can delete their own warehouse" ON warehouses
    FOR DELETE USING (
        auth.uid()::text = email OR 
        auth.role() = 'service_role'
    );

-- 7. سياسة خاصة للمسؤولين للوصول الكامل
CREATE POLICY "Admins can manage all warehouses" ON warehouses
    FOR ALL USING (
        auth.role() = 'service_role'
    );

-- 8. إنشاء دالة للتحقق من ملكية المخزن
CREATE OR REPLACE FUNCTION owns_warehouse(warehouse_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT auth.uid()::text = warehouse_email OR auth.role() = 'service_role';
$$;

-- 9. عرض السياسات المفعلة
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'warehouses'
ORDER BY policyname;

-- 10. عرض حالة RLS
SELECT 
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables 
WHERE tablename = 'warehouses';
