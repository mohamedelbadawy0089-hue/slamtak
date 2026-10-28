-- 202610290313_assign_real_roles_permissions.sql
-- ربط الأدوار الحقيقية (Super Admin / Tenant Admin / Warehouse Manager / Sales /
-- Purchasing / Inventory / Accountant / Viewer) بالصلاحيات الفعلية،
-- ثم ترحيل مستخدمي المخازن الحاليين إلى هذه الأدوار.
-- آمن للتشغيل المتكرر (idempotent).

-- ============================================================
-- 1) تنظيف صفوف role_permissions اليتيمة (تشير إلى أدوار غير موجودة)
--    القيد fk_role_permissions_role_id كان NOT VALID لهذا السبب
-- ============================================================
DELETE FROM public.role_permissions rp
 WHERE NOT EXISTS (
   SELECT 1 FROM public.roles r WHERE r.id = rp.role_id
 );

DELETE FROM public.role_permissions rp
 WHERE NOT EXISTS (
   SELECT 1 FROM public.permissions p WHERE p.id = rp.permission_id
 );

DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_role_permissions_role_id'
       AND conrelid = 'public.role_permissions'::regclass
       AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.role_permissions VALIDATE CONSTRAINT fk_role_permissions_role_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'تعذر التحقق من القيد: %', SQLERRM;
    END;
  END IF;
END
$do$;

-- ============================================================
-- 2) تعيين الصلاحيات لكل دور حسب مسؤوليته
-- ============================================================
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  JOIN public.permissions p ON (
        r.name IN ('Super Admin', 'Tenant Admin')
     OR (r.name = 'Warehouse Manager' AND (
             p.category IN ('inventory', 'warehouses', 'products', 'hr', 'auth')
          OR p.name IN (
               'sales.read', 'sales.view',
               'purchases.read', 'purchases.view',
               'reports.read', 'reports.view', 'reports.export'
             )
        ))
     OR (r.name = 'Sales' AND (
             p.category IN ('sales', 'customers', 'auth')
          OR p.name IN (
               'products.read',
               'inventory.read', 'inventory.view',
               'reports.read', 'reports.view'
             )
        ))
     OR (r.name = 'Purchasing' AND (
             p.category IN ('purchases', 'suppliers', 'auth')
          OR p.name IN (
               'products.read',
               'inventory.read', 'inventory.view',
               'reports.read', 'reports.view'
             )
        ))
     OR (r.name = 'Inventory' AND (
             p.category IN ('inventory', 'products', 'auth')
          OR p.name IN (
               'warehouses.read',
               'reports.read', 'reports.view'
             )
        ))
     OR (r.name = 'Accountant' AND (
             p.category = 'auth'
          OR p.name IN (
               'reports.read', 'reports.view', 'reports.export',
               'sales.read', 'purchases.read',
               'customers.read', 'suppliers.read',
               'inventory.read', 'settings.read'
             )
        ))
     OR (r.name = 'Viewer' AND (
             p.category = 'auth'
          OR p.name LIKE '%.read'
          OR p.name LIKE '%.view'
        ))
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================
-- 3) تعيين الدور الفعلي لكل مستخدم في كل مخزن
--    manager => Warehouse Manager ، viewer => Viewer ، إلخ
--    أي قيمة غير معروفة تُمنح أقل صلاحية (Viewer) للأمان
-- ============================================================
UPDATE public.user_warehouses uw
   SET role_id = m.role_id
  FROM (
    SELECT uw2.id AS uw_id,
           (SELECT r.id
              FROM public.roles r
             WHERE r.name = CASE lower(coalesce(p.role, ''))
                              WHEN 'super_admin'       THEN 'Super Admin'
                              WHEN 'owner'             THEN 'Super Admin'
                              WHEN 'admin'             THEN 'Tenant Admin'
                              WHEN 'tenant_admin'      THEN 'Tenant Admin'
                              WHEN 'manager'           THEN 'Warehouse Manager'
                              WHEN 'warehouse_manager' THEN 'Warehouse Manager'
                              WHEN 'sales'             THEN 'Sales'
                              WHEN 'purchasing'        THEN 'Purchasing'
                              WHEN 'accountant'        THEN 'Accountant'
                              WHEN 'inventory'         THEN 'Inventory'
                              WHEN 'viewer'            THEN 'Viewer'
                              ELSE 'Viewer'
                            END
             LIMIT 1) AS role_id
      FROM public.user_warehouses uw2
      LEFT JOIN public.profiles p ON p.id = uw2.user_id
     WHERE uw2.role_id IS NULL
  ) m
 WHERE uw.id = m.uw_id
   AND m.role_id IS NOT NULL;

-- ============================================================
-- 4) ترحيل الارتباطات إلى جدول user_roles
-- ============================================================
INSERT INTO public.user_roles (user_id, warehouse_id, role_id, is_active)
SELECT uw.user_id, uw.warehouse_id, uw.role_id, true
  FROM public.user_warehouses uw
 WHERE uw.role_id IS NOT NULL
ON CONFLICT (user_id, warehouse_id, role_id) DO NOTHING;

-- تعطيل أي ارتباط user_roles لا يطابق دور المستخدم الحالي في نفس المخزن
UPDATE public.user_roles ur
   SET is_active = false
  FROM public.user_warehouses uw
 WHERE uw.user_id = ur.user_id
   AND uw.warehouse_id = ur.warehouse_id
   AND uw.role_id IS NOT NULL
   AND uw.role_id <> ur.role_id
   AND ur.is_active IS TRUE;

-- ============================================================
-- 5) تحقق نهائي
-- ============================================================
DO $do$
DECLARE
  v_roles_without_perms int;
  v_uw_without_role int;
  v_super_perms int;
BEGIN
  SELECT count(*) INTO v_roles_without_perms
    FROM public.roles r
   WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id);

  SELECT count(*) INTO v_uw_without_role
    FROM public.user_warehouses
   WHERE role_id IS NULL;

  SELECT count(*) INTO v_super_perms
    FROM public.role_permissions rp
    JOIN public.roles r ON r.id = rp.role_id
   WHERE r.name = 'Super Admin';

  RAISE NOTICE 'أدوار بدون صلاحيات: % | مستخدمون بدون دور: % | صلاحيات Super Admin: %',
    v_roles_without_perms, v_uw_without_role, v_super_perms;

  IF v_roles_without_perms > 0 THEN
    RAISE WARNING 'توجد أدوار بدون أي صلاحية، راجع التعيينات';
  END IF;
END
$do$;
