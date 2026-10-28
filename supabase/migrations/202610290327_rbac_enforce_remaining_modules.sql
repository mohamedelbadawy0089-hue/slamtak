-- =====================================================================================
-- 202610290327_rbac_enforce_remaining_modules.sql
-- استكمال ربط الصلاحيات بوحدات لها جداول حقيقية:
--   المرتجعات، التوصيل، المحاسبة (مصروفات/شجرة حسابات/فترات مالية)، بنود فواتير الشراء،
--   أوامر وعروض البيع، البيانات الأساسية للأصناف، الإعدادات، مسارات الموافقة.
--
-- وتصحيح تعليم صلاحيات كانت معلّمة «مطبقة» بلا فرض فعلي:
--   inventory.create / inventory.update  (لا يوجد جدول batches؛ الجرد يُكتب عبر RPC فقط)
--   pricing.approve                      (لا يوجد جدول عروض/قوائم أسعار)
--   reports.export                       (التصدير يتم في المتصفح)
--
-- الجداول الآلية المستثناة كما هي: journal_entries، journal_entry_lines،
-- general_ledger، notifications، approval_logs، inventory، audit_logs.
-- آمن للتشغيل المتكرر.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1) تصحيح التعليم: صلاحيات بلا فرض فعلي تُخفى من المصفوفة
-- -------------------------------------------------------------------------------------
UPDATE public.permissions SET is_enforced = false
 WHERE name IN ('inventory.create', 'inventory.update', 'pricing.approve', 'reports.export');

-- -------------------------------------------------------------------------------------
-- 2) تركيب مُشغّلات الوحدات المتبقية
-- -------------------------------------------------------------------------------------
DO $apply$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('returns',              'INSERT', 'returns.create'),
      ('returns',              'DELETE', 'returns.cancel'),
      ('return_items',         'INSERT', 'returns.create'),
      ('return_items',         'DELETE', 'returns.create'),
      ('delivery',             'INSERT', 'delivery.create'),
      ('delivery',             'UPDATE', 'delivery.update'),
      ('expenses',             'INSERT', 'accounting.create'),
      ('expenses',             'UPDATE', 'accounting.update'),
      ('chart_of_accounts',    'INSERT', 'accounting.create'),
      ('chart_of_accounts',    'UPDATE', 'accounting.update'),
      ('financial_periods',    'UPDATE', 'accounting.approve'),
      ('purchase_invoice_items','INSERT','purchases.create'),
      ('purchase_invoice_items','UPDATE','purchases.update'),
      ('purchase_invoice_items','DELETE','purchases.delete'),
      ('purchase_requests',    'INSERT', 'purchases.create'),
      ('purchase_requests',    'UPDATE', 'purchases.update'),
      ('sales_orders',         'INSERT', 'sales.create'),
      ('sales_orders',         'UPDATE', 'sales.update'),
      ('sales_order_items',    'INSERT', 'sales.create'),
      ('sales_order_items',    'UPDATE', 'sales.update'),
      ('sales_quotes',         'INSERT', 'sales.create'),
      ('sales_quotes',         'UPDATE', 'sales.update'),
      ('master_products',      'INSERT', 'products.create'),
      ('master_products',      'UPDATE', 'products.update'),
      ('master_products',      'DELETE', 'products.delete'),
      ('product_categories',   'INSERT', 'products.create'),
      ('product_categories',   'UPDATE', 'products.update'),
      ('warehouse_zones',      'INSERT', 'products.create'),
      ('warehouse_zones',      'UPDATE', 'products.update'),
      ('settings',             'INSERT', 'settings.manage'),
      ('settings',             'UPDATE', 'settings.manage'),
      ('approval_workflows',   'INSERT', 'settings.manage'),
      ('approval_workflows',   'DELETE', 'settings.manage')
    ) AS v(t, op, perm)
  LOOP
    PERFORM public.rbac_attach_enforcement(r.t, r.op, r.perm);
  END LOOP;

  -- تغيير حالة المرتجعات
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname = 'returns' AND c.relkind = 'r') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS rbac_enforce_status ON public.returns';
    EXECUTE $q$CREATE TRIGGER rbac_enforce_status
              BEFORE UPDATE ON public.returns
              FOR EACH ROW EXECUTE FUNCTION public.rbac_enforce_status(
                '{"approved":"returns.approve","rejected":"returns.reject","cancelled":"returns.cancel","completed":"returns.approve"}')$q$;
  END IF;
END
$apply$;

-- -------------------------------------------------------------------------------------
-- 3) التعليم: ما أصبح مفروضًا فعليًا
-- -------------------------------------------------------------------------------------
UPDATE public.permissions SET is_enforced = true
 WHERE name IN ('returns.create','returns.approve','returns.reject','returns.cancel',
                'delivery.create','delivery.update',
                'accounting.create','accounting.update','accounting.approve',
                'settings.update','settings.manage');

-- -------------------------------------------------------------------------------------
-- 4) الحفاظ على القدرة السابقة في الوحدات الجديدة (view ⇒ create/update)
--    ولا تُمنح صلاحيات الاعتماد/الإلغاء إلا للمديرين.
-- -------------------------------------------------------------------------------------
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, p.id
  FROM public.role_permissions rp
  JOIN public.permissions vp ON vp.id = rp.permission_id
  JOIN public.permissions p
    ON p.category = vp.category AND p.name IN (vp.category || '.create', vp.category || '.update')
 WHERE vp.name IN (vp.category || '.view', vp.category || '.read')
   AND vp.category IN ('returns', 'delivery', 'accounting')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT DISTINCT r.id, p.id
  FROM public.roles r
  JOIN public.permissions p
    ON p.name IN ('returns.approve','returns.reject','returns.cancel','accounting.approve','settings.manage')
 WHERE r.deleted_at IS NULL
   AND lower(btrim(r.name)) IN ('warehouse manager','tenant admin','super admin','manager','admin')
ON CONFLICT DO NOTHING;

-- -------------------------------------------------------------------------------------
-- 5) ملخّص
-- -------------------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM public.permissions WHERE is_enforced) AS enforced_perms,
  (SELECT count(*) FROM public.permissions WHERE NOT is_enforced) AS hidden_perms,
  (SELECT count(DISTINCT c.relname) FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE NOT tg.tgisinternal AND tg.tgname LIKE 'rbac%') AS tables_with_triggers;
