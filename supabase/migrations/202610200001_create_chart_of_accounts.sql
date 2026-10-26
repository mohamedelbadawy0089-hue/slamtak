-- ============================================================
-- 202610200001: Chart of Accounts & General Ledger
-- شجرة الحسابات ودفتر الأستاذ العام والقيود والفترات المالية
-- يُنفَّذ مرة واحدة من Supabase SQL Editor
-- المطلوب مسبقاً على القاعدة: جداول warehouses/customers/suppliers
-- (من الهجرات السابقة) وauth.uid()
-- ============================================================

-- ============================================================
-- 1) chart_of_accounts: شجرة الحسابات الهرمية (Nested Set)
-- ============================================================
create table if not exists public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,                           -- رمز الحساب
  name text not null,                           -- اسم الحساب
  name_ar text,                                 -- الاسم بالعربية
  parent_id uuid references public.chart_of_accounts(id) on delete set null,
  account_type text not null check (account_type in (
    'asset', 'liability', 'equity', 'income', 'expense',
    'cost_of_goods_sold', 'contra_account'
  )),
  currency text not null default 'EGP',         -- العملة المحلية (جنيه مصري)
  is_system boolean not null default true,      -- حساب نظامي (لا يُحذف)
  is_active boolean not null default true,
  description text,
  lft integer not null default 0,               -- Nested Set: الحد الأيسر
  rgt integer not null default 0,               -- Nested Set: الحد الأيمن
  depth integer not null default 0,             -- عمق الحساب في الشجرة
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

-- ============================================================
-- مواءمة مع جدول قديم قد يكون موجوداً على القاعدة الحيّة
-- (إضافة الأعمدة الناقصة فقط — لا يمسّ البيانات الموجودة)
-- ============================================================
do $body$
begin
  begin alter table public.chart_of_accounts add column if not exists name text; exception when others then raise notice 'add name: %', SQLERRM; end;
  begin alter table public.chart_of_accounts add column if not exists account_type text default 'asset'; exception when others then raise notice 'add account_type: %', SQLERRM; end;
  begin alter table public.chart_of_accounts add column if not exists is_system boolean not null default true; exception when others then raise notice 'add is_system: %', SQLERRM; end;
  begin alter table public.chart_of_accounts add column if not exists description text; exception when others then raise notice 'add description: %', SQLERRM; end;
  begin alter table public.chart_of_accounts add column if not exists lft integer not null default 0; exception when others then raise notice 'add lft: %', SQLERRM; end;
  begin alter table public.chart_of_accounts add column if not exists rgt integer not null default 0; exception when others then raise notice 'add rgt: %', SQLERRM; end;
  begin alter table public.chart_of_accounts add column if not exists depth integer not null default 0; exception when others then raise notice 'add depth: %', SQLERRM; end;
  -- قيد التحقق على account_type إن لم يوجد
  if not exists (select 1 from pg_constraint where conname = 'chart_of_accounts_account_type_check') then
    alter table public.chart_of_accounts
      add constraint chart_of_accounts_account_type_check check (account_type in (
        'asset', 'liability', 'equity', 'income', 'expense',
        'cost_of_goods_sold', 'contra_account'));
  end if;
  -- تعبئة الحسابات القديمة الناقصة
  update public.chart_of_accounts
     set name = coalesce(name, name_ar, code),
         account_type = coalesce(account_type, 'asset')
   where name is null or account_type is null;
  alter table public.chart_of_accounts alter column name set not null;
  alter table public.chart_of_accounts alter column account_type set not null;
  -- قيد التفرد (tenant_id, code) إن لم يوجد على الجدول القديم
  if not exists (select 1 from pg_constraint where conname = 'chart_of_accounts_tenant_id_code_key') then
    alter table public.chart_of_accounts add constraint chart_of_accounts_tenant_id_code_key unique (tenant_id, code);
  end if;
end $body$;

alter table public.chart_of_accounts enable row level security;

-- سياسات العرض (مع حماية: إن فشلت الإنشاء لا تُسقط الترحيل — نفس نهج part3)
do $body$
begin
  begin
    drop policy if exists coa_select on public.chart_of_accounts;
    create policy coa_select on public.chart_of_accounts
      for select to authenticated using (true);
  exception when others then raise notice 'policy coa_select: %', SQLERRM; end;
end $body$;

grant select on public.chart_of_accounts to authenticated;

create index if not exists ix_coa_tenant on public.chart_of_accounts (tenant_id);
create index if not exists ix_coa_parent on public.chart_of_accounts (parent_id);
create index if not exists ix_coa_lft_rgt on public.chart_of_accounts (lft, rgt);

