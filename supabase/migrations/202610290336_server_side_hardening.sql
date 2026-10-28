-- =====================================================================================
-- 202610290336_server_side_hardening.sql
-- نقل الحماية والمنطق الحساس إلى الخادم بالكامل:
--
-- 1) مُشغّلات أذونات عبر الصف الأب: بنود لوائح المشتريات/الاستلام/التحويلات تخضع
--    لصلاحية وحدة الأب نفسها — لا استلال الإذن من الواجهة أو من بند لانه.
-- 2) جداول يكتبها الخادم حصرًا (سجل المخزون وحركاته، الأصناف المرتة، الاستيراد،
--    الخطط…): إسقاط سياسات الكتابة العامة والاكتفاء بالقراءة المُشتقّة. أي كتابة
--    من العميل عبر PostgREST تُرفض؛ وتتم داخل دوال SECURITY DEFINER.
-- 3) جداول الهوية (المخازن/العملاء/المستخدمون/الملفات الشخصية/تخزين كلمات
--    المرور/التدقيق): منع الكتابة المباشرة من العميل، والإبقاء على القراءة، مع
--    دوال خادمية جديدة للعمليات التي كانت تتم من المتصفح:
--      * wms_register_workspace()  — إنشاء المخزن/الملف/بصمة المدير بعد إنشاء الحساب.
--      * wms_manager_password_set()— حفظ كلمة مرور المدير في الدخول الأول.
--      * audit_log_client()        — كتابة الأحداث من الواجهة بهوية مشتقّة من الخادم.
-- 4) كل دوال الجديدة SECURITY DEFINER مع بحث الهوية والنطاق في الخادم فقط
--    (العميل لا يرسل tenant_id ولا user_id ولا مخزن).
-- آمن للتشغيل المتكرر.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1) مُشغّل أذونات عبر الصف الأب
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rbac_enforce_via_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_parent_tbl text := TG_ARGV[0];
  v_pk_col     text := TG_ARGV[1];
  v_fk_col     text := TG_ARGV[2];
  v_perm       text := TG_ARGV[3];
  v_row        jsonb;
  v_wh         uuid;
  v_known      boolean;
BEGIN
  -- بلا جلسة مستخدم: service_role أو مهمة خلفية أو هجرة
  IF auth.uid() IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF coalesce(current_setting('app.rbac_system', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.permissions p WHERE p.name = public.rbac_normalize(v_perm))
    INTO v_known;
  IF NOT v_known THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;

  BEGIN
    EXECUTE format(
      'SELECT warehouse_id FROM public.%I WHERE %I = $1::text::uuid LIMIT 1',
      v_parent_tbl, v_pk_col)
      INTO v_wh
      USING (v_row ->> v_fk_col);
  EXCEPTION WHEN OTHERS THEN
    v_wh := NULL;
  END;

  IF v_wh IS NULL OR public.has_permission(v_perm, v_wh) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  RAISE EXCEPTION 'غير مصرح: تعديل بنود % يتطلب صلاحية % على مخزن الأب', v_parent_tbl, v_perm
    USING ERRCODE = '42501',
          HINT = 'بلغ مدير المخزن لمنحك صلاحية الأب المطلوبة من صفحة الأدوار والصلاحيات.';
END
$fn$;

-- -------------------------------------------------------------------------------------
-- 2) تركيب المُشغّلات على بنود المستندات (صلاحية الأب)
-- -------------------------------------------------------------------------------------
DO $mig$
DECLARE
  v_tbl text; v_parent text; v_pk text; v_fk text;
