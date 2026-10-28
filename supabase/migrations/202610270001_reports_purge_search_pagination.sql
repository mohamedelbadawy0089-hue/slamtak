-- ===========================================================================
-- slamtak — تحديث نظام البيانات والتقارير (2026-10-27)
--
-- 1) الحذف التلقائي (Auto-Purge) للبيانات التي يتجاوز عمرها 12 شهراً
--    - جدولة يومية عبر pg_cron الساعة 03:00
--    - يشمل: سجل الحركات (بإسقاط الأقسام القديمة) + سجلات النظام
--    - لا يشمل السجلات المالية (فواتير/قيود/مقبوضات) لأنها سجلات محاسبية
--      يجب حفظها؛ التحكم بها يتم يدوياً وليس حذفاً تلقائياً.
--    (عُدِّل لاحقاً: صار يشملها أيضاً — انظر 202610270002_purge_financial_records.sql
--     الذي يستبدل دالة p_purge_old_data بنسخة تشمل الجداول المالية بلا استثناء.)
--
-- 2) دوال تقارير تعمل على الخادم (SECURITY INVOKER = تُحترم RLS):
--    تُتيح فلترة دقيقة (يوم محدد / شهر محدد / فترة من–إلى) + بحث نصي
--    + ترقيم صفحات (Pagination) بدون حدود عددية ثابتة في الواجهة.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) دالة الحذف التلقائي
-- ---------------------------------------------------------------------------
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
  v_targets     text[] := coalesce(p_tables, array[
                    'audit_logs', 'import_logs', 'notifications', 'login_pins',
                    'refresh_tokens', 'password_reset_tokens']);
  v_t           text;
  v_col         text;
  v_count       bigint;
  v_total       bigint := 0;
  v_by_table    jsonb := '{}'::jsonb;
  v_parts       jsonb := '{}'::jsonb;
  v_part        record;
begin
  -- (1) جداول السجلات: حذف مباشر حسب created_at (أو inserted_at)
  foreach v_t in array v_targets loop
    if to_regclass('public.' || v_t) is null then
      v_by_table := v_by_table || jsonb_build_object(v_t, 'table_missing');
      continue;
    end if;

    select a.attname into v_col
      from pg_attribute a
     where a.attrelid = ('public.' || v_t)::regclass
       and a.attnum > 0
       and not a.attisdropped
       and a.attname in ('created_at', 'inserted_at')
     order by case a.attname when 'created_at' then 0 else 1 end
     limit 1;

    if v_col is null then
      v_by_table := v_by_table || jsonb_build_object(v_t, 'no_timestamp_column');
      continue;
    end if;

    execute format('select count(*) from public.%I where %I < $1', v_t, v_col)
       into v_count using v_cutoff;

    if coalesce(p_dry_run, true) = false and v_count > 0 then
      execute format('delete from public.%I where %I < $1', v_t, v_col) using v_cutoff;
    end if;

    v_by_table := v_by_table || jsonb_build_object(v_t, v_count);
    v_total := v_total + v_count;
  end loop;

  -- (2) سجل الحركات المُجزَّأ: إسقاط (DROP) الأقسام الشهرية الأقدم من الفترة
  --     أسرع بكثير من حذف الصفوف، ويتناول ملايين الصفوف إن وُجدت.
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
    'total_rows', v_total,
    'by_table', v_by_table,
    'partitions', v_parts
  );
end;
$purge$;

-- النسخة التي تشغّلها الجدولة التلقائية: حذف فعلي دائماً بفترة 12 شهراً
create or replace function public.p_purge_old_data_auto() returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $auto$
begin
  return public.p_purge_old_data(12, false, null);
end;
$auto$;

-- الصلاحيات: الحذف متاح لخدمة النظام فقط، ولا يُمنح للمستخدمين
revoke all on function public.p_purge_old_data(integer, boolean, text[]) from public, anon, authenticated;
revoke all on function public.p_purge_old_data_auto() from public, anon, authenticated;
grant execute on function public.p_purge_old_data(integer, boolean, text[]) to service_role;
grant execute on function public.p_purge_old_data_auto() to service_role;

