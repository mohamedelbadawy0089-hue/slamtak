-- ============================================================================
--  0003 — قائمة البيع الافتراضية وأسعار الأصناف القائمة، قابلة للتشغيل المتكرر.
--
--  المشكلة: app.post_sale يرفض كل سطر بلا سعر مرجعي في قائمة افتراضية
--  (SALE_PRICE_REFERENCE_MISSING). فمخزن بلا قائمة افتراضية — أو صنف قائم بلا
--  سعر فيها — لا يستطيع البيع أصلًا. ولا شيء في المخطط كان يضمن وجود القائمة،
--  ولا يمنع قائمتين افتراضيتين لنفس المخزن (كان الحارس يأخذ أدنى سعر بصمت).
--
--  هذا الملف يفعل ثلاثة أشياء، كلها بلا أثر عند إعادة التشغيل:
--    1) قائمة افتراضية واحدة لكل مخزن: تُبقى قائمة واحدة عند التعدد ثم يُنشأ
--       فهرس فريد جزئي يمنع التعدد من جديد.
--    2) تزويد الأصناف القائمة بسعر في القائمة الافتراضية: آخر سعر بيع، ثم
--       متوسط تكلفة المخزون، ثم آخر تكلفة تشغيلة. ولا يُستبدل سعر مضبوط يدويًا.
--    3) حارس نهائي يفشل بصوت عالٍ إن بقي مخزن بلا قائمة افتراضية.
--
--  القيود المقصودة:
--   * السعر يُزوَّد لوحدة البيع الواحدة للصنف: وحدته الأساسية (is_base)، أو
--     وحدته الوحيدة إن لم تُعلَّم أساسية. صنف بوحدتين بلا أساسية يُترك بلا سعر
--     (لا تخمين) ويظهر في تشخيص الفجوات — supabase/diagnostics/price-coverage-gaps.sql.
--   * صنف بلا سعر بيع سابق ولا تكلفة (أو سعر صفر) لا يُدرج له سعر: سعر 0 كان
--     سيسمح بالبيع مجانًا. يظهر في التشخيص ليراجعه المشغّل.
--   * min_price لا يُملأ: حد التسعيرة الجبرية قرار بشري لا يُخمَّن من التكلفة.
--   * runs on the 20261108 schema (medicine_id/unit_id/price). The legacy live
--     schema (product_id/unit_price) needs its own adapter migration.
--   * يُشغَّل بدور يملك BYPASSRLS (postgres) مثل مسار الهجرات نفسه.
-- ============================================================================

-- ------------------------------------ 1) قائمة افتراضية واحدة لا أكثر لكل مخزن
-- عند التعدد تُبقى قائمة retail (وإن لم توجد، الأكثر بنودًا ثم الأصغر id) وتُزل
-- صفة الافتراضي عن الباقي. الترتيب حتمي، فإعادة التشغيل لا تغيّر القرار.
DO $$
DECLARE
  v_demoted int;
BEGIN
  WITH ranked AS (
    SELECT pl.tenant_id, pl.id,
           row_number() OVER (
             PARTITION BY pl.tenant_id
             ORDER BY (pl.code = 'retail') DESC,
                      (SELECT count(*) FROM public.price_list_items i
                        WHERE i.tenant_id = pl.tenant_id
                          AND i.price_list_id = pl.id) DESC,
                      pl.id
           ) AS rn
      FROM public.price_lists pl
     WHERE pl.is_default
  )
  UPDATE public.price_lists pl
     SET is_default = false
    FROM ranked r
   WHERE pl.tenant_id = r.tenant_id
     AND pl.id = r.id
     AND r.rn > 1;

  GET DIAGNOSTICS v_demoted = ROW_COUNT;
  IF v_demoted > 0 THEN
    RAISE WARNING 'PRICE_LIST_DEFAULT_DEMOTED: أُزيلت صفة الافتراضي عن % قائمة زائدة (بقيت retail أو الأكثر بنودًا)', v_demoted;
  END IF;
END $$;

-- تزويد كل مخزن بلا قائمة افتراضية بواحدة. إن كان لديه قائمة retail غير
-- افتراضية فتُرقّى هي نفسها (فلا يفقد أسعارها)، وإلا تُنشأ قائمة جديدة.
INSERT INTO public.price_lists (tenant_id, code, name, is_default)
SELECT t.id, 'retail', 'قائمة البيع الافتراضية', true
  FROM public.tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM public.price_lists pl
    WHERE pl.tenant_id = t.id AND pl.is_default
 )
ON CONFLICT (tenant_id, code) DO UPDATE SET is_default = true;

-- الحارس البنيوي: ما لم يكن مفروضًا في المخطط كان يعتمد على انتباه المشغّل.
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_lists_one_default
  ON public.price_lists (tenant_id) WHERE is_default;

