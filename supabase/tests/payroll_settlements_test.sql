-- =====================================================================================
-- supabase/tests/payroll_settlements_test.sql
-- اختبار فعلي لتسويات الرواتب الموثقة: الأثر على صافي المسير، رفض الحالات والصلاحيات
-- والمبالغ والأسباب غير الصالحة، منع الكتابة المباشرة، ثبات التسوية، سجل التدقيق،
-- وعزل القراءة بين الأدوار.
-- التشغيل: node scripts/run-sql-test.mjs supabase/tests/payroll_settlements_test.sql
-- =====================================================================================
CREATE TEMP TABLE _settle_test (name text, ok boolean, detail text) ON COMMIT DROP;

DO $t$
DECLARE
  v_wh uuid; v_tenant uuid; v_mgr uuid;
  v_viewer uuid := gen_random_uuid();
  v_sales uuid := gen_random_uuid();
  v_role_v uuid; v_role_s uuid;
  v_emp uuid := gen_random_uuid();
  v_run uuid := gen_random_uuid();
  v_run_draft uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_item_net numeric;
  v_gross numeric; v_ded numeric; v_net numeric;
  v_cnt int; v_txt text; v_json jsonb; v_settle uuid;
BEGIN
  SELECT uw.warehouse_id, uw.tenant_id, uw.user_id INTO v_wh, v_tenant, v_mgr
    FROM public.user_warehouses uw JOIN public.roles r ON r.id = uw.role_id
   WHERE r.name = 'Warehouse Manager' ORDER BY uw.created_at NULLS LAST LIMIT 1;

  INSERT INTO _settle_test VALUES ('fixtures', v_wh IS NOT NULL AND v_mgr IS NOT NULL,
    format('wh=%s tenant=%s', v_wh, v_tenant));
  IF v_wh IS NULL OR v_mgr IS NULL THEN RAISE EXCEPTION 'تعذر تجهيز بيانات الاختبار'; END IF;

  INSERT INTO public.warehouse_employees (id, tenant_id, warehouse_id, user_id, full_name, username, login_email, is_active)
  VALUES (v_emp, v_tenant, v_wh, gen_random_uuid(), 'موظف تسوية اختبار', 'settle_test_' || substr(v_emp::text, 1, 8),
          'settle_test_' || substr(v_emp::text, 1, 8) || '@test.local', true);

  PERFORM set_config('request.jwt.claims', '', false);
  INSERT INTO public.payroll_runs (id, tenant_id, warehouse_id, period_start, period_end, status)
  VALUES (v_run, v_tenant, v_wh, current_date - 60, current_date - 31, 'draft'),
         (v_run_draft, v_tenant, v_wh, current_date - 30, current_date - 1, 'draft');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, false);
  INSERT INTO public.payroll_items (id, payroll_run_id, employee_id, base_salary, allowances, deductions)
  VALUES (v_item, v_run, v_emp, 1000, 100, 0);
  SELECT net_salary INTO v_item_net FROM public.payroll_items WHERE id = v_item;
  UPDATE public.payroll_runs SET status = 'approved' WHERE id = v_run;
  SELECT total_net INTO v_net FROM public.payroll_runs WHERE id = v_run;
  INSERT INTO _settle_test VALUES ('approved_baseline', v_net = v_item_net,
    format('صافي البنود=%s صافي المسير=%s', v_item_net, v_net));

  -- 1) مكافأة: تزيد صافي المسير بقيمتها
  BEGIN
    v_json := public.payroll_run_settle(v_run, 200, 'مكافأة إنجاز موثقة', v_emp, NULL);
    v_settle := (v_json ->> 'settlement_id')::uuid;
    SELECT total_net INTO v_net FROM public.payroll_runs WHERE id = v_run;
    INSERT INTO _settle_test VALUES ('bonus_applied',
      (v_json ->> 'kind') = 'bonus' AND v_net = v_item_net + 200 AND (v_json ->> 'total_net')::numeric = v_net,
      format('kind=%s net=%s', v_json ->> 'kind', v_net));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _settle_test VALUES ('bonus_applied', false, SQLSTATE || ': ' || SQLERRM);
  END;

  -- 2) خصم: ينقص صافي المسير
  BEGIN
    v_json := public.payroll_run_settle(v_run, -50, 'خصم جزاء تأخير موثق');
    SELECT total_net INTO v_net FROM public.payroll_runs WHERE id = v_run;
    INSERT INTO _settle_test VALUES ('deduction_applied',
      (v_json ->> 'kind') = 'deduction' AND v_net = v_item_net + 150,
      format('kind=%s net=%s', v_json ->> 'kind', v_net));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _settle_test VALUES ('deduction_applied', false, SQLSTATE || ': ' || SQLERRM);
  END;

  -- 3) تصحيح: مبلغ موقّع مع نوع صريح
  BEGIN
    v_json := public.payroll_run_settle(v_run, -25.5, 'تصحيح فرق ساعات إضافية', NULL, 'correction');
    SELECT total_net INTO v_net FROM public.payroll_runs WHERE id = v_run;
    INSERT INTO _settle_test VALUES ('correction_applied',
      (v_json ->> 'kind') = 'correction' AND v_net = v_item_net + 124.5,
      format('kind=%s net=%s', v_json ->> 'kind', v_net));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _settle_test VALUES ('correction_applied', false, SQLSTATE || ': ' || SQLERRM);
  END;

  -- 4) سبب قصير مرفوض
  BEGIN
    PERFORM public.payroll_run_settle(v_run, 10, 'خصم');
    INSERT INTO _settle_test VALUES ('short_reason_rejected', false, 'قُبلت تسوية بسبب قصير');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _settle_test VALUES ('short_reason_rejected', SQLSTATE = '23514', SQLSTATE || ': ' || SQLERRM);
  END;

  -- 5) مبلغ صفري مرفوض
  BEGIN
    PERFORM public.payroll_run_settle(v_run, 0, 'تسوية صفرية للاختبار');
    INSERT INTO _settle_test VALUES ('zero_amount_rejected', false, 'قُبلت تسوية بمبلغ صفر');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _settle_test VALUES ('zero_amount_rejected', SQLSTATE = '23514', SQLSTATE || ': ' || SQLERRM);
  END;

  -- 6) مسودة لا تُعالج بتسوية
  BEGIN
    PERFORM public.payroll_run_settle(v_run_draft, 100, 'تسوية على مسودة');
    INSERT INTO _settle_test VALUES ('draft_run_rejected', false, 'قُبلت تسوية على مسودة');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _settle_test VALUES ('draft_run_rejected', SQLSTATE = '23514' AND position('معتمد' in SQLERRM) > 0,
      SQLSTATE || ': ' || SQLERRM);
  END;

  -- 7) موظف من خارج السجل / مخزن آخر مرفوض
  BEGIN
    PERFORM public.payroll_run_settle(v_run, 100, 'تسوية لموظف غير موجود', gen_random_uuid(), NULL);
    INSERT INTO _settle_test VALUES ('unknown_employee_rejected', false, 'قُبلت تسوية لموظف غير موجود');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _settle_test VALUES ('unknown_employee_rejected', SQLSTATE = 'P0002', SQLSTATE || ': ' || SQLERRM);
  END;

  -- 8) لا يمكن أن يصبح الصافي سالبًا
  BEGIN
    PERFORM public.payroll_run_settle(v_run, -100000, 'خصم أكبر من المستحق');
    INSERT INTO _settle_test VALUES ('negative_net_rejected', false, 'قُبل خصم يجعل الصافي سالبًا');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _settle_test VALUES ('negative_net_rejected', SQLSTATE = '23514', SQLSTATE || ': ' || SQLERRM);
  END;
  SELECT count(*) INTO v_cnt FROM public.payroll_settlements WHERE payroll_run_id = v_run;
  INSERT INTO _settle_test VALUES ('failed_settlement_not_stored', v_cnt = 3, 'عدد التسويات بعد المحاولات الفاشلة = ' || v_cnt);

  -- 9) البنود تبقى مقفلة بعد التسوية
  BEGIN
    INSERT INTO public.payroll_items (payroll_run_id, employee_id, base_salary) VALUES (v_run, v_emp, 50);
    INSERT INTO _settle_test VALUES ('items_still_locked', false, 'أُضيف بند لمسير معتمد');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _settle_test VALUES ('items_still_locked', SQLSTATE = '42501' AND position('مقفل' in SQLERRM) > 0,
      SQLSTATE || ': ' || SQLERRM);
  END;

  -- 10) تعديل الإجماليات مباشرة ما زال ممنوعًا
  BEGIN
    UPDATE public.payroll_runs SET total_net = total_net + 1 WHERE id = v_run;
    INSERT INTO _settle_test VALUES ('direct_totals_edit_blocked', false, 'عُدّلت إجماليات مسير معتمد مباشرة');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _settle_test VALUES ('direct_totals_edit_blocked', SQLSTATE = '42501' AND position('مقفل' in SQLERRM) > 0,
      SQLSTATE || ': ' || SQLERRM);
  END;

  -- 11) التسوية الموثقة غير قابلة للتعديل أو الحذف
  BEGIN
    UPDATE public.payroll_settlements SET amount = 999 WHERE id = v_settle;
    INSERT INTO _settle_test VALUES ('settlement_update_blocked', false, 'عُدّلت تسوية موثقة');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _settle_test VALUES ('settlement_update_blocked', SQLSTATE = '42501', SQLSTATE || ': ' || SQLERRM);
  END;
  BEGIN
    DELETE FROM public.payroll_settlements WHERE id = v_settle;
    INSERT INTO _settle_test VALUES ('settlement_delete_blocked', false, 'حُذفت تسوية موثقة');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _settle_test VALUES ('settlement_delete_blocked', SQLSTATE = '42501', SQLSTATE || ': ' || SQLERRM);
  END;

  -- 12) سجل التدقيق يحتفظ بالتسويات
  SELECT count(*) INTO v_cnt FROM public.audit_logs
   WHERE action = 'payroll_settlement_created' AND entity_type = 'payroll_settlements'
     AND warehouse_id = v_wh AND user_id = v_mgr;
  INSERT INTO _settle_test VALUES ('audit_logged', v_cnt >= 3, 'صفوف التدقيق = ' || v_cnt);

  -- 13) العميل يقرأ ولا يكتب: إدراج مباشر مرفوض بـ RLS
  INSERT INTO public.roles (name, name_ar, is_active, is_system, is_system_role)
  VALUES ('Payroll Settle Viewer Probe', 'قارئ تسويات رواتب', true, false, false) RETURNING id INTO v_role_v;
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_role_v, p.id FROM public.permissions p WHERE p.name IN ('payroll.view', 'payroll.approve');
  INSERT INTO public.user_warehouses (user_id, warehouse_id, tenant_id, role_id, permissions)
  VALUES (v_viewer, v_wh, v_tenant, v_role_v, '{}'::jsonb);

  INSERT INTO public.roles (name, name_ar, is_active, is_system, is_system_role)
  VALUES ('Sales Settle Probe', 'مبيعات تسويات', true, false, false) RETURNING id INTO v_role_s;
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_role_s, p.id FROM public.permissions p WHERE p.name = 'sales.view';
  INSERT INTO public.user_warehouses (user_id, warehouse_id, tenant_id, role_id, permissions)
  VALUES (v_sales, v_wh, v_tenant, v_role_s, '{}'::jsonb);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role', 'authenticated')::text, false);
  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format('select count(*)::text from public.payroll_settlements where payroll_run_id = %L', v_run) INTO v_txt;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_txt := 'ERR:' || SQLERRM; END;
  INSERT INTO _settle_test VALUES ('payroll_reader_sees_settlements', v_txt = '3', 'تسويات مرئية = ' || v_txt);

  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format(
      'insert into public.payroll_settlements (payroll_run_id, kind, amount, reason) values (%L, ''bonus'', 999, ''إدراج مباشر من العميل'')',
      v_run);
    RESET ROLE;
    INSERT INTO _settle_test VALUES ('client_insert_blocked', false, 'أُدرجت تسوية مباشرة من العميل');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _settle_test VALUES ('client_insert_blocked', SQLSTATE = '42501', SQLSTATE || ': ' || SQLERRM);
  END;

  -- 14) بلا صلاحية payroll.approve لا تُسجل تسوية حتى عبر الدالة
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, false);
  BEGIN
    PERFORM public.payroll_run_settle(v_run, 100, 'محاولة من مستخدم مبيعات');
    INSERT INTO _settle_test VALUES ('approve_permission_required', false, 'قُبلت تسوية بدون payroll.approve');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _settle_test VALUES ('approve_permission_required', SQLSTATE = '42501' AND position('payroll.approve' in SQLERRM) > 0,
      SQLSTATE || ': ' || SQLERRM);
  END;

  -- 15) عزل القراءة: مستخدم المبيعات لا يرى التسويات
  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format('select count(*)::text from public.payroll_settlements where payroll_run_id = %L', v_run) INTO v_txt;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_txt := 'ERR:' || SQLERRM; END;
  INSERT INTO _settle_test VALUES ('settlements_hidden_from_sales', v_txt = '0', 'تسويات مرئية لمستخدم مبيعات = ' || v_txt);

  -- 16) بلا جلسة (service_role / مهمة خلفية) لا تُسجل تسوية
  PERFORM set_config('request.jwt.claims', '', false);
  BEGIN
    PERFORM public.payroll_run_settle(v_run, 10, 'تسوية بلا جلسة مستخدم');
    INSERT INTO _settle_test VALUES ('session_required', false, 'قُبلت تسوية بلا جلسة');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _settle_test VALUES ('session_required', SQLSTATE = '42501', SQLSTATE || ': ' || SQLERRM);
  END;

  -- 17) حذف المسير يحذف تسوياته (CASCADE) بعد اختبار الثبات
  DELETE FROM public.payroll_runs WHERE id = v_run;
  INSERT INTO _settle_test VALUES ('cascade_delete_settlements',
    NOT EXISTS (SELECT 1 FROM public.payroll_settlements WHERE payroll_run_id = v_run), 'حُذفت التسويات مع المسير');

  -- تنظيف
  PERFORM set_config('request.jwt.claims', '', false);
  DELETE FROM public.user_warehouses WHERE user_id IN (v_viewer, v_sales);
  DELETE FROM public.role_permissions WHERE role_id IN (v_role_v, v_role_s);
  DELETE FROM public.roles WHERE id IN (v_role_v, v_role_s);
  DELETE FROM public.payroll_runs WHERE id = v_run_draft;
  DELETE FROM public.warehouse_employees WHERE id = v_emp;

  INSERT INTO _settle_test VALUES ('cleanup',
    NOT EXISTS (SELECT 1 FROM public.payroll_runs WHERE id IN (v_run, v_run_draft))
    AND NOT EXISTS (SELECT 1 FROM public.warehouse_employees WHERE id = v_emp)
    AND NOT EXISTS (SELECT 1 FROM public.roles WHERE id IN (v_role_v, v_role_s)), 'حُذفت بيانات الاختبار');
END
$t$;

SELECT name, ok, detail FROM _settle_test ORDER BY name;
