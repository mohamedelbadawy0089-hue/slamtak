-- ============================================================
-- نظام خدمة العملاء CRM والشكاوى والمرتجعات والتواصل الموحد
-- Customer Service CRM, Complaints, Returns, Order Tracking
-- Migration: 202610270100_customer_service_crm.sql
-- ============================================================

-- 1) ملف الصيدلية / عميل CRM
CREATE TABLE IF NOT EXISTS public.crm_pharmacies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  pharmacy_code TEXT UNIQUE,
  pharmacy_name TEXT NOT NULL,
  pharmacy_name_ar TEXT,
  contact_person TEXT,
  phone TEXT,
  mobile TEXT,
  email TEXT,
  address TEXT,
  governorate TEXT,
  city TEXT,
  tax_number TEXT,
  commercial_register TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
  credit_limit NUMERIC(14,2) DEFAULT 0,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_crm_pharmacies_warehouse ON public.crm_pharmacies(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_crm_pharmacies_customer ON public.crm_pharmacies(customer_id);
CREATE INDEX IF NOT EXISTS idx_crm_pharmacies_code ON public.crm_pharmacies(pharmacy_code);

-- 2) تذاكر خدمة العملاء
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  ticket_number TEXT NOT NULL UNIQUE,
  pharmacy_id UUID REFERENCES public.crm_pharmacies(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  order_id UUID REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES public.sales_invoices(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  description TEXT,
  ticket_type TEXT NOT NULL DEFAULT 'general' CHECK (ticket_type IN ('general','complaint','return_request','inquiry','delivery','payment','other')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent','critical')),
  severity TEXT DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','in_progress','waiting_customer','resolved','closed','reopened')),
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to_name TEXT,
  assigned_at TIMESTAMPTZ,
  first_response_due_at TIMESTAMPTZ,
  resolution_due_at TIMESTAMPTZ,
  first_responded_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  reopened_at TIMESTAMPTZ,
  tags TEXT[],
  source TEXT DEFAULT 'web' CHECK (source IN ('web','phone','email','whatsapp','sms','in_person')),
  satisfaction_rating INTEGER CHECK (satisfaction_rating >= 1 AND satisfaction_rating <= 5),
  satisfaction_comment TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_warehouse ON public.support_tickets(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_pharmacy ON public.support_tickets(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned ON public.support_tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_support_tickets_type ON public.support_tickets(ticket_type);
CREATE INDEX IF NOT EXISTS idx_support_tickets_priority ON public.support_tickets(priority);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created ON public.support_tickets(created_at DESC);

-- 3) رسائل التذاكر / المحادثات
CREATE TABLE IF NOT EXISTS public.ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer','agent','system')),
  sender_name TEXT,
  message TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT FALSE,
  attachments JSONB DEFAULT '[]'::JSONB,
  read_by JSONB DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON public.ticket_messages(ticket_id, created_at);

-- 4) سجل إجراءات التذاكر
CREATE TABLE IF NOT EXISTS public.ticket_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('created','assigned','transferred','status_changed','priority_changed','note_added','resolved','closed','reopened','escalated')),
  performed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  performed_by_name TEXT,
  from_value TEXT,
  to_value TEXT,
  reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_actions_ticket ON public.ticket_actions(ticket_id, created_at);

-- 5) قوالب الردود
CREATE TABLE IF NOT EXISTS public.ticket_response_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  category TEXT,
  content TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  usage_count INTEGER DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6) الشكاوى
