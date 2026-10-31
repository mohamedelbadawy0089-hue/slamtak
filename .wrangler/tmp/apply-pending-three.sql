-- ============================================================
-- 202610280100_automation_engine.sql
-- ============================================================

-- ============================================================
-- نظام الأتمتة الاحترافي - Automation Engine
-- Migration: 202610280100_automation_engine.sql
-- ============================================================

-- 1) إعدادات إعادة الطلب التلقائي لكل منتج ومخزن
CREATE TABLE IF NOT EXISTS public.reorder_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  min_stock INTEGER DEFAULT 0 CHECK (min_stock >= 0),
  reorder_point INTEGER DEFAULT 0 CHECK (reorder_point >= 0),
  safety_stock INTEGER DEFAULT 0 CHECK (safety_stock >= 0),
  max_stock INTEGER DEFAULT 0 CHECK (max_stock >= 0),
  reorder_quantity INTEGER DEFAULT 0 CHECK (reorder_quantity >= 0),
  lead_time_days INTEGER DEFAULT 7 CHECK (lead_time_days >= 0),
  preferred_supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  auto_reorder_enabled BOOLEAN DEFAULT TRUE,
  require_approval BOOLEAN DEFAULT TRUE,
  budget_limit NUMERIC(14,2),
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(warehouse_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_reorder_settings_wh ON public.reorder_settings(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_reorder_settings_product ON public.reorder_settings(product_id);
CREATE INDEX IF NOT EXISTS idx_reorder_settings_enabled ON public.reorder_settings(auto_reorder_enabled, is_active);

-- 2) محرك الأتمتة - القواعد
CREATE TABLE IF NOT EXISTS public.automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  rule_name TEXT NOT NULL,
  rule_name_ar TEXT,
  description TEXT,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('reorder','status_update','notification','alert','custom')),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('event','schedule','condition','manual')),
  trigger_config JSONB DEFAULT '{}'::JSONB,
  conditions JSONB DEFAULT '[]'::JSONB,
  actions JSONB DEFAULT '[]'::JSONB,
  priority INTEGER DEFAULT 100,
  is_enabled BOOLEAN DEFAULT FALSE,
  is_test_mode BOOLEAN DEFAULT TRUE,
  require_approval BOOLEAN DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_executed_at TIMESTAMPTZ,
  execution_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_wh ON public.automation_rules(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled ON public.automation_rules(is_enabled);
CREATE INDEX IF NOT EXISTS idx_automation_rules_type ON public.automation_rules(rule_type);

-- 3) سجل تنفيذ الأتمتة (غير قابل للتعديل)
CREATE TABLE IF NOT EXISTS public.automation_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID REFERENCES public.automation_rules(id) ON DELETE SET NULL,
  tenant_id UUID,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  trigger_source TEXT,
  trigger_data JSONB,
  execution_status TEXT NOT NULL CHECK (execution_status IN ('pending','running','success','failed','skipped','cancelled')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  actions_executed JSONB DEFAULT '[]'::JSONB,
  result_summary TEXT,
  error_message TEXT,
  error_stack TEXT,
  affected_entities JSONB DEFAULT '[]'::JSONB,
  approval_required BOOLEAN DEFAULT FALSE,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  approval_status TEXT CHECK (approval_status IN ('pending','approved','rejected')),
  execution_context JSONB DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS idx_automation_exec_rule ON public.automation_executions(rule_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_exec_wh ON public.automation_executions(warehouse_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_exec_status ON public.automation_executions(execution_status);

-- 4) جدولة المهام التلقائية
CREATE TABLE IF NOT EXISTS public.automation_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  tenant_id UUID,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  schedule_name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  timezone TEXT DEFAULT 'Africa/Cairo',
  is_enabled BOOLEAN DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  run_count INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_sched_rule ON public.automation_schedules(rule_id);
CREATE INDEX IF NOT EXISTS idx_automation_sched_enabled ON public.automation_schedules(is_enabled, next_run_at);

-- 5) مسودات طلبات الشراء التلقائية
CREATE TABLE IF NOT EXISTS public.auto_purchase_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  draft_number TEXT NOT NULL UNIQUE,
  rule_id UUID REFERENCES public.automation_rules(id) ON DELETE SET NULL,
  execution_id UUID REFERENCES public.automation_executions(id) ON DELETE SET NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  current_stock INTEGER,
  reorder_point INTEGER,
  suggested_quantity INTEGER NOT NULL CHECK (suggested_quantity > 0),
  reason TEXT NOT NULL,
  calculation_details JSONB,
  status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','approved','rejected','converted','expired')),
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  purchase_order_id UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auto_po_drafts_wh ON public.auto_purchase_drafts(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_auto_po_drafts_status ON public.auto_purchase_drafts(status);
CREATE INDEX IF NOT EXISTS idx_auto_po_drafts_product ON public.auto_purchase_drafts(product_id);

-- 6) التنبيهات المجدولة
CREATE TABLE IF NOT EXISTS public.automation_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  rule_id UUID REFERENCES public.automation_rules(id) ON DELETE SET NULL,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('low_stock','expiring','expired','overdue_po','overdue_payment','delayed_delivery','budget','other')),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  title TEXT NOT NULL,
  title_ar TEXT,
  message TEXT NOT NULL,
  message_ar TEXT,
  entity_type TEXT,
  entity_id UUID,
  recipients JSONB DEFAULT '[]'::JSONB,
  channels JSONB DEFAULT '["in_app"]'::JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','read','dismissed','escalated')),
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  escalated_at TIMESTAMPTZ,
  escalation_count INTEGER DEFAULT 0,
  next_escalation_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_alerts_wh ON public.automation_alerts(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_automation_alerts_status ON public.automation_alerts(status, severity);
CREATE INDEX IF NOT EXISTS idx_automation_alerts_type ON public.automation_alerts(alert_type);

-- 7) تتبع حالات الطلبات للأتمتة
CREATE TABLE IF NOT EXISTS public.automation_status_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('sales_order','purchase_order','sales_invoice','goods_receipt','return')),
  entity_id UUID NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  transition_reason TEXT,
  triggered_by TEXT CHECK (triggered_by IN ('manual','automation','system')),
  rule_id UUID REFERENCES public.automation_rules(id) ON DELETE SET NULL,
  executed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_allowed BOOLEAN DEFAULT TRUE,
  allowed_transition BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_status_trans_entity ON public.automation_status_transitions(entity_type, entity_id, created_at);

