-- ============================================================
-- ربط user_id من الجلسة بأحد المخازن الموجودة
-- ============================================================

-- 1. عرض user_id من الجلسة الحالية (سيكون NULL في SQL Editor)
SELECT auth.uid() as current_user_id;

-- 2. عرض جميع user_ids في جدول warehouses
SELECT DISTINCT user_id FROM warehouses;

-- 3. عرض user_ids في جدول users
SELECT id as user_id, email FROM users;

-- 4. حل: تحديث user_id في المخزن لتطابق المستخدم الحالي
-- (في بيئة الإنتاج، سنستخدم user_id الفعلي من الجلسة)

-- مثال: تحديث جميع المخازن لتستخدم user_id محدد
-- استبدل 'YOUR_USER_ID' بمعرف المستخدم الفعلي من الجلسة
UPDATE warehouses
SET user_id = '164f3e89-578c-4653-aa90-5325e0836fe4'
WHERE user_id IS NULL OR user_id NOT IN (SELECT id FROM users);

-- 5. التحقق من التحديث
SELECT 
    w.id as warehouse_id,
    w.user_id,
    w.warehouse_name
FROM warehouses w
ORDER BY w.created_at DESC;