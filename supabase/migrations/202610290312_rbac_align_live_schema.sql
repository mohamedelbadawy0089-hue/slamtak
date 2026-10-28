-- 202610290312_rbac_align_live_schema.sql
-- مواءمة نظام الصلاحيات (RBAC) مع المخطط الحقيقي في قاعدة البيانات الحيّة
-- آمن للتشغيل المتكرر (idempotent) — لا يحذف أي بيانات أعمال ولا يغيّر أسعارًا أو مستندات

-- ============================================================
-- 1) جدول الصلاحيات permissions
--    المخطط الحقيقي: id, name, description, module, action, resource,
--                    created_at, updated_at  (بدون category)
-- ============================================================
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS category text;

UPDATE public.permissions
   SET category = coalesce(
         nullif(btrim(category), ''),
         nullif(btrim(module), ''),
         'general'
       )
 WHERE category IS NULL OR btrim(category) = '';

ALTER TABLE public.permissions ALTER COLUMN category SET NOT NULL;

ALTER TABLE public.permissions DROP CONSTRAINT IF EXISTS ck_permissions_category_nonempty;
ALTER TABLE public.permissions
  ADD CONSTRAINT ck_permissions_category_nonempty CHECK (btrim(category) <> '');

CREATE OR REPLACE FUNCTION public.tg_permissions_fill_meta()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_mod text := nullif(btrim(split_part(coalesce(NEW.name, ''), '.', 1)), '');
  v_act text := nullif(btrim(split_part(coalesce(NEW.name, ''), '.', 2)), '');
BEGIN
  IF v_mod IS NULL THEN v_mod := 'general'; END IF;
  IF v_act IS NULL THEN v_act := 'manage';  END IF;

  IF NEW.module   IS NULL OR btrim(NEW.module)   = '' THEN NEW.module   := v_mod;     END IF;
  IF NEW.action   IS NULL OR btrim(NEW.action)   = '' THEN NEW.action   := v_act;     END IF;
  IF NEW.resource IS NULL OR btrim(NEW.resource) = '' THEN NEW.resource := NEW.module; END IF;
  IF NEW.category IS NULL OR btrim(NEW.category) = '' THEN NEW.category := NEW.module; END IF;
  IF NEW.updated_at IS NULL THEN NEW.updated_at := now(); END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_permissions_fill_meta ON public.permissions;
CREATE TRIGGER trg_permissions_fill_meta
  BEFORE INSERT OR UPDATE ON public.permissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_permissions_fill_meta();

CREATE INDEX IF NOT EXISTS idx_permissions_category ON public.permissions (category);

-- ============================================================
-- 2) جدول الأدوار roles
-- ============================================================
UPDATE public.roles SET name_ar = name WHERE name_ar IS NULL OR btrim(name_ar) = '';
UPDATE public.roles SET is_system = false WHERE is_system IS NULL;

-- ============================================================
-- 3) جدول ربط الصلاحيات بالأدوار role_permissions
-- ============================================================
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
      RAISE NOTICE 'تعذر التحقق من القيد fk_role_permissions_role_id: %', SQLERRM;
    END;
  END IF;
END
$do$;

-- ============================================================
-- 4) جدول أدوار المستخدمين داخل المخزن user_roles (غير موجود حاليًا)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, warehouse_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user      ON public.user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_warehouse ON public.user_roles (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role      ON public.user_roles (role_id);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_roles_select_own_or_admin ON public.user_roles;
CREATE POLICY user_roles_select_own_or_admin ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid()
         AND p.role IN ('super_admin', 'admin', 'owner')
    )
  );

DROP POLICY IF EXISTS user_roles_manage_admin ON public.user_roles;
CREATE POLICY user_roles_manage_admin ON public.user_roles
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid()
         AND p.role IN ('super_admin', 'admin', 'owner')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid()
         AND p.role IN ('super_admin', 'admin', 'owner')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;

-- ============================================================
-- 5) جدول ربط المستخدم بالمخزن user_warehouses
--    إضافة role_id + ملء tenant_id تلقائيًا (يمنع خطأ 23502)
-- ============================================================
ALTER TABLE public.user_warehouses ADD COLUMN IF NOT EXISTS role_id uuid;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_user_warehouses_role_id'
       AND conrelid = 'public.user_warehouses'::regclass
  ) THEN
    ALTER TABLE public.user_warehouses
      ADD CONSTRAINT fk_user_warehouses_role_id
      FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE SET NULL;
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.tg_user_warehouses_fill()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT w.tenant_id INTO NEW.tenant_id
      FROM public.warehouses w
     WHERE w.id = NEW.warehouse_id;
  END IF;

  IF NEW.permissions IS NULL THEN
    NEW.permissions := '{}'::jsonb;
  END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_user_warehouses_fill ON public.user_warehouses;
