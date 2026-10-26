-- =====================================================================================
-- المرحلة 1 — الاستلام والمخزون (Receiving & Inventory)
-- Enterprise Warehouse Operations Management System
-- =====================================================================================
-- 1) إصلاح تقسيم سجل الحركات inventory_movements (كان يرفض أي حركة بعد 2025-06)
-- 2) سجل حركات غير قابل للتعديل/الحذف (append-only ledger)
-- 3) أعمدة حالات المخزون + قيود التوازن والسالب
-- 4) دورة مستند الاستلام: إنشاء → بنود → ترحيل ذري → إلغاء
-- 5) تحقق خادمي للصلاحيات (tenant/warehouse) + عزل على مستوى قاعدة البيانات
-- =====================================================================================
-- الملف مصمم ليعيد تشغيله بأمان (idempotent) ويُختبر داخل معاملة ثم ROLLBACK قبل التطبيق.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1) إصلاح تقسيم سجل الحركات: أقسام شهرية للأيام الحالية والقادمة + قسم افتراضي
-- -------------------------------------------------------------------------------------
do $wms_partitions$
declare
  d date;
  m text;
  has_default boolean;
begin
  for i in 0..24 loop
    d := date_trunc('month', now())::date + make_interval(months => i);
    m := to_char(d, 'YYYY_MM');
    if not exists (
      select 1
        from pg_inherits ih
        join pg_class c on c.oid = ih.inhrelid
       where ih.inhparent = 'public.inventory_movements'::regclass
         and c.relname = 'inventory_movements_' || m
    ) then
      execute format(
        'create table if not exists public.inventory_movements_%s partition of public.inventory_movements for values from (%L) to (%L)',
        m, d, (d + interval '1 month')::date
      );
    end if;
  end loop;

  select exists (
    select 1
      from pg_inherits ih
      join pg_class c on c.oid = ih.inhrelid
     where ih.inhparent = 'public.inventory_movements'::regclass
       and pg_get_expr(c.relpartbound, c.oid) like '%DEFAULT%'
  ) into has_default;

  if not has_default then
    execute 'create table if not exists public.inventory_movements_default partition of public.inventory_movements default';
  end if;
end $wms_partitions$;

-- -------------------------------------------------------------------------------------
-- 2) سجل الحركات غير قابل للتعديل أو الحذف المباشر (التصحيح عبر مستند عكسي فقط)
-- -------------------------------------------------------------------------------------
create or replace function public.wms_ledger_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'سجل حركات المخزون غير قابل للإفراغ (append-only)';
  end if;
  raise exception 'سجل حركات المخزون غير قابل للتعديل — التصحيح يتم بمستند عكسي موثق (الحركة %)', old.id;
end;
$$;

drop trigger if exists inventory_movements_no_mutation on public.inventory_movements;
create trigger inventory_movements_no_mutation
  before update or delete on public.inventory_movements
  for each row execute function public.wms_ledger_immutable();

drop trigger if exists inventory_movements_no_truncate on public.inventory_movements;
create trigger inventory_movements_no_truncate
  before truncate on public.inventory_movements
  for each statement execute function public.wms_ledger_immutable();

-- -------------------------------------------------------------------------------------
-- 3) أعمدة حالات المخزون + قيود السلامة
--    quantity = المتاح + المحجوز + المخصص للتجهيز + تحت الفحص + التالف + المنتهي
-- -------------------------------------------------------------------------------------
alter table public.inventory add column if not exists staging_quantity   integer not null default 0;
alter table public.inventory add column if not exists quarantine_quantity integer not null default 0;

do $wms_constraints$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'ck_inventory_bucket_balance' and conrelid = 'public.inventory'::regclass
  ) then
    alter table public.inventory add constraint ck_inventory_bucket_balance check (
      quantity            >= 0 and
      available_quantity  >= 0 and
      reserved_quantity   >= 0 and
      staging_quantity    >= 0 and
      quarantine_quantity >= 0 and
      damaged_quantity    >= 0 and
      expired_quantity    >= 0 and
      (coalesce(available_quantity,0) + coalesce(reserved_quantity,0) + coalesce(staging_quantity,0)
       + coalesce(quarantine_quantity,0) + coalesce(damaged_quantity,0) + coalesce(expired_quantity,0)) = quantity
    );
  end if;
end $wms_constraints$;

-- -------------------------------------------------------------------------------------
-- 4) مستند الاستلام: حالات الترحيل والتواريخ
-- -------------------------------------------------------------------------------------
alter table public.goods_receipts add column if not exists posted_at timestamptz;
alter table public.goods_receipts add column if not exists posted_by uuid;
alter table public.goods_receipts alter column status set default 'draft';

do $wms_gr_constraints$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'ck_goods_receipts_status' and conrelid = 'public.goods_receipts'::regclass
  ) then
    alter table public.goods_receipts add constraint ck_goods_receipts_status check (
      status in ('draft','pending_review','posted','received','cancelled')
    );
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'ck_goods_receipt_items_qty' and conrelid = 'public.goods_receipt_items'::regclass
  ) then
    alter table public.goods_receipt_items add constraint ck_goods_receipt_items_qty check (
      coalesce(quantity,0)         >= 0 and
      coalesce(quantity_ordered,0) >= 0 and
      coalesce(quantity_received,0) >= 0 and
      coalesce(quantity_damaged,0) >= 0 and
      coalesce(unit_cost,0)        >= 0
    );
  end if;
