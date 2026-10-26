-- ============================================================
-- البحث عن المصدر الحقيقي للبيانات
-- ============================================================
-- هذا السكريبت يفحص جميع الجداول الممكنة التي قد تحتوي على البيانات
-- ============================================================

-- 1. فحص جدول warehouse_products_flexible
SELECT 
    'warehouse_products_flexible' as table_name,
    COUNT(*) as product_count
FROM warehouse_products_flexible
WHERE warehouse_id = (SELECT id FROM warehouses ORDER BY created_at DESC LIMIT 1);

-- 2. فحص إذا كان هناك جدول drugs
SELECT 
    'drugs table exists' as info,
    EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'drugs'
    ) as exists_flag;

-- 3. فحص جميع الجداول التي تحتوي على بيانات مشابهة
SELECT 
    table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_name LIKE '%drug%' 
   OR table_name LIKE '%product%'
   OR table_name LIKE '%warehouse%'
ORDER BY table_name, column_name;

-- 4. عرض جميع الجداول في قاعدة البيانات
SELECT 
    table_name,
    table_type
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- ============================================================
-- التعليمات:
-- 1. نفذ هذا السكريبت في Supabase SQL Editor
-- 2. انسخ النتائج وأرسلها لي
-- 3. سأعرف من أي جدول تأتي البيانات فعلياً
-- ============================================================