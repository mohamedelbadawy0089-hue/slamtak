-- =====================================================================================
-- 202610290323_rbac_enforce_business.sql
-- فرض الصلاحيات الدقيقة فعليًا على جداول الأعمال (وليس على الواجهة فقط).
--
-- 1) rbac_enforce(): مُشغّل BEFORE عام يقرأ الوحدة من وسيط المُشغّل ويقابل
--    INSERT→create / UPDATE→update / DELETE→delete (مع إمكانية تمرير صلاحية صريحة).
--    النطاق: warehouse_id المأخوذ من الصف نفسه، وإلا المخزن الافتراضي للمستخدم.
-- 2) rbac_enforce_status(): يمنع تغيير حالة المستند إلى اعتماد/رفض/إلغاء بدون الصلاحية.
-- 3) مُشغّلات على: الأصناف، الدفعات، الموردين، العملاء، المشتريات (أوامر/فواتير/استلام)،
--    المبيعات (فواتير/بنود)، المدفوعات، الموظفين، التحويلات المخزنية.
-- 4) لا جلسة مستخدم (service_role / مهام خلفية / migrations) ⇒ بلا فحص.
-- 5) صلاحية غير موجودة في الكتالوج ⇒ بلا فحص (لا نعطّل جدولاً غير مصنّف).
-- 6) استثناء مقصود: journal_entries و notifications تُكتب آليًا من مُشغّلات
--    ودوال أخرى، وفرض صلاحية عليها كان سيُعطّل المبيعات والمشتريات.
-- 7) ترقية الأدوار الحالية مرة واحدة (view ⇒ create/update) حتى لا تُعطّل قدرات
--    كانت مسموحة فعلاً عبر RLS قبل هذا التغيير؛ يمكن للمدير تشديدها بعد ذلك.
--
-- آمن للتشغيل المتكرر.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 0) دالة الفحص الأساسية
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rbac_enforce()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_module text := coalesce(nullif(TG_ARGV[0], ''), '');
  v_perm   text := nullif(TG_ARGV[1], '');
  v_action text;
  v_wh     uuid;
  v_row    jsonb;
  v_known  boolean;
BEGIN
  -- بلا جلسة مستخدم: service_role أو مهمة خلفية أو هجرة
  IF auth.uid() IS NULL OR v_module = '' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;

  BEGIN
    v_wh := nullif(v_row ->> 'warehouse_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_wh := NULL;
  END;

  v_action := CASE TG_OP
                WHEN 'INSERT' THEN 'create'
                WHEN 'UPDATE' THEN 'update'
                WHEN 'DELETE' THEN 'delete'
                ELSE lower(TG_OP)
              END;
  v_perm := coalesce(v_perm, v_module || '.' || v_action);

  SELECT EXISTS (SELECT 1 FROM public.permissions p WHERE p.name = public.rbac_normalize(v_perm))
    INTO v_known;
  IF NOT v_known THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF public.has_permission(v_perm, v_wh) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  RAISE EXCEPTION 'غير مصرح: % على % تتطلب صلاحية %', v_action, TG_TABLE_NAME, v_perm
    USING ERRCODE = '42501',
          HINT = 'اطلب من مدير المخزن منحك هذه الصلاحية من صفحة الأدوار والصلاحيات.';
END
$fn$;

-- -------------------------------------------------------------------------------------
-- 1) مُشغّل تغيير الحالة (اعتماد/رفض/إلغاء)
--    وسيط: خريطة JSON من الحالة الجديدة إلى الصلاحية المطلوبة
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rbac_enforce_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_map  jsonb := coalesce(nullif(TG_ARGV[0], '')::jsonb, '{}'::jsonb);
  v_old  text  := coalesce(to_jsonb(OLD) ->> 'status', '');
  v_new  text  := coalesce(to_jsonb(NEW) ->> 'status', '');
  v_perm text;
  v_wh   uuid;
BEGIN
  IF auth.uid() IS NULL OR v_new = v_old THEN
    RETURN NEW;
  END IF;

  v_perm := v_map ->> v_new;
  IF v_perm IS NULL THEN
    RETURN NEW;
  END IF;

  v_wh := nullif(to_jsonb(NEW) ->> 'warehouse_id', '')::uuid;
  IF public.has_permission(v_perm, v_wh) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'غير مصرح: تغيير حالة % إلى "%" يتطلب صلاحية %', TG_TABLE_NAME, v_new, v_perm
    USING ERRCODE = '42501',
          HINT = 'الاعتماد والرفض والإلغاء عمليات حساسة تحتاج صلاحية صريحة.';
END
$fn$;

-- -------------------------------------------------------------------------------------
-- 2) أداة تركيب مُشغّل واحد (تتجاهل الجدول غير الموجود)
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rbac_attach_enforcement(p_table text, p_op text, p_perm text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_trigger text := 'rbac_enforce_' || lower(p_op);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = p_table AND c.relkind IN ('r', 'p')
  ) THEN
    RETURN false;
  END IF;

  EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_trigger, p_table);
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE %s ON public.%I FOR EACH ROW EXECUTE FUNCTION public.rbac_enforce(%L, %L)',
    v_trigger, upper(p_op), p_table, split_part(p_perm, '.', 1), p_perm
  );
  RETURN true;
END
$fn$;