-- دالة لحساب الكمية المقترحة لإعادة الطلب
CREATE OR REPLACE FUNCTION public.calculate_reorder_quantity(
  p_warehouse_id UUID,
  p_product_id UUID
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_stock INTEGER := 0;
  v_reorder_point INTEGER := 0;
  v_safety_stock INTEGER := 0;
  v_reorder_qty INTEGER := 0;
  v_avg_daily_consumption NUMERIC := 0;
  v_lead_time_days INTEGER := 7;
BEGIN
  -- Get current available stock
  SELECT COALESCE(SUM(available_quantity), 0) INTO v_current_stock
  FROM public.inventory
  WHERE warehouse_id = p_warehouse_id AND product_id = p_product_id AND available_quantity > 0;
  
  -- Get reorder settings
  SELECT reorder_point, safety_stock, reorder_quantity, lead_time_days
  INTO v_reorder_point, v_safety_stock, v_reorder_qty, v_lead_time_days
  FROM public.reorder_settings
  WHERE warehouse_id = p_warehouse_id AND product_id = p_product_id AND is_active = TRUE;
  
  IF v_reorder_qty IS NULL OR v_reorder_qty = 0 THEN
    v_reorder_qty := 50; -- default
  END IF;
  
  -- If below reorder point, suggest reorder
  IF v_current_stock <= COALESCE(v_reorder_point, 0) THEN
    RETURN GREATEST(v_reorder_qty, COALESCE(v_safety_stock, 0));
  END IF;
  
  RETURN 0;
END;
$$;

-- تفعيل RLS
ALTER TABLE public.reorder_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_purchase_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_status_transitions ENABLE ROW LEVEL SECURITY;

-- سياسات RLS
CREATE POLICY "Enable all for authenticated users" ON public.reorder_settings FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.automation_rules FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read for authenticated users" ON public.automation_executions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable insert for authenticated users" ON public.automation_executions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users" ON public.automation_schedules FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.auto_purchase_drafts FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.automation_alerts FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.automation_status_transitions FOR ALL TO authenticated USING (true);

-- منح الصلاحيات
GRANT ALL ON public.reorder_settings TO authenticated;
GRANT ALL ON public.automation_rules TO authenticated;
GRANT ALL ON public.automation_executions TO authenticated;
GRANT ALL ON public.automation_schedules TO authenticated;
GRANT ALL ON public.auto_purchase_drafts TO authenticated;
GRANT ALL ON public.automation_alerts TO authenticated;
GRANT ALL ON public.automation_status_transitions TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_reorder_quantity(UUID, UUID) TO authenticated;


-- ============================================================
-- 202610290100_pricing_promotions_system.sql
-- ============================================================

-- ============================================================
-- نظام إدارة الأسعار والعروض والخصومات الاحترافي
-- Pricing, Promotions & Discounts Management System
-- ============================================================

-- 1) قوائم الأسعار المتعددة
CREATE TABLE IF NOT EXISTS public.price_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  name_ar TEXT,
  code TEXT UNIQUE,
  description TEXT,
  price_type TEXT NOT NULL CHECK (price_type IN ('base', 'contract', 'customer_special', 'quantity_tier')),
  currency_code TEXT DEFAULT 'EGP',
  is_default BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  valid_from DATE DEFAULT CURRENT_DATE,
  valid_until DATE,
  applies_to TEXT DEFAULT 'all' CHECK (applies_to IN ('all', 'pharmacies', 'customers', 'customer_groups')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_lists_wh ON public.price_lists(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_price_lists_active ON public.price_lists(is_active, valid_from, valid_until);

-- 2) أسعار المنتجات في قوائم الأسعار
CREATE TABLE IF NOT EXISTS public.price_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id UUID NOT NULL REFERENCES public.price_lists(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  min_quantity NUMERIC(14,2) DEFAULT 1 CHECK (min_quantity > 0),
  max_quantity NUMERIC(14,2),
  unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  cost_price NUMERIC(14,2),
  min_margin_percent NUMERIC(5,2),
  valid_from DATE DEFAULT CURRENT_DATE,
  valid_until DATE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(price_list_id, product_id, min_quantity)
);

CREATE INDEX IF NOT EXISTS idx_price_list_items_pl ON public.price_list_items(price_list_id);
CREATE INDEX IF NOT EXISTS idx_price_list_items_product ON public.price_list_items(product_id);

-- 3) شرائح العملاء/الصيدليات
CREATE TABLE IF NOT EXISTS public.customer_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  name TEXT NOT NULL,
  name_ar TEXT,
  code TEXT UNIQUE,
  description TEXT,
  criteria JSONB DEFAULT '{}'::JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ربط العملاء بالشرائح
