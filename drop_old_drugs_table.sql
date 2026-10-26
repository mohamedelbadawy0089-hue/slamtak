-- حذف الجدول القديم drugs
-- هذا الجدول تم استبداله بـ warehouse_products_flexible
-- CASCADE لحذف جميع الاعتمادات المرتبطة (triggers, indexes, etc.)

DROP TABLE IF EXISTS drugs CASCADE;

-- التحقق من الحذف
SELECT 
    'تم حذف جدول drugs بنجاح!' as status,
    NOW() as timestamp;
