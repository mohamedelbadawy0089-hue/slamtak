-- =====================================================================================
-- المرحلة 2 (202610250002) — إصلاح الأقسام + تدقيق أخطاء الاستلام + سياسات القراءة
--
-- 1) inventory_movements: قسم افتراضي (DEFAULT) + أقسام شهرية لسنة 2026 وما بعدها.
-- 2) p_proc_receive_goods: المعالج الصامت (تسجيل كحركة ناجحة ثم تجاهل الخطأ) يستبدل
--    بمعالج يسجّل الحدث برقم SQLSTATE ثم يرفع استثناءً واضحاً — لا نجاح زائف بعد فشل.
-- 3) RLS: قراءة profiles و inventory_movements و audit_logs للأدوار المصرح لها بدءاً
--    من هوية المستخدم بدل GUC الحالي الذي يرجع NULL (ومنه القراءات الصفراً).
--
-- ملاحظة معاملات: رفع الاستثناء يجعل PostgREST يُلغي معاملة الطلب كاملة، لذا يكتمل
-- التسجيل الدائم للخطأ من طبقة JavaScript (public/app.js و worker.js) في طلب مستقل؛
-- أما raise warning فيبقى دائماً في سجل خادم PostgreSQL.
--
-- الاختبار (dry-run ثم ROLLBACK): node supabase/tests/run-phase2-migration-test.mjs
-- التطبيق النهائي:             node supabase/tests/run-phase2-migration-test.mjs --apply
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- (0) دالة الاستلام: تسجيل الخطأ ثم رفع الاستثناء
-- -------------------------------------------------------------------------------------
create or replace function public.p_proc_receive_goods(p_purchase_order_id uuid, p_items jsonb, p_notes text, p_user_id uuid, p_receipt_number text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$

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
            v_errm text := null;
            v_state text := '000000';
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
                                      v_errm := SQLERRM;
                                      v_state := SQLSTATE;

                                      -- تحذير دائم في سجل الخادم (لا يُلغى بعودة المعاملة)
                                      raise warning 'WMS inventory_movement_failed fn=p_proc_receive_goods po=% item=% qty=% sqlstate=% error=%',
                                        coalesce(v_po.order_number, '?'),
                                        coalesce(v_product::text, '?'),
                                        coalesce(nullif(v_item->>'quantity_received', ''), '?'),
                                        coalesce(v_state, '000000'),
                                        coalesce(v_errm, 'unknown');

                                      -- تسجيل الحدث في audit_logs (يُحفظ عندما تُلتقط المعاملة داخل سياق أكبر يُعتمد)
                                      begin
                                        insert into public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
                                        values (v_tenant, p_user_id, v_wh, 'inventory_movement_failed', 'inventory_movements', v_product,
                                                jsonb_build_object(
                                                  'error', coalesce(v_errm, 'unknown'),
                                                  'sqlstate', coalesce(v_state, '000000'),
                                                  'function', 'p_proc_receive_goods',
                                                  'purchase_order', v_po.order_number,
                                                  'batch_number', nullif(v_item->>'batch_number', ''),
                                                  'quantity', coalesce(nullif(v_item->>'quantity_received', '')::numeric, 0),
                                                  'notes', concat('فشل ترحيل استلام أمر شراء ', coalesce(v_po.order_number, '?')),
                                                  'at', now()
                                                ));
                                      exception when others then
                                        null; -- لا نُخفّي الخطأ الأصلي خلف فشل التسجيل
                                      end;

                                      -- رفع الاستثناء: لا عودة ناجحة بعد فشل الترحيل
                                      raise exception 'فشل ترحيل حركة الاستلام لأمر شراء % (SQLSTATE %): %',
                                        coalesce(v_po.order_number, '?'),
                                        coalesce(v_state, '000000'),
                                        coalesce(v_errm, 'unknown');
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    
$fn$;

-- =====================================================================================
-- المرحلة 2 — أقسام السجل + قراءة آمنة (RLS) بدل الاعتماد على GUC غير مضبوط
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1) أقسام سجل الحركات: أقسام شهرية مستقبلية + قسم افتراضي يقبل أي تاريخ (2026+)
-- -------------------------------------------------------------------------------------
do $wms_partitions$
declare
  d date;
  m text;
  has_default boolean;
