-- =====================================================================================
-- 202610290329_rbac_missing_modules_schema.sql
-- بناء الوحدات التي كانت صلاحياتها معطّلة لعدم وجود جداول:
--   الرواتب (payroll)، العروض وقوائم الأسعار (pricing)، خدمة العملاء (customer_service)،
--   الأتمتة (automation).
--
-- لكل جدول: مفتاح أساسي uuid، نطاق مؤسسة/مخزن، قيود تحقق، فهارس، RLS مفعّل،
-- سياسة وصول للأعضاء، وسياسة قراءة RESTRICTIVE مرتبطة بـ <module>.view،
-- ثم مُشغّلات فرض الإنشاء/التعديل/الحذف وتغيير الحالة عبر rbac_enforce.
--
-- آمن للتشغيل المتكرر.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1) الجداول
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  warehouse_id     uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  status           text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','pending_approval','approved','paid','cancelled')),
  total_gross      numeric(14,2) NOT NULL DEFAULT 0,
  total_deductions numeric(14,2) NOT NULL DEFAULT 0,
  total_net        numeric(14,2) NOT NULL DEFAULT 0,
  notes            text,
  approved_by      uuid,
  approved_at      timestamptz,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_period_valid CHECK (period_end >= period_start),
  CONSTRAINT payroll_amounts_non_negative CHECK (total_gross >= 0 AND total_deductions >= 0 AND total_net >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_runs_period
  ON public.payroll_runs (warehouse_id, period_start, period_end)
  WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS ix_payroll_runs_scope
  ON public.payroll_runs (warehouse_id, status, period_start DESC);

CREATE TABLE IF NOT EXISTS public.payroll_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  employee_id    uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  base_salary    numeric(14,2) NOT NULL DEFAULT 0,
  allowances     numeric(14,2) NOT NULL DEFAULT 0,
  deductions     numeric(14,2) NOT NULL DEFAULT 0,
  net_salary     numeric(14,2) NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_item_amounts CHECK (base_salary >= 0 AND allowances >= 0 AND deductions >= 0),
  UNIQUE (payroll_run_id, employee_id)
);

CREATE TABLE IF NOT EXISTS public.promotions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  warehouse_id     uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  name             text NOT NULL,
  name_ar          text,
  kind             text NOT NULL DEFAULT 'percent'
                   CHECK (kind IN ('percent','amount','buy_x_get_y','bundle')),
  value            numeric(14,2) NOT NULL DEFAULT 0 CHECK (value >= 0),
  min_order_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (min_order_amount >= 0),
  max_discount     numeric(14,2) CHECK (max_discount IS NULL OR max_discount >= 0),
  budget           numeric(14,2),
  usage_limit      integer CHECK (usage_limit IS NULL OR usage_limit >= 0),
  used_count       integer NOT NULL DEFAULT 0,
  applies_to       text NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all','products','categories')),
  starts_at        timestamptz NOT NULL DEFAULT now(),
  ends_at          timestamptz,
  status           text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','pending_approval','approved','rejected','active','paused','expired')),
  approved_by      uuid,
  approved_at      timestamptz,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_window_valid CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS ix_promotions_scope
  ON public.promotions (warehouse_id, status, starts_at DESC);