BEGIN
  -- 2.1 بنود أوامر الشراء → purchases.*
  EXECUTE 'DROP TRIGGER IF EXISTS rbac_enforce_ip ON public.purchase_order_items';
  CREATE TRIGGER rbac_enforce_ip BEFORE INSERT ON public.purchase_order_items
    FOR EACH ROW EXECUTE FUNCTION public.rbac_enforce_via_parent('purchase_orders','id','purchase_order_id','purchases.create');
  EXECUTE 'DROP TRIGGER IF EXISTS rbac_enforce_up ON public.purchase_order_items';
  CREATE TRIGGER rbac_enforce_up BEFORE UPDATE ON public.purchase_order_items
    FOR EACH ROW EXECUTE FUNCTION public.rbac_enforce_via_parent('purchase_orders','id','purchase_order_id','purchases.update');
  EXECUTE 'DROP TRIGGER IF EXISTS rbac_enforce_dp ON public.purchase_order_items';
  CREATE TRIGGER rbac_enforce_dp BEFORE DELETE ON public.purchase_order_items
    FOR EACH ROW EXECUTE FUNCTION public.rbac_enforce_via_parent('purchase_orders','id','purchase_order_id','purchases.delete');

  -- 2.2 بنود إشعارات الاستلام → نفس وحدة الأب (إلغاء الاستلام يُعامل كإلغاء)
  EXECUTE 'DROP TRIGGER IF EXISTS rbac_enforce_ig ON public.goods_receipt_items';
  CREATE TRIGGER rbac_enforce_ig BEFORE INSERT ON public.goods_receipt_items
    FOR EACH ROW EXECUTE FUNCTION public.rbac_enforce_via_parent('goods_receipts','id','goods_receipt_id','purchases.create');
  EXECUTE 'DROP TRIGGER IF EXISTS rbac_enforce_ug ON public.goods_receipt_items';
  CREATE TRIGGER rbac_enforce_ug BEFORE UPDATE ON public.goods_receipt_items
    FOR EACH ROW EXECUTE FUNCTION public.rbac_enforce_via_parent('goods_receipts','id','goods_receipt_id','purchases.update');
  EXECUTE 'DROP TRIGGER IF EXISTS rbac_enforce_dg ON public.goods_receipt_items';
  CREATE TRIGGER rbac_enforce_dg BEFORE DELETE ON public.goods_receipt_items
    FOR EACH ROW EXECUTE FUNCTION public.rbac_enforce_via_parent('goods_receipts','id','goods_receipt_id','purchases.cancel');

  -- 2.3 بنود التحويلات المخزنية → inventory.*
  EXECUTE 'DROP TRIGGER IF EXISTS rbac_enforce_it ON public.stock_transfer_items';
  CREATE TRIGGER rbac_enforce_it BEFORE INSERT ON public.stock_transfer_items
    FOR EACH ROW EXECUTE FUNCTION public.rbac_enforce_via_parent('stock_transfers','id','stock_transfer_id','inventory.create');
  EXECUTE 'DROP TRIGGER IF EXISTS rbac_enforce_ut ON public.stock_transfer_items';
  CREATE TRIGGER rbac_enforce_ut BEFORE UPDATE ON public.stock_transfer_items
    FOR EACH ROW EXECUTE FUNCTION public.rbac_enforce_via_parent('stock_transfers','id','stock_transfer_id','inventory.update');
  EXECUTE 'DROP TRIGGER IF EXISTS rbac_enforce_dt ON public.stock_transfer_items';
  CREATE TRIGGER rbac_enforce_dt BEFORE DELETE ON public.stock_transfer_items
    FOR EACH ROW EXECUTE FUNCTION public.rbac_enforce_via_parent('stock_transfers','id','stock_transfer_id','inventory.delete');
END
$mig$;

-- -------------------------------------------------------------------------------------
-- 3) جداول الخادم حصرًا: تحويل سياسة الكتابة العامة إلى قراءة فقط للعميل
--    (الدوال SECURITY DEFINER تتعامل كمالك/ممتاز فلا تتأثر بحجب RLS للكتابة)
-- -------------------------------------------------------------------------------------
DO $mig$
DECLARE
  r record;
  v_expr text;
  v_tbl text;
  v_tbls text[] := ARRAY [
    'inventory', 'inventory_movements', 'categories', 'manufacturers',
    'warehouse_products_flexible', 'preparation_phone', 'subscription_plans',
    'bulk_import_column_map', 'import_logs',
    'warehouses', 'tenants', 'users', 'profiles', 'warehouse_password_hashes', 'audit_logs'
  ];
BEGIN
  FOREACH v_tbl IN ARRAY v_tbls LOOP
    -- أ) سياسات الكتابة الجزئية (INSERT/UPDATE/DELETE) تُسقط ولا تُستبدل:
    --    العميل لا يكتب هذه الجداول؛ الكتابة عبر دوال SECURITY DEFINER فقط.
    FOR r IN
      SELECT p.polname
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = v_tbl
         AND p.polcmd = ANY (ARRAY['i', 'u', 'd', 'w'])
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.polname, v_tbl);
    END LOOP;

    -- ب) سياسات ALL تُحوّل إلى قراءة فقط بنفس شروط النطاق القديمة
    FOR r IN
      SELECT p.polname AS name, pg_get_expr(p.polqual, p.polrelid) AS qual
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = v_tbl
         AND p.polcmd = '*'
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', r.name, v_tbl);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_tbl || '_client_read', v_tbl);
      v_expr := r.qual;
      IF v_tbl = 'warehouse_password_hashes' OR v_expr IS NULL THEN
        IF v_tbl = 'warehouse_password_hashes' THEN
          -- بصمات كلمات المرور: المستخدم يقرأ بصمته فقط (حرية شاشة الدخول القديمة)
          EXECUTE
            'CREATE POLICY '||v_tbl||'_client_read ON public.'||v_tbl||
            ' FOR SELECT TO authenticated USING (user_id = auth.uid())';
        ELSE
          EXECUTE
            'CREATE POLICY '||v_tbl||'_client_read ON public.'||v_tbl||
            ' FOR SELECT TO authenticated USING (true)';
        END IF;
      ELSE
        EXECUTE
          'CREATE POLICY '||v_tbl||'_client_read ON public.'||v_tbl||
          ' FOR SELECT TO authenticated USING ('||v_expr||')';
      END IF;
    END LOOP;
  END LOOP;
