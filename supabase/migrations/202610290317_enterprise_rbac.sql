-- =====================================================================================
-- 202610290317_enterprise_rbac.sql
-- نظام صلاحيات مؤسسي (Enterprise RBAC + Fine-Grained Authorization)
--
-- يعالج هذا الملف:
--   1) كتالوج صلاحيات قانوني (وحدة × عملية) بأسماء عربية، مع تعليم ما هو مطبّق فعليًا.
--   2) محرّك حساب الصلاحيات الفعلية مع مصدر كل صلاحية (دور / منح مباشر / مدير مخزن).
--   3) دوال إدارة الأدوار: إنشاء/تعديل/نسخ/حذف + مصفوفة صلاحيات.
--   4) دوال إدارة أعضاء المخزن: أدوار متعددة + صلاحيات مباشرة + تفعيل/إيقاف.
--   5) منع التصعيد: لا يمنح أحد صلاحية لا يملكها، ولا يعدّل نفسه، ولا يمسّ مالك المخزن.
--   6) سجل مراجعة غير قابل للتعديل/الحذف من المستخدم العادي.
--   7) إغلاق ثغرات الصلاحيات المفتوحة فعليًا في قاعدة البيانات الحيّة.
--
-- آمن للتشغيل المتكرر (idempotent) — لا يحذف بيانات أعمال.
-- =====================================================================================

-- =====================================================================================
-- 1) كتالوج الصلاحيات
-- =====================================================================================
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS name_ar     text;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS sort_order  integer NOT NULL DEFAULT 100;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS is_enforced boolean NOT NULL DEFAULT false;

WITH acts(action, action_ar, aord) AS (VALUES
  ('view','عرض',1), ('create','إضافة',2), ('update','تعديل',3), ('delete','حذف',4),
  ('approve','اعتماد',5), ('reject','رفض',6), ('export','تصدير',7), ('print','طباعة',8),
  ('cancel','إلغاء',9), ('manage','إدارة',10)
),
mods(module, module_ar, mord, actions) AS (VALUES
  ('inventory','المخزون',100,'view,create,update,delete,export,print'),
  ('products','الأصناف والدفعات',200,'view,create,update,delete,export,print'),
  ('expiry','تواريخ الصلاحية',300,'view,update,export'),
  ('purchases','المشتريات',400,'view,create,update,delete,approve,reject,cancel,export,print'),
  ('suppliers','الموردون',500,'view,create,update,delete'),
  ('sales','المبيعات',600,'view,create,update,cancel,export,print'),
  ('pricing','الخصومات والعروض',700,'view,create,update,delete,approve,reject,export'),
  ('customers','الصيدليات والعملاء',800,'view,create,update,delete,export'),
  ('accounting','الحسابات والمحاسبة',900,'view,create,update,approve,export'),
  ('payments','المدفوعات',1000,'view,create,update,cancel,approve'),
  ('returns','المرتجعات',1100,'view,create,approve,reject,cancel'),
  ('delivery','التوصيل والسائقون',1200,'view,create,update,export'),
  ('customer_service','خدمة العملاء',1300,'view,create,update,approve,export'),
  ('hr','الموارد البشرية',1400,'view,create,update,delete,approve,export'),
  ('payroll','الرواتب',1500,'view,create,update,approve,print,export'),
  ('reports','التقارير والتحليلات',1600,'view,export,print'),
  ('notifications','الإشعارات',1700,'view,create,update,delete'),
  ('automation','الأتمتة',1800,'view,create,update,delete,manage'),
  ('settings','إعدادات النظام',1900,'view,update,manage'),
  ('users','إدارة المستخدمين',2000,'view,create,update,delete,manage'),
  ('roles','الأدوار والصلاحيات',2100,'view,create,update,delete'),
  ('audit','سجل المراجعة',2200,'view,export')
)
INSERT INTO public.permissions (name, description, category, name_ar, sort_order, is_enforced)
SELECT m.module || '.' || a.action,
       m.module_ar || ' — ' || a.action_ar,
       m.module,
       a.action_ar,
       m.mord + a.aord,
       (a.action = 'view')                                   -- حجب مسارات الوحدات في الواجهة
       OR m.module IN ('users','roles','audit')              -- مفروضة في دوال الخادم
       OR (m.module || '.' || a.action) IN (
            'reports.export','purchases.approve','purchases.cancel',
            'pricing.approve','sales.cancel','inventory.update')
FROM mods m
JOIN acts a ON a.action = ANY (string_to_array(m.actions, ','))
ON CONFLICT (name) DO UPDATE
  SET description = excluded.description,
      category    = excluded.category,
      name_ar     = excluded.name_ar,
      sort_order  = excluded.sort_order,
      is_enforced = excluded.is_enforced;