CREATE TABLE IF NOT EXISTS public.price_lists (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE CASCADE,
  name         text NOT NULL,
  name_ar      text,
  currency     text NOT NULL DEFAULT 'EGP',
  valid_from   date NOT NULL DEFAULT current_date,
  valid_to     date,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  is_default   boolean NOT NULL DEFAULT false,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_list_window_valid CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS ix_price_lists_scope ON public.price_lists (warehouse_id, status);

CREATE TABLE IF NOT EXISTS public.price_list_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id uuid NOT NULL REFERENCES public.price_lists(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  price         numeric(14,2) NOT NULL CHECK (price >= 0),
  min_qty       numeric(14,3) NOT NULL DEFAULT 1 CHECK (min_qty > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (price_list_id, product_id, min_qty)
);

CREATE TABLE IF NOT EXISTS public.customer_service_tickets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  warehouse_id  uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  ticket_number text NOT NULL,
  subject       text NOT NULL,
  description   text,
  category      text,
  priority      text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status        text NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','in_progress','resolved','closed','rejected')),
  customer_id   uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  assigned_to   uuid,
  resolution    text,
  resolved_at   timestamptz,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_cs_tickets_number
  ON public.customer_service_tickets (warehouse_id, ticket_number);
CREATE INDEX IF NOT EXISTS ix_cs_tickets_scope
  ON public.customer_service_tickets (warehouse_id, status, priority);

CREATE TABLE IF NOT EXISTS public.automation_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  warehouse_id  uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  name          text NOT NULL,
  trigger_event text NOT NULL,
  action_type   text NOT NULL,
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, name)
);

CREATE INDEX IF NOT EXISTS ix_automation_rules_scope
  ON public.automation_rules (warehouse_id, trigger_event) WHERE is_active;

-- -------------------------------------------------------------------------------------
-- 2) تفعيل RLS
-- -------------------------------------------------------------------------------------
ALTER TABLE public.payroll_runs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_lists              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_list_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_service_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rules         ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------------------------------
-- 3) سياسات الوصول للأعضاء (permissive) + سياسة قراءة مرتبطة بالصلاحية (restrictive)
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS payroll_runs_member ON public.payroll_runs;
DROP POLICY IF EXISTS payroll_runs_read_gate ON public.payroll_runs;
CREATE POLICY payroll_runs_member ON public.payroll_runs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_warehouses uw
                  WHERE uw.user_id = auth.uid() AND uw.warehouse_id = payroll_runs.warehouse_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_warehouses uw
                  WHERE uw.user_id = auth.uid() AND uw.warehouse_id = payroll_runs.warehouse_id));
CREATE POLICY payroll_runs_read_gate ON public.payroll_runs AS RESTRICTIVE FOR SELECT TO authenticated
  USING (warehouse_id::text = ANY (public.rbac_view_warehouses('payroll')::text[]));

DROP POLICY IF EXISTS payroll_items_member ON public.payroll_items;
DROP POLICY IF EXISTS payroll_items_read_gate ON public.payroll_items;
CREATE POLICY payroll_items_member ON public.payroll_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.payroll_runs pr
                   JOIN public.user_warehouses uw ON uw.warehouse_id = pr.warehouse_id
                  WHERE pr.id = payroll_items.payroll_run_id AND uw.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.payroll_runs pr
                   JOIN public.user_warehouses uw ON uw.warehouse_id = pr.warehouse_id
                  WHERE pr.id = payroll_items.payroll_run_id AND uw.user_id = auth.uid()));
CREATE POLICY payroll_items_read_gate ON public.payroll_items AS RESTRICTIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.payroll_runs pr
                  WHERE pr.id = payroll_items.payroll_run_id
                    AND pr.warehouse_id::text = ANY (public.rbac_view_warehouses('payroll')::text[])));

DROP POLICY IF EXISTS promotions_member ON public.promotions;
DROP POLICY IF EXISTS promotions_read_gate ON public.promotions;
CREATE POLICY promotions_member ON public.promotions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_warehouses uw
                  WHERE uw.user_id = auth.uid() AND uw.warehouse_id = promotions.warehouse_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_warehouses uw
                  WHERE uw.user_id = auth.uid() AND uw.warehouse_id = promotions.warehouse_id));
CREATE POLICY promotions_read_gate ON public.promotions AS RESTRICTIVE FOR SELECT TO authenticated
  USING (warehouse_id::text = ANY (public.rbac_view_warehouses('pricing')::text[]));

