-- =====================================================================================
-- 202610290318_rbac_fixes.sql
-- تصحيحات وإضافات فوق 202610290317_enterprise_rbac.sql
--   1) تصحيح شرط التحقق من عضوية الموظف في rbac_member_set (أسبقية OR).
--   2) rbac_role_get: قراءة دور واحد مع صلاحياته لشاشة التعديل.
--   3) rbac_my_context: سياق المستخدم الكامل (مخزنه، أدواره، صلاحياته ومصادرها).
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1) إعادة كتابة rbac_member_set بشرط عضوية صحيح
-- -------------------------------------------------------------------------------------
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
  v_uid          uuid := auth.uid();
  v_is_owner     boolean;
  v_grantable    text[];
  v_requested    text[] := ARRAY[]::text[];
  v_bad          text[];
  v_tenant       uuid;
  v_target_owner boolean;
  v_direct       jsonb := '{}'::jsonb;
  v_primary      uuid;
  v_is_member    boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'جلسة غير صالحة' USING ERRCODE = '42501';
  END IF;
  IF p_warehouse IS NULL OR NOT public.current_actor_manages(p_warehouse) THEN
    RAISE EXCEPTION 'غير مصرح بإدارة فريق هذا المخزن' USING ERRCODE = '42501';
  END IF;
  IF p_user_id = v_uid THEN
    RAISE EXCEPTION 'لا يمكنك تعديل دورك أو صلاحياتك بنفسك' USING ERRCODE = '42501';
  END IF;

  SELECT w.tenant_id, (w.manager_id = p_user_id) INTO v_tenant, v_target_owner
    FROM public.warehouses w WHERE w.id = p_warehouse;
  IF v_tenant IS NULL AND NOT EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id = p_warehouse) THEN
    RAISE EXCEPTION 'المخزن غير موجود';
  END IF;

  v_is_owner := public.rbac_is_owner(v_uid, p_warehouse);

  IF v_target_owner AND NOT v_is_owner THEN
    RAISE EXCEPTION 'لا يمكن تعديل صلاحيات مالك المخزن' USING ERRCODE = '42501';
  END IF;
  IF public.rbac_is_owner(p_user_id, p_warehouse) AND NOT v_is_owner THEN
    RAISE EXCEPTION 'لا يمكن تعديل صلاحيات حساب إداري أعلى منك' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
           SELECT 1 FROM public.user_warehouses uw
            WHERE uw.user_id = p_user_id AND uw.warehouse_id = p_warehouse
         )
      OR EXISTS (
           SELECT 1 FROM public.warehouse_employees e
            WHERE e.user_id = p_user_id AND e.warehouse_id = p_warehouse
         )
    INTO v_is_member;

  IF NOT v_is_member THEN
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
      SELECT perm.name
        FROM public.role_permissions rp
        JOIN public.permissions perm ON perm.id = rp.permission_id
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

  SELECT r.id INTO v_primary
    FROM unnest(coalesce(p_role_ids, ARRAY[]::uuid[])) WITH ORDINALITY t(id, ord)
    JOIN public.roles r ON r.id = t.id AND r.deleted_at IS NULL
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

  RETURN jsonb_build_object('ok', true, 'active', true,
                            'roles', to_jsonb(coalesce(p_role_ids, ARRAY[]::uuid[])),
                            'permissions', to_jsonb(v_requested));
END
$fn$;

-- -------------------------------------------------------------------------------------
-- 2) قراءة دور واحد
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rbac_role_get(p_role_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
           'id', r.id,
           'name', r.name,
           'name_ar', coalesce(nullif(btrim(r.name_ar), ''), r.name),
           'description', r.description,
           'is_system', coalesce(r.is_system_role, r.is_system, false),
           'permissions', coalesce((
              SELECT jsonb_agg(p.name ORDER BY p.name)
                FROM public.role_permissions rp
                JOIN public.permissions p ON p.id = rp.permission_id
               WHERE rp.role_id = r.id), '[]'::jsonb)
         )
    FROM public.roles r
   WHERE r.id = p_role_id AND r.deleted_at IS NULL AND auth.uid() IS NOT NULL;
$fn$;

-- -------------------------------------------------------------------------------------
-- 3) سياق المستخدم (يستبدل قراءة الأدوار والصلاحيات من الواجهة)
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rbac_my_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_warehouse  uuid;
  v_role       text;
  v_roles      jsonb;
  v_perms      jsonb;
  v_is_owner   boolean;
  v_employee   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('authenticated', false);
  END IF;

  SELECT uw.warehouse_id INTO v_warehouse
    FROM public.user_warehouses uw
   WHERE uw.user_id = v_uid
   ORDER BY uw.is_default DESC, uw.created_at NULLS LAST
   LIMIT 1;

  IF v_warehouse IS NULL THEN
    SELECT e.warehouse_id INTO v_warehouse
      FROM public.warehouse_employees e
     WHERE e.user_id = v_uid AND e.is_active
     LIMIT 1;
  END IF;

  SELECT r.name INTO v_role
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
   WHERE ur.user_id = v_uid
     AND (v_warehouse IS NULL OR ur.warehouse_id = v_warehouse)
     AND ur.is_active
   ORDER BY ur.assigned_at NULLS LAST
   LIMIT 1;

  IF v_role IS NULL THEN
    SELECT r.name INTO v_role
      FROM public.user_warehouses uw
      JOIN public.roles r ON r.id = uw.role_id
     WHERE uw.user_id = v_uid
       AND (v_warehouse IS NULL OR uw.warehouse_id = v_warehouse)
     LIMIT 1;
  END IF;

  SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('id', r.id, 'name', r.name, 'name_ar', coalesce(r.name_ar, r.name))), '[]'::jsonb)
    INTO v_roles
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
   WHERE ur.user_id = v_uid
     AND (v_warehouse IS NULL OR ur.warehouse_id = v_warehouse)
     AND ur.is_active;

  SELECT coalesce(jsonb_object_agg(t.permission, t.sources), '{}'::jsonb) INTO v_perms
    FROM (
      SELECT e.permission, jsonb_agg(DISTINCT e.source) AS sources
        FROM public.rbac_effective_permissions(v_uid, v_warehouse) e
       GROUP BY e.permission
    ) t;

  v_is_owner := public.rbac_is_owner(v_uid, v_warehouse);

  SELECT to_jsonb(x) INTO v_employee FROM (
    SELECT e.full_name, e.username, e.is_active
      FROM public.warehouse_employees e
     WHERE e.user_id = v_uid AND e.is_active
     LIMIT 1
  ) x;

  RETURN jsonb_build_object(
    'authenticated', true,
    'user_id', v_uid,
    'warehouse_id', v_warehouse,
    'role', coalesce(v_role, ''),
    'roles', v_roles,
    'permissions', v_perms,
    'is_owner', v_is_owner,
    'can_manage_users', public.current_actor_manages(v_warehouse),
    'employee', coalesce(v_employee, 'null'::jsonb)
  );
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rbac_member_set(uuid, uuid, uuid[], jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_role_get(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_my_context()     TO authenticated;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rbac_my_context' AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'rbac_my_context غير موجودة';
  END IF;
  RAISE NOTICE 'تصحيحات RBAC جاهزة';
END
$do$;
