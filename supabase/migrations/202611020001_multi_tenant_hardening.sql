-- Multi-Tenant Hardening: warehouse-scoped isolation for ALL business data
-- Safe, additive, no data deletion. Backfill via FK chains.

BEGIN;

-- 1) Ensure warehouse_id exists on tenants? tenants don't strictly need per-row but keep consistent
-- 2) Add warehouse_id to detail tables that can be derived
-- Helper: function to block warehouse_id changes
CREATE OR REPLACE FUNCTION prevent_warehouse_id_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.warehouse_id IS DISTINCT FROM NEW.warehouse_id THEN
      RAISE EXCEPTION 'لا يمكن تغيير warehouse_id بعد الإنشاء (عزل متعدد المخازن)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- A) sales_invoice_items -> sales_invoices.warehouse_id
ALTER TABLE public.sales_invoice_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.sales_invoice_items sii
SET warehouse_id = si.warehouse_id
FROM public.sales_invoices si
WHERE sii.invoice_id = si.id AND sii.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_invoice_items_wh ON public.sales_invoice_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_sales_invoice_items ON public.sales_invoice_items;
CREATE TRIGGER trg_prevent_wh_change_sales_invoice_items
  BEFORE UPDATE ON public.sales_invoice_items
  FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- B) sales_order_items
ALTER TABLE public.sales_order_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.sales_order_items soi
SET warehouse_id = so.warehouse_id
FROM public.sales_orders so
WHERE soi.order_id = so.id AND soi.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_order_items_wh ON public.sales_order_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_sales_order_items ON public.sales_order_items;
CREATE TRIGGER trg_prevent_wh_change_sales_order_items
  BEFORE UPDATE ON public.sales_order_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- C) sales_quote_items
ALTER TABLE public.sales_quote_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.sales_quote_items sqi
SET warehouse_id = sq.warehouse_id
FROM public.sales_quotes sq
WHERE sqi.quote_id = sq.id AND sqi.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_quote_items_wh ON public.sales_quote_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_sales_quote_items ON public.sales_quote_items;
CREATE TRIGGER trg_prevent_wh_change_sales_quote_items
  BEFORE UPDATE ON public.sales_quote_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- D) purchase_invoice_items
ALTER TABLE public.purchase_invoice_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.purchase_invoice_items pii
SET warehouse_id = pi.warehouse_id
FROM public.purchase_invoices pi
WHERE pii.purchase_invoice_id = pi.id AND pii.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_items_wh ON public.purchase_invoice_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_purchase_invoice_items ON public.purchase_invoice_items;
CREATE TRIGGER trg_prevent_wh_change_purchase_invoice_items
  BEFORE UPDATE ON public.purchase_invoice_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- E) purchase_order_items
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.purchase_order_items poi
SET warehouse_id = po.warehouse_id
FROM public.purchase_orders po
WHERE poi.purchase_order_id = po.id AND poi.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_wh ON public.purchase_order_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_purchase_order_items ON public.purchase_order_items;
CREATE TRIGGER trg_prevent_wh_change_purchase_order_items
  BEFORE UPDATE ON public.purchase_order_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- F) purchase_request_items
ALTER TABLE public.purchase_request_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.purchase_request_items pri
SET warehouse_id = pr.warehouse_id
FROM public.purchase_requests pr
WHERE pri.request_id = pr.id AND pri.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_wh ON public.purchase_request_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_purchase_request_items ON public.purchase_request_items;
CREATE TRIGGER trg_prevent_wh_change_purchase_request_items
  BEFORE UPDATE ON public.purchase_request_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- G) return_items
ALTER TABLE public.return_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.return_items ri
SET warehouse_id = r.warehouse_id
FROM public.returns r
WHERE ri.return_id = r.id AND ri.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_return_items_wh ON public.return_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_return_items ON public.return_items;
CREATE TRIGGER trg_prevent_wh_change_return_items
  BEFORE UPDATE ON public.return_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- H) goods_receipt_items
ALTER TABLE public.goods_receipt_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.goods_receipt_items gri
SET warehouse_id = gr.warehouse_id
FROM public.goods_receipts gr
WHERE gri.goods_receipt_id = gr.id AND gri.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_goods_receipt_items_wh ON public.goods_receipt_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_goods_receipt_items ON public.goods_receipt_items;
CREATE TRIGGER trg_prevent_wh_change_goods_receipt_items
  BEFORE UPDATE ON public.goods_receipt_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- I) journal_entry_lines
