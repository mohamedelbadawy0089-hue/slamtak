-- =====================================================================================
-- 202611030008_two_step_verify_meta.sql
-- tenant_id: profiles أولاً، ثم user_warehouses كاحتياطي
-- التحقق:
--   - مدير: auth.users.raw_user_meta_data->>'manager_password' للمستخدم الحالي
--   - موظف: auth.users.raw_user_meta_data->>'employee_password' لأحد الموظفين
--           المضافين بمعرفة مدير المخزن تحت نفس tenant_id (عبر profiles)
-- سجل audit_logs بـ try-catch، إرجاع granted/role/tenant_id
-- GRANT EXECUTE + notify pgrst, 'reload schema'
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.two_step_audit(
  p_tenant   uuid,
  p_user     uuid,
  p_wh       uuid,
  p_action   text,
  p_entity   uuid,
  p_values   jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $audit$
BEGIN
  BEGIN
    INSERT INTO public.audit_logs
      (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
    VALUES (
      COALESCE(p_tenant, (SELECT t.id FROM public.tenants t LIMIT 1)),
      CASE WHEN p_user IS NOT NULL AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user) THEN p_user ELSE NULL END,
      p_wh,
      p_action,
      'auth_sessions',
      CASE WHEN p_entity IS NOT NULL AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_entity) THEN p_entity ELSE NULL END,
      p_values
    );
  EXCEPTION WHEN others THEN
    BEGIN
      INSERT INTO public.audit_logs
        (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
      VALUES (
        COALESCE(p_tenant, (SELECT t.id FROM public.tenants t LIMIT 1)),
        NULL,
        p_wh,
        p_action,
        'auth_sessions',
        NULL,
        p_values
      );
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END;
END
$audit$;

REVOKE ALL ON FUNCTION public.two_step_audit(uuid,uuid,uuid,text,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.two_step_audit(uuid,uuid,uuid,text,uuid,jsonb) FROM anon;

CREATE OR REPLACE FUNCTION public.two_step_verify(p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $fn$
DECLARE
  v_user        uuid := auth.uid();
  v_hash        text := btrim(coalesce(p_password, ''));
  v_tenant      uuid;
  v_tenant_f    uuid;
  v_role        text;
  v_wh          uuid;
  v_attempt     int := 0;
  v_is_member   boolean := false;
  v_manages     boolean := false;
  v_suspended   boolean := false;
  v_mgr_match   boolean := false;
  v_emp_match   boolean := false;
  v_any_hash    boolean := false;
  v_meta_mgr    text;
  v_meta_emp    text;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'no_session');
  END IF;

  -- tenant_id أولاً من public.profiles، ثم user_warehouses كاحتياطي
  BEGIN
    SELECT p.tenant_id INTO v_tenant_f FROM public.profiles p WHERE p.id = v_user;
  EXCEPTION WHEN others THEN
    v_tenant_f := NULL;
  END;

  v_tenant := v_tenant_f;

  IF v_tenant IS NULL THEN
    BEGIN
      SELECT uw.tenant_id INTO v_tenant
        FROM public.user_warehouses uw
       WHERE uw.user_id = v_user AND coalesce(uw.is_active,true)
       ORDER BY uw.is_default DESC NULLS LAST, uw.created_at ASC NULLS LAST, uw.id ASC
       LIMIT 1;
    EXCEPTION WHEN others THEN
      v_tenant := NULL;
    END;
  END IF;

  IF v_tenant IS NULL THEN
    BEGIN
      SELECT uw.tenant_id INTO v_tenant
        FROM public.user_warehouses uw
       WHERE uw.user_id = v_user AND uw.tenant_id IS NOT NULL
       ORDER BY uw.is_default DESC NULLS LAST, uw.created_at DESC NULLS LAST
       LIMIT 1;
    EXCEPTION WHEN others THEN
      v_tenant := NULL;
    END;
  END IF;

  -- مخزن
  BEGIN
    SELECT uw.warehouse_id INTO v_wh
      FROM public.user_warehouses uw
     WHERE uw.user_id = v_user AND coalesce(uw.is_active,true)
     ORDER BY uw.is_default DESC NULLS LAST, uw.created_at ASC NULLS LAST, uw.id ASC
     LIMIT 1;
    IF v_wh IS NULL THEN
      SELECT w.id INTO v_wh FROM public.warehouses w WHERE w.manager_id = v_user ORDER BY w.created_at ASC NULLS LAST LIMIT 1;
    END IF;
  EXCEPTION WHEN others THEN
    v_wh := NULL;
  END;

  -- حالة
  BEGIN
    SELECT EXISTS (SELECT 1 FROM public.user_warehouses uw WHERE uw.user_id = v_user AND coalesce(uw.is_active,true)),
           EXISTS (SELECT 1 FROM public.warehouses w WHERE w.manager_id = v_user),
           EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user AND coalesce(u.is_active,true)=false)
      INTO v_is_member, v_manages, v_suspended;
  EXCEPTION WHEN others THEN
    v_is_member := false; v_manages := false; v_suspended := false;
  END;

  BEGIN
    SELECT count(*) INTO v_attempt
      FROM public.audit_logs al
     WHERE al.user_id = v_user
       AND al.action = 'two_step_failed'
       AND coalesce(al.created_at, now()) > now() - interval '10 minutes';
  EXCEPTION WHEN others THEN
    v_attempt := 0;
  END;

  IF v_hash = '' OR char_length(v_hash) < 6 OR char_length(v_hash) > 200 THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'invalid_password', 'tenant_id', v_tenant);
  END IF;

  IF NOT v_is_member AND NOT v_manages THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'no_membership', 'tenant_id', v_tenant);
  END IF;

  IF v_suspended OR (NOT v_manages AND NOT EXISTS (SELECT 1 FROM public.user_warehouses uw WHERE uw.user_id = v_user AND coalesce(uw.is_active,true))) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'suspended', 'tenant_id', v_tenant);
  END IF;

  IF v_attempt >= 5 THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'rate_limited', 'tenant_id', v_tenant);
  END IF;

  -- قراءة بيانات المدير من auth.users.raw_user_meta_data
  BEGIN
    SELECT au.raw_user_meta_data ->> 'manager_password'
      INTO v_meta_mgr
      FROM auth.users au
     WHERE au.id = v_user;
  EXCEPTION WHEN others THEN
    v_meta_mgr := NULL;
  END;

  IF v_meta_mgr IS NOT NULL AND btrim(v_meta_mgr) <> '' AND v_meta_mgr = v_hash THEN
    v_mgr_match := true;
  END IF;

  -- إذا لم يطابق، جرّب طرق أخرى متوافقة للخلف
  IF NOT v_mgr_match THEN
    SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user AND coalesce(u.manager_password_hash,'') <> '' AND u.manager_password_hash = v_hash)
        OR EXISTS (SELECT 1 FROM public.warehouses w WHERE (w.manager_id = v_user OR w.id = v_wh) AND coalesce(w.password_hash,'') <> '' AND w.password_hash = v_hash)
        OR EXISTS (SELECT 1 FROM public.warehouse_password_hashes ph WHERE ph.user_id = v_user AND ph.hash = v_hash)
      INTO v_mgr_match;
  END IF;

  -- موظف مضاف بمعرفة مدير المخزن تحت نفس tenant_id: employee_password في raw_user_meta_data
  IF v_tenant IS NOT NULL THEN
    BEGIN
      SELECT au.raw_user_meta_data ->> 'employee_password'
        INTO v_meta_emp
        FROM auth.users au
        JOIN public.profiles p ON p.id = au.id
       WHERE p.tenant_id = v_tenant
         AND au.id <> v_user
         AND coalesce(au.raw_user_meta_data ->> 'employee_password','') <> ''
         AND au.raw_user_meta_data ->> 'employee_password' = v_hash
       LIMIT 1;
    EXCEPTION WHEN others THEN
      v_meta_emp := NULL;
    END;

    IF v_meta_emp IS NOT NULL AND btrim(v_meta_emp) <> '' THEN
      v_emp_match := true;
    END IF;
  END IF;

  -- أيضاً تحقق إذا كان المستخدم نفسه موظف وله employee_password
  IF NOT v_emp_match THEN
    BEGIN
      SELECT au.raw_user_meta_data ->> 'employee_password'
        INTO v_meta_emp
        FROM auth.users au
       WHERE au.id = v_user
         AND coalesce(au.raw_user_meta_data ->> 'employee_password','') <> ''
         AND au.raw_user_meta_data ->> 'employee_password' = v_hash;
    EXCEPTION WHEN others THEN
      v_meta_emp := NULL;
    END;
    IF v_meta_emp IS NOT NULL AND btrim(v_meta_emp) <> '' THEN
      v_emp_match := true;
    END IF;
  END IF;

  -- احتياطي للخلف
  IF NOT v_emp_match THEN
    SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user AND coalesce(u.staff_password_hash,'') <> '' AND u.staff_password_hash = v_hash)
      INTO v_emp_match;
  END IF;

  SELECT (EXISTS (SELECT 1 FROM public.warehouses w WHERE w.manager_id = v_user AND coalesce(w.password_hash,'') <> '')
       OR EXISTS (SELECT 1 FROM public.warehouse_password_hashes ph WHERE ph.user_id = v_user)
       OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user AND (coalesce(u.manager_password_hash,'')<>'' OR coalesce(u.staff_password_hash,'')<>'')))
    INTO v_any_hash;

  IF v_mgr_match THEN
    v_role := 'manager';
  ELSIF v_emp_match THEN
    v_role := 'employee';
  ELSIF NOT v_any_hash THEN
    IF v_manages OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user AND lower(coalesce(p.role,'')) LIKE '%manager%')
       OR EXISTS (SELECT 1 FROM public.user_warehouses uw JOIN public.roles r ON r.id = uw.role_id WHERE uw.user_id = v_user AND coalesce(uw.is_active,true) AND lower(r.name) LIKE '%manager%') THEN
      v_role := 'manager';
    ELSE
      v_role := 'employee';
    END IF;

    BEGIN
      PERFORM public.two_step_audit(v_tenant, v_user, v_wh, 'two_step_success', v_user,
        jsonb_build_object('source','web','initialized',true,'role',v_role,'tenant_id',v_tenant,'at',now()));
    EXCEPTION WHEN others THEN NULL;
    END;

    RETURN jsonb_build_object('granted', true, 'role', v_role, 'tenant_id', v_tenant, 'initialized', true, 'warehouse_id', v_wh);
  ELSE
    BEGIN
      PERFORM public.two_step_audit(v_tenant, v_user, v_wh, 'two_step_failed', v_user,
        jsonb_build_object('source','web','submitted_chars',char_length(v_hash),'reason','wrong_password','tenant_id',v_tenant,'at',now()));
    EXCEPTION WHEN others THEN NULL;
    END;

    RETURN jsonb_build_object('granted', false, 'reason', 'wrong_password', 'tenant_id', v_tenant);
  END IF;

  BEGIN
    PERFORM public.two_step_audit(v_tenant, v_user, v_wh, 'two_step_success', v_user,
      jsonb_build_object('source','web','initialized',false,'role',v_role,'tenant_id',v_tenant,'at',now()));
  EXCEPTION WHEN others THEN NULL;
  END;

  RETURN jsonb_build_object('granted', true, 'role', v_role, 'tenant_id', v_tenant, 'initialized', false, 'warehouse_id', v_wh);
END
$fn$;

REVOKE ALL ON FUNCTION public.two_step_verify(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.two_step_verify(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.two_step_verify(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.two_step_verify(text) TO service_role;

NOTIFY pgrst, 'reload schema';