begin
  for i in 0..36 loop
    d := date_trunc('month', now())::date + make_interval(months => i);
    m := to_char(d, 'YYYY_MM');
    if not exists (
      select 1 from pg_inherits ih
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
    select 1 from pg_inherits ih
      join pg_class c on c.oid = ih.inhrelid
     where ih.inhparent = 'public.inventory_movements'::regclass
       and pg_get_expr(c.relpartbound, c.oid) like '%DEFAULT%'
  ) into has_default;

  if not has_default then
    execute 'create table if not exists public.inventory_movements_default partition of public.inventory_movements default';
  end if;
end $wms_partitions$;

-- -------------------------------------------------------------------------------------
-- 2) أدوات السياق: هوية المستخدم أولاً، ثم GUC كخيار احتياطي (service role/المعاملات)
-- -------------------------------------------------------------------------------------
-- عضوية مخزن معيّن (تجاوز RLS على user_warehouses)
create or replace function public.wms_is_member_warehouse(p_warehouse_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_warehouse_id is not null and exists (
    select 1 from public.user_warehouses uw
     where uw.warehouse_id = p_warehouse_id
       and uw.user_id = auth.uid()
  )
  or exists (
    select 1 from public.warehouses w
     where w.id = p_warehouse_id and w.manager_id = auth.uid()
  );
$$;

-- هل ينتمي مستخدم آخر إلى مخزني؟ (لقراءة profiles داخل النطاق نفسه)
create or replace function public.wms_same_warehouse_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_warehouses uw
     where uw.user_id = p_user_id
       and (
         uw.warehouse_id = public.wms_ctx_warehouse_id()
         or exists (select 1 from public.warehouses w
                     where w.id = uw.warehouse_id and w.manager_id = auth.uid())
       )
  );
$$;

-- سياق الجلسة كما يراه الخادم: يمنع القراءات الصفرية الصامتة
-- (المتصفح يستدعيها قبل تحميل أي قسم ليعرف: هل الحساب مخوّل أم لا تُعرض بيانات؟)
create or replace function public.wms_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $ctx$
declare
  v_user uuid;
  v_wh uuid;
begin
  v_user := auth.uid();
  if v_user is null then
    return jsonb_build_object('authenticated', false, 'ready', false);
  end if;

  v_wh := public.wms_ctx_warehouse_id();

  return jsonb_build_object(
    'authenticated', true,
    'ready', v_wh is not null,
    'user_id', v_user,
    'warehouse_id', v_wh,
    'tenant_id', coalesce(public.wms_ctx_tenant_id(),
      (select w.tenant_id from public.warehouses w where w.id = v_wh limit 1)),
    'role', public.wms_ctx_role(),
    'warehouse_name', (select w.name from public.warehouses w where w.id = v_wh limit 1),
    'full_name', (select p.full_name from public.profiles p where p.id = v_user limit 1)
  );
end;
$ctx$;

