-- ============================================================
-- 202610200006: Egyptian Tax Engine
--    (  )
--     migration 202610200005
-- ============================================================

-- ============================================================
-- 1) tax_rates:   
-- ============================================================
create table if not exists public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,                         --   (: std, reduced, exempt)
  name text not null,                         --   ()
  name_ar text not null,                      --   ()
  rate decimal(5,2) not null default 0 check (rate >= 0 and rate <= 100), --  %
  description text,                           --  
  is_active boolean not null default true,
  effective_from date not null default current_date, --   
  effective_to date,                          --    (  )
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code, effective_from)
);

--  RLS
alter table public.tax_rates enable row level security;

drop policy if exists "tr_select_own_wh" on public.tax_rates;
create policy "tr_select_own_wh" on public.tax_rates for select to authenticated
  using (true);
grant select on public.tax_rates to authenticated;

create index if not exists ix_tr_tenant on public.tax_rates (tenant_id);
create index if not exists ix_tr_active on public.tax_rates (is_active, effective_from);

--     example
do $body$
declare
begin
  --     (14%)
  insert into public.tax_rates (tenant_id, code, name, name_ar, rate, description, is_active, effective_from)
    values ('00000000-0000-0000-0000-000000000001', 'std', 'Standard Rate', ' ', 14.00, '      ', true, current_date)
    on conflict (tenant_id, code, effective_from) do nothing;
  --     (5%)
  insert into public.tax_rates (tenant_id, code, name, name_ar, rate, description, is_active, effective_from)
    values ('00000000-0000-0000-0000-000000000001', 'reduced', 'Reduced Rate', ' ', 5.00, '       ', true, current_date)
    on conflict (tenant_id, code, effective_from) do nothing;
  --     (0%)
  insert into public.tax_rates (tenant_id, code, name, name_ar, rate, description, is_active, effective_from)
    values ('00000000-0000-0000-0000-000000000001', 'exempt', 'Exempt Rate', '', 0.00, '      ', true, current_date)
    on conflict (tenant_id, code, effective_from) do nothing;
  raise notice 'Tax rates seeded successfully';
end;
$body$;

-- ============================================================
-- 2) tax_transactions:    (  )
-- ============================================================
create table if not exists public.tax_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  tax_rate_id uuid not null references public.tax_rates(id) on delete restrict,
  reference_type text not null check (reference_type in ('sales_invoice','purchase_order','journal_entry','manual')),
  reference_id uuid,                           -- id    
  amount_before_tax decimal(18,2) not null,    --   
  tax_amount decimal(18,2) not null,          --   
  tax_base decimal(18,2),                     --   (  )
  description text,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','calculated','transferred','reconciled')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (tenant_id, reference_type, reference_id, tax_rate_id)
);

--  RLS
alter table public.tax_transactions enable row level security;

drop policy if exists "tt_select_own_wh" on public.tax_transactions;
create policy "tt_select_own_wh" on public.tax_transactions for select to authenticated
  using (warehouse_id in (select warehouse_id from public.user_warehouses where user_id = auth.uid()) or warehouse_id is null);
grant select on public.tax_transactions to authenticated;

create index if not exists ix_tt_tenant on public.tax_transactions (tenant_id);
create index if not exists ix_tt_rate on public.tax_transactions (tax_rate_id);
create index if not exists ix_tt_reference on public.tax_transactions (reference_type, reference_id);
create index if not exists ix_tt_status on public.tax_transactions (status);

-- ============================================================
-- 3) tax_summaries:    
-- ============================================================
create or replace view public.v_tax_summary as
select
  date_trunc('month', tt.created_at) as period,
  tr.code,
  tr.name_ar,
  --     ()
  coalesce(sum(case when tt.reference_type = 'sales_invoice' then tt.tax_amount end), 0) as sales_tax_output,
  coalesce(sum(case when tt.reference_type = 'sales_invoice' then tt.amount_before_tax end), 0) as sales_amount,
  --    ()
  coalesce(sum(case when tt.reference_type = 'purchase_order' then tt.tax_amount end), 0) as purchase_tax_input,
  coalesce(sum(case when tt.reference_type = 'purchase_order' then tt.amount_before_tax end), 0) as purchases_amount,
  --   (  )
  coalesce(sum(case when tt.reference_type = 'sales_invoice' then tt.tax_amount end), 0) -
  coalesce(sum(case when tt.reference_type = 'purchase_order' then tt.tax_amount end), 0) as net_tax,
  --  
  count(distinct case when tt.reference_type = 'sales_invoice' then tt.reference_id end) as sales_invoice_count,
  count(distinct case when tt.reference_type = 'purchase_order' then tt.reference_id end) as purchase_order_count
from public.tax_transactions tt
join public.tax_rates tr on tt.tax_rate_id = tr.id
group by period, tr.code, tr.name_ar
order by period desc, tr.code;

--  RLS  
grant select on public.v_tax_summary to authenticated;
-- ملاحظة: لا يمكن إنشاء فهرس على view في PostgreSQL — يُحذف هذا السطر

-- ============================================================
-- 4) Trigger: Auto-create tax transactions when sales invoice approved
-- ============================================================
create or replace function public.f_create_tax_transactions_sales()
returns trigger language plpgsql security definer set search_path = public as $body$
  declare
  v_inv public.sales_invoices%rowtype;
  v_tax_rate_id uuid;
  v_tax_percent numeric;
  v_subtotal numeric;
  v_tax_amount numeric;
  v_item record;
