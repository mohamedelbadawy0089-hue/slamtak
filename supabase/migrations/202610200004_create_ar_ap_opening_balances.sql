-- ============================================================
-- 202610200004: AR/AP Management, Opening Balances & Aging
-- إدارة العملاء والموردين والأرصدة الافتتاحية وتقارير الأعمار
-- يُنفَّذ مرة واحدة بعد migrations 202610200001..0003
-- ملاحظة: جدولا customers/suppliers موجودان مسبقاً على قاعدة
-- Supabase الحية — create if not exists لا يؤثر عليهما،
-- وإضافة current_balance تتم بـ alter add column if not exists
-- ============================================================

-- ============================================================
-- 1) customers: إدارة العملاء (مع مواءمة المخطط الحي)
-- ============================================================
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  name text not null,                          -- اسم العميل
  name_ar text,                                -- الاسم بالعربية
  code text,                                   -- رمز العميل
  type text,
  customer_type text,
  contact_person text,                         -- جهة الاتصال (اسم حيّ صحيح)
  email text,
  phone text,
  address text,
  city text,
  country text,
  tax_id text,
  credit_limit numeric(14,2) not null default 0 check (credit_limit >= 0),
  payment_terms text not null default 'cash',
  is_active boolean not null default true,
  notes text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, code)
);

-- الرصيد الجاري (إضافي على القاعدة الحية إن لم يكن موجوداً)
alter table public.customers add column if not exists current_balance numeric(14,2) not null default 0;
alter table public.customers add column if not exists current_balance numeric(14,2);
update public.customers set current_balance = 0 where current_balance is null;
alter table public.customers alter column current_balance set not null;
alter table public.customers alter column current_balance set default 0;

alter table public.customers enable row level security;

do $body$
begin
  begin
    drop policy if exists cust_select_own_wh on public.customers;
    create policy cust_select_own_wh on public.customers
      for select to authenticated
      using (warehouse_id in (select warehouse_id from public.user_warehouses
                               where user_id = auth.uid())
             or warehouse_id is null);
  exception when others then raise notice 'policy cust_select_own_wh: %', SQLERRM; end;
end $body$;

grant select on public.customers to authenticated;

create index if not exists ix_cust_tenant on public.customers (tenant_id);
create index if not exists ix_cust_active on public.customers (is_active);
create index if not exists ix_cust_code on public.customers (tenant_id, code);

-- بذرة عملاء أمثلة — فقط على قاعدة جديدة تمامًا (لا تلوث بيانات حقيقية)
do $body$
begin
  if exists (select 1 from public.customers) then
    raise notice 'العملاء موجودون مسبقاً — تم تخطي بذرة العملاء الأمثلة';
    return;
  end if;

  insert into public.customers (tenant_id, name, name_ar, code, contact_person, phone, email, address,
                                credit_limit, payment_terms, is_active, notes)
  values
    ('00000000-0000-0000-0000-000000000001', 'Medical Center', 'المركز الطبي', 'CUST-001',
     'محمد أحمد', '+201001234567', 'contact@medicalcenter.eg', 'القاهرة، مصر',
     50000, '30 days', true, 'عميل رئيسي - مستشفى'),
    ('00000000-0000-0000-0000-000000000001', 'Al-Farabi Pharmacy', 'صيدلية الفضلي', 'CUST-002',
     'عدنان وحيد', '+201007654321', 'sales@alfarabi.sa', 'جدة، السعودية',
     100000, '60 days', true, 'سلة صيدليات كبرى'),
    ('00000000-0000-0000-0000-000000000001', 'King Health Hospital', 'مجموعة المستشفى الملكي', 'CUST-003',
     'دكتور جمال', '+201001999888', 'admin@kinghealth.sa', 'الدمام، السعودية',
     200000, '90 days', true, 'مجموعة مستشفيات');

  raise notice 'تم إدراج 3 عملاء أمثلة';
end $body$;