-- جدولة يومية 03:00 عبر pg_cron (إن وُجد) — بدون تكرار للوظيفة
do $schedule$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'cron' and p.proname = 'schedule') then
    if not exists (select 1 from cron.job where jobname = 'slamtak_purge_old_data') then
      perform cron.schedule('slamtak_purge_old_data', '0 3 * * *',
                            'select public.p_purge_old_data_auto();');
    end if;
  end if;
end;
$schedule$;

-- ---------------------------------------------------------------------------
-- 2) دوال التقارير (تعمل على الخادم مع RLS — لا تحمّل جدولاً كاملاً للواجهة)
-- ---------------------------------------------------------------------------

-- (أ) نظرة عامة: كل مؤشرات الفترة الحالية والسابقة + السلسلة اليومية (≤ 31 يوماً)
create or replace function public.report_overview(p_from date, p_to date)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $ov$
with bounds as (
  select coalesce(p_from, (current_date - 30)::date) as f,
         coalesce(p_to, current_date) as t
),
spans as (
  select f, t, (f - 1)::date as pf, (f - 1 - (t - f))::date as pt from bounds
),
sales_cur as (
  select count(*)::int as cnt,
         count(*) filter (where si.status in ('cancelled', 'void'))::int as cancelled,
         coalesce(sum(case when si.status in ('cancelled', 'void') then 0
                           else coalesce(si.total_amount, 0) end), 0)::numeric as total,
         coalesce(sum(case when si.status in ('cancelled', 'void') then 0
                           else coalesce(si.discount_amount, 0) end), 0)::numeric as discount,
         coalesce(sum(case when si.status in ('cancelled', 'void') then 0
                           else coalesce(si.tax_amount, 0) end), 0)::numeric as tax,
         coalesce(sum(case when si.status in ('cancelled', 'void') then 0
                           when coalesce(si.subtotal, 0) <> 0
                           then si.subtotal - coalesce(si.discount_amount, 0)
                           else coalesce(si.total_amount, 0) - coalesce(si.tax_amount, 0) end), 0)::numeric as net,
         coalesce(sum(case when si.status in ('cancelled', 'void') then 0
                           else coalesce(si.paid_amount, 0) end), 0)::numeric as paid
  from sales_invoices si, spans
  where coalesce(si.invoice_date, si.created_at::date) between spans.f and spans.t
),
sales_prev as (
  select count(*)::int as cnt,
         count(*) filter (where si.status in ('cancelled', 'void'))::int as cancelled,
         coalesce(sum(case when si.status in ('cancelled', 'void') then 0
                           else coalesce(si.total_amount, 0) end), 0)::numeric as total,
         coalesce(sum(case when si.status in ('cancelled', 'void') then 0
                           when coalesce(si.subtotal, 0) <> 0
                           then si.subtotal - coalesce(si.discount_amount, 0)
                           else coalesce(si.total_amount, 0) - coalesce(si.tax_amount, 0) end), 0)::numeric as net
  from sales_invoices si, spans
  where coalesce(si.invoice_date, si.created_at::date) between spans.pt and spans.pf
),
returns_cur as (
  select count(*)::int as cnt, coalesce(sum(coalesce(r.total_amount, 0)), 0)::numeric as total
  from returns r, spans
  where r.deleted_at is null
    and coalesce(r.return_date, r.created_at::date) between spans.f and spans.t
),
returns_prev as (
  select count(*)::int as cnt, coalesce(sum(coalesce(r.total_amount, 0)), 0)::numeric as total
  from returns r, spans
  where r.deleted_at is null
    and coalesce(r.return_date, r.created_at::date) between spans.pt and spans.pf
),
purchases_cur as (
  select count(*)::int as cnt, coalesce(sum(coalesce(po.total_amount, 0)), 0)::numeric as total
  from purchase_orders po, spans
  where po.deleted_at is null
    and coalesce(po.status, '') not in ('cancelled', 'rejected')
    and coalesce(po.order_date, po.created_at::date) between spans.f and spans.t
),
expenses_cur as (
  select count(*)::int as cnt, coalesce(sum(coalesce(e.amount, 0)), 0)::numeric as total
  from expenses e, spans
  where e.deleted_at is null
    and coalesce(e.expense_date, e.created_at::date) between spans.f and spans.t
),
collections_cur as (
  select count(*)::int as cnt, coalesce(sum(coalesce(p.amount, 0)), 0)::numeric as total
  from payments p, spans
  where p.deleted_at is null
    and coalesce(p.payment_date, p.created_at::date) between spans.f and spans.t
),
items_cur as (
  select count(*)::int as lines,
         coalesce(sum(coalesce(i.quantity, 0)), 0)::numeric as qty,
         coalesce(sum(coalesce(i.line_total, coalesce(i.quantity, 0) * coalesce(i.unit_price, 0))), 0)::numeric as revenue,
         coalesce(sum(case when i.cost_price is not null
                           then coalesce(i.quantity, 0) * i.cost_price else 0 end), 0)::numeric as cost,
         count(*) filter (where i.cost_price is not null)::int as cost_known
  from sales_invoice_items i, spans
  where i.created_at::date between spans.f and spans.t
),
items_prev as (
  select coalesce(sum(coalesce(i.line_total, coalesce(i.quantity, 0) * coalesce(i.unit_price, 0))), 0)::numeric as revenue,
         coalesce(sum(case when i.cost_price is not null
                           then coalesce(i.quantity, 0) * i.cost_price else 0 end), 0)::numeric as cost
  from sales_invoice_items i, spans
  where i.created_at::date between spans.pt and spans.pf
),
stock as (
  select coalesce(sum(case when iv.available_quantity is null then coalesce(iv.quantity, 0)
                           else iv.available_quantity end), 0)::numeric as qty,
         count(*)::int as batches,
         coalesce(sum((case when iv.available_quantity is null then coalesce(iv.quantity, 0)
                            else iv.available_quantity end) * coalesce(iv.unit_cost, iv.cost_price, 0)), 0)::numeric as cost,
         coalesce(sum((case when iv.available_quantity is null then coalesce(iv.quantity, 0)
                            else iv.available_quantity end) * coalesce(iv.selling_price, 0)), 0)::numeric as sell,
         count(*) filter (where iv.is_expired)::int as expired,
         count(*) filter (where iv.is_near_expiry)::int as expiring,
         count(*) filter (where iv.is_quarantined)::int as quarantined
  from inventory iv
),
daily as (
  select to_char(d, 'YYYY-MM-DD') as day,
         coalesce(sum(case when si.status in ('cancelled', 'void') then 0
                           else coalesce(si.total_amount, 0) end), 0)::numeric as total
  from spans
  cross join lateral generate_series(greatest(spans.f, spans.t - 30)::timestamp,
                                     spans.t::timestamp, interval '1 day') d
  left join sales_invoices si on coalesce(si.invoice_date, si.created_at::date) = d::date
  group by d
  order by d
)
select jsonb_build_object(
  'source', 'server',
  'period', jsonb_build_object('from', spans.f, 'to', spans.t,
                               'prev_from', spans.pt, 'prev_to', spans.pf),
  'sales', jsonb_build_object(
    'count', sc.cnt, 'cancelled', sc.cancelled, 'total', sc.total,
    'discount', sc.discount, 'tax', sc.tax, 'net', sc.net, 'paid', sc.paid,
    'due', sc.total - sc.paid,
    'avg', case when (sc.cnt - sc.cancelled) > 0
                then round(sc.total / (sc.cnt - sc.cancelled), 2) else 0 end),
  'prev_sales', jsonb_build_object(
    'count', sp.cnt, 'total', sp.total, 'net', sp.net,
    'avg', case when (sp.cnt - sp.cancelled) > 0
                then round(sp.total / (sp.cnt - sp.cancelled), 2) else 0 end),
  'returns', jsonb_build_object('count', rc.cnt, 'total', rc.total),
  'prev_returns', jsonb_build_object('count', rp.cnt, 'total', rp.total),
  'purchases', jsonb_build_object('count', pc.cnt, 'total', pc.total),
  'expenses', jsonb_build_object('count', ec.cnt, 'total', ec.total),
  'collections', jsonb_build_object('count', cc.cnt, 'total', cc.total),
  'items', jsonb_build_object(
    'lines', ic.lines, 'qty', ic.qty, 'revenue', ic.revenue, 'cost', ic.cost,
    'cost_known', ic.cost_known, 'profit', ic.revenue - ic.cost,
    'complete', (ic.lines > 0 and ic.cost_known = ic.lines)),
  'prev_items', jsonb_build_object('revenue', ip.revenue, 'cost', ip.cost,
                                   'profit', ip.revenue - ip.cost),
  'stock', jsonb_build_object(
    'qty', st.qty, 'batches', st.batches, 'cost', st.cost, 'sell', st.sell,
    'expired', st.expired, 'expiring', st.expiring, 'quarantined', st.quarantined),
  'daily', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'total', total) order by day)
                       from daily), '[]'::jsonb)
)
from spans, sales_cur sc, sales_prev sp, returns_cur rc, returns_prev rp,
     purchases_cur pc, expenses_cur ec, collections_cur cc,
     items_cur ic, items_prev ip, stock st;
