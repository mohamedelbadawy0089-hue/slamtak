-- =====================================================================================
-- supabase/tests/rbac_read_gating_test.sql
-- اختبار فعلي لفرض صلاحيات القراءة على مستوى الصفوف (RLS RESTRICTIVE).
-- التشغيل: node scripts/apply-sql.mjs supabase/tests/rbac_read_gating_test.sql
-- يعيد: name | ok | detail
-- =====================================================================================
CREATE TEMP TABLE _rbac_read_test (name text, ok boolean, detail text) ON COMMIT DROP;

DO $t$
DECLARE
  v_wh    uuid;
  v_mgr   uuid;
  v_tenant uuid;
  v_probe uuid := gen_random_uuid();
  v_role  uuid;
  v_cnt   int;
  v_txt   text;
  v_prod  uuid := gen_random_uuid();
BEGIN
  SELECT uw.warehouse_id, uw.user_id, uw.tenant_id INTO v_wh, v_mgr, v_tenant
    FROM public.user_warehouses uw
    JOIN public.roles r ON r.id = uw.role_id
   WHERE r.name = 'Warehouse Manager'
   ORDER BY uw.created_at NULLS LAST
   LIMIT 1;

  INSERT INTO _rbac_read_test VALUES ('fixtures', v_wh IS NOT NULL AND v_mgr IS NOT NULL,
    format('wh=%s mgr=%s', v_wh, v_mgr));
  IF v_wh IS NULL OR v_mgr IS NULL THEN
    RAISE EXCEPTION 'تعذر تجهيز بيانات اختبار القراءة';
  END IF;

  -- سياسات القراءة مركّبة
  SELECT count(*) INTO v_cnt FROM pg_policy WHERE polname = 'rbac_read_gate';
  INSERT INTO _rbac_read_test VALUES ('read_gate_installed', v_cnt >= 10, v_cnt || ' سياسة قراءة');

  -- دور قراءة محدود: sales.view فقط (بلا products.view)
  INSERT INTO public.roles (name, name_ar, is_active, is_system, is_system_role)
  VALUES ('Read Probe Role', 'دور فحص القراءة', true, false, false)
  RETURNING id INTO v_role;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_role, p.id FROM public.permissions p WHERE p.name = 'sales.view';

  INSERT INTO public.user_warehouses (user_id, warehouse_id, tenant_id, role_id, permissions)
  VALUES (v_probe, v_wh, v_tenant, v_role, '{}'::jsonb);

  -- بيانات: صنف في المخزن (بجلسة خدمة بلا فحص صلاحيات)
  PERFORM set_config('request.jwt.claims', '', false);
  INSERT INTO public.products (id, tenant_id, warehouse_id, name, name_ar, sku)
  VALUES (v_prod, v_tenant, v_wh, 'RBAC READ PROBE', 'صنف فحص القراءة', 'RBAC-READ-PROBE');

  -- 1) المدير الذي يملك products.view يرى الصنف
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, false);
  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format('select count(*)::text from public.products where id = %L', v_prod) INTO v_txt;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_txt := 'ERR:' || SQLERRM;
  END;
  INSERT INTO _rbac_read_test VALUES ('manager_reads_products', v_txt = '1', 'صفوف مرئية للمدير = ' || v_txt);

  -- 2) مستخدم يملك sales.view فقط لا يرى أصنافًا
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_probe, 'role', 'authenticated')::text, false);
  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format('select count(*)::text from public.products where id = %L', v_prod) INTO v_txt;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_txt := 'ERR:' || SQLERRM;
  END;
  INSERT INTO _rbac_read_test VALUES ('module_view_required', v_txt = '0', 'صفوف مرئية بلا products.view = ' || v_txt);

  -- 3) النطاق بمستوى الوحدة صحيح
  INSERT INTO _rbac_read_test VALUES ('scoped_to_module',
    public.rbac_can_view_module('sales') AND NOT public.rbac_can_view_module('products'),
    'sales=' || public.rbac_can_view_module('sales')::text || ' products=' || public.rbac_can_view_module('products')::text);

  -- 4) anon لا يرى شيئًا
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);
  BEGIN
    SET LOCAL ROLE anon;
    EXECUTE format('select count(*)::text from public.products where id = %L', v_prod) INTO v_txt;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_txt := 'ERR:' || SQLERRM;
  END;
  INSERT INTO _rbac_read_test VALUES ('anon_reads_nothing',
    v_txt = '0' OR v_txt LIKE 'ERR:%', 'صفوف anon = ' || v_txt);

  -- تنظيف كامل
  PERFORM set_config('request.jwt.claims', '', false);
  DELETE FROM public.products WHERE id = v_prod;
  DELETE FROM public.user_warehouses WHERE user_id = v_probe;
  DELETE FROM public.role_permissions WHERE role_id = v_role;
  DELETE FROM public.roles WHERE id = v_role;
  INSERT INTO _rbac_read_test VALUES ('cleanup',
    NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Read Probe Role'), 'حُذف دور الفحص');
END
$t$;

SELECT name, ok, detail FROM _rbac_read_test ORDER BY name;