DROP POLICY IF EXISTS price_lists_member ON public.price_lists;
DROP POLICY IF EXISTS price_lists_read_gate ON public.price_lists;
CREATE POLICY price_lists_member ON public.price_lists FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_warehouses uw
                  WHERE uw.user_id = auth.uid()
                    AND (price_lists.warehouse_id IS NULL OR uw.warehouse_id = price_lists.warehouse_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_warehouses uw
                  WHERE uw.user_id = auth.uid()
                    AND (price_lists.warehouse_id IS NULL OR uw.warehouse_id = price_lists.warehouse_id)));
CREATE POLICY price_lists_read_gate ON public.price_lists AS RESTRICTIVE FOR SELECT TO authenticated
  USING (warehouse_id IS NULL
         OR warehouse_id::text = ANY (public.rbac_view_warehouses('pricing')::text[]));

DROP POLICY IF EXISTS price_list_items_member ON public.price_list_items;
DROP POLICY IF EXISTS price_list_items_read_gate ON public.price_list_items;
CREATE POLICY price_list_items_member ON public.price_list_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.price_lists pl
                   JOIN public.user_warehouses uw
                     ON (pl.warehouse_id IS NULL OR uw.warehouse_id = pl.warehouse_id)
                  WHERE pl.id = price_list_items.price_list_id AND uw.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.price_lists pl
                   JOIN public.user_warehouses uw
                     ON (pl.warehouse_id IS NULL OR uw.warehouse_id = pl.warehouse_id)
                  WHERE pl.id = price_list_items.price_list_id AND uw.user_id = auth.uid()));
CREATE POLICY price_list_items_read_gate ON public.price_list_items AS RESTRICTIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.price_lists pl
                  WHERE pl.id = price_list_items.price_list_id
                    AND (pl.warehouse_id IS NULL
                         OR pl.warehouse_id::text = ANY (public.rbac_view_warehouses('pricing')::text[]))));

DROP POLICY IF EXISTS cs_tickets_member ON public.customer_service_tickets;
DROP POLICY IF EXISTS cs_tickets_read_gate ON public.customer_service_tickets;
CREATE POLICY cs_tickets_member ON public.customer_service_tickets FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_warehouses uw
                  WHERE uw.user_id = auth.uid() AND uw.warehouse_id = customer_service_tickets.warehouse_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_warehouses uw
                  WHERE uw.user_id = auth.uid() AND uw.warehouse_id = customer_service_tickets.warehouse_id));
CREATE POLICY cs_tickets_read_gate ON public.customer_service_tickets AS RESTRICTIVE FOR SELECT TO authenticated
  USING (warehouse_id::text = ANY (public.rbac_view_warehouses('customer_service')::text[]));

DROP POLICY IF EXISTS automation_rules_member ON public.automation_rules;
DROP POLICY IF EXISTS automation_rules_read_gate ON public.automation_rules;
CREATE POLICY automation_rules_member ON public.automation_rules FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_warehouses uw
                  WHERE uw.user_id = auth.uid() AND uw.warehouse_id = automation_rules.warehouse_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_warehouses uw
                  WHERE uw.user_id = auth.uid() AND uw.warehouse_id = automation_rules.warehouse_id));
CREATE POLICY automation_rules_read_gate ON public.automation_rules AS RESTRICTIVE FOR SELECT TO authenticated
  USING (warehouse_id::text = ANY (public.rbac_view_warehouses('automation')::text[]));