$ov$;

-- (ب) صفحة فواتير مبيعات: فلترة (يوم/شهر/فترة) + بحث + ترقيم صفحات
create or replace function public.report_sales_page(
  p_from date, p_to date, p_search text default null,
  p_limit integer default 25, p_offset integer default 0
) returns jsonb
language sql
stable
set search_path = public, pg_temp
as $sales$
with bounds as (
  select coalesce(p_from, (current_date - 30)::date) as f,
         coalesce(p_to, current_date) as t
),
q as (
  select nullif(trim(p_search), '') as s
),
filtered as (
  select si.id,
         coalesce(si.invoice_number, si.id::text) as invoice_number,
         coalesce(si.invoice_date, si.created_at::date) as inv_date,
         coalesce(si.status, '') as status,
         coalesce(si.total_amount, 0) as total,
         coalesce(si.paid_amount, 0) as paid,
         coalesce(c.name_ar, c.name, '') as customer
    from sales_invoices si
    left join customers c on c.id = si.customer_id
    cross join bounds, q
   where coalesce(si.invoice_date, si.created_at::date) between bounds.f and bounds.t
     and (q.s is null
          or si.invoice_number ilike '%' || q.s || '%'
          or c.name ilike '%' || q.s || '%'
          or c.name_ar ilike '%' || q.s || '%')
)
select jsonb_build_object(
  'source', 'server',
  'total', (select count(*) from filtered),
  'rows', coalesce((select jsonb_agg(x order by inv_date desc, invoice_number desc) from (
      select jsonb_build_object('id', f.id, 'invoice_number', f.invoice_number,
                                'date', f.inv_date, 'status', f.status,
                                'total', f.total, 'paid', f.paid, 'customer', f.customer) as x,
             f.inv_date as inv_date,
             f.invoice_number as invoice_number
        from filtered f
       order by f.inv_date desc, f.invoice_number desc
       limit greatest(coalesce(p_limit, 25), 1)
       offset greatest(coalesce(p_offset, 0), 0)
    ) t), '[]'::jsonb)
);
$sales$;

