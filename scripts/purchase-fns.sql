-- ============================================================
-- نظام المشتريات فائق السرعة — دوال خلفية
-- ينفذ مرة واحدة عبر Supabase SQL Editor
-- ============================================================

-- 1) إنشاء أمر شراء مع بنوده (ذرية)
create or replace function public.p_create_purchase_order(
  p_supplier_id uuid,
  p_warehouse_id uuid,
  p_items jsonb,                -- [{product_id, quantity, unit_price, notes}]
  p_notes text default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po_id uuid;
  v_po_number text;
  v_tenant uuid;
  v_item jsonb;
  v_count int := 0;
begin
  -- التحقق الأساسي
  if p_supplier_id is null then raise exception 'مورد مطلوب'; end if;
  if p_warehouse_id is null then raise exception 'مخزن مطلوب'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'يجب إدخال بنود الأمر';
  end if;

  -- السياق: ت 그대로 tenant_id و warehouse_id من الجداول الموجودة
  select w.tenant_id into v_tenant
    from public.warehouses w
   where w.id = p_warehouse_id
   limit 1;
  if v_tenant is null then raise exception 'المخزن غير موجود'; end if;

  -- إنشاء أمر الشراء
  insert into public.purchase_orders (tenant_id, supplier_id, warehouse_id, order_number, order_date, status, notes, created_by)
  values (v_tenant, p_supplier_id, p_warehouse_id,
          'PO-CONC-' || to_char(now(), 'YYYYMMDD') || '-' || to_char(nextval('public.purchase_orders_id_seq'), 'FM000000'),
          current_date, 'pending', p_notes, p_user_id)
  returning id, order_number into v_po_id, v_po_number;

  -- إدراج بنود الأمر
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.purchase_order_items (purchase_order_id, product_id, quantity, unit_price, subtotal, notes)
    values (v_po_id,
            (v_item->>'product_id')::uuid,
            (v_item->>'quantity')::numeric,
            (v_item->>'unit_price')::numeric,
            (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric,
            v_item->>'notes')
    returning id into strict v_count;  -- نريد عدد insertات ليس id
    v_count := v_count + 1;
  end loop;

  -- تحديث الإجمالي
  update public.purchase_orders
     set subtotal = (select coalesce(sum(subtotal),0) from public.purchase_order_items where purchase_order_id = v_po_id),
         total_amount = (select coalesce(sum(subtotal),0) from public.purchase_order_items where purchase_order_id = v_po_id),
         updated_at = now(), updated_by = p_user_id
   where id = v_po_id;

  return jsonb_build_object(
    'purchase_order_id', v_po_id,
    'order_number', v_po_number,
    'items_created', jsonb_array_length(p_items),
    'supplier_id', p_supplier_id,
    'warehouse_id', p_warehouse_id,
    'status', 'pending',
    'total_amount', (select coalesce(sum(subtotal),0) from public.purchase_order_items where purchase_order_id = v_po_id)
  );
end;
$$;

revoke all on function public.p_create_purchase_order(uuid, uuid, jsonb, text, uuid) from public;
grant execute on function public.p_create_purchase_order(uuid, uuid, jsonb, text, uuid) to service_role;

-- 2) استلام بضائع من أمر شراء (يستخدم existing warehouse)
create or replace function public.p_receive_purchase_order(
  p_purchase_order_id uuid,
  p_items jsonb,                -- [{product_id, quantity, batch_number, expiry_date, unit_cost, notes}]
  p_user_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_wh uuid;
  v_tenant uuid;
  v_receipt_id uuid;
  v_receipt_number text;
  v_item jsonb;
  v_product uuid;
  v_remaining numeric;
begin
  select * into v_po from public.purchase_orders where id = p_purchase_order_id for update;
  if not found then raise exception 'أمر الشراء غير موجود'; end if;
  if v_po.deleted_at is not null then raise exception 'أمر الشراء محذوف'; end if;
  if v_po.status not in ('pending','approved','ordered','sent','partially_received') then
    raise exception 'لا يمكن استلام أمر بحالة %', v_po.status;
  end if;

  v_wh := v_po.warehouse_id;
  v_tenant := v_po.tenant_id;

  -- إنشاء إيصال استلام
  insert into public.goods_receipts (tenant_id, purchase_order_id, warehouse_id, receipt_number, receipt_date, supplier_id, status, notes, received_by, created_by)
  values (v_tenant, p_purchase_order_id, v_wh,
          'GR-' || coalesce(v_po.order_number, 'PO') || '-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.goods_receipts_id_seq')::text, 7, '0'),
          current_date, v_po.supplier_id, 'pending', p_notes, p_user_id, p_user_id)
  returning id, receipt_number into v_receipt_id, v_receipt_number;

  -- إضافة بنود الاستلام
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product := (v_item->>'product_id')::uuid;

    -- التحقق: هل هذا المنتج موجود في أمر الشراء؟
    select quantity into v_remaining from public.purchase_order_items
     where purchase_order_id = p_purchase_order_id and product_id = v_product
     limit 1;
    if v_remaining is null then
      raise exception 'المنتج % غير موجود في أمر الشراء', v_product;
    end if;

    insert into public.goods_receipt_items (goods_receipt_id, product_id, batch_number, expiry_date, quantity, quantity_ordered, quantity_received, unit_cost, cost_price, notes)
    values (v_receipt_id, v_product,
            v_item->>'batch_number',
            (v_item->>'expiry_date')::date,
            (v_item->>'quantity')::numeric,
            v_remaining,
            (v_item->>'quantity')::numeric,
            (v_item->>'unit_cost')::numeric,
            (v_item->>'unit_cost')::numeric,
            v_item->>'notes');

    -- تحديث حالة استلام بند الأمر الشراء
    update public.purchase_order_items
       set received_quantity = received_quantity + (v_item->>'quantity')::numeric,
           updated_at = now()
     where purchase_order_id = p_purchase_order_id and product_id = v_product;

    -- تحديث المخزون (inventory = التشغيلة)
    insert into public.inventory (tenant_id, warehouse_id, product_id, batch_number, expiry_date, quantity, available_quantity, unit_cost, cost_price, supplier_id, created_by)
    values (v_tenant, v_wh, v_product,
            v_item->>'batch_number',
            (v_item->>'expiry_date')::date,
            (v_item->>'quantity')::numeric,
            (v_item->>'quantity')::numeric,
            (v_item->>'unit_cost')::numeric,
            (v_item->>'unit_cost')::numeric,
            v_po.supplier_id,
            p_user_id)
    on conflict (warehouse_id, product_id, batch_number) do update
      set quantity = inventory.quantity + excluded.quantity,
          available_quantity = inventory.available_quantity + excluded.available_quantity,
          unit_cost = excluded.unit_cost,
          cost_price = excluded.cost_price,
          updated_at = now();
  end loop;

  -- تحديث حالة أمر الشراء
  if (select count(*) from public.purchase_order_items where purchase_order_id = p_purchase_order_id and received_quantity >= quantity) =
     (select count(*) from public.purchase_order_items where purchase_order_id = p_purchase_order_id) then
    update public.purchase_orders set status = 'received', updated_at = now(), updated_by = p_user_id where id = p_purchase_order_id;
  else
    update public.purchase_orders set status = 'partially_received', updated_at = now(), updated_by = p_user_id where id = p_purchase_order_id;
  end if;

  return jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'purchase_order_status', (select status from public.purchase_orders where id = p_purchase_order_id),
    'items_received', jsonb_array_length(p_items)
  );
