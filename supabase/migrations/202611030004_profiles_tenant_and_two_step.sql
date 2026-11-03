-- =====================================================================================
-- 202611030004_profiles_tenant_and_two_step.sql
--
-- 1) إضافة عمود tenant_id (UUID) إلى public.profiles إذا لم يكن موجوداً + backfill
-- 2) تحديث دالة public.two_step_verify(p_password text):
--    - تجلب tenant_id الحقيقي من public.profiles بناءً على auth.uid() أولاً، ثم fallbacks
--    - تتحقق من كلمة مرور المرحلة الثانية (مدير / موظف) على الخادم فقط
--    - إدراج سجل audit_logs بـ user_id و tenant_id الحقيقيين مع EXCEPTION WHEN OTHERS THEN NULL
--      لضمان عدم توقف عملية تسجيل الدخول نهائياً
--    - ترجع JSON: { granted: true/false, role: ..., tenant_id: ..., warehouse_id?: ... }
--    - GRANT EXECUTE إلى authenticated و service_role، REVOKE من PUBLIC/anon
--    - NOTIFY pgrst, 'reload schema'
-- =====================================================================================

-- 1) عمود tenant_id في profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- backfill
DO $$
BEGIN
  UPDATE public.profiles p
     SET tenant_id = u.tenant_id
    FROM public.users u
   WHERE p.id = u.id
     AND p.tenant_id IS NULL
     AND u.tenant_id IS NOT NULL;
EXCEPTION WHEN others THEN NULL;
END
$$;

DO $$
BEGIN
  UPDATE public.profiles p
     SET tenant_id = w.tenant_id
    FROM public.warehouses w
   WHERE p.id = w.manager_id
     AND p.tenant_id IS NULL
     AND w.tenant_id IS NOT NULL;
EXCEPTION WHEN others THEN NULL;
END
$$;

DO $$
BEGIN
  UPDATE public.profiles p
     SET tenant_id = uw.tenant_id
    FROM (
      SELECT DISTINCT ON (user_id) user_id, tenant_id
        FROM public.user_warehouses
       WHERE tenant_id IS NOT NULL
       ORDER BY user_id, is_default DESC NULLS LAST, created_at DESC NULLS LAST
    ) uw
   WHERE p.id = uw.user_id
     AND p.tenant_id IS NULL;
EXCEPTION WHEN others THEN NULL;
END
$$;

CREATE INDEX IF NOT EXISTS idx_profiles_tenant_id ON public.profiles(tenant_id);

