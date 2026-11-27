-- ============================================================================
-- تشخيص جاهزية مخطط الإنتاج الحيّ للترحيل — قراءة فقط.
--
-- يعطي الأرقام التي يُبنى عليها قرار «تحويل في المكان أم استيراد إلى قاعدة
-- جديدة»:
--   1) عدد المخازن لكل حساب (قيد ADR-025: مخزن واحد لكل حساب).
--   2) تكرار القوائم الافتراضية (وحسابات بلا قائمة افتراضية).
--   3) صفوف الأسعار لكل صنف وقائمة (وشرائح الكمية والصلاحية).
--   4) الأصناف النشطة بلا سعر في قائمة افتراضية، مرتبة بقيمة المخزون المعرّضة.
--   5) مجموع كمية وقيمة inventory.
--   6) ملخص القرار: سطر لكل حساب.
--   7) اللوحة الإجمالية: سطر واحد بكل الأرقام للمقارنة بعد الترحيل.
--
-- يُنفَّذ في Supabase → SQL Editor (اتصال مباشر بالقاعدة، لا يمرّ على PostgREST).
-- كل الاستعلامات SELECT فقط: لا INSERT/UPDATE/DELETE ولا CREATE/ALTER/DROP ولا
-- دوال تغيّر حالة. لا تُنفّذ الملف من التطبيق ولا عبر REST.
--
-- الأعمدة هنا هي أعمدة المخطط الحيّ الفعلية كما في artifacts/db-tables-audit.json:
--   price_list_items: product_id, price, unit_price, min_qty, min_quantity,
--                     is_active, valid_from, valid_until, cost_price
--   price_lists:      tenant_id, warehouse_id, code, name, name_ar, is_default, is_active
--   products:         tenant_id, warehouse_id, sku, name, name_ar, unit_of_measure,
--                     is_active, deleted_at
--   inventory:        tenant_id, warehouse_id, product_id, quantity, available_quantity,
--                     unit_cost, cost_price, selling_price
-- إن غاب عمود في نسختك يظهر خطأ يسمّيه؛ أرسل اسمه وأعدّل الملف.
--
-- السعر الفعّال في كل مكان هنا = coalesce(unit_price, price): الواجهة تكتب
-- الاثنين بالقيمة نفسها، لكن `unit_price` هو ما يقرأه كتالوج البيع.
-- والحذف المنطقي (deleted_at) يُستبعد، وكذلك الصفوف غير النشطة حيث ينطبق.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) المخازن لكل حساب.
--    1a المتوقع: صف لكل حساب، والمعيار = 1.
--    1b أي صف هنا = عائق أمام الاستيراد إلى مخطط يفرض مخزنًا واحدًا (ADR-025)،
--       ويحتاج قرارًا: تقسيم الحساب أو حسم مخازنه.
-- ---------------------------------------------------------------------------
select '1a) المخازن لكل حساب' as section,
       t.id                                            as tenant_id,
       coalesce(t.name_ar, t.name)                      as tenant_name,
       count(w.id) filter (
         where w.deleted_at is null and coalesce(w.is_active, true)
       )                                                as active_warehouses,
       count(w.id) filter (where w.deleted_at is null)  as warehouses_total,
       string_agg(w.name, ' | ' order by w.name) filter (
         where w.deleted_at is null
       )                                                as warehouse_names
from public.tenants t
left join public.warehouses w on w.tenant_id = t.id
where t.deleted_at is null
group by t.id, t.name, t.name_ar
order by active_warehouses desc, tenant_name;

select '1b) حسابات بأكثر من مخزن نشط' as section,
       t.id as tenant_id,
       coalesce(t.name_ar, t.name) as tenant_name,
       count(*) as active_warehouses
from public.warehouses w
join public.tenants t on t.id = w.tenant_id
where w.deleted_at is null
  and coalesce(w.is_active, true)
  and t.deleted_at is null
group by t.id, t.name, t.name_ar
having count(*) > 1
order by active_warehouses desc, tenant_name;


-- ---------------------------------------------------------------------------
-- 2) القوائم الافتراضية.
--    2a المتوقع: صفر صفوف. أي صف = أكثر من افتراضية، والاستيراد سيختار واحدة.
--    2b المتوقع: صفر صفوف. أي صف = حساب بلا افتراضية، فكل أصنافه بلا سعر مرجعي.
-- ---------------------------------------------------------------------------
select '2a) تكرار القوائم الافتراضية' as section,
       pl.tenant_id,
       count(*) as default_lists,
       string_agg(
         coalesce(pl.code, '-') || ':' || coalesce(pl.name_ar, pl.name),
         ' | ' order by pl.id
       ) as lists
