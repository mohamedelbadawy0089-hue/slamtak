-- =====================================================================================
-- 202610290328_rbac_read_gating_rls.sql
-- فرض صلاحيات القراءة على مستوى قاعدة البيانات (وليس إخفاء الأزرار فقط).
--
-- الأسلوب:
--   * دالة rbac_view_warehouses(module) ترجع مخازن المستخدم التي يملك فيها "module.view".
--     تُستدعى مرة واحدة لكل استعلام (وسيط ثابت) بدل حساب الصلاحيات لكل صف.
--   * سياسة RESTRICTIVE للقراءة على الجداول الحساسة: تُضاف فوق السياسات القائمة
--     (AND) ولا تلغيها — فلا تُوسّع الوصول لأحد، وقد تُضيّقه على من لا يملك العرض.
--   * لا تُطبّق على جدول RLS فيه معطّل (تفعيله بلا سياسات يمنع كل القراءات)،
--     ولا على anon (الحسابات العامة لا تقرأ جداول الأعمال).
--   * service_role / postgres يتجاوزان RLS بحكم PostgreSQL.
--
-- آمن للتشغيل المتكرر.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1) المخازن التي يملك فيها المستخدم صلاحية عرض الوحدة
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rbac_view_warehouses(p_module text)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT coalesce(array_agg(DISTINCT uw.warehouse_id), ARRAY[]::uuid[])
    FROM public.user_warehouses uw
   WHERE uw.user_id = auth.uid()
     AND public.has_permission(p_module || '.view', uw.warehouse_id);
$fn$;

-- نسخة لجدول بلا عمود warehouse_id (بيانات أساسية مشتركة)
CREATE OR REPLACE FUNCTION public.rbac_can_view_module(p_module text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT auth.uid() IS NOT NULL
     AND coalesce(array_length(public.rbac_view_warehouses(p_module), 1), 0) > 0;
$fn$;

-- -------------------------------------------------------------------------------------
-- 2) تركيب سياسات القراءة على الجداول التي RLS مفعّل عليها
-- -------------------------------------------------------------------------------------
DO $apply$
DECLARE
  r record;
  v_rls boolean;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('products',            'products',  'warehouse_id'),
      ('master_products',     'products',  NULL),
      ('product_categories',  'products',  NULL),
      ('suppliers',           'suppliers', 'warehouse_id'),
      ('customers',           'customers', 'warehouse_id'),
      ('purchase_orders',     'purchases', 'warehouse_id'),
      ('purchase_invoices',   'purchases', 'warehouse_id'),
      ('goods_receipts',      'purchases', 'warehouse_id'),
      ('sales_invoices',      'sales',     'warehouse_id'),
      ('sales_invoice_items', 'sales',     NULL),
      ('sales_orders',        'sales',     'warehouse_id'),
      ('payments',            'payments',  'warehouse_id'),
      ('employees',           'hr',        'warehouse_id'),
      ('returns',             'returns',   'warehouse_id'),
      ('delivery',            'delivery',  'warehouse_id'),
      ('expenses',            'accounting','warehouse_id'),
      ('inventory',           'inventory', 'warehouse_id')
    ) AS v(t, m, scope)
  LOOP
    SELECT c.relrowsecurity INTO v_rls
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = r.t;

    IF v_rls IS NULL THEN
      RAISE NOTICE 'تخطي % — الجدول غير موجود', r.t;
      CONTINUE;
    END IF;
    IF NOT v_rls THEN
      RAISE NOTICE 'تخطي % — RLS غير مفعّل عليه', r.t;
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS rbac_read_gate ON public.%I', r.t);
    IF r.scope IS NULL THEN
      EXECUTE format(
        'CREATE POLICY rbac_read_gate ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.rbac_can_view_module(%L))',
        r.t, r.m);
    ELSE
      -- بعض الجداول تخزّن warehouse_id كنص — المقارنة تُجرى بعد تحويل الطرفين إلى نص
      EXECUTE format(
        'CREATE POLICY rbac_read_gate ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (warehouse_id::text = ANY (public.rbac_view_warehouses(%L)::text[]))',
        r.t, r.m);
    END IF;
  END LOOP;
END
$apply$;

-- -------------------------------------------------------------------------------------
-- 3) تقرير: ما فُرضت عليه القراءة فعلاً
-- -------------------------------------------------------------------------------------
SELECT
  (SELECT jsonb_agg(t ORDER BY t) FROM (
     SELECT c.relname AS t
       FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      WHERE p.polname = 'rbac_read_gate'
  ) g) AS gated_tables,
  (SELECT count(*) FROM pg_policy WHERE polname = 'rbac_read_gate') AS gated_count;
