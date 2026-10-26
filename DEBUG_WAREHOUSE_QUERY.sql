-- ============================================================
-- تصحيح مشكلة عدم العثور على المخزن
-- ============================================================

-- 1. عرض جميع المخازن مع user_id
SELECT 
    w.id as warehouse_id,
    w.user_id,
    w.warehouse_name,
    w.warehouse_code,
    w.created_at
FROM warehouses w
ORDER BY w.created_at DESC;

-- 2. عرض user_id من الجلسة الحالية
SELECT 
    auth.uid() as current_user_id;

-- 3. عرض المخازن الخاصة بالمستخدم الحالي
SELECT 
    w.id as warehouse_id,
    w.user_id,
    w.warehouse_name
FROM warehouses w
WHERE w.user_id = auth.uid();

-- 4. عرض جميع المستخدمين
SELECT 
    u.id as user_id,
    u.email
FROM users u;

-- 5. فحص سياسات RLS على warehouses
SELECT 
    policyname,
    permissive,
    cmd,
    roles
FROM pg_policies
WHERE tablename = 'warehouses';