-- أسماء عربية للصلاحيات القديمة التي ما زالت مستخدمة فعليًا في التطبيق
UPDATE public.permissions SET name_ar = 'عرض'      WHERE name LIKE '%.read'   AND name_ar IS NULL;
UPDATE public.permissions SET name_ar = 'تعديل'    WHERE name LIKE '%.write'  AND name_ar IS NULL;
UPDATE public.permissions SET name_ar = 'تسوية'    WHERE name LIKE '%.adjust' AND name_ar IS NULL;
UPDATE public.permissions SET name_ar = 'تحويل'    WHERE name LIKE '%.transfer' AND name_ar IS NULL;
UPDATE public.permissions SET name_ar = 'إدارة'    WHERE name LIKE '%.manage' AND name_ar IS NULL;

CREATE INDEX IF NOT EXISTS ix_permissions_enforced ON public.permissions (is_enforced, sort_order);

-- =====================================================================================
-- 2) دوال تطبيع وتوسيع الصلاحيات
--    المرادفات: read→view، write/adjust→update، transfer→create
--    القاعدة: manage يشمل كل عمليات الوحدة، وview تُفهم على أنها read أيضًا.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.rbac_normalize(p_permission text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN p_permission IS NULL OR btrim(p_permission) = '' THEN ''
    WHEN split_part(btrim(p_permission), '.', 2) = 'read'     THEN split_part(btrim(p_permission), '.', 1) || '.view'
    WHEN split_part(btrim(p_permission), '.', 2) = 'write'    THEN split_part(btrim(p_permission), '.', 1) || '.update'
    WHEN split_part(btrim(p_permission), '.', 2) = 'adjust'   THEN split_part(btrim(p_permission), '.', 1) || '.update'
    WHEN split_part(btrim(p_permission), '.', 2) = 'transfer' THEN split_part(btrim(p_permission), '.', 1) || '.create'
    ELSE btrim(p_permission)
  END;
$fn$;

-- الصلاحيات المضمّنة الناتجة عن صلاحية واحدة (manage ⇒ كل عمليات الوحدة)
CREATE OR REPLACE FUNCTION public.rbac_expand(p_permission text)
RETURNS text[]
LANGUAGE sql
STABLE
AS $fn$
  WITH base AS (
    SELECT public.rbac_normalize(p_permission) AS p
  )
  SELECT CASE
    WHEN b.p = '' THEN ARRAY[]::text[]
    WHEN split_part(b.p, '.', 2) = 'manage' THEN
      ARRAY[b.p] || coalesce((
        SELECT array_agg(q.name ORDER BY q.name)
          FROM public.permissions q
         WHERE q.category = split_part(b.p, '.', 1)
      ), ARRAY[]::text[])
    ELSE ARRAY[b.p]
  END
  FROM base b;
$fn$;

-- =====================================================================================
-- 3) لمن هذه الصلاحية فعلًا؟ (ملكية المخزن / مدير النظام)
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.rbac_is_owner(p_user uuid, p_warehouse uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT p_user IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = p_user
         AND lower(coalesce(p.role, '')) IN ('super_admin', 'super-admin', 'owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.warehouses w
       WHERE (p_warehouse IS NULL OR w.id = p_warehouse)
         AND w.manager_id = p_user
    )
    OR EXISTS (
      SELECT 1
        FROM public.user_warehouses uw
        JOIN public.roles r ON r.id = uw.role_id
       WHERE uw.user_id = p_user
         AND (p_warehouse IS NULL OR uw.warehouse_id = p_warehouse)
         AND lower(btrim(r.name)) IN ('super admin', 'tenant admin')
    )
  );
$fn$;