from public.price_lists pl
where coalesce(pl.is_default, false)
  and coalesce(pl.is_active, true)
group by pl.tenant_id
having count(*) > 1
order by default_lists desc, pl.tenant_id;

select '2b) حسابات بلا قائمة افتراضية' as section,
       t.id as tenant_id,
       coalesce(t.name_ar, t.name) as tenant_name,
       (select count(*) from public.price_lists pl where pl.tenant_id = t.id) as price_lists_total,
       (select count(*) from public.price_lists pl where pl.tenant_id = t.id
         and coalesce(pl.is_active, true)) as price_lists_active
from public.tenants t
where t.deleted_at is null
  and not exists (
    select 1 from public.price_lists pl
     where pl.tenant_id = t.id
       and coalesce(pl.is_default, false)
       and coalesce(pl.is_active, true)
  )
order by tenant_name;


-- ---------------------------------------------------------------------------
-- 3) صفوف الأسعار لكل صنف وقائمة.
--    3a صورة كل قائمة: عدد الصفوف والأصناف والأسعار الصفرية والمدى السعري.
--    3b أصناف لها أكثر من صف في القائمة نفسها = شرائح كمية (min_qty > 1)،
--       والمخطط الجديد لا يمثّلها: القرار أي صف يمثّل السعر.
--    3b-عينة أول 50 صفًا منها، تُقرأ بالعين لاختيار القاعدة.
--    3c صفوف خارج نافذة الصلاحية أو موقوفة (مرشّحة للاستبعاد عند الاستيراد).
-- ---------------------------------------------------------------------------
select '3a) صفوف الأسعار لكل قائمة' as section,
       pl.tenant_id,
       coalesce(pl.code, '-')                  as list_code,
       coalesce(pl.name_ar, pl.name)           as list_name,
       coalesce(pl.is_default, false)          as is_default,
       coalesce(pl.is_active, true)            as list_active,
       count(*)                                as price_rows,
       count(distinct pli.product_id)          as products,
       count(*) filter (where not coalesce(pli.is_active, true)) as inactive_rows,
       count(*) filter (where coalesce(pli.unit_price, pli.price, 0) <= 0) as zero_price_rows,
       min(coalesce(pli.unit_price, pli.price)) as min_price,
       max(coalesce(pli.unit_price, pli.price)) as max_price
from public.price_lists pl
join public.price_list_items pli on pli.price_list_id = pl.id
group by pl.tenant_id, pl.code, pl.name, pl.name_ar, pl.is_default, pl.is_active
order by pl.tenant_id, is_default desc, price_rows desc;

select '3b) شرائح الكمية (أكثر من صف للصنف في القائمة)' as section,
       pl.tenant_id,
       coalesce(pl.code, '-') as list_code,
       count(*) as product_lists_with_slices,
       sum(s.rows_n) as price_rows_in_them,
       sum(s.slice_rows) as slice_rows,
       max(s.max_min_qty) as largest_min_qty
from (
  select pli.price_list_id,
         pli.product_id,
         count(*) as rows_n,
         count(*) filter (
           where coalesce(pli.min_qty, pli.min_quantity, 1) > 1
         ) as slice_rows,
         max(coalesce(pli.min_qty, pli.min_quantity, 1)) as max_min_qty
    from public.price_list_items pli
   group by pli.price_list_id, pli.product_id
  having count(*) > 1
) s
join public.price_lists pl on pl.id = s.price_list_id
group by pl.tenant_id, pl.code
order by price_rows_in_them desc;

select '3b-عينة) تفاصيل الشرائح' as section,
       pl.tenant_id,
       coalesce(pl.code, '-') as list_code,
       p.sku,
       coalesce(p.name_ar, p.name) as product_name,
       pli.min_qty,
       pli.min_quantity,
       pli.price,
       pli.unit_price,
       pli.is_active,
       pli.valid_from,
       pli.valid_until