-- ============================================================
-- 2) suppliers: إدارة الموردين (مع مواءمة المخطط الحي)
-- ============================================================
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  name text not null,
  name_ar text,
  code text,
  contact_person text,
  email text,
  phone text,
  address text,
  city text,
  country text,
  tax_id text,
  website text,
  credit_limit numeric(14,2) not null default 0 check (credit_limit >= 0),
  payment_terms text not null default 'net 30',
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, code)
);

alter table public.suppliers add column if not exists current_balance numeric(14,2) not null default 0;
alter table public.suppliers add column if not exists current_balance numeric(14,2);
update public.suppliers set current_balance = 0 where current_balance is null;
alter table public.suppliers alter column current_balance set not null;
alter table public.suppliers alter column current_balance set default 0;

alter table public.suppliers enable row level security;

do $body$
begin
  begin
    drop policy if exists supp_select_own_wh on public.suppliers;
    create policy supp_select_own_wh on public.suppliers
      for select to authenticated
      using (warehouse_id in (select warehouse_id from public.user_warehouses
                               where user_id = auth.uid())
             or warehouse_id is null);
  exception when others then raise notice 'policy supp_select_own_wh: %', SQLERRM; end;
end $body$;

grant select on public.suppliers to authenticated;

create index if not exists ix_supp_tenant on public.suppliers (tenant_id);
create index if not exists ix_supp_active on public.suppliers (is_active);
create index if not exists ix_supp_code on public.suppliers (tenant_id, code);

do $body$
begin
  if exists (select 1 from public.suppliers) then
    raise notice 'الموردون موجودون مسبقاً — تم تخطي بذرة الموردين الأمثلة';
    return;
  end if;

  insert into public.suppliers (tenant_id, name, name_ar, code, contact_person, phone, email, address,
                                tax_id, credit_limit, payment_terms, is_active, notes)
  values
    ('00000000-0000-0000-0000-000000000001', 'Pharma Distro', 'دار الدوائية', 'SUP-001',
     'محمد علي', '+201001234567', 'contact@pharmadistro.eg', 'القاهرة، مصر',
     '1234567890', 25000, 'net 30', true, 'مورد أساسي للأدوية'),
    ('00000000-0000-0000-0000-000000000001', 'Medical Supplies Co', 'موردات طبية', 'SUP-002',
     'عدنان وحيد', '+201007654321', 'sales@medicalsa.com', 'جدة، السعودية',
     '9876543210', 15000, 'net 60', true, 'مستلزمات طبية متنوعة'),
    ('00000000-0000-0000-0000-000000000001', 'MediTech Egypt', 'مدي تيك مصر', 'SUP-003',
     'عبدالله السلمي', '+201001112233', 'info@medtec-egypt.eg', 'القاهرة، مصر',
     '5555555555', 30000, 'net 90', true, 'مستورد أجهزة طبية');

  raise notice 'تم إدراج 3 موردين أمثلة';
end $body$;

-- ============================================================
-- 3) opening_balances: الأرصدة الافتتاحية للحسابات
-- ============================================================
create table if not exists public.opening_balances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
  reference_type text not null check (reference_type in ('customer','supplier','journal_entry','manual')),
  reference_id uuid,                            -- معرف العميل أو المورد أو القيد
  amount decimal(18,2) not null,
  currency text not null default 'EGP',
  description text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, account_id, reference_type, reference_id)
);

alter table public.opening_balances enable row level security;

-- لا يملك هذا الجدول عمود warehouse_id — عرض للمصادقين، والكتابة من الخادم
do $body$
begin
  begin
    drop policy if exists ob_select on public.opening_balances;
    create policy ob_select on public.opening_balances
      for select to authenticated using (true);
  exception when others then raise notice 'policy ob_select: %', SQLERRM; end;
end $body$;

grant select on public.opening_balances to authenticated;

create index if not exists ix_ob_tenant on public.opening_balances (tenant_id);
create index if not exists ix_ob_account on public.opening_balances (account_id);
create index if not exists ix_ob_ref on public.opening_balances (reference_type, reference_id);

