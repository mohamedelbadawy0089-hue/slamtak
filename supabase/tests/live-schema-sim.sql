-- محاكاة القاعدة الحيّة على Supabase قبل تشغيل الهجرة
-- يتضمن: auth schema + الجداول القديمة chart_of_accounts/journal_entries
--         + كل الجداول المطلوبة للمبيعات والمشتريات والمخزون

create schema if not exists auth;
-- أدوار Supabase القياسية
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO authenticated, service_role, anon;
GRANT USAGE ON SCHEMA auth TO authenticated, service_role, anon;

create table if not exists auth.users (id uuid primary key default gen_random_uuid());
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

-- جداول قديمة موجودة فعلاً على القاعدة الحيّة (بنقائصها!)
create table if not exists public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name_ar text,
  parent_id uuid,
  currency text not null default 'EGP',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  description text,
  period_id uuid,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- الجداول الأساسية (مطابقة للقاعدة الحيّة)
create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  is_main boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.user_warehouses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade
);

create table if not exists public.customers (
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
  type text,
  customer_type text,
  credit_limit numeric(14,2) not null default 0,
  payment_terms text not null default 'cash',
  is_active boolean not null default true,
  notes text,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  credit_limit numeric(14,2) not null default 0,
  payment_terms text not null default 'net 30',
  is_active boolean not null default true,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  name text not null,
  description text,
  name_ar text,
  current_stock integer not null default 0,
  minimum_stock integer not null default 0,
  average_cost decimal(10,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  warehouse_id uuid not null,
  product_id uuid not null,
  available_quantity numeric not null default 0,
  cost_price numeric not null default 0,
  batch_number text,
  expiry_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  warehouse_id uuid not null,
  product_id uuid not null,
  movement_type text not null,
  quantity numeric not null,
  cost_price numeric,
  reference_type text,
  reference_id uuid,
  movement_subtype text,
  customer_id uuid,
  batch_number text,
  expiry_date date,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  user_id uuid,
  warehouse_id uuid,
  action text not null,
  entity_type text,
  entity_id uuid,
  new_values jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.sales_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  warehouse_id uuid not null,
  customer_id uuid not null,
  invoice_number text not null,
  invoice_date date not null default current_date,
  due_date date,
  subtotal numeric(18,2) not null default 0,
  tax_amount numeric(18,2) not null default 0,
  discount_amount numeric(18,2) not null default 0,
  total_amount numeric(18,2) not null default 0,
  paid_amount numeric(18,2) not null default 0,
  status text not null default 'draft',
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_invoice_items (
  id uuid primary key default gen_random_uuid(),
  sales_invoice_id uuid not null references public.sales_invoices(id) on delete cascade,
  product_id uuid not null,
  quantity numeric not null,
  unit_price numeric not null,
  discount_percent numeric default 0,
  tax_percent numeric default 0,
  line_total numeric not null,
  batch_number text,
  expiry_date date,
  cost_price numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  warehouse_id uuid not null,
  return_number text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  type text not null,
  reference_type text,
  reference_id uuid,
  customer_id uuid,
  supplier_id uuid,
  warehouse_id uuid,
  amount numeric(18,2) not null,
  payment_date date not null default current_date,
  payment_method text,
  payment_number text,
  payment_type text,
  status text,
  notes text,
  deleted_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  warehouse_id uuid not null,
  supplier_id uuid not null,
  order_number text,
  order_date date not null default current_date,
  status text not null default 'draft',
  total_amount numeric(18,2) not null default 0,
  subtotal numeric(18,2) not null default 0,
  tax_amount numeric(18,2) not null default 0,
  discount_amount numeric(18,2) not null default 0,
  notes text,
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id uuid not null,
  quantity numeric not null,
  unit_price numeric not null,
  created_at timestamptz not null default now()
);

create table if not exists public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.goods_receipt_items (
  id uuid primary key default gen_random_uuid(),
  goods_receipt_id uuid not null references public.goods_receipts(id) on delete cascade,
  product_id uuid not null,
  quantity_received numeric not null,
  unit_cost numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  supplier_id uuid not null,
  invoice_number text not null,
  invoice_date date not null default current_date,
  total_amount numeric(18,2) not null default 0,
  status text not null default 'draft',
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key,
  role text not null default 'employee'
);
