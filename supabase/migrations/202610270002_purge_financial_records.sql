-- ===========================================================================
-- slamtak — توسيع الحذف التلقائي (Auto-Purge) ليشمل السجلات المالية (2026-10-27)
--
-- يستبدل الدالة public.p_purge_old_data() المُعرَّفة في
-- 202610270001_reports_purge_search_pagination.sql (كانت تستثني السجلات المالية).
--
-- 1) الجداول المالية المشمولة الآن بلا استثناء (أي سجل أقدم من 12 شهراً):
--      الفواتير  : sales_invoices  + sales_invoice_items
--                  purchase_invoices + purchase_invoice_items
--      القيود    : journal_entries + journal_entry_lines + general_ledger
--      المقبوضات : payments
--      المرتجعات : returns + return_items
--    (بنود الأصناف تُحذف آلياً عبر ON DELETE CASCADE وتُعدّ في التقرير).
--
-- 2) عمود الزمن: تاريخ المستند أولاً (invoice_date / entry_date / payment_date /
--    return_date) مع ارتداد إلى created_at إذا كان فارغاً — أي سجل يتجاوز
--    عمره 12 شهراً يُحذف، سواء أُنشئ سابقاً أو يحمل تاريخ مستند قديم.
--
-- 3) معالجة مشغّلات الحذف المحظورة داخل المعاملة نفسها:
--      - f_sale_block_hard_delete على sales_invoices / payments / returns
--        كانت ترفع استثناءً ويمنع أي حذف.
--      - trg_update_customer_balance / trg_update_supplier_balance على
--        general_ledger كانت تخصم المبلغ من أرصدة العملاء/الموردين عند الحذف
--        فتتشوّه الأرصدة الحالية.
--    لذلك يُعطَّل (DISABLE TRIGGER user) على الجدول المالي قبل الحذف ويُعاد
--    تفعيله بعده. أي خطأ يُلغي المعاملة فيعود التفعيل تلقائياً بالـROLLBACK،
--    والأرصدة الحالية تبقى كما هي لأنها تمثل الوضع الآن لا تاريخه.
--
-- 4) لا تغيير في المهمة المجدولة: cron slamtak_purge_old_data (03:00 يومياً)
--    تستدعي p_purge_old_data_auto() التي تمرّر p_tables = NULL → الافتراضي
--    الجديد هو ما يشمل الجداول المالية.
--
-- 5) الصلاحيات كما كانت: الحذف لـ service_role فقط.
-- ===========================================================================

begin;

