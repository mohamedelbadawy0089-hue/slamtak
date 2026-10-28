-- ==========================================================================
-- Self-test للتحقق من توسيع الحذف التلقائي ليشمل الجداول المالية.
--
-- طريقة التشغيل (ثلاث استعلامات على التوالي عبر واجهة Supabase SQL أو tmp-sql.mjs):
--   1) محتوى هذا الملف        → ينشئ الدالة _purge_selftest
--   2) select public._purge_selftest();  → يُنفّذ الاختبار ويعيد تقريراً بصيغة json
--   3) drop function if exists public._purge_selftest();
--
-- السلوك: يُنشئ فواتير/مقبوضات/مرتجعات/قيود/قيود أستاذ قديمة (أقدم من 12 شهراً)
-- وحديثة للتحكم، ثم يستدعي p_purge_old_data(12,false,null) ويتحقق أن:
--   - القديم حُذف والحديث بقي، وبنود القيد حُذفت مع الأب (cascade)،
--   - أرصدة العملاء لم تتغير (مشغّلات الأرصدة عُطّلت أثناء الحذف)،
--   - مشغّلات الحذف عادت مفعّلة، وتقرير الحذف يشمل financial_tables.
-- عند نجاحه ينظّف بقاياه ثم يعيد النتيجة؛ وعند أي فشل يُلغي المعاملة كلها
-- (ROLLBACK) فلا يبقى أي أثر في القاعدة.
-- ==========================================================================
create or replace function public._purge_selftest() returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m          text := 'PURGE-SELFTEST';
  v_cut      date := (date_trunc('month', now() - interval '12 months'))::date;
  v_old      date := (date_trunc('month', now() - interval '12 months'))::date - 20;
  v_new      date := current_date - 3;
  v_tenant   uuid;
  v_wh       uuid;
  v_cust     uuid;
  v_ar       uuid;
  v_acct     uuid;
  v_bal0     numeric;
  v_bal1     numeric;
  v_bal2     numeric;
  v_inv_old  uuid := gen_random_uuid();
  v_inv_new  uuid := gen_random_uuid();
  v_je_old   uuid := gen_random_uuid();
  v_je_new   uuid := gen_random_uuid();
  v_pay_old  uuid := gen_random_uuid();
  v_pay_new  uuid := gen_random_uuid();
  v_ret_old  uuid := gen_random_uuid();
  v_ret_new  uuid := gen_random_uuid();
  v_gl_old   uuid := gen_random_uuid();
  v_gl_new   uuid := gen_random_uuid();
  v_r        jsonb;
  v_fail     text := '';
  v_n        bigint;