-- -------------------------------------------------------------------------------------
-- 3) التركيب على جداول الأعمال
-- -------------------------------------------------------------------------------------
DO $apply$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('products',           'INSERT', 'products.create'),
      ('products',           'UPDATE', 'products.update'),
      ('products',           'DELETE', 'products.delete'),
      ('inventory_batches',  'INSERT', 'inventory.create'),
      ('inventory_batches',  'UPDATE', 'inventory.update'),
      ('suppliers',          'INSERT', 'suppliers.create'),
      ('suppliers',          'UPDATE', 'suppliers.update'),
      ('suppliers',          'DELETE', 'suppliers.delete'),
      ('customers',          'INSERT', 'customers.create'),
      ('customers',          'UPDATE', 'customers.update'),
      ('customers',          'DELETE', 'customers.delete'),
      ('purchase_orders',    'INSERT', 'purchases.create'),
      ('purchase_orders',    'UPDATE', 'purchases.update'),
      ('purchase_orders',    'DELETE', 'purchases.delete'),
      ('purchase_invoices',  'INSERT', 'purchases.create'),
      ('purchase_invoices',  'UPDATE', 'purchases.update'),
      ('purchase_invoices',  'DELETE', 'purchases.cancel'),
      ('goods_receipts',     'INSERT', 'purchases.create'),
      ('goods_receipts',     'UPDATE', 'purchases.update'),
      ('goods_receipts',     'DELETE', 'purchases.cancel'),
      ('sales_invoices',     'INSERT', 'sales.create'),
      ('sales_invoices',     'UPDATE', 'sales.update'),
      ('sales_invoices',     'DELETE', 'sales.cancel'),
      ('sales_invoice_items','INSERT', 'sales.create'),
      ('sales_invoice_items','UPDATE', 'sales.update'),
      ('payments',           'INSERT', 'payments.create'),
      ('payments',           'UPDATE', 'payments.update'),
      ('payments',           'DELETE', 'payments.cancel'),
      ('employees',          'INSERT', 'hr.create'),
      ('employees',          'UPDATE', 'hr.update'),
      ('employees',          'DELETE', 'hr.delete'),
      ('stock_transfers',    'INSERT', 'inventory.create'),
      ('stock_transfers',    'UPDATE', 'inventory.update')
    ) AS v(t, op, perm)
  LOOP
    PERFORM public.rbac_attach_enforcement(r.t, r.op, r.perm);
  END LOOP;

  -- مُشغّلات تغيير الحالة
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname='public' AND c.relname='purchase_orders' AND c.relkind='r') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS rbac_enforce_status ON public.purchase_orders';
    EXECUTE $q$CREATE TRIGGER rbac_enforce_status
              BEFORE UPDATE ON public.purchase_orders
              FOR EACH ROW EXECUTE FUNCTION public.rbac_enforce_status(
                '{"approved":"purchases.approve","rejected":"purchases.reject","cancelled":"purchases.cancel"}')$q$;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname='public' AND c.relname='purchase_invoices' AND c.relkind='r') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS rbac_enforce_status ON public.purchase_invoices';
    EXECUTE $q$CREATE TRIGGER rbac_enforce_status
              BEFORE UPDATE ON public.purchase_invoices
              FOR EACH ROW EXECUTE FUNCTION public.rbac_enforce_status(
                '{"approved":"purchases.approve","rejected":"purchases.reject","cancelled":"purchases.cancel"}')$q$;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname='public' AND c.relname='sales_invoices' AND c.relkind='r') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS rbac_enforce_status ON public.sales_invoices';
    EXECUTE $q$CREATE TRIGGER rbac_enforce_status
              BEFORE UPDATE ON public.sales_invoices
              FOR EACH ROW EXECUTE FUNCTION public.rbac_enforce_status(
                '{"cancelled":"sales.cancel","void":"sales.cancel","refunded":"returns.approve"}')$q$;
  END IF;
END
$apply$;

-- -------------------------------------------------------------------------------------
-- 4) تعليم ما أصبح مطبّقًا فعليًا (تظهر فقط الصلاحيات المفروضة في المصفوفة)
-- -------------------------------------------------------------------------------------
UPDATE public.permissions SET is_enforced = true
 WHERE name IN (
   'products.create','products.update','products.delete',
   'inventory.create','inventory.update',
   'suppliers.create','suppliers.update','suppliers.delete',
   'customers.create','customers.update','customers.delete',
   'purchases.create','purchases.update','purchases.delete',
   'purchases.approve','purchases.reject','purchases.cancel',
   'sales.create','sales.update','sales.cancel',
   'payments.create','payments.update','payments.cancel',
   'hr.create','hr.update','hr.delete'
 );

-- -------------------------------------------------------------------------------------
-- 5) ترقية لمرة واحدة: الأدوار التي كانت تكتب فعلاً عبر RLS تحتفظ بقدرتها
--    (view ⇒ create/update داخل نفس الوحدة) — لا تُمنح delete.
-- -------------------------------------------------------------------------------------
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, p.id
  FROM public.role_permissions rp
  JOIN public.permissions vp ON vp.id = rp.permission_id
  JOIN public.permissions p
    ON p.category = vp.category
   AND p.name IN (vp.category || '.create', vp.category || '.update')
 WHERE vp.name = vp.category || '.view'
   AND vp.category IN ('products','inventory','suppliers','customers','purchases',
                       'sales','payments','hr','accounting','notifications')
ON CONFLICT DO NOTHING;

-- صلاحية الموظفين الجديدة: من يملك hr.view يصبح قادرًا على إضافة/تعديل الموظفين
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, p.id
  FROM public.role_permissions rp
  JOIN public.permissions vp ON vp.id = rp.permission_id
  JOIN public.permissions p ON p.name IN ('hr.create', 'hr.update')
 WHERE vp.name = 'hr.view'
ON CONFLICT DO NOTHING;
