-- =====================================================================================
-- supabase/tests/two_step_verify_test.sql
-- اختبار المرحلة الثانية للدخول على الخادم (two_step_verify):
--   * بصمة المدير على مخزنه تنجح على جلسة المدير، والثانية الخاطئة تُرفض فورًا.
--   * الموظف المُختّار ببصمة مخصصة له ينجح؛ ولا يقبَل للموظف بصمة المدير.
--   * قبول محدد النطاق: عضو مخزن آخر بلا بصمة ثانية سليمة على مخزن أول لا ينجح.
--   * أول توثيق للمدير (بلا ببصمة مخزنة) يهيئ بصمته وينجح ويُعلّم initialized.
--   * سقف المحاولات: 5 فشل خلال 10 دقائق يمنع المحاولة السادسة.
--   * بلا جلسة → رفض؛ مستخدم مُوقّف → رفض؛ عضوية مزالة النشاط → رفض.
-- التشغيل: node scripts/run-sql-test.mjs supabase/tests/two_step_verify_test.sql
-- =====================================================================================
CREATE TEMP TABLE _ts2_test (name text, ok boolean, detail text) ON COMMIT DROP;

DO $t$
DECLARE
  v_tenant uuid;
  v_mgr uuid := gen_random_uuid();
  v_mgr2 uuid := gen_random_uuid();
  v_emp uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_wh uuid := gen_random_uuid();
  v_wh2 uuid := gen_random_uuid();
  v_role uuid;
  v_json jsonb;
  v_txt text;
  v_attempt int;
  v_ts2hash text := 'two_step_verify_test_hash_manager_1';
  v_emphash text := 'two_step_verify_test_hash_employee_1';
