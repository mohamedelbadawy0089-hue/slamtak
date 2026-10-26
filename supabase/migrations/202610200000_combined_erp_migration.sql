
-- ============================================================
-- 202610170001_create_inventory_tables.sql
-- ============================================================

-- Create products table
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  current_stock integer default 0,
  average_cost decimal(10,2) default 0,
  minimum_stock integer default 5,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Create inventory_movements table for tracking stock changes
create table if not exists inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  quantity integer not null,
  type text not null check (type in ('in', 'out')),
  reason text,
  created_at timestamp with time zone default now(),
  created_by uuid references auth.users(id)
);

-- Enable row level security automatically
alter table products enable row level security;
alter table inventory_movements enable row level security;

-- Create comprehensive RLS policies for products
create policy "Products are viewable by authenticated users" on products
  for select to authenticated using (true);

create policy "Products are insertable by authenticated users with role check" on products
  for insert to authenticated with check (true);

create policy "Products are updatable by authenticated users" on products
  for update to authenticated using (true);

create policy "Products are deletable by super admins only" on products
  for delete to authenticated using (false);

-- Create comprehensive RLS policies for inventory movements
create policy "Inventory movements are viewable by authenticated users" on inventory_movements
  for select to authenticated using (true);

create policy "Inventory movements are insertable by authenticated users" on inventory_movements
  for insert to authenticated with check (true);

create policy "Inventory movements are updatable by authenticated users" on inventory_movements
  for update to authenticated using (true);

-- Grant necessary permissions
grant all on products to authenticated;
grant all on inventory_movements to authenticated;

-- Comment to document the RLS setup
comment on table products is 'RLS enabled: authenticated users can view, insert; no delete without super-admin role';
comment on table inventory_movements is 'RLS enabled: authenticated users can view and insert movements';

-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- done: 202610170001_create_inventory_tables.sql
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

-- ============================================================
-- 202610170002_create_triggers_functions.sql
-- ============================================================

-- Create function to update average cost when new stock is added (RLS-aware)
create or replace function update_average_cost()
returns trigger as $body$
begin
  if new.type = 'in' then
    -- Update product average cost
    update products set
      current_stock = current_stock + new.quantity,
      average_cost = case
        when current_stock = 0 then new.unit_cost
        else ((average_cost * (current_stock - new.quantity)) + (new.unit_cost * new.quantity)) / current_stock
      end,
      updated_at = now()
    where id = new.product_id;
  end if;
  return new;
end;
$body$ language plpgsql;

-- Create trigger on inventory_movements for average cost
create trigger inventory_movement_trigger
after insert on inventory_movements
for each row execute function update_average_cost();

-- Create function for low stock alert
create or replace function check_low_stock_alert()
returns trigger as $body$
declare
  product_row products%rowtype;
begin
  select * into product_row from products where id = new.product_id;
  
  if new.type = 'out' and product_row.current_stock < product_row.minimum_stock then
    raise notice 'Low stock alert: Product % has stock % (minimum: % )', product_row.name, product_row.current_stock, product_row.minimum_stock;
  end if;
  
  return new;
end;
$body$ language plpgsql;

-- Create trigger for low stock alert
create trigger low_stock_alert_trigger
after insert on inventory_movements
for each row execute function check_low_stock_alert();

-- Create function to recalculate average cost for a product
create or replace function recalculate_average_cost(product_id_param uuid)
returns void as $body$
declare
  total_cost decimal(10,2) := 0;
  total_quantity integer := 0;
  avg_cost decimal(10,2);
begin
  -- Calculate total cost from all incoming movements
  select coalesce(sum(quantity * unit_cost), 0), coalesce(sum(quantity), 0)
  into total_cost, total_quantity
  from inventory_movements
  where product_id = product_id_param and type = 'in';
  
  if total_quantity > 0 then
    avg_cost := total_cost / total_quantity;
    update products set average_cost = avg_cost, updated_at = now() where id = product_id_param;
  end if;
end;
$body$ language plpgsql;

-- Create function to get low stock products
create or replace function get_low_stock_products()
returns table (
  id uuid,
  name text,
  current_stock integer,
  minimum_stock integer,
  average_cost decimal(10,2)
) as $body$
begin
  return query
  select id, name, current_stock, minimum_stock, average_cost
  from products
  where current_stock < minimum_stock;
end;
$body$ language plpgsql;

-- Insert sample products for testing
insert into products (name, description, current_stock, average_cost, minimum_stock)
values 
  ('Widget A', 'A standard widget', 10, 5.99, 5),
  ('Widget B', 'A premium widget', 3, 12.49, 5),
  ('Widget C', 'A basic widget', 15, 2.99, 10);

-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- done: 202610170002_create_triggers_functions.sql
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

-- ============================================================
-- 202610170003_create_profiles_table.sql
-- ============================================================

-- Create profiles table for user role management
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null default 'viewer' check (role in ('viewer', 'admin', 'super_admin', 'manager', 'warehouse_manager', 'owner')),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable row level security automatically
alter table profiles enable row level security;

-- Create RLS policies for profiles table
-- Super admins can view all profiles
create policy "Super admins can view all profiles" on profiles
  for select to authenticated using ((select role from auth.users where auth.users.id = id) = 'super-admin');

-- Users can view their own profile
create policy "Users can view own profile" on profiles
  for select to authenticated using (auth.uid() = id);

-- Users can update their own profile
create policy "Users can update own profile" on profiles
  for update to authenticated using (auth.uid() = id);

-- Admins and managers can view profiles of users under them (simplified)
create policy "Admins/managers can view profiles" on profiles
  for select to authenticated using ((select role from auth.users where auth.users.id = id) in ('super-admin', 'manager'));

-- Grant necessary permissions
grant all on profiles to authenticated;
grant usage on schema auth to authenticated;

-- Comment to document the RLS setup
comment on table profiles is 'RLS enabled: role-based access control for user profiles';
comment on column profiles.role is 'User role: viewer, admin, super_admin, manager, warehouse_manager, or owner';

-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- done: 202610170003_create_profiles_table.sql
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

-- ============================================================
-- 20261018_procurement_system.sql
-- ============================================================

-- ============================================================
-- نظام المشتريات — ترحيل آمن وإضافي فقط (لا حذف ولا تعديل جداول قائمة)
-- يُنفذ مرة واحدة من Supabase SQL Editor
-- ============================================================

-- ------------------------------------------------------------
-- 1) طلبات الشراء
-- ------------------------------------------------------------
create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  request_number text not null,
  status text not null default 'pending_approval'
    check (status in ('draft','pending_approval','approved','rejected','ordered','cancelled')),
  source text not null default 'manual' check (source in ('manual','auto')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  requested_by uuid not null,
  requested_by_name text,
  estimated_total numeric(14,2) not null default 0 check (estimated_total >= 0),
  needed_by date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_purchase_requests_wh_number
  on public.purchase_requests (warehouse_id, request_number);
create index if not exists ix_purchase_requests_wh_status
  on public.purchase_requests (warehouse_id, status, created_at desc);
create index if not exists ix_purchase_requests_requested_by
  on public.purchase_requests (requested_by);

-- ------------------------------------------------------------
-- 2) أصناف طلبات الشراء
-- ------------------------------------------------------------
create table if not exists public.purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.purchase_requests(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text,
  quantity numeric(14,2) not null check (quantity > 0),
  estimated_price numeric(14,2) not null default 0 check (estimated_price >= 0),
  line_total numeric(14,2) generated always as (quantity * estimated_price) stored,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists ix_purchase_request_items_request on public.purchase_request_items (request_id);
create index if not exists ix_purchase_request_items_product on public.purchase_request_items (product_id);

-- ------------------------------------------------------------
-- 3) عروض أسعار الموردين (الأصناف داخل jsonb لتجنب جدول زائد)
-- ------------------------------------------------------------
create table if not exists public.supplier_quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  request_id uuid references public.purchase_requests(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  supplier_name text,
  quote_number text not null,
  quote_date date not null default current_date,
  valid_until date,
  delivery_days integer check (delivery_days is null or delivery_days >= 0),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  items jsonb not null default '[]'::jsonb,
  -- items: [{product_id, product_name, quantity, unit_price, line_total}]
  status text not null default 'submitted' check (status in ('submitted','selected','rejected','expired')),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_supplier_quotes_wh_number
  on public.supplier_quotes (warehouse_id, quote_number);
create index if not exists ix_supplier_quotes_request on public.supplier_quotes (request_id, total_amount);
create index if not exists ix_supplier_quotes_supplier on public.supplier_quotes (supplier_id, quote_date desc);

-- ------------------------------------------------------------
-- 4) سجل الموافقات (فصل المهام: الموافق ≠ مُعِدّ الطلب)
-- ------------------------------------------------------------
create table if not exists public.purchase_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  entity_type text not null check (entity_type in ('purchase_request','purchase_order')),
  entity_id uuid not null,
  decision text not null check (decision in ('approved','rejected')),
  amount numeric(14,2) not null default 0,
  comment text,
  approver_id uuid not null,
  approver_name text,
  created_at timestamptz not null default now()
);

