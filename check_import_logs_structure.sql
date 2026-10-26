-- ============================================================
-- فحص بنية جدول import_logs
-- ============================================================
-- هذا السكريبت يفحص بنية جدول import_logs وعينة من البيانات
-- ============================================================

-- 1. فحص بنية جدول import_logs
SELECT 
    column_name,
    data_type
FROM information_schema.columns
WHERE table_name = 'import_logs'
ORDER BY ordinal_position;

-- 2. عرض عينة من بيانات import_logs
SELECT * FROM import_logs LIMIT 3;

-- 3. فحص جداول إضافية معروفة
SELECT 
    'delivery' as table_name,
    COUNT(*) as record_count
FROM delivery
UNION ALL
SELECT 
    'bulk_import_column_map' as table_name,
    COUNT(*) as record_count
FROM bulk_import_column_map
UNION ALL
SELECT 
    'egypt_pharmacies_static' as table_name,
    COUNT(*) as record_count
FROM egypt_pharmacies_static
ORDER BY record_count DESC;

-- ============================================================
-- التحليل:
-- ============================================================
-- سأعرف من هذه النتائج:
-- 1. بنية import_logs - هل يحتوي على بيانات منتجات؟
-- 2. إذا كان هناك جدول آخر يحتوي على 1000 سجل
-- 3. مصدر البيانات الفعلي للواجهة
-- ============================================================