end;
$$;

revoke all on function public.p_receive_purchase_order(uuid, jsonb, uuid, text) from public;
grant execute on function public.p_receive_purchase_order(uuid, jsonb, uuid, text) to service_role;

-- 3) البحث عن صنف بالباركود أو الاسم أو الرقم
create or replace function public.p_search_products(
  p_query text default null,
  p_barcode text default null,
  p_sku text default null,
  p_warehouse_id uuid default null,
  p_limit int default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_barcode is not null then
    return (select jsonb_agg(t) from (
      select id, name, name_ar, scientific_name, barcode, sku, dosage_form, strength, unit_of_measure,
             min_stock_level, max_stock_level, reorder_point, selling_price, is_active
        from public.products
       where (p_warehouse_id is null or warehouse_id = p_warehouse_id)
         and barcode = p_barcode
         and is_active
       order by name
       limit p_limit
    ) t);
  end if;

  if p_sku is not null then
    return (select jsonb_agg(t) from (
      select id, name, name_ar, scientific_name, barcode, sku, dosage_form, strength, unit_of_measure,
             min_stock_level, max_stock_level, reorder_point, selling_price, is_active
        from public.products
       where (p_warehouse_id is null or warehouse_id = p_warehouse_id)
         and sku = p_sku
         and is_active
       order by name
       limit p_limit
    ) t);
  end if;

  -- بحث بالنص (الاسم أو الاسم العلمي أو الباركود أو SKU)
  return (select jsonb_agg(t) from (
    select id, name, name_ar, scientific_name, barcode, sku, dosage_form, strength, unit_of_measure,
           min_stock_level, max_stock_level, reorder_point, selling_price, is_active
      from public.products
     where (p_warehouse_id is null or warehouse_id = p_warehouse_id)
       and is_active
       and (
         name_ilike(p_query) or
         name_ar_ilike(p_query) or
         scientific_name_ilike(p_query) or
         barcode ilike p_query or
         sku ilike p_query
       )
     order by
       case when name = p_query then 0 else 1 end,
       case when name like p_query || '%' then 0 else 1 end,
       name
     limit p_limit
  ) t);
end;
$$;

-- help functions for ilike
create or replace function public.name_ilike(p_text text)
returns boolean language sql immutable as $$ select $1 ilike '%' || $2 || '%' $$;
create or replace function public.name_ar_ilike(p_text text)
returns boolean language sql immutable as $$ select $1 ilike '%' || $2 || '%' $$;
create or replace function public.scientific_name_ilike(p_text text)
returns boolean language sql immutable as $$ select $1 ilike '%' || $2 || '%' $$;

revoke all on function public.p_search_products(text, text, text, uuid, int) from public;
grant execute on function public.p_search_products(text, text, text, uuid, int) to service_role;

-- 4) آخر سعر شراء لمنتج
create or replace function public.p_last_purchase_price(p_product_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price numeric;
begin
  select unit_cost into v_price
    from public.inventory
   where product_id = p_product_id
   order by created_at desc
   limit 1;
  return v_price;
end;
$$;

revoke all on function public.p_last_purchase_price(uuid) from public;
grant execute on function public.p_last_purchase_price(uuid) to service_role;

-- 5) قائمة الموردين النشطين
create or replace function public.p_active_suppliers(p_warehouse_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return (select jsonb_agg(t) from (
    select id, name, name_ar, code, phone, email, payment_terms, credit_limit, is_active
      from public.suppliers
     where (p_warehouse_id is null or warehouse_id = p_warehouse_id)
       and is_active
     order by name
  ) t);
end;
$$;

revoke all on function public.p_active_suppliers(uuid) from public;
grant execute on function public.p_active_suppliers(uuid) to service_role;