-- -------------------------------------------------------------------------------------
-- 4) مُشغّلات فرض الصلاحيات
-- -------------------------------------------------------------------------------------
DO $apply$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('payroll_runs',             'INSERT', 'payroll.create'),
      ('payroll_runs',             'UPDATE', 'payroll.update'),
      ('payroll_runs',             'DELETE', 'payroll.update'),
      ('payroll_items',            'INSERT', 'payroll.create'),
      ('payroll_items',            'UPDATE', 'payroll.update'),
      ('payroll_items',            'DELETE', 'payroll.update'),
      ('promotions',               'INSERT', 'pricing.create'),
      ('promotions',               'UPDATE', 'pricing.update'),
      ('promotions',               'DELETE', 'pricing.delete'),
      ('price_lists',              'INSERT', 'pricing.create'),
      ('price_lists',              'UPDATE', 'pricing.update'),
      ('price_lists',              'DELETE', 'pricing.delete'),
      ('price_list_items',         'INSERT', 'pricing.create'),
      ('price_list_items',         'UPDATE', 'pricing.update'),
      ('price_list_items',         'DELETE', 'pricing.delete'),
      ('customer_service_tickets', 'INSERT', 'customer_service.create'),
      ('customer_service_tickets', 'UPDATE', 'customer_service.update'),
      ('customer_service_tickets', 'DELETE', 'customer_service.update'),
      ('automation_rules',         'INSERT', 'automation.create'),
      ('automation_rules',         'UPDATE', 'automation.update'),
      ('automation_rules',         'DELETE', 'automation.delete')
    ) AS v(t, op, perm)
  LOOP
    PERFORM public.rbac_attach_enforcement(r.t, r.op, r.perm);
  END LOOP;

  EXECUTE 'DROP TRIGGER IF EXISTS rbac_enforce_status ON public.payroll_runs';
  EXECUTE $q$CREATE TRIGGER rbac_enforce_status
            BEFORE UPDATE ON public.payroll_runs
            FOR EACH ROW EXECUTE FUNCTION public.rbac_enforce_status(
              '{"approved":"payroll.approve","paid":"payroll.approve","cancelled":"payroll.approve"}')$q$;

  EXECUTE 'DROP TRIGGER IF EXISTS rbac_enforce_status ON public.promotions';
  EXECUTE $q$CREATE TRIGGER rbac_enforce_status
            BEFORE UPDATE ON public.promotions
            FOR EACH ROW EXECUTE FUNCTION public.rbac_enforce_status(
              '{"approved":"pricing.approve","rejected":"pricing.reject","active":"pricing.approve"}')$q$;
END
$apply$;

-- -------------------------------------------------------------------------------------
-- 5) التعليم: ما أصبح مفروضًا فعليًا
-- -------------------------------------------------------------------------------------
UPDATE public.permissions SET is_enforced = true
 WHERE name IN ('payroll.view','payroll.create','payroll.update','payroll.approve',
                'pricing.view','pricing.create','pricing.update','pricing.delete',
                'pricing.approve','pricing.reject',
                'customer_service.view','customer_service.create','customer_service.update',
                'automation.view','automation.create','automation.update','automation.delete',
                'automation.manage');

-- -------------------------------------------------------------------------------------
-- 6) الحفاظ على القدرة السابقة (view ⇒ create/update) ومنح الاعتماد للمديرين
-- -------------------------------------------------------------------------------------
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, p.id
  FROM public.role_permissions rp
  JOIN public.permissions vp ON vp.id = rp.permission_id
  JOIN public.permissions p
    ON p.category = vp.category AND p.name IN (vp.category || '.create', vp.category || '.update')
 WHERE vp.name IN (vp.category || '.view', vp.category || '.read')
   AND vp.category IN ('payroll', 'pricing', 'customer_service', 'automation')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT DISTINCT r.id, p.id
  FROM public.roles r
  JOIN public.permissions p
    ON p.name IN ('payroll.approve','pricing.approve','pricing.reject','automation.manage')
 WHERE r.deleted_at IS NULL
   AND lower(btrim(r.name)) IN ('warehouse manager','tenant admin','super admin','manager','admin')
ON CONFLICT DO NOTHING;

-- -------------------------------------------------------------------------------------
-- 7) ملخّص
-- -------------------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM public.permissions WHERE is_enforced) AS enforced_perms,
  (SELECT count(*) FROM public.permissions WHERE NOT is_enforced) AS hidden_perms,
  (SELECT count(*) FROM pg_policy WHERE polname LIKE '%read_gate') AS read_gate_policies;