-- 2) الدوال
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
SET search_path = public, pg_temp
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
      NULL;  -- لا يتعطل تسجيل الدخول نهائياً
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
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user        uuid := auth.uid();
  v_hash        text := btrim(coalesce(p_password, ''));
  v_tenant      uuid;
  v_role        text;
  v_wh          uuid;
  v_attempt     int := 0;
  v_is_member   boolean := false;
  v_manages     boolean := false;
  v_suspended   boolean := false;
  v_mgr_match   boolean := false;
  v_staff_match boolean := false;
  v_any_hash    boolean := false;
  v_profile_role text;
  v_tenant_real uuid;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'no_session');
  END IF;

  -- جلب tenant_id الحقيقي من profiles بناءً على auth.uid()
  BEGIN
    SELECT p.tenant_id, p.role
      INTO v_tenant_real, v_profile_role
      FROM public.profiles p
     WHERE p.id = v_user;
  EXCEPTION WHEN others THEN
    v_tenant_real := NULL; v_profile_role := NULL;
  END;

  v_tenant := v_tenant_real;

  IF v_tenant IS NULL THEN
    BEGIN
      SELECT u.tenant_id INTO v_tenant FROM public.users u WHERE u.id = v_user;
    EXCEPTION WHEN others THEN
      v_tenant := NULL;
    END;
  END IF;

  IF v_tenant IS NULL THEN
    BEGIN
      SELECT w.tenant_id INTO v_tenant
        FROM public.warehouses w
       WHERE w.manager_id = v_user AND w.tenant_id IS NOT NULL
       ORDER BY w.created_at NULLS LAST LIMIT 1;
    EXCEPTION WHEN others THEN
      v_tenant := NULL;
    END;
  END IF;

  IF v_tenant IS NULL THEN
    BEGIN
      SELECT uw.tenant_id INTO v_tenant
        FROM public.user_warehouses uw
       WHERE uw.user_id = v_user AND uw.tenant_id IS NOT NULL
       ORDER BY uw.is_default DESC NULLS LAST, uw.created_at DESC NULLS LAST LIMIT 1;
    EXCEPTION WHEN others THEN
      v_tenant := NULL;
    END;
  END IF;

  -- مشتقات
  BEGIN
    SELECT EXISTS (SELECT 1 FROM public.user_warehouses uw WHERE uw.user_id = v_user),
           EXISTS (SELECT 1 FROM public.warehouses w WHERE w.manager_id = v_user),
           EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user AND coalesce(u.is_active,true)=false)
      INTO v_is_member, v_manages, v_suspended;
  EXCEPTION WHEN others THEN
    v_is_member := false; v_manages := false; v_suspended := false;
  END;

  BEGIN
    SELECT uw.warehouse_id INTO v_wh
      FROM public.user_warehouses uw
     WHERE uw.user_id = v_user
     ORDER BY uw.is_default DESC NULLS LAST, uw.created_at DESC NULLS LAST LIMIT 1;
    IF v_wh IS NULL THEN
      SELECT w.id INTO v_wh FROM public.warehouses w WHERE w.manager_id = v_user ORDER BY w.created_at NULLS LAST LIMIT 1;
    END IF;
  EXCEPTION WHEN others THEN
    v_wh := NULL;
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

  -- التحققات
  IF v_hash = '' OR char_length(v_hash) < 6 OR char_length(v_hash) > 200 THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'invalid_password', 'tenant_id', v_tenant);
  END IF;

  IF NOT v_is_member AND NOT v_manages THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'no_membership', 'tenant_id', v_tenant);
  END IF;

  IF v_suspended OR (NOT v_manages AND NOT EXISTS (
        SELECT 1 FROM public.user_warehouses uw WHERE uw.user_id = v_user AND coalesce(uw.is_active,true))) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'suspended', 'tenant_id', v_tenant);
  END IF;

  IF v_attempt >= 5 THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'rate_limited', 'tenant_id', v_tenant);
  END IF;

  -- مطابقة كلمة مرور المرحلة الثانية
  SELECT EXISTS (SELECT 1 FROM public.warehouses w WHERE w.manager_id = v_user AND coalesce(w.password_hash,'') = v_hash)
      OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user AND coalesce(u.manager_password_hash,'') = v_hash)
      OR EXISTS (SELECT 1 FROM public.warehouse_password_hashes ph WHERE ph.user_id = v_user AND ph.hash = v_hash)
    INTO v_mgr_match;

  SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user AND coalesce(u.staff_password_hash,'') = v_hash)
    INTO v_staff_match;

  SELECT (EXISTS (SELECT 1 FROM public.warehouses w WHERE w.manager_id = v_user AND coalesce(w.password_hash,'') <> '')
       OR EXISTS (SELECT 1 FROM public.warehouse_password_hashes ph WHERE ph.user_id = v_user)
       OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user
                   AND (coalesce(u.manager_password_hash,'') <> '' OR coalesce(u.staff_password_hash,'') <> '')))
    INTO v_any_hash;

  IF v_mgr_match THEN
    v_role := 'manager';
  ELSIF v_staff_match THEN
    v_role := 'employee';
  ELSIF NOT v_any_hash THEN
    -- حساب جديد بلا بصمة ثانية مسجلة
    IF v_manages OR lower(coalesce(v_profile_role,'')) LIKE '%manager%'
       OR EXISTS (SELECT 1 FROM public.user_warehouses uw JOIN public.roles r ON r.id = uw.role_id
                   WHERE uw.user_id = v_user AND lower(r.name) LIKE '%manager%') THEN
      v_role := 'manager';
    ELSE
      v_role := 'employee';
    END IF;

    BEGIN
      INSERT INTO public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
      VALUES (
        COALESCE(v_tenant, (SELECT t.id FROM public.tenants t LIMIT 1)),
        v_user,
        v_wh,
        'two_step_success',
        'auth_sessions',
        v_user,
        jsonb_build_object('source','web','initialized',true,'role',v_role,'tenant_id',v_tenant,'at',now())
      );
    EXCEPTION WHEN others THEN
      NULL;
    END;

    RETURN jsonb_build_object('granted', true, 'role', v_role, 'tenant_id', v_tenant, 'initialized', true, 'warehouse_id', v_wh);
  ELSE
    BEGIN
      INSERT INTO public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
      VALUES (
        COALESCE(v_tenant, (SELECT t.id FROM public.tenants t LIMIT 1)),
        v_user,
        v_wh,
        'two_step_failed',
        'auth_sessions',
        v_user,
        jsonb_build_object('source','web','submitted_chars',char_length(v_hash),'reason','wrong_password','tenant_id',v_tenant,'at',now())
      );
    EXCEPTION WHEN others THEN
      NULL;
    END;

    RETURN jsonb_build_object('granted', false, 'reason', 'wrong_password', 'tenant_id', v_tenant);
  END IF;

  -- نجاح مع بصمة مسجلة
  BEGIN
    INSERT INTO public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
    VALUES (
      COALESCE(v_tenant, (SELECT t.id FROM public.tenants t LIMIT 1)),
      v_user,
      v_wh,
      'two_step_success',
      'auth_sessions',
      v_user,
      jsonb_build_object('source','web','initialized',false,'role',v_role,'tenant_id',v_tenant,'at',now())
    );
  EXCEPTION WHEN others THEN
    NULL;
  END;

  RETURN jsonb_build_object('granted', true, 'role', v_role, 'tenant_id', v_tenant, 'initialized', false, 'warehouse_id', v_wh);
END
$fn$;

-- صلاحيات
REVOKE ALL ON FUNCTION public.two_step_verify(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.two_step_verify(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.two_step_verify(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.two_step_verify(text) TO service_role;

-- تحديث مخطط PostgREST
NOTIFY pgrst, 'reload schema';
