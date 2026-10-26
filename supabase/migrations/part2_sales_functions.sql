-- part2_sales_functions.sql — الجزء 2 من 3: الدوال الذرية (يُنفَّذ بعد part1)
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