from public.price_list_items pli
join (
  select price_list_id, product_id
    from public.price_list_items
   group by price_list_id, product_id
  having count(*) > 1
) g on g.price_list_id = pli.price_list_id and g.product_id = pli.product_id
join public.price_lists pl on pl.id = pli.price_list_id
join public.products p on p.id = pli.product_id
order by pl.tenant_id, list_code, p.sku, coalesce(pli.min_qty, pli.min_quantity, 1)
limit 50;

select '3c) صفوف غير صالحة للاستيراد كما هي' as section,
       count(*) filter (where not coalesce(pli.is_active, true)) as inactive,
       count(*) filter (where pli.valid_until is not null and pli.valid_until < current_date) as expired,
       count(*) filter (where pli.valid_from is not null and pli.valid_from > current_date) as not_started,
       count(*) filter (where coalesce(pli.unit_price, pli.price, 0) <= 0) as zero_or_null_price,
       count(*) as rows_total
from public.price_list_items pli;


-- ---------------------------------------------------------------------------
-- 4) الأصناف النشطة بلا سعر في قائمة افتراضية — أي أنها ستُرَد عند البيع بعد
--    الترحيل (SALE_PRICE_REFERENCE_MISSING) حتى تُسعَّر.
--    مرتبة بقيمة المخزون المعرّضة (الأخطر أولًا)، والحد 500 للعرض فقط؛
--    العدد الكامل لكل حساب في القسم 6.
-- ---------------------------------------------------------------------------
select '4) أصناف نشطة بلا سعر افتراضي' as section,
       p.tenant_id,
       p.sku,
       coalesce(p.name_ar, p.name) as product_name,
       p.unit_of_measure,
       coalesce(stock.qty, 0)   as stock_qty,
       coalesce(stock.value, 0) as stock_value_cost
from public.products p
left join lateral (
  select sum(coalesce(i.quantity, 0)) as qty,
         sum(coalesce(i.quantity, 0) * coalesce(i.unit_cost, i.cost_price, 0)) as value
    from public.inventory i
   where i.tenant_id = p.tenant_id
     and i.product_id = p.id
) stock on true
where p.deleted_at is null
  and coalesce(p.is_active, true)
  and not exists (
    select 1
      from public.price_lists pl
      join public.price_list_items pli on pli.price_list_id = pl.id
     where pl.tenant_id = p.tenant_id
       and coalesce(pl.is_default, false)
       and coalesce(pl.is_active, true)
       and pli.product_id = p.id
       and coalesce(pli.is_active, true)
       and coalesce(pli.unit_price, pli.price, 0) > 0
  )
order by coalesce(stock.value, 0) desc, p.sku
limit 500;


-- ---------------------------------------------------------------------------
-- 5) المخزون: الكمية والقيمة لكل حساب ومخزن.
--    قيمة التكلفة = quantity × coalesce(unit_cost, cost_price).
--    قيمة البيع  = quantity × selling_price (للمقارنة مع قيمة التكلفة).
-- ---------------------------------------------------------------------------
select '5) المخزون لكل حساب ومخزن' as section,
       i.tenant_id,
       coalesce(w.name, 'بلا مخزن') as warehouse_name,
       count(distinct i.product_id) as products,
       count(*) as inventory_rows,
       sum(coalesce(i.quantity, 0))           as qty_on_hand,
       sum(coalesce(i.available_quantity, 0)) as qty_available,
       sum(coalesce(i.quantity, 0) * coalesce(i.unit_cost, i.cost_price, 0)) as stock_value_cost,
       sum(coalesce(i.quantity, 0) * coalesce(i.selling_price, 0))          as stock_value_selling
from public.inventory i
left join public.warehouses w
  on w.id = i.warehouse_id and w.tenant_id = i.tenant_id
group by i.tenant_id, w.name
order by stock_value_cost desc nulls last;


