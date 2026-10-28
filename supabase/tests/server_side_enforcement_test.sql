-- =====================================================================================
-- supabase/tests/server_side_enforcement_test.sql
-- اختبار فرض الخادم (مهمة 202610290336):
--   * جداول الخادم حصرًا: العميل لا يستطيع INSERT/UPDATE حتى مع حقول صحيحة  --     (RLS بلا سياسات كتابة): inventory, inventory_movements, categories,
  --     manufacturers, warehouses, tenants, profiles, warehouse_password_hashes, audit_logs.
--   * مُشغّلات الأذونات عبر الأب: بنود أوامر الشراء والاستلام تتبع صلاحية الأب.
--   * الدوال الخادمية الجديدة تشترط جلسة مستخدم وتشتقّ الهوية من الخادم.
-- التشغيل: node scripts/run-sql-test.mjs supabase/tests/server_side_enforcement_test.sql
-- =====================================================================================
CREATE TEMP TABLE _sse_test (name text, ok boolean, detail text) ON COMMIT DROP;

DO $t$
DECLARE
  v_wh uuid; v_tenant uuid; v_mgr uuid;
  v_purchaser uuid := gen_random_uuid();
  v_sales uuid := gen_random_uuid();
  v_role_p uuid; v_role_s uuid;
  v_supplier uuid; v_created_supplier boolean := false;
  v_sup_key uuid;
  v_po uuid; v_gr uuid;
  v_pid uuid;
  v_created_product boolean := false;
  v_txt text; v_id uuid; v_json jsonb;