-- (ج) أفضل الأصناف مبيعاً خلال الفترة (للترتيب حسب الإيراد)
create or replace function public.report_top_products(
  p_from date, p_to date, p_limit integer default 15
) returns jsonb
language sql
stable
set search_path = public, pg_temp
as $top$
with bounds as (
  select coalesce(p_from, (current_date - 30)::date) as f,
         coalesce(p_to, current_date) as t
),
agg as (
  select i.product_id,
         sum(coalesce(i.quantity, 0))::numeric as qty,
         sum(coalesce(i.line_total, coalesce(i.quantity, 0) * coalesce(i.unit_price, 0)))::numeric as revenue,
         sum(case when i.cost_price is not null
                  then coalesce(i.quantity, 0) * (coalesce(i.unit_price, 0) - i.cost_price)
                  else 0 end)::numeric as profit,
         count(*)::int as lines,
         count(*) filter (where i.cost_price is not null)::int as cost_known
  from sales_invoice_items i, bounds
  where i.created_at::date between bounds.f and bounds.t
    and i.product_id is not null
  group by i.product_id
)
select coalesce(jsonb_agg(x order by revenue desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
             'product_id', a.product_id,
             'name', coalesce(p.name_ar, p.name, a.product_id::text),
             'qty', a.qty, 'revenue', a.revenue, 'profit', a.profit,
             'lines', a.lines, 'complete', (a.lines = a.cost_known)) as x,
           a.revenue
      from agg a
      left join products p on p.id = a.product_id
     order by a.revenue desc
     limit greatest(coalesce(p_limit, 15), 1)
  ) t;