end $wms_gr_constraints$;

create index if not exists ix_goods_receipts_wh_status
  on public.goods_receipts (warehouse_id, status, receipt_date desc);
create index if not exists ix_goods_receipts_open_po
  on public.goods_receipts (purchase_order_id) where status = 'draft';
create index if not exists ix_inventory_stock_buckets
  on public.inventory (warehouse_id, product_id, expiry_date);
create index if not exists ix_purchase_order_items_po
  on public.purchase_order_items (purchase_order_id, product_id);

-- -------------------------------------------------------------------------------------
-- 5) سياق المستخدم/المخزن (Server-side context) — يُستخدم داخل السياسات والدوال
-- -------------------------------------------------------------------------------------
create or replace function public.wms_ctx_warehouse_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is not null then (
      select uw.warehouse_id from public.user_warehouses uw
       where uw.user_id = auth.uid()
       order by uw.is_default desc nulls last
       limit 1
    )
    else nullif(current_setting('app.current_warehouse_id', true), '')::uuid
  end;
$$;

create or replace function public.wms_ctx_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is not null then (
      select coalesce(
        (select w.tenant_id from public.warehouses w
           where w.id = public.wms_ctx_warehouse_id() limit 1),
        (select uw.tenant_id from public.user_warehouses uw where uw.user_id = auth.uid() limit 1)
      )
    )
    else nullif(current_setting('app.current_tenant_id', true), '')::uuid
  end;
$$;

create or replace function public.wms_ctx_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.role from public.profiles p where p.id = auth.uid()),
    'employee'
  );
$$;

-- تحقق خادمي: المستخدم مخوّل على المخزن (عضو user_warehouses أو مدير المخزن أو super-admin)
create or replace function public.wms_assert_user_warehouse(p_user_id uuid, p_warehouse_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null or p_warehouse_id is null then
    raise exception 'بيانات المستخدم أو المخزن مفقودة';
  end if;

  if exists (
    select 1 from public.user_warehouses uw
     where uw.user_id = p_user_id and uw.warehouse_id = p_warehouse_id
  ) then
    return;
  end if;

  if exists (
    select 1 from public.warehouses w where w.id = p_warehouse_id and w.manager_id = p_user_id
  ) then
    return;
  end if;

  if exists (
    select 1 from public.profiles p where p.id = p_user_id and p.role = 'super_admin'
  ) then
    return;
  end if;

  raise exception 'ليس لديك صلاحية لهذا المخزن';
end;
$$;

-- المستخدم الحالي (من JWT إن وُجد، وإلا من المعامل/service role)
create or replace function public.wms_current_user(p_user_id uuid default null)
returns uuid
language sql
stable
as $$
  select coalesce(auth.uid(), p_user_id);
$$;

-- -------------------------------------------------------------------------------------
-- 6) سياسات RLS: عزل المخزن مع رجوع إلى هوية المستخدم (بدل GUC فقط)
--    (تُطبق على جداول وحدتي الاستلام والمخزون)
-- -------------------------------------------------------------------------------------
do $wms_policies$
declare
  t text;
  v_parent text;
  v_prefix text;
begin
  -- جداول بها عمودا مخزن/مؤسسة مباشرة
  foreach t in array array[
    'inventory', 'inventory_movements', 'goods_receipts',
    'products', 'purchase_orders'
  ] loop
    execute format('drop policy if exists "app_warehouse_scope" on public.%I', t);
    execute format($p$
      create policy "app_warehouse_scope" on public.%I
      for all to authenticated
      using (
        warehouse_id = public.wms_ctx_warehouse_id()
        or public.wms_ctx_role() = 'super_admin'
      )
      with check (
        (
          warehouse_id = public.wms_ctx_warehouse_id()
          or public.wms_ctx_role() = 'super_admin'
        )
        and (
          tenant_id = public.wms_ctx_tenant_id()
          or public.wms_ctx_role() = 'super_admin'
        )
      )
    $p$, t);
  end loop;

  -- جداول بنود مرتبطة بمستند الأب (بنود الاستلام / بنود أمر الشراء)
  foreach t in array array['goods_receipt_items', 'purchase_order_items'] loop
    v_parent := case when t = 'goods_receipt_items' then 'goods_receipts' else 'purchase_orders' end;
    v_prefix := case when t = 'goods_receipt_items' then 'goods_receipt' else 'purchase_order' end;
    execute format('drop policy if exists "app_document_scope" on public.%I', t);
    execute format($c$
      create policy "app_document_scope" on public.%I
      for all to authenticated
      using (
        exists (
          select 1 from public.%I d
           where d.id = %I.%s_id
             and (
               d.warehouse_id = public.wms_ctx_warehouse_id()
               or public.wms_ctx_role() = 'super_admin'
             )
        )
      )
      with check (
        exists (
          select 1 from public.%I d
           where d.id = %I.%s_id
             and (
               d.warehouse_id = public.wms_ctx_warehouse_id()
               or public.wms_ctx_role() = 'super_admin'
             )
             and (
               d.tenant_id = public.wms_ctx_tenant_id()
               or public.wms_ctx_role() = 'super_admin'
             )
        )
      )
    $c$, t, v_parent, t, v_prefix, v_parent, t, v_prefix);
  end loop;
