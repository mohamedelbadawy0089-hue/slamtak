-- ============================================================
-- 202610200005: Cash & Bank Management Module
-- إدارة الصندوق والخزائن والبنوك والتسويات
-- يُنفَّذ مرة واحدة بعد migration 202610200004
-- (الجداول الأربعة جديدة على القاعدة — تُنشأ هنا لأول مرة)
-- ملاحظات تصميم عن الإصدار السابق:
--  * قيد موجّه لتعديل رصيد الخزانة بلا حساب مقابِل كان غير متوازن
--    → استُبدل بتسجيل تدقيق (audit_logs) عند تغيّر الرصيد
--  * قيود البنك كانت تضع معرّف حساب بنكي في حسابات الدفتر (FK خاطئ)
--    وأنواع مرجعية غير مسموحة، وفرع transfer يقيّد نفس الحساب مرتين
--    → أصبح كل مطابقة زوجاً متوازناً بين حسابات الشجرة الصحيحة
--  * مُشغّل cash→bank كان يقرأ عمود status غير موجود على الخزائن
--    → حُذف (إنشاء معاملة بنكية يكون عند عمليات السحب/الإيداع الفعلية)
-- ============================================================

-- ============================================================
-- 1) cash_wallets: الخزائن النقدية داخل كل مخزن
--    (deleted_at مطلوب لاستعلامات الترحيل 202610200007)
-- ============================================================
create table if not exists public.cash_wallets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  name text not null,
  name_ar text,
  opening_balance decimal(18,2) not null default 0,
  current_balance decimal(18,2) not null default 0,
  currency text not null default 'EGP',
  is_active boolean not null default true,
  notes text,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, warehouse_id, name)
);

alter table public.cash_wallets enable row level security;

do $body$
begin
  begin
    drop policy if exists cw_select_own_wh on public.cash_wallets;
    create policy cw_select_own_wh on public.cash_wallets
      for select to authenticated
      using (warehouse_id in (select warehouse_id from public.user_warehouses
                               where user_id = auth.uid())
             or warehouse_id is null);
  exception when others then raise notice 'policy cw_select_own_wh: %', SQLERRM; end;
end $body$;

grant select on public.cash_wallets to authenticated;

create index if not exists ix_cw_tenant on public.cash_wallets (tenant_id);
create index if not exists ix_cw_warehouse on public.cash_wallets (warehouse_id);

-- بذرة خزائن أمثلة (فقط إن كانت الجداول فارغة — لا تلوث بيانات حقيقية)
do $body$
declare
  v_tenant constant uuid := '00000000-0000-0000-0000-000000000001';
  r record;
  v_idx int := 0;
begin
  if exists (select 1 from public.cash_wallets) then
    raise notice 'خزائن النقد موجودة مسبقاً — تم التخطي';
    return;
  end if;

  for r in select id from public.warehouses order by is_main desc limit 2 loop
    v_idx := v_idx + 1;
    if v_idx = 1 then
      insert into public.cash_wallets
        (tenant_id, warehouse_id, name, name_ar, opening_balance, current_balance, notes)
      values (v_tenant, r.id, 'Main Cash Desk', 'خزانة الصندوق الرئيسية',
              5000, 5000, 'الصندوق اليومي للعمليات');
    else
      insert into public.cash_wallets
        (tenant_id, warehouse_id, name, name_ar, opening_balance, current_balance, notes)
      values (v_tenant, r.id, 'Secondary Cash Desk', 'خزانة ثانوية',
              2000, 2000, 'خزانة للمخزن الثانوي');
    end if;
  end loop;

  raise notice 'تم إدراج % خزائن نقد أمثلة', v_idx;
end $body$;

-- ============================================================
-- 2) bank_accounts: حسابات البنوك
-- ============================================================
create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  name_ar text,
  bank_name text not null,
  account_number text not null,
  account_type text not null check (account_type in ('checking','savings','credit_card','loan')),
  currency text not null default 'EGP',
  current_balance decimal(18,2) not null default 0,
  opening_balance decimal(18,2) not null default 0,
  is_active boolean not null default true,
  is_reconciled boolean not null default false,
  last_reconciliation_date timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, account_number)
);

alter table public.bank_accounts enable row level security;

