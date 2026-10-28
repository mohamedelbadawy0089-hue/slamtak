-- =====================================================================================
-- 202610290319_rbac_member_status.sql
-- تفعيل/إيقاف عضو بشكل قابل للرجوع بدل حذف العضوية:
--   user_warehouses.is_active = false ⇒ لا صلاحيات، والحساب موقوف عن الدخول (للموظفين).
-- =====================================================================================

ALTER TABLE public.user_warehouses ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS ix_user_warehouses_active ON public.user_warehouses (user_id, is_active);

-- -------------------------------------------------------------------------------------
-- محرّك الصلاحيات: تجاهل العضوية الموقوفة
-- -------------------------------------------------------------------------------------
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
     WHERE q.category IS NOT NULL;
    RETURN;
  END IF;

  RETURN QUERY
  WITH base(permission, source) AS (
    SELECT lower(btrim(k))::text, 'direct'::text
      FROM public.user_warehouses uw
      CROSS JOIN LATERAL jsonb_object_keys(coalesce(uw.permissions, '{}'::jsonb)) k
     WHERE uw.user_id = p_user
       AND coalesce(uw.is_active, true)
       AND (p_warehouse IS NULL OR uw.warehouse_id = p_warehouse)
       AND lower(coalesce(uw.permissions ->> k, 'false')) IN ('true','t','1','yes','on')

    UNION ALL

    SELECT perm.name::text, ('role:' || r.name)::text
      FROM public.user_warehouses uw
      JOIN public.roles r ON r.id = uw.role_id
      JOIN public.role_permissions rp ON rp.role_id = r.id
      JOIN public.permissions perm ON perm.id = rp.permission_id
     WHERE uw.user_id = p_user
       AND coalesce(uw.is_active, true)
       AND (p_warehouse IS NULL OR uw.warehouse_id = p_warehouse)
       AND coalesce(r.is_active, true)
       AND r.deleted_at IS NULL

    UNION ALL

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
       AND coalesce(uw.is_active, true)
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

-- -------------------------------------------------------------------------------------
-- إيقاف/تفعيل بدون حذف العضوية
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rbac_member_set_active(p_warehouse uuid, p_user_id uuid, p_active boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'جلسة غير صالحة' USING ERRCODE = '42501';
  END IF;
  IF NOT public.current_actor_manages(p_warehouse) THEN
    RAISE EXCEPTION 'غير مصرح بإدارة فريق هذا المخزن' USING ERRCODE = '42501';
  END IF;
  IF p_user_id = v_uid THEN
    RAISE EXCEPTION 'لا يمكنك إيقاف حسابك بنفسك' USING ERRCODE = '42501';
  END IF;
  IF public.rbac_is_owner(p_user_id, p_warehouse) AND NOT public.rbac_is_owner(v_uid, p_warehouse) THEN
    RAISE EXCEPTION 'لا يمكن تعديل حساب مالك المخزن' USING ERRCODE = '42501';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.warehouses WHERE id = p_warehouse;

  UPDATE public.user_warehouses
     SET is_active = p_active
   WHERE user_id = p_user_id AND warehouse_id = p_warehouse;

  UPDATE public.user_roles
     SET is_active = p_active
   WHERE user_id = p_user_id AND warehouse_id = p_warehouse;

  UPDATE public.warehouse_employees
     SET is_active = p_active, updated_at = now()
   WHERE user_id = p_user_id AND warehouse_id = p_warehouse;

  INSERT INTO public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
  VALUES (v_tenant, v_uid, p_warehouse,
          CASE WHEN p_active THEN 'rbac_member_activate' ELSE 'rbac_member_deactivate' END,
          'user_warehouses', p_user_id, jsonb_build_object('active', p_active));

  RETURN jsonb_build_object('ok', true, 'active', p_active);
END
$fn$;

-- -------------------------------------------------------------------------------------
-- قائمة الفريق: تُظهر الحالة (نشط/موقوف) وتُبقي الصف الموقوف
-- -------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.team_list(uuid);

CREATE OR REPLACE FUNCTION public.team_list(p_warehouse uuid)
RETURNS TABLE (
  user_id uuid, email text, full_name text, role_id uuid, role_name text,
  permissions jsonb, is_default boolean, joined_at timestamptz,
  is_active boolean, username text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.current_actor_manages(p_warehouse) THEN
    RAISE EXCEPTION 'غير مصرح بعرض فريق هذا المخزن' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT uw.user_id,
         coalesce(au.email, '')::text,
         coalesce(pr.full_name, e.full_name, '')::text,
         uw.role_id,
         coalesce(r.name, '')::text,
         coalesce(uw.permissions, '{}'::jsonb),
         coalesce(uw.is_default, false),
         uw.created_at,
         coalesce(uw.is_active, true),
         coalesce(e.username, '')::text
    FROM public.user_warehouses uw
    LEFT JOIN auth.users au              ON au.id = uw.user_id
    LEFT JOIN public.profiles pr         ON pr.id = uw.user_id
    LEFT JOIN public.roles r             ON r.id  = uw.role_id
    LEFT JOIN public.warehouse_employees e
           ON e.user_id = uw.user_id AND e.warehouse_id = uw.warehouse_id
   WHERE uw.warehouse_id = p_warehouse
   ORDER BY coalesce(pr.full_name, e.full_name, au.email, '');
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rbac_member_set_active(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_list(uuid) TO authenticated;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'user_warehouses' AND column_name = 'is_active'
  ) THEN
    RAISE EXCEPTION 'عمود user_warehouses.is_active غير موجود';
  END IF;
  RAISE NOTICE 'حالة عضوية الموظف جاهزة';
END
$do$;