$top$;

-- (د) ملخّص قيمة المخزون (لمؤشرات لوحة المخزون)
create or replace function public.report_stock_summary()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $sum$
with agg as (
  select count(*)::int as batches,
         count(distinct iv.product_id)::int as products,
         coalesce(sum(case when iv.available_quantity is null then coalesce(iv.quantity, 0)
                           else iv.available_quantity end), 0)::numeric as qty,
         coalesce(sum((case when iv.available_quantity is null then coalesce(iv.quantity, 0)
                            else iv.available_quantity end) * coalesce(iv.unit_cost, iv.cost_price, 0)), 0)::numeric as cost,
         coalesce(sum((case when iv.available_quantity is null then coalesce(iv.quantity, 0)
                            else iv.available_quantity end) * coalesce(iv.selling_price, 0)), 0)::numeric as sell,
         count(*) filter (where iv.is_expired)::int as expired,
         count(*) filter (where iv.is_near_expiry)::int as expiring,
         count(*) filter (where iv.is_quarantined)::int as quarantined
  from inventory iv
),
low as (
  select count(*)::int as n
    from (
      select iv.product_id,
             sum(case when iv.available_quantity is null then coalesce(iv.quantity, 0)
                      else iv.available_quantity end) as qty,
             coalesce(p.min_stock_level, 0) as minl
        from inventory iv
        left join products p on p.id = iv.product_id
       group by iv.product_id, p.min_stock_level
      having coalesce(p.min_stock_level, 0) > 0
         and sum(case when iv.available_quantity is null then coalesce(iv.quantity, 0)
                      else iv.available_quantity end) <= coalesce(p.min_stock_level, 0)
    ) t
)
select jsonb_build_object(
  'source', 'server',
  'qty', a.qty, 'batches', a.batches, 'products', a.products,
  'cost', a.cost, 'sell', a.sell,
  'expired', a.expired, 'expiring', a.expiring, 'quarantined', a.quarantined,
  'low_stock', l.n
)
from agg a, low l;
$sum$;