-- =====================================================================================
-- 4) محرّك الصلاحيات الفعلية: صلاحية + مصدرها
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.rbac_effective_permissions(p_user uuid, p_warehouse uuid DEFAULT NULL)
RETURNS TABLE (permission text, source text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF p_user IS NULL THEN
    RETURN;
  END IF;

  IF public.rbac_is_owner(p_user, p_warehouse) THEN
    RETURN QUERY
    SELECT q.name::text, 'owner'::text
      FROM public.permissions q
     WHERE q.is_enforced IS TRUE
        OR q.category IS NOT NULL;
    RETURN;
  END IF;

  RETURN QUERY
  WITH base(permission, source) AS (
    -- صلاحيات مباشرة على العضوية (JSON)
    SELECT lower(btrim(k))::text, 'direct'::text
      FROM public.user_warehouses uw
      CROSS JOIN LATERAL jsonb_object_keys(coalesce(uw.permissions, '{}'::jsonb)) k
     WHERE uw.user_id = p_user
       AND (p_warehouse IS NULL OR uw.warehouse_id = p_warehouse)
       AND lower(coalesce(uw.permissions ->> k, 'false')) IN ('true','t','1','yes','on')

    UNION ALL

    -- صلاحيات الدور الأساسي داخل المخزن
    SELECT perm.name::text, ('role:' || r.name)::text
      FROM public.user_warehouses uw
      JOIN public.roles r ON r.id = uw.role_id
      JOIN public.role_permissions rp ON rp.role_id = r.id
      JOIN public.permissions perm ON perm.id = rp.permission_id
     WHERE uw.user_id = p_user
       AND (p_warehouse IS NULL OR uw.warehouse_id = p_warehouse)
       AND coalesce(r.is_active, true)
       AND r.deleted_at IS NULL

    UNION ALL

    -- صلاحيات الأدوار المتعددة
    SELECT perm.name::text, ('role:' || r.name)::text
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      JOIN public.role_permissions rp ON rp.role_id = r.id
      JOIN public.permissions perm ON perm.id = rp.permission_id
     WHERE ur.user_id = p_user
       AND (p_warehouse IS NULL OR ur.warehouse_id = p_warehouse)
       AND ur.is_active
       AND coalesce(r.is_active, true)
       AND r.deleted_at IS NULL

    UNION ALL

    -- صلاحيات JSON المخزّنة على الدور نفسه (توافق مع المخطط القديم)
    SELECT lower(btrim(k))::text, ('role:' || r.name)::text
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      CROSS JOIN LATERAL jsonb_object_keys(coalesce(r.permissions, '{}'::jsonb)) k
     WHERE ur.user_id = p_user
       AND (p_warehouse IS NULL OR ur.warehouse_id = p_warehouse)
       AND ur.is_active
       AND coalesce(r.is_active, true)
       AND r.deleted_at IS NULL
       AND lower(coalesce(r.permissions ->> k, 'false')) IN ('true','t','1','yes','on')

    UNION ALL

    SELECT lower(btrim(k))::text, ('role:' || r.name)::text
      FROM public.user_warehouses uw
      JOIN public.roles r ON r.id = uw.role_id
      CROSS JOIN LATERAL jsonb_object_keys(coalesce(r.permissions, '{}'::jsonb)) k
     WHERE uw.user_id = p_user
       AND (p_warehouse IS NULL OR uw.warehouse_id = p_warehouse)
       AND coalesce(r.is_active, true)
       AND r.deleted_at IS NULL
       AND lower(coalesce(r.permissions ->> k, 'false')) IN ('true','t','1','yes','on')
  )
  SELECT DISTINCT e.p, b.source
    FROM base b
    CROSS JOIN LATERAL unnest(public.rbac_expand(b.permission)) AS e(p)
   WHERE e.p <> '';
END
$fn$;

-- =====================================================================================
-- 5) has_permission: النسخة القانونية (تفهم المرادفات + manage + الأدوار المتعددة)
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.has_permission(p_permission text, p_warehouse_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.rbac_effective_permissions(auth.uid(), p_warehouse_id) e
        WHERE e.permission = public.rbac_normalize(p_permission)
     );
$fn$;

-- نسخة ترفع استثناءً (للاستخدام داخل الدوال الحساسة)
CREATE OR REPLACE FUNCTION public.rbac_require(p_permission text, p_warehouse uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'جلسة غير صالحة — يجب تسجيل الدخول' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_permission(p_permission, p_warehouse) THEN
    RAISE EXCEPTION 'غير مصرح: تتطلب هذه العملية صلاحية %', p_permission USING ERRCODE = '42501';
  END IF;
END
$fn$;

-- الصلاحيات القابلة للمنح من قِبل المستخدم الحالي في مخزن معيّن
CREATE OR REPLACE FUNCTION public.rbac_grantable(p_warehouse uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN public.rbac_is_owner(auth.uid(), p_warehouse) THEN
      coalesce((SELECT array_agg(p.name ORDER BY p.name) FROM public.permissions p), ARRAY[]::text[])
    ELSE
      coalesce((SELECT array_agg(DISTINCT e.permission)
                  FROM public.rbac_effective_permissions(auth.uid(), p_warehouse) e), ARRAY[]::text[])
  END;
$fn$;

-- هل يستطيع المستخدم الحالي إدارة هذا المخزن؟
CREATE OR REPLACE FUNCTION public.current_actor_manages(p_warehouse uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    public.rbac_is_owner(auth.uid(), p_warehouse)
    OR EXISTS (
      SELECT 1
        FROM public.user_warehouses uw
        JOIN public.roles r ON r.id = uw.role_id
       WHERE uw.user_id = auth.uid()
         AND uw.warehouse_id = p_warehouse
         AND lower(btrim(r.name)) IN ('warehouse manager')
    )
    OR EXISTS (
      SELECT 1 FROM public.warehouse_employees e
       WHERE e.user_id = auth.uid() AND e.warehouse_id = p_warehouse AND e.is_active
    )
    OR public.has_permission('users.manage', p_warehouse)
    OR public.has_permission('users.update', p_warehouse)
  );
$fn$;

-- =====================================================================================
-- 6) كتالوج جاهز للواجهة (مجموعات + عربي)
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
       GROUP BY p.category
    ) g;