-- بذرة الأرصدة الافتتاحية — فقط إذا وُجدت العملاء الأمثلة ولم تُسجَّل أرصدة بعد
-- (تضيف المبلغ فعلياً إلى current_balance مقابل العميل/المورد)
do $body$
declare
  v_tenant constant uuid := '00000000-0000-0000-0000-000000000001';
  v_ar uuid;
  v_ap uuid;
  r record;
  v_ref uuid;
begin
  if exists (select 1 from public.opening_balances) then
    raise notice 'الأرصدة الافتتاحية موجودة مسبقاً — تم التخطي';
    return;
  end if;
  if not exists (select 1 from public.customers where code = 'CUST-001') then
    raise notice 'العملاء الأمثلة غير موجودين — تم تخطي بذرة الأرصدة الافتتاحية';
    return;
  end if;

  -- حساب الذمم المدينة (114) وحساب الدائنون (220)
  select id into v_ar from public.chart_of_accounts
   where tenant_id = v_tenant and code = '114' and account_type = 'asset' limit 1;
  if not found then
    select id into v_ar from public.chart_of_accounts
     where tenant_id = v_tenant and account_type = 'asset' order by lft limit 1;
  end if;
  select id into v_ap from public.chart_of_accounts
   where tenant_id = v_tenant and code = '220' and account_type = 'liability' limit 1;
  if not found then
    select id into v_ap from public.chart_of_accounts
     where tenant_id = v_tenant and account_type = 'liability' order by lft limit 1;
  end if;

  if v_ar is null or v_ap is null then
    raise notice 'حسابات 114/220 غير متاحة — تم تخطي بذرة الأرصدة الافتتاحية';
    return;
  end if;

  -- أرصدة العملاء (مدين على الذمم المدينة)
  for r in
    select * from (values
      ('CUST-001', 50000::numeric, 'رصيد افتتاحي - Medical Center'),
      ('CUST-002', 100000::numeric, 'رصيد افتتاحي - Al-Farabi Pharmacy')
    ) as t(cust_code, amount, descr)
  loop
    select id into v_ref from public.customers
     where tenant_id = v_tenant and code = r.cust_code;
    if v_ref is not null then
      insert into public.opening_balances
        (tenant_id, account_id, reference_type, reference_id, amount, currency, description)
      values (v_tenant, v_ar, 'customer', v_ref, r.amount, 'EGP', r.descr);
      update public.customers
         set current_balance = current_balance + r.amount, updated_at = now()
       where id = v_ref;
    end if;
  end loop;

  -- أرصدة الموردين (دائن على الدائنون: ندينهم)
  for r in
    select * from (values
      ('SUP-001', 25000::numeric, 'رصيد افتتاحي - Pharma Distro (ندينهم)'),
      ('SUP-002', 15000::numeric, 'رصيد افتتاحي - Medical Supplies Co (ندينهم)')
    ) as t(supp_code, amount, descr)
  loop
    select id into v_ref from public.suppliers
     where tenant_id = v_tenant and code = r.supp_code;
    if v_ref is not null then
      insert into public.opening_balances
        (tenant_id, account_id, reference_type, reference_id, amount, currency, description)
      values (v_tenant, v_ap, 'supplier', v_ref, r.amount, 'EGP', r.descr);
      update public.suppliers
         set current_balance = current_balance + r.amount, updated_at = now()
       where id = v_ref;
    end if;
  end loop;

  raise notice 'تم إدراج الأرصدة الافتتاحية: % سجل',
    (select count(*) from public.opening_balances where tenant_id = v_tenant);
end $body$;

