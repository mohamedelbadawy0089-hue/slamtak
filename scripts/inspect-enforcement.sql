-- فحص جداول الأعمال والمراسي الحالية قبل فرض الصلاحيات الدقيقة
SELECT t.table_name,
       (SELECT count(*) FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=t.table_name) AS cols
  FROM information_schema.tables t
 WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
   AND t.table_name IN ('products','inventory_batches','warehouses','suppliers','purchase_orders','purchase_invoices',
        'goods_receipts','sales_invoices','sales_invoice_items','customers','pharmacies','journal_entries',
        'payments','supplier_payments','sales_returns','customer_returns','deliveries','delivery_drivers',
        'customer_tickets','employees','payroll_runs','promotions','price_lists','notifications','automation_rules')
 ORDER BY t.table_name;

SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('rbac_require','rbac_is_owner','rbac_effective_permissions','has_permission','current_actor_manages','rbac_normalize','rbac_expand')
 ORDER BY p.proname;

SELECT c.relname AS table_name, tg.tgname, pg_get_triggerdef(tg.oid) AS def
  FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND NOT tg.tgisinternal
   AND c.relname IN ('products','inventory_batches','suppliers','purchase_orders','purchase_invoices','goods_receipts',
        'sales_invoices','customers','journal_entries','payments','employees','promotions','price_lists')
 ORDER BY c.relname, tg.tgname;

SELECT pg_get_functiondef('public.rbac_require'::regproc) AS rbac_require_def;