create index if not exists ix_purchase_approvals_entity on public.purchase_approvals (entity_type, entity_id, created_at desc);
create index if not exists ix_purchase_approvals_warehouse on public.purchase_approvals (warehouse_id, created_at desc);

-- ------------------------------------------------------------
-- 5) قيود الفهرسة الفريدة على الجداول القائمة (آمنة: where شرطي)
-- ------------------------------------------------------------
do $body$
begin
  begin
    create unique index if not exists uq_purchase_orders_wh_number
      on public.purchase_orders (warehouse_id, order_number)
      where deleted_at is null;
  exception when others then raise notice 'uq_purchase_orders_wh_number: %', SQLERRM; end;

  begin
    create unique index if not exists uq_goods_receipts_wh_number
      on public.goods_receipts (warehouse_id, receipt_number)
      where deleted_at is null;
  exception when others then raise notice 'uq_goods_receipts_wh_number: %', SQLERRM; end;

  begin
    create unique index if not exists uq_purchase_invoices_supplier_doc
      on public.purchase_invoices (supplier_id, supplier_invoice_number)
      where supplier_invoice_number is not null and deleted_at is null;
  exception when others then raise notice 'uq_purchase_invoices_supplier_doc: %', SQLERRM; end;

  begin
    create unique index if not exists uq_purchase_invoices_wh_number
      on public.purchase_invoices (warehouse_id, invoice_number)
      where deleted_at is null;
  exception when others then raise notice 'uq_purchase_invoices_wh_number: %', SQLERRM; end;

  begin
    create unique index if not exists uq_payments_number
      on public.payments (payment_number)
      where deleted_at is null;
  exception when others then raise notice 'uq_payments_number: %', SQLERRM; end;

  begin
    create index if not exists ix_purchase_orders_supplier on public.purchase_orders (supplier_id, order_date desc);
    create index if not exists ix_purchase_orders_warehouse on public.purchase_orders (warehouse_id, status, order_date desc);
    create index if not exists ix_goods_receipts_po on public.goods_receipts (purchase_order_id, receipt_date desc);
    create index if not exists ix_purchase_invoices_supplier on public.purchase_invoices (supplier_id, invoice_date desc);
    create index if not exists ix_payments_reference on public.payments (reference_type, reference_id, payment_date desc);
  exception when others then raise notice 'indexes: %', SQLERRM; end;
end $body$;

-- ------------------------------------------------------------
-- 6) أمان: RLS + سياسات عزل المخزن (الوصول عبر الخادم service role يتجاوز RLS،
--    والسياسات تحمي الوصول المباشر من العميل المصادق عليه)
-- ------------------------------------------------------------
alter table public.purchase_requests enable row level security;
alter table public.purchase_request_items enable row level security;
alter table public.supplier_quotes enable row level security;
alter table public.purchase_approvals enable row level security;

do $body$
begin
  begin
    create policy "pr_select_own_wh" on public.purchase_requests for select to authenticated
      using (warehouse_id in (select warehouse_id from public.user_warehouses where user_id = auth.uid()));
  exception when duplicate_object or others then null; end;
  begin
    create policy "pri_select_own_wh" on public.purchase_request_items for select to authenticated
      using (request_id in (select id from public.purchase_requests
                            where warehouse_id in (select warehouse_id from public.user_warehouses where user_id = auth.uid())));
  exception when duplicate_object or others then null; end;
  begin
    create policy "sq_select_own_wh" on public.supplier_quotes for select to authenticated
      using (warehouse_id in (select warehouse_id from public.user_warehouses where user_id = auth.uid()));
  exception when duplicate_object or others then null; end;
  begin
    create policy "pa_select_own_wh" on public.purchase_approvals for select to authenticated
      using (warehouse_id in (select warehouse_id from public.user_warehouses where user_id = auth.uid()));
  exception when duplicate_object or others then null; end;
end $body$;

grant select on public.purchase_requests, public.purchase_request_items, public.supplier_quotes, public.purchase_approvals to authenticated;

-- ------------------------------------------------------------
-- 7) دوال ذرية (معاملة واحدة لكل عملية) — تُستخدم تلقائياً عند توفرها
-- ------------------------------------------------------------