begin
  v_inv := new;
  --     
  if (v_inv.status = 'issued' and old.status <> 'issued') then
    --      ( )
    select id, rate into v_tax_rate_id, v_tax_percent
      from public.tax_rates
     where code = 'std' and is_active = true
     order by effective_from desc
     limit 1;
    if not found then
      -- fallback:  _active
      select id, rate into v_tax_rate_id, v_tax_percent
        from public.tax_rates where is_active = true limit 1;
    end if;
    if found then
      --     
      v_subtotal := 0;
      v_tax_amount := 0;
      for v_item in
        select sii.product_id, sii.quantity, sii.unit_price, sii.tax_percent,
               sii.discount_percent, sii.line_total
          from public.sales_invoice_items sii
         where sii.sales_invoice_id = v_inv.id
      loop
        --  tax_percent         v_item
        v_subtotal := v_subtotal + 
          round(v_item.quantity * v_item.unit_price * (1 - coalesce(v_item.discount_percent,0)/100), 2);
        --    
        v_tax_amount := v_tax_amount + 
          round((v_item.quantity * v_item.unit_price * (1 - coalesce(v_item.discount_percent,0)/100)) * 
                coalesce(v_item.tax_percent, v_tax_percent)/100, 2);
      end loop;
      --   
      insert into public.tax_transactions
        (tenant_id, tax_rate_id, reference_type, reference_id, amount_before_tax, tax_amount, description, status, created_by)
      values
        (v_inv.tenant_id, v_tax_rate_id, 'sales_invoice', v_inv.id, v_subtotal, v_tax_amount,
         '    ' || v_inv.invoice_number, 'calculated', v_inv.updated_by);
    end if;
  end if;
  return new;
end;
$body$;

revoke all on function public.f_create_tax_transactions_sales() from public;

-- Apply trigger to sales_invoices
do $body$
begin
  begin
    create trigger trg_sales_invoice_tax_automation
      after update on public.sales_invoices
      for each row execute function public.f_create_tax_transactions_sales();
    raise notice 'Trigger trg_sales_invoice_tax_automation created';
  exception when duplicate_object then
    execute 'drop trigger if exists trg_sales_invoice_tax_automation on public.sales_invoices';
    create trigger trg_sales_invoice_tax_automation
      after update on public.sales_invoices
      for each row execute function public.f_create_tax_transactions_sales();
    raise notice 'Trigger trg_sales_invoice_tax_automation recreated';
  end;
end
$body$;

revoke all on function public.f_create_tax_transactions_sales() from public;
-- ============================================================
-- 5) Trigger: Auto-create tax transactions when purchase order received
-- ============================================================
create or replace function public.f_create_tax_transactions_purchases()
returns trigger language plpgsql security definer set search_path = public as $body$
  declare
  v_po public.purchase_orders%rowtype;
  v_tax_rate_id uuid;
  v_tax_percent numeric;
  v_total_amount numeric;
  v_tax_amount numeric;
begin
  v_po := new;
  
  --    
  if (v_po.status = 'received' and old.status <> 'received') then
    --     
    select id, rate into v_tax_rate_id, v_tax_percent
      from public.tax_rates
     where code = 'std' and is_active = true
     order by effective_from desc
     limit 1;
    
    if not found then
      select id, rate into v_tax_rate_id, v_tax_percent
        from public.tax_rates where is_active = true limit 1;
    end if;
    
    if found then
      --     
      v_total_amount := coalesce(v_po.total_amount, 0);
      v_tax_amount := round(v_total_amount * v_tax_percent / 100, 2);
      
      --   
      insert into public.tax_transactions
        (tenant_id, tax_rate_id, reference_type, reference_id, amount_before_tax, tax_amount, description, status, created_by)
      values
        (v_po.tenant_id, v_tax_rate_id, 'purchase_order', v_po.id, v_total_amount, v_tax_amount,
         '    ' || coalesce(v_po.order_number, v_po.id::text), 'calculated', v_po.updated_by);
    end if;
  end if;
  
  return new;
end;
$body$;

revoke all on function public.f_create_tax_transactions_purchases() from public;
-- Apply trigger to purchase_orders
do $body$
begin
  begin
    create trigger trg_purchase_order_tax_automation
      after update on public.purchase_orders
      for each row execute function public.f_create_tax_transactions_purchases();
    raise notice 'Trigger trg_purchase_order_tax_automation created';
  exception when duplicate_object then
    execute 'drop trigger if exists trg_purchase_order_tax_automation on public.purchase_orders';
    create trigger trg_purchase_order_tax_automation
      after update on public.purchase_orders
      for each row execute function public.f_create_tax_transactions_purchases();
    raise notice 'Trigger trg_purchase_order_tax_automation recreated';
  end;
end
$body$;

revoke all on function public.f_create_tax_transactions_purchases() from public;

-- ============================================================
-- Final Verification
-- ============================================================
do $body$
begin
  raise notice 'Phase 6: Egyptian Tax Engine Complete';
end
$body$;

SELECT 'Verification:' AS check_step;
SELECT count(*) AS tax_rate_count FROM public.tax_rates;
SELECT count(*) AS tax_transaction_count FROM public.tax_transactions;
SELECT 'Tax Summary View Records:' AS summary;
SELECT period, sales_tax_output, purchase_tax_input, net_tax 
  FROM public.v_tax_summary 
  LIMIT 5;
SELECT 'Phase 6 ready: Egyptian tax rates, transactions & summaries created' AS message;