CREATE TABLE IF NOT EXISTS public.customer_segment_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id UUID NOT NULL REFERENCES public.customer_segments(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(segment_id, customer_id)
);

-- ربط قوائم الأسعار بالشرائح
CREATE TABLE IF NOT EXISTS public.price_list_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id UUID NOT NULL REFERENCES public.price_lists(id) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES public.customer_segments(id) ON DELETE CASCADE,
  priority INTEGER DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(price_list_id, segment_id)
);

-- 4) الحملات والعروض الترويجية
CREATE TABLE IF NOT EXISTS public.promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  name_ar TEXT,
  code TEXT UNIQUE,
  description TEXT,
  promotion_type TEXT NOT NULL CHECK (promotion_type IN ('percentage_discount', 'fixed_amount_discount', 'buy_x_get_y', 'bundle', 'free_item', 'volume_discount')),
  discount_type TEXT CHECK (discount_type IN ('percentage', 'fixed_amount')),
  discount_value NUMERIC(14,2),
  buy_quantity NUMERIC(14,2),
  get_quantity NUMERIC(14,2),
  min_order_amount NUMERIC(14,2) DEFAULT 0,
  max_discount_amount NUMERIC(14,2),
  budget_limit NUMERIC(14,2),
  usage_limit INTEGER,
  usage_count INTEGER DEFAULT 0,
  per_customer_limit INTEGER,
  start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_date TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  is_combinable BOOLEAN DEFAULT FALSE,
  priority INTEGER DEFAULT 100,
  applies_to TEXT DEFAULT 'all' CHECK (applies_to IN ('all', 'products', 'categories', 'brands', 'customers', 'segments')),
  requires_approval BOOLEAN DEFAULT FALSE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotions_active ON public.promotions(is_active, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_promotions_wh ON public.promotions(warehouse_id);

-- 5) منتجات/أصناف العرض
CREATE TABLE IF NOT EXISTS public.promotion_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id UUID NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  category_id UUID,
  is_included BOOLEAN DEFAULT TRUE,
  min_quantity NUMERIC(14,2) DEFAULT 1,
  discount_value NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotion_items_prom ON public.promotion_items(promotion_id);