ALTER TABLE public.journal_entry_lines ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.journal_entry_lines jel
SET warehouse_id = je.warehouse_id
FROM public.journal_entries je
WHERE jel.entry_id = je.id AND jel.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_wh ON public.journal_entry_lines(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_journal_entry_lines ON public.journal_entry_lines;
CREATE TRIGGER trg_prevent_wh_change_journal_entry_lines
  BEFORE UPDATE ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- J) price_list_items
ALTER TABLE public.price_list_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.price_list_items pli
SET warehouse_id = pl.warehouse_id
FROM public.price_lists pl
WHERE pli.price_list_id = pl.id AND pli.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_price_list_items_wh ON public.price_list_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_price_list_items ON public.price_list_items;
CREATE TRIGGER trg_prevent_wh_change_price_list_items
  BEFORE UPDATE ON public.price_list_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- K) promotion_items
ALTER TABLE public.promotion_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.promotion_items pi
SET warehouse_id = p.warehouse_id
FROM public.promotions p
WHERE pi.promotion_id = p.id AND pi.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_promotion_items_wh ON public.promotion_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_promotion_items ON public.promotion_items;
CREATE TRIGGER trg_prevent_wh_change_promotion_items
  BEFORE UPDATE ON public.promotion_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- L) promotion_usage
ALTER TABLE public.promotion_usage ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.promotion_usage pu
SET warehouse_id = p.warehouse_id
FROM public.promotions p
WHERE pu.promotion_id = p.id AND pu.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_promotion_usage_wh ON public.promotion_usage(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_promotion_usage ON public.promotion_usage;
CREATE TRIGGER trg_prevent_wh_change_promotion_usage
  BEFORE UPDATE ON public.promotion_usage FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- M) payroll_items / settlements via payroll_run
ALTER TABLE public.payroll_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.payroll_items pit
SET warehouse_id = pr.warehouse_id
FROM public.payroll_runs pr
WHERE pit.payroll_run_id = pr.id AND pit.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_items_wh ON public.payroll_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_payroll_items ON public.payroll_items;
CREATE TRIGGER trg_prevent_wh_change_payroll_items
  BEFORE UPDATE ON public.payroll_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.payroll_settlements ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.payroll_settlements ps
SET warehouse_id = pr.warehouse_id
FROM public.payroll_runs pr
WHERE ps.payroll_run_id = pr.id AND ps.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_settlements_wh ON public.payroll_settlements(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_payroll_settlements ON public.payroll_settlements;
CREATE TRIGGER trg_prevent_wh_change_payroll_settlements
  BEFORE UPDATE ON public.payroll_settlements FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- N) payslips
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.payslips psl
SET warehouse_id = pr.warehouse_id
FROM public.payroll_runs pr
WHERE psl.payroll_run_id = pr.id AND psl.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_payslips_wh ON public.payslips(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_payslips ON public.payslips;
CREATE TRIGGER trg_prevent_wh_change_payslips
  BEFORE UPDATE ON public.payslips FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- O) leave_balances/requests via employee (try employees first, else warehouse_employees)
