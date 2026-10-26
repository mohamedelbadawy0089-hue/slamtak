-- ============================================================
-- البحث عن البيانات في جميع الجداول الموجودة
-- ============================================================
-- هذا السكريبت يفحص جميع الجداول الموجودة للعثور على البيانات
-- ============================================================

-- 1. فحص عدد السجلات في كل جدول
SELECT 
    'user_warehouses' as table_name,
    COUNT(*) as record_count
FROM user_warehouses
UNION ALL
SELECT 
    'users' as table_name,
    COUNT(*) as record_count
FROM users
UNION ALL
SELECT 
    'product_categories' as table_name,
    COUNT(*) as record_count
FROM product_categories
UNION ALL
SELECT 
    'purchase_invoice_items' as table_name,
    COUNT(*) as record_count
FROM purchase_invoice_items
UNION ALL
SELECT 
    'purchase_invoices' as table_name,
    COUNT(*) as record_count
FROM purchase_invoices
UNION ALL
SELECT 
    'settings' as table_name,
    COUNT(*) as record_count
FROM settings;

-- 2. فحص بنية جدول user_warehouses
SELECT 
    'user_warehouses structure' as info,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_name = 'user_warehouses'
ORDER BY ordinal_position;

-- 3. عرض عينة من بيانات user_warehouses
SELECT * FROM user_warehouses LIMIT 5;

-- 4. فحص بنية جدول users
SELECT 
    'users structure' as info,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;

-- 5. عرض عينة من بيانات users
SELECT * FROM users LIMIT 5;

-- ============================================================
-- التحليل المتوقع:
-- ============================================================
-- إذا كانت البيانات تأتي من user_warehouses، فالمشكلة في الواجهة
-- إذا كانت البيانات تأتي من جدول آخر، نحتاج تعديل الواجهة
-- ============================================================