-- ============================================================
-- 4) views: تقارير أعمار الديون (AR/AP Aging)
--    AR من sales_invoices (invoice_date الحيّ) بحالات الاعتماد فقط
--    AP من purchase_invoices + payments (لا purchase_orders)
-- ============================================================
create or replace view public.v_ar_aging_report as
select
  c.id as customer_id,
  c.name as customer_name,
  c.name_ar as customer_name_ar,
  c.credit_limit,
  c.current_balance,
  jsonb_agg(
    jsonb_build_object(
      'invoice_id', si.id,
      'invoice_number', si.invoice_number,
      'invoice_date', si.invoice_date,
      'due_date', si.due_date,
      'total_amount', si.total_amount,
      'paid_amount', coalesce(si.paid_amount, 0),
      'outstanding', si.total_amount - coalesce(si.paid_amount, 0),
      'days_outstanding', greatest(current_date - si.invoice_date, 0)
    )
  ) filter (where si.id is not null) as outstanding_invoices,
  coalesce(sum(case when greatest(current_date - si.invoice_date, 0) between 0 and 30
        then si.total_amount - coalesce(si.paid_amount, 0) else 0 end), 0) as current_0_30,
  coalesce(sum(case when greatest(current_date - si.invoice_date, 0) between 31 and 60
        then si.total_amount - coalesce(si.paid_amount, 0) else 0 end), 0) as "31_60",
  coalesce(sum(case when greatest(current_date - si.invoice_date, 0) between 61 and 90
        then si.total_amount - coalesce(si.paid_amount, 0) else 0 end), 0) as "61_90",
  coalesce(sum(case when greatest(current_date - si.invoice_date, 0) > 90
        then si.total_amount - coalesce(si.paid_amount, 0) else 0 end), 0) as "over_90",
  coalesce(sum(si.total_amount - coalesce(si.paid_amount, 0)), 0) as total_outstanding
from public.customers c
left join public.sales_invoices si
  on si.customer_id = c.id
 and si.deleted_at is null
 and si.status in ('issued', 'partially_paid', 'paid')
group by c.id, c.name, c.name_ar, c.credit_limit, c.current_balance;

grant select on public.v_ar_aging_report to authenticated;

create or replace view public.v_ap_aging_report as
select
  s.id as supplier_id,
  s.name as supplier_name,
  s.name_ar as supplier_name_ar,
  s.credit_limit,
  s.current_balance,
  jsonb_agg(
    jsonb_build_object(
      'invoice_id', pi.id,
      'invoice_number', pi.invoice_number,
      'invoice_date', pi.invoice_date,
      'total_amount', pi.total_amount,
      'paid_amount', pi.paid_amount,
      'outstanding', pi.total_amount - pi.paid_amount,
      'days_outstanding', greatest(current_date - pi.invoice_date, 0)
    )
  ) filter (where pi.id is not null) as outstanding_invoices,
  coalesce(sum(case when greatest(current_date - pi.invoice_date, 0) between 0 and 30
        then pi.total_amount - pi.paid_amount else 0 end), 0) as current_0_30,
  coalesce(sum(case when greatest(current_date - pi.invoice_date, 0) between 31 and 60
        then pi.total_amount - pi.paid_amount else 0 end), 0) as "31_60",
  coalesce(sum(case when greatest(current_date - pi.invoice_date, 0) between 61 and 90
        then pi.total_amount - pi.paid_amount else 0 end), 0) as "61_90",
  coalesce(sum(case when greatest(current_date - pi.invoice_date, 0) > 90
        then pi.total_amount - pi.paid_amount else 0 end), 0) as "over_90",
  coalesce(sum(pi.total_amount - pi.paid_amount), 0) as total_outstanding
from public.suppliers s
left join (
  select pi.id, pi.supplier_id, pi.invoice_number, pi.invoice_date, pi.total_amount,
         coalesce((select sum(p.amount) from public.payments p
                    where p.reference_type = 'purchase_invoice'
                      and p.reference_id = pi.id
                      and p.deleted_at is null), 0) as paid_amount
    from public.purchase_invoices pi
   where pi.deleted_at is null
) pi on pi.supplier_id = s.id
group by s.id, s.name, s.name_ar, s.credit_limit, s.current_balance;

grant select on public.v_ap_aging_report to authenticated;