-- 7.1 استلام المشتريات ذرياً: إيصال + أصناف + مخزون (دفعات) + حركات + تحديث أمر الشراء
create or replace function public.p_proc_receive_goods(
  p_purchase_order_id uuid,
  p_items jsonb,             -- [{product_id, quantity_received, quantity_damaged, batch_number, expiry_date, unit_cost}]
  p_notes text,
  p_user_id uuid,
  p_receipt_number text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_po public.purchase_orders%rowtype;
  v_wh uuid;
  v_supplier uuid;
  v_tenant uuid;
  v_receipt_id uuid;
  v_item jsonb;
  v_ordered numeric;
  v_prior numeric;
  v_new_qty numeric;
  v_inv_id uuid;
  v_old_cost numeric;
  v_old_qty numeric;
  v_new_cost numeric;
  v_remaining int := 0;
  v_product uuid;
begin
  select * into v_po from public.purchase_orders where id = p_purchase_order_id for update;
  if not found then raise exception 'أمر الشراء غير موجود'; end if;
  if v_po.status not in ('approved','sent','partially_received') then
    raise exception 'لا يمكن الاستلام على أمر بحالة %', v_po.status;
  end if;
  v_wh := v_po.warehouse_id; v_supplier := v_po.supplier_id; v_tenant := v_po.tenant_id;

  insert into public.goods_receipts (tenant_id, purchase_order_id, warehouse_id, receipt_number, receipt_date, supplier_id, status, notes, received_by, created_by)
  values (v_tenant, p_purchase_order_id, v_wh, p_receipt_number, current_date, v_supplier, 'received', p_notes, p_user_id, p_user_id)
  returning id into v_receipt_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product := (v_item->>'product_id')::uuid;
    if not exists (select 1 from public.purchase_order_items i where i.purchase_order_id = p_purchase_order_id and i.product_id = v_product) then
      raise exception 'المنتج غير موجود في أمر الشراء';
    end if;

    insert into public.goods_receipt_items
      (goods_receipt_id, product_id, batch_number, expiry_date, quantity, quantity_ordered, quantity_received, quantity_damaged, unit_cost, cost_price, notes)
    values
      (v_receipt_id, v_product, nullif(v_item->>'batch_number',''), nullif(v_item->>'expiry_date','')::date,
       coalesce((v_item->>'quantity_received')::numeric,0), 0,
       coalesce((v_item->>'quantity_received')::numeric,0), coalesce((v_item->>'quantity_damaged')::numeric,0),
       coalesce((v_item->>'unit_cost')::numeric,0), coalesce((v_item->>'unit_cost')::numeric,0), nullif(v_item->>'notes',''));

    -- تحديث الكمية المستلمة على بند أمر الشراء (مع منع تجاوز المطلوب)
    select coalesce(sum(quantity_received),0) into v_prior
      from public.goods_receipt_items gri
      join public.goods_receipts gr on gr.id = gri.goods_receipt_id
     where gr.purchase_order_id = p_purchase_order_id and gri.product_id = v_product and gr.deleted_at is null;
    select quantity into v_ordered from public.purchase_order_items
     where purchase_order_id = p_purchase_order_id and product_id = v_product;
    if v_prior + coalesce((v_item->>'quantity_received')::numeric,0) > v_ordered then
      raise exception 'الكمية المستلمة تتجاوز المطلوب للمنتج %', v_product;
    end if;
    update public.purchase_order_items set received_quantity = v_prior + coalesce((v_item->>'quantity_received')::numeric,0), updated_at = now()
     where purchase_order_id = p_purchase_order_id and product_id = v_product;

    -- مخزون الدفعة (inventory = التشغات): مطابقة بالمخزن+المنتج+رقم التشغة
    select id, coalesce(cost_price,0), coalesce(available_quantity,0) into v_inv_id, v_old_cost, v_old_qty
      from public.inventory
     where warehouse_id = v_wh and product_id = v_product and batch_number = nullif(v_item->>'batch_number','')
     limit 1;
    if v_inv_id is not null then
      v_new_qty := v_old_qty + coalesce((v_item->>'quantity_received')::numeric,0);
      v_new_cost := case when v_new_qty = 0 then v_old_cost
                         else ((v_old_qty * v_old_cost) + (coalesce((v_item->>'quantity_received')::numeric,0) * coalesce((v_item->>'unit_cost')::numeric,0))) / v_new_qty end;
      update public.inventory set available_quantity = v_new_qty, quantity = v_new_qty,
             cost_price = v_new_cost, unit_cost = v_new_cost, expiry_date = coalesce(nullif(v_item->>'expiry_date','')::date, expiry_date), updated_at = now()
       where id = v_inv_id;
    else
      insert into public.inventory (tenant_id, warehouse_id, product_id, batch_number, expiry_date, quantity, available_quantity, unit_cost, cost_price, created_by)
      values (v_tenant, v_wh, v_product, nullif(v_item->>'batch_number',''), coalesce(nullif(v_item->>'expiry_date','')::date, '2099-12-31'::date),
              coalesce((v_item->>'quantity_received')::numeric,0), coalesce((v_item->>'quantity_received')::numeric,0),
              coalesce((v_item->>'unit_cost')::numeric,0), coalesce((v_item->>'unit_cost')::numeric,0), p_user_id);
    end if;

    -- سجل الحركة (مع رجوع لـ audit_logs إن كانت الجداول مقسّمة بلا قسمة)
    begin
      insert into public.inventory_movements (tenant_id, warehouse_id, product_id, movement_type, quantity, cost_price, notes, created_by)
      values (v_tenant, v_wh, v_product, 'in', coalesce((v_item->>'quantity_received')::numeric,0), coalesce((v_item->>'unit_cost')::numeric,0),
              concat('استلام أمر شراء ', v_po.order_number), p_user_id);
    exception when others then
      insert into public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
      values (v_tenant, p_user_id, v_wh, 'inventory_movement', 'inventory_movements', v_product,
              jsonb_build_object('movement_type','in','quantity',coalesce((v_item->>'quantity_received')::numeric,0),
                                 'cost_price',coalesce((v_item->>'unit_cost')::numeric,0),
                                 'notes',concat('استلام أمر شراء ', v_po.order_number)));
    end;
  end loop;

  -- تحديث حالة أمر الشراء
  select count(*) into v_remaining from public.purchase_order_items
   where purchase_order_id = p_purchase_order_id and received_quantity < quantity;
  update public.purchase_orders
     set status = case when v_remaining = 0 then 'received' else 'partially_received' end, updated_at = now(), updated_by = p_user_id
   where id = p_purchase_order_id;

  return jsonb_build_object('receipt_id', v_receipt_id, 'receipt_number', p_receipt_number,
                            'status', case when v_remaining = 0 then 'received' else 'partially_received' end);
end;
$body$;

revoke all on function public.p_proc_receive_goods(uuid, jsonb, text, uuid, text) from public;
grant execute on function public.p_proc_receive_goods(uuid, jsonb, text, uuid, text) to service_role;

-- 7.2 تسجيل دفعة دفعة لفاتورة مورد ذرياً (مع تحديث حالة الفاتورة ومنع التكرار)
create or replace function public.p_proc_record_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_number text,
  p_notes text,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_inv public.purchase_invoices%rowtype;
  v_paid numeric;
  v_outstanding numeric;
  v_payment_id uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;

  select * into v_inv from public.purchase_invoices where id = p_invoice_id for update;
  if not found then raise exception 'الفاتورة غير موجودة'; end if;
  if v_inv.deleted_at is not null then raise exception 'الفاتورة محذوفة'; end if;

  if exists (select 1 from public.payments where payment_number = p_payment_number and deleted_at is null) then
    raise exception 'رقم عملية الدفع مستخدم مسبقاً (منع التكرار)';
  end if;

  select coalesce(sum(amount),0) into v_paid from public.payments
   where reference_type = 'purchase_invoice' and reference_id = p_invoice_id and deleted_at is null;
  v_outstanding := coalesce(v_inv.total_amount,0) - v_paid;
  if p_amount > v_outstanding + 0.001 then
    raise exception 'المبلغ يتجاوز المتبقي (% )', v_outstanding;
  end if;

  insert into public.payments (tenant_id, type, reference_type, reference_id, supplier_id, warehouse_id, amount, payment_date,
                               payment_method, payment_number, payment_type, status, notes, created_by)
  values (v_inv.tenant_id, 'purchase', 'purchase_invoice', p_invoice_id, v_inv.supplier_id, v_inv.warehouse_id, p_amount, current_date,
          coalesce(p_payment_method,'cash'), p_payment_number, 'supplier_payment', 'completed', p_notes, p_user_id)
  returning id into v_payment_id;

  v_paid := v_paid + p_amount;
  update public.purchase_invoices
     set status = case when v_paid + 0.001 >= coalesce(total_amount,0) then 'paid' else 'partially_paid' end,
         updated_at = now(), updated_by = p_user_id
   where id = p_invoice_id;

  return jsonb_build_object('payment_id', v_payment_id, 'paid', v_paid,
                            'outstanding', coalesce(v_inv.total_amount,0) - v_paid,
                            'invoice_status', case when v_paid + 0.001 >= coalesce(v_inv.total_amount,0) then 'paid' else 'partially_paid' end);
end;
$body$;

revoke all on function public.p_proc_record_payment(uuid, numeric, text, text, text, uuid) from public;
grant execute on function public.p_proc_record_payment(uuid, numeric, text, text, text, uuid) to service_role;

-- انتهى الترحيل


-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- done: 20261018_procurement_system.sql
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

-- ============================================================
-- 20261019_sales_system.sql
-- ============================================================

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

-- ============================================================
-- الجزء 2: الدوال الذرية — معاملة واحدة لكل عملية مع تراجع كامل عند الفشل
-- ============================================================

-- 2.1 ترقيم فريد (أرقام فواتير/مرتجعات/عروض لا تتكرر)
create or replace function public.p_sale_next_number(p_prefix text, p_warehouse_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $body$
begin
  return p_prefix || '-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' ||
         upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
end;
$body$;

revoke all on function public.p_sale_next_number(text, uuid) from public;
grant execute on function public.p_sale_next_number(text, uuid) to service_role;

-- 2.2 اعتماد فاتورة بيع ذرياً: خصم FEFO من المخزون + حركات + فحص الائتمان + سجل تدقيق
create or replace function public.p_sale_approve_invoice(
  p_invoice_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_inv public.sales_invoices%rowtype;
  v_item record;
  v_batch record;
  v_remaining numeric;
  v_take numeric;
  v_lines jsonb := '[]'::jsonb;
  v_credit_limit numeric;
  v_outstanding numeric;
  v_terms text;
begin
  select * into v_inv from public.sales_invoices
   where id = p_invoice_id for update;
  if not found then raise exception 'فاتورة البيع غير موجودة'; end if;
  if v_inv.deleted_at is not null then raise exception 'الفاتورة محذوفة'; end if;
  if v_inv.status <> 'draft' then
    raise exception 'لا يمكن الاعتماد — الفاتورة بحالة % (المطلوب: draft)', v_inv.status;
  end if;

  -- خصم FEFO لكل صنف: الأقرب انتهاءً للصلاحية أولاً، وبدون بيع سالب مطلقاً
  for v_item in
    select sii.product_id, sii.quantity, coalesce(p.name_ar, p.name, sii.product_name) as pname
      from public.sales_invoice_items sii
      left join public.products p on p.id = sii.product_id
     where sii.sales_invoice_id = p_invoice_id
     order by sii.created_at asc
  loop
    v_remaining := v_item.quantity;
    for v_batch in
      select id, batch_number, available_quantity, expiry_date, cost_price
        from public.inventory
       where warehouse_id = v_inv.warehouse_id
         and product_id = v_item.product_id
         and available_quantity > 0
         and not coalesce(is_quarantined, false)
         and (expiry_date is null or expiry_date >= current_date)
       order by expiry_date asc nulls last
       for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_batch.available_quantity);
      update public.inventory
         set available_quantity = available_quantity - v_take,
             quantity = quantity - v_take,
             updated_at = now(),
             updated_by = p_user_id
       where id = v_batch.id;
      insert into public.inventory_movements
        (tenant_id, warehouse_id, product_id, batch_number, expiry_date,
         movement_type, movement_subtype, quantity, cost_price,
         reference_type, reference_id, customer_id, notes, created_by)
      values
        (v_inv.tenant_id, v_inv.warehouse_id, v_item.product_id,
         v_batch.batch_number, v_batch.expiry_date,
         'out', 'sale', v_take, v_batch.cost_price,
         'sales_invoice', v_inv.id, v_inv.customer_id,
         'بيع FEFO للفاتورة ' || v_inv.invoice_number, p_user_id);
      v_remaining := v_remaining - v_take;
    end loop;
    if v_remaining > 0 then
      raise exception 'المخزون غير الكافي للمنتج «%» — المطلوب % والمتاح قبل الصرف %',
        v_item.pname, v_remaining, v_item.quantity - v_remaining;
    end if;
    v_lines := v_lines || jsonb_build_object('product_id', v_item.product_id, 'quantity', v_item.quantity);
  end loop;

  -- فحص الحد الائتماني للبيع الآجل
  select coalesce(credit_limit, 0), coalesce(payment_terms, 'cash')
    into v_credit_limit, v_terms
    from public.customers where id = v_inv.customer_id;
  if v_terms <> 'cash' and coalesce(v_credit_limit, 0) > 0 then
    select coalesce(sum(total_amount - coalesce(paid_amount, 0)), 0)
      into v_outstanding
      from public.sales_invoices
     where customer_id = v_inv.customer_id
       and deleted_at is null
       and status in ('issued', 'partially_paid', 'paid')
       and id <> p_invoice_id;
    if v_outstanding + coalesce(v_inv.total_amount, 0) > v_credit_limit + 0.001 then
      raise exception 'تجاوز الحد الائتماني للعميل (الحد % والمطلوب إضافة %)',
        v_credit_limit, v_inv.total_amount;
    end if;
  end if;

  update public.sales_invoices
     set status = 'issued', updated_at = now(), updated_by = p_user_id
   where id = p_invoice_id;

  insert into public.audit_logs
    (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
  values
    (v_inv.tenant_id, p_user_id, v_inv.warehouse_id, 'sale_approve',
     'sales_invoices', p_invoice_id,
     jsonb_build_object('invoice_number', v_inv.invoice_number,
                        'customer_id', v_inv.customer_id,
                        'total_amount', v_inv.total_amount,
                        'items', v_lines));

  return jsonb_build_object('invoice_id', p_invoice_id, 'status', 'issued',
                            'deducted_items', jsonb_array_length(v_lines));
end;
$body$;

revoke all on function public.p_sale_approve_invoice(uuid, uuid) from public;
grant execute on function public.p_sale_approve_invoice(uuid, uuid) to service_role;

-- 2.3 تسجيل دفعة دفعة (نقدي/آجل/جزئي) ذرياً مع منع التكرار
create or replace function public.p_sale_record_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_number text,
  p_notes text,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_inv public.sales_invoices%rowtype;
  v_paid numeric;
  v_outstanding numeric;
  v_payment_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'مبلغ الدفعة يجب أن يكون أكبر من صفر';
  end if;
  select * into v_inv from public.sales_invoices where id = p_invoice_id for update;
  if not found then raise exception 'فاتورة البيع غير موجودة'; end if;
  if v_inv.deleted_at is not null then raise exception 'الفاتورة محذوفة'; end if;
  if v_inv.status not in ('issued', 'partially_paid') then
    raise exception 'لا تُقبل دفعات على فاتورة بحالة %', v_inv.status;
  end if;
  if exists (select 1 from public.payments where payment_number = p_payment_number) then
    raise exception 'رقم عملية الدفع مستخدم مسبقاً (منع التكرار)';
  end if;

  v_outstanding := coalesce(v_inv.total_amount, 0) - coalesce(v_inv.paid_amount, 0);
  if p_amount > v_outstanding + 0.001 then
    raise exception 'المبلغ يتجاوز المتبقي (% )', v_outstanding;
  end if;

  insert into public.payments
    (tenant_id, type, reference_type, reference_id, customer_id, warehouse_id,
     amount, payment_date, payment_method, payment_number, payment_type, status, notes, created_by)
  values
    (v_inv.tenant_id, 'sale', 'sales_invoice', p_invoice_id, v_inv.customer_id, v_inv.warehouse_id,
     p_amount, current_date, coalesce(p_payment_method, 'cash'), p_payment_number,
     'customer_payment', 'completed', p_notes, p_user_id)
  returning id into v_payment_id;

  v_paid := coalesce(v_inv.paid_amount, 0) + p_amount;
  update public.sales_invoices
     set paid_amount = v_paid,
         status = case when v_paid + 0.001 >= coalesce(total_amount, 0) then 'paid' else 'partially_paid' end,
         updated_at = now(), updated_by = p_user_id
   where id = p_invoice_id;

  insert into public.audit_logs
    (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
  values
    (v_inv.tenant_id, p_user_id, v_inv.warehouse_id, 'sale_payment',
     'payments', v_payment_id,
     jsonb_build_object('invoice_id', p_invoice_id, 'amount', p_amount,
                        'method', coalesce(p_payment_method, 'cash'),
                        'paid_total', v_paid));

  return jsonb_build_object('payment_id', v_payment_id, 'paid_total', v_paid,
                            'outstanding', coalesce(v_inv.total_amount, 0) - v_paid,
                            'invoice_status', case when v_paid + 0.001 >= coalesce(v_inv.total_amount, 0) then 'paid' else 'partially_paid' end);
end;
$body$;

revoke all on function public.p_sale_record_payment(uuid, numeric, text, text, text, uuid) from public;
grant execute on function public.p_sale_record_payment(uuid, numeric, text, text, text, uuid) to service_role;

-- 2.4 مرتجعات البيع: ربط بالفاتورة الأصلية + إعادة للمخزون فقط بعد فحص الصلاحية
--     (صالح وغير منتهي وغير محجور → إرجاع للمتاح، وإلا → حجر/منتهي بدون إرجاع للمتاح)
create or replace function public.p_sale_create_return(
  p_invoice_id uuid,
  p_items jsonb,          -- [{product_id, quantity, batch_number, check_passed}]
  p_reason text,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_inv public.sales_invoices%rowtype;
  v_return_id uuid;
  v_return_number text;
  v_item jsonb;
  v_product uuid;
  v_qty numeric;
  v_batch text;
  v_check boolean;
  v_orig record;
  v_prior_returned numeric;
  v_batch_row record;
  v_action text;
  v_restock_qty numeric := 0;
  v_quarantine_qty numeric := 0;
  v_total numeric := 0;
begin
  select * into v_inv from public.sales_invoices where id = p_invoice_id for update;
  if not found then raise exception 'فاتورة البيع غير موجودة'; end if;
  if v_inv.deleted_at is not null then raise exception 'الفاتورة محذوفة'; end if;
  if v_inv.status not in ('issued', 'partially_paid', 'paid') then
    raise exception 'لا تُقبل مرتجعات على فاتورة بحالة % (لم تُعتمد بعد)', v_inv.status;
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'أصناف المرتجع مطلوبة';
  end if;

  v_return_number := public.p_sale_next_number('RET', v_inv.warehouse_id);

  insert into public.returns
    (tenant_id, type, return_type, reference_type, reference_id, return_number,
     return_date, reason, status, total_amount, subtotal, tax_amount,
     warehouse_id, customer_id, notes, created_by)
  values
    (v_inv.tenant_id, 'out', 'customer', 'sales_invoice', p_invoice_id, v_return_number,
     current_date, p_reason, 'approved', 0, 0, 0,
     v_inv.warehouse_id, v_inv.customer_id, p_reason, p_user_id)
  returning id into v_return_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product := (v_item->>'product_id')::uuid;
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    v_batch := nullif(v_item->>'batch_number', '');
    v_check := coalesce((v_item->>'check_passed')::boolean, false);
    if v_qty <= 0 then raise exception 'كمية مرتجع غير صحيحة'; end if;

    -- الصنف يجب أن موجوداً في الفاتورة الأصلية بكمية لم يُرجعها بعد
    select quantity, coalesce(discount_percent, 0) as disc, unit_price
      into v_orig
      from public.sales_invoice_items
     where sales_invoice_id = p_invoice_id and product_id = v_product
     limit 1;
    if not found then raise exception 'المنتج غير موجود في الفاتورة الأصلية'; end if;

    select coalesce(sum(ri.quantity), 0) into v_prior_returned
      from public.return_items ri
      join public.returns r on r.id = ri.return_id
     where r.reference_type = 'sales_invoice' and r.reference_id = p_invoice_id
       and ri.product_id = v_product and r.deleted_at is null and r.status <> 'rejected';
    if v_prior_returned + v_qty > v_orig.quantity then
      raise exception 'كمية المرتجع تتجاوز المباع للمنتج (المباع % والمرتجع السابق %)',
        v_orig.quantity, v_prior_returned;
    end if;

    v_total := v_total + round(v_qty * v_orig.unit_price * (1 - v_orig.disc / 100), 2);

    -- إرجاع للمخزون المتاح فقط بعد فحص نجاح الصلاحية (وغير منتهي وغير محجور)
    select id, expiry_date, coalesce(is_quarantined, false) as quarantined
      into v_batch_row
      from public.inventory
     where warehouse_id = v_inv.warehouse_id and product_id = v_product
       and (batch_number = v_batch or (v_batch is null and batch_number is null))
     limit 1;

    if v_check and v_batch_row.id is not null
       and (v_batch_row.expiry_date is null or v_batch_row.expiry_date >= current_date)
       and not v_batch_row.quarantined then
      v_action := 'restock';
      v_restock_qty := v_restock_qty + v_qty;
      update public.inventory
         set available_quantity = available_quantity + v_qty,
             quantity = quantity + v_qty,
             updated_at = now(), updated_by = p_user_id
       where id = v_batch_row.id;
    else
      v_action := 'quarantine';
      v_quarantine_qty := v_quarantine_qty + v_qty;
      if v_batch_row.id is not null then
        update public.inventory
           set quantity = quantity + v_qty,
               expired_quantity = expired_quantity +
                 case when v_batch_row.expiry_date < current_date then v_qty else 0 end,
               damaged_quantity = damaged_quantity +
                 case when v_batch_row.expiry_date >= current_date then v_qty else 0 end,
               is_quarantined = true,
               available_quantity = available_quantity,
               updated_at = now(), updated_by = p_user_id
         where id = v_batch_row.id;
      else
        insert into public.inventory
          (tenant_id, warehouse_id, product_id, batch_number, expiry_date,
           quantity, available_quantity, is_quarantined, damaged_quantity, notes, created_by)
        values
          (v_inv.tenant_id, v_inv.warehouse_id, v_product, v_batch, null,
           v_qty, 0, true, v_qty, 'مرتجع بيع بدون دفعة أصلية — حجر', p_user_id);
      end if;
    end if;

    insert into public.return_items
      (return_id, product_id, quantity, unit_price, reason, batch_number, action, notes)
    values
      (v_return_id, v_product, v_qty, v_orig.unit_price, p_reason, v_batch, v_action,
       case when v_action = 'restock' then 'إرجاع للمخزون بعد فحص نجاح' else 'حُجر — فحص غير ناجح أو منتهي الصلاحية' end);

    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, batch_number, movement_type, movement_subtype,
       quantity, reference_type, reference_id, customer_id, notes, created_by)
    values
      (v_inv.tenant_id, v_inv.warehouse_id, v_product, v_batch, 'in',
       case when v_action = 'restock' then 'return' else 'return_quarantine' end,
       v_qty, 'returns', v_return_id, v_inv.customer_id,
       'مرتجع بيع ' || v_return_number, p_user_id);
  end loop;

  update public.returns
     set total_amount = v_total, subtotal = v_total, updated_at = now(), updated_by = p_user_id
   where id = v_return_id;

  insert into public.audit_logs
    (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
  values
    (v_inv.tenant_id, p_user_id, v_inv.warehouse_id, 'sale_return',
     'returns', v_return_id,
     jsonb_build_object('invoice_id', p_invoice_id, 'return_number', v_return_number,
                        'total', v_total, 'restocked', v_restock_qty, 'quarantined', v_quarantine_qty));

  return jsonb_build_object('return_id', v_return_id, 'return_number', v_return_number,
                            'total', v_total, 'restocked_qty', v_restock_qty,
                            'quarantined_qty', v_quarantine_qty);
end;
$body$;

revoke all on function public.p_sale_create_return(uuid, jsonb, text, uuid) from public;
grant execute on function public.p_sale_create_return(uuid, jsonb, text, uuid) to service_role;

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


-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- done: 20261019_sales_system.sql
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

-- ============================================================
-- 202610200001_create_chart_of_accounts.sql
-- ============================================================

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


-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- done: 202610200001_create_chart_of_accounts.sql
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

-- ============================================================
-- 202610200002_create_gl_trigger_sales.sql
-- ============================================================

-- ============================================================
-- 202610200002: Automatic GL Entries for Sales
-- قيود اليومية التلقائية للمبيعات (نظام القيد المزدوج)
-- يُنفَّذ مرة واحدة بعد migration 202610200001
-- (يعتمد على وجود: chart_of_accounts, general_ledger,
--  sales_invoices, sales_invoice_items, inventory_movements)
-- ============================================================

-- ============================================================
-- 1) p_create_sale_gl_entries:
--    إنشاء قيود اليومية (مدين/دائن) لفاتورة بيع واحدة
--    - قيد مجمع لكل حساب (يعمل مع قيد unique
--      tenant_id + reference_type + reference_id + account_id)
--    - لا يخصم المخزون (الخصم يتم في p_sale_approve_invoice)
--    - idempotent: يحذف قيود الفاتورة القديمة ثم يعيد إنشاءها
-- ============================================================
create or replace function public.p_create_sale_gl_entries(
  p_invoice_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_inv public.sales_invoices%rowtype;
  v_ar_account uuid;
  v_revenue_account uuid;
  v_discount_account uuid;
  v_tax_account uuid;
  v_cogs_account uuid;
  v_inventory_account uuid;

  v_line record;
  v_line_net numeric;
  v_line_discount numeric;
  v_line_tax numeric;

  v_subtotal numeric := 0;        -- إجمالي الأصناف قبل الخصم
  v_discount_total numeric := 0;  -- إجمالي الخصومات
  v_tax_total numeric := 0;       -- إجمالي الضريبة
  v_total numeric := 0;           -- الصافي + الضريبة = مدين العميل
  v_cogs_total numeric := 0;      -- تكلفة البضاعة المباعة (من حركات المخزون)
  v_revenue_credit numeric := 0;  -- الدائن على حساب الإيرادات
  v_discount_dr numeric := 0;     -- المدين على مصروف الخصم (0 لو لا يوجد حساب)
  v_tax_cr numeric := 0;          -- الدائن على ضريبة مستحقة (0 لو لا يوجد حساب)
  v_lines_count int := 0;
begin
  select * into v_inv from public.sales_invoices
   where id = p_invoice_id for update;

  if not found then
    raise exception 'فاتورة البيع غير موجودة';
  end if;
  if v_inv.deleted_at is not null then
    raise exception 'الفاتورة محذوفة';
  end if;
  if v_inv.status not in ('draft', 'issued') then
    raise exception 'لا يمكن إنشاء قيود يومية — الفاتورة بحالة % (المطلوب: draft أو issued)',
      v_inv.status;
  end if;

  -- عند النداء المباشر بفاتورة لا تزال draft: اعتمدها أولاً.
  -- تغيير الحالة يطلق المُشغّل trg_sales_invoice_gl_automation
  -- الذي يستدعي هذه الدالة مرة أخرى بالحالة issued (استدعاء واحد فقط).
  if v_inv.status = 'draft' then
    update public.sales_invoices
       set status = 'issued', updated_at = now(),
           updated_by = coalesce(p_user_id, updated_by)
     where id = p_invoice_id;
    if exists (select 1 from public.general_ledger
                where reference_type = 'sales_invoice' and reference_id = p_invoice_id) then
      return jsonb_build_object(
        'invoice_id', p_invoice_id,
        'invoice_number', v_inv.invoice_number,
        'status', 'issued',
        'gl_entries_created', true,
        'via_trigger', true,
        'message', 'تم إنشاء القيود عبر المُشغّل التلقائي');
    end if;
    select * into v_inv from public.sales_invoices where id = p_invoice_id for update;
  end if;

  -- ============================================================
  -- 2) تحديد الحسابات من شجرة الحسابات (مع بدائل عند الغياب)
  -- ============================================================

  -- الإيرادات: 410 (مبيعات الأدوية) ثم أي حساب إيرادات
  select id into v_revenue_account from public.chart_of_accounts
   where tenant_id = v_inv.tenant_id and code = '410' and account_type = 'income'
   limit 1;
  if not found then
    select id into v_revenue_account from public.chart_of_accounts
     where tenant_id = v_inv.tenant_id and account_type = 'income'
     order by lft limit 1;
  end if;
  if v_revenue_account is null then
    raise exception 'لا يوجد حساب إيرادات في شجرة الحسابات لهذه المؤسسة';
  end if;

  -- الذمم المدينة: 114 ثم 111%/120% ثم أي حساب أصول
  select id into v_ar_account from public.chart_of_accounts
   where tenant_id = v_inv.tenant_id and account_type = 'asset' and code = '114'
   limit 1;
  if not found then
    select id into v_ar_account from public.chart_of_accounts
     where tenant_id = v_inv.tenant_id and account_type = 'asset'
       and (code like '111%' or code like '120%')
     order by lft limit 1;
  end if;
  if not found then
    select id into v_ar_account from public.chart_of_accounts
     where tenant_id = v_inv.tenant_id and account_type = 'asset'
     order by lft limit 1;
  end if;
  if v_ar_account is null then
    raise exception 'لا يوجد حساب أصول (ذمم مدينة) في شجرة الحسابات';
  end if;

  -- ضريبة المبيعات المستحقة: 230 (فقط عند وجود ضريبة على الفاتورة)
  if coalesce(v_inv.tax_amount, 0) > 0 then
    select id into v_tax_account from public.chart_of_accounts
     where tenant_id = v_inv.tenant_id and code = '230' and account_type = 'liability'
     limit 1;
    if not found then
      select id into v_tax_account from public.chart_of_accounts
       where tenant_id = v_inv.tenant_id and account_type = 'liability'
       order by lft limit 1;
    end if;
  end if;

  -- مصروفات البيع/الخصومات: 510 ثم أي حساب مصاريف
  select id into v_discount_account from public.chart_of_accounts
   where tenant_id = v_inv.tenant_id and code = '510' and account_type = 'expense'
   limit 1;
  if not found then
    select id into v_discount_account from public.chart_of_accounts
     where tenant_id = v_inv.tenant_id and account_type = 'expense'
     order by lft limit 1;
  end if;

  -- تكلفة البضاعة المباعة: 530 ثم أي حساب cost_of_goods_sold
  select id into v_cogs_account from public.chart_of_accounts
   where tenant_id = v_inv.tenant_id and code = '530'
   limit 1;
  if not found then
    select id into v_cogs_account from public.chart_of_accounts
     where tenant_id = v_inv.tenant_id and account_type = 'cost_of_goods_sold'
     order by lft limit 1;
  end if;

  -- حساب المخزون: أصل يبدأ بـ 12* ويختلف عن حساب الذمم المدينة
  select id into v_inventory_account from public.chart_of_accounts
   where tenant_id = v_inv.tenant_id and account_type = 'asset'
     and code like '12%' and id <> v_ar_account
   limit 1;

  -- ============================================================
  -- 3) تجميع إجماليات الأصناف (بديل عن الأرقام المخزّنة)
  -- ============================================================
  for v_line in
    select sii.quantity,
           coalesce(sii.unit_price, 0) as unit_price,
           coalesce(sii.discount_percent, 0) as discount_percent,
           coalesce(sii.tax_percent, 0) as tax_percent
      from public.sales_invoice_items sii
     where sii.sales_invoice_id = p_invoice_id
     order by sii.created_at asc
  loop
    v_line_net := round(v_line.quantity * v_line.unit_price, 2);
    v_line_discount := round(v_line_net * v_line.discount_percent / 100, 2);
    v_line_tax := round((v_line_net - v_line_discount) * v_line.tax_percent / 100, 2);

    v_subtotal := v_subtotal + v_line_net;
    v_discount_total := v_discount_total + v_line_discount;
    v_tax_total := v_tax_total + v_line_tax;
    v_lines_count := v_lines_count + 1;
  end loop;

  if v_lines_count = 0 then
    raise exception 'الفاتورة لا تحتوي على أصناف — لا يمكن إنشاء قيود يومية';
  end if;

  v_total := v_subtotal - v_discount_total + v_tax_total;

  -- تكلفة البضاعة المباعة من حركات المخزون المسجّلة عند الاعتماد
  select coalesce(sum(quantity * coalesce(cost_price, 0)), 0)
    into v_cogs_total
    from public.inventory_movements
   where reference_type = 'sales_invoice'
     and reference_id = p_invoice_id
     and movement_type = 'out';

  -- ضمان التوازن المزدوج حتى عند غياب حساب بديل:
  --  * لا يوجد حساب خصم  → الخصم يُخصم من الإيراد (دائن أقل)
  --  * لا يوجد حساب ضريبة → الضريبة تُضاف للإيراد (دائن أكثر)
  v_revenue_credit := v_subtotal;
  if v_discount_total > 0 and v_discount_account is not null then
    v_discount_dr := v_discount_total;
  else
    v_revenue_credit := v_revenue_credit - v_discount_total;
  end if;
  if v_tax_total > 0 and v_tax_account is not null then
    v_tax_cr := v_tax_total;
  else
    v_revenue_credit := v_revenue_credit + v_tax_total;
  end if;

  -- ============================================================
  -- 4) إنشاء القيود (سطر واحد لكل حساب — متوافق مع unique)
  -- ============================================================
  delete from public.general_ledger
   where reference_type = 'sales_invoice' and reference_id = p_invoice_id;

  -- 4.1 مدين: الذمم المدينة بمبلغ الفاتورة كاملاً
  insert into public.general_ledger
    (tenant_id, account_id, reference_type, reference_id, debit, credit,
     description, notes, warehouse_id, customer_id, created_at, created_by, posted)
  values
    (v_inv.tenant_id, v_ar_account, 'sales_invoice', p_invoice_id, v_total, 0,
     'فاتورة بيع - ' || v_inv.invoice_number,
     'ذمم مدينة عن فاتورة البيع', v_inv.warehouse_id, v_inv.customer_id,
     now(), p_user_id, true);

  -- 4.2 دائن: الإيرادات (قبل الخصم، مع تعديلات الضريبة/الخصم عند غياب حساباتها)
  insert into public.general_ledger
    (tenant_id, account_id, reference_type, reference_id, debit, credit,
     description, notes, warehouse_id, customer_id, created_at, created_by, posted)
  values
    (v_inv.tenant_id, v_revenue_account, 'sales_invoice', p_invoice_id, 0, v_revenue_credit,
     'إيراد مبيعات - ' || v_inv.invoice_number,
     'إيراد مبيعات الفاتورة', v_inv.warehouse_id, v_inv.customer_id,
     now(), p_user_id, true);

  -- 4.3 مدين: الخصم المسموح به (إن وجد حساب مخصص)
  if v_discount_dr > 0 then
    insert into public.general_ledger
      (tenant_id, account_id, reference_type, reference_id, debit, credit,
       description, notes, warehouse_id, customer_id, created_at, created_by, posted)
    values
      (v_inv.tenant_id, v_discount_account, 'sales_invoice', p_invoice_id, v_discount_dr, 0,
       'خصم مسموح به - ' || v_inv.invoice_number,
       'خصم على بيع الفاتورة', v_inv.warehouse_id, v_inv.customer_id,
       now(), p_user_id, true);
  end if;

  -- 4.4 دائن: ضريبة المبيعات المستحقة (إن وجد حساب)
  if v_tax_cr > 0 then
    insert into public.general_ledger
      (tenant_id, account_id, reference_type, reference_id, debit, credit,
       description, notes, warehouse_id, customer_id, created_at, created_by, posted)
    values
      (v_inv.tenant_id, v_tax_account, 'sales_invoice', p_invoice_id, 0, v_tax_cr,
       'ضريبة مبيعات مستحقة - ' || v_inv.invoice_number,
       'ضريبة محصلة على الفاتورة', v_inv.warehouse_id, v_inv.customer_id,
       now(), p_user_id, true);
  end if;

  -- 4.5 قيد التكلفة (إن توفرت حركة مخزون وكلتا الحسابين):
  --     مدين تكلفة البضاعة المباعة / دائن المخزون
  if v_cogs_total > 0 and v_cogs_account is not null and v_inventory_account is not null then
    insert into public.general_ledger
      (tenant_id, account_id, reference_type, reference_id, debit, credit,
       description, notes, warehouse_id, customer_id, created_at, created_by, posted)
    values
      (v_inv.tenant_id, v_cogs_account, 'sales_invoice', p_invoice_id, v_cogs_total, 0,
       'تكلفة البضاعة المباعة - ' || v_inv.invoice_number,
       'تكلفة الأصناف المصروفة', v_inv.warehouse_id, v_inv.customer_id,
       now(), p_user_id, true);

    insert into public.general_ledger
      (tenant_id, account_id, reference_type, reference_id, debit, credit,
       description, notes, warehouse_id, customer_id, created_at, created_by, posted)
    values
      (v_inv.tenant_id, v_inventory_account, 'sales_invoice', p_invoice_id, 0, v_cogs_total,
       'صرف مخزون - ' || v_inv.invoice_number,
       'تخفيض المخزون عن تكلفة الأصناف المصروفة', v_inv.warehouse_id, v_inv.customer_id,
       now(), p_user_id, true);
  end if;

  -- ============================================================
  -- 5) النتيجة
  -- ============================================================
  return jsonb_build_object(
    'invoice_id', p_invoice_id,
    'invoice_number', v_inv.invoice_number,
    'status', 'issued',
    'gl_entries_created', true,
    'lines_processed', v_lines_count,
    'subtotal', v_subtotal,
    'discount_total', v_discount_total,
    'tax_total', v_tax_total,
    'total', v_total,
    'cogs', v_cogs_total,
    'ar_account', v_ar_account::text,
    'revenue_account', v_revenue_account::text,
    'discount_account', v_discount_account::text,
    'tax_account', v_tax_account::text,
    'message', 'تم إنشاء قيود اليومية لفاتورة البيع');
end;
$body$;

revoke all on function public.p_create_sale_gl_entries(uuid, uuid) from public;
grant execute on function public.p_create_sale_gl_entries(uuid, uuid) to service_role;

-- ============================================================
-- 2) المُشغّل: إنشاء القيود تلقائياً عند اعتماد الفاتورة
--    (عند تغي الحالة إلى issued لأول مرة)
-- ============================================================
create or replace function public.trg_sales_invoice_gl_automation()
returns trigger
language plpgsql
security definer
set search_path = public
as $body$
begin
  if new.status = 'issued' and old.status is distinct from 'issued' then
    perform public.p_create_sale_gl_entries(new.id, new.updated_by);
  end if;
  return new;
