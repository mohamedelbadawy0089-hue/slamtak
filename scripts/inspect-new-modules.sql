SELECT table_name, string_agg(column_name || ':' || data_type, ', ' ORDER BY ordinal_position) AS cols
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('payroll_runs','payroll_items','promotions','price_lists','price_list_items','customer_service_tickets','automation_rules')
 GROUP BY table_name
 ORDER BY table_name;