-- بذرة شجرة الحسابات القياسية للمنشأة الدوائية (مؤسسة تجريبية واحدة)
-- ترقيم Nested Set صحيح: كل حساب يحتوي نطاق أبناءه بالكامل
-- (يتحقق من ذلك اختبار آلي — راجع supabase/tests عند الحاجة)
do $body$
declare
  v_tenant constant uuid := '00000000-0000-0000-0000-000000000001';
  r record;
  v_parent uuid;
begin
  if exists (select 1 from public.chart_of_accounts where tenant_id = v_tenant) then
    raise notice 'شجرة الحسابات موجودة مسبقاً لهذه المؤسسة — تم تخطي البذرة';
    return;
  end if;

  for r in
    select * from (values
      ('1',   null::text, 'الحسابات',                  'الحسابات',                  'equity',            1, 46, 0),
      ('100', '1',        'الأصول',                    'الأصول',                    'asset',             2, 17, 1),
      ('110', '100',      'الأصول المتداولة',          'الأصول المتداولة',          'asset',             3, 10, 2),
      ('111', '110',      'البنوك',                    'البنوك',                    'asset',             4,  5, 3),
      ('112', '110',      'الصندوق',                   'الصندوق',                   'asset',             6,  7, 3),
      ('114', '110',      'الذمم المدينة (العملاء)',   'الذمم المدينة (العملاء)',   'asset',             8,  9, 3),
      ('120', '100',      'المخزون',                   'المخزون',                   'asset',            11, 12, 2),
      ('130', '100',      'الأصول الثابتة',            'الأصول الثابتة',            'asset',            13, 16, 2),
      ('131', '130',      'الأجهزة والمعدات',          'الأجهزة والمعدات',          'asset',            14, 15, 3),
      ('200', '1',        'الخصوم',                    'الخصوم',                    'liability',        18, 25, 1),
      ('210', '200',      'القروض البنكية',            'القروض البنكية',            'liability',        19, 20, 2),
      ('220', '200',      'حسابات الدائنين (الموردون)', 'حسابات الدائنين (الموردون)', 'liability',        21, 22, 2),
      ('230', '200',      'ضريبة المبيعات المستحقة',   'ضريبة المبيعات المستحقة',   'liability',        23, 24, 2),
      ('300', '1',        'حقوق الملكية',              'حقوق الملكية',              'equity',           26, 31, 1),
      ('310', '300',      'رأس المال',                 'رأس المال',                 'equity',           27, 28, 2),
      ('320', '300',      'الأرباح المحتجزة',          'الأرباح المحتجزة',          'equity',           29, 30, 2),
      ('400', '1',        'الإيرادات',                 'الإيرادات',                 'income',           32, 37, 1),
      ('410', '400',      'مبيعات الأدوية',            'مبيعات الأدوية',            'income',           33, 34, 2),
      ('411', '400',      'مبيعات التجزئة',            'مبيعات التجزئة',            'income',           35, 36, 2),
      ('500', '1',        'المصاريف',                  'المصاريف',                  'expense',          38, 45, 1),
      ('510', '500',      'مصروفات البيع والخصومات',   'مصروفات البيع والخصومات',   'expense',          39, 40, 2),
      ('520', '500',      'مصاريف إدارية',             'مصاريف إدارية',             'expense',          41, 42, 2),
      ('530', '500',      'تكلفة البضاعة المباعة',     'تكلفة البضاعة المباعة',     'cost_of_goods_sold', 43, 44, 2)
    ) as t(code, parent, name_en, name_ar, acc_type, lft, rgt, depth)
    order by lft
  loop
    if r.parent is not null then
      select id into v_parent from public.chart_of_accounts
       where tenant_id = v_tenant and code = r.parent;
    else
      v_parent := null;
    end if;

    insert into public.chart_of_accounts
      (tenant_id, code, name, name_ar, account_type, parent_id, lft, rgt, depth)
    values
      (v_tenant, r.code, r.name_en, r.name_ar, r.acc_type, v_parent, r.lft, r.rgt, r.depth)
    on conflict (tenant_id, code) do nothing;
  end loop;

  raise notice 'تم إنشاء شجرة الحسابات (% حساب) للمؤسسة %',
    (select count(*) from public.chart_of_accounts where tenant_id = v_tenant), v_tenant;
end $body$;

