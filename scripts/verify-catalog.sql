-- تحقق سريع: ما تعرضه المصفوفة فعلاً بعد تقييد الكتالوج
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT user_id FROM public.user_warehouses ORDER BY created_at NULLS LAST LIMIT 1),
                    'role', 'authenticated')::text, false);

SELECT jsonb_array_length(public.rbac_catalog()) AS modules_shown,
       (SELECT coalesce(sum(jsonb_array_length(g -> 'actions')), 0)
          FROM jsonb_array_elements(public.rbac_catalog()) g) AS actions_shown,
       public.rbac_catalog_stats() AS stats;
