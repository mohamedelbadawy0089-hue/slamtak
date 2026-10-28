-- =====================================================================================
-- supabase/tests/payroll_items_test.sql
-- اختبار فعلي لمحرك بنود الرواتب: حساب الصافي، مزامنة الإجماليات، القفل بعد الاعتماد،
-- ثبات المسير المعتمد، رفض من لا يملك payroll.create، وعزل القراءة.
-- التشغيل: node scripts/run-sql-test.mjs supabase/tests/payroll_items_test.sql
-- =====================================================================================
CREATE TEMP TABLE _pay_test (name text, ok boolean, detail text) ON COMMIT DROP;

DO $t$
DECLARE
  v_wh uuid; v_tenant uuid; v_mgr uuid;
  v_ghost uuid := gen_random_uuid();
  v_viewer uuid := gen_random_uuid();
  v_sales uuid := gen_random_uuid();
  v_role_v uuid; v_role_s uuid;
  v_emp1 uuid := gen_random_uuid();
  v_emp2 uuid := gen_random_uuid();
  v_run1 uuid := gen_random_uuid();
  v_run2 uuid := gen_random_uuid();
  v_item1 uuid := gen_random_uuid();
  v_item2 uuid := gen_random_uuid();
  v_gross numeric; v_ded numeric; v_net numeric; v_txt text;