$fn$;

-- =====================================================================================
-- 7) إدارة الأدوار
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.rbac_roles_list()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'name', r.name,
           'name_ar', coalesce(nullif(btrim(r.name_ar), ''), r.name),
           'description', r.description,
           'is_system', coalesce(r.is_system_role, r.is_system, false),
           'is_active', coalesce(r.is_active, true),
           'permissions', coalesce((
              SELECT jsonb_agg(p.name ORDER BY p.name)
                FROM public.role_permissions rp
                JOIN public.permissions p ON p.id = rp.permission_id
               WHERE rp.role_id = r.id
           ), '[]'::jsonb),
           'members', (
              SELECT count(DISTINCT uw.user_id)::int FROM public.user_warehouses uw WHERE uw.role_id = r.id
           )
         ) ORDER BY r.name), '[]'::jsonb)
    FROM public.roles r
   WHERE r.deleted_at IS NULL
     AND auth.uid() IS NOT NULL;
$fn$;

CREATE OR REPLACE FUNCTION public.rbac_role_upsert(
  p_role_id    uuid,
  p_name       text,
  p_name_ar    text,
  p_description text,
  p_permissions text[],
  p_warehouse  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_role      public.roles%ROWTYPE;
  v_is_owner  boolean;
  v_grantable text[];
  v_bad       text[];
  v_unknown   text[];
  v_perms     text[];
  v_old       text[];
  v_name      text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'جلسة غير صالحة' USING ERRCODE = '42501';
  END IF;
  IF p_warehouse IS NULL OR NOT public.current_actor_manages(p_warehouse) THEN
    RAISE EXCEPTION 'غير مصرح بإدارة الأدوار في هذا المخزن' USING ERRCODE = '42501';
  END IF;

  v_is_owner := public.rbac_is_owner(v_uid, p_warehouse);
  v_name := btrim(coalesce(p_name, ''));

  IF v_name !~ '^[A-Za-z][A-Za-z0-9 ._-]{1,40}$' THEN
    RAISE EXCEPTION 'اسم الدور يجب أن يبدأ بحرف إنجليزي ويحتوي حروفًا أو أرقامًا أو . _ - (2-41 حرفًا)';
  END IF;

  -- تطبيع وفحص الصلاحيات المطلوبة مقابل الكتالوج
  SELECT coalesce(array_agg(DISTINCT public.rbac_normalize(x)), ARRAY[]::text[])
    INTO v_perms
    FROM unnest(coalesce(p_permissions, ARRAY[]::text[])) x
   WHERE btrim(coalesce(x, '')) <> '';

  SELECT coalesce(array_agg(x), ARRAY[]::text[]) INTO v_unknown
    FROM unnest(v_perms) x
   WHERE NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.name = x);

  IF array_length(v_unknown, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'صلاحيات غير معروفة: %', array_to_string(v_unknown, ', ');
  END IF;

  -- منع منح ما لا يملكه المستخدم
  IF NOT v_is_owner THEN
    v_grantable := public.rbac_grantable(p_warehouse);
    SELECT coalesce(array_agg(x), ARRAY[]::text[]) INTO v_bad
      FROM unnest(v_perms) x
     WHERE NOT (x = ANY (coalesce(v_grantable, ARRAY[]::text[])));
    IF array_length(v_bad, 1) IS NOT NULL THEN
      RAISE EXCEPTION 'لا يمكنك منح صلاحيات لا تملكها: %', array_to_string(v_bad, ', ') USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_role_id IS NULL THEN
    INSERT INTO public.roles (name, name_ar, description, permissions, is_system, is_system_role, is_active, created_by)
    VALUES (v_name, coalesce(nullif(btrim(p_name_ar), ''), v_name), p_description, '{}'::jsonb,
            false, false, true, v_uid)
    RETURNING * INTO v_role;
  ELSE
    SELECT * INTO v_role FROM public.roles WHERE id = p_role_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الدور غير موجود';
    END IF;

    IF coalesce(v_role.is_system_role, v_role.is_system, false)
       OR lower(btrim(v_role.name)) IN ('super admin', 'tenant admin') THEN
      IF NOT v_is_owner THEN
        RAISE EXCEPTION 'لا يمكن تعديل دور نظامي إلا بواسطة مالك المخزن' USING ERRCODE = '42501';
      END IF;
      IF v_name <> v_role.name THEN
        RAISE EXCEPTION 'لا يمكن تغيير اسم دور نظامي';
      END IF;
    END IF;

    -- إذا كان الدور الحالي يمنح صلاحيات تتجاوز صلاحيات المستخدم، لا يُسمح بتعديله
    SELECT coalesce(array_agg(p.name), ARRAY[]::text[]) INTO v_old
      FROM public.role_permissions rp
      JOIN public.permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = v_role.id;

    IF NOT v_is_owner AND EXISTS (
      SELECT 1 FROM unnest(v_old) x
       WHERE NOT (public.rbac_normalize(x) = ANY (coalesce(public.rbac_grantable(p_warehouse), ARRAY[]::text[])))
    ) THEN
      RAISE EXCEPTION 'هذا الدور يمنح صلاحيات أعلى من صلاحياتك، لا يمكنك تعديله' USING ERRCODE = '42501';
    END IF;

    IF EXISTS (SELECT 1 FROM public.roles r2 WHERE r2.id <> v_role.id AND lower(r2.name) = lower(v_name) AND r2.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'يوجد دور آخر بنفس الاسم';
    END IF;

    UPDATE public.roles
       SET name = v_name,
           name_ar = coalesce(nullif(btrim(p_name_ar), ''), v_name),
           description = p_description,
           updated_at = now(),
           updated_by = v_uid
     WHERE id = v_role.id
    RETURNING * INTO v_role;
  END IF;

  -- كتابة الصلاحيات
  DELETE FROM public.role_permissions WHERE role_id = v_role.id;
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_role.id, p.id
    FROM public.permissions p
   WHERE p.name = ANY (v_perms)
  ON CONFLICT DO NOTHING;

  UPDATE public.roles
     SET permissions = coalesce((SELECT jsonb_object_agg(x, true) FROM unnest(v_perms) x), '{}'::jsonb),
         updated_at = now()
   WHERE id = v_role.id;

  INSERT INTO public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
  SELECT w.tenant_id, v_uid, p_warehouse,
         CASE WHEN p_role_id IS NULL THEN 'rbac_role_create' ELSE 'rbac_role_update' END,
         'roles', v_role.id,
         jsonb_build_object('name', v_name, 'permissions', to_jsonb(v_perms), 'previous', to_jsonb(v_old))
    FROM public.warehouses w WHERE w.id = p_warehouse;

  RETURN jsonb_build_object('ok', true, 'role_id', v_role.id, 'name', v_role.name, 'permissions', to_jsonb(v_perms));
END
$fn$;

CREATE OR REPLACE FUNCTION public.rbac_role_duplicate(p_role_id uuid, p_name text, p_name_ar text, p_warehouse uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_perms text[];
BEGIN
  SELECT coalesce(array_agg(p.name), ARRAY[]::text[]) INTO v_perms
    FROM public.role_permissions rp
    JOIN public.permissions p ON p.id = rp.permission_id
   WHERE rp.role_id = p_role_id;

  RETURN public.rbac_role_upsert(NULL, p_name, p_name_ar, 'نسخة من دور', v_perms, p_warehouse);
END
$fn$;

CREATE OR REPLACE FUNCTION public.rbac_role_delete(p_role_id uuid, p_warehouse uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_role public.roles%ROWTYPE;
  v_in_use int;
BEGIN
  IF p_warehouse IS NULL OR NOT public.current_actor_manages(p_warehouse) THEN
    RAISE EXCEPTION 'غير مصرح بإدارة الأدوار في هذا المخزن' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الدور غير موجود';
  END IF;

  IF coalesce(v_role.is_system_role, v_role.is_system, false)
     OR lower(btrim(v_role.name)) IN ('super admin', 'tenant admin') THEN
    RAISE EXCEPTION 'لا يمكن حذف دور نظامي';
  END IF;

  IF NOT public.rbac_is_owner(auth.uid(), p_warehouse) AND EXISTS (
    SELECT 1 FROM public.role_permissions rp
      JOIN public.permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = p_role_id
       AND NOT (p.name = ANY (coalesce(public.rbac_grantable(p_warehouse), ARRAY[]::text[])))
  ) THEN
    RAISE EXCEPTION 'هذا الدور يمنح صلاحيات أعلى من صلاحياتك، لا يمكنك حذفه' USING ERRCODE = '42501';
  END IF;

  SELECT (
      (SELECT count(*) FROM public.user_warehouses WHERE role_id = p_role_id) +
      (SELECT count(*) FROM public.user_roles WHERE role_id = p_role_id) +
      (SELECT count(*) FROM public.warehouse_employees WHERE role_id = p_role_id)
  ) INTO v_in_use;

  IF v_in_use > 0 THEN
    RAISE EXCEPTION 'لا يمكن حذف دور مستخدم من % موظف — انقل الموظفين إلى دور آخر أولاً', v_in_use;
  END IF;

  DELETE FROM public.role_permissions WHERE role_id = p_role_id;
  UPDATE public.roles SET deleted_at = now(), is_active = false, updated_at = now(), updated_by = auth.uid()
   WHERE id = p_role_id;

  INSERT INTO public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, old_values)
  SELECT w.tenant_id, auth.uid(), p_warehouse, 'rbac_role_delete', 'roles', p_role_id,
         jsonb_build_object('name', v_role.name)
    FROM public.warehouses w WHERE w.id = p_warehouse;

  RETURN jsonb_build_object('ok', true);
END
$fn$;

-- =====================================================================================
-- 8) إدارة أعضاء المخزن (أدوار متعددة + صلاحيات مباشرة + تفعيل/إيقاف)
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.rbac_member_get(p_warehouse uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_direct jsonb;
  v_roles  jsonb;
  v_eff    jsonb;
  v_emp    jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'جلسة غير صالحة' USING ERRCODE = '42501';
  END IF;
  IF NOT (p_user_id = auth.uid() OR public.current_actor_manages(p_warehouse)) THEN
    RAISE EXCEPTION 'غير مصرح بعرض صلاحيات هذا الموظف' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(uw.permissions, '{}'::jsonb) INTO v_direct
    FROM public.user_warehouses uw
   WHERE uw.user_id = p_user_id AND uw.warehouse_id = p_warehouse;

  SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('id', r.id, 'name', r.name, 'name_ar', coalesce(r.name_ar, r.name))), '[]'::jsonb)
    INTO v_roles
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
   WHERE ur.user_id = p_user_id AND ur.warehouse_id = p_warehouse AND ur.is_active;

  SELECT coalesce(jsonb_agg(jsonb_build_object('permission', e.permission, 'source', e.source) ORDER BY e.permission), '[]'::jsonb)
    INTO v_eff
    FROM public.rbac_effective_permissions(p_user_id, p_warehouse) e;

  SELECT to_jsonb(x) INTO v_emp FROM (
    SELECT e.full_name, e.username, e.is_active, e.role_id
      FROM public.warehouse_employees e
     WHERE e.user_id = p_user_id AND e.warehouse_id = p_warehouse
     LIMIT 1
  ) x;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'warehouse_id', p_warehouse,
    'direct', coalesce(v_direct, '{}'::jsonb),
    'roles', v_roles,
    'effective', v_eff,
    'employee', coalesce(v_emp, 'null'::jsonb)
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.rbac_member_set(
  p_warehouse  uuid,
  p_user_id    uuid,
  p_role_ids   uuid[],
  p_direct     jsonb,
  p_is_active  boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_is_owner  boolean;
  v_grantable text[];
  v_requested text[] := ARRAY[]::text[];
  v_bad       text[];
  v_tenant    uuid;
  v_target_owner boolean;
  v_direct    jsonb := '{}'::jsonb;
  v_primary   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'جلسة غير صالحة' USING ERRCODE = '42501';
  END IF;
  IF NOT public.current_actor_manages(p_warehouse) THEN
    RAISE EXCEPTION 'غير مصرح بإدارة فريق هذا المخزن' USING ERRCODE = '42501';
  END IF;
  IF p_user_id = v_uid THEN
    RAISE EXCEPTION 'لا يمكنك تعديل دورك أو صلاحياتك بنفسك' USING ERRCODE = '42501';
  END IF;

  SELECT w.tenant_id, (w.manager_id = p_user_id) INTO v_tenant, v_target_owner
    FROM public.warehouses w WHERE w.id = p_warehouse;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'المخزن غير موجود';
  END IF;

  v_is_owner := public.rbac_is_owner(v_uid, p_warehouse);

  IF v_target_owner AND NOT v_is_owner THEN
    RAISE EXCEPTION 'لا يمكن تعديل صلاحيات مالك المخزن' USING ERRCODE = '42501';
  END IF;
  IF public.rbac_is_owner(p_user_id, p_warehouse) AND NOT v_is_owner THEN
    RAISE EXCEPTION 'لا يمكن تعديل صلاحيات حساب إداري أعلى منك' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_warehouses uw WHERE uw.user_id = p_user_id AND uw.warehouse_id = p_warehouse
       OR EXISTS (SELECT 1 FROM public.warehouse_employees e WHERE e.user_id = p_user_id AND e.warehouse_id = p_warehouse)
  ) THEN
    RAISE EXCEPTION 'هذا المستخدم ليس عضوًا في المخزن — أضفه أولاً';
  END IF;

  -- الصلاحيات المباشرة: قيم منطقية فقط
  IF p_direct IS NOT NULL AND jsonb_typeof(p_direct) = 'object' THEN
    SELECT coalesce(jsonb_object_agg(key, true), '{}'::jsonb) INTO v_direct
      FROM jsonb_each(p_direct)
     WHERE value IN ('true'::jsonb, '"true"'::jsonb, '1'::jsonb, '"1"'::jsonb, 't'::jsonb);
  END IF;

  SELECT coalesce(array_agg(DISTINCT public.rbac_normalize(x)), ARRAY[]::text[]) INTO v_requested
    FROM (
      SELECT jsonb_object_keys(v_direct) AS x
      UNION
      SELECT p.name
        FROM public.role_permissions rp
        JOIN public.permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ANY (coalesce(p_role_ids, ARRAY[]::uuid[]))
    ) s
   WHERE btrim(coalesce(x, '')) <> '';

  SELECT coalesce(array_agg(x), ARRAY[]::text[]) INTO v_bad
    FROM unnest(v_requested) x
   WHERE NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.name = x);
  IF array_length(v_bad, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'صلاحيات غير معروفة: %', array_to_string(v_bad, ', ');
  END IF;

  IF NOT v_is_owner THEN
    v_grantable := public.rbac_grantable(p_warehouse);
    SELECT coalesce(array_agg(x), ARRAY[]::text[]) INTO v_bad
      FROM unnest(v_requested) x
     WHERE NOT (x = ANY (coalesce(v_grantable, ARRAY[]::text[])));
    IF array_length(v_bad, 1) IS NOT NULL THEN
      RAISE EXCEPTION 'لا يمكنك منح صلاحيات لا تملكها: %', array_to_string(v_bad, ', ') USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT r.id INTO v_primary FROM unnest(coalesce(p_role_ids, ARRAY[]::uuid[])) WITH ORDINALITY t(id, ord)
    JOIN public.roles r ON r.id = t.id
   ORDER BY t.ord LIMIT 1;

  -- إيقاف الحساب: إزالة العضوية ومنع الدخول
  IF p_is_active IS FALSE THEN
    UPDATE public.warehouse_employees
       SET is_active = false, updated_at = now()
     WHERE user_id = p_user_id AND warehouse_id = p_warehouse;

    UPDATE public.user_roles SET is_active = false
     WHERE user_id = p_user_id AND warehouse_id = p_warehouse;

    DELETE FROM public.user_warehouses WHERE user_id = p_user_id AND warehouse_id = p_warehouse;

    INSERT INTO public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
    VALUES (v_tenant, v_uid, p_warehouse, 'rbac_member_deactivate', 'user_warehouses', p_user_id,
            jsonb_build_object('previous_roles', to_jsonb(coalesce(p_role_ids, ARRAY[]::uuid[]))));

    RETURN jsonb_build_object('ok', true, 'active', false);
  END IF;

  INSERT INTO public.user_warehouses AS uw (user_id, warehouse_id, tenant_id, role_id, permissions, is_default)
  VALUES (p_user_id, p_warehouse, v_tenant, v_primary, v_direct, false)
  ON CONFLICT (user_id, warehouse_id) DO UPDATE
    SET role_id = coalesce(excluded.role_id, uw.role_id),
        permissions = excluded.permissions;

  UPDATE public.user_roles SET is_active = false
   WHERE user_id = p_user_id AND warehouse_id = p_warehouse
     AND NOT (role_id = ANY (coalesce(p_role_ids, ARRAY[]::uuid[])));

  INSERT INTO public.user_roles (user_id, warehouse_id, role_id, assigned_by, is_active)
  SELECT p_user_id, p_warehouse, t.id, v_uid, true
    FROM unnest(coalesce(p_role_ids, ARRAY[]::uuid[])) t(id)
  ON CONFLICT (user_id, warehouse_id, role_id) DO UPDATE SET is_active = true;

  UPDATE public.warehouse_employees
     SET role_id = coalesce(v_primary, role_id),
         permissions = v_direct,
         is_active = true,
         updated_at = now()
   WHERE user_id = p_user_id AND warehouse_id = p_warehouse;

  INSERT INTO public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
  VALUES (v_tenant, v_uid, p_warehouse, 'rbac_member_set', 'user_warehouses', p_user_id,
          jsonb_build_object('roles', to_jsonb(coalesce(p_role_ids, ARRAY[]::uuid[])),
                             'direct', v_direct, 'active', true));

  RETURN jsonb_build_object('ok', true, 'active', true, 'roles', to_jsonb(coalesce(p_role_ids, ARRAY[]::uuid[])),
                            'permissions', to_jsonb(v_requested));
END
$fn$;

-- =====================================================================================
-- 9) سجل المراجعة: قراءة محصورة + منع التعديل/الحذف
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.tg_audit_logs_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'سجل المراجعة غير قابل للتعديل أو الحذف' USING ERRCODE = '42501';
END
$fn$;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_logs_immutable();

