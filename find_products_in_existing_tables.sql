-- ============================================================
-- البحث عن المنتجات في جميع الجداول الموجودة
-- ============================================================
-- هذا السكريبت يفحص جميع الجداول الموجودة للعثور على المنتجات
-- ============================================================

-- 1. فحص جدول users للبحث عن بيانات منتجات
SELECT 
    'users table' as table_name,
    COUNT(*) as record_count
FROM users;

-- 2. عرض عينة من بيانات users لمعرفة إذا كانت تحتوي على منتجات
SELECT * FROM users LIMIT 3;

-- 3. فحص جميع الأعمدة في جدول users
SELECT 
    column_name,
    data_type
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;

-- 4. فحص جميع الجداول التي قد تحتوي على بيانات مشابهة
SELECT 
    table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE (table_name LIKE '%product%' 
   OR table_name LIKE '%item%'
   OR table_name LIKE '%warehouse%'
   OR table_name LIKE '%drug%')
ORDER BY table_name, column_name;

-- 5. عرض جميع الأعمدة في جميع الجداول
SELECT 
    table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

-- ============================================================
-- التحليل:
-- ============================================================
-- سأعرف من هذه النتائج:
-- 1. أي جدول يحتوي على بيانات المنتجات
-- 2. أي جدول يحتوي على 1000+ سجل
-- 3. ما هي بنية البيانات الفعلية
-- ============================================================