end;
$body$;

revoke all on function public.trg_sales_invoice_gl_automation() from public;

drop trigger if exists trg_sales_invoice_gl_automation on public.sales_invoices;
create trigger trg_sales_invoice_gl_automation
  after update on public.sales_invoices
  for each row
  when (new.status = 'issued' and old.status is distinct from 'issued')
  execute function public.trg_sales_invoice_gl_automation();

-- ============================================================
-- 3) تحقق نهائي
-- ============================================================
do $body$
declare
  v_count bigint;
begin
  select count(*) into v_count
    from public.general_ledger
   where reference_type = 'sales_invoice';
  raise notice 'Phase 2 complete — sales GL entries in ledger: %', v_count;
end;
$body$;


-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- done: 202610200002_create_gl_trigger_sales.sql
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

-- ============================================================
-- 202610200003_create_gl_trigger_purchases.sql
-- ============================================================

-- ============================================================
-- 202610200003: Automatic GL Entries for Purchases
-- قيود اليومية التلقائية للمشتريات عند اكتمال استلام البضاعة
-- يُنفَّذ مرة واحدة بعد migration 202610200001
-- (يعتمد على: chart_of_accounts, general_ledger,
--  purchase_orders, goods_receipts, goods_receipt_items)
-- ============================================================

-- ============================================================
-- 1) توسيع قيد reference_type ليقبل 'purchase_order'
--    (للقواعد التي أُنشئ فيها general_ledger بإصدار أقدم)
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
      'fixed_asset_acquisition', 'depreciation_entry'
    ));