CREATE INDEX IF NOT EXISTS idx_promotion_items_product ON public.promotion_items(product_id);

-- 6) تطبيقات العرض للعملاء/الشرائح
CREATE TABLE IF NOT EXISTS public.promotion_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id UUID NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES public.customer_segments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_promo_target CHECK (customer_id IS NOT NULL OR segment_id IS NOT NULL)
);

-- 7) سجل استخدام العروض
CREATE TABLE IF NOT EXISTS public.promotion_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id UUID NOT NULL REFERENCES public.promotions(id) ON DELETE RESTRICT,
  sales_invoice_id UUID REFERENCES public.sales_invoices(id) ON DELETE SET NULL,
  sales_order_id UUID REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  discount_amount NUMERIC(14,2) NOT NULL,
  order_amount NUMERIC(14,2),
  applied_by UUID,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rules_snapshot JSONB
);

CREATE INDEX IF NOT EXISTS idx_promo_usage_prom ON public.promotion_usage(promotion_id);
CREATE INDEX IF NOT EXISTS idx_promo_usage_invoice ON public.promotion_usage(sales_invoice_id);
CREATE INDEX IF NOT EXISTS idx_promo_usage_customer ON public.promotion_usage(customer_id);

-- 8) موافقات الخصومات الاستثنائية
CREATE TABLE IF NOT EXISTS public.discount_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL,
  requested_by_name TEXT,
  sales_invoice_id UUID REFERENCES public.sales_invoices(id) ON DELETE SET NULL,
  sales_order_id UUID REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  discount_type TEXT,
  discount_value NUMERIC(14,2),
  discount_amount NUMERIC(14,2),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discount_approvals_status ON public.discount_approvals(status);
CREATE INDEX IF NOT EXISTS idx_discount_approvals_requested ON public.discount_approvals(requested_by);

-- 9) سجل تدقيق الأسعار والعروض
CREATE TABLE IF NOT EXISTS public.pricing_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  user_id UUID,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'activate', 'deactivate', 'approve', 'reject', 'apply')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('price_list', 'price_list_item', 'promotion', 'discount', 'approval')),
  entity_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_audit_entity ON public.pricing_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_pricing_audit_user ON public.pricing_audit_log(user_id, created_at DESC);

-- دالة للحصول على السعر المناسب للمنتج
CREATE OR REPLACE FUNCTION public.get_product_price(
  p_product_id UUID,
  p_customer_id UUID DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_quantity NUMERIC DEFAULT 1
) RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_price NUMERIC := 0;
  v_price_list_id UUID;
BEGIN
  -- البحث عن أفضل سعر بناءً على قائمة الأسعار النشطة
  SELECT pli.unit_price INTO v_price
  FROM public.price_list_items pli
  JOIN public.price_lists pl ON pl.id = pli.price_list_id
  WHERE pli.product_id = p_product_id
    AND pli.is_active = TRUE
    AND pl.is_active = TRUE
    AND (p_warehouse_id IS NULL OR pl.warehouse_id = p_warehouse_id OR pl.warehouse_id IS NULL)
    AND (pli.valid_from IS NULL OR pli.valid_from <= CURRENT_DATE)
    AND (pli.valid_until IS NULL OR pli.valid_until >= CURRENT_DATE)
    AND (pl.valid_from IS NULL OR pl.valid_from <= CURRENT_DATE)
    AND (pl.valid_until IS NULL OR pl.valid_until >= CURRENT_DATE)
    AND p_quantity >= pli.min_quantity
    AND (pli.max_quantity IS NULL OR p_quantity <= pli.max_quantity)
  ORDER BY pli.unit_price ASC
  LIMIT 1;
  
  IF v_price IS NULL OR v_price = 0 THEN
    -- الرجوع للسعر الأساسي من المنتج إذا وجد
    SELECT COALESCE(average_cost * 1.2, 0) INTO v_price
    FROM public.products
    WHERE id = p_product_id;
  END IF;
  
  RETURN COALESCE(v_price, 0);
END;
$$;

-- تفعيل RLS
ALTER TABLE public.price_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_segment_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_list_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_audit_log ENABLE ROW LEVEL SECURITY;

-- سياسات RLS
CREATE POLICY "Enable all for authenticated users" ON public.price_lists FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.price_list_items FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.customer_segments FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.customer_segment_members FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.price_list_segments FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.promotions FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.promotion_items FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.promotion_customers FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read for authenticated users" ON public.promotion_usage FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable insert for authenticated users" ON public.promotion_usage FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users" ON public.discount_approvals FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read for authenticated users" ON public.pricing_audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable insert for authenticated users" ON public.pricing_audit_log FOR INSERT TO authenticated WITH CHECK (true);