-- لا يملك هذا الجدول عمود warehouse_id — عرض للمصادقين (الكتابة من الخادم)
do $body$
begin
  begin
    drop policy if exists ba_select_own_wh on public.bank_accounts;
    create policy ba_select_own_wh on public.bank_accounts
      for select to authenticated using (true);
  exception when others then raise notice 'policy ba_select_own_wh: %', SQLERRM; end;
end $body$;

grant select on public.bank_accounts to authenticated;

create index if not exists ix_ba_tenant on public.bank_accounts (tenant_id);
create index if not exists ix_ba_bank on public.bank_accounts (bank_name);
create index if not exists ix_ba_reconciled on public.bank_accounts (is_reconciled);

do $body$
begin
  if exists (select 1 from public.bank_accounts) then
    raise notice 'حسابات بنكية موجودة مسبقاً — تم التخطي';
    return;
  end if;

  insert into public.bank_accounts
    (tenant_id, name, name_ar, bank_name, account_number, account_type,
     opening_balance, current_balance, notes)
  values
    ('00000000-0000-0000-0000-000000000001', 'National Bank - Current', 'البنك الوطني - الجاري',
     'National Bank', '1234567890', 'checking', 100000, 100000, 'حساب التشغيل الرئيسي'),
    ('00000000-0000-0000-0000-000000000001', 'Al Rajhi Bank - Savings', 'البنك الأهلي - الادخاري',
     'Al Rajhi Bank', '9876543210', 'savings', 50000, 50000, 'ادخار للمشاريع المستقبلية');

  raise notice 'تم إدراج حسابين بنكيين مثالين';
end $body$;

-- ============================================================
-- 3) bank_transactions: بيان البنك (العمليات المصرفية)
-- ============================================================
create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  transaction_date date not null,
  description text not null,
  transaction_type text not null
    check (transaction_type in ('deposit','withdrawal','transfer','fee','interest','adjustment')),
  amount decimal(18,2) not null check (amount <> 0),
  reference_type text check (reference_type in (
    'cash_withdrawal','cash_deposit','sales_payment','purchase_payment',
    'journal_entry','manual','refund','payment')),
  reference_id uuid,
  status text not null default 'pending'
    check (status in ('pending','matched','adjusted','rejected')),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (tenant_id, bank_account_id, transaction_date, amount, transaction_type)
);

alter table public.bank_transactions enable row level security;

do $body$
begin
  begin
    drop policy if exists bt_select_own_wh on public.bank_transactions;
    create policy bt_select_own_wh on public.bank_transactions
      for select to authenticated using (true);
  exception when others then raise notice 'policy bt_select_own_wh: %', SQLERRM; end;
end $body$;

grant select on public.bank_transactions to authenticated;

create index if not exists ix_bt_tenant on public.bank_transactions (tenant_id);
create index if not exists ix_bt_account on public.bank_transactions (bank_account_id);
create index if not exists ix_bt_date on public.bank_transactions (transaction_date);
create index if not exists ix_bt_status on public.bank_transactions (status);

-- ============================================================
-- 4) bank_reconciliations: التسوية البنكية
-- ============================================================
create table if not exists public.bank_reconciliations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  reconciliation_date date not null default current_date,
  statement_balance decimal(18,2) not null,     -- الرصيد حسب كشف البنك
  system_balance decimal(18,2) not null,        -- الرصيد حسب سجلاتنا
  difference decimal(18,2) not null default 0,   -- statement - system
  status text not null check (status in ('open','matched','adjusted','resolved','closed')),
  resolution_notes text,
  reconciled_by uuid references auth.users(id),
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, bank_account_id, reconciliation_date)
);

alter table public.bank_reconciliations enable row level security;

do $body$
begin
  begin
    drop policy if exists br_select_own_wh on public.bank_reconciliations;
    create policy br_select_own_wh on public.bank_reconciliations
      for select to authenticated using (true);
  exception when others then raise notice 'policy br_select_own_wh: %', SQLERRM; end;
end $body$;

grant select on public.bank_reconciliations to authenticated;

create index if not exists ix_br_tenant on public.bank_reconciliations (tenant_id);
create index if not exists ix_br_account on public.bank_reconciliations (bank_account_id);
create index if not exists ix_br_date on public.bank_reconciliations (reconciliation_date);
create index if not exists ix_br_status on public.bank_reconciliations (status);