-- (هـ) صفحة أصناف المخزون: بحث بالاسم/الكود + ترقيم صفحات (تجميع على الخادم)
create or replace function public.report_stock_page(
  p_search text default null,
  p_limit integer default 25, p_offset integer default 0
) returns jsonb
language sql
stable
set search_path = public, pg_temp
as $stockpage$
with per_product as (
  select iv.product_id,
         sum(case when iv.available_quantity is null then coalesce(iv.quantity, 0)
                  else iv.available_quantity end)::numeric as qty,
         sum(coalesce(iv.reserved_quantity, 0))::numeric as reserved,
         count(*)::int as batches,
         sum((case when iv.available_quantity is null then coalesce(iv.quantity, 0)
                   else iv.available_quantity end) * coalesce(iv.unit_cost, iv.cost_price, 0))::numeric as cost,
         sum((case when iv.available_quantity is null then coalesce(iv.quantity, 0)
                   else iv.available_quantity end) * coalesce(iv.selling_price, 0))::numeric as sell,
         count(*) filter (where iv.is_expired)::int as expired,
         count(*) filter (where iv.is_near_expiry)::int as expiring,
         count(*) filter (where iv.is_quarantined)::int as quarantined,
         min(iv.expiry_date)::date as first_expiry
    from inventory iv
   group by iv.product_id
),
q as (
  select nullif(trim(p_search), '') as s
),
filtered as (
  select pp.*,
         coalesce(p.name_ar, p.name, pp.product_id::text) as name,
         coalesce(p.sku, p.barcode, '') as sku,
         coalesce(p.unit_of_measure, '') as unit,
         coalesce(p.min_stock_level, 0) as min_stock
    from per_product pp
    left join products p on p.id = pp.product_id
    cross join q
   where q.s is null
      or p.name ilike '%' || q.s || '%'
      or p.name_ar ilike '%' || q.s || '%'
      or p.sku ilike '%' || q.s || '%'
      or p.barcode ilike '%' || q.s || '%'
)
select jsonb_build_object(
  'source', 'server',
  'total', (select count(*) from filtered),
  'rows', coalesce((select jsonb_agg(x order by cost desc) from (
      select jsonb_build_object('product_id', f.product_id, 'name', f.name, 'sku', f.sku,
                                'unit', f.unit, 'qty', f.qty, 'reserved', f.reserved,
                                'batches', f.batches, 'cost', f.cost, 'sell', f.sell,
                                'min_stock', f.min_stock, 'expired', f.expired,
                                'expiring', f.expiring, 'quarantined', f.quarantined,
                                'first_expiry', f.first_expiry) as x,
             f.cost
        from filtered f
       order by f.cost desc
       limit greatest(coalesce(p_limit, 25), 1)
       offset greatest(coalesce(p_offset, 0), 0)
    ) t), '[]'::jsonb)
);
$stockpage$;