-- منح الصلاحيات
GRANT ALL ON public.price_lists TO authenticated;
GRANT ALL ON public.price_list_items TO authenticated;
GRANT ALL ON public.customer_segments TO authenticated;
GRANT ALL ON public.customer_segment_members TO authenticated;
GRANT ALL ON public.price_list_segments TO authenticated;
GRANT ALL ON public.promotions TO authenticated;
GRANT ALL ON public.promotion_items TO authenticated;
GRANT ALL ON public.promotion_customers TO authenticated;
GRANT ALL ON public.promotion_usage TO authenticated;
GRANT ALL ON public.discount_approvals TO authenticated;
GRANT ALL ON public.pricing_audit_log TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_price(UUID, UUID, UUID, NUMERIC) TO authenticated;


-- ============================================================
-- 202610290200_hrm_system.sql
-- ============================================================

-- ============================================================
-- نظام الموارد البشرية HRM متكامل
-- Human Resource Management System - Comprehensive
-- Migration: 202610290200_hrm_system.sql
-- ============================================================

-- 1) الشركات
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  company_code TEXT UNIQUE,
  name TEXT NOT NULL,
  name_ar TEXT,
  tax_number TEXT,
  commercial_register TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  governorate TEXT,
  logo_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  settings JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- 2) الأقسام
CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  tenant_id UUID,
  department_code TEXT,
  name TEXT NOT NULL,
  name_ar TEXT,
  manager_id UUID,
  parent_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_departments_company ON public.departments(company_id);

-- 3) المسميات الوظيفية
CREATE TABLE IF NOT EXISTS public.job_titles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  tenant_id UUID,
  title_code TEXT,
  title_name TEXT NOT NULL,
  title_name_ar TEXT,
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  grade_level INTEGER,
  min_salary NUMERIC(14,2) DEFAULT 0,
  max_salary NUMERIC(14,2) DEFAULT 0,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_titles_company ON public.job_titles(company_id);

-- 4) الموظفين - الملف الرئيسي
CREATE TABLE IF NOT EXISTS public.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE RESTRICT,
  tenant_id UUID,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  employee_number TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT,
  first_name_ar TEXT,
  last_name_ar TEXT,
  full_name_ar TEXT,
  national_id TEXT UNIQUE,
  date_of_birth DATE,
  gender TEXT CHECK (gender IN ('male','female')),
  marital_status TEXT CHECK (marital_status IN ('single','married','divorced','widowed')),
  nationality TEXT DEFAULT 'مصري',
  religion TEXT,
  phone TEXT,
  mobile TEXT,
  email TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  address TEXT,
  city TEXT,
  governorate TEXT,
  postal_code TEXT,
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  job_title_id UUID REFERENCES public.job_titles(id) ON DELETE SET NULL,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  direct_manager_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  hire_date DATE NOT NULL DEFAULT CURRENT_DATE,
  confirmation_date DATE,
  probation_end_date DATE,
  employment_status TEXT NOT NULL DEFAULT 'active' CHECK (employment_status IN ('active','on_leave','suspended','terminated','retired','resigned')),
  employment_type TEXT DEFAULT 'full_time' CHECK (employment_type IN ('full_time','part_time','contract','temporary','intern')),
  contract_start_date DATE,
  contract_end_date DATE,
  basic_salary NUMERIC(14,2) DEFAULT 0,
  currency TEXT DEFAULT 'EGP',
  bank_name TEXT,
  bank_account_number TEXT,
  iban TEXT,
  photo_url TEXT,
  notes TEXT,
  is_archived BOOLEAN DEFAULT FALSE,
  archived_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_employees_company ON public.employees(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_dept ON public.employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_warehouse ON public.employees(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_employees_status ON public.employees(employment_status);
CREATE INDEX IF NOT EXISTS idx_employees_user ON public.employees(user_id);
CREATE INDEX IF NOT EXISTS idx_employees_number ON public.employees(employee_number);

-- 5) عقود الموظفين
CREATE TABLE IF NOT EXISTS public.employee_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  contract_number TEXT UNIQUE,
  contract_type TEXT NOT NULL DEFAULT 'indefinite' CHECK (contract_type IN ('indefinite','fixed_term','probation','part_time','consultant')),
  start_date DATE NOT NULL,
  end_date DATE,
  basic_salary NUMERIC(14,2) NOT NULL DEFAULT 0,
  allowances JSONB DEFAULT '[]'::JSONB,
  terms_conditions TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','expired','terminated','renewed')),
  signed_date DATE,
  signed_by_employee BOOLEAN DEFAULT FALSE,
  attachment_url TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_contracts_emp ON public.employee_contracts(employee_id);

-- 6) مستندات الموظفين
CREATE TABLE IF NOT EXISTS public.employee_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('id_card','passport','birth_certificate','education','contract','certification','medical','criminal_record','other')),
  document_name TEXT NOT NULL,
  document_number TEXT,
  issue_date DATE,
  expiry_date DATE,
  file_url TEXT,
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT,
  notes TEXT,
  uploaded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_emp ON public.employee_documents(employee_id);