-- ============================================================
-- 5) توسيع قيد reference_type في الدفتر ليقبل 'bank_transaction'
-- ============================================================
do $body$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.general_ledger'::regclass
                and conname = 'general_ledger_reference_type_check') then
    alter table public.general_ledger drop constraint general_ledger_reference_type_check;
  end if;
  alter table public.general_ledger
    add constraint general_ledger_reference_type_check check (reference_type in (
      'purchase_invoice', 'purchase_order', 'sales_invoice', 'payment', 'receipt',
      'journal_entry', 'inventory_issue', 'inventory_receipt',
      'fixed_asset_acquisition', 'depreciation_entry', 'bank_transaction'
    ));
exception when others then
  raise notice 'توسيع قيد reference_type: %', SQLERRM;
end $body$;

-- ============================================================
-- 6) تدقيق تغيّر رصيد الخزانة (audit_logs — لا قيد أحادي غير متوازن)
-- ============================================================
create or replace function public.f_cash_wallet_balance_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $body$
begin
  insert into public.audit_logs
    (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
  values
    (new.tenant_id, new.updated_by, new.warehouse_id, 'cash_wallet_balance_change',
     'cash_wallets', new.id,
     jsonb_build_object(
       'wallet', new.name,
       'old_balance', old.current_balance,
       'new_balance', new.current_balance,
       'delta', new.current_balance - old.current_balance));
  return new;
end;
$body$;

revoke all on function public.f_cash_wallet_balance_audit() from public;

drop trigger if exists trg_cash_wallet_balance_change on public.cash_wallets;
create trigger trg_cash_wallet_balance_change
  after update on public.cash_wallets
  for each row
  when (new.current_balance is distinct from old.current_balance)
  execute function public.f_cash_wallet_balance_audit();

-- ============================================================
-- 7) قيود متوازنة تلقائياً عند مطابقة معاملة بنكية
--    كل نوع ينتج زوجاً (مدين/دائن) بين حسابات الشجرة الصحيحة،
--    وإعادة المطابقة تعيد كتابة القيود بلا تكرار (idempotent)
-- ============================================================
create or replace function public.f_bank_transaction_gl_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_bank uuid;     -- 111 البنوك
  v_cash uuid;     -- 112 الصندوق
  v_fee uuid;      -- 510 مصروفات (fallback)
  v_income uuid;   -- إيراد (fallback)
  v_dr uuid;
  v_cr uuid;
  v_tmp uuid;
  v_amount numeric;
