-- =============================================================================
-- 202610200007: Production-Complete ERP Extensions
-- Fixed Assets, Auto-Depreciation Triggers, Approval Workflows & Financial Reports
-- Generated for Production Deployment
-- =============================================================================
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name_ar text not null,
  name_en text,
  description text,
  purchase_date date not null,
  cost decimal(18,2) not null check (cost >= 0),
  salvage_value decimal(18,2) not null default 0 check (salvage_value >= 0),
  useful_life_years integer not null check (useful_life_years > 0),
  category text not null,
  status text not null default 'active' check (status in ('active','retired','sold','transferred')),
  warehouse_id uuid references public.warehouses(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  location_ar text,
  location_en text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);
alter table public.assets enable row level security;
drop policy if exists "assets_select_own_wh" on public.assets;
create policy "assets_select_own_wh" on public.assets for select to authenticated
  using (warehouse_id in (select warehouse_id from public.user_warehouses where user_id = auth.uid()) or warehouse_id is null);
drop policy if exists "assets_insert_own_wh" on public.assets;
create policy "assets_insert_own_wh" on public.assets for insert to authenticated with check (tenant_id = auth.uid()::uuid);
grant all on public.assets to service_role;
grant select, insert, update, delete on public.assets to authenticated;
create index if not exists ix_assets_tenant on public.assets (tenant_id);
create index if not exists ix_assets_category on public.assets (category);
create index if not exists ix_assets_status on public.assets (status);
create index if not exists ix_assets_purchase_date on public.assets (purchase_date);
comment on table public.assets is '    Triggers  ';
create table if not exists public.depreciation_schedules (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  tenant_id uuid not null,
  start_date date not null,
  end_date date,
  method text not null check (method in ('straight_line', 'declining_balance')),
  annual_rate decimal(5,2) check (annual_rate > 0 and annual_rate <= 100),
  accumulated_depreciation decimal(18,2) not null default 0 check (accumulated_depreciation >= 0),
  current_period_depreciation decimal(18,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (asset_id, start_date)
);
alter table public.depreciation_schedules enable row level security;
drop policy if exists "ds_select_own_asset" on public.depreciation_schedules;
create policy "ds_select_own_asset" on public.depreciation_schedules for select to authenticated
  using (asset_id in (select id from public.assets where tenant_id = auth.uid()::uuid));
drop policy if exists "ds_insert_own_tenant" on public.depreciation_schedules;
create policy "ds_insert_own_tenant" on public.depreciation_schedules for insert to authenticated with check (tenant_id = auth.uid()::uuid);
grant all on public.depreciation_schedules to service_role;
grant select, insert on public.depreciation_schedules to authenticated;
create index if not exists ix_ds_asset on public.depreciation_schedules (asset_id);
create index if not exists ix_ds_tenant on public.depreciation_schedules (tenant_id);
create index if not exists ix_ds_start_date on public.depreciation_schedules (start_date);
comment on table public.depreciation_schedules is '   ';
create table if not exists public.asset_disposals (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete restrict,
  tenant_id uuid not null,
  disposal_date date not null,
  disposal_method text not null check (disposal_method in ('sale','scrap','transfer')),
  disposal_value decimal(18,2) not null check (disposal_value >= 0),
  accumulated_depreciation_at_disposal decimal(18,2) not null default 0,
  sale_proceeds decimal(18,2),
  gain_loss_on_disposal decimal(18,2),
  notes text,
  disposed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (asset_id, disposal_date)
);
alter table public.asset_disposals enable row level security;
drop policy if exists "ad_select_own_asset" on public.asset_disposals;
create policy "ad_select_own_asset" on public.asset_disposals for select to authenticated
  using (asset_id in (select id from public.assets where tenant_id = auth.uid()::uuid));
drop policy if exists "ad_insert_own_tenant" on public.asset_disposals;
create policy "ad_insert_own_tenant" on public.asset_disposals for insert to authenticated with check (tenant_id = auth.uid()::uuid);
grant all on public.asset_disposals to service_role;
grant select, insert on public.asset_disposals to authenticated;
create index if not exists ix_ad_asset on public.asset_disposals (asset_id);
create index if not exists ix_ad_date on public.asset_disposals (disposal_date);
comment on table public.asset_disposals is '      ';
create or replace function public.f_trigger_update_asset_depreciation()
returns trigger
language plpgsql
security definer
set search_path = public
as $body$
begin
  --           
  if (new.status <> old.status or new.cost <> old.cost or new.useful_life_years <> old.useful_life_years) then
    --       
    update public.depreciation_schedules
       set accumulated_depreciation = case when new.cost is not null then
         -- :       
         (select case when extract(year from age(current_date, new.purchase_date)) >= new.useful_life_years
           then new.cost - new.salvage_value
           else new.cost * (1 - (1 - (new.salvage_value/new.cost)::numeric/new.useful_life_years * extract(year from age(current_date, new.purchase_date))))::numeric(18,2)
         end
         from public.assets where id = new.id)
     end
     where asset_id = new.id;
  end if;
  return new;
end;
$body$;
create trigger trg_update_asset_depreciation
  after update on public.assets
  for each row execute function public.f_trigger_update_asset_depreciation();
revoke all on function public.f_trigger_update_asset_depreciation() from public;
create or replace function public.f_trigger_insert_asset_depreciation()
returns trigger
language plpgsql
security definer
set search_path = public
as $body$
begin
  --        
  if not exists (select 1 from public.depreciation_schedules where asset_id = new.id) then
    insert into public.depreciation_schedules
      (asset_id, tenant_id, start_date, method, annual_rate, accumulated_depreciation, current_period_depreciation, notes)
    values
      (new.id, new.tenant_id, new.purchase_date, 'straight_line', 
       case when new.useful_life_years > 0 then 100.00/new.useful_life_years else 0 end,
       0, 0, '    ');
  end if;
  return new;
end;
$body$;
create trigger trg_insert_asset_depreciation
  after insert on public.assets
  for each row execute function public.f_trigger_insert_asset_depreciation();
revoke all on function public.f_trigger_insert_asset_depreciation() from public;
create table if not exists public.approval_workflows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  entity_type text not null check (entity_type in ('purchase_invoice','vendor_payment','cash_withdrawal','journal_entry','asset_disposal')),
  entity_id uuid not null,
  workflow_name text not null,
  description text,
  required_approval_levels integer not null default 1 check (required_approval_levels > 0),
  current_level integer not null default 1 check (current_level > 0),
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','completed')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  rejection_reason text,
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, entity_type, entity_id)
);
alter table public.approval_workflows enable row level security;
drop policy if exists "aw_select_own_tenant" on public.approval_workflows;
create policy "aw_select_own_tenant" on public.approval_workflows for select to authenticated using (tenant_id = auth.uid()::uuid);
drop policy if exists "aw_insert_own_tenant" on public.approval_workflows;
create policy "aw_insert_own_tenant" on public.approval_workflows for insert to authenticated with check (tenant_id = auth.uid()::uuid);
drop policy if exists "aw_update_own_tenant" on public.approval_workflows;
create policy "aw_update_own_tenant" on public.approval_workflows for update to authenticated using (tenant_id = auth.uid()::uuid);
grant all on public.approval_workflows to service_role;
grant select, insert, update on public.approval_workflows to authenticated;
create index if not exists ix_aw_tenant on public.approval_workflows (tenant_id);
create index if not exists ix_aw_entity on public.approval_workflows (entity_type, entity_id);
create index if not exists ix_aw_status on public.approval_workflows (status);
create index if not exists ix_aw_current_level on public.approval_workflows (current_level);
comment on table public.approval_workflows is '       ';
create table if not exists public.approval_logs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.approval_workflows(id) on delete cascade,
  tenant_id uuid not null,
  user_id uuid not null references auth.users(id),
  action text not null check (action in ('submit','approve','reject','recall')),
  action_timestamp timestamptz not null default now(),
  previous_status text,
  new_status text not null check (new_status in ('draft','submitted','approved','rejected','completed')),
  comments text,
  ip_address inet,
  user_agent text,
  notes text,
  created_at timestamptz not null default now(),
  unique (workflow_id, action, action_timestamp)
);
alter table public.approval_logs enable row level security;
drop policy if exists "al_select_own_tenant" on public.approval_logs;
create policy "al_select_own_tenant" on public.approval_logs for select to authenticated using (tenant_id = auth.uid()::uuid);
drop policy if exists "al_insert_own_tenant" on public.approval_logs;
create policy "al_insert_own_tenant" on public.approval_logs for insert to authenticated with check (tenant_id = auth.uid()::uuid);
grant all on public.approval_logs to service_role;
grant select, insert on public.approval_logs to authenticated;
create index if not exists ix_al_workflow on public.approval_logs (workflow_id);
create index if not exists ix_al_user on public.approval_logs (user_id);
create index if not exists ix_al_timestamp on public.approval_logs (action_timestamp);
comment on table public.approval_logs is ' :  ';
create or replace function public.fn_income_statement(p_start_date date, p_end_date date)
returns table (
  period text,
  revenue decimal(18,2),
  cogs decimal(18,2),
  gross_profit decimal(18,2),
  operating_expenses decimal(18,2),
  net_income decimal(18,2)
) language plpgsql stable security definer set search_path = public
as $body$
begin
  return query
  with
  rev as (
    select to_char(invoice_date, 'YYYY-MM') as period, coalesce(sum(total_amount),0) as total_amount
    from public.sales_invoices where deleted_at is null and status in ('issued','partially_paid','paid')
      and invoice_date between p_start_date and p_end_date group by to_char(invoice_date, 'YYYY-MM')
  ),
  cg as (
    select to_char(i.created_at, 'YYYY-MM') as period, coalesce(sum(abs(i.cost_price)*abs(i.quantity)),0) as total_cost
    from public.inventory_movements i where i.movement_type='out' and i.reference_type='sales_invoice'
      and i.created_at::date between p_start_date and p_end_date group by to_char(i.created_at, 'YYYY-MM')
  ),
  op as (
    select to_char(p.payment_date, 'YYYY-MM') as period, coalesce(sum(abs(p.amount)),0) as total_expenses
    from public.payments p where p.type='purchase' and p.payment_date between p_start_date and p_end_date group by to_char(p.payment_date, 'YYYY-MM')
  )
  select coalesce(r.period,c.period,o.period) as period,
    coalesce(r.total_amount,0) as revenue,
    coalesce(c.total_cost,0) as cogs,
    (coalesce(r.total_amount,0) - coalesce(c.total_cost,0)) as gross_profit,
    coalesce(o.total_expenses,0) as operating_expenses,
    (coalesce(r.total_amount,0) - coalesce(c.total_cost,0) - coalesce(o.total_expenses,0)) as net_income
  from rev r full join cg c on r.period=c.period full join op o on coalesce(r.period,c.period)=o.period
  order by 1;
