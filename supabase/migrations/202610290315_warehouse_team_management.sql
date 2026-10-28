-- 202610290315_warehouse_team_management.sql
-- إدارة الموظفين والصلاحيات لكل مخزن: قراءة الفريق، إضافة/تعديل/إزالة عضو،
-- مع فرض الصلاحيات على الخادم (لا اعتماد على إخفاء الأزرار في الواجهة).
-- آمن للتشغيل المتكرر.

-- ============================================================
-- 1) هل المستخدم الحالي مخوّل بإدارة هذا المخزن؟
-- ============================================================
CREATE OR REPLACE FUNCTION public.current_actor_manages(p_warehouse uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.warehouses w
       WHERE w.id = p_warehouse AND w.manager_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
        FROM public.user_warehouses uw
        JOIN public.roles r ON r.id = uw.role_id
       WHERE uw.user_id = auth.uid()
         AND uw.warehouse_id = p_warehouse
         AND r.name IN ('Super Admin', 'Tenant Admin', 'Warehouse Manager')
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid()
         AND p.role IN ('super_admin', 'admin', 'owner')
    )
  );
$fn$;

-- ============================================================
-- 2) سياسات الكتابة: المدير فقط، وليس على صفّه الشخصي (منع تصعيد الذات)
-- ============================================================
DROP POLICY IF EXISTS team_insert_members ON public.user_warehouses;
CREATE POLICY team_insert_members ON public.user_warehouses
  FOR INSERT TO authenticated
  WITH CHECK (public.current_actor_manages(warehouse_id) AND user_id <> auth.uid());

DROP POLICY IF EXISTS team_update_members ON public.user_warehouses;
CREATE POLICY team_update_members ON public.user_warehouses
  FOR UPDATE TO authenticated
  USING (public.current_actor_manages(warehouse_id) AND user_id <> auth.uid())
  WITH CHECK (public.current_actor_manages(warehouse_id) AND user_id <> auth.uid());

DROP POLICY IF EXISTS team_delete_members ON public.user_warehouses;
CREATE POLICY team_delete_members ON public.user_warehouses
  FOR DELETE TO authenticated
  USING (public.current_actor_manages(warehouse_id) AND user_id <> auth.uid());

-- ============================================================
-- 3) قراءة فريق المخزن (البريد من auth.users لا يُقرأ من الواجهة مباشرة)
-- ============================================================
CREATE OR REPLACE FUNCTION public.team_list(p_warehouse uuid)
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  role_id uuid,
  role_name text,
  permissions jsonb,
  is_default boolean,
  joined_at timestamptz
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
         coalesce(pr.full_name, '')::text,
         uw.role_id,
         coalesce(r.name, '')::text,
         coalesce(uw.permissions, '{}'::jsonb),
         coalesce(uw.is_default, false),
         uw.created_at
    FROM public.user_warehouses uw
    LEFT JOIN auth.users au      ON au.id = uw.user_id
    LEFT JOIN public.profiles pr ON pr.id = uw.user_id
    LEFT JOIN public.roles r     ON r.id  = uw.role_id
   WHERE uw.warehouse_id = p_warehouse
   ORDER BY coalesce(pr.full_name, au.email, '');
END
$fn$;

