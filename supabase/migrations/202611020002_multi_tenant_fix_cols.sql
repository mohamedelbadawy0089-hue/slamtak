BEGIN;

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

-- sales_invoice_items
ALTER TABLE public.sales_invoice_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.sales_invoice_items t SET warehouse_id = p.warehouse_id FROM public.sales_invoices p WHERE t.sales_invoice_id = p.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_invoice_items_wh ON public.sales_invoice_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_sales_invoice_items ON public.sales_invoice_items;
CREATE TRIGGER trg_prevent_wh_change_sales_invoice_items BEFORE UPDATE ON public.sales_invoice_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- sales_order_items
ALTER TABLE public.sales_order_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.sales_order_items t SET warehouse_id = p.warehouse_id FROM public.sales_orders p WHERE t.sales_order_id = p.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_order_items_wh ON public.sales_order_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_sales_order_items ON public.sales_order_items;
CREATE TRIGGER trg_prevent_wh_change_sales_order_items BEFORE UPDATE ON public.sales_order_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- sales_quote_items
ALTER TABLE public.sales_quote_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.sales_quote_items t SET warehouse_id = p.warehouse_id FROM public.sales_quotes p WHERE t.quote_id = p.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_quote_items_wh ON public.sales_quote_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_sales_quote_items ON public.sales_quote_items;
CREATE TRIGGER trg_prevent_wh_change_sales_quote_items BEFORE UPDATE ON public.sales_quote_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- purchase_invoice_items
ALTER TABLE public.purchase_invoice_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.purchase_invoice_items t SET warehouse_id = p.warehouse_id FROM public.purchase_invoices p WHERE t.purchase_invoice_id = p.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_items_wh ON public.purchase_invoice_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_purchase_invoice_items ON public.purchase_invoice_items;
CREATE TRIGGER trg_prevent_wh_change_purchase_invoice_items BEFORE UPDATE ON public.purchase_invoice_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- purchase_order_items
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.purchase_order_items t SET warehouse_id = p.warehouse_id FROM public.purchase_orders p WHERE t.purchase_order_id = p.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_wh ON public.purchase_order_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_purchase_order_items ON public.purchase_order_items;
CREATE TRIGGER trg_prevent_wh_change_purchase_order_items BEFORE UPDATE ON public.purchase_order_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- purchase_request_items
ALTER TABLE public.purchase_request_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.purchase_request_items t SET warehouse_id = p.warehouse_id FROM public.purchase_requests p WHERE t.request_id = p.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_wh ON public.purchase_request_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_purchase_request_items ON public.purchase_request_items;
CREATE TRIGGER trg_prevent_wh_change_purchase_request_items BEFORE UPDATE ON public.purchase_request_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- return_items
ALTER TABLE public.return_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.return_items t SET warehouse_id = p.warehouse_id FROM public.returns p WHERE t.return_id = p.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_return_items_wh ON public.return_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_return_items ON public.return_items;
CREATE TRIGGER trg_prevent_wh_change_return_items BEFORE UPDATE ON public.return_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- goods_receipt_items
ALTER TABLE public.goods_receipt_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.goods_receipt_items t SET warehouse_id = p.warehouse_id FROM public.goods_receipts p WHERE t.goods_receipt_id = p.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_goods_receipt_items_wh ON public.goods_receipt_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_goods_receipt_items ON public.goods_receipt_items;
CREATE TRIGGER trg_prevent_wh_change_goods_receipt_items BEFORE UPDATE ON public.goods_receipt_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- journal_entry_lines
ALTER TABLE public.journal_entry_lines ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.journal_entry_lines t SET warehouse_id = p.warehouse_id FROM public.journal_entries p WHERE t.entry_id = p.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_wh ON public.journal_entry_lines(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_journal_entry_lines ON public.journal_entry_lines;
CREATE TRIGGER trg_prevent_wh_change_journal_entry_lines BEFORE UPDATE ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- price_list_items
ALTER TABLE public.price_list_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.price_list_items t SET warehouse_id = p.warehouse_id FROM public.price_lists p WHERE t.price_list_id = p.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_price_list_items_wh ON public.price_list_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_price_list_items ON public.price_list_items;
CREATE TRIGGER trg_prevent_wh_change_price_list_items BEFORE UPDATE ON public.price_list_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- promotion_items
ALTER TABLE public.promotion_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.promotion_items t SET warehouse_id = p.warehouse_id FROM public.promotions p WHERE t.promotion_id = p.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_promotion_items_wh ON public.promotion_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_promotion_items ON public.promotion_items;
CREATE TRIGGER trg_prevent_wh_change_promotion_items BEFORE UPDATE ON public.promotion_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- promotion_usage
ALTER TABLE public.promotion_usage ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.promotion_usage t SET warehouse_id = p.warehouse_id FROM public.promotions p WHERE t.promotion_id = p.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_promotion_usage_wh ON public.promotion_usage(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_promotion_usage ON public.promotion_usage;
CREATE TRIGGER trg_prevent_wh_change_promotion_usage BEFORE UPDATE ON public.promotion_usage FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- payroll
ALTER TABLE public.payroll_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.payroll_items t SET warehouse_id = p.warehouse_id FROM public.payroll_runs p WHERE t.payroll_run_id = p.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_items_wh ON public.payroll_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_payroll_items ON public.payroll_items;
CREATE TRIGGER trg_prevent_wh_change_payroll_items BEFORE UPDATE ON public.payroll_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.payroll_settlements ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.payroll_settlements t SET warehouse_id = p.warehouse_id FROM public.payroll_runs p WHERE t.payroll_run_id = p.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_settlements_wh ON public.payroll_settlements(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_payroll_settlements ON public.payroll_settlements;
CREATE TRIGGER trg_prevent_wh_change_payroll_settlements BEFORE UPDATE ON public.payroll_settlements FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.payslips t SET warehouse_id = p.warehouse_id FROM public.payroll_runs p WHERE t.payroll_run_id = p.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_payslips_wh ON public.payslips(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_payslips ON public.payslips;
CREATE TRIGGER trg_prevent_wh_change_payslips BEFORE UPDATE ON public.payslips FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- hr
ALTER TABLE public.leave_balances ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.leave_balances t SET warehouse_id = COALESCE(e.warehouse_id,we.warehouse_id) FROM public.employees e LEFT JOIN public.warehouse_employees we ON we.id = t.employee_id WHERE t.employee_id = e.id AND t.warehouse_id IS NULL;
UPDATE public.leave_balances t SET warehouse_id = we.warehouse_id FROM public.warehouse_employees we WHERE t.employee_id = we.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_leave_balances_wh ON public.leave_balances(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_leave_balances ON public.leave_balances;
CREATE TRIGGER trg_prevent_wh_change_leave_balances BEFORE UPDATE ON public.leave_balances FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.leave_requests t SET warehouse_id = COALESCE(e.warehouse_id,we.warehouse_id) FROM public.employees e LEFT JOIN public.warehouse_employees we ON we.id = t.employee_id WHERE t.employee_id = e.id AND t.warehouse_id IS NULL;
UPDATE public.leave_requests t SET warehouse_id = we.warehouse_id FROM public.warehouse_employees we WHERE t.employee_id = we.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_leave_requests_wh ON public.leave_requests(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_leave_requests ON public.leave_requests;
CREATE TRIGGER trg_prevent_wh_change_leave_requests BEFORE UPDATE ON public.leave_requests FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.attendance t SET warehouse_id = COALESCE(e.warehouse_id,we.warehouse_id) FROM public.employees e LEFT JOIN public.warehouse_employees we ON we.id = t.employee_id WHERE t.employee_id = e.id AND t.warehouse_id IS NULL;
UPDATE public.attendance t SET warehouse_id = we.warehouse_id FROM public.warehouse_employees we WHERE t.employee_id = we.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_wh ON public.attendance(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_attendance ON public.attendance;
CREATE TRIGGER trg_prevent_wh_change_attendance BEFORE UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.performance_reviews ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.performance_reviews t SET warehouse_id = COALESCE(e.warehouse_id,we.warehouse_id) FROM public.employees e LEFT JOIN public.warehouse_employees we ON we.id = t.employee_id WHERE t.employee_id = e.id AND t.warehouse_id IS NULL;
UPDATE public.performance_reviews t SET warehouse_id = we.warehouse_id FROM public.warehouse_employees we WHERE t.employee_id = we.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_performance_reviews_wh ON public.performance_reviews(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_performance_reviews ON public.performance_reviews;
CREATE TRIGGER trg_prevent_wh_change_performance_reviews BEFORE UPDATE ON public.performance_reviews FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.employee_assets ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.employee_assets t SET warehouse_id = COALESCE(e.warehouse_id,we.warehouse_id) FROM public.employees e LEFT JOIN public.warehouse_employees we ON we.id = t.employee_id WHERE t.employee_id = e.id AND t.warehouse_id IS NULL;
UPDATE public.employee_assets t SET warehouse_id = we.warehouse_id FROM public.warehouse_employees we WHERE t.employee_id = we.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_employee_assets_wh ON public.employee_assets(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_employee_assets ON public.employee_assets;
CREATE TRIGGER trg_prevent_wh_change_employee_assets BEFORE UPDATE ON public.employee_assets FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.employee_loans ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.employee_loans t SET warehouse_id = COALESCE(e.warehouse_id,we.warehouse_id) FROM public.employees e LEFT JOIN public.warehouse_employees we ON we.id = t.employee_id WHERE t.employee_id = e.id AND t.warehouse_id IS NULL;
UPDATE public.employee_loans t SET warehouse_id = we.warehouse_id FROM public.warehouse_employees we WHERE t.employee_id = we.id AND t.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_employee_loans_wh ON public.employee_loans(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_employee_loans ON public.employee_loans;
CREATE TRIGGER trg_prevent_wh_change_employee_loans BEFORE UPDATE ON public.employee_loans FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

-- stock_transfer_items
ALTER TABLE public.stock_transfer_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.stock_transfer_items t SET warehouse_id = p.from_warehouse_id FROM public.stock_transfers p WHERE t.stock_transfer_id = p.id AND t.warehouse_id IS NULL;
UPDATE public.stock_transfer_items t SET warehouse_id = p.to_warehouse_id FROM public.stock_transfers p WHERE t.stock_transfer_id = p.id AND t.warehouse_id IS NULL AND p.from_warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_wh ON public.stock_transfer_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_stock_transfer_items ON public.stock_transfer_items;
CREATE TRIGGER trg_prevent_wh_change_stock_transfer_items BEFORE UPDATE ON public.stock_transfer_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

COMMIT;