end $wms_policies$;

-- -------------------------------------------------------------------------------------
-- 7) تسلسل أرقام مستندات الاستلام
-- -------------------------------------------------------------------------------------
create sequence if not exists public.wms_receipt_seq;

create or replace function public.wms_gr_next_number(p_warehouse_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
begin
  select coalesce(nullif(trim(w.code), ''), 'WH') into v_code
    from public.warehouses w where w.id = p_warehouse_id;
  return 'GR-' || coalesce(v_code, 'WH') || '-' || to_char(now(), 'YYYYMM') || '-'
       || lpad(nextval('public.wms_receipt_seq')::text, 7, '0');
end;
$$;

-- -------------------------------------------------------------------------------------
-- 8) بنود الاستلام: تحقق ضد أمر الشراء (تجميع لكل صنف + منع التجاوز)
-- -------------------------------------------------------------------------------------
create or replace function public.wms_gr_apply_items(
  p_receipt_id uuid,
  p_purchase_order_id uuid,
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_product uuid;
  v_qty integer;
  v_damaged integer;
  v_remaining integer;
  v_batch text;
  v_expiry date;
  v_cost numeric;
  v_allocated jsonb := '{}'::jsonb;
  v_used integer;
  v_count integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'يجب إدخال بنود الاستلام';
  end if;

  delete from public.goods_receipt_items where goods_receipt_id = p_receipt_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product := nullif(trim(coalesce(v_item->>'product_id', '')), '')::uuid;
    if v_product is null then
      raise exception 'بند استلام بدون صنف صحيح';
    end if;

    if not exists (
      select 1 from public.purchase_order_items poi
       where poi.purchase_order_id = p_purchase_order_id and poi.product_id = v_product
    ) then
      raise exception 'الصنف غير موجود في أمر الشراء';
    end if;

    v_batch := nullif(trim(coalesce(v_item->>'batch_number', '')), '');
    if v_batch is null then
      raise exception 'رقم التشغيلة (Batch) مطلوب لكل بنود الاستلام';
    end if;

    begin
      v_expiry := nullif(trim(coalesce(v_item->>'expiry_date', '')), '')::date;
    exception when invalid_text_representation then
      raise exception 'تاريخ صلاحية غير صحيح';
    end;
    if v_expiry is null then
      raise exception 'تاريخ الصلاحية مطلوب لكل بنود الاستلام';
    end if;
    if v_expiry < current_date then
      raise exception 'لا يمكن استلام دفعة منتهية الصلاحية (%)', v_expiry;
    end if;

    v_qty := coalesce(nullif(v_item->>'quantity', '')::integer, 0);
    if v_qty <= 0 then
      raise exception 'كمية غير صحيحة — يجب أن تكون أكبر من صفر';
    end if;

    v_damaged := coalesce(nullif(v_item->>'quantity_damaged', '')::integer, 0);
    if v_damaged < 0 then
      raise exception 'كمية التالف لا يمكن أن تكون سالبة';
    end if;

    select (poi.quantity - coalesce(poi.received_quantity, 0)) into v_remaining
      from public.purchase_order_items poi
     where poi.purchase_order_id = p_purchase_order_id and poi.product_id = v_product;

    v_used := coalesce((v_allocated ->> v_product::text)::integer, 0);
    if v_used + v_qty > v_remaining then
      raise exception 'الكمية المطلوبة (%) تتجاوز المتبقي في أمر الشراء (%)',
        v_used + v_qty, v_remaining;
    end if;
    v_allocated := jsonb_set(v_allocated, array[v_product::text], to_jsonb(v_used + v_qty), true);

    begin
      v_cost := coalesce(
        nullif(v_item->>'unit_cost', '')::numeric,
        (select poi.unit_price from public.purchase_order_items poi
          where poi.purchase_order_id = p_purchase_order_id and poi.product_id = v_product)
      );
    exception when invalid_text_representation then
      raise exception 'تكلفة الوحدة غير صحيحة';
    end;

    insert into public.goods_receipt_items
      (goods_receipt_id, product_id, batch_number, expiry_date, quantity,
       quantity_ordered, quantity_received, quantity_damaged, unit_cost, cost_price, notes)
    values
      (p_receipt_id, v_product, v_batch, v_expiry, v_qty,
       v_qty, v_qty, v_damaged, coalesce(v_cost, 0), coalesce(v_cost, 0),
       nullif(v_item->>'notes', ''));

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- -------------------------------------------------------------------------------------
-- 9) إنشاء مستند استلام من أمر شراء (حالة: draft)
-- -------------------------------------------------------------------------------------
create or replace function public.wms_gr_create(
  p_purchase_order_id uuid,
  p_items jsonb default null,
  p_notes text default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_user uuid;
  v_receipt_id uuid;
  v_number text;
  v_count integer := 0;
begin
  v_user := public.wms_current_user(p_user_id);
  if v_user is null then
    raise exception 'غير مصرح';
  end if;
  if p_purchase_order_id is null then
    raise exception 'أمر الشراء مطلوب';
  end if;

  select * into v_po from public.purchase_orders where id = p_purchase_order_id for update;
  if not found then
    raise exception 'أمر الشراء غير موجود';
  end if;
  if v_po.deleted_at is not null then
    raise exception 'أمر الشراء محذوف';
  end if;

  perform public.wms_assert_user_warehouse(v_user, v_po.warehouse_id);

  if v_po.status not in ('pending','approved','ordered','sent','partially_received') then
    raise exception 'لا يمكن الاستلام على أمر بحالة «%»', v_po.status;
  end if;

  select id into v_receipt_id
    from public.goods_receipts
   where purchase_order_id = p_purchase_order_id
     and status = 'draft'
     and deleted_at is null
   order by created_at desc
   limit 1;

  if v_receipt_id is null then
    v_number := public.wms_gr_next_number(v_po.warehouse_id);
    insert into public.goods_receipts
      (tenant_id, purchase_order_id, warehouse_id, receipt_number, receipt_date,
       supplier_id, status, notes, received_by, created_by, updated_by)
    values
      (v_po.tenant_id, p_purchase_order_id, v_po.warehouse_id, v_number, current_date,
       v_po.supplier_id, 'draft', p_notes, v_user, v_user, v_user)
    returning id into v_receipt_id;
  elsif p_notes is not null then
    update public.goods_receipts
       set notes = p_notes, updated_by = v_user, updated_at = now()
     where id = v_receipt_id;
  end if;

  if p_items is not null then
    v_count := public.wms_gr_apply_items(v_receipt_id, p_purchase_order_id, p_items);
  end if;

  return jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_number', (select receipt_number from public.goods_receipts where id = v_receipt_id),
    'status', 'draft',
    'items', v_count
  );
