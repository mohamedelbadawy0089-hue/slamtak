-- حذف حقل تاريخ الفاتورة من جداول النظام
-- Drop invoice_date column from system tables

-- حذف حقل تاريخ الفاتورة من جدول المشتريات
ALTER TABLE purchase_invoices 
DROP COLUMN IF EXISTS invoice_date;

-- حذف حقل تاريخ الفاتورة من جدول الأدوية
ALTER TABLE drugs 
DROP COLUMN IF EXISTS "invoice_date";

-- حذف الفهرس المرتبط بتاريخ الفاتورة من جدول المشتريات
DROP INDEX IF EXISTS idx_purchase_invoices_invoice_date;

-- ✅ تم الحذف بنجاح
SELECT 'تم حذف حقل تاريخ الفاتورة بنجاح!' as result;
