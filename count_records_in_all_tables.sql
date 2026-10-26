-- ============================================================
-- حساب عدد السجلات في جميع الجداول
-- ============================================================
-- هذا السكريبت يحسب عدد السجلات في كل جدول لمعرفة المصدر الحقيقي للبيانات
-- ============================================================

SELECT 
    'master_products' as table_name,
    COUNT(*) as record_count
FROM master_products
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
    'import_logs' as table_name,
    COUNT(*) as record_count
FROM import_logs
UNION ALL
SELECT 
    'users' as table_name,
    COUNT(*) as record_count
FROM users
UNION ALL
SELECT 
    'user_warehouses' as table_name,
    COUNT(*) as record_count
FROM user_warehouses
UNION ALL
SELECT 
    'product_categories' as table_name,
    COUNT(*) as record_count
FROM product_categories
UNION ALL
SELECT 
    'delivery' as table_name,
    COUNT(*) as record_count
FROM delivery
UNION ALL
SELECT 
    'egypt_pharmacies_static' as table_name,
    COUNT(*) as record_count
FROM egypt_pharmacies_static
UNION ALL
SELECT 
    'bulk_import_column_map' as table_name,
    COUNT(*) as record_count
FROM bulk_import_column_map
UNION ALL
SELECT 
    'settings' as table_name,
    COUNT(*) as record_count
FROM settings
ORDER BY record_count DESC;

-- ============================================================
-- التحليل:
-- ============================================================
-- الجدول الذي يحتوي على 1000+ سجل هو مصدر البيانات الفعلي
-- إذا كان master_products يحتوي على البيانات، نحتاج تعديل الكود
-- إذا كان purchase_invoice_items يحتوي على البيانات، نحتاج تعديل الكود
-- ============================================================