CREATE OR REPLACE FUNCTION public.rbac_audit_list(
  p_warehouse uuid,
  p_action    text DEFAULT NULL,
  p_limit     int  DEFAULT 100,
  p_offset    int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 300);
BEGIN
  IF p_warehouse IS NOT NULL AND NOT public.current_actor_manages(p_warehouse) THEN
    RAISE EXCEPTION 'غير مصرح بعرض سجل المراجعة لهذا المخزن' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC)
      FROM (
        SELECT a.id, a.action, a.entity_type, a.entity_id, a.warehouse_id,
               a.user_id, coalesce(pr.full_name, '') AS actor_name,
               a.new_values, a.old_values, a.created_at
          FROM public.audit_logs a
          LEFT JOIN public.profiles pr ON pr.id = a.user_id
         WHERE (p_warehouse IS NULL OR a.warehouse_id = p_warehouse)
           AND (p_action IS NULL OR btrim(p_action) = '' OR a.action = p_action)
         ORDER BY a.created_at DESC
         LIMIT v_limit OFFSET greatest(coalesce(p_offset, 0), 0)
      ) t
  ), '[]'::jsonb);
END
$fn$;

-- =====================================================================================
-- 10) تشديد الأمان: إغلاق الكتابة المفتوحة على جداول الصلاحيات
-- =====================================================================================
REVOKE ALL ON public.roles            FROM anon;
REVOKE ALL ON public.permissions      FROM anon;
REVOKE ALL ON public.role_permissions FROM anon;
REVOKE ALL ON public.user_warehouses  FROM anon;
REVOKE ALL ON public.user_roles       FROM anon;
REVOKE ALL ON public.audit_logs       FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.roles            FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.role_permissions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.permissions      FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE          ON public.audit_logs      FROM authenticated;