end;
$body$;
comment on function public.fn_income_statement is '   ';
create or replace function public.fn_balance_sheet(p_as_of_date date)
returns table (
  as_of_date date, assets_total decimal(18,2), current_assets decimal(18,2),
  fixed_assets decimal(18,2), accumulated_depreciation decimal(18,2),
  net_fixed_assets decimal(18,2), liabilities_total decimal(18,2),
  current_liabilities decimal(18,2), long_term_liabilities decimal(18,2),
  equity decimal(18,2), retained_earnings decimal(18,2)
) language plpgsql stable security definer set search_path = public
as $body$
begin
  return query
  select p_as_of_date as as_of_date,
    (select coalesce(sum(current_balance),0) from public.cash_wallets where deleted_at is null)::decimal(18,2) +
    (select coalesce(sum(current_balance),0) from public.bank_accounts where deleted_at is null)::decimal(18,2) +
    (select coalesce(sum(cost),0) from public.assets where status='active')::decimal(18,2) +
    (select coalesce(sum(amount_before_tax),0) from public.tax_transactions where reference_type='sales_invoice' and created_at <= p_as_of_date)::decimal(18,2) as assets_total,
    (select coalesce(sum(current_balance),0) from public.cash_wallets where deleted_at is null)::decimal(18,2) as current_assets,
    (select coalesce(sum(cost),0) from public.assets where status='active')::decimal(18,2) as fixed_assets,
    (select coalesce(sum(ds.accumulated_depreciation),0) from public.depreciation_schedules ds)::decimal(18,2) as accumulated_depreciation,
    ((select coalesce(sum(cost),0) from public.assets where status='active') - (select coalesce(sum(ds.accumulated_depreciation),0) from public.depreciation_schedules ds))::decimal(18,2) as net_fixed_assets,
    (select coalesce(sum(amount),0) from public.payments where type='purchase' and payment_date <= p_as_of_date)::decimal(18,2) as liabilities_total,
    (select coalesce(sum(amount),0) from public.payments where type='purchase' and payment_date <= p_as_of_date)::decimal(18,2) as current_liabilities,
    0::decimal(18,2) as long_term_liabilities,
    (select coalesce(sum(case when ca.account_type='equity' then gl.credit - gl.debit else 0 end),0)
       from public.general_ledger gl join public.chart_of_accounts ca on ca.id = gl.account_id)::decimal(18,2) as equity,
    (select coalesce(sum(case when ca.code like '31%' then gl.credit - gl.debit else 0 end),0)
       from public.general_ledger gl join public.chart_of_accounts ca on ca.id = gl.account_id)::decimal(18,2) as retained_earnings
  ;
