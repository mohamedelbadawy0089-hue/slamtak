SELECT table_name, string_agg(column_name, ', ' ORDER BY ordinal_position) AS cols
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('roles','role_permissions','permissions','user_warehouses','user_roles','audit_logs','warehouse_employees')
 GROUP BY table_name
 ORDER BY table_name;