CREATE TRIGGER trg_user_warehouses_fill
  BEFORE INSERT OR UPDATE ON public.user_warehouses
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_warehouses_fill();

UPDATE public.user_warehouses SET permissions = '{}'::jsonb WHERE permissions IS NULL;

UPDATE public.user_warehouses uw
   SET role_id = coalesce(
         (SELECT r.id
            FROM public.roles r
           WHERE r.name = (SELECT p.role FROM public.profiles p WHERE p.id = uw.user_id)
           LIMIT 1),
         (SELECT r.id FROM public.roles r WHERE r.name = 'employee' LIMIT 1)
       )
 WHERE uw.role_id IS NULL;

-- ============================================================
-- 6) دالة التحقق من الصلاحية (تعمل مع JSON في user_warehouses و user_roles)
-- ============================================================
CREATE OR REPLACE FUNCTION public.has_permission(p_permission text, p_warehouse_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid()
         AND p.role IN ('super_admin', 'admin', 'owner')
    )
    OR EXISTS (
      SELECT 1
        FROM public.user_warehouses uw
        LEFT JOIN public.user_roles ur
               ON ur.user_id = uw.user_id
              AND ur.warehouse_id = uw.warehouse_id
              AND ur.is_active
        LEFT JOIN public.roles r
               ON r.id = coalesce(ur.role_id, uw.role_id)
        LEFT JOIN public.role_permissions rp
               ON rp.role_id = r.id
        LEFT JOIN public.permissions perm
               ON perm.id = rp.permission_id
       WHERE uw.user_id = auth.uid()
         AND (p_warehouse_id IS NULL OR uw.warehouse_id = p_warehouse_id)
         AND (
              perm.name = p_permission
           OR lower(coalesce(uw.permissions ->> p_permission, 'false')) IN ('true', 't', '1', 'yes', 'on')
           OR lower(coalesce(r.permissions  ->> p_permission, 'false')) IN ('true', 't', '1', 'yes', 'on')
           OR (
                split_part(p_permission, '.', 2) = 'view'
                AND lower(coalesce(uw.permissions ->> (split_part(p_permission, '.', 1) || '.manage'), 'false'))
                    IN ('true', 't', '1', 'yes', 'on')
              )
         )
    )
  );
$fn$;

GRANT EXECUTE ON FUNCTION public.has_permission(text, uuid) TO authenticated;

-- ============================================================
-- 7) الصلاحيات الافتراضية وتعيينها للأدوار
-- ============================================================
INSERT INTO public.permissions (name, description, category) VALUES
  ('employees.manage',  'إدارة الموظفين',        'hr'),
  ('employees.view',    'عرض الموظفين',          'hr'),
  ('sales.manage',      'إدارة المبيعات',        'sales'),
  ('sales.view',        'عرض المبيعات',          'sales'),
  ('purchases.manage',  'إدارة المشتريات',       'purchases'),
  ('purchases.view',    'عرض المشتريات',         'purchases'),
  ('inventory.manage',  'إدارة المخزون',         'inventory'),
  ('inventory.view',    'عرض المخزون',           'inventory'),
  ('warehouse.manage',  'إدارة المخازن',         'warehouse'),
  ('warehouse.view',    'عرض المخازن',           'warehouse'),
  ('settings.manage',   'إدارة الإعدادات',       'settings'),
  ('reports.view',      'عرض التقارير',          'reports')
ON CONFLICT (name) DO UPDATE
  SET description = excluded.description,
      category    = excluded.category;

DO $do$
DECLARE
  v_super    uuid;
  v_admin    uuid;
  v_manager  uuid;
  v_employee uuid;
  v_viewer   uuid;
BEGIN
  SELECT id INTO v_super    FROM public.roles WHERE name = 'super_admin' LIMIT 1;
  SELECT id INTO v_admin    FROM public.roles WHERE name = 'admin'       LIMIT 1;
  SELECT id INTO v_manager  FROM public.roles WHERE name = 'manager'     LIMIT 1;
  SELECT id INTO v_employee FROM public.roles WHERE name = 'employee'    LIMIT 1;
  SELECT id INTO v_viewer   FROM public.roles WHERE name = 'viewer'      LIMIT 1;

  IF v_super IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_super, id FROM public.permissions
    ON CONFLICT (role_id, permission_id) DO NOTHING;
  END IF;

  IF v_admin IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_admin, id FROM public.permissions WHERE category <> 'settings'
    ON CONFLICT (role_id, permission_id) DO NOTHING;
  END IF;

  IF v_manager IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_manager, id FROM public.permissions WHERE category <> 'settings'
    ON CONFLICT (role_id, permission_id) DO NOTHING;
  END IF;

  IF v_employee IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_employee, id FROM public.permissions
     WHERE category IN ('hr', 'sales', 'purchases', 'inventory')
    ON CONFLICT (role_id, permission_id) DO NOTHING;
  END IF;

  IF v_viewer IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_viewer, id FROM public.permissions WHERE name LIKE '%.view'
    ON CONFLICT (role_id, permission_id) DO NOTHING;
  END IF;