-- ============================================================
-- 2) general_ledger: دفتر الأستاذ العام (القيد المزدوج)
-- ============================================================
create table if not exists public.general_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
  reference_type text not null check (reference_type in (
    'purchase_invoice', 'purchase_order', 'sales_invoice', 'payment', 'receipt',
    'journal_entry', 'inventory_issue', 'inventory_receipt',
    'fixed_asset_acquisition', 'depreciation_entry',
    'asset_disposal'
  )),
  reference_id uuid,                            -- معرف الفاتورة/القيد المرجعي
  debit decimal(18,2) not null default 0 check (debit >= 0),
  credit decimal(18,2) not null default 0 check (credit >= 0),
  description text not null,
  notes text,
  warehouse_id uuid,                            -- FK يُضاف أدناه عند توفر الجدول
  customer_id uuid,
  supplier_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  posted boolean not null default true,
  period_id uuid,                               -- الفترة المالية (يتحقق منها المُشغّل)
  unique (tenant_id, reference_type, reference_id, account_id)
);

-- قيود المفاتيح الأجنبية لجداول خارج هذا الترحيل: تُضاف فقط إن وُجدت
-- (تعمل على القاعدة الحيّة، ولا تُسقط الترحيل على قاعدة جديدة)
do $body$
begin
  begin
    alter table public.general_ledger
      add constraint fk_gl_warehouse foreign key (warehouse_id)
      references public.warehouses(id) on delete set null;
  exception when duplicate_object then null; when others then raise notice 'fk_gl_warehouse: %', SQLERRM; end;
  begin
    alter table public.general_ledger
      add constraint fk_gl_customer foreign key (customer_id)
      references public.customers(id) on delete set null;
  exception when duplicate_object then null; when others then raise notice 'fk_gl_customer: %', SQLERRM; end;
  begin
    alter table public.general_ledger
      add constraint fk_gl_supplier foreign key (supplier_id)
      references public.suppliers(id) on delete set null;
  exception when duplicate_object then null; when others then raise notice 'fk_gl_supplier: %', SQLERRM; end;
end $body$;

alter table public.general_ledger enable row level security;

-- عزل المستخدمين حسب المخازن (يتجاوز service_role الـ RLS تلقائياً)
do $body$
begin
  begin
    drop policy if exists gl_select_own_wh on public.general_ledger;
    create policy gl_select_own_wh on public.general_ledger
      for select to authenticated
      using (warehouse_id in (select warehouse_id from public.user_warehouses
                               where user_id = auth.uid())
             or warehouse_id is null);
  exception when others then raise notice 'policy gl_select_own_wh: %', SQLERRM; end;
end $body$;

grant select on public.general_ledger to authenticated;

create index if not exists ix_gl_tenant on public.general_ledger (tenant_id);
create index if not exists ix_gl_account on public.general_ledger (account_id);
create index if not exists ix_gl_reference on public.general_ledger (reference_type, reference_id);
create index if not exists ix_gl_created on public.general_ledger (created_at desc);
create index if not exists ix_gl_debit_credit on public.general_ledger (debit, credit);

-- ============================================================
-- 3) journal_entries + journal_entry_lines: القيود اليومية
-- ============================================================
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  entry_number text not null,                   -- رقم القيد الترتيبي
  entry_date date not null,                     -- تاريخ القيد
  description text not null,
  period_id uuid not null,                      -- الفترة المالية
  status text not null default 'draft' check (status in ('draft','posted','locked')),
  posted_at timestamptz,
  created_by uuid references auth.users(id),
  locked_at timestamptz,
  locked_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, entry_number)
);

-- مواءمة مع جدول journal_entries قديم إن وُجد
-- (نفس منهج chart_of_accounts أعلاه)
do $body$
begin
  begin alter table public.journal_entries add column if not exists entry_number text; exception when others then raise notice 'add entry_number: %', SQLERRM; end;
  begin alter table public.journal_entries add column if not exists entry_date date; exception when others then raise notice 'add entry_date: %', SQLERRM; end;
  begin alter table public.journal_entries add column if not exists status text default 'draft'; exception when others then raise notice 'add status: %', SQLERRM; end;
  begin alter table public.journal_entries add column if not exists created_by uuid references auth.users(id); exception when others then raise notice 'add created_by: %', SQLERRM; end;
  begin alter table public.journal_entries add column if not exists locked_at timestamptz; exception when others then raise notice 'add locked_at: %', SQLERRM; end;
  begin alter table public.journal_entries add column if not exists locked_by uuid references auth.users(id); exception when others then raise notice 'add locked_by: %', SQLERRM; end;
  if not exists (select 1 from pg_constraint where conname = 'journal_entries_status_check') then
    alter table public.journal_entries
      add constraint journal_entries_status_check check (status in ('draft','posted','locked'));
  end if;
  update public.journal_entries set entry_date = coalesce(entry_date, created_at::date),
                                    status = coalesce(status, 'draft')
   where entry_date is null or status is null;
  if not exists (select 1 from pg_constraint where conname = 'journal_entries_tenant_id_entry_number_key') then
    alter table public.journal_entries add constraint journal_entries_tenant_id_entry_number_key unique (tenant_id, entry_number);
  end if;
