-- part3_sales_policies.sql — الجزء 3 من 3: منع الحذف المباشر + RLS والصلاحيات (يُنفَّذ بعد part1 و part2)
-- ============================================================
-- الجزء 3: منع الحذف المباشر للسجلات المالية + RLS + الصلاحيات
-- ============================================================

-- 3.1 منع الحذف الفيزيائي للفواتير والمرتجعات والمدفوعات (سجل مالي—تدقيقي — حذف ناعم فقط)
create or replace function public.f_sale_block_hard_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $body$
begin
  raise exception 'الحذف المباشر لسجلات المبيعات غير مسموح (سجل مالي/تدقيقي) — استخدم الحذف الناعم (deleted_at)';
end;
$body$;

do $body$
begin
  begin
    create trigger trg_block_delete_sales_invoices
      before delete on public.sales_invoices
      for each row execute function public.f_sale_block_hard_delete();
  exception when duplicate_object then null; when others then raise notice 'trg sales_invoices: %', SQLERRM; end;
  begin
    create trigger trg_block_delete_returns
      before delete on public.returns
      for each row execute function public.f_sale_block_hard_delete();
  exception when duplicate_object then null; when others then raise notice 'trg returns: %', SQLERRM; end;
  begin
    create trigger trg_block_delete_payments
      before delete on public.payments
      for each row execute function public.f_sale_block_hard_delete();
  exception when duplicate_object then null; when others then raise notice 'trg payments: %', SQLERRM; end;
end; $body$;

revoke all on function public.f_sale_block_hard_delete() from public;
grant execute on function public.f_sale_block_hard_delete() to service_role;

-- 3.2 RLS: جداول عروض البيع الجديدة + عزل المخزن (الوصول عبر الخادم service_role يتجاوز RLS)
alter table public.sales_quotes enable row level security;
alter table public.sales_quote_items enable row level security;

do $body$
begin
  begin
    create policy "sqo_select_own_wh" on public.sales_quotes for select to authenticated
      using (warehouse_id in (select warehouse_id from public.user_warehouses where user_id = auth.uid()));
  exception when others then null; end;
  begin
    create policy "sqi_select_own_wh" on public.sales_quote_items for select to authenticated
      using (quote_id in (select id from public.sales_quotes
                           where warehouse_id in (select warehouse_id from public.user_warehouses where user_id = auth.uid())));
  exception when others then null; end;
end; $body$;

grant select on public.sales_quotes, public.sales_quote_items to authenticated;

-- انتهى ترحيل نظام المبيعات
