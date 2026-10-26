-- part1_sales_tables.sql — الجزء 1 من 3: الجداول والفهارس والإعدادات (يُنفَّذ أولاً)
-- ============================================================
-- نظام المبيعات المتكامل — ترحيل إضافي فقط (لا حذف ولا تعديل جداول قائمة)
-- 20261019_sales_system.sql
-- يُنفذ مرة واحدة من Supabase SQL Editor على 3 أجزاء:
--   الجزء 1: جداول + فهارس + إعدادات
--   الجزء 2: الدوال الذرية (اعتماد بيع FEFO + دفعات + مرتجعات + ترقيم)
--   الجزء 3: منع الحذف المباشر + RLS + الصلاحيات
-- ============================================================

-- ============================================================
-- الجزء 1: جداول + فهارس + إعدادات
-- ============================================================

-- 1) عروض أسعار البيع (الجداول الجديدة الوحيدة — الفجوة في المخطط)
create table if not exists public.sales_quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete restrict,
  customer_name text,
  quote_number text not null,
  quote_date date not null default current_date,
  valid_until date,
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  status text not null default 'draft'
    check (status in ('draft','sent','accepted','rejected','expired','converted')),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.sales_quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.sales_quotes(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text,
  quantity numeric(14,2) not null check (quantity > 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  discount_percent numeric(6,2) not null default 0 check (discount_percent >= 0 and discount_percent <= 100),
  tax_percent numeric(6,2) not null default 0 check (tax_percent >= 0 and tax_percent <= 100),
  line_total numeric(14,2) generated always as
    (round(quantity * unit_price * (1 - discount_percent/100) * (1 + tax_percent/100), 2)) stored,
  notes text,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_sales_quotes_wh_number
  on public.sales_quotes (warehouse_id, quote_number) where deleted_at is null;
create index if not exists ix_sales_quotes_customer
  on public.sales_quotes (customer_id, quote_date desc);
create index if not exists ix_sales_quotes_wh_status
  on public.sales_quotes (warehouse_id, status, quote_date desc);
create index if not exists ix_sales_quote_items_quote on public.sales_quote_items (quote_id);
create index if not exists ix_sales_quote_items_product on public.sales_quote_items (product_id);

-- 2) قيود الفهرسة الفريدة وال índices على جداول البيع القائمة (آمنة: كلها محمية بـ exception)
do $body$
begin
  begin
    create unique index if not exists uq_sales_invoices_wh_number
      on public.sales_invoices (warehouse_id, invoice_number) where deleted_at is null;
  exception when others then raise notice 'uq_sales_invoices_wh_number: %', SQLERRM; end;

  begin
    create unique index if not exists uq_sales_orders_wh_number
      on public.sales_orders (warehouse_id, order_number) where deleted_at is null;
  exception when others then raise notice 'uq_sales_orders_wh_number: %', SQLERRM; end;

  begin
    create unique index if not exists uq_returns_wh_number
      on public.returns (warehouse_id, return_number) where deleted_at is null;
  exception when others then raise notice 'uq_returns_wh_number: %', SQLERRM; end;

  begin
    create index if not exists ix_sales_invoices_customer
      on public.sales_invoices (customer_id, invoice_date desc);
  exception when others then raise notice 'ix_sales_invoices_customer: %', SQLERRM; end;

  begin
    create index if not exists ix_sales_invoices_wh_status
      on public.sales_invoices (warehouse_id, status, invoice_date desc);
  exception when others then raise notice 'ix_sales_invoices_wh_status: %', SQLERRM; end;

  begin
    create index if not exists ix_sales_invoice_items_invoice
      on public.sales_invoice_items (sales_invoice_id);
    create index if not exists ix_sales_invoice_items_product_batch
      on public.sales_invoice_items (product_id, batch_number);
  exception when others then raise notice 'sales_invoice_items indexes: %', SQLERRM; end;

  begin
    create index if not exists ix_returns_customer
      on public.returns (customer_id, return_date desc);
    create index if not exists ix_returns_reference
      on public.returns (reference_type, reference_id);
  exception when others then raise notice 'returns indexes: %', SQLERRM; end;

  -- فهرس FEFO: جلب الدفعات المتاحة الأقرب انتهاءً أولاً
  begin
    create index if not exists ix_inventory_fefo
      on public.inventory (warehouse_id, product_id, expiry_date)
      where available_quantity > 0;
  exception when others then raise notice 'ix_inventory_fefo: %', SQLERRM; end;

  begin
    create index if not exists ix_payments_customer
      on public.payments (customer_id, payment_date desc);
  exception when others then raise notice 'ix_payments_customer: %', SQLERRM; end;
end; $body$;

-- 3) إعدادات المبيعات (الضرائب والحد الائتماني) — قيم افتراضية مصرّح بها
do $body$
begin
  insert into public.settings (key, value) values
    ('sales_tax_enabled', 'false'),
    ('sales_tax_percent', '0'),
    ('sales_default_payment_terms', '"cash"'),
    ('sales_credit_alert_percent', '80'),
    ('sales_allow_negative_stock', 'false')
  on conflict (key) do nothing;