-- الكتابة على user_warehouses/user_roles تتم فقط عبر الدوال (SECURITY DEFINER)
DROP POLICY IF EXISTS team_insert_members         ON public.user_warehouses;
DROP POLICY IF EXISTS team_update_members         ON public.user_warehouses;
DROP POLICY IF EXISTS team_delete_members         ON public.user_warehouses;
DROP POLICY IF EXISTS admins_can_update_permissions ON public.user_warehouses;
DROP POLICY IF EXISTS user_roles_manage_admin     ON public.user_roles;
DROP POLICY IF EXISTS user_roles_select_own_or_admin ON public.user_roles;

-- سياسات مفتوحة كانت تسمح لأي زائر بكتابة الأدوار والصلاحيات
DROP POLICY IF EXISTS "Service role full access to roles" ON public.roles;
DROP POLICY IF EXISTS "Allow public read access to roles" ON public.roles;
DROP POLICY IF EXISTS permissions_write_authenticated    ON public.permissions;
DROP POLICY IF EXISTS authenticated_can_read_user_roles  ON public.user_roles;
DROP POLICY IF EXISTS admins_can_manage_user_roles       ON public.user_roles;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.permissions, public.roles, public.role_permissions, public.user_roles, public.warehouse_employees TO authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;

-- سياسات قراءة فقط (الكتابة عبر الدوال)
DROP POLICY IF EXISTS rb_roles_read ON public.roles;
CREATE POLICY rb_roles_read ON public.roles
  FOR SELECT TO authenticated USING (deleted_at IS NULL);

