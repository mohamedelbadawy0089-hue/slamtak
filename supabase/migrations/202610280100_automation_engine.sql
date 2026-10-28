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