-- 7) الحركات الوظيفية (ترقية/نقل/تغيير راتب/إنهاء)
CREATE TABLE IF NOT EXISTS public.employee_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('appointment','promotion','transfer','salary_change','demotion','termination','resignation','leave_without_pay')),
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  old_department_id UUID REFERENCES public.departments(id),
  new_department_id UUID REFERENCES public.departments(id),
  old_job_title_id UUID REFERENCES public.job_titles(id),
  new_job_title_id UUID REFERENCES public.job_titles(id),
  old_warehouse_id UUID REFERENCES public.warehouses(id),
  new_warehouse_id UUID REFERENCES public.warehouses(id),
  old_salary NUMERIC(14,2),
  new_salary NUMERIC(14,2),
  reason TEXT,
  decision_number TEXT,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_movements_emp ON public.employee_movements(employee_id);

-- 8) الورديات
CREATE TABLE IF NOT EXISTS public.shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  shift_name TEXT NOT NULL,
  shift_name_ar TEXT,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  break_duration_minutes INTEGER DEFAULT 60,
  working_hours NUMERIC(4,2),
  grace_period_minutes INTEGER DEFAULT 15,
  is_night_shift BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9) الحضور والانصراف
CREATE TABLE IF NOT EXISTS public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL,
  check_in_time TIMESTAMPTZ,
  check_out_time TIMESTAMPTZ,
  check_in_latitude NUMERIC(10,7),
  check_in_longitude NUMERIC(10,7),
  check_out_latitude NUMERIC(10,7),
  check_out_longitude NUMERIC(10,7),
  working_hours NUMERIC(5,2),
  overtime_hours NUMERIC(5,2) DEFAULT 0,
  late_minutes INTEGER DEFAULT 0,
  early_leave_minutes INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present','absent','late','early_leave','half_day','on_leave','holiday','weekend')),
  notes TEXT,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON public.attendance(employee_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance(attendance_date);

-- 10) أنواع الإجازات
CREATE TABLE IF NOT EXISTS public.leave_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  type_name TEXT NOT NULL,
  type_name_ar TEXT NOT NULL,
  code TEXT,
  is_paid BOOLEAN DEFAULT TRUE,
  annual_balance INTEGER DEFAULT 0,
  accrual_rate NUMERIC(4,2) DEFAULT 0,
  requires_approval BOOLEAN DEFAULT TRUE,
  requires_attachment BOOLEAN DEFAULT FALSE,
  max_days_per_year INTEGER,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11) رصيد الإجازات
CREATE TABLE IF NOT EXISTS public.leave_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES public.leave_types(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  entitled_days NUMERIC(5,2) DEFAULT 0,
  used_days NUMERIC(5,2) DEFAULT 0,
  carried_forward NUMERIC(5,2) DEFAULT 0,
  remaining_days NUMERIC(5,2) DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id, leave_type_id, year)
);

CREATE INDEX IF NOT EXISTS idx_leave_balances_emp ON public.leave_balances(employee_id);

-- 12) طلبات الإجازات
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES public.leave_types(id) ON DELETE RESTRICT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_days NUMERIC(5,2) NOT NULL,
  reason TEXT,
  attachment_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled','withdrawn')),
  applied_date DATE DEFAULT CURRENT_DATE,
  approved_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_emp ON public.leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON public.leave_requests(status);