CREATE TABLE IF NOT EXISTS public.complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  complaint_number TEXT NOT NULL UNIQUE,
  ticket_id UUID REFERENCES public.support_tickets(id) ON DELETE SET NULL,
  pharmacy_id UUID REFERENCES public.crm_pharmacies(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  order_id UUID REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES public.sales_invoices(id) ON DELETE SET NULL,
  complaint_type TEXT NOT NULL CHECK (complaint_type IN ('late_delivery','missing_items','wrong_items','damaged','invoice','payment','quality','other')),
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent','critical')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','under_review','in_progress','waiting_customer','resolved','closed','reopened')),
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to_name TEXT,
  escalated_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  escalated_at TIMESTAMPTZ,
  escalation_reason TEXT,
  root_cause TEXT,
  corrective_action TEXT,
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  attachments JSONB DEFAULT '[]'::JSONB,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_complaints_warehouse ON public.complaints(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_complaints_pharmacy ON public.complaints(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON public.complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_type ON public.complaints(complaint_type);
CREATE INDEX IF NOT EXISTS idx_complaints_assigned ON public.complaints(assigned_to);
CREATE INDEX IF NOT EXISTS idx_complaints_created ON public.complaints(created_at DESC);

-- 7) مرتجعات الصيدليات (نظام متكامل)
CREATE TABLE IF NOT EXISTS public.pharmacy_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  return_number TEXT NOT NULL UNIQUE,
  pharmacy_id UUID NOT NULL REFERENCES public.crm_pharmacies(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  ticket_id UUID REFERENCES public.support_tickets(id) ON DELETE SET NULL,
  complaint_id UUID REFERENCES public.complaints(id) ON DELETE SET NULL,
  sales_invoice_id UUID REFERENCES public.sales_invoices(id) ON DELETE SET NULL,
  sales_order_id UUID REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  return_type TEXT NOT NULL DEFAULT 'customer' CHECK (return_type IN ('customer','supplier','internal')),
  reason TEXT NOT NULL CHECK (reason IN ('expired','damaged','wrong_item','excess','defective','near_expiry','recall','other')),
  reason_details TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','under_review','approved','rejected','pending_pickup','received','inspected','settled','closed')),
  policy_applied TEXT,
  total_amount NUMERIC(14,2) DEFAULT 0,
  restock_amount NUMERIC(14,2) DEFAULT 0,
  quarantine_amount NUMERIC(14,2) DEFAULT 0,
  credit_note_amount NUMERIC(14,2) DEFAULT 0,
  refund_method TEXT CHECK (refund_method IN ('credit_note','cash','bank_transfer','exchange')),
  requested_by UUID,
  requested_by_name TEXT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by_name TEXT,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  rejection_reason TEXT,
  received_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ,
  inspected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  inspected_at TIMESTAMPTZ,
  inspection_notes TEXT,
  settled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  settled_at TIMESTAMPTZ,
  settlement_notes TEXT,
  attachments JSONB DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_returns_warehouse ON public.pharmacy_returns(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_returns_pharmacy ON public.pharmacy_returns(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_returns_status ON public.pharmacy_returns(status);
CREATE INDEX IF NOT EXISTS idx_pharmacy_returns_invoice ON public.pharmacy_returns(sales_invoice_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_returns_created ON public.pharmacy_returns(created_at DESC);

-- 8) أصناف المرتجعات
CREATE TABLE IF NOT EXISTS public.pharmacy_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES public.pharmacy_returns(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name TEXT,
  batch_number TEXT,
  expiry_date DATE,
  quantity_requested NUMERIC(14,2) NOT NULL CHECK (quantity_requested > 0),
  quantity_approved NUMERIC(14,2) DEFAULT 0 CHECK (quantity_approved >= 0),
  quantity_received NUMERIC(14,2) DEFAULT 0 CHECK (quantity_received >= 0),
  quantity_accepted NUMERIC(14,2) DEFAULT 0 CHECK (quantity_accepted >= 0),
  quantity_rejected NUMERIC(14,2) DEFAULT 0 CHECK (quantity_rejected >= 0),
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) DEFAULT 0,
  reason TEXT,
  inspection_result TEXT CHECK (inspection_result IN ('good','damaged','expired','quarantine','rejected')),
  action_taken TEXT CHECK (action_taken IN ('restock','quarantine','destroy','credit')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_return_items_return ON public.pharmacy_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_return_items_product ON public.pharmacy_return_items(product_id);

-- 9) تتبع حالة الطلبات (order tracking timeline)
CREATE TABLE IF NOT EXISTS public.order_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES public.sales_invoices(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  status_label TEXT,
  location TEXT,
  notes TEXT,
  performed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  performed_by_name TEXT,
  performed_by_type TEXT DEFAULT 'system' CHECK (performed_by_type IN ('system','user','driver')),
  delivery_id UUID,
  driver_id UUID,
  proof_image_url TEXT,
  signature_data TEXT,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_tracking_order ON public.order_tracking(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_order_tracking_invoice ON public.order_tracking(invoice_id, created_at);

-- 10) الإشعارات
CREATE TABLE IF NOT EXISTS public.customer_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('pharmacy','customer','user','all')),
  recipient_id UUID,
  pharmacy_id UUID REFERENCES public.crm_pharmacies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ticket_id UUID REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  complaint_id UUID REFERENCES public.complaints(id) ON DELETE CASCADE,
  return_id UUID REFERENCES public.pharmacy_returns(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info','warning','success','error','alert')),
  channel TEXT DEFAULT 'in_app' CHECK (channel IN ('in_app','email','sms','whatsapp')),
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  action_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_notifications_pharmacy ON public.customer_notifications(pharmacy_id, is_read);
CREATE INDEX IF NOT EXISTS idx_customer_notifications_user ON public.customer_notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_customer_notifications_created ON public.customer_notifications(created_at DESC);

-- 11) سجل التدقيق لنظام خدمة العملاء
CREATE TABLE IF NOT EXISTS public.cs_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('ticket','complaint','return','message','pharmacy','notification')),
  entity_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_audit_logs_entity ON public.cs_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_cs_audit_logs_user ON public.cs_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_cs_audit_logs_created ON public.cs_audit_logs(created_at DESC);

-- دالة لتوليد أرقام التذاكر
CREATE OR REPLACE FUNCTION public.generate_support_ticket_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_num TEXT;
BEGIN
  v_num := 'TKT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
  RETURN v_num;
END;
$$;

-- دالة لتوليد أرقام الشكاوى
CREATE OR REPLACE FUNCTION public.generate_complaint_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_num TEXT;
BEGIN
  v_num := 'CMP-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
  RETURN v_num;
END;
$$;

-- دالة لتوليد أرقام المرتجعات
CREATE OR REPLACE FUNCTION public.generate_pharmacy_return_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_num TEXT;
BEGIN
  v_num := 'PRT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
  RETURN v_num;
END;
$$;

-- تفعيل RLS
ALTER TABLE public.crm_pharmacies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_response_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_audit_logs ENABLE ROW LEVEL SECURITY;

-- سياسات RLS أساسية (يمكن تحسينها لاحقاً)
CREATE POLICY "Enable read access for authenticated users" ON public.crm_pharmacies FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.crm_pharmacies FOR ALL TO authenticated USING (true);

CREATE POLICY "Enable read access for authenticated users" ON public.support_tickets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.support_tickets FOR ALL TO authenticated USING (true);

CREATE POLICY "Enable read access for authenticated users" ON public.ticket_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.ticket_messages FOR ALL TO authenticated USING (true);

CREATE POLICY "Enable read access for authenticated users" ON public.ticket_actions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.ticket_actions FOR ALL TO authenticated USING (true);

CREATE POLICY "Enable read access for authenticated users" ON public.ticket_response_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.ticket_response_templates FOR ALL TO authenticated USING (true);

CREATE POLICY "Enable read access for authenticated users" ON public.complaints FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.complaints FOR ALL TO authenticated USING (true);

CREATE POLICY "Enable read access for authenticated users" ON public.pharmacy_returns FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.pharmacy_returns FOR ALL TO authenticated USING (true);

CREATE POLICY "Enable read access for authenticated users" ON public.pharmacy_return_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.pharmacy_return_items FOR ALL TO authenticated USING (true);

CREATE POLICY "Enable read access for authenticated users" ON public.order_tracking FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.order_tracking FOR ALL TO authenticated USING (true);

CREATE POLICY "Enable read access for authenticated users" ON public.customer_notifications FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.customer_notifications FOR ALL TO authenticated USING (true);

CREATE POLICY "Enable read access for authenticated users" ON public.cs_audit_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable insert for authenticated users" ON public.cs_audit_logs FOR INSERT TO authenticated WITH CHECK (true);

-- منح الصلاحيات
GRANT ALL ON public.crm_pharmacies TO authenticated;
GRANT ALL ON public.support_tickets TO authenticated;
GRANT ALL ON public.ticket_messages TO authenticated;
GRANT ALL ON public.ticket_actions TO authenticated;
GRANT ALL ON public.ticket_response_templates TO authenticated;
GRANT ALL ON public.complaints TO authenticated;
GRANT ALL ON public.pharmacy_returns TO authenticated;
GRANT ALL ON public.pharmacy_return_items TO authenticated;
GRANT ALL ON public.order_tracking TO authenticated;
GRANT ALL ON public.customer_notifications TO authenticated;
GRANT ALL ON public.cs_audit_logs TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_support_ticket_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_complaint_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_pharmacy_return_number() TO authenticated;