end;
$$;

-- -------------------------------------------------------------------------------------
-- 10) تعديل بنود مستند استلام (draft فقط)
-- -------------------------------------------------------------------------------------
create or replace function public.wms_gr_set_items(
  p_receipt_id uuid,
  p_items jsonb,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gr public.goods_receipts%rowtype;
  v_user uuid;
  v_count integer;
begin
  v_user := public.wms_current_user(p_user_id);
  if v_user is null then
    raise exception 'غير مصرح';
  end if;

  select * into v_gr from public.goods_receipts where id = p_receipt_id for update;
  if not found then
    raise exception 'مستند الاستلام غير موجود';
  end if;
  if v_gr.deleted_at is not null then
    raise exception 'مستند الاستلام محذوف';
  end if;

  perform public.wms_assert_user_warehouse(v_user, v_gr.warehouse_id);

  if v_gr.status <> 'draft' then
    raise exception 'لا يمكن تعديل بنود مستند بحالة «%»', v_gr.status;
  end if;
  if v_gr.purchase_order_id is null then
    raise exception 'مستند الاستلام غير مرتبط بأمر شراء';
  end if;

  v_count := public.wms_gr_apply_items(v_gr.id, v_gr.purchase_order_id, p_items);

  update public.goods_receipts
     set updated_by = v_user, updated_at = now()
   where id = v_gr.id;

  return jsonb_build_object('receipt_id', v_gr.id, 'items', v_count, 'status', 'draft');
end;
$$;

-- -------------------------------------------------------------------------------------
-- 11) ترحيل الاستلام — عملية ذرية واحدة (آمنة ضد التزامن والتكرار)
--         قفل المستند FOR UPDATE ← منع الترحيل المزدوج
--         قفل أمر الشراء FOR UPDATE
--         upsert المخزون ON CONFLICT (قفل صف المخزون) ← منع تعارض الطلبات المتزامنة
--         قيد في السجل غير القابل للتعديل مربوط بالمستند والمخزن والتشغيلة
-- -------------------------------------------------------------------------------------
create or replace function public.wms_gr_post(
  p_receipt_id uuid,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gr public.goods_receipts%rowtype;
  v_po public.purchase_orders%rowtype;
  v_user uuid;
  v_item public.goods_receipt_items%rowtype;
  v_qty integer;
  v_lines integer := 0;
  v_total integer := 0;
  v_po_status text := null;
begin
  v_user := public.wms_current_user(p_user_id);
  if v_user is null then
    raise exception 'غير مصرح';
  end if;

  -- (1) قفل المستند: الترحيل المزدوج يستحيل تنافسياً
  select * into v_gr from public.goods_receipts where id = p_receipt_id for update;
  if not found then
    raise exception 'مستند الاستلام غير موجود';
  end if;
  if v_gr.deleted_at is not null then
    raise exception 'مستند الاستلام محذوف';
  end if;

  perform public.wms_assert_user_warehouse(v_user, v_gr.warehouse_id);

  if v_gr.status in ('posted', 'received') then
    raise exception 'تم ترحيل مستند الاستلام % مسبقاً', v_gr.receipt_number;
  end if;
  if v_gr.status = 'cancelled' then
    raise exception 'مستند الاستلام % ملغي', v_gr.receipt_number;
  end if;
  if not exists (select 1 from public.goods_receipt_items where goods_receipt_id = v_gr.id) then
    raise exception 'لا توجد بنود في مستند الاستلام';
  end if;

  -- (2) قفل أمر الشراء ومنع الترحيل على مستندات منتهية/محظورة
  if v_gr.purchase_order_id is not null then
    select * into v_po from public.purchase_orders where id = v_gr.purchase_order_id for update;
    if not found then
      raise exception 'أمر الشراء غير موجود';
    end if;
    if v_po.status in ('received','cancelled','rejected','draft') then
      raise exception 'لا يمكن الترحيل على أمر شراء بحالة «%»', v_po.status;
    end if;
  end if;

  -- (3) ترحيل البنود: مخزون + سجل
  for v_item in
    select * from public.goods_receipt_items
     where goods_receipt_id = v_gr.id
     order by created_at, id
  loop
    v_qty := coalesce(v_item.quantity_received, 0);
    if v_qty <= 0 then
      raise exception 'كمية غير صحيحة لبند الاستلام';
    end if;
    if v_item.expiry_date < current_date then
      raise exception 'لا يمكن استلام دفعة منتهية الصلاحية (%)', v_item.expiry_date;
    end if;

    insert into public.inventory
      (tenant_id, warehouse_id, product_id, batch_number, expiry_date,
       quantity, available_quantity, unit_cost, cost_price, supplier_id,
       created_by, updated_by, is_quarantined, is_expired, is_near_expiry)
    values
      (v_gr.tenant_id, v_gr.warehouse_id, v_item.product_id, v_item.batch_number, v_item.expiry_date,
       v_qty, v_qty, coalesce(v_item.unit_cost, 0), coalesce(v_item.cost_price, v_item.unit_cost, 0),
       v_gr.supplier_id, v_user, v_user, false, false, false)
    on conflict (warehouse_id, product_id, batch_number) do update set
      quantity            = public.inventory.quantity + excluded.quantity,
      available_quantity  = public.inventory.available_quantity + excluded.quantity,
      unit_cost           = case
        when (public.inventory.available_quantity + excluded.available_quantity) = 0 then excluded.unit_cost
        else round((
          (public.inventory.available_quantity * coalesce(public.inventory.unit_cost, 0))
          + (excluded.available_quantity * coalesce(excluded.unit_cost, 0))
        ) / (public.inventory.available_quantity + excluded.available_quantity), 4)
      end,
      cost_price          = case
        when (public.inventory.available_quantity + excluded.available_quantity) = 0 then excluded.cost_price
        else round((
          (public.inventory.available_quantity * coalesce(public.inventory.cost_price, 0))
          + (excluded.available_quantity * coalesce(excluded.cost_price, 0))
        ) / (public.inventory.available_quantity + excluded.available_quantity), 4)
      end,
      expiry_date         = excluded.expiry_date,
      supplier_id         = coalesce(public.inventory.supplier_id, excluded.supplier_id),
      is_expired          = false,
      is_near_expiry      = false,
      updated_by          = v_user,
      updated_at          = now();

    -- سجل حركة غير قابل للتعديل، مربوط بالمستند والمخزن والتشغيلة
    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, batch_number, expiry_date,
       movement_type, movement_subtype, quantity, cost_price,
       reference_type, reference_id, supplier_id, notes, created_by)
    values
      (v_gr.tenant_id, v_gr.warehouse_id, v_item.product_id, v_item.batch_number, v_item.expiry_date,
       'receipt', 'purchase', v_qty, coalesce(v_item.unit_cost, 0),
       'goods_receipt', v_gr.id, v_gr.supplier_id,
       concat('استلام ', v_gr.receipt_number,
              case when v_po.order_number is not null then concat(' — أمر شراء ', v_po.order_number) else '' end),
       v_user);

    v_lines := v_lines + 1;
    v_total := v_total + v_qty;
  end loop;

  -- (4) إغلاق المستند
  update public.goods_receipts
     set status = 'posted', posted_at = now(), posted_by = v_user,
         received_by = v_user, updated_by = v_user, updated_at = now()
   where id = v_gr.id;

  -- (5) تحديث أمر الشراء (بنود + حالة)
  if v_gr.purchase_order_id is not null then
    update public.purchase_order_items poi
       set received_quantity = sub.total, updated_at = now()
      from (
        select gri.product_id, sum(coalesce(gri.quantity_received, 0))::integer as total
          from public.goods_receipt_items gri
          join public.goods_receipts g2 on g2.id = gri.goods_receipt_id
         where g2.purchase_order_id = v_gr.purchase_order_id
           and g2.status in ('posted','received')
           and g2.deleted_at is null
         group by gri.product_id
      ) sub
     where poi.purchase_order_id = v_gr.purchase_order_id
       and poi.product_id = sub.product_id;

    if exists (
      select 1 from public.purchase_order_items i
       where i.purchase_order_id = v_gr.purchase_order_id
         and coalesce(i.received_quantity, 0) < i.quantity
    ) then
      v_po_status := 'partially_received';
    else
      v_po_status := 'received';
    end if;

    update public.purchase_orders
       set status = v_po_status, updated_by = v_user, updated_at = now()
     where id = v_gr.purchase_order_id;
  end if;

  return jsonb_build_object(
    'receipt_id', v_gr.id,
    'receipt_number', v_gr.receipt_number,
    'status', 'posted',
    'lines', v_lines,
    'total_quantity', v_total,
    'purchase_order_status', v_po_status
  );