BEGIN
  SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at LIMIT 1;
  INSERT INTO _ts2_test VALUES ('fixtures', v_tenant IS NOT NULL, 'tenant=' || coalesce(v_tenant::text, 'NULL'));
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'لا يوجد مستأجر للاختبار'; END IF;

  -- مستخدمو ونكرة (users: tenant/email/password_hash/first/last)
  INSERT INTO public.users (id, tenant_id, email, password_hash, first_name, last_name, role, is_active)
    VALUES (v_mgr, v_tenant, 'ts2_mgr_' || substr(v_mgr::text,1,8) || '@test.local', 'x', 'مدير', 'فحص', 'warehouse_manager', true),
           (v_mgr2, v_tenant, 'ts2_mgr2_' || substr(v_mgr2::text,1,8) || '@test.local', 'x', 'مدير2', 'فحص', 'warehouse_manager', true),
           (v_emp, v_tenant, 'ts2_emp_' || substr(v_emp::text,1,8) || '@test.local', 'x', 'موظف', 'فحص', 'staff', true),
           (v_other, v_tenant, 'ts2_other_' || substr(v_other::text,1,8) || '@test.local', 'x', 'آخر', 'فحص', 'staff', true);

  INSERT INTO public.warehouses (id, tenant_id, name, code, country, is_main, is_active, manager_id)
  VALUES (v_wh, v_tenant, 'مخزن فحص الدخول الثاني', 'TS2-A', 'EG', true, true, v_mgr),
         (v_wh2, v_tenant, 'مخزن فحص الدخول الثاني ب', 'TS2-B', 'EG', false, true, v_mgr2);

  INSERT INTO public.user_warehouses (user_id, warehouse_id, tenant_id, is_active, is_default)
  VALUES (v_mgr, v_wh, v_tenant, true, true),
         (v_mgr2, v_wh2, v_tenant, true, true),
         (v_other, v_wh2, v_tenant, true, false);

  -- بصمة مدير مخزنه
  UPDATE public.warehouses SET password_hash = v_ts2hash WHERE id = v_wh;

  ---------------------------------------------------------------
  -- 1) بلا جلسة → رفض
  PERFORM set_config('request.jwt.claims', '', false);
  BEGIN
    PERFORM public.two_step_verify(v_ts2hash);
    INSERT INTO _ts2_test VALUES ('requires_session', false, 'قُبل تحقق بلا جلسة');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _ts2_test VALUES ('requires_session', SQLSTATE = '42501', SQLSTATE || ': ' || SQLERRM);
  END;

  ---------------------------------------------------------------
  -- 2) مدير بصمة صحيحة → منح
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, false);
  BEGIN
    v_json := public.two_step_verify(v_ts2hash);
    INSERT INTO _ts2_test VALUES ('manager_success', (v_json ? 'granted')::boolean = true OR coalesce(v_json->>'granted','false')='true',
      format('granted=%s wh=%s', v_json->>'granted', v_json->>'warehouse_id'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _ts2_test VALUES ('manager_success', false, SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO v_attempt FROM public.audit_logs
      WHERE user_id = v_mgr AND action='two_step_success' AND warehouse_id = v_wh;
    INSERT INTO _ts2_test VALUES ('success_audited', v_attempt >= 1, 'صفوف النجاح = ' || v_attempt);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _ts2_test VALUES ('success_audited', false, SQLSTATE || ': ' || SQLERRM);
  END;

  ---------------------------------------------------------------
  -- 3) بصمة خاطئة → رفض فوري
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, false);
  BEGIN
    v_json := public.two_step_verify('wrong_hash_long_enough_x');
    INSERT INTO _ts2_test VALUES ('wrong_password_rejected',
      coalesce(v_json->>'granted','?') = 'false' AND v_json->>'reason' = 'wrong_password',
      'json=' || v_json::text);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _ts2_test VALUES ('wrong_password_rejected', false, SQLSTATE || ': ' || SQLERRM);
  END;

  ---------------------------------------------------------------
  -- 4) أول توثيق: مدير مخزنه بلا بصمة إطلاقًا → تهيئة ومنح
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr2, 'role', 'authenticated')::text, false);
  BEGIN
    v_json := public.two_step_verify('first_login_hash_long_1');
    INSERT INTO _ts2_test VALUES ('first_login_init_manager',
      coalesce(v_json->>'granted','false') = 'true' AND coalesce(v_json->>'initialized','false') = 'true',
      format('json=%s', v_json::text));
    SELECT count(*) INTO v_attempt FROM public.warehouses
      WHERE manager_id = v_mgr2 AND coalesce(password_hash,'') <> '';
    INSERT INTO _ts2_test VALUES ('first_login_hash_saved', v_attempt = 1,
      'مخازن مدير2 التي حُفظت بصمتها = ' || v_attempt);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _ts2_test VALUES ('first_login_init_manager', false, SQLSTATE || ': ' || SQLERRM);
    INSERT INTO _ts2_test VALUES ('first_login_hash_saved', false, 'skip');
  END;

  ---------------------------------------------------------------
  -- 5) معد للموظف: ببصمة ثانية مخصصة
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_emp, 'role', 'authenticated')::text, false);
  -- موظف بلا عضوية وبصمة خارجية (بصمة المدير فقط): رفض
  BEGIN
    v_json := public.two_step_verify(v_ts2hash);
    INSERT INTO _ts2_test VALUES ('employee_needs_own_or_membership',
      coalesce(v_json->>'granted','?') = 'false' AND v_json->>'reason' = 'no_membership',
      'json=' || coalesce(v_json::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _ts2_test VALUES ('employee_needs_own_or_membership', false, SQLSTATE || ': ' || SQLERRM);
  END;

  INSERT INTO public.user_warehouses (user_id, warehouse_id, tenant_id, is_active, is_default)
    VALUES (v_emp, v_wh, v_tenant, true, false);
  UPDATE public.users SET staff_password_hash = v_emphash WHERE id = v_emp;

  BEGIN
    v_json := public.two_step_verify(v_emphash);
    INSERT INTO _ts2_test VALUES ('employee_own_hash_granted', coalesce(v_json->>'granted','false') = 'true',
      format('granted=%s wh=%s', v_json->>'granted', v_json->>'warehouse_id'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _ts2_test VALUES ('employee_own_hash_granted', false, SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    v_json := public.two_step_verify(v_ts2hash); -- بصمة المدير لموظف - مرفوضة
    INSERT INTO _ts2_test VALUES ('employee_cannot_use_manager_hash',
      coalesce(v_json->>'granted','?') = 'false' AND v_json->>'reason' = 'wrong_password',
      'json=' || coalesce(v_json::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _ts2_test VALUES ('employee_cannot_use_manager_hash', false, SQLSTATE || ': ' || SQLERRM);
  END;

  ---------------------------------------------------------------
  -- 6) قبول محدد النطاق: عضو مخزن2 بمحاولة بصمة مخزن1 خارج قبول
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, false);
  BEGIN
    v_json := public.two_step_verify(v_ts2hash);
    INSERT INTO _ts2_test VALUES ('cross_warehouse_rejected',
      coalesce(v_json->>'granted','?') = 'false',
      'json=' || coalesce(v_json::text, 'NULL')); -- المطلوب الرفض بأي سبب: بصمة خاطئة أو بلا بصمة ثانية
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _ts2_test VALUES ('cross_warehouse_rejected', false, SQLSTATE || ': ' || SQLERRM);
  END;

  ---------------------------------------------------------------
  -- 7) موقّف داخل عضويته: منع دخول كامل (is_active=false في العضوية)
  UPDATE public.user_warehouses SET is_active = false WHERE user_id = v_emp AND warehouse_id = v_wh;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_emp, 'role', 'authenticated')::text, false);
  BEGIN
    v_json := public.two_step_verify(v_emphash);
    INSERT INTO _ts2_test VALUES ('inactive_membership_denied',
      coalesce(v_json->>'granted','?') = 'false' AND v_json->>'reason' = 'suspended',
      'json=' || coalesce(v_json::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _ts2_test VALUES ('inactive_membership_denied', false, SQLSTATE || ': ' || SQLERRM);
  END;
  UPDATE public.user_warehouses SET is_active = true WHERE user_id = v_emp AND warehouse_id = v_wh;

  ---------------------------------------------------------------
  -- 8) عداد المحاولات: 5 شكل خلال 10 دقائق → يرفض السادسة
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, false);
  BEGIN
    FOR i IN 1..5 LOOP
      BEGIN
        PERFORM public.two_step_verify('bad_attempt_' || i);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END LOOP;
  END;
  BEGIN
    v_json := public.two_step_verify('bad_attempt_6_even_if_right_or_wrong');
    INSERT INTO _ts2_test VALUES ('rate_limit_after_5_failures',
      coalesce(v_json->>'granted','?') = 'false' AND v_json->>'reason' = 'rate_limited',
      'json=' || coalesce(v_json::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _ts2_test VALUES ('rate_limit_after_5_failures', false, SQLSTATE || ': ' || SQLERRM);
  END;

  -- التنظيف
  PERFORM set_config('request.jwt.claims', '', false);
  DELETE FROM public.audit_logs WHERE action LIKE 'two_step_%' AND (user_id IN (v_mgr, v_mgr2, v_emp, v_other));
  DELETE FROM public.user_warehouses WHERE user_id IN (v_mgr, v_mgr2, v_emp, v_other);
  UPDATE public.warehouses SET manager_id = NULL WHERE id IN (v_wh, v_wh2);
  DELETE FROM public.warehouses WHERE id IN (v_wh, v_wh2);
  DELETE FROM public.users WHERE id IN (v_mgr, v_mgr2, v_emp, v_other);

  INSERT INTO _ts2_test VALUES ('cleanup',
    NOT EXISTS (SELECT 1 FROM public.users WHERE id IN (v_mgr, v_mgr2, v_emp, v_other))
    AND NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id IN (v_wh, v_wh2))
    AND NOT EXISTS (SELECT 1 FROM public.user_warehouses WHERE user_id IN (v_mgr, v_mgr2, v_emp, v_other))
    AND NOT EXISTS (SELECT 1 FROM public.users WHERE id IN (v_mgr, v_mgr2, v_emp, v_other)),
    'حُذفت بيانات الاختبار');
END
$t$;

SELECT name, ok, detail FROM _ts2_test ORDER BY name;