exception when others then raise notice 'settings seed: %', SQLERRM; end; $body$;

-- 4) تشخيص: طباعة القيود الحالية المسموحة بحالات الفواتير/المرتجعات (معلومة فقط)
do $body$
declare r record;
begin
  for r in
    select c.conrelid::regclass::text as tbl, c.conname, pg_get_constraintdef(c.oid) as def
      from pg_constraint c
     where c.conrelid in ('public.sales_invoices'::regclass, 'public.returns'::regclass, 'public.sales_orders'::regclass)
       and c.contype = 'c'
  loop
    raise notice 'CHECK % على %: %', r.conname, r.tbl, r.def;
  end loop;
exception when others then raise notice 'diagnostics: %', SQLERRM; end; $body$;

-- فحص الأعمدة التي تعتمد عليها دوال المبيعات (تنبيهات استباقية لأي عدم تطابق)
do $body$
DECLARE r record; BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('sales_invoices', 'invoice_number'), ('sales_invoices', 'paid_amount'),
      ('sales_invoices', 'deleted_at'), ('sales_invoices', 'updated_by'),
      ('sales_invoices', 'updated_at'), ('sales_invoices', 'payment_due_date'),
      ('sales_invoice_items', 'discount_percent'), ('sales_invoice_items', 'line_total'),
      ('sales_invoice_items', 'created_at'), ('sales_invoice_items', 'unit_price'),
      ('payments', 'payment_number'), ('payments', 'payment_type'),
      ('payments', 'notes'), ('payments', 'customer_id'), ('payments', 'warehouse_id'),
      ('payments', 'type'), ('payments', 'reference_type'), ('payments', 'reference_id'),
      ('payments', 'payment_method'), ('payments', 'status'), ('payments', 'created_by'),
      ('payments', 'payment_date'),
      ('inventory_movements', 'customer_id'), ('inventory_movements', 'batch_number'),
      ('inventory_movements', 'expiry_date'), ('inventory_movements', 'cost_price'),
      ('inventory_movements', 'movement_subtype'),
      ('inventory', 'expired_quantity'), ('inventory', 'damaged_quantity'),
      ('inventory', 'is_quarantined'), ('inventory', 'available_quantity'),
      ('inventory', 'batch_number'), ('inventory', 'expiry_date'),
      ('inventory', 'cost_price'),      ('inventory', 'updated_by'), ('inventory', 'updated_at'), ('inventory', 'notes'),
      ('settings', 'key'), ('settings', 'value'),
      ('returns', 'return_type'), ('returns', 'reference_type'), ('returns', 'reference_id'),
      ('returns', 'return_number'), ('returns', 'subtotal'), ('returns', 'tax_amount'),
      ('returns', 'status'), ('returns', 'customer_id'), ('returns', 'warehouse_id'),
      ('returns', 'deleted_at'), ('returns', 'updated_by'), ('returns', 'return_date'),
      ('returns', 'updated_at'), ('returns', 'reason'), ('returns', 'notes'),
      ('return_items', 'reason'), ('return_items', 'batch_number'),
      ('return_items', 'action'), ('return_items', 'notes'), ('return_items', 'unit_price'),
      ('audit_logs', 'new_values'), ('audit_logs', 'warehouse_id'), ('audit_logs', 'user_id')
    ) AS t(tbl, col)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns ic
       WHERE ic.table_schema = 'public' AND ic.table_name = r.tbl AND ic.column_name = r.col
    ) THEN
      raise notice 'MISSING COLUMN: %.%', r.tbl, r.col;
    END IF;
  END LOOP;
EXCEPTION WHEN others THEN raise notice 'column-check: %', SQLERRM; END; $body$;

