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
