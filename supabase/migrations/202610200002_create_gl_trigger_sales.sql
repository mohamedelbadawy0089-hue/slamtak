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
