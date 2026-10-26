-- حذف حقل تاريخ الفاتورة من جدول drugs
-- Drop invoice_date column from drugs table

-- حذف الحقل من جدول الأدوية
ALTER TABLE drugs 
DROP COLUMN IF EXISTS "invoice_date";

-- حذف الفهرس المرتبط بالحقل إن وجد
DROP INDEX IF EXISTS idx_drugs_invoice_date;

-- ✅ تم الحذف بنجاح
SELECT 'تم حذف حقل تاريخ الفاتورة من جدول drugs بنجاح!' as result;