ALTER TABLE public.leave_balances ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.leave_balances lb
SET warehouse_id = COALESCE(e.warehouse_id, we.warehouse_id)
FROM public.employees e
LEFT JOIN public.warehouse_employees we ON we.id = lb.employee_id
WHERE lb.employee_id = e.id AND lb.warehouse_id IS NULL;
UPDATE public.leave_balances lb
SET warehouse_id = we.warehouse_id
FROM public.warehouse_employees we
WHERE lb.employee_id = we.id AND lb.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_leave_balances_wh ON public.leave_balances(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_leave_balances ON public.leave_balances;
CREATE TRIGGER trg_prevent_wh_change_leave_balances BEFORE UPDATE ON public.leave_balances FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.leave_requests lr
SET warehouse_id = COALESCE(e.warehouse_id, we.warehouse_id)
FROM public.employees e
LEFT JOIN public.warehouse_employees we ON we.id = lr.employee_id
WHERE lr.employee_id = e.id AND lr.warehouse_id IS NULL;
UPDATE public.leave_requests lr
SET warehouse_id = we.warehouse_id
FROM public.warehouse_employees we
WHERE lr.employee_id = we.id AND lr.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_leave_requests_wh ON public.leave_requests(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_leave_requests ON public.leave_requests;
CREATE TRIGGER trg_prevent_wh_change_leave_requests BEFORE UPDATE ON public.leave_requests FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.attendance a
SET warehouse_id = COALESCE(e.warehouse_id, we.warehouse_id)
FROM public.employees e
LEFT JOIN public.warehouse_employees we ON we.id = a.employee_id
WHERE a.employee_id = e.id AND a.warehouse_id IS NULL;
UPDATE public.attendance a
SET warehouse_id = we.warehouse_id
FROM public.warehouse_employees we
WHERE a.employee_id = we.id AND a.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_wh ON public.attendance(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_attendance ON public.attendance;
CREATE TRIGGER trg_prevent_wh_change_attendance BEFORE UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.performance_reviews ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.performance_reviews prr
SET warehouse_id = COALESCE(e.warehouse_id, we.warehouse_id)
FROM public.employees e
LEFT JOIN public.warehouse_employees we ON we.id = prr.employee_id
WHERE prr.employee_id = e.id AND prr.warehouse_id IS NULL;
UPDATE public.performance_reviews prr
SET warehouse_id = we.warehouse_id
FROM public.warehouse_employees we
WHERE prr.employee_id = we.id AND prr.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_performance_reviews_wh ON public.performance_reviews(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_performance_reviews ON public.performance_reviews;
CREATE TRIGGER trg_prevent_wh_change_performance_reviews BEFORE UPDATE ON public.performance_reviews FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.employee_assets ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.employee_assets ea
SET warehouse_id = COALESCE(e.warehouse_id, we.warehouse_id)
FROM public.employees e
LEFT JOIN public.warehouse_employees we ON we.id = ea.employee_id
WHERE ea.employee_id = e.id AND ea.warehouse_id IS NULL;
UPDATE public.employee_assets ea
SET warehouse_id = we.warehouse_id
FROM public.warehouse_employees we
WHERE ea.employee_id = we.id AND ea.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_employee_assets_wh ON public.employee_assets(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_employee_assets ON public.employee_assets;
CREATE TRIGGER trg_prevent_wh_change_employee_assets BEFORE UPDATE ON public.employee_assets FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.employee_loans ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.employee_loans el
SET warehouse_id = COALESCE(e.warehouse_id, we.warehouse_id)
FROM public.employees e
LEFT JOIN public.warehouse_employees we ON we.id = el.employee_id
WHERE el.employee_id = e.id AND el.warehouse_id IS NULL;
UPDATE public.employee_loans el
SET warehouse_id = we.warehouse_id
FROM public.warehouse_employees we
WHERE el.employee_id = we.id AND el.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_employee_loans_wh ON public.employee_loans(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_employee_loans ON public.employee_loans;
CREATE TRIGGER trg_prevent_wh_change_employee_loans BEFORE UPDATE ON public.employee_loans FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- P) stock_transfer_items via stock_transfers
ALTER TABLE public.stock_transfer_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.stock_transfer_items sti
SET warehouse_id = st.from_warehouse_id
FROM public.stock_transfers st
WHERE sti.transfer_id = st.id AND sti.warehouse_id IS NULL;
UPDATE public.stock_transfer_items sti
SET warehouse_id = st.to_warehouse_id
FROM public.stock_transfers st
WHERE sti.transfer_id = st.id AND sti.warehouse_id IS NULL AND st.from_warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_wh ON public.stock_transfer_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_stock_transfer_items ON public.stock_transfer_items;
CREATE TRIGGER trg_prevent_wh_change_stock_transfer_items BEFORE UPDATE ON public.stock_transfer_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- Q) Settings per warehouse? keep as-is but we can also consider; RLS will cover
-- R) hrm_audit_logs has company_id; try to map via company->warehouse? if not obvious leave but RLS must be strict
ALTER TABLE public.hrm_audit_logs ADD COLUMN IF NOT EXISTS warehouse_id UUID;
CREATE INDEX IF NOT EXISTS idx_hrm_audit_logs_wh ON public.hrm_audit_logs(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_hrm_audit_logs ON public.hrm_audit_logs;
CREATE TRIGGER trg_prevent_wh_change_hrm_audit_logs BEFORE UPDATE ON public.hrm_audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

COMMIT;
