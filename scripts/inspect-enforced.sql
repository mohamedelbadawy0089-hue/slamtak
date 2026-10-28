SELECT jsonb_pretty(jsonb_object_agg(k, v)) FROM (
  SELECT 'enforced_perms' AS k,
         (SELECT jsonb_agg(name ORDER BY name) FROM public.permissions WHERE is_enforced) AS v
  UNION ALL
  SELECT 'trigger_tables',
         (SELECT jsonb_agg(DISTINCT c.relname ORDER BY c.relname)
            FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
           WHERE NOT tg.tgisinternal AND tg.tgname LIKE 'rbac%') AS v
  UNION ALL
  SELECT 'has_inventory_batches',
         to_jsonb(EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                           WHERE n.nspname='public' AND c.relname='inventory_batches')) AS v
  UNION ALL
  SELECT 'exist',
         (SELECT jsonb_object_agg(t, x) FROM (
            SELECT t, to_jsonb(EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                                        WHERE n.nspname='public' AND c.relname = t)) AS x
              FROM unnest(ARRAY['returns','return_items','delivery','expenses','purchase_invoice_items',
                                'sales_orders','sales_order_items','sales_quotes','stock_transfer_items',
                                'settings','warehouse_pharmacies','chart_of_accounts','financial_periods',
                                'inventory','master_products','product_categories','warehouse_zones',
                                'approval_workflows','approval_logs','purchase_requests']) t
         ) e) AS v
) s;
