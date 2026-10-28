-- =====================================================================================
-- 202610290321_rbac_member_perms_filter.sql
-- بعض الأدوار القديمة تحتوي أسماء صلاحيات خارج الكتالوج (مثل warehouses.view).
-- عند إسناد الدور يجب تجاهل هذه الأسماء بدل رفض العملية، مع بقاء التحقق الصارم
-- على الصلاحيات المباشرة التي يمنحها المستخدم.
-- =====================================================================================

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

  -- الصلاحيات المباشرة: أسماء قانونية فقط
  IF p_direct IS NOT NULL AND jsonb_typeof(p_direct) = 'object' THEN
    SELECT coalesce(jsonb_object_agg(normalized_key, true), '{}'::jsonb) INTO v_direct
      FROM (
        SELECT public.rbac_normalize(key) AS normalized_key, value
          FROM jsonb_each(p_direct)
      ) d
     WHERE value IN ('true'::jsonb, '"true"'::jsonb, '1'::jsonb, '"1"'::jsonb)
       AND EXISTS (
         SELECT 1 FROM public.permissions p WHERE p.name = d.normalized_key
       );

    SELECT coalesce(array_agg(key), ARRAY[]::text[]) INTO v_bad
      FROM jsonb_each(p_direct)
     WHERE value IN ('true'::jsonb, '"true"'::jsonb, '1'::jsonb, '"1"'::jsonb)
       AND NOT EXISTS (
         SELECT 1 FROM public.permissions p WHERE p.name = public.rbac_normalize(key)
       );

    IF array_length(v_bad, 1) IS NOT NULL THEN
      RAISE EXCEPTION 'صلاحيات غير معروفة: %', array_to_string(v_bad, ', ');
    END IF;
  END IF;

  -- صلاحيات الأدوار: تُقبل الأسماء الموجودة في الكتالوج فقط (تجاهل القديم غير المعرّف)
  SELECT coalesce(array_agg(DISTINCT public.rbac_normalize(x)), ARRAY[]::text[]) INTO v_requested
    FROM (
      SELECT jsonb_object_keys(v_direct) AS x
      UNION
      SELECT perm.name
        FROM public.role_permissions rp
        JOIN public.permissions perm ON perm.id = rp.permission_id
       WHERE rp.role_id = ANY (coalesce(p_role_ids, ARRAY[]::uuid[]))
    ) s
   WHERE btrim(coalesce(x, '')) <> ''
     AND EXISTS (SELECT 1 FROM public.permissions p WHERE p.name = public.rbac_normalize(x));

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

  IF p_is_active IS FALSE THEN
    UPDATE public.user_warehouses SET is_active = false
     WHERE user_id = p_user_id AND warehouse_id = p_warehouse;

    UPDATE public.user_roles SET is_active = false
     WHERE user_id = p_user_id AND warehouse_id = p_warehouse;

    UPDATE public.warehouse_employees SET is_active = false, updated_at = now()
     WHERE user_id = p_user_id AND warehouse_id = p_warehouse;

    INSERT INTO public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
    VALUES (v_tenant, v_uid, p_warehouse, 'rbac_member_deactivate', 'user_warehouses', p_user_id,
            jsonb_build_object('previous_roles', to_jsonb(coalesce(p_role_ids, ARRAY[]::uuid[]))));

    RETURN jsonb_build_object('ok', true, 'active', false);
  END IF;

  INSERT INTO public.user_warehouses AS uw (user_id, warehouse_id, tenant_id, role_id, permissions, is_default, is_active)
  VALUES (p_user_id, p_warehouse, v_tenant, v_primary, v_direct, false, true)
  ON CONFLICT (user_id, warehouse_id) DO UPDATE
    SET role_id = coalesce(excluded.role_id, uw.role_id),
        permissions = excluded.permissions,
        is_active = true;

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

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rbac_member_set' AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'rbac_member_set غير موجودة';
  END IF;
  RAISE NOTICE 'تصفية صلاحيات الأعضاء جاهزة';
END
$do$;