-- 13) مسيرات الرواتب
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE RESTRICT,
  run_number TEXT UNIQUE,
  pay_period_start DATE NOT NULL,
  pay_period_end DATE NOT NULL,
  pay_date DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','locked','paid','cancelled')),
  total_gross NUMERIC(14,2) DEFAULT 0,
  total_deductions NUMERIC(14,2) DEFAULT 0,
  total_net NUMERIC(14,2) DEFAULT 0,
  total_employees INTEGER DEFAULT 0,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  locked_by UUID,
  locked_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_company ON public.payroll_runs(company_id);

-- 14) قسائم الرواتب
CREATE TABLE IF NOT EXISTS public.payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  employee_number TEXT,
  basic_salary NUMERIC(14,2) DEFAULT 0,
  working_days INTEGER DEFAULT 0,
  present_days INTEGER DEFAULT 0,
  absent_days INTEGER DEFAULT 0,
  overtime_hours NUMERIC(5,2) DEFAULT 0,
  overtime_amount NUMERIC(14,2) DEFAULT 0,
  allowances JSONB DEFAULT '[]'::JSONB,
  total_allowances NUMERIC(14,2) DEFAULT 0,
  gross_salary NUMERIC(14,2) DEFAULT 0,
  deductions JSONB DEFAULT '[]'::JSONB,
  total_deductions NUMERIC(14,2) DEFAULT 0,
  loans_deduction NUMERIC(14,2) DEFAULT 0,
  net_salary NUMERIC(14,2) DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','approved','paid')),
  paid_at TIMESTAMPTZ,
  payment_method TEXT,
  payment_reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(payroll_run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_payslips_run ON public.payslips(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payslips_emp ON public.payslips(employee_id);

-- 15) السلف
CREATE TABLE IF NOT EXISTS public.employee_loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  loan_number TEXT UNIQUE,
  loan_type TEXT DEFAULT 'advance' CHECK (loan_type IN ('advance','loan','emergency')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  approved_amount NUMERIC(14,2) DEFAULT 0,
  installments INTEGER DEFAULT 1,
  installment_amount NUMERIC(14,2) DEFAULT 0,
  paid_amount NUMERIC(14,2) DEFAULT 0,
  remaining_amount NUMERIC(14,2) DEFAULT 0,
  interest_rate NUMERIC(5,2) DEFAULT 0,
  start_date DATE,
  end_date DATE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','active','completed','cancelled')),
  requested_by UUID,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_loans_emp ON public.employee_loans(employee_id);

-- 16) التوظيف - الوظائف الشاغرة
CREATE TABLE IF NOT EXISTS public.job_openings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  job_title_id UUID REFERENCES public.job_titles(id) ON DELETE SET NULL,
  opening_number TEXT UNIQUE,
  title TEXT NOT NULL,
  positions INTEGER DEFAULT 1,
  experience_required TEXT,
  education_required TEXT,
  salary_range_from NUMERIC(14,2),
  salary_range_to NUMERIC(14,2),
  description TEXT,
  requirements TEXT,
  responsibilities TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('draft','open','closed','on_hold','filled')),
  posted_date DATE DEFAULT CURRENT_DATE,
  closing_date DATE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 17) المرشحون
CREATE TABLE IF NOT EXISTS public.candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_opening_id UUID REFERENCES public.job_openings(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  national_id TEXT,
  resume_url TEXT,
  cover_letter TEXT,
  experience_years INTEGER,
  education_level TEXT,
  current_company TEXT,
  current_salary NUMERIC(14,2),
  expected_salary NUMERIC(14,2),
  status TEXT DEFAULT 'applied' CHECK (status IN ('applied','screening','interview','shortlisted','offered','hired','rejected','withdrawn')),
  source TEXT,
  applied_date DATE DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidates_job ON public.candidates(job_opening_id);

-- 18) المقابلات
CREATE TABLE IF NOT EXISTS public.interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  interviewer_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  interview_type TEXT DEFAULT 'in_person' CHECK (interview_type IN ('phone','video','in_person','technical')),
  round INTEGER DEFAULT 1,
  scheduled_date TIMESTAMPTZ,
  duration_minutes INTEGER DEFAULT 60,
  location TEXT,
  meeting_link TEXT,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','rescheduled','no_show')),
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  feedback TEXT,
  recommendation TEXT CHECK (recommendation IN ('hire','hold','reject')),
  conducted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 19) تقييم الأداء
CREATE TABLE IF NOT EXISTS public.performance_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  reviewer_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  review_period_start DATE,
  review_period_end DATE,
  review_type TEXT DEFAULT 'annual' CHECK (review_type IN ('probation','annual','mid_year','project','360')),
  overall_rating NUMERIC(3,2),
  goals JSONB DEFAULT '[]'::JSONB,
  strengths TEXT,
  areas_for_improvement TEXT,
  development_plan TEXT,
  employee_comments TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','in_progress','submitted','reviewed','approved','completed')),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_performance_reviews_emp ON public.performance_reviews(employee_id);

