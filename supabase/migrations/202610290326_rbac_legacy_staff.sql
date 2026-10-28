-- =====================================================================================
-- 202610290326_rbac_legacy_staff.sql
-- إصلاح انحدار كشفه فرض الصلاحيات على جداول الأعمال:
--   الأعضاء القدامى في user_warehouses بلا role_id أصبحوا بلا أي صلاحية، فانقفلت
--   عليهم دورة الاستلام/البيع بعد تركيب المُشغّلات (كانوا يعملون سابقًا عبر RLS).
--
-- الحل: دور نظامي "Legacy Staff" يحتوي القدرة الفعلية التي كانت متاحة قبل الفرض،
-- يُسند تلقائيًا لكل عضوية بلا دور، ويظهر في صفحة الأدوار حتى يراجعه المدير
-- ويستبدله بدور مناسب. لا يمنح هذا الدور أي صلاحية إدارية.
-- آمن للتشغيل المتكرر.
-- =====================================================================================

INSERT INTO public.roles (name, name_ar, description, permissions, is_system, is_system_role, is_active)
SELECT 'Legacy Staff',
       'موظف قديم (صلاحيات افتراضية)',
       'يُسند تلقائيًا للأعضاء الذين لا يملكون دورًا بعد ترقية الصلاحيات — راجع صلاحياتهم واستبدل الدور بدور مناسب.',
       '{}'::jsonb, true, true, true
 WHERE NOT EXISTS (
   SELECT 1 FROM public.roles r WHERE lower(btrim(r.name)) = 'legacy staff'
 );

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  CROSS JOIN public.permissions p
 WHERE lower(btrim(r.name)) = 'legacy staff'
   AND p.name IN (
     'products.view','products.create','products.update',
     'inventory.view','inventory.create','inventory.update',
     'suppliers.view','suppliers.create','suppliers.update',
     'customers.view','customers.create','customers.update',
     'purchases.view','purchases.create','purchases.update',
     'sales.view','sales.create','sales.update',
     'payments.view','payments.create','payments.update',
     'hr.view','hr.create','hr.update',
     'reports.view'
   )
ON CONFLICT DO NOTHING;

-- إسناد الدور لكل عضوية بلا دور
UPDATE public.user_warehouses uw
   SET role_id = (SELECT r.id FROM public.roles r WHERE lower(btrim(r.name)) = 'legacy staff' LIMIT 1)
 WHERE uw.role_id IS NULL;

-- حساب موظفي المخزن المرتبطين بحساب مستخدم وبلا دور
UPDATE public.warehouse_employees e
   SET role_id = (SELECT r.id FROM public.roles r WHERE lower(btrim(r.name)) = 'legacy staff' LIMIT 1)
 WHERE e.role_id IS NULL
   AND e.user_id IS NOT NULL;

-- تقرير ما تبقّى بلا دور
SELECT
  (SELECT count(*) FROM public.user_warehouses WHERE role_id IS NULL) AS memberships_without_role,
  (SELECT count(*) FROM public.role_permissions rp
     JOIN public.roles r ON r.id = rp.role_id
    WHERE lower(btrim(r.name)) = 'legacy staff') AS legacy_staff_perms,
  (SELECT count(*) FROM public.user_warehouses uw
     JOIN public.roles r ON r.id = uw.role_id
    WHERE lower(btrim(r.name)) = 'legacy staff') AS legacy_staff_members;
