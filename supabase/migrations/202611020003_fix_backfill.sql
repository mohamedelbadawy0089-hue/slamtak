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

-- re-apply safely
ALTER TABLE public.sales_invoice_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.sales_invoice_items siit SET warehouse_id = si.warehouse_id FROM public.sales_invoices si WHERE siit.sales_invoice_id = si.id AND siit.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_invoice_items_wh ON public.sales_invoice_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_sales_invoice_items ON public.sales_invoice_items;
CREATE TRIGGER trg_prevent_wh_change_sales_invoice_items BEFORE UPDATE ON public.sales_invoice_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.sales_order_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.sales_order_items soit SET warehouse_id = so.warehouse_id FROM public.sales_orders so WHERE soit.sales_order_id = so.id AND soit.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_order_items_wh ON public.sales_order_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_sales_order_items ON public.sales_order_items;
CREATE TRIGGER trg_prevent_wh_change_sales_order_items BEFORE UPDATE ON public.sales_order_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.sales_quote_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.sales_quote_items sqit SET warehouse_id = sq.warehouse_id FROM public.sales_quotes sq WHERE sqit.quote_id = sq.id AND sqit.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_quote_items_wh ON public.sales_quote_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_sales_quote_items ON public.sales_quote_items;
CREATE TRIGGER trg_prevent_wh_change_sales_quote_items BEFORE UPDATE ON public.sales_quote_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.purchase_invoice_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.purchase_invoice_items piit SET warehouse_id = pi.warehouse_id FROM public.purchase_invoices pi WHERE piit.purchase_invoice_id = pi.id AND piit.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_items_wh ON public.purchase_invoice_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_purchase_invoice_items ON public.purchase_invoice_items;
CREATE TRIGGER trg_prevent_wh_change_purchase_invoice_items BEFORE UPDATE ON public.purchase_invoice_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.purchase_order_items poit SET warehouse_id = po.warehouse_id FROM public.purchase_orders po WHERE poit.purchase_order_id = po.id AND poit.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_wh ON public.purchase_order_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_purchase_order_items ON public.purchase_order_items;
CREATE TRIGGER trg_prevent_wh_change_purchase_order_items BEFORE UPDATE ON public.purchase_order_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.purchase_request_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.purchase_request_items prit SET warehouse_id = pr.warehouse_id FROM public.purchase_requests pr WHERE prit.request_id = pr.id AND prit.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_wh ON public.purchase_request_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_purchase_request_items ON public.purchase_request_items;
CREATE TRIGGER trg_prevent_wh_change_purchase_request_items BEFORE UPDATE ON public.purchase_request_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.return_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.return_items rit SET warehouse_id = r.warehouse_id FROM public.returns r WHERE rit.return_id = r.id AND rit.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_return_items_wh ON public.return_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_return_items ON public.return_items;
CREATE TRIGGER trg_prevent_wh_change_return_items BEFORE UPDATE ON public.return_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.goods_receipt_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.goods_receipt_items grit SET warehouse_id = gr.warehouse_id FROM public.goods_receipts gr WHERE grit.goods_receipt_id = gr.id AND grit.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_goods_receipt_items_wh ON public.goods_receipt_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_goods_receipt_items ON public.goods_receipt_items;
CREATE TRIGGER trg_prevent_wh_change_goods_receipt_items BEFORE UPDATE ON public.goods_receipt_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.journal_entry_lines ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.journal_entry_lines jelt SET warehouse_id = je.warehouse_id FROM public.journal_entries je WHERE jelt.entry_id = je.id AND jelt.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_wh ON public.journal_entry_lines(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_journal_entry_lines ON public.journal_entry_lines;
CREATE TRIGGER trg_prevent_wh_change_journal_entry_lines BEFORE UPDATE ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.price_list_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.price_list_items plit SET warehouse_id = pl.warehouse_id FROM public.price_lists pl WHERE plit.price_list_id = pl.id AND plit.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_price_list_items_wh ON public.price_list_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_price_list_items ON public.price_list_items;
CREATE TRIGGER trg_prevent_wh_change_price_list_items BEFORE UPDATE ON public.price_list_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.promotion_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.promotion_items pit2 SET warehouse_id = p.warehouse_id FROM public.promotions p WHERE pit2.promotion_id = p.id AND pit2.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_promotion_items_wh ON public.promotion_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_promotion_items ON public.promotion_items;
CREATE TRIGGER trg_prevent_wh_change_promotion_items BEFORE UPDATE ON public.promotion_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.promotion_usage ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.promotion_usage put SET warehouse_id = p.warehouse_id FROM public.promotions p WHERE put.promotion_id = p.id AND put.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_promotion_usage_wh ON public.promotion_usage(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_promotion_usage ON public.promotion_usage;
CREATE TRIGGER trg_prevent_wh_change_promotion_usage BEFORE UPDATE ON public.promotion_usage FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.payroll_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.payroll_items pi3 SET warehouse_id = pr.warehouse_id FROM public.payroll_runs pr WHERE pi3.payroll_run_id = pr.id AND pi3.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_items_wh ON public.payroll_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_payroll_items ON public.payroll_items;
CREATE TRIGGER trg_prevent_wh_change_payroll_items BEFORE UPDATE ON public.payroll_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.payroll_settlements ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.payroll_settlements ps2 SET warehouse_id = pr.warehouse_id FROM public.payroll_runs pr WHERE ps2.payroll_run_id = pr.id AND ps2.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_settlements_wh ON public.payroll_settlements(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_payroll_settlements ON public.payroll_settlements;
CREATE TRIGGER trg_prevent_wh_change_payroll_settlements BEFORE UPDATE ON public.payroll_settlements FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.payslips ps3 SET warehouse_id = pr.warehouse_id FROM public.payroll_runs pr WHERE ps3.payroll_run_id = pr.id AND ps3.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_payslips_wh ON public.payslips(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_payslips ON public.payslips;
CREATE TRIGGER trg_prevent_wh_change_payslips BEFORE UPDATE ON public.payslips FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.leave_balances ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.leave_balances lbt SET warehouse_id = COALESCE(e.warehouse_id,we.warehouse_id) FROM public.employees e LEFT JOIN public.warehouse_employees we ON we.id = lbt.employee_id WHERE lbt.employee_id = e.id AND lbt.warehouse_id IS NULL;
UPDATE public.leave_balances lbt SET warehouse_id = we.warehouse_id FROM public.warehouse_employees we WHERE lbt.employee_id = we.id AND lbt.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_leave_balances_wh ON public.leave_balances(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_leave_balances ON public.leave_balances;
CREATE TRIGGER trg_prevent_wh_change_leave_balances BEFORE UPDATE ON public.leave_balances FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.leave_requests lrt SET warehouse_id = COALESCE(e.warehouse_id,we.warehouse_id) FROM public.employees e LEFT JOIN public.warehouse_employees we ON we.id = lrt.employee_id WHERE lrt.employee_id = e.id AND lrt.warehouse_id IS NULL;
UPDATE public.leave_requests lrt SET warehouse_id = we.warehouse_id FROM public.warehouse_employees we WHERE lrt.employee_id = we.id AND lrt.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_leave_requests_wh ON public.leave_requests(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_leave_requests ON public.leave_requests;
CREATE TRIGGER trg_prevent_wh_change_leave_requests BEFORE UPDATE ON public.leave_requests FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.attendance at2 SET warehouse_id = COALESCE(e.warehouse_id,we.warehouse_id) FROM public.employees e LEFT JOIN public.warehouse_employees we ON we.id = at2.employee_id WHERE at2.employee_id = e.id AND at2.warehouse_id IS NULL;
UPDATE public.attendance at2 SET warehouse_id = we.warehouse_id FROM public.warehouse_employees we WHERE at2.employee_id = we.id AND at2.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_wh ON public.attendance(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_attendance ON public.attendance;
CREATE TRIGGER trg_prevent_wh_change_attendance BEFORE UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.performance_reviews ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.performance_reviews pr2 SET warehouse_id = COALESCE(e.warehouse_id,we.warehouse_id) FROM public.employees e LEFT JOIN public.warehouse_employees we ON we.id = pr2.employee_id WHERE pr2.employee_id = e.id AND pr2.warehouse_id IS NULL;
UPDATE public.performance_reviews pr2 SET warehouse_id = we.warehouse_id FROM public.warehouse_employees we WHERE pr2.employee_id = we.id AND pr2.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_performance_reviews_wh ON public.performance_reviews(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_performance_reviews ON public.performance_reviews;
CREATE TRIGGER trg_prevent_wh_change_performance_reviews BEFORE UPDATE ON public.performance_reviews FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.employee_assets ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.employee_assets ea2 SET warehouse_id = COALESCE(e.warehouse_id,we.warehouse_id) FROM public.employees e LEFT JOIN public.warehouse_employees we ON we.id = ea2.employee_id WHERE ea2.employee_id = e.id AND ea2.warehouse_id IS NULL;
UPDATE public.employee_assets ea2 SET warehouse_id = we.warehouse_id FROM public.warehouse_employees we WHERE ea2.employee_id = we.id AND ea2.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_employee_assets_wh ON public.employee_assets(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_employee_assets ON public.employee_assets;
CREATE TRIGGER trg_prevent_wh_change_employee_assets BEFORE UPDATE ON public.employee_assets FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.employee_loans ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.employee_loans el2 SET warehouse_id = COALESCE(e.warehouse_id,we.warehouse_id) FROM public.employees e LEFT JOIN public.warehouse_employees we ON we.id = el2.employee_id WHERE el2.employee_id = e.id AND el2.warehouse_id IS NULL;
UPDATE public.employee_loans el2 SET warehouse_id = we.warehouse_id FROM public.warehouse_employees we WHERE el2.employee_id = we.id AND el2.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_employee_loans_wh ON public.employee_loans(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_employee_loans ON public.employee_loans;
CREATE TRIGGER trg_prevent_wh_change_employee_loans BEFORE UPDATE ON public.employee_loans FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.stock_transfer_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.stock_transfer_items stit SET warehouse_id = st.from_warehouse_id FROM public.stock_transfers st WHERE stit.stock_transfer_id = st.id AND stit.warehouse_id IS NULL;
UPDATE public.stock_transfer_items stit SET warehouse_id = st.to_warehouse_id FROM public.stock_transfers st WHERE stit.stock_transfer_id = st.id AND st.to_warehouse_id IS NOT NULL AND stit.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_wh ON public.stock_transfer_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_stock_transfer_items ON public.stock_transfer_items;
CREATE TRIGGER trg_prevent_wh_change_stock_transfer_items BEFORE UPDATE ON public.stock_transfer_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

COMMIT;