end;
$$;

-- -------------------------------------------------------------------------------------
-- 12) إلغاء مستند استلام (draft فقط)
-- -------------------------------------------------------------------------------------
create or replace function public.wms_gr_cancel(
  p_receipt_id uuid,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gr public.goods_receipts%rowtype;
  v_user uuid;
begin
  v_user := public.wms_current_user(p_user_id);
  if v_user is null then
    raise exception 'غير مصرح';
  end if;

  select * into v_gr from public.goods_receipts where id = p_receipt_id for update;
  if not found then
    raise exception 'مستند الاستلام غير موجود';
  end if;

  perform public.wms_assert_user_warehouse(v_user, v_gr.warehouse_id);

  if v_gr.status = 'posted' then
    raise exception 'لا يمكن إلغاء مستند مرحّل — أنشئ مستنداً عكسياً لاحقاً';
  end if;
  if v_gr.status = 'cancelled' then
    return jsonb_build_object('receipt_id', v_gr.id, 'status', 'cancelled', 'changed', false);
  end if;

  update public.goods_receipts
     set status = 'cancelled', updated_by = v_user, updated_at = now()
   where id = v_gr.id;

  return jsonb_build_object('receipt_id', v_gr.id, 'status', 'cancelled', 'changed', true);
end;
$$;

-- -------------------------------------------------------------------------------------
-- 13) قراءات الواجهة (مُفلترة على مخزن المستخدم تلقائياً)
-- -------------------------------------------------------------------------------------
create or replace function public.wms_po_list(
  p_search text default null,
  p_limit integer default 50,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_wh uuid;
begin
  v_user := public.wms_current_user(p_user_id);
  if v_user is null then
    raise exception 'غير مصرح';
  end if;
  select coalesce(public.wms_ctx_warehouse_id(),
                  (select uw.warehouse_id from public.user_warehouses uw where uw.user_id = v_user limit 1))
    into v_wh;
  perform public.wms_assert_user_warehouse(v_user, v_wh);

  return coalesce((
    select jsonb_agg(x order by x->>'order_date' desc, x->>'order_number' desc)
      from (
        select jsonb_build_object(
                 'id', po.id,
                 'order_number', po.order_number,
                 'order_date', po.order_date,
                 'status', po.status,
                 'supplier_id', po.supplier_id,
                 'supplier_name', (select s.name from public.suppliers s where s.id = po.supplier_id),
                 'total_amount', po.total_amount,
                 'warehouse_id', po.warehouse_id,
                 'items', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'product_id', i.product_id,
                            'product_name', coalesce((select p2.name from public.products p2 where p2.id = i.product_id), '—'),
                            'quantity', i.quantity,
                            'received_quantity', coalesce(i.received_quantity, 0),
                            'remaining', i.quantity - coalesce(i.received_quantity, 0),
                            'unit_price', i.unit_price
                          ) order by i.created_at)
                   from public.purchase_order_items i
                  where i.purchase_order_id = po.id
                 ), '[]'::jsonb)
               ) as x
          from public.purchase_orders po
         where po.warehouse_id = v_wh
           and po.deleted_at is null
           and po.status in ('pending','approved','ordered','sent','partially_received')
           and (
             p_search is null or p_search = ''
             or po.order_number ilike '%' || p_search || '%'
             or exists (
               select 1 from public.purchase_order_items i2
                where i2.purchase_order_id = po.id
                  and exists (
                    select 1 from public.products p3
                     where p3.id = i2.product_id and p3.name ilike '%' || p_search || '%'
                  )
             )
           )
         order by po.order_date desc, po.order_number desc
         limit least(coalesce(p_limit, 50), 200)
      ) s
  ), '[]'::jsonb);