END
$do$;

-- ============================================================
-- 8) ترحيل الارتباطات الحالية إلى user_roles
-- ============================================================
INSERT INTO public.user_roles (user_id, warehouse_id, role_id, is_active)
SELECT uw.user_id, uw.warehouse_id, uw.role_id, true
  FROM public.user_warehouses uw
 WHERE uw.role_id IS NOT NULL
ON CONFLICT (user_id, warehouse_id, role_id) DO NOTHING;

-- ============================================================
-- 9) إصلاح دالة الربط التلقائي للمستخدم الجديد
--    (كانت تُدرج user_warehouses بدون tenant_id => خطأ 23502)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user_warehouse()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_warehouse_id uuid;
  v_tenant_id    uuid;
  v_role_id      uuid;
BEGIN
  SELECT w.id, w.tenant_id
    INTO v_warehouse_id, v_tenant_id
    FROM public.warehouses w
   WHERE w.is_main IS TRUE
   ORDER BY w.created_at NULLS LAST
   LIMIT 1;

  IF v_warehouse_id IS NULL THEN
    SELECT w.id, w.tenant_id
      INTO v_warehouse_id, v_tenant_id
      FROM public.warehouses w
     ORDER BY w.created_at NULLS LAST
     LIMIT 1;
  END IF;

  IF v_warehouse_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.profiles (id, full_name, role)
    VALUES (
      NEW.id,
      coalesce(
        nullif(btrim(coalesce(NEW.raw_user_meta_data ->> 'full_name',
                              NEW.raw_user_meta_data ->> 'name',
                              '')), ''),
        'مستخدم جديد'
      ),
      'manager'
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'تعذر إنشاء الملف الشخصي للمستخدم %: %', NEW.id, SQLERRM;
  END;

  SELECT r.id INTO v_role_id FROM public.roles r WHERE r.name = 'employee' LIMIT 1;
  IF v_role_id IS NULL THEN
    SELECT r.id INTO v_role_id FROM public.roles r ORDER BY r.name LIMIT 1;
  END IF;

  INSERT INTO public.user_warehouses (user_id, warehouse_id, tenant_id, permissions, role_id)
  VALUES (NEW.id, v_warehouse_id, v_tenant_id, '{}'::jsonb, v_role_id)
  ON CONFLICT (user_id, warehouse_id) DO NOTHING;

  IF v_role_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, warehouse_id, role_id, assigned_by)
    VALUES (NEW.id, v_warehouse_id, v_role_id, NEW.id)
    ON CONFLICT (user_id, warehouse_id, role_id) DO NOTHING;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user_warehouse فشل للمستخدم %: %', NEW.id, SQLERRM;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS on_auth_user_created_link_warehouse ON auth.users;
CREATE TRIGGER on_auth_user_created_link_warehouse
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_warehouse();

-- ============================================================
-- 10) المنح النهائية
-- ============================================================
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.permissions      TO authenticated;
GRANT SELECT ON public.roles            TO authenticated;
GRANT SELECT ON public.role_permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_warehouses TO authenticated;

COMMENT ON COLUMN public.user_warehouses.permissions IS 'صلاحيات دقيقة لكل مستخدم داخل هذا المخزن بصيغة JSON';
COMMENT ON COLUMN public.user_warehouses.role_id     IS 'الدور الأساسي للمستخدم داخل المخزن';
COMMENT ON FUNCTION public.has_permission(text, uuid) IS 'التحقق مما إذا كان المستخدم يملك صلاحية محددة داخل مخزن معين';

DO $do$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(x.col, ', ') INTO v_missing
    FROM (VALUES ('permissions.category'),
                 ('user_warehouses.role_id'),
                 ('user_roles.role_id')) AS x(col)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name  = split_part(x.col, '.', 1)
        AND c.column_name = split_part(x.col, '.', 2)
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'أعمدة مفقودة بعد الترقية: %', v_missing;
  END IF;

  RAISE NOTICE 'تمت مواءمة مخطط الصلاحيات بنجاح';
END
$do$;