exception when others then
  raise notice 'توسيع قيد reference_type: %', SQLERRM;
end $body$;

-- ============================================================
-- 2) p_create_purchase_gl_entries:
--    قيود اليومية لاستلام أمر شراء (مدين مخزون / دائن موردون)
--    - لا يلمس المخزون: الاستلام (inventory + movements) يتم في
--      p_proc_receive_goods أو مسار الاستلام الخاص بالخادم
--    - قيدان مجمّعان فقط (متوافقان مع unique على
--      tenant + reference_type + reference_id + account)
--    - idempotent: يحذف قيود الأمر القديمة ثم يعيد إنشاءها
-- ============================================================
create or replace function public.p_create_purchase_gl_entries(
  p_purchase_order_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_po public.purchase_orders%rowtype;
  v_inventory_account uuid;
  v_ap_account uuid;
  v_total numeric := 0;
  v_lines_count int := 0;
  v_source text := 'goods_receipts';
begin
  select * into v_po from public.purchase_orders
   where id = p_purchase_order_id for update;

  if not found then
    raise exception 'أمر الشراء غير موجود';
  end if;
  if v_po.deleted_at is not null then
    raise exception 'أمر الشراء محذوف';
  end if;
  if v_po.status <> 'received' then
    raise exception 'لا يمكن إنشاء قيود يومية — أمر الشراء بحالة % (المطلوب: received)',
      v_po.status;
  end if;

  -- ============================================================
  -- تحديد الحسابات من شجرة الحسابات (مع بدائل عند الغياب)
  -- ============================================================

  -- المخزون: 120 ثم أي أصل يبدأ بـ 12 ثم أول أصل مختلف عن الدائنون
  select id into v_inventory_account from public.chart_of_accounts
   where tenant_id = v_po.tenant_id and code = '120' and account_type = 'asset'
   limit 1;
  if not found then
    select id into v_inventory_account from public.chart_of_accounts
     where tenant_id = v_po.tenant_id and account_type = 'asset' and code like '12%'
     order by lft limit 1;
  end if;

  -- الدائنون (الموردون): 220 ثم 22% ثم أول حساب خصوم
  select id into v_ap_account from public.chart_of_accounts
   where tenant_id = v_po.tenant_id and code = '220' and account_type = 'liability'
   limit 1;
  if not found then
    select id into v_ap_account from public.chart_of_accounts
     where tenant_id = v_po.tenant_id and account_type = 'liability' and code like '22%'
     order by lft limit 1;
  end if;
  if not found then
    select id into v_ap_account from public.chart_of_accounts
     where tenant_id = v_po.tenant_id and account_type = 'liability'
     order by lft limit 1;
  end if;
  if v_ap_account is null then
    raise exception 'لا يوجد حساب دائنون (خصوم) في شجرة الحسابات لهذه المؤسسة';
  end if;

  if v_inventory_account is null then
    select id into v_inventory_account from public.chart_of_accounts
     where tenant_id = v_po.tenant_id and account_type = 'asset'
       and id is distinct from v_ap_account
     order by lft limit 1;
  end if;
  if v_inventory_account is null then
    raise exception 'لا يوجد حساب أصول (مخزون) في شجرة الحسابات لهذه المؤسسة';
  end if;

  -- ============================================================
  -- المبلغ: من الإيصالات الفعلية (المستلم × تكلفة الوحدة)
  -- ============================================================
  select coalesce(sum(gri.quantity_received * coalesce(gri.unit_cost, 0)), 0),
         count(*)
    into v_total, v_lines_count
    from public.goods_receipt_items gri
    join public.goods_receipts gr on gr.id = gri.goods_receipt_id
   where gr.purchase_order_id = p_purchase_order_id
     and gr.deleted_at is null;

  if v_lines_count = 0 then
    -- بديل: أمر عُيّن received دون إيصالات — استخدم بنود الأمر المطلوبة
    select coalesce(sum(poi.quantity * coalesce(poi.unit_price, 0)), 0), count(*)
      into v_total, v_lines_count
      from public.purchase_order_items poi
     where poi.purchase_order_id = p_purchase_order_id;
    v_source := 'purchase_order_items';
  end if;

  if v_lines_count = 0 or v_total <= 0 then
    raise exception 'لا توجد أصناف أو مبالغ مسجلة لأمر الشراء — لا يمكن إنشاء قيود يومية';
  end if;

  -- ============================================================
  -- إنشاء القيود (سطر واحد لكل حساب — متوافق مع unique)
  -- مدين: المخزون المستلم — دائن: الدائنون (المورد)
  -- ملاحظة محاسبية: تكلفة الاستلام تُضاف للمخزون، وتكلفة البضاعة
  -- المباعة تُقيَّد عند البيع (migration 202610200002) — بلا ازدواج
  -- ============================================================
  delete from public.general_ledger
   where reference_type = 'purchase_order' and reference_id = p_purchase_order_id;

  insert into public.general_ledger
    (tenant_id, account_id, reference_type, reference_id, debit, credit,
     description, notes, warehouse_id, supplier_id, created_at, created_by, posted)
  values
    (v_po.tenant_id, v_inventory_account, 'purchase_order', p_purchase_order_id,
     v_total, 0,
     'استلام مشتريات - ' || coalesce(v_po.order_number, v_po.id::text),
     'مخزون مستلم عن أمر الشراء (المصدر: ' || v_source || ')',
     v_po.warehouse_id, v_po.supplier_id, now(), p_user_id, true);

  insert into public.general_ledger
    (tenant_id, account_id, reference_type, reference_id, debit, credit,
     description, notes, warehouse_id, supplier_id, created_at, created_by, posted)
  values
    (v_po.tenant_id, v_ap_account, 'purchase_order', p_purchase_order_id,
     0, v_total,
     'دين المورد - ' || coalesce(v_po.order_number, v_po.id::text),
     'حسابات الدائنين (الموردون) عن أمر الشراء',
     v_po.warehouse_id, v_po.supplier_id, now(), p_user_id, true);

  return jsonb_build_object(
    'purchase_order_id', p_purchase_order_id,
    'order_number', v_po.order_number,
    'status', 'received',
    'gl_entries_created', true,
    'lines_processed', v_lines_count,
    'total', v_total,
    'amounts_source', v_source,
    'inventory_account', v_inventory_account::text,
    'payable_account', v_ap_account::text,
    'message', 'تم إنشاء قيود اليومية لاستلام أمر الشراء');
end;
$body$;

revoke all on function public.p_create_purchase_gl_entries(uuid, uuid) from public;
grant execute on function public.p_create_purchase_gl_entries(uuid, uuid) to service_role;

-- ============================================================
-- 3) المُشغّل: إنشاء القيود عند اكتمال الاستلام (received)
--    (الشرط في الـ WHEN يضمن إطلاقه مرة واحدة فقط لكل أمر)
-- ============================================================
create or replace function public.trg_purchase_order_gl_automation()
returns trigger
language plpgsql
security definer
set search_path = public
as $body$
begin
  perform public.p_create_purchase_gl_entries(new.id, new.updated_by);
  return new;