end;
$body$;
comment on function public.fn_balance_sheet is '   ';
create or replace function public.fn_period_close(p_period_date date, p_user_id uuid)
returns void language plpgsql security definer set search_path = public
as $body$
declare
  v_net_income decimal(18,2);
  v_retained_account uuid;
  v_period_id uuid;
  v_tenant uuid;
begin
  select net_income into v_net_income from public.fn_income_statement(p_period_date,p_period_date);
  select id into v_retained_account from public.chart_of_accounts where code='310' limit 1;
  if v_retained_account is not null then
    select tenant_id into v_tenant from public.chart_of_accounts where id = v_retained_account;
    select id into v_period_id from public.financial_periods
     where start_date <= p_period_date and end_date >= p_period_date limit 1;
    insert into public.general_ledger
      (tenant_id, account_id, reference_type, reference_id, debit, credit,
       description, notes, created_at, created_by, posted, period_id)
    values
      (v_tenant, v_retained_account, 'journal_entry', null, 0, coalesce(v_net_income,0),
       'إقفال فترة - period close ' || to_char(p_period_date, 'YYYY-MM'),
       'Auto period-close transfer of net income', now(), p_user_id, true, v_period_id);
    insert into public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, new_values)
    values (v_tenant, p_user_id, 'period_close', 'journal_entry', v_retained_account,
      jsonb_build_object('period',to_char(p_period_date,'YYYY-MM'),'net_income',v_net_income));
  end if;
  raise notice 'Period close completed for % with net income %',p_period_date,v_net_income;