-- ============================================================
-- 4) إضافة عضو أو تعديل دوره/صلاحياته
-- ============================================================
CREATE OR REPLACE FUNCTION public.team_upsert_member(
  p_warehouse uuid,
  p_email text,
  p_role_name text DEFAULT NULL,
  p_permissions jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user_id   uuid;
  v_role_id   uuid;
  v_tenant_id uuid;
  v_old_perms jsonb;
  v_old_role  text;
BEGIN
  IF NOT public.current_actor_manages(p_warehouse) THEN
    RAISE EXCEPTION 'غير مصرح بتعديل فريق هذا المخزن' USING ERRCODE = '42501';
  END IF;

  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RAISE EXCEPTION 'البريد الإلكتروني مطلوب';
  END IF;

  SELECT au.id INTO v_user_id
    FROM auth.users au
   WHERE lower(au.email) = lower(btrim(p_email))
   LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'لا يوجد حساب بهذا البريد الإلكتروني. اطلب من الموظف إنشاء حساب أولاً ثم أضفه.';
  END IF;

  IF v_user_id = auth.uid() THEN
    RAISE EXCEPTION 'لا يمكنك تعديل دورك أو صلاحياتك بنفسك';
  END IF;

  SELECT w.tenant_id INTO v_tenant_id FROM public.warehouses w WHERE w.id = p_warehouse;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'المخزن غير موجود';
  END IF;

  IF p_role_name IS NOT NULL AND btrim(p_role_name) <> '' THEN
    SELECT r.id INTO v_role_id FROM public.roles r WHERE r.name = p_role_name LIMIT 1;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION 'الدور غير موجود: %', p_role_name;
    END IF;
  END IF;

  SELECT uw.permissions, r.name
    INTO v_old_perms, v_old_role
    FROM public.user_warehouses uw
    LEFT JOIN public.roles r ON r.id = uw.role_id
   WHERE uw.user_id = v_user_id AND uw.warehouse_id = p_warehouse;

  INSERT INTO public.user_warehouses AS uw
    (user_id, warehouse_id, tenant_id, role_id, permissions, is_default)
  VALUES
    (v_user_id, p_warehouse, v_tenant_id, v_role_id, coalesce(p_permissions, '{}'::jsonb), false)
  ON CONFLICT (user_id, warehouse_id) DO UPDATE
    SET role_id     = coalesce(excluded.role_id, uw.role_id),
        permissions = coalesce(excluded.permissions, '{}'::jsonb);

  IF v_role_id IS NOT NULL THEN
    UPDATE public.user_roles
       SET is_active = false
     WHERE user_id = v_user_id
       AND warehouse_id = p_warehouse
       AND role_id <> v_role_id
       AND is_active;

    INSERT INTO public.user_roles (user_id, warehouse_id, role_id, assigned_by, is_active)
    VALUES (v_user_id, p_warehouse, v_role_id, auth.uid(), true)
    ON CONFLICT (user_id, warehouse_id, role_id) DO UPDATE SET is_active = true;
  END IF;

  BEGIN
    INSERT INTO public.audit_logs
      (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
    VALUES
      (v_tenant_id, auth.uid(), p_warehouse, 'team_member_upsert', 'user_warehouses', v_user_id,
       jsonb_build_object('email', btrim(p_email), 'old_role', v_old_role, 'new_role', p_role_name,
                          'old_permissions', coalesce(v_old_perms, '{}'::jsonb),
                          'new_permissions', coalesce(p_permissions, '{}'::jsonb)));
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'تعذر تسجيل العملية في سجل التدقيق: %', SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'user_id', v_user_id);
END
$fn$;

-- ============================================================
-- 5) إزالة عضو من المخزن
-- ============================================================
CREATE OR REPLACE FUNCTION public.team_remove_member(p_warehouse uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tenant_id uuid;
  v_is_owner  boolean;
BEGIN
  IF NOT public.current_actor_manages(p_warehouse) THEN
    RAISE EXCEPTION 'غير مصرح بتعديل فريق هذا المخزن' USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'لا يمكنك إزالة نفسك من المخزن';
  END IF;

  SELECT w.tenant_id, (w.manager_id = p_user_id)
    INTO v_tenant_id, v_is_owner
    FROM public.warehouses w
   WHERE w.id = p_warehouse;

  IF v_is_owner IS TRUE THEN
    RAISE EXCEPTION 'لا يمكن إزالة مدير المخزن — غيّر مدير المخزن أولاً';
  END IF;

  DELETE FROM public.user_roles
   WHERE user_id = p_user_id AND warehouse_id = p_warehouse;

  DELETE FROM public.user_warehouses
   WHERE user_id = p_user_id AND warehouse_id = p_warehouse;

  BEGIN
    INSERT INTO public.audit_logs
      (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
    VALUES
      (v_tenant_id, auth.uid(), p_warehouse, 'team_member_remove', 'user_warehouses', p_user_id,
       jsonb_build_object('removed_user', p_user_id));
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'تعذر تسجيل العملية في سجل التدقيق: %', SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true);
END
$fn$;

-- ============================================================
-- 6) المنح
-- ============================================================
GRANT EXECUTE ON FUNCTION public.current_actor_manages(uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_list(uuid)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_upsert_member(uuid, text, text, jsonb)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_remove_member(uuid, uuid)                TO authenticated;

-- ============================================================
-- 7) تحقق
-- ============================================================
DO $do$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(x.fn, ', ') INTO v_missing
    FROM (VALUES ('current_actor_manages'), ('team_list'),
                 ('team_upsert_member'), ('team_remove_member')) AS x(fn)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_proc p
      WHERE p.proname = x.fn AND p.pronamespace = 'public'::regnamespace
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'دوال مفقودة: %', v_missing;
  END IF;

  RAISE NOTICE 'إدارة فريق المخزن جاهزة';
END
$do$;
