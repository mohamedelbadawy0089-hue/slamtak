-- =====================================================================================
-- supabase/tests/rbac_enforcement_test.sql
-- اختبار فعلي لفرض الصلاحيات على جداول الأعمال (وليس الواجهة فقط).
-- التشغيل: node scripts/apply-sql.mjs supabase/tests/rbac_enforcement_test.sql
-- يعيد جدول: name | ok | detail
-- =====================================================================================
CREATE TEMP TABLE _rbac_enf_test (name text, ok boolean, detail text) ON COMMIT DROP;

DO $test$
DECLARE
  v_wh       uuid;
  v_wh2      uuid;
  v_mgr      uuid;
  v_viewer   uuid;
  v_ghost    uuid := gen_random_uuid();
  v_ok       boolean;
  v_detail   text;
  v_extra    uuid;
  v_cnt      int;
BEGIN
  -- ---------------------------------------------------------------- fixtures
  SELECT uw.warehouse_id, uw.user_id INTO v_wh, v_mgr
    FROM public.user_warehouses uw JOIN public.roles r ON r.id = uw.role_id
   WHERE r.name = 'Warehouse Manager'
   ORDER BY uw.created_at NULLS LAST LIMIT 1;

  SELECT uw.user_id INTO v_viewer
    FROM public.user_warehouses uw JOIN public.roles r ON r.id = uw.role_id
   WHERE uw.warehouse_id = v_wh AND r.name = 'Viewer' AND uw.user_id <> v_mgr
   LIMIT 1;

  SELECT warehouse_id INTO v_wh2 FROM public.user_warehouses WHERE warehouse_id <> v_wh LIMIT 1;

  INSERT INTO _rbac_enf_test VALUES ('fixtures',
    v_wh IS NOT NULL AND v_mgr IS NOT NULL AND v_wh2 IS NOT NULL,
    format('wh=%s mgr=%s viewer=%s wh2=%s', v_wh, v_mgr, v_viewer, v_wh2));

  IF v_wh IS NULL OR v_mgr IS NULL THEN
    RAISE EXCEPTION 'تعذر تجهيز بيانات الاختبار (مخزن=% مدير=%)', v_wh, v_mgr;
  END IF;

  -- ---------------------------------------------------------------- 1) المُشغّلات مركّبة فعلاً
  SELECT count(*) INTO v_cnt FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND NOT tg.tgisinternal AND tg.tgname LIKE 'rbac\_enforce%';
  INSERT INTO _rbac_enf_test VALUES ('triggers_installed', v_cnt >= 25, v_cnt || ' مُشغّل مركّب');

  -- ---------------------------------------------------------------- 2) مستخدم بلا عضوية: إضافة صنف مرفوضة
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ghost, 'role', 'authenticated')::text, false);
  BEGIN
    INSERT INTO public.products (id, name, warehouse_id)
    VALUES (gen_random_uuid(), 'RBAC PROBE PRODUCT', v_wh);
    INSERT INTO _rbac_enf_test VALUES ('ghost_insert_denied', false, 'تمت الإضافة بدون صلاحية');
    DELETE FROM public.products WHERE name = 'RBAC PROBE PRODUCT';
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_enf_test VALUES ('ghost_insert_denied',
      SQLSTATE = '42501' AND position('products.create' in SQLERRM) > 0, SQLSTATE || ': ' || SQLERRM);
  END;

  -- ---------------------------------------------------------------- 3) مسار الحذف: مستخدم بلا عضوية مرفوض
  --    (جدول مؤقت بدل جدول حقيقي حتى لا يُحذف أي بيانات أعمال إذا ضعف الفرض)
  CREATE TEMP TABLE IF NOT EXISTS _rbac_del_probe (id serial, status text, warehouse_id uuid) ON COMMIT DROP;
  DELETE FROM _rbac_del_probe;
  INSERT INTO _rbac_del_probe (status, warehouse_id) VALUES ('draft', v_wh);
  CREATE TRIGGER rbac_del_probe_trg BEFORE DELETE ON _rbac_del_probe
    FOR EACH ROW EXECUTE FUNCTION public.rbac_enforce('suppliers', 'suppliers.delete');
  BEGIN
    DELETE FROM _rbac_del_probe;
    INSERT INTO _rbac_enf_test VALUES ('ghost_delete_denied', false, 'تم الحذف بدون صلاحية');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_enf_test VALUES ('ghost_delete_denied',
      SQLSTATE = '42501' AND position('suppliers.delete' in SQLERRM) > 0, SQLSTATE || ': ' || SQLERRM);
  END;
  SELECT count(*) INTO v_cnt FROM _rbac_del_probe;
  INSERT INTO _rbac_enf_test VALUES ('ghost_delete_left_row', v_cnt = 1, 'الصفوف المتبقية = ' || v_cnt);

  -- ---------------------------------------------------------------- 4) عضو مخزن آخر: كتابة في مخزن غير مخوّل مرفوضة
  IF v_wh2 IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, false);
    BEGIN
      INSERT INTO public.products (id, name, warehouse_id)
      VALUES (gen_random_uuid(), 'RBAC CROSS WH PRODUCT', v_wh2);
      INSERT INTO _rbac_enf_test VALUES ('cross_warehouse_write_denied', false, 'تمت الكتابة في مخزن آخر');
      DELETE FROM public.products WHERE name = 'RBAC CROSS WH PRODUCT';
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _rbac_enf_test VALUES ('cross_warehouse_write_denied',
        SQLSTATE = '42501', SQLSTATE || ': ' || SQLERRM);
    END;
  ELSE
    INSERT INTO _rbac_enf_test VALUES ('cross_warehouse_write_denied', true, 'لا يوجد مخزن ثانٍ — تخطٍ');
  END IF;

  -- ---------------------------------------------------------------- 5) المدير المخوّل: الكتابة تمرّ من بوابة الصلاحية
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, false);
  v_ok := public.has_permission('products.create', v_wh);
  INSERT INTO _rbac_enf_test VALUES ('manager_has_create', v_ok, 'products.create للمدير = ' || v_ok);

  v_extra := gen_random_uuid();
  BEGIN
    INSERT INTO public.products (id, name, warehouse_id) VALUES (v_extra, 'RBAC ALLOWED PRODUCT', v_wh);
    INSERT INTO _rbac_enf_test VALUES ('manager_insert_allowed', true, 'نجحت الإضافة');
    DELETE FROM public.products WHERE id = v_extra;
  EXCEPTION WHEN OTHERS THEN
    -- أي خطأ غير 42501 يعني أن بوابة الصلاحية مرّرت العملية ومنعها قيد آخر
    INSERT INTO _rbac_enf_test VALUES ('manager_insert_allowed', SQLSTATE <> '42501', SQLSTATE || ': ' || SQLERRM);
  END;

  -- ---------------------------------------------------------------- 6) خدمة/مهمة خلفية: بلا فحص صلاحيات
  PERFORM set_config('request.jwt.claims', '', false);
  v_extra := gen_random_uuid();
  BEGIN
    INSERT INTO public.products (id, name, warehouse_id) VALUES (v_extra, 'RBAC SERVICE PRODUCT', v_wh);
    INSERT INTO _rbac_enf_test VALUES ('service_role_bypass', true, 'أُضيف الصنف بلا جلسة');
    DELETE FROM public.products WHERE id = v_extra;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_enf_test VALUES ('service_role_bypass', SQLSTATE <> '42501', SQLSTATE || ': ' || SQLERRM);
  END;

  -- ---------------------------------------------------------------- 7) تغيير الحالة (اعتماد/إلغاء) مرفوض بلا صلاحية
  CREATE TEMP TABLE IF NOT EXISTS _rbac_status_probe (id serial, status text, warehouse_id uuid) ON COMMIT DROP;
  DELETE FROM _rbac_status_probe;
  INSERT INTO _rbac_status_probe (status, warehouse_id) VALUES ('draft', v_wh);
  CREATE TRIGGER rbac_status_probe_trg BEFORE UPDATE ON _rbac_status_probe
    FOR EACH ROW EXECUTE FUNCTION public.rbac_enforce_status(
      '{"approved":"purchases.approve","cancelled":"purchases.cancel"}');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ghost, 'role', 'authenticated')::text, false);
  BEGIN
    UPDATE _rbac_status_probe SET status = 'approved';
    INSERT INTO _rbac_enf_test VALUES ('status_approval_denied', false, 'تم الاعتماد بدون صلاحية');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_enf_test VALUES ('status_approval_denied',
      SQLSTATE = '42501' AND position('purchases.approve' in SQLERRM) > 0, SQLSTATE || ': ' || SQLERRM);
  END;

  -- تغيير حالة غير محمي (draft → draft_edit) يمرّ
  BEGIN
    UPDATE _rbac_status_probe SET status = 'draft_edit';
    INSERT INTO _rbac_enf_test VALUES ('status_non_privileged_allowed', true, 'الحالة غير المحمية تمرّ');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_enf_test VALUES ('status_non_privileged_allowed', false, SQLSTATE || ': ' || SQLERRM);
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, false);
  INSERT INTO _rbac_enf_test VALUES ('manager_has_approve',
    public.has_permission('purchases.approve', v_wh), 'purchases.approve للمدير');
  BEGIN
    UPDATE _rbac_status_probe SET status = 'approved';
    INSERT INTO _rbac_enf_test VALUES ('status_approval_allowed_for_perm',
      public.has_permission('purchases.approve', v_wh), 'المدير اعتمد المستند');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_enf_test VALUES ('status_approval_allowed_for_perm', false, SQLSTATE || ': ' || SQLERRM);
  END;

  -- ---------------------------------------------------------------- 7ب) مبيعات ومدفوعات: مسار العميل المباشر
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ghost, 'role', 'authenticated')::text, false);
  BEGIN
    INSERT INTO public.sales_invoices (id) VALUES (gen_random_uuid());
    INSERT INTO _rbac_enf_test VALUES ('sales_insert_denied', false, 'أُنشئت فاتورة بيع بدون صلاحية');
    DELETE FROM public.sales_invoices WHERE id = (SELECT id FROM public.sales_invoices ORDER BY created_at DESC NULLS LAST LIMIT 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_enf_test VALUES ('sales_insert_denied',
      SQLSTATE = '42501' AND position('sales.create' in SQLERRM) > 0, SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.payments (id) VALUES (gen_random_uuid());
    INSERT INTO _rbac_enf_test VALUES ('payment_insert_denied', false, 'أُنشئت دفعة بدون صلاحية');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_enf_test VALUES ('payment_insert_denied',
      SQLSTATE = '42501' AND position('payments.create' in SQLERRM) > 0, SQLSTATE || ': ' || SQLERRM);
  END;

  CREATE TEMP TABLE IF NOT EXISTS _rbac_cancel_probe (id serial, status text, warehouse_id uuid) ON COMMIT DROP;
  DELETE FROM _rbac_cancel_probe;
  INSERT INTO _rbac_cancel_probe (status, warehouse_id) VALUES ('posted', v_wh);
  CREATE TRIGGER rbac_cancel_probe_trg BEFORE UPDATE ON _rbac_cancel_probe
    FOR EACH ROW EXECUTE FUNCTION public.rbac_enforce_status('{"cancelled":"sales.cancel"}');
  BEGIN
    UPDATE _rbac_cancel_probe SET status = 'cancelled';
    INSERT INTO _rbac_enf_test VALUES ('sales_cancel_denied', false, 'أُلغيت فاتورة بدون صلاحية');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_enf_test VALUES ('sales_cancel_denied',
      SQLSTATE = '42501' AND position('sales.cancel' in SQLERRM) > 0, SQLSTATE || ': ' || SQLERRM);
  END;

  -- ---------------------------------------------------------------- 7ج) الوحدات المستكملة: مرتجعات، توصيل، محاسبة، إعدادات
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ghost, 'role', 'authenticated')::text, false);
  BEGIN
    INSERT INTO public.returns (id) VALUES (gen_random_uuid());
    INSERT INTO _rbac_enf_test VALUES ('return_insert_denied', false, 'أُنشئ مرتجع بدون صلاحية');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_enf_test VALUES ('return_insert_denied',
      SQLSTATE = '42501' AND position('returns.create' in SQLERRM) > 0, SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.delivery (id) VALUES (gen_random_uuid());
    INSERT INTO _rbac_enf_test VALUES ('delivery_insert_denied', false, 'أُنشئت توصيلة بدون صلاحية');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_enf_test VALUES ('delivery_insert_denied',
      SQLSTATE = '42501' AND position('delivery.create' in SQLERRM) > 0, SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.expenses (id) VALUES (gen_random_uuid());
    INSERT INTO _rbac_enf_test VALUES ('expense_insert_denied', false, 'أُنشئ مصروف بدون صلاحية');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_enf_test VALUES ('expense_insert_denied',
      SQLSTATE = '42501' AND position('accounting.create' in SQLERRM) > 0, SQLSTATE || ': ' || SQLERRM);
  END;

  -- الإعدادات: تعديل إعدادات النظام يحتاج settings.manage
  CREATE TEMP TABLE IF NOT EXISTS _rbac_settings_probe (id serial, value text, warehouse_id uuid) ON COMMIT DROP;
  DELETE FROM _rbac_settings_probe;
  INSERT INTO _rbac_settings_probe (value, warehouse_id) VALUES ('a', v_wh);
  CREATE TRIGGER rbac_settings_probe_trg BEFORE UPDATE ON _rbac_settings_probe
    FOR EACH ROW EXECUTE FUNCTION public.rbac_enforce('settings', 'settings.manage');
  BEGIN
    UPDATE _rbac_settings_probe SET value = 'b';
    INSERT INTO _rbac_enf_test VALUES ('settings_update_denied', false, 'عُدّلت الإعدادات بدون صلاحية');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _rbac_enf_test VALUES ('settings_update_denied',
      SQLSTATE = '42501' AND position('settings.manage' in SQLERRM) > 0, SQLSTATE || ': ' || SQLERRM);
  END;

  -- الجرد مستثنى عن قصد (يُكتب عبر RPC فقط) — لا مُشغّل فرض عليه
  SELECT count(*) INTO v_cnt FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
   WHERE c.relname = 'inventory' AND NOT tg.tgisinternal AND tg.tgname LIKE 'rbac%';
  INSERT INTO _rbac_enf_test VALUES ('inventory_excluded_by_design', v_cnt = 0, 'مُشغّلات على الجرد = ' || v_cnt);

  -- ---------------------------------------------------------------- 8) الجداول الآلية مستثناة (لا تُعطّل المبيعات)
  SELECT count(*) INTO v_cnt FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
   WHERE c.relname IN ('journal_entries','notifications') AND NOT tg.tgisinternal
     AND tg.tgname LIKE 'rbac\_enforce%';
  INSERT INTO _rbac_enf_test VALUES ('auto_tables_not_blocked', v_cnt = 0, 'مُشغّلات على جداول آلية = ' || v_cnt);

  -- ---------------------------------------------------------------- 9) الترقية لمرة واحدة حافظت على قدرة الأدوار
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, false);
  INSERT INTO _rbac_enf_test VALUES ('backfill_preserved_capability',
    public.has_permission('products.create', v_wh),
    'products.create للمدير بعد الترقية');

  -- ---------------------------------------------------------------- 10) سجل التعليم في الكتالوج
  SELECT count(*) INTO v_cnt FROM public.permissions WHERE is_enforced;
  INSERT INTO _rbac_enf_test VALUES ('catalog_enforced_expanded', v_cnt >= 60, v_cnt || ' صلاحية معلّمة كمطبقة');

  -- لا تعليم زائف: ما لا يقابله فرض فعلي يجب أن يبقى مخفيًا
  -- (pricing.approve أصبح مفروضًا فعلا في 202610290329 عبر مُشغّل حالة العروض)
  SELECT count(*) INTO v_cnt FROM public.permissions
   WHERE is_enforced AND name IN ('inventory.create','inventory.update','reports.export','settings.update');
  INSERT INTO _rbac_enf_test VALUES ('no_false_enforcement_flags', v_cnt = 0, 'تعليمات زائفة = ' || v_cnt);

  -- pricing.approve مفروض فعليًا: مُشغّل حالة على جدول promotions
  SELECT count(*) INTO v_cnt FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
   WHERE c.relname = 'promotions' AND tg.tgname = 'rbac_enforce_status' AND NOT tg.tgisinternal;
  INSERT INTO _rbac_enf_test VALUES ('pricing_approve_backed',
    v_cnt = 1 AND public.has_permission('pricing.approve', v_wh), 'مُشغّل الاعتماد على العروض = ' || v_cnt);
END
$test$;

SELECT name, ok, detail FROM _rbac_enf_test ORDER BY name;