-- ----------------------------------- 2) سعر لكل صنف قائم في القائمة الافتراضية
-- وحدة البيع: الأساسية، أو الوحيدة. الوحدة بلا أساسية مع وحدات متعددة = غموض
-- يُترك للتشخيص، لأن التخمين يبيع بوحدة غير التي سعّرها المشغّل.
WITH unit_pick AS (
  SELECT mu.tenant_id, mu.medicine_id, mu.unit_id, mu.is_base,
         row_number() OVER (
           PARTITION BY mu.tenant_id, mu.medicine_id
           ORDER BY mu.is_base DESC, mu.factor, mu.unit_id
         ) AS rn,
         count(*)     OVER (PARTITION BY mu.tenant_id, mu.medicine_id) AS units_n,
         bool_or(mu.is_base) OVER (PARTITION BY mu.tenant_id, mu.medicine_id) AS has_base
    FROM public.medicine_units mu
),
sell_unit AS (
  SELECT tenant_id, medicine_id, unit_id
    FROM unit_pick
   WHERE rn = 1 AND (is_base OR units_n = 1)
),
-- آخر سعر بيع مؤكد: الأحدث إصدارًا، ثم الأحدث إنشاءً، وid كفاصل حتمي.
last_sale AS (
  SELECT DISTINCT ON (sii.tenant_id, sii.medicine_id, sii.unit_id)
         sii.tenant_id, sii.medicine_id, sii.unit_id,
         sii.unit_price AS price
    FROM public.sales_invoice_items sii
    JOIN public.sales_invoices si
      ON si.tenant_id = sii.tenant_id AND si.id = sii.invoice_id
   WHERE si.status = 'confirmed'
   ORDER BY sii.tenant_id, sii.medicine_id, sii.unit_id,
            si.issued_at DESC NULLS LAST, si.created_at DESC, sii.id DESC
),
-- التكلفة: متوسط مرجّح لما هو موجود فعلًا، وإلا آخر تكلفة تشغيلة (والتشغيلة
-- تبقى بصفها بعد نفاد الكمية، فالتكلفة لا تختفي بنفاد المخزون).
avg_cost AS (
  SELECT tenant_id, medicine_id,
         round(sum(qty_on_hand * unit_cost) / nullif(sum(qty_on_hand), 0), 2) AS price
    FROM public.stock_batches
   GROUP BY tenant_id, medicine_id
  HAVING sum(qty_on_hand) > 0
),
last_cost AS (
  SELECT DISTINCT ON (tenant_id, medicine_id)
         tenant_id, medicine_id, round(unit_cost, 2) AS price
    FROM public.stock_batches
   ORDER BY tenant_id, medicine_id, updated_at DESC, id DESC
)
INSERT INTO public.price_list_items (tenant_id, price_list_id, medicine_id, unit_id, price)
SELECT pl.tenant_id, pl.id, su.medicine_id, su.unit_id, src.price
  FROM public.price_lists pl
  JOIN public.medicines m
    ON m.tenant_id = pl.tenant_id AND m.is_active
  JOIN sell_unit su
    ON su.tenant_id = m.tenant_id AND su.medicine_id = m.id
  LEFT JOIN last_sale ls
    ON ls.tenant_id = su.tenant_id AND ls.medicine_id = su.medicine_id AND ls.unit_id = su.unit_id
  LEFT JOIN avg_cost  c ON c.tenant_id = su.tenant_id AND c.medicine_id = su.medicine_id
  LEFT JOIN last_cost l ON l.tenant_id = su.tenant_id AND l.medicine_id = su.medicine_id
 CROSS JOIN LATERAL (SELECT coalesce(ls.price, c.price, l.price) AS price) src
 WHERE pl.is_default
   AND src.price > 0
ON CONFLICT (tenant_id, price_list_id, medicine_id, unit_id) DO NOTHING;

-- ------------------------------------------------------- 3) الحارس والتقرير
-- الفحص التفصيلي (أي صنف بلا سعر وأي سعر تحت التكلفة) في ملف التشخيص؛ هنا
-- نضمن الشرط الذي بدونه يتوقف البيع: قائمة افتراضية واحدة لكل مخزن.
DO $$
DECLARE
  v_tenants     int;
  v_defaults    int;
  v_no_default  int;
  v_active      int;
  v_no_sell_unit int;
  v_no_price    int;
BEGIN
  SELECT count(*) INTO v_tenants FROM public.tenants;

  SELECT count(*) INTO v_no_default
    FROM public.tenants t
   WHERE NOT EXISTS (
     SELECT 1 FROM public.price_lists pl
      WHERE pl.tenant_id = t.id AND pl.is_default
   );
  IF v_no_default > 0 THEN
    RAISE EXCEPTION 'DEFAULT_PRICE_LIST_MISSING: % مخزن بلا قائمة بيع افتراضية بعد التزويد', v_no_default
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_defaults FROM public.price_lists WHERE is_default;
  IF v_defaults <> v_tenants THEN
    RAISE EXCEPTION 'DEFAULT_PRICE_LIST_COUNT: % قائمة افتراضية لـ% مخزن', v_defaults, v_tenants
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_active
    FROM public.medicines WHERE is_active;

  SELECT count(*) INTO v_no_price
    FROM public.medicines m
   WHERE m.is_active
     AND EXISTS (
       SELECT 1 FROM public.medicine_units mu
        WHERE mu.tenant_id = m.tenant_id AND mu.medicine_id = m.id
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.price_lists pl
         JOIN public.price_list_items pli
           ON pli.tenant_id = pl.tenant_id AND pli.price_list_id = pl.id
        WHERE pl.tenant_id = m.tenant_id
          AND pl.is_default
          AND pli.medicine_id = m.id
     );

  SELECT count(*) INTO v_no_sell_unit
    FROM public.medicines m
   WHERE m.is_active
     AND NOT EXISTS (
       SELECT 1 FROM public.medicine_units mu
        WHERE mu.tenant_id = m.tenant_id AND mu.medicine_id = m.id
     );

  RAISE NOTICE 'PRICE_COVERAGE tenants=% active_medicines=% no_sell_unit=% no_reference_price=%',
    v_tenants, v_active, v_no_sell_unit, v_no_price;

  IF v_no_price > 0 THEN
    RAISE WARNING 'PRICE_COVERAGE_GAP: % صنف نشط بلا سعر مرجعي — البيع منه سيُرَد بـSALE_PRICE_REFERENCE_MISSING حتى يُسعَّر (راجع supabase/diagnostics/price-coverage-gaps.sql)', v_no_price;
  END IF;
END $$;