BEGIN
  SELECT uw.warehouse_id, uw.tenant_id, uw.user_id INTO v_wh, v_tenant, v_mgr
    FROM public.user_warehouses uw JOIN public.roles r ON r.id = uw.role_id
   WHERE r.name = 'Warehouse Manager' ORDER BY uw.created_at NULLS LAST LIMIT 1;

  INSERT INTO _pay_test VALUES ('fixtures', v_wh IS NOT NULL AND v_mgr IS NOT NULL,
    format('wh=%s tenant=%s', v_wh, v_tenant));
  IF v_wh IS NULL OR v_mgr IS NULL THEN RAISE EXCEPTION 'تعذر تجهيز بيانات الاختبار'; END IF;

  -- الموظفون من سجل الموظفين الفعلي (warehouse_employees) كما في الواجهة
  INSERT INTO public.warehouse_employees (id, tenant_id, warehouse_id, user_id, full_name, username, login_email, is_active)
  VALUES (v_emp1, v_tenant, v_wh, gen_random_uuid(), 'موظف اختبار 1', 'pay_test_1_' || substr(v_emp1::text, 1, 8), 'pay_test_1_' || substr(v_emp1::text, 1, 8) || '@test.local', true),
         (v_emp2, v_tenant, v_wh, gen_random_uuid(), 'موظف اختبار 2', 'pay_test_2_' || substr(v_emp2::text, 1, 8), 'pay_test_2_' || substr(v_emp2::text, 1, 8) || '@test.local', true);

  PERFORM set_config('request.jwt.claims', '', false);
  INSERT INTO public.payroll_runs (id, tenant_id, warehouse_id, period_start, period_end, status)
  VALUES (v_run1, v_tenant, v_wh, current_date - 60, current_date - 31, 'draft');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, false);

  BEGIN
    INSERT INTO public.payroll_items (id, payroll_run_id, employee_id, base_salary, allowances, deductions)
    VALUES (v_item1, v_run1, v_emp1, 1000, 200, 50);
    SELECT total_gross, total_deductions, total_net INTO v_gross, v_ded, v_net FROM public.payroll_runs WHERE id = v_run1;
    INSERT INTO _pay_test VALUES ('net_computed', (SELECT net_salary FROM public.payroll_items WHERE id = v_item1) = 1150,
      'صافي البند = ' || (SELECT net_salary FROM public.payroll_items WHERE id = v_item1));
    INSERT INTO _pay_test VALUES ('totals_after_first_item', v_gross = 1200 AND v_ded = 50 AND v_net = 1150,
      format('gross=%s ded=%s net=%s', v_gross, v_ded, v_net));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _pay_test VALUES ('net_computed', false, SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.payroll_items (id, payroll_run_id, employee_id, base_salary, allowances, deductions)
    VALUES (v_item2, v_run1, v_emp2, 500, 0, 100);
    SELECT total_gross, total_deductions, total_net INTO v_gross, v_ded, v_net FROM public.payroll_runs WHERE id = v_run1;
    INSERT INTO _pay_test VALUES ('totals_two_items', v_gross = 1700 AND v_ded = 150 AND v_net = 1550,
      format('gross=%s ded=%s net=%s', v_gross, v_ded, v_net));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _pay_test VALUES ('totals_two_items', false, SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.payroll_items (payroll_run_id, employee_id, base_salary) VALUES (v_run1, gen_random_uuid(), 10);
    INSERT INTO _pay_test VALUES ('unknown_employee_rejected', false, 'قُبل بند لموظف غير موجود');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _pay_test VALUES ('unknown_employee_rejected', SQLSTATE = '23503', SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.payroll_items SET allowances = 300 WHERE id = v_item1;
    SELECT total_gross, total_net INTO v_gross, v_net FROM public.payroll_runs WHERE id = v_run1;
    INSERT INTO _pay_test VALUES ('totals_resync_on_update', v_gross = 1800 AND v_net = 1650, format('gross=%s net=%s', v_gross, v_net));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _pay_test VALUES ('totals_resync_on_update', false, SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.payroll_items SET deductions = 5000 WHERE id = v_item1;
    INSERT INTO _pay_test VALUES ('negative_net_rejected', false, 'قُبل بند بصافي سالب');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _pay_test VALUES ('negative_net_rejected', SQLSTATE = '23514', SQLSTATE || ': ' || SQLERRM);
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ghost, 'role', 'authenticated')::text, false);
  BEGIN
    INSERT INTO public.payroll_items (payroll_run_id, employee_id, base_salary) VALUES (v_run1, v_emp2, 999);
    INSERT INTO _pay_test VALUES ('item_insert_denied', false, 'أُضيف بند بدون صلاحية');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _pay_test VALUES ('item_insert_denied', SQLSTATE = '42501' AND position('payroll.create' in SQLERRM) > 0,
      SQLSTATE || ': ' || SQLERRM);
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, false);
  UPDATE public.payroll_runs SET status = 'approved' WHERE id = v_run1;

  BEGIN
    INSERT INTO public.payroll_items (payroll_run_id, employee_id, base_salary) VALUES (v_run1, v_emp2, 777);
    INSERT INTO _pay_test VALUES ('locked_insert', false, 'أُضيف بند لمسير معتمد');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _pay_test VALUES ('locked_insert', SQLSTATE = '42501' AND position('مقفل' in SQLERRM) > 0, SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    DELETE FROM public.payroll_items WHERE id = v_item2;
    INSERT INTO _pay_test VALUES ('locked_delete', false, 'حُذف بند من مسير معتمد');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _pay_test VALUES ('locked_delete', SQLSTATE = '42501' AND position('مقفل' in SQLERRM) > 0, SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.payroll_runs SET total_net = total_net + 500 WHERE id = v_run1;
    INSERT INTO _pay_test VALUES ('totals_immutable_when_approved', false, 'عُدّلت إجماليات مسير معتمد');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _pay_test VALUES ('totals_immutable_when_approved', SQLSTATE = '42501' AND position('مقفل' in SQLERRM) > 0,
      SQLSTATE || ': ' || SQLERRM);
  END;

  INSERT INTO public.roles (name, name_ar, is_active, is_system, is_system_role)
  VALUES ('Payroll Items Viewer Probe', 'قارئ بنود رواتب', true, false, false) RETURNING id INTO v_role_v;
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_role_v, p.id FROM public.permissions p WHERE p.name = 'payroll.view';
  INSERT INTO public.user_warehouses (user_id, warehouse_id, tenant_id, role_id, permissions)
  VALUES (v_viewer, v_wh, v_tenant, v_role_v, '{}'::jsonb);

  INSERT INTO public.roles (name, name_ar, is_active, is_system, is_system_role)
  VALUES ('Sales Items Probe', 'مبيعات بنود', true, false, false) RETURNING id INTO v_role_s;
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_role_s, p.id FROM public.permissions p WHERE p.name = 'sales.view';
  INSERT INTO public.user_warehouses (user_id, warehouse_id, tenant_id, role_id, permissions)
  VALUES (v_sales, v_wh, v_tenant, v_role_s, '{}'::jsonb);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role', 'authenticated')::text, false);
  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format('select count(*)::text from public.payroll_items where payroll_run_id = %L', v_run1) INTO v_txt;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_txt := 'ERR:' || SQLERRM; END;
  INSERT INTO _pay_test VALUES ('viewer_reads_items', v_txt = '2', 'بنود مرئية لقارئ الرواتب = ' || v_txt);
  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format('select count(*)::text from public.warehouse_employees where warehouse_id = %L', v_wh) INTO v_txt;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_txt := 'ERR:' || SQLERRM; END;
  INSERT INTO _pay_test VALUES ('payroll_viewer_sees_staff', v_txt = '2', 'موظفون مرئيون لقارئ الرواتب = ' || v_txt);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, false);
  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format('select count(*)::text from public.payroll_items where payroll_run_id = %L', v_run1) INTO v_txt;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_txt := 'ERR:' || SQLERRM; END;
  INSERT INTO _pay_test VALUES ('items_hidden_from_others', v_txt = '0', 'بنود مرئية لمستخدم مبيعات = ' || v_txt);
  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format('select count(*)::text from public.warehouse_employees where warehouse_id = %L', v_wh) INTO v_txt;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_txt := 'ERR:' || SQLERRM; END;
  INSERT INTO _pay_test VALUES ('staff_hidden_from_sales', v_txt = '0', 'موظفون مرئيون لمستخدم مبيعات = ' || v_txt);

  PERFORM set_config('request.jwt.claims', '', false);
  BEGIN
    DELETE FROM public.payroll_runs WHERE id = v_run1;
    INSERT INTO _pay_test VALUES ('cascade_delete_ok',
      NOT EXISTS (SELECT 1 FROM public.payroll_items WHERE payroll_run_id = v_run1), 'حُذف المسير وبنوده');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _pay_test VALUES ('cascade_delete_ok', false, SQLSTATE || ': ' || SQLERRM);
  END;

  INSERT INTO public.payroll_runs (id, tenant_id, warehouse_id, period_start, period_end, status)
  VALUES (v_run2, v_tenant, v_wh, current_date - 30, current_date - 1, 'draft');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, false);
  INSERT INTO public.payroll_items (payroll_run_id, employee_id, base_salary) VALUES (v_run2, v_emp1, 400);
  DELETE FROM public.payroll_items WHERE payroll_run_id = v_run2;
  SELECT total_gross, total_net INTO v_gross, v_net FROM public.payroll_runs WHERE id = v_run2;
  INSERT INTO _pay_test VALUES ('totals_zero_after_delete', v_gross = 0 AND v_net = 0, format('gross=%s net=%s', v_gross, v_net));

  PERFORM set_config('request.jwt.claims', '', false);
  DELETE FROM public.user_warehouses WHERE user_id IN (v_viewer, v_sales);
  DELETE FROM public.role_permissions WHERE role_id IN (v_role_v, v_role_s);
  DELETE FROM public.roles WHERE id IN (v_role_v, v_role_s);
  DELETE FROM public.payroll_runs WHERE id = v_run2;
  DELETE FROM public.warehouse_employees WHERE id IN (v_emp1, v_emp2);

  INSERT INTO _pay_test VALUES ('cleanup',
    NOT EXISTS (SELECT 1 FROM public.payroll_runs WHERE id IN (v_run1, v_run2))
    AND NOT EXISTS (SELECT 1 FROM public.warehouse_employees WHERE id IN (v_emp1, v_emp2)), 'حُذفت بيانات الاختبار');
END
$t$;

SELECT name, ok, detail FROM _pay_test ORDER BY name;