BEGIN
  SELECT uw.warehouse_id, uw.tenant_id, uw.user_id INTO v_wh, v_tenant, v_mgr
    FROM public.user_warehouses uw JOIN public.roles r ON r.id = uw.role_id
   WHERE r.name = 'Warehouse Manager' ORDER BY uw.created_at NULLS LAST LIMIT 1;

  INSERT INTO _sse_test VALUES ('fixtures', v_wh IS NOT NULL AND v_mgr IS NOT NULL,
    format('wh=%s tenant=%s', v_wh, v_tenant));
  IF v_wh IS NULL OR v_mgr IS NULL THEN RAISE EXCEPTION 'تعذر تجهيز بيانات الاختبار'; END IF;

  -- أدوار الاختبار: مشتري (كل صلاحيات purchases) وبائع (sales.view فقط)
  INSERT INTO public.roles (name, name_ar, is_active, is_system, is_system_role)
  VALUES ('SSE Purchaser Probe', 'مشتري فحص الخادم', true, false, false) RETURNING id INTO v_role_p;
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_role_p, p.id FROM public.permissions p WHERE p.name LIKE 'purchases.%';
  INSERT INTO public.user_warehouses (user_id, warehouse_id, tenant_id, role_id, permissions)
  VALUES (v_purchaser, v_wh, v_tenant, v_role_p, '{}'::jsonb);

  INSERT INTO public.roles (name, name_ar, is_active, is_system, is_system_role)
  VALUES ('SSE Sales Probe', 'بائع فحص الخادم', true, false, false) RETURNING id INTO v_role_s;
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_role_s, p.id FROM public.permissions p WHERE p.name = 'sales.view';
  INSERT INTO public.user_warehouses (user_id, warehouse_id, tenant_id, role_id, permissions)
  VALUES (v_sales, v_wh, v_tenant, v_role_s, '{}'::jsonb);

  -- ------------------------------------------------------------------
  -- 1) العميل لا يكتب جداول الخادم حتى وهو مدير المخزن:
  --    UPDATE بلا سياسة كتابة لا يُعدّل أي صف (قيمة الإرجاع صفر) ولا يُسمح إدراج.
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, false);

  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format($tst$WITH upd_rows AS (UPDATE public.inventory SET quantity = quantity + 1 WHERE warehouse_id = %L RETURNING id
                   ) SELECT count(*)::text FROM upd_rows $tst$, v_wh) INTO v_txt;
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_update_inventory', v_txt = '0',
      'صفوف تحديث المخزون من العميل = ' || coalesce(v_txt, 'NULL') || ' (المطلوب 0');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_update_inventory', SQLSTATE = '42501', SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format($tst$WITH upd_rows AS (UPDATE public.inventory_movements SET notes = 'فحص' WHERE warehouse_id = %L RETURNING id
                   ) SELECT count(*)::text FROM upd_rows $tst$, v_wh) INTO v_txt;
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_update_movements', v_txt = '0',
      'صفوف تحديث الحركات من العميل = ' || coalesce(v_txt, 'NULL') || ' (المطلوب 0)');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_update_movements', SQLSTATE = '42501', SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format($tst$WITH upd_rows AS (UPDATE public.categories SET name = 'فحص' WHERE tenant_id = %L RETURNING id
                   ) SELECT count(*)::text FROM upd_rows $tst$, v_tenant) INTO v_txt;
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_update_categories', v_txt = '0',
      'صفوف تحديث التصنيفات من العميل = ' || coalesce(v_txt, 'NULL') || ' (المطلوب 0)');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_update_categories', SQLSTATE = '42501', SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format($tst$WITH upd_rows AS (UPDATE public.manufacturers SET name = 'فحص' WHERE tenant_id = %L RETURNING id
                   ) SELECT count(*)::text FROM upd_rows $tst$, v_tenant) INTO v_txt;
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_update_manufacturers', v_txt = '0',
      'صفوف تحديث المصنّعين من العميل = ' || coalesce(v_txt, 'NULL') || ' (المطلوب 0)');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_update_manufacturers', SQLSTATE = '42501', SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format($tst$WITH upd_rows AS (UPDATE public.warehouses SET name = name WHERE id = %L RETURNING id
                   ) SELECT count(*)::text FROM upd_rows $tst$, v_wh) INTO v_txt;
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_update_warehouses', v_txt = '0',
      'صفوف تحديث المخازن من العميل = ' || coalesce(v_txt, 'NULL') || ' (المطلوب 0)');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_update_warehouses', SQLSTATE = '42501', SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format($tst$WITH upd_rows AS (UPDATE public.tenants SET name = name WHERE id = %L RETURNING id
                   ) SELECT count(*)::text FROM upd_rows $tst$, v_tenant) INTO v_txt;
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_update_tenants', v_txt = '0',
      'صفوف تحديث المستأجر من العميل = ' || coalesce(v_txt, 'NULL') || ' (المطلوب 0)');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_update_tenants', SQLSTATE = '42501', SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format($tst$WITH upd_rows AS (UPDATE public.profiles SET full_name = full_name WHERE id = %L RETURNING id
                   ) SELECT count(*)::text FROM upd_rows $tst$, v_mgr) INTO v_txt;
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_update_profiles', v_txt = '0',
      'صفوف تحديث الملف الشخصي من العميل = ' || coalesce(v_txt, 'NULL') || ' (المطلوب 0)');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_update_profiles', SQLSTATE = '42501', SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format($tst$WITH upd_rows AS (UPDATE public.warehouse_password_hashes SET hash = hash WHERE user_id = %L RETURNING id
                   ) SELECT count(*)::text FROM upd_rows $tst$, v_mgr) INTO v_txt;
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_update_password_hashes', v_txt = '0',
      'صفوف تحديث البصمات من العميل = ' || coalesce(v_txt, 'NULL') || ' (المطلوب 0)');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_update_password_hashes', SQLSTATE = '42501', SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format($tst$WITH upd_rows AS (UPDATE public.audit_logs SET new_values = new_values WHERE user_id = %L RETURNING id
                   ) SELECT count(*)::text FROM upd_rows $tst$, v_mgr) INTO v_txt;
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_update_audit_logs', v_txt = '0',
      'صفوف تحديث التدقيق من العميل = ' || coalesce(v_txt, 'NULL') || ' (المطلوب 0)');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_update_audit_logs', SQLSTATE = '42501', SQLSTATE || ': ' || SQLERRM);
  END;

  -- إدراج مباشر في جداول الخادم: يُرفض بسياسة رفض افتراضي بلا سياسة كتابة
  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format(
      'INSERT INTO public.categories (tenant_id, name, name_ar, is_active, code)
       VALUES (%L, ''فحص'', ''فحص'', true, ''SSE'')', v_tenant);
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_insert_categories', false, 'قُبِل إدراج تصنيف من العميل');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_insert_categories', SQLSTATE = '42501', SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format(
      'INSERT INTO public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, new_values)
       VALUES (%L, %L, %L, ''client_forge_probe'', ''test'', ''{}''::jsonb)', v_tenant, v_mgr, v_wh);
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_insert_audit_logs', false, 'قُبِل إدراج تدقيق من العميل');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('client_cannot_insert_audit_logs', SQLSTATE = '42501', SQLSTATE || ': ' || SQLERRM);
  END;

  -- ------------------------------------------------------------------
  -- 2) صلاحيات الأب: بنود الأوامر/الاستلام تتبع صلاحية المستند الأب
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', '', false);

  SELECT id INTO v_sup_key FROM public.suppliers WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  IF v_sup_key IS NULL THEN
    SELECT id INTO v_sup_key FROM public.suppliers ORDER BY created_at LIMIT 1;
  END IF;
  IF v_sup_key IS NULL THEN
    -- قاعدة بيانات بلا مورد نهائيًا (غير متوقع في بيئة الإنتاج): محاولة إدراج مُقدَّنة
    BEGIN
      INSERT INTO public.suppliers (tenant_id, warehouse_id, name, code, phone, email, address)
      VALUES (v_tenant, v_wh, 'مورد فحص الخادم', 'SSE', '01000000000', '', '')
      RETURNING id INTO v_sup_key;
      v_created_supplier := true;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'تعذر تجهيز مورد للفحص: % : %', SQLSTATE, SQLERRM;
    END;
  END IF;

  INSERT INTO public.purchase_orders (tenant_id, warehouse_id, supplier_id, order_number, order_date)
  VALUES (v_tenant, v_wh, v_sup_key, 'SSE-' || substr(gen_random_uuid()::text, 1, 8), current_date)
  RETURNING id INTO v_po;

  INSERT INTO public.goods_receipts (tenant_id, warehouse_id, supplier_id, receipt_number, receipt_date)
  VALUES (v_tenant, v_wh, v_sup_key, 'SSE-' || substr(gen_random_uuid()::text, 1, 8), current_date)
  RETURNING id INTO v_gr;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, false);
  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format(
      'INSERT INTO public.purchase_order_items (purchase_order_id, product_id, quantity, unit_price) VALUES (%L, gen_random_uuid(), 1, 1)',
      v_po);
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('po_items_need_parent_permission', false, 'أُضيف بند أمر شراء بلا صلاحية');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('po_items_need_parent_permission',
      SQLSTATE = '42501' AND position('purchases.create' in SQLERRM) > 0, SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format(
      'INSERT INTO public.goods_receipt_items (goods_receipt_id, product_id, quantity, unit_cost) VALUES (%L, gen_random_uuid(), 1, 1)',
      v_gr);
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('gr_items_need_parent_permission', false, 'أُضيف بند استلام بلا صلاحية');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('gr_items_need_parent_permission',
      SQLSTATE = '42501' AND (position('purchases.create' in SQLERRM) > 0 OR position('صلاحية' in SQLERRM) > 0),
      SQLSTATE || ': ' || SQLERRM);
  END;

  -- معرّف صنف حقيقي (بلا جلسة، لأن كل التوابع هنا تعمل على مستوى الخادم)
  PERFORM set_config('request.jwt.claims', '', false);
  SELECT id INTO v_pid FROM public.products ORDER BY created_at LIMIT 1;
  IF v_pid IS NULL THEN
    BEGIN
      INSERT INTO public.products (tenant_id, name, name_ar, sku)
      VALUES (v_tenant, 'SSE', 'صنف فحص الخادم', 'SSE-P1-' || substr(v_po::text, 1, 6))
      RETURNING id INTO v_pid;
    EXCEPTION WHEN undefined_column THEN
      INSERT INTO public.products (tenant_id, name, name_ar)
      VALUES (v_tenant, 'SSE', 'صنف فحص الخادم')
      RETURNING id INTO v_pid;
    END;
    v_created_product := true;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_purchaser, 'role', 'authenticated')::text, false);
  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format(
      'INSERT INTO public.purchase_order_items (purchase_order_id, product_id, quantity, unit_price) VALUES (%L, %L, 1, 1)',
      v_po, coalesce(v_pid::text, '')) ;
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('po_items_allowed_for_purchaser', true, 'البنود تمر بصلاحية الأب purchases.create');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('po_items_allowed_for_purchaser', false, SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format(
      'INSERT INTO public.goods_receipt_items (goods_receipt_id, product_id, quantity, unit_cost, batch_number, expiry_date, quantity_ordered)
       VALUES (%L, %L, 1, 1, ''SSE-B1'', current_date + 365, 1)',
      v_gr, coalesce(v_pid::text, ''));
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('gr_items_allowed_for_purchaser', true, 'بنود الاستلام تمر بصلاحية الأب');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _sse_test VALUES ('gr_items_allowed_for_purchaser', false, SQLSTATE || ': ' || SQLERRM);
  END;

  -- ------------------------------------------------------------------
  -- 3) دوال الخادم الجديدة: جلسة إلزامي وهوية من الخادم
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', '', false);
  BEGIN
    PERFORM public.wms_register_workspace('مخزن بلا جلسة');
    INSERT INTO _sse_test VALUES ('register_requires_session', false, 'قُبِل تسجيل مساحة عمل بلا جلسة');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _sse_test VALUES ('register_requires_session', SQLSTATE = '42501', SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    PERFORM public.wms_manager_password_set('hash_no_session_12345678');
    INSERT INTO _sse_test VALUES ('password_set_requires_session', false, 'قُبِل حفظ بصمة بلا جلسة');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _sse_test VALUES ('password_set_requires_session', SQLSTATE = '42501', SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    PERFORM public.audit_log_client('without_session_probe');
    INSERT INTO _sse_test VALUES ('audit_client_requires_session', false, 'قُبِل حدث تدقيق بلا جلسة');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _sse_test VALUES ('audit_client_requires_session', SQLSTATE = '42501', SQLSTATE || ': ' || SQLERRM);
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, false);
  BEGIN
    v_id := public.audit_log_client('sse_client_probe', 'test_entity', NULL,
                                    jsonb_build_object('note', 'اختبار'));
    SELECT count(*) INTO v_txt FROM public.audit_logs WHERE id = v_id AND action = 'sse_client_probe';
    INSERT INTO _sse_test VALUES ('audit_client_writes_with_session', v_txt = '1',
      'الهوية ونطاق المخزن/المستأجر مشتقّان من الخادم وقيمة النتيجة uuid = ' || coalesce(v_id::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _sse_test VALUES ('audit_client_writes_with_session', false, SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    PERFORM public.audit_log_client('');
    INSERT INTO _sse_test VALUES ('audit_client_rejects_empty_action', false, 'قُبِل حدث بلا نوع');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _sse_test VALUES ('audit_client_rejects_empty_action', SQLSTATE = '23514', SQLSTATE || ': ' || SQLERRM);
  END;

  -- ------------------------------------------------------------------
  -- 4) التنظيف
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', '', false);
  DELETE FROM public.audit_logs WHERE action = 'sse_client_probe';
  DELETE FROM public.purchase_orders WHERE id = v_po;
  DELETE FROM public.goods_receipts WHERE id = v_gr;
  IF v_created_supplier THEN
    DELETE FROM public.suppliers WHERE id = v_sup_key;
  END IF;
  IF v_created_product THEN
    DELETE FROM public.products WHERE id = v_pid;
  END IF;
  DELETE FROM public.user_warehouses WHERE user_id IN (v_purchaser, v_sales);
  DELETE FROM public.role_permissions WHERE role_id IN (v_role_p, v_role_s);
  DELETE FROM public.roles WHERE id IN (v_role_p, v_role_s);

  INSERT INTO _sse_test VALUES ('cleanup',
    NOT EXISTS (SELECT 1 FROM public.roles WHERE id IN (v_role_p, v_role_s))
    AND NOT EXISTS (SELECT 1 FROM public.purchase_orders WHERE id = v_po)
    AND NOT EXISTS (SELECT 1 FROM public.goods_receipts WHERE id = v_gr)
    AND NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = v_sup_key AND v_created_supplier)
    AND NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_pid AND v_created_product), 'حُذفت بيانات الاختبار');
END
$t$;

SELECT name, ok, detail FROM _sse_test ORDER BY name;
