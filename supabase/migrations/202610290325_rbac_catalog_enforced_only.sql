-- =====================================================================================
-- 202610290325_rbac_catalog_enforced_only.sql
-- شرط المتطلبات: "لا تعرض أي صلاحية غير مطبقة فعليًا في النظام".
-- الكتالوج الذي تقرأه الواجهة يعيد فقط الصلاحيات المفروضة على الخادم/قاعدة البيانات
-- (is_enforced = true)، مع إبقاء بقية الصلاحيات في جدول permissions لحين ربطها.
--
-- ملاحظة توافق: الواجهة تحتفظ بأي صلاحية قديمة غير معروضة عند حفظ الدور،
-- حتى لا يؤدي الحفظ إلى سحب صلاحيات موجودة بصمت.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.rbac_catalog()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT coalesce(jsonb_agg(grp ORDER BY ord), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
               'module', p.category,
               'module_ar', coalesce(
                  (SELECT split_part(p2.description, ' — ', 1)
                     FROM public.permissions p2
                    WHERE p2.category = p.category
                      AND p2.description LIKE '% — %'
                    LIMIT 1),
                  p.category),
               'actions', jsonb_agg(jsonb_build_object(
                  'name', p.name,
                  'action', split_part(p.name, '.', 2),
                  'label', coalesce(p.name_ar, split_part(p.name, '.', 2)),
                  'description', p.description,
                  'enforced', p.is_enforced
               ) ORDER BY p.sort_order, p.name)
             ) AS grp,
             min(p.sort_order) AS ord
        FROM public.permissions p
       WHERE auth.uid() IS NOT NULL
         AND p.category IS NOT NULL
         AND p.is_enforced IS TRUE   -- الصلاحيات المطبقة فعليًا فقط
       GROUP BY p.category
    ) g;
$fn$;

-- عدد ما يُعرض في المصفوفة (للتشخيص)
CREATE OR REPLACE FUNCTION public.rbac_catalog_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM public.permissions),
    'enforced', (SELECT count(*) FROM public.permissions WHERE is_enforced),
    'pending', (SELECT count(*) FROM public.permissions WHERE NOT is_enforced),
    'modules', (SELECT count(DISTINCT category) FROM public.permissions WHERE is_enforced)
  )
  WHERE auth.uid() IS NOT NULL;
$fn$;
