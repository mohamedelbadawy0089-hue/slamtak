SELECT table_name, string_agg(column_name || ':' || data_type, ', ' ORDER BY ordinal_position) AS cols
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name IN ('employees','employee_salaries','payroll_items','payroll_runs')
 GROUP BY table_name;