END
$mig$;

-- -------------------------------------------------------------------------------------
-- 4) دوال الخادم للما كان يُنفَّذ من المتصفح
-- -------------------------------------------------------------------------------------
-- 4.1 إنشاء مساحة عمل المدير بعد إنشاء الحساب (مستأجر/مخزن/ملف/بصمة كلمة مرور/عضوية)
CREATE OR REPLACE FUNCTION public.wms_register_workspace(
  p_name text,
  p_phone text DEFAULT '',
  p_governorate text DEFAULT '',
  p_admin_hash text DEFAULT ''::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_wh     uuid;
  v_name   text := btrim(coalesce(p_name, ''));
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'إنشاء مساحة العمل يتطلب جلسة مستخدم' USING ERRCODE = '42501';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'اسم المخزن إلزامي' USING ERRCODE = '23514';
  END IF;

  -- المستأجر: أول مستأجر قائم، وإلّا يُنشأ اسمه اسم المخزن (نفس سلوك التسجيل السابق)
  SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at LIMIT 1;
  IF v_tenant IS NULL THEN
    INSERT INTO public.tenants (name) VALUES (v_name) RETURNING id INTO v_tenant;
  END IF;

  -- المخزن: كل الأعمدة إن وُجدت مع رجوع تدريجي
  BEGIN
    INSERT INTO public.warehouses (tenant_id, name, phone, governorate, is_main, password_hash, manager_id)
    VALUES (v_tenant, v_name, nullif(p_phone, ''), nullif(p_governorate, ''), true, nullif(p_admin_hash, ''), v_user)
    RETURNING id INTO v_wh;
  EXCEPTION WHEN undefined_column THEN
    BEGIN
      WITH ins AS (
        INSERT INTO public.warehouses (tenant_id, name, phone, governorate, is_main, manager_id)
        VALUES (v_tenant, v_name, nullif(p_phone, ''), nullif(p_governorate, ''), true, v_user)
        RETURNING id
      )
      SELECT id INTO v_wh FROM ins;
    EXCEPTION WHEN undefined_column THEN
      BEGIN
        WITH ins2 AS (
          INSERT INTO public.warehouses (tenant_id, name, phone, governorate, is_main)
          VALUES (v_tenant, v_name, nullif(p_phone, ''), nullif(p_governorate, ''), true)
          RETURNING id
        )
        SELECT id INTO v_wh FROM ins2;
      EXCEPTION WHEN undefined_column THEN
        INSERT INTO public.warehouses (tenant_id, name) VALUES (v_tenant, v_name)
        RETURNING id INTO v_wh;
      END;
    END;
  END;

  -- الملف الشخصي: لا نكتب فوق صف موجود (المتصفح كان يفعل ذلك)
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user) THEN
    BEGIN
      INSERT INTO public.profiles (id, full_name, phone, governorate, role)
      VALUES (v_user, v_name, nullif(p_phone, ''), nullif(p_governorate, ''), 'manager');
    EXCEPTION WHEN undefined_column THEN
      INSERT INTO public.profiles (id, full_name) VALUES (v_user, v_name);
    END;
  END IF;

  -- بصمة كلمة مرور المدير (Shea-256 base64url كما في الخادم)
  IF coalesce(p_admin_hash, '') <> '' AND NOT EXISTS (
      SELECT 1 FROM public.warehouse_password_hashes WHERE user_id = v_user) THEN
    INSERT INTO public.warehouse_password_hashes (user_id, hash) VALUES (v_user, p_admin_hash);
  END IF;

  -- ربط المدير بمخزنه إن لم يحدث ذلك بمُشغّل التسجيل
  IF NOT EXISTS (SELECT 1 FROM public.user_warehouses
                 WHERE user_id = v_user AND warehouse_id = v_wh) THEN
    BEGIN
      INSERT INTO public.user_warehouses (user_id, warehouse_id, tenant_id, is_default)
      VALUES (v_user, v_wh, v_tenant, true);
    EXCEPTION WHEN undefined_column THEN
      INSERT INTO public.user_warehouses (user_id, warehouse_id, tenant_id)
      VALUES (v_user, v_wh, v_tenant);
    END;
  END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
  VALUES (v_tenant, v_user, v_wh, 'register_workspace_created', 'warehouses', v_wh,
          jsonb_build_object('name', v_name, 'phone', nullif(p_phone, ''), 'governorate', nullif(p_governorate, '')));

  RETURN jsonb_build_object('tenant_id', v_tenant, 'warehouse_id', v_wh);