end $body$;

create table if not exists public.journal_entry_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
  debit decimal(18,2) not null default 0 check (debit >= 0),
  credit decimal(18,2) not null default 0 check (credit >= 0),
  description text,
  line_order integer not null default 0,        -- ترتيب السطور داخل القيد
  created_at timestamptz not null default now(),
  unique (entry_id, account_id, line_order)
);

alter table public.journal_entries enable row level security;
alter table public.journal_entry_lines enable row level security;

-- هذه الجداول لا تملك عمود warehouse_id — عرض للمستخدمين المصادقين
-- (الكتابة عبر الخادم service_role فقط)
do $body$
begin
  begin
    drop policy if exists je_select on public.journal_entries;
    create policy je_select on public.journal_entries
      for select to authenticated using (true);
  exception when others then raise notice 'policy je_select: %', SQLERRM; end;
  begin
    drop policy if exists jel_select on public.journal_entry_lines;
    create policy jel_select on public.journal_entry_lines
      for select to authenticated using (true);
  exception when others then raise notice 'policy jel_select: %', SQLERRM; end;
end $body$;

grant select on public.journal_entries, public.journal_entry_lines to authenticated;

create index if not exists ix_je_tenant on public.journal_entries (tenant_id);
create index if not exists ix_je_period on public.journal_entries (period_id, status);
create index if not exists ix_jel_entry on public.journal_entry_lines (entry_id);
create index if not exists ix_jel_order on public.journal_entry_lines (entry_id, line_order);

-- ============================================================
-- 4) financial_periods: الفترات المالية والإقفال
-- ============================================================
create table if not exists public.financial_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  period_name text not null,                    -- اسم الفترة (شهر/ربع/سنة)
  period_code text not null,                    -- رمز الفترة (YYYYMM أو YYYY)
  start_date date not null,
  end_date date not null,
  is_open boolean not null default true,
  is_closed boolean not null default false,
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  income_total decimal(18,2) not null default 0,
  expense_total decimal(18,2) not null default 0,
  net_result decimal(18,2) not null default 0,  -- صافي الربح/الخسارة
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, period_code)
);

alter table public.financial_periods enable row level security;

do $body$
begin
  begin
    drop policy if exists fp_select on public.financial_periods;
    create policy fp_select on public.financial_periods
      for select to authenticated using (true);
  exception when others then raise notice 'policy fp_select: %', SQLERRM; end;
end $body$;

grant select on public.financial_periods to authenticated;

create index if not exists ix_fp_tenant on public.financial_periods (tenant_id);
create index if not exists ix_fp_period on public.financial_periods (period_code);

-- ============================================================
-- 5) مُشغّل: منع أي قيد على فترة مُقفلة
--    (التحقق الكامل من توازن الفترة عند الإقفال يتم في دوال التقارير)
-- ============================================================
create or replace function public.f_block_closed_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $body$
begin
  if new.period_id is not null
     and exists (select 1 from public.financial_periods
                  where id = new.period_id and is_closed = true) then
    raise exception 'لا يمكن إجراء معاملات على فترة مُقفلة (%)',
      (select period_name from public.financial_periods where id = new.period_id);
  end if;
  return new;
end;
$body$;

revoke all on function public.f_block_closed_period() from public;

drop trigger if exists trg_block_closed_period_gl on public.general_ledger;
create trigger trg_block_closed_period_gl
  before insert or update on public.general_ledger
  for each row execute function public.f_block_closed_period();

drop trigger if exists trg_block_closed_period_je on public.journal_entries;
create trigger trg_block_closed_period_je
  before insert or update on public.journal_entries
  for each row execute function public.f_block_closed_period();

-- ============================================================
-- 6) تحقق نهائي
-- ============================================================
do $body$
declare
  v_count bigint;
begin
  select count(*) into v_count from public.chart_of_accounts;
  raise notice 'Phase 1: chart_of_accounts = % حساب', v_count;
  select count(*) into v_count from public.general_ledger;
  raise notice 'Phase 1: general_ledger = % قيد', v_count;
end $body$;

SELECT 'Phase 1 verification:' AS message;
SELECT count(*) AS coa_count FROM public.chart_of_accounts;
SELECT count(*) AS gl_count FROM public.general_ledger;
SELECT count(*) AS periods FROM public.financial_periods;
