BEGIN;

ALTER TABLE public.leave_balances ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.leave_balances lb SET warehouse_id = (SELECT COALESCE(e.warehouse_id,we.warehouse_id) FROM public.employees e LEFT JOIN public.warehouse_employees we ON we.id = lb.employee_id WHERE e.id = lb.employee_id LIMIT 1) WHERE lb.warehouse_id IS NULL;
UPDATE public.leave_balances lb SET warehouse_id = (SELECT we.warehouse_id FROM public.warehouse_employees we WHERE we.id = lb.employee_id LIMIT 1) WHERE lb.warehouse_id IS NULL AND lb.employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leave_balances_wh ON public.leave_balances(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_leave_balances ON public.leave_balances;
CREATE TRIGGER trg_prevent_wh_change_leave_balances BEFORE UPDATE ON public.leave_balances FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.leave_requests lr SET warehouse_id = (SELECT COALESCE(e.warehouse_id,we.warehouse_id) FROM public.employees e LEFT JOIN public.warehouse_employees we ON we.id = lr.employee_id WHERE e.id = lr.employee_id LIMIT 1) WHERE lr.warehouse_id IS NULL;
UPDATE public.leave_requests lr SET warehouse_id = (SELECT we.warehouse_id FROM public.warehouse_employees we WHERE we.id = lr.employee_id LIMIT 1) WHERE lr.warehouse_id IS NULL AND lr.employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leave_requests_wh ON public.leave_requests(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_leave_requests ON public.leave_requests;
CREATE TRIGGER trg_prevent_wh_change_leave_requests BEFORE UPDATE ON public.leave_requests FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.attendance a SET warehouse_id = (SELECT COALESCE(e.warehouse_id,we.warehouse_id) FROM public.employees e LEFT JOIN public.warehouse_employees we ON we.id = a.employee_id WHERE e.id = a.employee_id LIMIT 1) WHERE a.warehouse_id IS NULL;
UPDATE public.attendance a SET warehouse_id = (SELECT we.warehouse_id FROM public.warehouse_employees we WHERE we.id = a.employee_id LIMIT 1) WHERE a.warehouse_id IS NULL AND a.employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_wh ON public.attendance(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_attendance ON public.attendance;
CREATE TRIGGER trg_prevent_wh_change_attendance BEFORE UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.performance_reviews ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.performance_reviews pr SET warehouse_id = (SELECT COALESCE(e.warehouse_id,we.warehouse_id) FROM public.employees e LEFT JOIN public.warehouse_employees we ON we.id = pr.employee_id WHERE e.id = pr.employee_id LIMIT 1) WHERE pr.warehouse_id IS NULL;
UPDATE public.performance_reviews pr SET warehouse_id = (SELECT we.warehouse_id FROM public.warehouse_employees we WHERE we.id = pr.employee_id LIMIT 1) WHERE pr.warehouse_id IS NULL AND pr.employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_performance_reviews_wh ON public.performance_reviews(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_performance_reviews ON public.performance_reviews;
CREATE TRIGGER trg_prevent_wh_change_performance_reviews BEFORE UPDATE ON public.performance_reviews FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.employee_assets ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.employee_assets ea SET warehouse_id = (SELECT COALESCE(e.warehouse_id,we.warehouse_id) FROM public.employees e LEFT JOIN public.warehouse_employees we ON we.id = ea.employee_id WHERE e.id = ea.employee_id LIMIT 1) WHERE ea.warehouse_id IS NULL;
UPDATE public.employee_assets ea SET warehouse_id = (SELECT we.warehouse_id FROM public.warehouse_employees we WHERE we.id = ea.employee_id LIMIT 1) WHERE ea.warehouse_id IS NULL AND ea.employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employee_assets_wh ON public.employee_assets(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_employee_assets ON public.employee_assets;
CREATE TRIGGER trg_prevent_wh_change_employee_assets BEFORE UPDATE ON public.employee_assets FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.employee_loans ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.employee_loans el SET warehouse_id = (SELECT COALESCE(e.warehouse_id,we.warehouse_id) FROM public.employees e LEFT JOIN public.warehouse_employees we ON we.id = el.employee_id WHERE e.id = el.employee_id LIMIT 1) WHERE el.warehouse_id IS NULL;
UPDATE public.employee_loans el SET warehouse_id = (SELECT we.warehouse_id FROM public.warehouse_employees we WHERE we.id = el.employee_id LIMIT 1) WHERE el.warehouse_id IS NULL AND el.employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employee_loans_wh ON public.employee_loans(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_employee_loans ON public.employee_loans;
CREATE TRIGGER trg_prevent_wh_change_employee_loans BEFORE UPDATE ON public.employee_loans FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

ALTER TABLE public.stock_transfer_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE public.stock_transfer_items sti SET warehouse_id = (SELECT st.from_warehouse_id FROM public.stock_transfers st WHERE st.id = sti.stock_transfer_id LIMIT 1) WHERE sti.warehouse_id IS NULL;
UPDATE public.stock_transfer_items sti SET warehouse_id = (SELECT st.to_warehouse_id FROM public.stock_transfers st WHERE st.id = sti.stock_transfer_id LIMIT 1) WHERE sti.warehouse_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_wh ON public.stock_transfer_items(warehouse_id);
DROP TRIGGER IF EXISTS trg_prevent_wh_change_stock_transfer_items ON public.stock_transfer_items;
CREATE TRIGGER trg_prevent_wh_change_stock_transfer_items BEFORE UPDATE ON public.stock_transfer_items FOR EACH ROW EXECUTE FUNCTION prevent_warehouse_id_change();

COMMIT;