begin
  -- أي حالة غير 'matched' تعني إزالة المطابقة → عكس قيود المعاملة
  -- (idempotent: الحذف عند عدم وجود قيود لا يفعل شيئاً)
  if new.status is distinct from 'matched' then
    delete from public.general_ledger
     where reference_type = 'bank_transaction' and reference_id = new.id;
    return new;
  end if;

  if new.amount = 0 then
    return new;
  end if;

  -- adjustment: مطابقة يدوية بلا قيد دفتري (يُزيل أي قيود قديمة)
  if new.transaction_type = 'adjustment' then
    delete from public.general_ledger
     where reference_type = 'bank_transaction' and reference_id = new.id;
    return new;
  end if;

  -- حسابات المؤسسة من شجرة الحسابات (مع بدائل متبادلة لا تتكرر)
  select id into v_bank from public.chart_of_accounts
   where tenant_id = new.tenant_id and code = '111' and account_type = 'asset' limit 1;
  if not found then
    select id into v_bank from public.chart_of_accounts
     where tenant_id = new.tenant_id and account_type = 'asset'
     order by lft limit 1;
  end if;

  select id into v_cash from public.chart_of_accounts
   where tenant_id = new.tenant_id and code = '112' and account_type = 'asset' limit 1;
  if v_cash is null or v_cash = v_bank then
    select id into v_cash from public.chart_of_accounts
     where tenant_id = new.tenant_id and account_type = 'asset'
       and id is distinct from v_bank
     order by lft limit 1;
  end if;

  if new.transaction_type = 'fee' then
    select id into v_fee from public.chart_of_accounts
     where tenant_id = new.tenant_id and code = '510' and account_type = 'expense' limit 1;
    if not found then
      select id into v_fee from public.chart_of_accounts
       where tenant_id = new.tenant_id and account_type = 'expense'
       order by lft limit 1;
    end if;
  elsif new.transaction_type = 'interest' then
    select id into v_income from public.chart_of_accounts
     where tenant_id = new.tenant_id and account_type = 'income' order by lft limit 1;
  end if;

  -- زوج القيد حسب النوع (adjustment: بلا قيد — مطابقة يدوية فقط)
  case new.transaction_type
    when 'deposit'    then v_dr := v_bank; v_cr := v_cash;
    when 'withdrawal' then v_dr := v_cash;  v_cr := v_bank;
    when 'transfer'   then v_dr := v_cash;  v_cr := v_bank;  -- مبسط: من البنك للصندوق
    when 'fee'        then v_dr := v_fee;   v_cr := v_bank;
    when 'interest'   then v_dr := v_bank;  v_cr := v_income;
    else                   v_dr := null;    v_cr := null;
  end case;

  -- مبلغ سالب = عكس اتجاه الحركة (مثلاً إيداع سالب = سحب)
  v_amount := abs(new.amount);
  if new.amount < 0 then
    v_tmp := v_dr; v_dr := v_cr; v_cr := v_tmp;
  end if;

  if v_dr is null or v_cr is null then
    raise exception 'لا توجد حسابات شجرة مناسبة (بنك/صندوق/مصاريف/إيراد) للمؤسسة %',
      new.tenant_id;
  end if;
  if v_dr = v_cr then
    raise exception 'حسابا المدين والدائن متطابقان — راجع شجرة الحسابات (بنك/صندوق)';
  end if;

  -- idempotent: حذف أي قيود سابقة لهذه المعاملة قبل إعادة الإنشاء
  delete from public.general_ledger
   where reference_type = 'bank_transaction' and reference_id = new.id;

  insert into public.general_ledger
    (tenant_id, account_id, reference_type, reference_id, debit, credit,
     description, notes, created_at, created_by, posted)
  values
    (new.tenant_id, v_dr, 'bank_transaction', new.id, v_amount, 0,
     upper(substr(new.transaction_type, 1, 1)) || substr(new.transaction_type, 2) ||
       ' بنكي - ' || new.description,
     'معاملة بنكية مطابقة رقم ' || new.id::text,
     now(), new.created_by, true);

  insert into public.general_ledger
    (tenant_id, account_id, reference_type, reference_id, debit, credit,
     description, notes, created_at, created_by, posted)
  values
    (new.tenant_id, v_cr, 'bank_transaction', new.id, 0, v_amount,
     'مقابل: ' || new.description,
     'معاملة بنكية مطابقة رقم ' || new.id::text,
     now(), new.created_by, true);

  return new;
end;
$body$;

revoke all on function public.f_bank_transaction_gl_trigger() from public;
grant execute on function public.f_bank_transaction_gl_trigger() to service_role;

drop trigger if exists trg_bank_transaction_gl_auto on public.bank_transactions;
create trigger trg_bank_transaction_gl_auto
  after update on public.bank_transactions
  for each row
  when (new.status is distinct from old.status)
  execute function public.f_bank_transaction_gl_trigger();

-- ============================================================
-- 8) تحقق نهائي
-- ============================================================
do $body$
declare
  v_count bigint;
begin
  select count(*) into v_count from public.cash_wallets;
  raise notice 'Phase 5: cash_wallets = %', v_count;
  select count(*) into v_count from public.bank_accounts;
  raise notice 'Phase 5: bank_accounts = %', v_count;
  select count(*) into v_count from public.bank_transactions;
  raise notice 'Phase 5: bank_transactions = %', v_count;
  select count(*) into v_count from public.bank_reconciliations;
  raise notice 'Phase 5: bank_reconciliations = %', v_count;
end $body$;

SELECT 'Phase 5 verification:' AS message;
SELECT count(*) AS cash_wallet_count FROM public.cash_wallets;
SELECT count(*) AS bank_account_count FROM public.bank_accounts;
SELECT count(*) AS bank_transaction_count FROM public.bank_transactions;
SELECT count(*) AS reconciliation_count FROM public.bank_reconciliations;