END
$fn$;

-- 4.2 حفظ كلمة مرور المدير عند الدخول الأول (الدخول بخطوتين)
CREATE OR REPLACE FUNCTION public.wms_manager_password_set(p_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_wh   uuid := NULL;
  v_rows int  := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'حفظ كلمة مرور المدير يتطلب جلسة مستخدم' USING ERRCODE = '42501';
  END IF;
  IF p_hash IS NULL OR btrim(p_hash) = '' OR char_length(p_hash) < 8 THEN
    RAISE EXCEPTION 'بصمة كلمة مرور غير صالحة' USING ERRCODE = '23514';
  END IF;

  UPDATE public.warehouses SET password_hash = p_hash WHERE manager_id = v_user RETURNING id INTO v_wh;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF EXISTS (SELECT 1 FROM public.warehouse_password_hashes WHERE user_id = v_user) THEN
    UPDATE public.warehouse_password_hashes SET hash = p_hash WHERE user_id = v_user;
  ELSE
    INSERT INTO public.warehouse_password_hashes (user_id, hash) VALUES (v_user, p_hash);
  END IF;

  INSERT INTO public.audit_logs (user_id, warehouse_id, action, entity_type, entity_id, new_values)
  VALUES (v_user, v_wh, 'manager_password_set', 'warehouses', v_wh,
          jsonb_build_object('warehouses_updated', v_rows, 'note', 'بصمة SHA-256 base64url؛ لا كلمة مرور صريحة'));

  RETURN jsonb_build_object('warehouses_updated', v_rows, 'warehouse_id', v_wh);
END
$fn$;

-- 4.3 كتابة أحداث التدقيق من الواجهة بهوية مشتقّة من الخادم فقط
CREATE OR REPLACE FUNCTION public.audit_log_client(
  p_action text,
  p_entity_type text DEFAULT 'web',
  p_entity_id uuid DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_membership user_warehouses%ROWTYPE;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'تسجيل حدث التدقيق يتطلب جلسة مستخدم' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR btrim(p_action) = '' OR char_length(btrim(p_action)) > 100 THEN
    RAISE EXCEPTION 'نوع الحدث إلزامي (100 حرف كحد أقصى)' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_membership FROM public.user_warehouses
   WHERE user_id = v_user
   ORDER BY is_default DESC NULLS LAST, created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الأحداث تُسجل فقط لعضو مخزن معروف' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
  VALUES (v_membership.tenant_id, v_user, v_membership.warehouse_id,
          p_action, coalesce(p_entity_type, 'web'), p_entity_id,
          jsonb_build_object('source', 'web', 'details', p_details, 'at', now()))
  RETURNING id INTO v_id;

  RETURN v_id;
END
$fn$;

-- -------------------------------------------------------------------------------------
-- 5) الصلاحيات على الدوال الجديدة
-- -------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.wms_register_workspace(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wms_manager_password_set(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_log_client(text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wms_register_workspace(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wms_manager_password_set(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.audit_log_client(text, text, uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.rbac_enforce_via_parent() FROM PUBLIC;

-- -------------------------------------------------------------------------------------
-- 6) ملخّص
-- -------------------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND t.tgname LIKE 'rbac_enforce_%'
     AND c.relname IN ('purchase_order_items','goods_receipt_items','stock_transfer_items')
     AND NOT t.tgisinternal) AS parent_triggers,
  (SELECT count(*) FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND p.polcmd IN ('ALL','I','U','D','*')
     AND c.relname IN ('inventory','inventory_movements','categories','manufacturers',
                       'warehouse_products_flexible','preparation_phone','subscription_plans',
                       'bulk_import_column_map','import_logs','warehouses','tenants','users',
                       'profiles','warehouse_password_hashes','audit_logs')) AS remaining_write_policies,
  (SELECT count(*) FROM information_schema.routines
   WHERE routine_schema = 'public'
     AND routine_name IN ('wms_register_workspace','wms_manager_password_set','audit_log_client')) AS new_rpc_fns;