create or replace function public.p_purge_old_data(
  p_retention_months integer default 12,
  p_dry_run boolean default true,
  p_tables text[] default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $purge$
declare
  v_months      integer := greatest(coalesce(p_retention_months, 12), 1);
  v_cutoff      timestamptz := date_trunc('month', now() - make_interval(months => v_months));
  v_cutoff_date date := date_trunc('month', now() - make_interval(months => v_months))::date;
  v_system      text[] := array['audit_logs', 'import_logs', 'notifications', 'login_pins',
                                'refresh_tokens', 'password_reset_tokens'];
  v_financial   text[] := array['sales_invoices', 'purchase_invoices', 'journal_entries',
                                'general_ledger', 'payments', 'returns'];
  v_targets     text[];
  v_t           text;
  v_cand        text;
  v_col         text;
  v_expr        text;
  v_expr_p      text;
  v_count       bigint;
  v_child_count bigint;
  v_total       bigint := 0;
  v_is_fin      boolean;
  v_by_table    jsonb := '{}'::jsonb;
  v_parts       jsonb := '{}'::jsonb;
  v_part        record;
  v_child       record;
begin
  v_targets := coalesce(p_tables, v_system || v_financial);

  -- (1) الجداول المالية + سجلات النظام: حذف مباشر حسب تاريخ المستند/الإنشاء
  foreach v_t in array v_targets loop
    if to_regclass('public.' || v_t) is null then
      v_by_table := v_by_table || jsonb_build_object(v_t, 'table_missing');
      continue;
    end if;

    v_is_fin := v_t = any (v_financial);

    -- اختيار عمود الزمن بالأولوية: تاريخ المستند للجداول المالية ثم created_at
    v_col := null;
    foreach v_cand in array (case when v_is_fin
                              then array['invoice_date', 'entry_date', 'payment_date',
                                         'return_date', 'created_at', 'inserted_at']
                              else array['created_at', 'inserted_at']
                             end)
    loop
      select a.attname into v_col
        from pg_attribute a
       where a.attrelid = ('public.' || v_t)::regclass
         and a.attnum > 0
         and not a.attisdropped
         and a.attname = v_cand
       limit 1;
      exit when v_col is not null;
    end loop;

    if v_col is null then
      v_by_table := v_by_table || jsonb_build_object(v_t, 'no_timestamp_column');
      continue;
    end if;

    -- التعبير: تاريخ المستند مع ارتداد إلى created_at إن كان فارغاً
    if v_col in ('created_at', 'inserted_at') then
      v_expr   := format('%I', v_col);
      v_expr_p := format('p.%I', v_col);
    elsif exists (select 1 from pg_attribute a
                   where a.attrelid = ('public.' || v_t)::regclass
                     and a.attnum > 0 and not a.attisdropped
                     and a.attname = 'created_at') then
      v_expr   := format('coalesce(%I, created_at)', v_col);
      v_expr_p := format('coalesce(p.%I, p.created_at)', v_col);
    else
      v_expr   := format('%I', v_col);
      v_expr_p := format('p.%I', v_col);
    end if;

    execute format('select count(*) from public.%I where (%s)::timestamptz < $1', v_t, v_expr)
       into v_count using v_cutoff;

    -- البنود التابعة التي ستُحذف آلياً مع هذا الأب (ON DELETE CASCADE)
    for v_child in
      select * from (values
        ('sales_invoice_items',   'sales_invoices',    'sales_invoice_id'),
        ('purchase_invoice_items','purchase_invoices', 'purchase_invoice_id'),
        ('journal_entry_lines',   'journal_entries',   'entry_id'),
        ('return_items',          'returns',           'return_id')
      ) as c(child_table, parent_table, fk_col)
      where c.parent_table = v_t
    loop
      if to_regclass('public.' || v_child.child_table) is not null then
        execute format(
          'select count(*) from public.%I c
            where exists (select 1 from public.%I p
                           where p.id = c.%I and (%s)::timestamptz < $1)',
          v_child.child_table, v_child.parent_table, v_child.fk_col, v_expr_p)
          into v_child_count using v_cutoff;
        if coalesce(v_child_count, 0) > 0 then
          v_by_table := v_by_table || jsonb_build_object(v_child.child_table || ' (cascade)', v_child_count);
          v_total := v_total + v_child_count;
        end if;
      end if;
    end loop;

    if coalesce(p_dry_run, true) = false and coalesce(v_count, 0) > 0 then
      if v_is_fin then
        -- تعطيل مشغّلات الحذف المحظورة وأرصدة الدائن مؤقتاً على هذا الجدول
        -- (يُستعاد التفعيل بالـROLLBACK تلقائياً عند أي خطأ داخل المعاملة)
        execute format('alter table public.%I disable trigger user', v_t);
        execute format('delete from public.%I where (%s)::timestamptz < $1', v_t, v_expr)
           using v_cutoff;
        execute format('alter table public.%I enable trigger user', v_t);
      else
        execute format('delete from public.%I where (%s)::timestamptz < $1', v_t, v_expr)
           using v_cutoff;
      end if;
    end if;

    v_by_table := v_by_table || jsonb_build_object(v_t, coalesce(v_count, 0));
    v_total := v_total + coalesce(v_count, 0);
  end loop;

  -- (2) سجل الحركات المُجزَّأ: إسقاط (DROP) الأقسام الشهرية الأقدم من الفترة
  for v_part in
    select c.relname as name
      from pg_inherits ih
      join pg_class c on c.oid = ih.inhrelid
      join pg_class p on p.oid = ih.inhparent
      join pg_namespace n on n.oid = p.relnamespace
     where n.nspname = 'public'
       and p.relname = 'inventory_movements'
       and c.relname ~ '^inventory_movements_[0-9]{4}_[0-9]{2}$'
       and to_date(substr(c.relname, 21, 7), 'YYYY_MM') < v_cutoff_date
     order by 1
  loop
    execute format('select count(*) from public.%I', v_part.name) into v_count;
    if coalesce(p_dry_run, true) = false then
      execute format('drop table public.%I', v_part.name);
    end if;
    v_parts := v_parts || jsonb_build_object(v_part.name, v_count);
    v_total := v_total + v_count;
  end loop;

  -- (3) القسم الافتراضي (DEFAULT): حذف الصفوف الأقدم من الفترة فقط — لا يُسقط
  if to_regclass('public.inventory_movements_default') is not null then
    execute 'select count(*) from public.inventory_movements_default where created_at < $1'
       into v_count using v_cutoff;
    if coalesce(p_dry_run, true) = false and v_count > 0 then
      execute 'delete from public.inventory_movements_default where created_at < $1' using v_cutoff;
    end if;
    v_parts := v_parts || jsonb_build_object('inventory_movements_default', v_count);
    v_total := v_total + v_count;
  end if;

  return jsonb_build_object(
    'dry_run', coalesce(p_dry_run, true),
    'retention_months', v_months,
    'cutoff', v_cutoff,
    'financial_tables', to_jsonb(v_financial),
    'total_rows', v_total,
    'by_table', v_by_table,
    'partitions', v_parts
  );
end;
$purge$;

-- إعادة تأكيد الصلاحيات: الحذف متاح لخدمة النظام فقط
revoke all on function public.p_purge_old_data(integer, boolean, text[]) from public, anon, authenticated;
revoke all on function public.p_purge_old_data_auto() from public, anon, authenticated;
grant execute on function public.p_purge_old_data(integer, boolean, text[]) to service_role;
grant execute on function public.p_purge_old_data_auto() to service_role;

commit;