-- ---------------------------------------------------------------------------
-- 6) ملخص القرار: سطر لكل حساب. هذه هي الأرقام التي تُقارن بها بعد أي ترحيل،
--    وتُحفظ كخط أساس قبل التنفيذ.
-- ---------------------------------------------------------------------------
with wh as (
  select tenant_id,
         count(*) filter (where deleted_at is null and coalesce(is_active, true)) as active_warehouses
    from public.warehouses
   group by tenant_id
),
lists as (
  select tenant_id,
         count(*) filter (where coalesce(is_active, true)) as price_lists,
         count(*) filter (
           where coalesce(is_default, false) and coalesce(is_active, true)
         ) as default_lists
    from public.price_lists
   group by tenant_id
),
priced as (
  select pl.tenant_id, count(distinct pli.product_id) as priced_products
    from public.price_lists pl
    join public.price_list_items pli on pli.price_list_id = pl.id
   where coalesce(pl.is_default, false)
     and coalesce(pl.is_active, true)
     and coalesce(pli.is_active, true)
     and coalesce(pli.unit_price, pli.price, 0) > 0
   group by pl.tenant_id
),
prods as (
  select p.tenant_id,
         count(*) as active_products,
         count(*) filter (
           where not exists (
             select 1
               from public.price_lists pl
               join public.price_list_items pli on pli.price_list_id = pl.id
              where pl.tenant_id = p.tenant_id
                and coalesce(pl.is_default, false)
                and coalesce(pl.is_active, true)
                and pli.product_id = p.id
                and coalesce(pli.is_active, true)
                and coalesce(pli.unit_price, pli.price, 0) > 0
           )
         ) as active_products_without_price
    from public.products p
   where p.deleted_at is null
     and coalesce(p.is_active, true)
   group by p.tenant_id
),
stock as (
  select tenant_id,
         sum(coalesce(quantity, 0)) as qty_on_hand,
         sum(coalesce(quantity, 0) * coalesce(unit_cost, cost_price, 0)) as stock_value_cost
    from public.inventory
   group by tenant_id
)
select '6) ملخص القرار لكل حساب' as section,
       t.id as tenant_id,
       coalesce(t.name_ar, t.name) as tenant_name,
       coalesce(wh.active_warehouses, 0)             as active_warehouses,
       coalesce(lists.price_lists, 0)                as price_lists,
       coalesce(lists.default_lists, 0)              as default_lists,
       coalesce(priced.priced_products, 0)           as priced_products,
       coalesce(prods.active_products, 0)            as active_products,
       coalesce(prods.active_products_without_price, 0) as active_products_without_price,
       coalesce(stock.qty_on_hand, 0)                as qty_on_hand,
       coalesce(stock.stock_value_cost, 0)           as stock_value_cost
from public.tenants t
left join wh    on wh.tenant_id = t.id
left join lists on lists.tenant_id = t.id
left join priced on priced.tenant_id = t.id
left join prods on prods.tenant_id = t.id
left join stock on stock.tenant_id = t.id
where t.deleted_at is null
order by active_warehouses desc, tenant_name;


-- ---------------------------------------------------------------------------
-- 7) اللوحة الإجمالية: سطر واحد بكل الأرقام. سجّله قبل الترحيل ثم قارن به
--    بعد الاستيراد (الأعداد والمجاميع يجب أن تتطابق).
-- ---------------------------------------------------------------------------
select '7) اللوحة الإجمالية' as section,
       (select count(*) from public.tenants where deleted_at is null) as tenants,
       (select count(*) from public.warehouses where deleted_at is null) as warehouses,
       (select count(*) from public.warehouses
         where deleted_at is null and coalesce(is_active, true)) as active_warehouses,
       (select count(*) from public.price_lists) as price_lists,
       (select count(*) from public.price_lists
         where coalesce(is_default, false) and coalesce(is_active, true)) as default_lists,
       (select count(*) from public.price_list_items) as price_rows,
       (select count(*) from public.products
         where deleted_at is null and coalesce(is_active, true)) as active_products,
       (select count(*)
          from public.products p
         where p.deleted_at is null
           and coalesce(p.is_active, true)
           and not exists (
             select 1
               from public.price_lists pl
               join public.price_list_items pli on pli.price_list_id = pl.id
              where pl.tenant_id = p.tenant_id
                and coalesce(pl.is_default, false)
                and coalesce(pl.is_active, true)
                and pli.product_id = p.id
                and coalesce(pli.is_active, true)
                and coalesce(pli.unit_price, pli.price, 0) > 0
           )) as active_products_without_price,
       (select count(*) from public.inventory) as inventory_rows,
       (select coalesce(sum(coalesce(quantity, 0)), 0)
          from public.inventory) as qty_on_hand,
       (select coalesce(sum(coalesce(quantity, 0) * coalesce(unit_cost, cost_price, 0)), 0)
          from public.inventory) as stock_value_cost,
       (select coalesce(sum(coalesce(quantity, 0) * coalesce(selling_price, 0)), 0)
          from public.inventory) as stock_value_selling;
