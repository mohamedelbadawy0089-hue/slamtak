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
