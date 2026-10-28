-- نظرة واحدة مجمّعة (الـ API يعيد نتيجة العبارة الأخيرة فقط)
SELECT jsonb_pretty(jsonb_build_object(
  'tables', (
    SELECT coalesce(jsonb_agg(x ORDER BY x->>'table_name'), '[]'::jsonb) FROM (
      SELECT jsonb_build_object('table_name', c.relname, 'rows', c.reltuples::bigint) AS x
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind='r'
         AND c.relname IN ('products','inventory_batches','warehouses','suppliers','purchase_orders','purchase_invoices',
              'goods_receipts','sales_invoices','sales_invoice_items','customers','pharmacies','journal_entries',
              'payments','supplier_payments','sales_returns','customer_returns','deliveries','delivery_drivers',
              'customer_tickets','employees','payroll_runs','promotions','price_lists','notifications','automation_rules',
              'inventory_movements','stock_transfers','discount_policies')
    ) s
  ),
  'business_triggers', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('table', c.relname, 'trigger', tg.tgname, 'def', pg_get_triggerdef(tg.oid))), '[]'::jsonb)
      FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND NOT tg.tgisinternal
       AND c.relname IN ('products','inventory_batches','suppliers','purchase_orders','purchase_invoices','goods_receipts',
            'sales_invoices','customers','journal_entries','payments','employees','promotions','price_lists',
            'inventory_movements','delivery_drivers','customer_tickets')
  ),
  'non_enforced', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('module', split_part(name,'.',1), 'perm', name)), '[]'::jsonb)
      FROM (SELECT name FROM public.permissions WHERE NOT is_enforced ORDER BY name) p
  ),
  'enforced_count', (SELECT count(*) FROM public.permissions WHERE is_enforced),
  'total_count', (SELECT count(*) FROM public.permissions)
));
