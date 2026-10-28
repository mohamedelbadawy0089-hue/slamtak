-- =====================================================================================
-- 202610290330_rbac_approval_implies_operate.sql
-- إصلاح كشفه الاختبار: دور يملك <module>.approve أو <module>.manage بلا
-- <module>.view/create/update كان يُحجب عند بوابة التعديل قبل أن يصل إلى فحص الاعتماد.
-- صلاحية اعتماد بلا قدرة تشغيلية لا معنى لها، فتُضاف القدرة التشغيلية لمديري المخازن.
--
-- ملاحظة: لا يُمنح <module>.delete تلقائيًا إلا لو كان الدور يملك .manage.
-- آمن للتشغيل المتكرر.
-- =====================================================================================

-- 1) approve/manage ⇒ view + create + update (لمديري المخازن فقط)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, p.id
  FROM public.role_permissions rp
  JOIN public.roles r ON r.id = rp.role_id
  JOIN public.permissions ap ON ap.id = rp.permission_id
  JOIN public.permissions p
    ON p.category = ap.category
   AND p.name IN (ap.category || '.view', ap.category || '.create', ap.category || '.update')
 WHERE r.deleted_at IS NULL
   AND lower(btrim(r.name)) IN ('warehouse manager','tenant admin','super admin','manager','admin')
   AND split_part(ap.name, '.', 2) IN ('approve', 'manage')
ON CONFLICT DO NOTHING;

-- 2) manage ⇒ delete (لأن "إدارة" تشمل الحذف في الكتالوج)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, p.id
  FROM public.role_permissions rp
  JOIN public.roles r ON r.id = rp.role_id
  JOIN public.permissions ap ON ap.id = rp.permission_id
  JOIN public.permissions p
    ON p.category = ap.category AND p.name = ap.category || '.delete'
 WHERE r.deleted_at IS NULL
   AND lower(btrim(r.name)) IN ('warehouse manager','tenant admin','super admin','manager','admin')
   AND split_part(ap.name, '.', 2) = 'manage'
ON CONFLICT DO NOTHING;

-- 3) نفس القاعدة لكل دور في المخزن يملك approve (وليس المدير فقط)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, p.id
  FROM public.role_permissions rp
  JOIN public.permissions ap ON ap.id = rp.permission_id
  JOIN public.permissions p
    ON p.category = ap.category
   AND p.name IN (ap.category || '.view', ap.category || '.create', ap.category || '.update')
 WHERE split_part(ap.name, '.', 2) = 'approve'
ON CONFLICT DO NOTHING;

-- 4) تحقق: دور المدير يجب أن يملك القدرة التشغيلية لكل ما يعتمده
SELECT jsonb_pretty(jsonb_agg(g)) FROM (
  SELECT r.name AS role,
         jsonb_agg(p.name ORDER BY p.name) FILTER (WHERE split_part(p.name, '.', 2) = 'approve') AS approves,
         jsonb_agg(p.name ORDER BY p.name) FILTER (WHERE split_part(p.name, '.', 2) = 'update') AS updates
    FROM public.roles r
    JOIN public.role_permissions rp ON rp.role_id = r.id
    JOIN public.permissions p ON p.id = rp.permission_id
   WHERE r.deleted_at IS NULL
     AND lower(btrim(r.name)) IN ('warehouse manager','tenant admin','super admin')
   GROUP BY r.name
) g;
