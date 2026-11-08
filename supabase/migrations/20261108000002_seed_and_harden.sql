-- ============================================================================
--  0002 — البذور والتشديد، قابلة للتشغيل المتكرر (Idempotent).
--
--  الهجرة 0001 لمرة واحدة: تُنشئ المخطط وتملأ الكتالوج. إعادة تشغيلها تفشل
--  بـ "already exists" — وهذا سلوك مقصود وليس عيبًا. لكن هناك عمليات يجب أن
--  تُعاد بأمان: مزامنة الأدوار مع كتالوج الصلاحيات بعد أي إضافة عليه،
--  وتزويد المخازن التي أُنشئت بعد الهجرة، وإصلاح الامتيازات بعد أي
--  CREATE OR REPLACE FUNCTION يعيد فتح EXECUTE لـPUBLIC.
--
--  هذا الملف يفعل ذلك. يُشغَّل بعد كل هجرة وكل إصلاح، وأي عدد من المرات:
--    psql ... -f supabase/migrations/20261108000002_seed_and_harden.sql
--
--  القيد: يُشغَّل بدور يملك BYPASSRLS (postgres) مثل مسار الهجرات نفسه؛
--  لأن دوال التطبيق والجداول كلها FORCE RLS وبلا سياسة لأي دور آخر.
-- ============================================================================

-- ---------------------------------------------------------------- 1) الخطط
-- لا تُلمس خصائص الخطة إن كانت موجودة: قد يكون المشغّل عدّلها.
INSERT INTO platform.plans (code, name, monthly_price, features)
SELECT 'free', 'المجاني', 0, '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM platform.plans WHERE code = 'free');

-- ------------------------------------- 2) مزامنة البذور لكل مخزن (لا الناقص فقط)
-- المشكلة التي لا تحلها الهجرة الأولى: صلاحية تُضاف إلى الكتالوج بعد إنشاء
-- المخازن تبقى بلا مالك — الكتالوج يُحدَّث، والأدوار لا. ولذلك يُستدعى
-- seed_tenant_roles هنا لكل مخزن لا للناقص فقط: الدالة تضيف ما ينقص ولا تمسح
-- تخصيص المشغّل، لأن كل إدراجاتها ON CONFLICT DO NOTHING.
--
-- والمخزن الذي فشل تزويده يبقى بلا أدوار ولا رسالة خطأ — أسوأ أنواع الأعطال.
DO $$
DECLARE
  t record;
  v_roles int;
  v_links int;
  v_missing int;
  v_leaked int;
BEGIN
  FOR t IN SELECT tn.id, tn.slug FROM public.tenants tn ORDER BY tn.slug
  LOOP
    PERFORM app.seed_tenant_roles(t.id);

    SELECT count(*) INTO v_roles
    FROM public.roles WHERE tenant_id = t.id AND is_system;

    IF v_roles <> 10 THEN
      RAISE EXCEPTION 'SEED_INCOMPLETE: المخزن % لديه % أدوار نظام بدل 10', t.slug, v_roles
        USING ERRCODE = '23514';
    END IF;

    -- صلاحية منصة في دور مخزن = تسريب أفقي؛ تُزال ثم يُتحقق من الصفر.
    DELETE FROM public.role_permissions rp
    USING public.roles r, public.permissions p
    WHERE rp.tenant_id = t.id
      AND r.tenant_id = t.id AND r.id = rp.role_id
      AND p.code = rp.permission AND p.module = 'platform';
    GET DIAGNOSTICS v_leaked = ROW_COUNT;

    IF v_leaked > 0 THEN
      RAISE WARNING 'PLATFORM_LEAK_CLEANED: المخزن % كان يحمل % صلاحية منصة', t.slug, v_leaked;
    END IF;

    -- المالك يجب أن يغطي كل صلاحيات المخزن، بما فيها ما أُضيف بعد التأسيس.
    SELECT count(*) INTO v_missing
    FROM public.permissions p
    WHERE p.module <> 'platform'
      AND NOT EXISTS (
        SELECT 1
        FROM public.role_permissions rp
        JOIN public.roles r ON r.id = rp.role_id AND r.tenant_id = rp.tenant_id
        WHERE rp.tenant_id = t.id AND r.code = 'owner' AND rp.permission = p.code
      );

    IF v_missing > 0 THEN
      RAISE EXCEPTION 'OWNER_COVERAGE_GAP: المخزن % ينقص المالك % صلاحية', t.slug, v_missing
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*) INTO v_links
    FROM public.role_permissions WHERE tenant_id = t.id;

    RAISE NOTICE 'SYNCED tenant=% roles=% links=%', t.slug, v_roles, v_links;
  END LOOP;
END $$;

-- ------------------------------- 3) إعادة تشديد الامتيازات (تُعيد ما فُتح)
-- EXECUTE: يُمنح لـPUBLIC افتراضيًا على كل دالة جديدة/مُعاد إنشائها.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO slamtak_app;
GRANT EXECUTE ON FUNCTION app.current_user_id() TO slamtak_app;
GRANT EXECUTE ON FUNCTION app.current_warehouse_id() TO slamtak_app;
GRANT EXECUTE ON FUNCTION app.has_permission(text) TO slamtak_app;
GRANT EXECUTE ON FUNCTION app.apply_stock_movement() TO slamtak_app;
GRANT EXECUTE ON FUNCTION app.next_document_number(uuid, text, int) TO slamtak_app;
GRANT EXECUTE ON FUNCTION app.record_login_attempt(text, inet, boolean, text) TO slamtak_app;

-- الكتالوج العام للقراءة فقط، والسجلات لا تُحذف، والأرصدة لا تُكتب مباشرة.
REVOKE INSERT, UPDATE, DELETE ON public.permissions FROM slamtak_app;
REVOKE DELETE ON public.stock_movements, public.audit_logs, public.prices_history FROM slamtak_app;
REVOKE UPDATE, DELETE ON public.stock_batches FROM slamtak_app;
REVOKE ALL ON SCHEMA platform FROM slamtak_app;

-- ------------------------------------------------------- 4) حارس النهاية
-- الفحص الكامل في scripts/check-security-invariants.sql؛ هنا نمسك الثغرتين
-- اللتين يعيدهما أي إصلاح طارئ على الدوال.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, '{}'::aclitem[])) a
  WHERE ns.nspname = 'app' AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';

  IF n <> 0 THEN
    RAISE EXCEPTION 'PUBLIC_EXECUTE_OPEN: % دالة في app ما زالت ممنوحة لـPUBLIC', n
      USING ERRCODE = '42501';
  END IF;
END $$;

-- --------------------------------------------------------------- 5) التحقق
-- شغّل بعد هذا الملف:
--   npm run check:security