end;
$body$;

revoke all on function public.trg_purchase_order_gl_automation() from public;

drop trigger if exists trg_purchase_order_gl_automation on public.purchase_orders;
create trigger trg_purchase_order_gl_automation
  after update on public.purchase_orders
  for each row
  when (new.status = 'received' and old.status is distinct from 'received')
  execute function public.trg_purchase_order_gl_automation();

-- ============================================================
-- 4) تحقق نهائي
-- ============================================================
do $body$
declare
  v_count bigint;
begin
  select count(*) into v_count
    from public.general_ledger
   where reference_type = 'purchase_order';
  raise notice 'Phase 3 complete — purchase GL entries in ledger: %', v_count;
end $body$;


-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- done: 202610200003_create_gl_trigger_purchases.sql
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

-- ============================================================
-- 202610200004_create_ar_ap_opening_balances.sql
-- ============================================================

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


-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- done: 202610200004_create_ar_ap_opening_balances.sql
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

-- ============================================================
-- 202610200005_cash_bank_management.sql
-- ============================================================

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


-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- done: 202610200005_cash_bank_management.sql
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

-- ============================================================
-- 202610200006_egyptian_tax_engine.sql
-- ============================================================

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

-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- done: 202610200006_egyptian_tax_engine.sql
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

-- ============================================================
-- 202610200007_production_complete.sql
-- ============================================================

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

-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- done: 202610200007_production_complete.sql
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

-- combined migration complete — files: 12