end;
$$;

create or replace function public.wms_gr_list(
  p_status text default null,
  p_search text default null,
  p_limit integer default 50,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_wh uuid;
begin
  v_user := public.wms_current_user(p_user_id);
  if v_user is null then
    raise exception 'غير مصرح';
  end if;
  select coalesce(public.wms_ctx_warehouse_id(),
                  (select uw.warehouse_id from public.user_warehouses uw where uw.user_id = v_user limit 1))
    into v_wh;
  perform public.wms_assert_user_warehouse(v_user, v_wh);

  return coalesce((
    select jsonb_agg(x order by x->>'created_at' desc)
      from (
        select jsonb_build_object(
                 'id', gr.id,
                 'receipt_number', gr.receipt_number,
                 'receipt_date', gr.receipt_date,
                 'status', gr.status,
                 'posted_at', gr.posted_at,
                 'purchase_order_id', gr.purchase_order_id,
                 'purchase_order_number', (select po.order_number from public.purchase_orders po where po.id = gr.purchase_order_id),
                 'supplier_name', (select s.name from public.suppliers s where s.id = gr.supplier_id),
                 'notes', gr.notes,
                 'created_at', gr.created_at,
                 'items', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'product_id', i.product_id,
                            'product_name', coalesce((select p2.name from public.products p2 where p2.id = i.product_id), '—'),
                            'batch_number', i.batch_number,
                            'expiry_date', i.expiry_date,
                            'quantity_received', i.quantity_received,
                            'quantity_damaged', i.quantity_damaged,
                            'unit_cost', i.unit_cost
                          ) order by i.created_at)
                   from public.goods_receipt_items i
                  where i.goods_receipt_id = gr.id
                 ), '[]'::jsonb)
               ) as x
          from public.goods_receipts gr
         where gr.warehouse_id = v_wh
           and gr.deleted_at is null
           and (p_status is null or p_status = '' or gr.status = p_status)
           and (
             p_search is null or p_search = ''
             or gr.receipt_number ilike '%' || p_search || '%'
           )
         order by gr.created_at desc
         limit least(coalesce(p_limit, 50), 200)
      ) s
  ), '[]'::jsonb);