begin
  -- ===== اختيار بيانات أساسية موجودة =====
  -- حساب ذمم (114) تابع لمؤسسة موجودة فعلاً في جدول tenants
  select ca.id, ca.tenant_id into v_ar, v_tenant
    from public.chart_of_accounts ca
    join public.tenants t on t.id = ca.tenant_id
   where ca.code = '114' and ca.account_type = 'asset'
   limit 1;
  if v_ar is null then
    raise exception 'SELFTEST: لا يوجد حساب ذمم (114) تابع لمؤسسة موجودة';
  end if;

  select id into v_wh from public.warehouses where tenant_id = v_tenant limit 1;
  if v_wh is null then select id into v_wh from public.warehouses limit 1; end if;

  select id into v_cust from public.customers where tenant_id = v_tenant limit 1;
  if v_cust is null then select id into v_cust from public.customers limit 1; end if;

  select id into v_acct from public.chart_of_accounts where account_type = 'asset' limit 1;

  if v_ar is null or v_tenant is null or v_wh is null or v_cust is null or v_acct is null then
    raise exception 'SELFTEST seed missing: ar=% tenant=% wh=% cust=% acct=%',
      v_ar, v_tenant, v_wh, v_cust, v_acct;
  end if;

  -- توحيد نقطة البداية (null -> 0) حتى يكون فحص فرق الأرصدة دقيقاً
  update public.customers set current_balance = coalesce(current_balance, 0) where id = v_cust;
  select coalesce(current_balance, 0) into v_bal0 from public.customers where id = v_cust;

  -- ===== إدراج سجلات مالية قديمة (أقدم من 12 شهراً) + حديثة للتحكم =====
  insert into public.sales_invoices
    (id, tenant_id, warehouse_id, customer_id, invoice_number, invoice_date, status, created_at)
  values
    (v_inv_old, v_tenant, v_wh, v_cust, m || '-INV-OLD', v_old, 'draft', now() - interval '14 months'),
    (v_inv_new, v_tenant, v_wh, v_cust, m || '-INV-NEW', v_new, 'draft', now());

  insert into public.payments
    (id, tenant_id, type, reference_id, amount, payment_date, payment_method,
     payment_number, payment_type, customer_id, warehouse_id, created_at)
  values
    (v_pay_old, v_tenant, 'receipt', gen_random_uuid(), 100, v_old, 'cash',
     m || '-PAY-OLD', 'incoming', v_cust, v_wh, now() - interval '14 months'),
    (v_pay_new, v_tenant, 'receipt', gen_random_uuid(), 50, v_new, 'cash',
     m || '-PAY-NEW', 'incoming', v_cust, v_wh, now());

  insert into public.returns
    (id, tenant_id, type, reference_id, return_number, return_date,
     warehouse_id, return_type, customer_id, status, created_at)
  values
    (v_ret_old, v_tenant, 'sales', v_inv_old, m || '-RET-OLD', v_old,
     v_wh, 'customer', v_cust, 'pending', now() - interval '14 months'),
    (v_ret_new, v_tenant, 'sales', v_inv_new, m || '-RET-NEW', v_new,
     v_wh, 'customer', v_cust, 'pending', now());

  -- ملاحظة: مشغّل f_block_closed_period على journal_entries يقارن period_id (date)
  -- مع financial_periods.id (uuid) فيُسقط أي إدراج — عطّله مؤقتاً هنا للاختبار فقط
  -- (عطب موجود مسبقاً في المشروع وليس مرتبطاً بعملية الحذف).
  execute 'alter table public.journal_entries disable trigger user';
  insert into public.journal_entries
    (id, tenant_id, description, reference_type, period_id, account_id, entry_date, status, created_at)
  values
    (v_je_old, v_tenant, m || '-JE-OLD', 'journal_entry', v_old, v_acct, v_old, 'posted', now() - interval '14 months'),
    (v_je_new, v_tenant, m || '-JE-NEW', 'journal_entry', v_new, v_acct, v_new, 'draft',  now());
  execute 'alter table public.journal_entries enable trigger user';

  insert into public.journal_entry_lines (id, entry_id, account_id, debit, credit, created_at)
  values
    (gen_random_uuid(), v_je_old, v_acct, 100, 0, now() - interval '14 months'),
    (gen_random_uuid(), v_je_new, v_acct, 0, 100, now());

  -- سطر قديم على حساب الذمم (114) يستدعي مُنشئ أرصدة العملاء عند الإدراج
  insert into public.general_ledger
    (id, tenant_id, account_id, reference_type, reference_id, description,
     customer_id, debit, credit, created_at)
  values
    (v_gl_old, v_tenant, v_ar, 'journal_entry', v_je_old, m || '-GL-OLD',
     v_cust, 100, 0, now() - interval '14 months'),
    (v_gl_new, v_tenant, v_ar, 'journal_entry', v_je_new, m || '-GL-NEW',
     null, 0, 0, now());

  select coalesce(current_balance, 0) into v_bal1 from public.customers where id = v_cust;

  -- التأكد من أن مُنشئ الأرصدة عمل فعلاً عند الإدراج (وإلا كان فحص الحفظ بلا معنى)
  if v_bal1 is distinct from v_bal0 + 100 then
    v_fail := v_fail || E'\n - ' || 'مُنشئ أرصدة العملاء لم يعمل عند الإدراج: ' ||
              coalesce(v_bal0::text, 'null') || ' -> ' || coalesce(v_bal1::text, 'null');
  end if;

  -- ===== تنفيذ الحذف التلقائي فعلياً (بدون dry-run) =====
  v_r := public.p_purge_old_data(12, false, null);

  select coalesce(current_balance, 0) into v_bal2 from public.customers where id = v_cust;

  -- ===== التحقق =====
  if exists (select 1 from public.sales_invoices where id = v_inv_old) then
    v_fail := v_fail || E'\n - ' || 'الفاتورة القديمة لم تُحذف';
  end if;
  if not exists (select 1 from public.sales_invoices where id = v_inv_new) then
    v_fail := v_fail || E'\n - ' || 'حُذفت فاتورة حديثة بالخطأ';
  end if;

  if exists (select 1 from public.payments where id = v_pay_old) then
    v_fail := v_fail || E'\n - ' || 'المقبوضات القديمة لم تُحذف';
  end if;
  if not exists (select 1 from public.payments where id = v_pay_new) then
    v_fail := v_fail || E'\n - ' || 'حُذف مقبوضات حديثة بالخطأ';
  end if;

  if exists (select 1 from public.returns where id = v_ret_old) then
    v_fail := v_fail || E'\n - ' || 'المرتجع القديم لم يُحذف';
  end if;
  if not exists (select 1 from public.returns where id = v_ret_new) then
    v_fail := v_fail || E'\n - ' || 'حُذف مرتجع حديث بالخطأ';
  end if;

  if exists (select 1 from public.journal_entries where id = v_je_old) then
    v_fail := v_fail || E'\n - ' || 'القيد القديم لم يُحذف';
  end if;
  if exists (select 1 from public.journal_entry_lines where entry_id = v_je_old) then
    v_fail := v_fail || E'\n - ' || 'سطر القيد القديم المُشتق لم يُحذف (cascade)؛' ||
      ' lines=' || (select count(*)::text from public.journal_entry_lines where entry_id = v_je_old) ||
      ' je_old=' || (select count(*)::text from public.journal_entries where id = v_je_old) ||
      ' je_new=' || (select count(*)::text from public.journal_entries where id = v_je_new) ||
      ' lines_new=' || (select count(*)::text from public.journal_entry_lines where entry_id = v_je_new) ||
      ' report=' || coalesce((v_r -> 'by_table')::text, '{}');
  end if;
  if not exists (select 1 from public.journal_entries where id = v_je_new) then
    v_fail := v_fail || E'\n - ' || 'حُذف قيد حديث بالخطأ';
  end if;

  if exists (select 1 from public.general_ledger where id = v_gl_old) then
    v_fail := v_fail || E'\n - ' || 'سطر الأستاذ القديم لم يُحذف';
  end if;
  if not exists (select 1 from public.general_ledger where id = v_gl_new) then
    v_fail := v_fail || E'\n - ' || 'حُذف سطر أستاذ حديث بالخطأ';
  end if;

  -- أرصدة العملاء الحالية يجب أن تبقى كما كانت بعد الإدراج (لم يُخصم شيء عند الحذف)
  if v_bal1 is distinct from v_bal2 then
    v_fail := v_fail || E'\n - ' || 'تغيّرت أرصدة العملاء أثناء الحذف: ' ||
              coalesce(v_bal1::text, 'null') || ' -> ' || coalesce(v_bal2::text, 'null');
  end if;

  -- مشغّلات الحذف يجب أن تكون قد عادت مفعّلة بعد انتهاء الدالة
  if exists (
    select 1 from pg_trigger tg
      join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in ('sales_invoices','purchase_invoices','journal_entries',
                         'general_ledger','payments','returns')
       and not tg.tgisinternal
       and tg.tgenabled = 'D'
  ) then
    v_fail := v_fail || E'\n - ' || 'مشغّل حذف بقي معطّلاً بعد التنفيذ';
  end if;

  if coalesce((v_r ->> 'total_rows')::bigint, 0) < 5 then
    v_fail := v_fail || E'\n - ' || 'تقرير الحذف لا يشمل الجداول المالية: total_rows=' ||
              coalesce(v_r ->> 'total_rows', 'null');
  end if;

  if coalesce((v_r ->> 'financial_tables')::text, '') = '' then
    v_fail := v_fail || E'\n - ' || 'حقل financial_tables مفقود من تقرير الحذف';
  end if;

  -- ===== تنظيف بيانات الاختبار (إن نجح التحقق) =====
  execute 'alter table public.sales_invoices disable trigger user';
  execute 'alter table public.payments       disable trigger user';
  execute 'alter table public.returns        disable trigger user';
  execute 'alter table public.journal_entries disable trigger user';
  execute 'alter table public.general_ledger  disable trigger user';

  delete from public.journal_entries  where description like m || '%';
  delete from public.general_ledger   where description like m || '%';
  delete from public.sales_invoices   where invoice_number like m || '%';
  delete from public.payments         where payment_number like m || '%';
  delete from public.returns          where return_number like m || '%';

  execute 'alter table public.sales_invoices enable trigger user';
  execute 'alter table public.payments       enable trigger user';
  execute 'alter table public.returns        enable trigger user';
  execute 'alter table public.journal_entries enable trigger user';
  execute 'alter table public.general_ledger  enable trigger user';

  update public.customers set current_balance = v_bal0 where id = v_cust;

  if v_fail <> '' then
    raise exception 'SELFTEST FAILED: %', v_fail;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'cutoff', v_cut,
    'old_row_date', v_old,
    'recent_row_date', v_new,
    'balance_before_insert', v_bal0,
    'balance_after_gl_insert', v_bal1,
    'balance_after_purge', v_bal2,
    'checks', jsonb_build_array(
      'حُذفت الفواتير/المقبوضات/المرتجعات/القيود/الأستاذ الأقدم من 12 شهراً',
      'بقيت السجلات الحديثة',
      'بنود القيد المُشافة حُذفت مع الأب (cascade)',
      'أرصدة العملاء لم تتغير أثناء الحذف',
      'مشغّلات الحذف عادت مفعّلة',
      'تقرير الحذف يشمل financial_tables'
    ),
    'purge_report', v_r
  );
end;
$$;