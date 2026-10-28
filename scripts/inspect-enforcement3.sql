-- نظرة واحدة مجمّعة (الـ API يعيد نتيجة العبارة الأخيرة فقط)
SELECT jsonb_pretty(jsonb_object_agg(k, v)) FROM (
  SELECT 'modules' AS k,
         (SELECT jsonb_agg(jsonb_build_object('m', m, 'n', n)) FROM (
             SELECT split_part(name, '.', 1) AS m, count(*) AS n
               FROM public.permissions GROUP BY 1) q) AS v
  UNION ALL
  SELECT 'roles',
         (SELECT jsonb_agg(jsonb_build_object('name', r.name, 'system', r.is_system_role)) FROM public.roles r)
  UNION ALL
  SELECT 'role_perms',
         (SELECT jsonb_object_agg(r.name, coalesce(p.list, '[]'::jsonb))
            FROM public.roles r
            LEFT JOIN (SELECT role_id, jsonb_agg(permission ORDER BY permission) AS list
                         FROM public.role_permissions GROUP BY 1) p ON p.role_id = r.id)
  UNION ALL
  SELECT 'tables_with_warehouse_col',
         (SELECT jsonb_agg(table_name) FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'warehouse_id')
) s;