-- -------------------------------------------------------------------------------------
-- 3) سياسات القراءة (تفعيل RLS للأدوار المصرح لها)
-- -------------------------------------------------------------------------------------
do $wms_policies$
begin
  -- 3a) profiles: ذاتي + أدوار إدارية + أعضاء مخزني (كانت القراءة محصورة في ذاتي فقط)
  drop policy if exists "profiles_read_warehouse_scope" on public.profiles;
  drop policy if exists "Super admins can view all profiles" on public.profiles;
  create policy "profiles_read_warehouse_scope" on public.profiles
    for select to authenticated
    using (
      id = auth.uid()
      or public.wms_ctx_role() in ('super_admin', 'super-admin', 'admin', 'owner')
      or public.wms_same_warehouse_user(profiles.id)
    );

  -- 3b) inventory_movements: نطاق المخزن + عضوية المخزن + الأدوار الإدارية
  drop policy if exists "app_warehouse_scope" on public.inventory_movements;
  create policy "app_warehouse_scope" on public.inventory_movements
    for all to authenticated
    using (
      warehouse_id = public.wms_ctx_warehouse_id()
      or public.wms_is_member_warehouse(warehouse_id)
      or public.wms_ctx_role() in ('super_admin', 'super-admin', 'admin', 'owner')
    )
    with check (
      (
        warehouse_id = public.wms_ctx_warehouse_id()
        or public.wms_is_member_warehouse(warehouse_id)
        or public.wms_ctx_role() in ('super_admin', 'super-admin', 'admin', 'owner')
      )
      and (
        tenant_id = public.wms_ctx_tenant_id()
        or public.wms_ctx_role() in ('super_admin', 'super-admin', 'admin', 'owner')
      )
    );

  -- 3c) audit_logs: كان يعتمد على GUC مباشرة فترجع NULL (قراءة صفراً + رفض الإدراج).
  --     الآن يرجع إلى هوية المستخدم مع بقاء GUC خياراً احتياطياً.
  drop policy if exists "app_warehouse_scope" on public.audit_logs;
  create policy "app_warehouse_scope" on public.audit_logs
    for all to authenticated
    using (
      public.wms_ctx_role() in ('super_admin', 'super-admin', 'admin', 'owner')
      or (
        public.wms_ctx_warehouse_id() is not null
        and warehouse_id is not distinct from public.wms_ctx_warehouse_id()
        and tenant_id is not distinct from public.wms_ctx_tenant_id()
      )
      or (warehouse_id is null and public.wms_ctx_warehouse_id() is null)
    )
    with check (
      public.wms_ctx_role() in ('super_admin', 'super-admin', 'admin', 'owner')
      or (
        public.wms_ctx_warehouse_id() is not null
        and warehouse_id is not distinct from public.wms_ctx_warehouse_id()
        and tenant_id is not distinct from public.wms_ctx_tenant_id()
      )
      or (warehouse_id is null and public.wms_ctx_warehouse_id() is null)
    );

  -- 3d) سياسة قديمة من مشروع آخر كانت تقرأ جدولاً مخزناً مختلفاً
  drop policy if exists "p_movements_select" on public.inventory_movements;
end $wms_policies$;

-- تأكيد صلاحيات القراءة/التسجيل للأدوار المصرح بها
grant select on public.profiles, public.inventory_movements, public.audit_logs to authenticated;
grant insert on public.audit_logs to authenticated;

-- -------------------------------------------------------------------------------------
-- 4) صلاحيات الدوال الجديدة
-- -------------------------------------------------------------------------------------
revoke all on function public.wms_context() from public, anon;
grant execute on function public.wms_context() to authenticated, service_role;
revoke all on function public.wms_is_member_warehouse(uuid) from public, anon;
grant execute on function public.wms_is_member_warehouse(uuid) to authenticated, service_role;
revoke all on function public.wms_same_warehouse_user(uuid) from public, anon;
grant execute on function public.wms_same_warehouse_user(uuid) to authenticated, service_role;

comment on function public.p_proc_receive_goods(uuid, jsonb, text, uuid, text) is
  'استلام بضاعة من أمر شراء: يسجّل فشل الترحيل (raise warning في سجل الخادم + صف في audit_logs) ثم يرفع استثناءً واضحاً بدل إرجاع نجاح زائف.';
comment on function public.wms_context() is
  'سياق المستخدم الحالي للواجهة: يمنع عرض أصفار صامتة عندما لا يكون الحساب مرتبطاً بمخزن.';
