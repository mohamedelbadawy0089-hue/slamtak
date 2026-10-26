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