DROP POLICY IF EXISTS rb_permissions_read ON public.permissions;
CREATE POLICY rb_permissions_read ON public.permissions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS rb_role_permissions_read ON public.role_permissions;
CREATE POLICY rb_role_permissions_read ON public.role_permissions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS rb_user_roles_read_own ON public.user_roles;
CREATE POLICY rb_user_roles_read_own ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.current_actor_manages(warehouse_id));

-- =====================================================================================
-- 11) المنح
-- =====================================================================================
GRANT EXECUTE ON FUNCTION public.rbac_normalize(text)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_expand(text)                                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_is_owner(uuid, uuid)                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_effective_permissions(uuid, uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_grantable(uuid)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_require(text, uuid)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_catalog()                                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_roles_list()                                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_role_upsert(uuid, text, text, text, text[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_role_duplicate(uuid, text, text, uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_role_delete(uuid, uuid)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_member_get(uuid, uuid)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_member_set(uuid, uuid, uuid[], jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_audit_list(uuid, text, int, int)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(text, uuid)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_actor_manages(uuid)                       TO authenticated;

-- =====================================================================================
-- 12) تحقق نهائي
-- =====================================================================================
DO $do$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(x.fn, ', ') INTO v_missing
    FROM (VALUES ('rbac_normalize'), ('rbac_expand'), ('rbac_is_owner'),
                 ('rbac_effective_permissions'), ('rbac_grantable'), ('rbac_require'),
                 ('rbac_catalog'), ('rbac_roles_list'), ('rbac_role_upsert'),
                 ('rbac_role_duplicate'), ('rbac_role_delete'), ('rbac_member_get'),
                 ('rbac_member_set'), ('rbac_audit_list'), ('has_permission'),
                 ('current_actor_manages')) AS x(fn)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_proc p WHERE p.proname = x.fn AND p.pronamespace = 'public'::regnamespace
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'دوال مفقودة بعد الإنشاء: %', v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'permissions' AND column_name = 'is_enforced'
  ) THEN
    RAISE EXCEPTION 'العمود permissions.is_enforced غير موجود';
  END IF;

  RAISE NOTICE 'نظام الصلاحيات المؤسسي جاهز';
END
$do$;
