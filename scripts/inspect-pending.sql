-- ما تبقّى غير مفروض + الجداول المرشّحة لكل وحدة
SELECT jsonb_pretty(jsonb_object_agg(k, v)) FROM (
  SELECT 'pending' AS k,
         (SELECT jsonb_agg(jsonb_build_object('module', m, 'perms', perms))
            FROM (SELECT split_part(name,'.',1) AS m, jsonb_agg(name ORDER BY name) AS perms
                    FROM public.permissions WHERE NOT is_enforced GROUP BY 1) q) AS v
  UNION ALL
  SELECT 'tables',
         (SELECT jsonb_agg(relname ORDER BY relname)
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r') AS v
  UNION ALL
  SELECT 'warehouse_scoped',
         (SELECT jsonb_agg(table_name ORDER BY table_name)
            FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'warehouse_id') AS v
) s;