-- (و) صفحة المنتجات الراكدة: تصنيف على الخادم + بحث + ترقيم صفحات
create or replace function public.report_stagnant_page(
  p_stale_days integer default 90,
  p_search text default null,
  p_limit integer default 25, p_offset integer default 0
) returns jsonb
language sql
stable
set search_path = public, pg_temp
as $stagnant$
with stale as (
  select greatest(coalesce(p_stale_days, 90), 1) as d
),
stock as (
  select iv.product_id,
         sum(case when iv.available_quantity is null then coalesce(iv.quantity, 0)
                  else iv.available_quantity end)::numeric as qty,
         sum((case when iv.available_quantity is null then coalesce(iv.quantity, 0)
                   else iv.available_quantity end) * coalesce(iv.unit_cost, iv.cost_price, 0))::numeric as cost,
         sum((case when iv.available_quantity is null then coalesce(iv.quantity, 0)
                   else iv.available_quantity end) * coalesce(iv.selling_price, 0))::numeric as sell
    from inventory iv
   group by iv.product_id
),
last_move as (
  select product_id, max(created_at::date) as last_activity
    from inventory_movements
   group by product_id
),
last_sale as (
  select i.product_id,
         max(i.created_at::date) as last_sale,
         sum(case when i.created_at >= now() - interval '90 days'
                  then coalesce(i.quantity, 0) else 0 end)::numeric as sold90
    from sales_invoice_items i
   where i.product_id is not null
   group by i.product_id
),
base as (
  select st.product_id, st.qty, st.cost, st.sell,
         greatest(coalesce(lm.last_activity, date '1900-01-01'),
                  coalesce(ls.last_sale, date '1900-01-01')) as last_activity,
         ls.last_sale,
         coalesce(ls.sold90, 0) as sold90,
         case when coalesce(ls.sold90, 0) > 0 then coalesce(ls.sold90, 0) / 90.0 end as avg_daily
    from stock st
    left join last_move lm on lm.product_id = st.product_id
    left join last_sale ls on ls.product_id = st.product_id
),
classified as (
  select b.*,
         case when b.qty <= 0 then 'out'
              when b.last_activity < (current_date - stale.d) then 'stagnant'
              when b.sold90 = 0 then 'slow'
              when b.avg_daily > 0 and b.qty / b.avg_daily >= 90 then 'overstock'
         end as kind
    from base b, stale
),
q as (
  select nullif(trim(p_search), '') as s
),
filtered as (
  select c.*, coalesce(p.name_ar, p.name, c.product_id::text) as name,
         coalesce(p.sku, p.barcode, '') as sku,
         coalesce(p.prescription_required, false) as prescription_required
    from classified c
    left join products p on p.id = c.product_id
    cross join q
   where c.kind is not null
     and (q.s is null
          or p.name ilike '%' || q.s || '%'
          or p.name_ar ilike '%' || q.s || '%'
          or p.sku ilike '%' || q.s || '%')
),
agg as (
  select count(*)::int as total,
         count(*) filter (where kind = 'stagnant')::int as stagnant_count,
         coalesce(sum(cost) filter (where kind = 'stagnant'), 0)::numeric as stagnant_value,
         count(*) filter (where kind = 'out')::int as out_count,
         count(*) filter (where kind = 'slow')::int as slow_count,
         count(*) filter (where kind = 'overstock')::int as overstock_count,
         coalesce(avg(current_date - last_activity) filter (where kind = 'stagnant'), 0)::numeric as avg_idle
    from filtered
)
select jsonb_build_object(
  'source', 'server',
  'total', (select total from agg),
  'agg', (select to_jsonb(a) from agg a),
  'rows', coalesce((select jsonb_agg(x order by cost desc) from (
      select jsonb_build_object(
               'product_id', f.product_id, 'name', f.name, 'sku', f.sku,
               'qty', f.qty, 'cost', f.cost, 'sell', f.sell,
               'last_activity', f.last_activity, 'last_sale', f.last_sale,
               'idle', case when f.last_activity = date '1900-01-01' then null
                            else (current_date - f.last_activity) end,
               'sold90', f.sold90, 'avg_daily', round(coalesce(f.avg_daily, 0), 3),
               'cover', case when f.avg_daily is null or f.avg_daily = 0 then null
                             else round(f.qty / f.avg_daily) end,
               'kind', f.kind, 'prescription_required', f.prescription_required) as x,
             f.cost
        from filtered f
       order by f.cost desc
       limit greatest(coalesce(p_limit, 25), 1)
       offset greatest(coalesce(p_offset, 0), 0)
    ) t), '[]'::jsonb)
);
$stagnant$;

-- ---------------------------------------------------------------------------
-- الصلاحيات: دوال التقارير للمستخدمين المصادقين فقط (RLS تُفرض داخلها)
-- ---------------------------------------------------------------------------
do $grants$
declare fn text;
begin
  foreach fn in array array[
    'report_overview(date,date)',
    'report_sales_page(date,date,text,integer,integer)',
    'report_top_products(date,date,integer)',
    'report_stock_summary()',
    'report_stock_page(text,integer,integer)',
    'report_stagnant_page(integer,text,integer,integer)'
  ] loop
    execute 'revoke all on function public.' || fn || ' from public, anon';
    execute 'grant execute on function public.' || fn || ' to authenticated, service_role';
  end loop;
end;
$grants$;

commit;