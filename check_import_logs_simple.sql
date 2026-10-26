-- ============================================================
-- فحص بنية import_logs وعينة البيانات
-- ============================================================

-- 1. فحص بنية جدول import_logs
SELECT 
    column_name,
    data_type,
    character_maximum_length,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'import_logs'
ORDER BY ordinal_position;

-- 2. عرض عينة من بيانات import_logs
SELECT * FROM import_logs LIMIT 3;

-- 3. عرض عدد السجلات الكلي
SELECT 
    COUNT(*) as total_records
FROM import_logs;