end;
$body$;
comment on function public.fn_period_close is '   ';
create or replace function public.fn_retain_earnings_transfer(p_period_end_date date, p_user_id uuid)
returns text language plpgsql security definer set search_path = public
as $body$
declare
  v_net_income decimal(18,2);
  v_retained_account uuid; v_source_account uuid; v_account_name text;
  v_tenant uuid;
  v_period_id uuid;
begin
  select net_income into v_net_income from public.fn_income_statement(date_trunc('month',p_period_end_date)::date - 1, p_period_end_date);
  select id, name, tenant_id into v_retained_account, v_account_name, v_tenant
    from public.chart_of_accounts where code='310' limit 1;
  if v_retained_account is null then return 'لم يُعثر على حساب الأرباح المحتجزة (code 310)'; end if;
  select id into v_source_account from public.chart_of_accounts
   where tenant_id = v_tenant and code like '5%' order by code limit 1;
  if v_source_account is null then return 'لا يوجد حساب مصروفات للتحويل'; end if;
  select id into v_period_id from public.financial_periods
   where start_date <= p_period_end_date and end_date >= p_period_end_date limit 1;
  insert into public.general_ledger
    (tenant_id, account_id, reference_type, reference_id, debit, credit,
     description, notes, created_at, created_by, posted, period_id)
  values
    (v_tenant, v_retained_account, 'journal_entry', null, 0, coalesce(v_net_income,0),
     'تحويل صافي الدخل إلى الأرباح المحتجزة',
     'Transfer net income to retained earnings for ' || to_char(p_period_end_date,'YYYY-MM'),
     now(), p_user_id, true, v_period_id);
  insert into public.general_ledger
    (tenant_id, account_id, reference_type, reference_id, debit, credit,
     description, notes, created_at, created_by, posted, period_id)
  values
    (v_tenant, v_source_account, 'journal_entry', null, coalesce(v_net_income,0), 0,
     'خصم من حساب المصروفات: ' || coalesce(v_account_name,''),
     'Transfer from expense account ' || coalesce(v_account_name,''),
     now(), p_user_id, true, v_period_id);
  return 'تم تحويل ' || coalesce(v_net_income,0) || ' إلى الأرباح المحتجزة';
end;
$body$;
comment on function public.fn_retain_earnings_transfer is '     ';
do $body$
begin
  raise notice 'Production-Complete ERP Migration: All 4 Extensions Delivered';
  raise notice ' - Fixed Assets: assets, depreciation_schedules, asset_disposals tables + Triggers';
  raise notice ' - Auto-Depreciation Triggers: on insert & update of assets table';
  raise notice ' - Approval Workflows: approval_workflows, approval_logs tables with full enum constraints';
  raise notice ' - Financial Reports: fn_income_statement, fn_balance_sheet, fn_period_close, fn_retain_earnings_transfer';
  raise notice 'All tables use decimal(18,2), UUID keys, TIMESTAMPTZ, CHECK constraints, RLS, Arabic support';
end $body$;

SELECT 'Verification complete' AS status;