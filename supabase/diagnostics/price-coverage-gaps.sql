-- ============================================================================
-- تشخيص فجوات السعر المرجعي — قراءة فقط، من Supabase → SQL Editor.
--
-- app.post_sale يرفض بيع أي صنف بلا سعر في قائمة البيع الافتراضية
-- (SALE_PRICE_REFERENCE_MISSING)، ويرفض سعرًا أدنى من المرجع
-- (SALE_PRICE_BELOW_REFERENCE). الهجرة 20261108000003 تُزوّد القائمة والأسعار،
-- وهذا الملف يكشف ما بقي بعدها: مخزن بلا افتراضية، صنف بلا وحدة بيع صالحة،
-- صنف بلا سعر، وسعر بيع تحت التكلفة.
--
-- كل الاستعلامات SELECT فقط: لا كتابة ولا تغيير مخطط. ترتيب الأقسام مقصود:
-- أول قسم يعطي نتيجة غير متوقعة هو سبب تعطّل البيع المرشّح.
--
-- ملاحظة: الأعمدة هنا تخص مخطط 20261108 (medicine_id/unit_id/price). المخطط
-- الحيّ الأقدم (price_list_items.product_id/unit_price) يحتاج نسخة معدّلة.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) شرط البيع الأول: قائمة افتراضية واحدة لكل مخزن.
--    المتوقع: صفر صفوف في 1a و1b، وعدد الافتراضيات = عدد المخازن.
-- ---------------------------------------------------------------------------
select '1a) مخازن بلا قائمة افتراضية' as section, t.id as tenant_id, t.slug
from public.tenants t
where not exists (
  select 1 from public.price_lists pl
   where pl.tenant_id = t.id and pl.is_default
);

select '1b) مخازن بأكثر من قائمة افتراضية' as section,
       pl.tenant_id, count(*) as defaults,
       string_agg(pl.code, ', ' order by pl.code) as codes
from public.price_lists pl
where pl.is_default
group by pl.tenant_id
having count(*) > 1;

select '1c) الملخص' as section,
       (select count(*) from public.tenants) as tenants,
       (select count(*) from public.price_lists where is_default) as default_lists;


-- ---------------------------------------------------------------------------
-- 2) الأصناف النشطة بلا وحدة بيع صالحة.
--    وحدة البيع في التزويد: الأساسية (is_base) أو الوحيدة. صنف بلا وحدات أو
--    بوحدتين بلا أساسية لا يمكن تسعيره بلا تخمين.
--    المتوقع: صفر صفوف (كل صنف له وحدة أساسية).
-- ---------------------------------------------------------------------------
select '2) أصناف بلا وحدة بيع صالحة' as section,
       m.tenant_id, m.sku, m.trade_name_ar,
       count(mu.id) as units,
       count(*) filter (where mu.is_base) as base_units
from public.medicines m
left join public.medicine_units mu
  on mu.tenant_id = m.tenant_id and mu.medicine_id = m.id
where m.is_active
group by m.tenant_id, m.id, m.sku, m.trade_name_ar
having count(mu.id) = 0
    or (count(*) filter (where mu.is_base) = 0 and count(mu.id) > 1)
order by m.tenant_id, m.sku;


-- ---------------------------------------------------------------------------
-- 3) أصناف نشطة لها وحدة بيع وبلا سعر مرجعي — البيع منها سيُرَد الآن.
--    qty_on_hand يبيّن الأثر التجاري: صنف عليه رصيد بلا سعر = بيع متوقف فعلًا.
--    المتوقع: صفر صفوف، أو صفوف بمخزون صفر تُسعَّر قبل أول بيع.
-- ---------------------------------------------------------------------------
select '3) أصناف بلا سعر مرجعي' as section,
       m.tenant_id, m.sku, m.trade_name_ar, m.is_active,
       coalesce(stock.qty_on_hand, 0) as qty_on_hand
