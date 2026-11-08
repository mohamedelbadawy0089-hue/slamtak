-- ============================================================================
--  فحص ثوابت الأمان — استعلام واحد، للقراءة فقط، يُنتج جدول PASS/FAIL.
--  يُشغَّل بعد كل هجرة، وقبل أي نشر. أي صف FAIL = تراجع أمني يجب إيقافه.
--  المرجع: docs/architecture/22-rls-and-isolation-tests.md §1 + 21 §1.
--  التشغيل: node scripts/check-security-invariants.mjs   (أو الصق الملف في SQL Editor)
-- ============================================================================
SELECT v.check_name, v.expected, v.actual,
       CASE WHEN v.expected = v.actual THEN 'PASS' ELSE 'FAIL' END AS result,
       v.note
FROM (VALUES
  -- ------------------------------------------------------------------ الأدوار
  ('أدوار المنصة الأربعة موجودة', '4',
   (SELECT count(*)::text FROM pg_roles
     WHERE rolname IN ('slamtak_owner','slamtak_app','slamtak_platform','slamtak_ops')),
   'غياب دور = مسار كامل معطّل'),

  ('كل الأدوار مشدّدة (بلا LOGIN/BYPASSRLS/SUPERUSER)', '4',
   (SELECT count(*)::text FROM pg_roles
     WHERE rolname IN ('slamtak_owner','slamtak_app','slamtak_platform','slamtak_ops')
       AND NOT rolcanlogin AND NOT rolbypassrls AND NOT rolsuper
       AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication),
   'BYPASSRLS على دور تطبيقي يُلغي كل العزل'),

  -- ------------------------------------------------------------- عدّ الكتالوج
  ('جداول public', '39',
   (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'),
   'انحراف العدد يعني هجرة ناقصة أو جدولًا أُضيف بلا سياسة'),

  ('جداول platform', '4',
   (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform' AND c.relkind = 'r'),
   'خطط/اشتراكات/فواتير المنصة'),

  ('عدد السياسات', '44',
   (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public'),
   'حذف سياسة سهوًا = جدول مفتوح أو مغلق بالكامل'),

  ('صفوف permissions', '67',
   (SELECT count(*)::text FROM public.permissions),
   'كتالوج الصلاحيات مرجع RBAC'),

  ('صفوف platform.plans', '1',
   (SELECT count(*)::text FROM platform.plans),
   'خطة free وحدها في النسخة الحالية'),

  ('دوال مخطط app', '12',
   (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app'),
   'دوال السياق + الحركات + الترقيم + التحقق'),

  ('مشغّلات حماية المخزن', '34',
   (SELECT count(*)::text FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal AND n.nspname = 'public' AND t.tgname ILIKE '%tenant%'),
   'حارس tenant_id على الجداول المرتبطة'),

  -- ------------------------------------------------------------------- RLS
  ('جداول عليها RLS مفعّلة', '38',
   (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
       AND c.relname <> 'permissions'),
   'كل جدول تجاري محمي؛ permissions كتالوج عام للقراءة فقط'),

  ('جداول عليها FORCE RLS', '38',
   (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity
       AND c.relname <> 'permissions'),
   'بدون FORCE يرى المالك كل المخازن ويسقط العزل'),

  ('جداول بلا RLS أو بلا FORCE (غير permissions)', '0',
   (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
       AND c.relname <> 'permissions'),
   'جدول واحد بلا FORCE يكفي لتعطيل كل الاختبارات'),

  ('جداول بمخزن بلا أي سياسة', '0',
   (SELECT count(*)::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
       AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)),
   'Fail closed يعني صفر صفوف، وهو أسوأ من خطأ صريح'),

  ('سياسات متساهمة بـ true على جداول المخازن', '0',
   (SELECT count(*)::text FROM pg_policies p
      JOIN pg_class c ON c.relname = p.tablename
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     WHERE p.schemaname = 'public'
       AND (coalesce(p.qual,'') = 'true' OR coalesce(p.with_check,'') = 'true')
       AND EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)),
   'سياسة true تُبطل العزل بصمت'),

  ('استثناء permissions_read_all للكتالوج العام', '1',
   (SELECT count(*)::text FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'permissions'
       AND policyname = 'permissions_read_all' AND qual = 'true'),
   'الاستثناء الوحيد المسموح: كتالوج بلا بيانات مخزن'),

  ('سياسة التدقيق RESTRICTIVE', '1',
   (SELECT count(*)::text FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relname = 'audit_logs'
       AND p.polname = 'audit_write_requires_permission' AND NOT p.polpermissive),
   'PERMISSIVE تُجمع بـ OR مع tenant_append فتُلغي شرط الصلاحية'),

  -- ------------------------------------------------------- ACL: EXECUTE/عام
  ('EXECUTE ممنوح لـ PUBLIC على دوال app', '0',
   (SELECT count(*)::text FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, '{}'::aclitem[])) a
     WHERE n.nspname = 'app' AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'),
   'الافتراضي في PostgreSQL يفتح كل دالة على كل دور، ومنها anon عبر PostgREST'),

  ('منح seed_tenant_roles للتطبيق أو المنصة', '0',
   (SELECT count(*)::text FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, '{}'::aclitem[])) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname = 'app' AND p.proname = 'seed_tenant_roles'
       AND r.rolname IN ('slamtak_app','slamtak_platform')),
   'التزويد لدور الهجرة فقط؛ المنصة بلا USAGE على app عمدًا'),

  -- --------------------------------------------------------- ACL: المنصة/التشغيل
  ('امتيازات slamtak_platform على جداول public', '0',
   (SELECT count(*)::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND r.rolname = 'slamtak_platform'),
   'لوحة المنصة لا ترى بيانات أي مخزن'),

  ('USAGE لـ slamtak_platform على app', '0',
   (SELECT count(*)::text FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, '{}'::aclitem[])) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname = 'app' AND r.rolname = 'slamtak_platform' AND a.privilege_type = 'USAGE'),
   'USAGE على app يفتح استدعاء دوال التطبيق كلها'),

  ('USAGE لـ slamtak_platform على platform', '1',
   (SELECT count(*)::text FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, '{}'::aclitem[])) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname = 'platform' AND r.rolname = 'slamtak_platform' AND a.privilege_type = 'USAGE'),
   'الوصول الوحيد المسموح للمنصة'),

  ('DELETE لـ slamtak_platform على جداول platform', '0',
   (SELECT count(*)::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname = 'platform' AND c.relkind = 'r'
       AND r.rolname = 'slamtak_platform' AND a.privilege_type = 'DELETE'),
   'سجلات المنصة والاشتراكات لا تُحذف'),

  ('امتيازات slamtak_ops على جداول public', '0',
   (SELECT count(*)::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND r.rolname = 'slamtak_ops'),
   'الدور التشغيلي يرى العالم عبر دوال التحقق فقط'),

  -- ------------------------------------------------------------ ACL: التطبيق
  ('UPDATE لـ slamtak_app على stock_batches', '0',
   (SELECT count(*)::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname = 'public' AND c.relname = 'stock_batches'
       AND r.rolname = 'slamtak_app' AND a.privilege_type = 'UPDATE'),
   'الأرصدة تُعدَّل عبر الحركات فقط، لا بكتابة مباشرة'),

  ('DELETE لـ slamtak_app على الجداول append-only', '0',
   (SELECT count(*)::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname = 'public'
       AND c.relname IN ('stock_movements','audit_logs','prices_history')
       AND r.rolname = 'slamtak_app' AND a.privilege_type = 'DELETE'),
   'السجل التاريخي لا يُحذف حتى من التطبيق'),

  ('كتابة slamtak_app على كتالوج permissions', '0',
   (SELECT count(*)::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname = 'public' AND c.relname = 'permissions'
       AND r.rolname = 'slamtak_app' AND a.privilege_type IN ('INSERT','UPDATE','DELETE')),
   'التطبيق يقرأ الكتالوج ولا يعيد كتابة صلاحياته'),

  ('امتيازات slamtak_app على مخطط platform', '0',
   (SELECT count(*)::text FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, '{}'::aclitem[])) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname = 'platform' AND r.rolname = 'slamtak_app'),
   'عزل المنصة عن وقت التشغيل'),

  ('USAGE لـ slamtak_app على public و app', '2',
   (SELECT count(*)::text FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, '{}'::aclitem[])) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname IN ('public','app') AND r.rolname = 'slamtak_app' AND a.privilege_type = 'USAGE'),
   'المخططَان الوحيدان اللذان يحتاجهما التطبيق'),

  ('امتيازات slamtak_owner على المخططات الثلاثة', '6',
   (SELECT count(*)::text FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, '{}'::aclitem[])) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname IN ('public','app','platform') AND r.rolname = 'slamtak_owner'
       AND a.privilege_type IN ('USAGE','CREATE')),
   'دور الهجرة يحتاج DDL على المخططات الثلاثة'),

  -- ------------------------------------------------ تغطية منح التطبيق على الجداول
  ('SELECT لـ slamtak_app على جداول public', '39',
   (SELECT count(DISTINCT c.oid)::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND r.rolname = 'slamtak_app' AND a.privilege_type = 'SELECT'),
   'كل جدول يجب أن يُقرأ وفق سياساته'),

  ('INSERT لـ slamtak_app على جداول public', '38',
   (SELECT count(DISTINCT c.oid)::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND r.rolname = 'slamtak_app' AND a.privilege_type = 'INSERT'),
   'permissions استثناء: كتالوج للقراءة فقط'),

  ('UPDATE لـ slamtak_app على جداول public', '36',
   (SELECT count(DISTINCT c.oid)::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND r.rolname = 'slamtak_app' AND a.privilege_type = 'UPDATE'),
   'أقل من INSERT: الأرصدة والسجلات وpermissions بلا تعديل'),

  ('DELETE لـ slamtak_app على جداول public', '34',
   (SELECT count(DISTINCT c.oid)::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND r.rolname = 'slamtak_app' AND a.privilege_type = 'DELETE'),
   'أقل من UPDATE: خمسة جداول append-only')
) AS v(check_name, expected, actual, note)
ORDER BY (v.expected = v.actual), v.check_name;