-- ============================================================
-- 5) مُشغّلات: تحديث الرصيد الجاري من قيود الدفتر
--    - العميل: رصيد += (مدين - دائن) على حساب الذمم المدينة 114
--    - المورد: رصيد += (دائن - مدين) على حساب الدائنون 220
--    - على INSERT وDELETE معاً (إعادة نشر القيود = حذف + إدراج
--      فيزول الأثر القديم ولا يتضاعف)
-- ============================================================
create or replace function public.f_update_customer_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_tenant uuid;
  v_customer uuid;
  v_account uuid;
  v_debit numeric;
  v_credit numeric;
  v_sign numeric;
  v_ar uuid;
begin
  if TG_OP = 'DELETE' then
    v_tenant := old.tenant_id; v_customer := old.customer_id;
    v_account := old.account_id; v_debit := old.debit; v_credit := old.credit;
    v_sign := -1;
  else
    v_tenant := new.tenant_id; v_customer := new.customer_id;
    v_account := new.account_id; v_debit := new.debit; v_credit := new.credit;
    v_sign := 1;
  end if;

  if v_customer is not null then
    select id into v_ar from public.chart_of_accounts
     where tenant_id = v_tenant and code = '114' and account_type = 'asset' limit 1;

    if v_ar is not null and v_account = v_ar then
      update public.customers
         set current_balance = current_balance + v_sign * (v_debit - v_credit),
             updated_at = now()
       where id = v_customer;
    end if;
  end if;

  if TG_OP = 'DELETE' then return old; else return new; end if;
end;
$body$;

revoke all on function public.f_update_customer_balance() from public;

create or replace function public.f_update_supplier_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_tenant uuid;
  v_supplier uuid;
  v_account uuid;
  v_debit numeric;
  v_credit numeric;
  v_sign numeric;
  v_ap uuid;
begin
  if TG_OP = 'DELETE' then
    v_tenant := old.tenant_id; v_supplier := old.supplier_id;
    v_account := old.account_id; v_debit := old.debit; v_credit := old.credit;
    v_sign := -1;
  else
    v_tenant := new.tenant_id; v_supplier := new.supplier_id;
    v_account := new.account_id; v_debit := new.debit; v_credit := new.credit;
    v_sign := 1;
  end if;

  if v_supplier is not null then
    select id into v_ap from public.chart_of_accounts
     where tenant_id = v_tenant and code = '220' and account_type = 'liability' limit 1;

    if v_ap is not null and v_account = v_ap then
      update public.suppliers
         set current_balance = current_balance + v_sign * (v_credit - v_debit),
             updated_at = now()
       where id = v_supplier;
    end if;
  end if;

  if TG_OP = 'DELETE' then return old; else return new; end if;
end;
$body$;

revoke all on function public.f_update_supplier_balance() from public;

drop trigger if exists trg_update_customer_balance on public.general_ledger;
create trigger trg_update_customer_balance
  after insert or delete on public.general_ledger
  for each row execute function public.f_update_customer_balance();

drop trigger if exists trg_update_supplier_balance on public.general_ledger;
create trigger trg_update_supplier_balance
  after insert or delete on public.general_ledger
  for each row execute function public.f_update_supplier_balance();

-- ============================================================
-- 6) تحقق نهائي
-- ============================================================
do $body$
declare
  v_count bigint;
begin
  select count(*) into v_count from public.customers;
  raise notice 'Phase 4: customers = %', v_count;
  select count(*) into v_count from public.suppliers;
  raise notice 'Phase 4: suppliers = %', v_count;
  select count(*) into v_count from public.opening_balances;
  raise notice 'Phase 4: opening_balances = %', v_count;
end $body$;

SELECT 'Phase 4 verification:' AS message;
SELECT count(*) AS customer_count FROM public.customers;
SELECT count(*) AS supplier_count FROM public.suppliers;
SELECT count(*) AS opening_balance_records FROM public.opening_balances;
SELECT count(*) AS ar_aging_records FROM public.v_ar_aging_report;
SELECT count(*) AS ap_aging_records FROM public.v_ap_aging_report;
