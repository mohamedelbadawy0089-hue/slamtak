SELECT c.table_name,
       string_agg(c.column_name || ':' || c.data_type, ', ' ORDER BY c.ordinal_position) AS cols
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
 WHERE c.table_schema = 'public'
   AND (c.table_name ILIKE '%employ%' OR c.table_name ILIKE '%staff%' OR c.table_name ILIKE '%salary%' OR c.table_name ILIKE '%salary%')
 GROUP BY c.table_name
 ORDER BY c.table_name;