-- 20) العهد والأجهزة
CREATE TABLE IF NOT EXISTS public.employee_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('laptop','phone','id_card','keys','uniform','vehicle','tools','other')),
  asset_name TEXT NOT NULL,
  asset_code TEXT,
  serial_number TEXT,
  assigned_date DATE DEFAULT CURRENT_DATE,
  return_date DATE,
  condition_on_assignment TEXT,
  condition_on_return TEXT,
  status TEXT DEFAULT 'assigned' CHECK (status IN ('assigned','returned','lost','damaged')),
  handed_over_by UUID,
  received_by_employee BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_assets_emp ON public.employee_assets(employee_id);

-- 21) الإشعارات
CREATE TABLE IF NOT EXISTS public.hr_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES public.employees(id) ON DELETE CASCADE,
  recipient_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  title_ar TEXT,
  message TEXT NOT NULL,
  message_ar TEXT,
  type TEXT DEFAULT 'info' CHECK (type IN ('info','warning','success','error','reminder')),
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  action_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_notifications_recipient ON public.hr_notifications(recipient_id, is_read);

-- 22) سجل تدقيق HRM
CREATE TABLE IF NOT EXISTS public.hrm_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('employee','contract','attendance','leave','payroll','loan','movement','document','asset')),
  entity_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hrm_audit_logs_entity ON public.hrm_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_hrm_audit_logs_user ON public.hrm_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_hrm_audit_logs_created ON public.hrm_audit_logs(created_at DESC);

-- دالة توليد رقم موظف
CREATE OR REPLACE FUNCTION public.generate_employee_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_num TEXT;
BEGIN
  v_num := 'EMP-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(FLOOR(RANDOM() * 100000)::TEXT, 5, '0');
  RETURN v_num;
END;
$$;

-- تفعيل RLS
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_titles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_openings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hrm_audit_logs ENABLE ROW LEVEL SECURITY;

-- سياسات أساسية للمصادقة
CREATE POLICY "Enable read access for authenticated users" ON public.companies FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.companies FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.departments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.departments FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.job_titles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.job_titles FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.employees FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.employees FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.employee_contracts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.employee_contracts FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.employee_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.employee_documents FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.employee_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.employee_movements FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.shifts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.shifts FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.attendance FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.attendance FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.leave_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.leave_types FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.leave_balances FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.leave_balances FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.leave_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.leave_requests FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.payroll_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.payroll_runs FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.payslips FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.payslips FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.employee_loans FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.employee_loans FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.job_openings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.job_openings FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.candidates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.candidates FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.interviews FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.interviews FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.performance_reviews FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.performance_reviews FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.employee_assets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.employee_assets FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.hr_notifications FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.hr_notifications FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.hrm_audit_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable insert for authenticated users" ON public.hrm_audit_logs FOR INSERT TO authenticated WITH CHECK (true);

-- منح الصلاحيات
GRANT ALL ON public.companies TO authenticated;
GRANT ALL ON public.departments TO authenticated;
GRANT ALL ON public.job_titles TO authenticated;
GRANT ALL ON public.employees TO authenticated;
GRANT ALL ON public.employee_contracts TO authenticated;
GRANT ALL ON public.employee_documents TO authenticated;
GRANT ALL ON public.employee_movements TO authenticated;
GRANT ALL ON public.shifts TO authenticated;
GRANT ALL ON public.attendance TO authenticated;
GRANT ALL ON public.leave_types TO authenticated;
GRANT ALL ON public.leave_balances TO authenticated;
GRANT ALL ON public.leave_requests TO authenticated;
GRANT ALL ON public.payroll_runs TO authenticated;
GRANT ALL ON public.payslips TO authenticated;
GRANT ALL ON public.employee_loans TO authenticated;
GRANT ALL ON public.job_openings TO authenticated;
GRANT ALL ON public.candidates TO authenticated;
GRANT ALL ON public.interviews TO authenticated;
GRANT ALL ON public.performance_reviews TO authenticated;
GRANT ALL ON public.employee_assets TO authenticated;
GRANT ALL ON public.hr_notifications TO authenticated;
GRANT ALL ON public.hrm_audit_logs TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_employee_number() TO authenticated;


