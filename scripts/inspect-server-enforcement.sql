-- جرد: لكل جدول عام — RLS مفعّل؟ عدد السياسات؟ عدد مُشغّلات rbac_enforce؟
SELECT t.relname AS table,
       t.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policy p
         WHERE p.polrelid = t.oid) AS total_policies,
       (SELECT count(*) FROM pg_policy p
         WHERE p.polrelid = t.oid AND p.polcmd IN ('I','U','D','*')) AS write_policies,
       (SELECT count(DISTINCT g.tgname) FROM pg_trigger g
         WHERE g.tgrelid = t.oid AND g.tgname LIKE 'rbac_enforce%' AND NOT g.tgisinternal) AS rbac_triggers
FROM pg_class t
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' AND t.relkind IN ('r','p')
ORDER BY t.relname;
