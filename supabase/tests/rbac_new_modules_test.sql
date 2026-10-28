-- =====================================================================================
-- supabase/tests/rbac_new_modules_test.sql
-- اختبار فعلي للوحدات المبنية حديثًا: الرواتب، العروض وقوائم الأسعار، خدمة العملاء، الأتمتة.
-- التشغيل: node scripts/apply-sql.mjs supabase/tests/rbac_new_modules_test.sql
-- يعيد: name | ok | detail
-- =====================================================================================
CREATE TEMP TABLE _rbac_new_test (name text, ok boolean, detail text) ON COMMIT DROP;

DO $t$
DECLARE
  v_wh      uuid;
  v_tenant  uuid;
  v_mgr     uuid;
  v_ghost   uuid := gen_random_uuid();
  v_pay_user uuid := gen_random_uuid();
  v_sales_user uuid := gen_random_uuid();
  v_role_pay uuid;
  v_role_sales uuid;
  v_run     uuid := gen_random_uuid();
  v_txt     text;
  v_cnt     int;
BEGIN
  SELECT uw.warehouse_id, uw.tenant_id, uw.user_id INTO v_wh, v_tenant, v_mgr
    FROM public.user_warehouses uw
    JOIN public.roles r ON r.id = uw.role_id
   WHERE r.name = 'Warehouse Manager'
   ORDER BY uw.created_at NULLS LAST LIMIT 1;

  INSERT INTO _rbac_new_test VALUES ('fixtures', v_wh IS NOT NULL AND v_tenant IS NOT NULL,
    format('wh=%s tenant=%s', v_wh, v_tenant));
  IF v_wh IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'تعذر تجهيز بيانات الاختبار';
  END IF;

  -- الجداول والسياسات موجودة
  SELECT count(*) INTO v_cnt FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='public' AND c.relname IN ('payroll_runs','payroll_items','promotions','price_lists',
        'price_list_items','customer_service_tickets','automation_rules') AND c.relkind='r';
  INSERT INTO _rbac_new_test VALUES ('tables_created', v_cnt = 7, v_cnt || '/7 جدول');

  SELECT count(*) INTO v_cnt FROM pg_policy WHERE polname LIKE '%read_gate';
  INSERT INTO _rbac_new_test VALUES ('read_gates', v_cnt >= 24, v_cnt || ' سياسة قراءة');

  -- ------------------------------------------------------------------ الرفض بلا صلاحية
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ghost, 'role', 'authenticated')::text, false);

  BEGIN
    INSERT INTO public.payroll_runs (tenant_id, warehouse_id, period_start, period_end)
    VALUES (v_tenant, v_wh, current_date, current_date + 29);
    INSERT INTO _rbac_new_test VALUES ('payroll_insert_denied', false, 'أُنشئ مسير رواتب بدون صلاحية');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_new_test VALUES ('payroll_insert_denied',
      SQLSTATE = '42501' AND position('payroll.create' in SQLERRM) > 0, SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.promotions (tenant_id, warehouse_id, name)
    VALUES (v_tenant, v_wh, 'RBAC PROBE PROMO');
    INSERT INTO _rbac_new_test VALUES ('promotion_insert_denied', false, 'أُنشئ عرض بدون صلاحية');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_new_test VALUES ('promotion_insert_denied',
      SQLSTATE = '42501' AND position('pricing.create' in SQLERRM) > 0, SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.customer_service_tickets (tenant_id, warehouse_id, ticket_number, subject)
    VALUES (v_tenant, v_wh, 'T-RBAC-1', 'تذكرة فحص');
    INSERT INTO _rbac_new_test VALUES ('ticket_insert_denied', false, 'أُنشئت تذكرة بدون صلاحية');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_new_test VALUES ('ticket_insert_denied',
      SQLSTATE = '42501' AND position('customer_service.create' in SQLERRM) > 0, SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.automation_rules (tenant_id, warehouse_id, name, trigger_event, action_type)
    VALUES (v_tenant, v_wh, 'RBAC PROBE RULE', 'invoice.created', 'notify');
    INSERT INTO _rbac_new_test VALUES ('automation_insert_denied', false, 'أُنشئت قاعدة أتمتة بدون صلاحية');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_new_test VALUES ('automation_insert_denied',
      SQLSTATE = '42501' AND position('automation.create' in SQLERRM) > 0, SQLSTATE || ': ' || SQLERRM);
  END;

  -- ------------------------------------------------------------------ اعتماد الرواتب
  PERFORM set_config('request.jwt.claims', '', false);
  INSERT INTO public.payroll_runs (id, tenant_id, warehouse_id, period_start, period_end, total_gross, total_net)
  VALUES (v_run, v_tenant, v_wh, current_date, current_date + 29, 1000, 1000);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ghost, 'role', 'authenticated')::text, false);
  BEGIN
    UPDATE public.payroll_runs SET status = 'approved' WHERE id = v_run;
    INSERT INTO _rbac_new_test VALUES ('payroll_approve_denied', false, 'اعتُمد المسير بدون صلاحية');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_new_test VALUES ('payroll_approve_denied',
      SQLSTATE = '42501' AND position('payroll.approve' in SQLERRM) > 0, SQLSTATE || ': ' || SQLERRM);
  END;

  -- ------------------------------------------------------------------ قراءة الرواتب: صلاحية العرض
  INSERT INTO public.roles (name, name_ar, is_active, is_system, is_system_role)
  VALUES ('Payroll Viewer Probe', 'قارئ رواتب', true, false, false) RETURNING id INTO v_role_pay;
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_role_pay, p.id FROM public.permissions p WHERE p.name = 'payroll.view';
  INSERT INTO public.user_warehouses (user_id, warehouse_id, tenant_id, role_id, permissions)
  VALUES (v_pay_user, v_wh, v_tenant, v_role_pay, '{}'::jsonb);

  INSERT INTO public.roles (name, name_ar, is_active, is_system, is_system_role)
  VALUES ('Sales Only Probe', 'مبيعات فقط', true, false, false) RETURNING id INTO v_role_sales;
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_role_sales, p.id FROM public.permissions p WHERE p.name = 'sales.view';
  INSERT INTO public.user_warehouses (user_id, warehouse_id, tenant_id, role_id, permissions)
  VALUES (v_sales_user, v_wh, v_tenant, v_role_sales, '{}'::jsonb);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pay_user, 'role', 'authenticated')::text, false);
  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format('select count(*)::text from public.payroll_runs where id = %L', v_run) INTO v_txt;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_txt := 'ERR:' || SQLERRM;
  END;
  INSERT INTO _rbac_new_test VALUES ('payroll_viewer_reads', v_txt = '1', 'صفوف مرئية لقارئ الرواتب = ' || v_txt);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sales_user, 'role', 'authenticated')::text, false);
  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format('select count(*)::text from public.payroll_runs where id = %L', v_run) INTO v_txt;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_txt := 'ERR:' || SQLERRM;
  END;
  INSERT INTO _rbac_new_test VALUES ('payroll_hidden_from_others', v_txt = '0', 'صفوف مرئية لمستخدم مبيعات = ' || v_txt);

  -- ------------------------------------------------------------------ المدير يعتمد
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, false);
  BEGIN
    UPDATE public.payroll_runs SET status = 'approved' WHERE id = v_run;
    v_cnt := (SELECT count(*) FROM public.payroll_runs WHERE id = v_run AND status = 'approved');
    INSERT INTO _rbac_new_test VALUES ('payroll_approve_allowed', v_cnt = 1,
      'حالة المسير بعد الاعتماد = approved');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_new_test VALUES ('payroll_approve_allowed', false, SQLSTATE || ': ' || SQLERRM);
  END;

  -- ------------------------------------------------------------------ منع تكرار مسير لنفس الفترة
  BEGIN
    INSERT INTO public.payroll_runs (tenant_id, warehouse_id, period_start, period_end)
    VALUES (v_tenant, v_wh, current_date, current_date + 29);
    INSERT INTO _rbac_new_test VALUES ('payroll_period_unique', false, 'سُمح بمسير مكرر لنفس الفترة');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_new_test VALUES ('payroll_period_unique', SQLSTATE = '23505', SQLSTATE || ': ' || SQLERRM);
  END;

  -- ------------------------------------------------------------------ تنظيف
  PERFORM set_config('request.jwt.claims', '', false);
  DELETE FROM public.user_warehouses WHERE user_id IN (v_pay_user, v_sales_user);
  DELETE FROM public.role_permissions WHERE role_id IN (v_role_pay, v_role_sales);
  DELETE FROM public.roles WHERE id IN (v_role_pay, v_role_sales);
  DELETE FROM public.payroll_items WHERE payroll_run_id = v_run;
  DELETE FROM public.payroll_runs WHERE id = v_run;
  DELETE FROM public.promotions WHERE name = 'RBAC PROBE PROMO';
  DELETE FROM public.customer_service_tickets WHERE ticket_number = 'T-RBAC-1';
  DELETE FROM public.automation_rules WHERE name = 'RBAC PROBE RULE';
  INSERT INTO _rbac_new_test VALUES ('cleanup',
    NOT EXISTS (SELECT 1 FROM public.payroll_runs WHERE id = v_run)
    AND NOT EXISTS (SELECT 1 FROM public.roles WHERE name IN ('Payroll Viewer Probe','Sales Only Probe')),
    'حُذفت بيانات الاختبار');
END
$t$;

SELECT name, ok, detail FROM _rbac_new_test ORDER BY name;