end;
$$;

create or replace function public.wms_stock_list(
  p_search text default null,
  p_status text default null,
  p_limit integer default 100,
  p_offset integer default 0,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_wh uuid;
begin
  v_user := public.wms_current_user(p_user_id);
  if v_user is null then
    raise exception 'غير مصرح';
  end if;
  select coalesce(public.wms_ctx_warehouse_id(),
                  (select uw.warehouse_id from public.user_warehouses uw where uw.user_id = v_user limit 1))
    into v_wh;
  perform public.wms_assert_user_warehouse(v_user, v_wh);

  return (
    select jsonb_build_object(
      'rows', coalesce(jsonb_agg(row_json order by row_json->>'expiry_date' nulls last, row_json->>'product_name'), '[]'::jsonb),
      'total', coalesce(max(total_count), 0)
    )
    from (
      select jsonb_build_object(
               'id', inv.id,
               'product_id', inv.product_id,
               'product_name', coalesce(p.name, '—'),
               'barcode', p.barcode,
               'unit_of_measure', p.unit_of_measure,
               'batch_number', inv.batch_number,
               'expiry_date', inv.expiry_date,
               'quantity', inv.quantity,
               'available_quantity', inv.available_quantity,
               'reserved_quantity', inv.reserved_quantity,
               'staging_quantity', inv.staging_quantity,
               'quarantine_quantity', inv.quarantine_quantity,
               'damaged_quantity', inv.damaged_quantity,
               'expired_quantity', inv.expired_quantity,
               'unit_cost', inv.unit_cost,
               'location', inv.location,
               'is_quarantined', inv.is_quarantined,
               'stock_status', case
                 when inv.expiry_date < current_date then 'expired'
                 when coalesce(inv.quarantine_quantity,0) > 0 or inv.is_quarantined then 'quarantine'
                 when coalesce(inv.damaged_quantity,0) > 0 then 'damaged'
                 when coalesce(inv.available_quantity,0) = 0 then 'out_of_stock'
                 when coalesce(inv.reserved_quantity,0) + coalesce(inv.staging_quantity,0) > 0 then 'reserved'
                 else 'available'
               end
             ) as row_json,
             count(*) over() as total_count
        from public.inventory inv
        left join public.products p on p.id = inv.product_id
       where inv.warehouse_id = v_wh
         and (
           p_search is null or p_search = ''
           or inv.batch_number ilike '%' || p_search || '%'
           or p.name ilike '%' || p_search || '%'
           or p.barcode = p_search
         )
         and (
           p_status is null or p_status = '' or p_status = 'all'
           or (p_status = 'expired' and inv.expiry_date < current_date)
           or (p_status = 'quarantine' and (coalesce(inv.quarantine_quantity,0) > 0 or inv.is_quarantined))
           or (p_status = 'damaged' and coalesce(inv.damaged_quantity,0) > 0)
           or (p_status = 'reserved' and coalesce(inv.reserved_quantity,0) + coalesce(inv.staging_quantity,0) > 0)
           or (p_status = 'available' and coalesce(inv.available_quantity,0) > 0 and inv.expiry_date >= current_date)
         )
       order by inv.expiry_date, p.name
       limit least(coalesce(p_limit, 100), 500)
       offset greatest(coalesce(p_offset, 0), 0)
    ) q
  );
end;
$$;

create or replace function public.wms_movements_list(
  p_limit integer default 50,
  p_offset integer default 0,
  p_search text default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_wh uuid;
begin
  v_user := public.wms_current_user(p_user_id);
  if v_user is null then
    raise exception 'غير مصرح';
  end if;
  select coalesce(public.wms_ctx_warehouse_id(),
                  (select uw.warehouse_id from public.user_warehouses uw where uw.user_id = v_user limit 1))
    into v_wh;
  perform public.wms_assert_user_warehouse(v_user, v_wh);

  return coalesce((
    select jsonb_agg(x order by x->>'created_at' desc)
      from (
        select jsonb_build_object(
                 'id', m.id,
                 'created_at', m.created_at,
                 'movement_type', m.movement_type,
                 'movement_subtype', m.movement_subtype,
                 'quantity', m.quantity,
                 'cost_price', m.cost_price,
                 'batch_number', m.batch_number,
                 'expiry_date', m.expiry_date,
                 'reference_type', m.reference_type,
                 'reference_id', m.reference_id,
                 'reference_number', case
                   when m.reference_type = 'goods_receipt' then
                     (select gr.receipt_number from public.goods_receipts gr where gr.id = m.reference_id)
                   else null
                 end,
                 'product_name', coalesce((select p.name from public.products p where p.id = m.product_id), '—'),
                 'notes', m.notes
               ) as x
          from public.inventory_movements m
         where m.warehouse_id = v_wh
           and (
             p_search is null or p_search = ''
             or m.batch_number ilike '%' || p_search || '%'
             or m.reference_type ilike '%' || p_search || '%'
           )
         order by m.created_at desc
         limit least(coalesce(p_limit, 50), 200)
         offset greatest(coalesce(p_offset, 0), 0)
      ) s
  ), '[]'::jsonb);
end;
$$;

create or replace function public.wms_product_create(
  p_name text,
  p_name_ar text default null,
  p_barcode text default null,
  p_unit text default null,
  p_shelf_life_months integer default null,
  p_min_stock integer default null,
  p_max_stock integer default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_wh uuid;
  v_tenant uuid;
  v_sku text;
  v_id uuid;
begin
  v_user := public.wms_current_user(p_user_id);
  if v_user is null then
    raise exception 'غير مصرح';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'اسم الصنف مطلوب';
  end if;

  select coalesce(public.wms_ctx_warehouse_id(),
                  (select uw.warehouse_id from public.user_warehouses uw where uw.user_id = v_user limit 1))
    into v_wh;
  perform public.wms_assert_user_warehouse(v_user, v_wh);

  select w.tenant_id into v_tenant from public.warehouses w where w.id = v_wh;
  if v_tenant is null then
    raise exception 'لم يتم ربط المخزن بمؤسسة';
  end if;

  if p_barcode is not null and length(trim(p_barcode)) > 0
     and exists (select 1 from public.products p where p.barcode = trim(p_barcode)) then
    raise exception 'الباركود «%» مستخدم لصنف آخر', p_barcode;
  end if;

  v_sku := 'SKU-' || upper(substr(md5(v_user::text || now()::text), 1, 10));

  insert into public.products
    (tenant_id, warehouse_id, name, name_ar, sku, barcode, unit_of_measure,
     shelf_life_months, min_stock_level, max_stock_level, is_active)
  values
    (v_tenant, v_wh, trim(p_name),
     coalesce(nullif(trim(coalesce(p_name_ar, '')), ''), trim(p_name)), v_sku,
     nullif(trim(coalesce(p_barcode, '')), ''), coalesce(nullif(trim(coalesce(p_unit, '')), ''), 'pieces'),
     nullif(coalesce(p_shelf_life_months, 0), 0), coalesce(p_min_stock, 0), coalesce(p_max_stock, 1000), true)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'sku', v_sku, 'name', trim(p_name));
end;
$$;

create or replace function public.wms_product_list(
  p_search text default null,
  p_limit integer default 100,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_wh uuid;
begin
  v_user := public.wms_current_user(p_user_id);
  if v_user is null then
    raise exception 'غير مصرح';
  end if;
  select coalesce(public.wms_ctx_warehouse_id(),
                  (select uw.warehouse_id from public.user_warehouses uw where uw.user_id = v_user limit 1))
    into v_wh;
  perform public.wms_assert_user_warehouse(v_user, v_wh);

  return coalesce((
    select jsonb_agg(x order by x->>'name')
      from (
        select jsonb_build_object(
                 'id', p.id,
                 'name', p.name,
                 'name_ar', p.name_ar,
                 'barcode', p.barcode,
                 'unit_of_measure', p.unit_of_measure,
                 'shelf_life_months', p.shelf_life_months,
                 'min_stock_level', p.min_stock_level,
                 'max_stock_level', p.max_stock_level,
                 'is_active', p.is_active
               ) as x
          from public.products p
         where (p.warehouse_id = v_wh or p.tenant_id = public.wms_ctx_tenant_id())
           and p.is_active is distinct from false
           and (
             p_search is null or p_search = ''
             or p.name ilike '%' || p_search || '%'
             or p.name_ar ilike '%' || p_search || '%'
             or p.barcode = p_search
           )
         order by p.name
         limit least(coalesce(p_limit, 100), 500)
      ) s
  ), '[]'::jsonb);
end;
$$;

-- -------------------------------------------------------------------------------------
-- 14) الصلاحيات: لا يُسمح بالاستدعاء إلا لمن يملك الدور المصادق (authenticated/service)
-- -------------------------------------------------------------------------------------
do $wms_grants$
declare
  fn text;
begin
  foreach fn in array array[
    'wms_ctx_warehouse_id()', 'wms_ctx_tenant_id()', 'wms_ctx_role()',
    'wms_assert_user_warehouse(uuid,uuid)', 'wms_current_user(uuid)',
    'wms_gr_next_number(uuid)',
    'wms_gr_apply_items(uuid,uuid,jsonb)',
    'wms_gr_create(uuid,jsonb,text,uuid)',
    'wms_gr_set_items(uuid,jsonb,uuid)',
    'wms_gr_post(uuid,uuid)',
    'wms_gr_cancel(uuid,uuid)',
    'wms_po_list(text,integer,uuid)',
    'wms_gr_list(text,text,integer,uuid)',
    'wms_stock_list(text,text,integer,integer,uuid)',
    'wms_movements_list(integer,integer,text,uuid)',
    'wms_product_create(text,text,text,text,integer,integer,integer,uuid)',
    'wms_product_list(text,integer,uuid)',
    'wms_ledger_immutable()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $wms_grants$;

comment on table public.inventory_movements is
  'Append-only stock ledger (triggers block UPDATE/DELETE/TRUNCATE). Each row links to its source document via reference_type/reference_id, warehouse, batch, quantity and user.';
comment on function public.wms_gr_post(uuid, uuid) is
  'Atomic goods-receipt posting: locks document + PO, upserts batches, writes immutable ledger, closes document. Idempotent (second post raises).';
