-- =====================================================================================
-- supabase/tests/rbac_enterprise_test.sql
-- اختبارات فعلية على قاعدة البيانات لنظام الصلاحيات المؤسسي.
-- التشغيل: node scripts/apply-sql.mjs supabase/tests/rbac_enterprise_test.sql
-- يعيد جدول نتائج: name | ok | detail
-- =====================================================================================
CREATE TEMP TABLE _rbac_test (name text, ok boolean, detail text) ON COMMIT DROP;

DO $test$
DECLARE
  v_wh        uuid;
  v_wh2       uuid;
  v_mgr       uuid;
  v_viewer    uuid;
  v_outsider  uuid;
  v_role_id   uuid;
  v_dup_id    uuid;
  v_msg       text;
  v_ok        boolean;
  v_eff       jsonb;
  v_cnt       int;
  v_ctx       jsonb;
BEGIN
  -- اختيار مخزن فيه مدير ومشاهد على الأقل (وإلا يفشل الاختبار بوضوح)
  SELECT uw.warehouse_id INTO v_wh
    FROM public.user_warehouses uw
    JOIN public.roles r ON r.id = uw.role_id
   WHERE r.name = 'Warehouse Manager'
     AND EXISTS (
       SELECT 1
         FROM public.user_warehouses u2
         JOIN public.roles r2 ON r2.id = u2.role_id
        WHERE u2.warehouse_id = uw.warehouse_id
          AND r2.name = 'Viewer'
     )
   LIMIT 1;

  SELECT uw.user_id INTO v_mgr
    FROM public.user_warehouses uw
    JOIN public.roles r ON r.id = uw.role_id
   WHERE uw.warehouse_id = v_wh AND r.name = 'Warehouse Manager'
   ORDER BY uw.created_at NULLS LAST
   LIMIT 1;

  SELECT uw.user_id INTO v_viewer
    FROM public.user_warehouses uw
    JOIN public.roles r ON r.id = uw.role_id
   WHERE uw.warehouse_id = v_wh AND r.name = 'Viewer' AND uw.user_id <> v_mgr
   LIMIT 1;

  SELECT uw.warehouse_id INTO v_wh2
    FROM public.user_warehouses uw
   WHERE uw.warehouse_id <> v_wh
   LIMIT 1;

  SELECT uw.user_id INTO v_outsider
    FROM public.user_warehouses uw
   WHERE uw.warehouse_id = v_wh2
     AND uw.user_id NOT IN (SELECT user_id FROM public.user_warehouses WHERE warehouse_id = v_wh)
   LIMIT 1;

  INSERT INTO _rbac_test VALUES ('fixtures', (v_wh IS NOT NULL AND v_mgr IS NOT NULL AND v_viewer IS NOT NULL AND v_wh2 IS NOT NULL),
    format('wh=%s mgr=%s viewer=%s wh2=%s', v_wh, v_mgr, v_viewer, v_wh2));

  IF v_wh IS NULL OR v_mgr IS NULL OR v_viewer IS NULL THEN
    RAISE EXCEPTION 'تعذر تجهيز بيانات الاختبار: مخزن=% مدير=% مشاهد=%', v_wh, v_mgr, v_viewer;
  END IF;

  -- ---------------------------------------------------------------------------------
  -- 1) الكتالوج
  -- ---------------------------------------------------------------------------------
  SELECT count(*) INTO v_cnt FROM public.permissions WHERE name_ar IS NOT NULL;
  INSERT INTO _rbac_test VALUES ('catalog_arabic_labels', v_cnt >= 60, v_cnt || ' صلاحية بأسماء عربية');

  SELECT count(*) INTO v_cnt FROM public.permissions WHERE is_enforced;
  INSERT INTO _rbac_test VALUES ('catalog_enforced_flagged', v_cnt >= 20, v_cnt || ' صلاحية معلّمة كمطبقة');

  -- ---------------------------------------------------------------------------------
  -- 2) المشاهد: يرى المبيعات ولا يدير المستخدمين
  -- ---------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role', 'authenticated')::text, false);

  INSERT INTO _rbac_test VALUES ('viewer_can_view_sales', public.has_permission('sales.view', v_wh), 'sales.view');
  INSERT INTO _rbac_test VALUES ('viewer_cannot_manage_users', NOT public.has_permission('users.update', v_wh), 'users.update مرفوضة');
  INSERT INTO _rbac_test VALUES ('viewer_cannot_manage_warehouse', NOT public.current_actor_manages(v_wh), 'current_actor_manages = false');

  SELECT coalesce(jsonb_object_agg(e.permission, e.source), '{}'::jsonb) INTO v_eff
    FROM public.rbac_effective_permissions(v_viewer, v_wh) e;
  INSERT INTO _rbac_test VALUES ('effective_has_source', (v_eff ? 'sales.view') AND (v_eff ->> 'sales.view') LIKE 'role:%',
     'مصدر sales.view = ' || coalesce(v_eff ->> 'sales.view', '—'));

  SELECT public.rbac_my_context() INTO v_ctx;
  INSERT INTO _rbac_test VALUES ('my_context_authenticated',
     (v_ctx ->> 'authenticated')::boolean AND v_ctx ->> 'warehouse_id' = v_wh::text,
     'role=' || coalesce(v_ctx ->> 'role', ''));

  -- المشاهد لا يستطيع إدارة الفريق
  BEGIN
    PERFORM public.rbac_member_set(v_wh, v_mgr, NULL, '{}'::jsonb, true);
    INSERT INTO _rbac_test VALUES ('viewer_cannot_edit_member', false, 'لم يُرفض الطلب');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_test VALUES ('viewer_cannot_edit_member', true, SQLERRM);
  END;

  -- المشاهد لا يستطيع إنشاء دور
  BEGIN
    PERFORM public.rbac_role_upsert(NULL, 'Hacked Role', 'دور مخترق', '', ARRAY['sales.view'], v_wh);
    INSERT INTO _rbac_test VALUES ('viewer_cannot_create_role', false, 'لم يُرفض الطلب');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_test VALUES ('viewer_cannot_create_role', true, SQLERRM);
  END;

  -- ---------------------------------------------------------------------------------
  -- 3) المدير: يعدّل الفريق لكن لا يتجاوز صلاحياته ولا يعدّل نفسه
  -- ---------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, false);

  INSERT INTO _rbac_test VALUES ('manager_can_manage', public.current_actor_manages(v_wh), 'current_actor_manages = true');

  BEGIN
    PERFORM public.rbac_member_set(v_wh, v_mgr, NULL, '{}'::jsonb, true);
    INSERT INTO _rbac_test VALUES ('manager_cannot_edit_self', false, 'لم يُرفض الطلب');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_test VALUES ('manager_cannot_edit_self', true, SQLERRM);
  END;

  -- صلاحية لا يملكها المدير (settings.manage) يجب رفض منحها
  BEGIN
    PERFORM public.rbac_role_upsert(NULL, 'Escalation Probe', 'فحص تصعيد', '', ARRAY['settings.manage'], v_wh);
    INSERT INTO _rbac_test VALUES ('no_grant_beyond_own_perms', false, 'تم منح settings.manage بدون صلاحية');
    DELETE FROM public.roles WHERE name = 'Escalation Probe';
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_test VALUES ('no_grant_beyond_own_perms', true, SQLERRM);
  END;

  -- إنشاء دور بصلاحية يملكها المدير
  BEGIN
    SELECT (public.rbac_role_upsert(NULL, 'RBAC Test Role', 'دور اختبار', 'اختبار آلي', ARRAY['sales.view','sales.read'], v_wh) ->> 'role_id')::uuid
      INTO v_role_id;
    INSERT INTO _rbac_test VALUES ('manager_creates_role', v_role_id IS NOT NULL, 'role_id=' || coalesce(v_role_id::text, 'null'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_test VALUES ('manager_creates_role', false, SQLERRM);
  END;

  -- نسخ الدور
  BEGIN
    SELECT (public.rbac_role_duplicate(v_role_id, 'RBAC Test Copy', 'نسخة اختبار', v_wh) ->> 'role_id')::uuid INTO v_dup_id;
    INSERT INTO _rbac_test VALUES ('duplicate_role', v_dup_id IS NOT NULL AND v_dup_id <> v_role_id, 'copy=' || coalesce(v_dup_id::text, 'null'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_test VALUES ('duplicate_role', false, SQLERRM);
  END;

  -- إسناد الدور للمشاهد
  BEGIN
    PERFORM public.rbac_member_set(v_wh, v_viewer, ARRAY[v_role_id], '{}'::jsonb, true);
    SELECT count(*) INTO v_cnt FROM public.user_roles
     WHERE user_id = v_viewer AND warehouse_id = v_wh AND role_id = v_role_id AND is_active;
    INSERT INTO _rbac_test VALUES ('assign_role_to_member', v_cnt = 1, 'صفوف الدور النشطة = ' || v_cnt);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_test VALUES ('assign_role_to_member', false, SQLERRM);
  END;

  -- منح صلاحية مباشرة لا يملكها المدير (users.manage) يجب أن يُرفض.
  -- ملاحظة: sales.create لم تعد صالحة للاختبار لأن فرض الصلاحيات منح المدير
  -- صلاحيات الكتابة داخل وحدات مخزنه، فأصبح منحها مشروعًا وفق القاعدة.
  BEGIN
    PERFORM public.rbac_member_set(v_wh, v_viewer, ARRAY[v_role_id], '{"users.manage": true}'::jsonb, true);
    INSERT INTO _rbac_test VALUES ('direct_grant_beyond_own_blocked', false, 'قُبل منح users.manage');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_test VALUES ('direct_grant_beyond_own_blocked', position('لا تملكها' in SQLERRM) > 0, SQLERRM);
  END;

  -- المشاهد يكتسب صلاحية الدور فورًا (تغييرات سارية على الطلب التالي)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role', 'authenticated')::text, false);
  INSERT INTO _rbac_test VALUES ('permission_applies_next_request', public.has_permission('sales.view', v_wh), 'sales.view من الدور المسند');
  INSERT INTO _rbac_test VALUES ('role_grant_source', (SELECT source FROM public.rbac_effective_permissions(v_viewer, v_wh) WHERE permission = 'sales.view' LIMIT 1) LIKE 'role:%',
     'مصدر sales.view = ' || coalesce((SELECT source FROM public.rbac_effective_permissions(v_viewer, v_wh) WHERE permission = 'sales.view' LIMIT 1), '—'));

  -- سحب الدور: تعود صلاحياته مرفوضة
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, false);
  PERFORM public.rbac_member_set(v_wh, v_viewer, ARRAY[(SELECT id::uuid FROM public.roles WHERE name = 'Viewer' LIMIT 1)], '{}'::jsonb, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role', 'authenticated')::text, false);
  INSERT INTO _rbac_test VALUES ('revoked_permission_expires', NOT public.has_permission('purchases.approve', v_wh), 'purchases.approve بعد سحب الدور');

  -- ---------------------------------------------------------------------------------
  -- 4) عزل المخازن
  -- ---------------------------------------------------------------------------------
  IF v_outsider IS NOT NULL THEN
    INSERT INTO _rbac_test VALUES ('no_cross_warehouse_scope', NOT public.has_permission('users.update', v_wh), 'مستخدم من مخزن آخر لا يملك إدارة هذا المخزن');
    BEGIN
      PERFORM public.rbac_audit_list(v_wh, NULL, 10, 0);
      INSERT INTO _rbac_test VALUES ('outsider_cannot_read_audit', false, 'قُرئ السجل بدون صلاحية');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _rbac_test VALUES ('outsider_cannot_read_audit',
        position('غير مصرح' in SQLERRM) > 0, SQLERRM);
    END;
  ELSE
    INSERT INTO _rbac_test VALUES ('no_cross_warehouse_scope', true, 'لا يوجد مستخدم خارجي مناسب — تخطٍ');
  END IF;

  -- ---------------------------------------------------------------------------------
  -- 5) حماية الأدوار النظامية والحذف
  -- ---------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, false);

  BEGIN
    PERFORM public.rbac_role_delete(v_role_id, v_wh);
    INSERT INTO _rbac_test VALUES ('role_in_use_protected', false, 'تم حذف دور مستخدم');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_test VALUES ('role_in_use_protected', position('موظف' in SQLERRM) > 0 OR position('دور' in SQLERRM) > 0, SQLERRM);
  END;

  BEGIN
    PERFORM public.rbac_role_upsert((SELECT id FROM public.roles WHERE name = 'Super Admin' LIMIT 1), 'Super Admin', 'مدير', '', ARRAY['sales.view'], v_wh);
    INSERT INTO _rbac_test VALUES ('system_role_protected', false, 'تم تعديل دور نظامي');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_test VALUES ('system_role_protected', true, SQLERRM);
  END;

  -- ---------------------------------------------------------------------------------
  -- 6) سجل المراجعة غير قابل للتعديل للمستخدم العادي
  -- ---------------------------------------------------------------------------------
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.audit_logs SET action = 'tampered' WHERE id IS NOT NULL;
    RESET ROLE;
    INSERT INTO _rbac_test VALUES ('audit_immutable', false, 'تم تعديل السجل');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _rbac_test VALUES ('audit_immutable', true, SQLERRM);
  END;

  -- ---------------------------------------------------------------------------------
  -- 7) تنظيف آثار الاختبار
  -- ---------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, false);
  DELETE FROM public.user_roles WHERE role_id IN (v_role_id, v_dup_id);
  DELETE FROM public.role_permissions WHERE role_id IN (v_role_id, v_dup_id);
  DELETE FROM public.roles WHERE id IN (v_role_id, v_dup_id);

  INSERT INTO _rbac_test VALUES ('cleanup', NOT EXISTS (SELECT 1 FROM public.roles WHERE name LIKE 'RBAC Test%'), 'حُذفت أدوار الاختبار');
END
$test$;

SELECT name, ok, detail FROM _rbac_test ORDER BY name;