from public.medicines m
join lateral (
  select case
           when bool_or(mu.is_base) then
             (array_agg(mu.unit_id order by mu.is_base desc, mu.factor, mu.unit_id))[1]
           when count(*) = 1 then (array_agg(mu.unit_id))[1]
         end as unit_id
    from public.medicine_units mu
   where mu.tenant_id = m.tenant_id and mu.medicine_id = m.id
) su on true
left join lateral (
  select sum(sb.qty_on_hand) as qty_on_hand
    from public.stock_batches sb
   where sb.tenant_id = m.tenant_id and sb.medicine_id = m.id
) stock on true
where m.is_active
  and su.unit_id is not null
  and not exists (
    select 1
      from public.price_lists pl
      join public.price_list_items pli
        on pli.tenant_id = pl.tenant_id and pli.price_list_id = pl.id
     where pl.tenant_id = m.tenant_id
       and pl.is_default
       and pli.medicine_id = m.id
  )
order by coalesce(stock.qty_on_hand, 0) desc, m.sku;


-- ---------------------------------------------------------------------------
-- 4) سعر مرجعي تحت التكلفة — بيع بخسارة مقصودة أو سعر قديم لم يُحدَّث.
--    التكلفة: المتوسط المرجّح للمخزون القائم، وإلا آخر تكلفة تشغيلة (كما في
--    هجرة التزويد). المتوقع: صفر صفوف، أو صفوف بقرار تجاري معروف.
-- ---------------------------------------------------------------------------
with avg_cost as (
  select tenant_id, medicine_id,
         sum(qty_on_hand * unit_cost) / nullif(sum(qty_on_hand), 0) as cost
    from public.stock_batches
   group by tenant_id, medicine_id
  having sum(qty_on_hand) > 0
),
last_cost as (
  select distinct on (tenant_id, medicine_id)
         tenant_id, medicine_id, unit_cost as cost
    from public.stock_batches
   order by tenant_id, medicine_id, updated_at desc, id desc
)
select '4) سعر مرجعي تحت التكلفة' as section,
       pli.tenant_id, m.sku, m.trade_name_ar,
       pli.price as reference_price,
       round(coalesce(ac.cost, lc.cost), 2) as cost,
       round(coalesce(ac.cost, lc.cost) - pli.price, 2) as loss_per_unit
from public.price_lists pl
join public.price_list_items pli
  on pli.tenant_id = pl.tenant_id and pli.price_list_id = pl.id
join public.medicines m
  on m.tenant_id = pli.tenant_id and m.id = pli.medicine_id
left join avg_cost ac
  on ac.tenant_id = pli.tenant_id and ac.medicine_id = pli.medicine_id
left join last_cost lc
  on lc.tenant_id = pli.tenant_id and lc.medicine_id = pli.medicine_id
where pl.is_default
  and coalesce(ac.cost, lc.cost) is not null
  and pli.price < coalesce(ac.cost, lc.cost)
order by round(coalesce(ac.cost, lc.cost) - pli.price, 2) desc;


-- ---------------------------------------------------------------------------
-- 5) أسعار صفرية في القائمة الافتراضية — تسمح بالبيع مجانًا ولا تُنشئها الهجرة.
--    المتوقع: صفر صفوف.
-- ---------------------------------------------------------------------------
select '5) أسعار صفرية' as section,
       pli.tenant_id, m.sku, m.trade_name_ar, pli.unit_id, pli.price
from public.price_lists pl
join public.price_list_items pli
  on pli.tenant_id = pl.tenant_id and pli.price_list_id = pl.id
join public.medicines m
  on m.tenant_id = pli.tenant_id and m.id = pli.medicine_id
where pl.is_default
  and pli.price <= 0
order by m.sku;


-- ---------------------------------------------------------------------------
-- 6) تغطية لكل مخزن في سطر واحد.
--    المتوقع: priced = active_medicines، وgaps = 0.
-- ---------------------------------------------------------------------------
select '6) التغطية لكل مخزن' as section,
       t.slug,
       (select count(*) from public.medicines m
         where m.tenant_id = t.id and m.is_active) as active_medicines,
       (select count(distinct pli.medicine_id)
          from public.price_lists pl
          join public.price_list_items pli
            on pli.tenant_id = pl.tenant_id and pli.price_list_id = pl.id
         where pl.tenant_id = t.id and pl.is_default) as priced_medicines,
       (select count(*)
          from public.medicines m
         where m.tenant_id = t.id and m.is_active
           and not exists (
             select 1
               from public.price_lists pl
               join public.price_list_items pli
                 on pli.tenant_id = pl.tenant_id and pli.price_list_id = pl.id
              where pl.tenant_id = m.tenant_id and pl.is_default
                and pli.medicine_id = m.id
           )) as gaps
from public.tenants t
order by t.slug;
