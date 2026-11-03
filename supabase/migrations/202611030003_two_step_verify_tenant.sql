-- =====================================================================================
-- 202611030003_two_step_verify_tenant.sql
-- الاعتماد كلياً على المستأجر الحقيقي (tenant_id) الخاص بالمستخدم الحالي auth.uid().
--
-- مصدر المستأجر بالترتيب:
--   1) public.profiles.tenant_id  (إن وُجد العمود مستقبلاً — يُقرأ ديناميكياً)
--   2) public.users.tenant_id     (الجدول الحقيقي للمستخدمين في هذا المشروع)
--   3) tenant_id المخزن الذي يديره المستخدم
--   4) tenant_id عضويته في user_warehouses
--
-- كما تضمن أن أي خطأ في إدراج سجل audit_logs لا يُفشل تسجيل الدخول أبداً: يُعاد
-- granted=true مع role و tenant_id الحقيقيين. الاستدعاءات كلها SECURITY DEFINER
-- وبصلاحيات EXECUTE محدودة، وتنتهي بإعادة تحميل ذاكرة PostgREST.
-- آمن للتشغيل المتكرر.
-- =====================================================================================

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
  v_attempt     int;
  v_is_member   boolean := false;
  v_manages     boolean := false;
  v_suspended   boolean := false;
  v_mgr_match   boolean := false;
  v_staff_match boolean := false;
  v_any_hash    boolean := false;
  v_profile_role text;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'no_session');
  END IF;

  -- -----------------------------------------------------------------------------------
  -- 1) المستأجر الحقيقي — كل قراءة محصّنة كي لا تُفشل الدخول
  -- -----------------------------------------------------------------------------------
  BEGIN
    EXECUTE 'SELECT p.tenant_id FROM public.profiles p WHERE p.id = $1'
       INTO v_tenant USING v_user;
  EXCEPTION WHEN others THEN
    v_tenant := NULL;   -- العمود غير موجود في profiles هنا؛ ننتقل للمصدر التالي
  END;

  IF v_tenant IS NULL THEN
    BEGIN
      SELECT u.tenant_id INTO v_tenant FROM public.users u WHERE u.id = v_user;
    EXCEPTION WHEN others THEN
      v_tenant := NULL;
    END;
  END IF;

  BEGIN
    SELECT EXISTS (SELECT 1 FROM public.user_warehouses uw WHERE uw.user_id = v_user),
           EXISTS (SELECT 1 FROM public.warehouses w WHERE w.manager_id = v_user),
           EXISTS (SELECT 1 FROM public.users u
                    WHERE u.id = v_user AND coalesce(u.is_active, true) = false)
      INTO v_is_member, v_manages, v_suspended;
  EXCEPTION WHEN others THEN
    v_is_member := false; v_manages := false; v_suspended := false;
  END;

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

  -- المخزن يُشتق من الخادم فقط
  BEGIN
    SELECT uw.warehouse_id INTO v_wh
      FROM public.user_warehouses uw
     WHERE uw.user_id = v_user
     ORDER BY uw.is_default DESC NULLS LAST, uw.created_at DESC NULLS LAST LIMIT 1;
    IF v_wh IS NULL THEN
      SELECT w.id INTO v_wh FROM public.warehouses w
       WHERE w.manager_id = v_user ORDER BY w.created_at NULLS LAST LIMIT 1;
    END IF;
  EXCEPTION WHEN others THEN
    v_wh := NULL;
  END;

  IF v_hash = '' OR char_length(v_hash) < 6 OR char_length(v_hash) > 200 THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'invalid_password',
                              'tenant_id', v_tenant);
  END IF;

  IF NOT v_is_member AND NOT v_manages THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'no_membership',
                              'tenant_id', v_tenant);
  END IF;

  IF v_suspended OR (NOT v_manages AND NOT EXISTS (
        SELECT 1 FROM public.user_warehouses uw
         WHERE uw.user_id = v_user AND coalesce(uw.is_active, true))) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'suspended',
                              'tenant_id', v_tenant);
  END IF;

  BEGIN
    SELECT count(*) INTO v_attempt
      FROM public.audit_logs al
     WHERE al.user_id = v_user
       AND al.action = 'two_step_failed'
       AND coalesce(al.created_at, now()) > now() - interval '10 minutes';
  EXCEPTION WHEN others THEN
    v_attempt := 0;
  END;

  IF v_attempt >= 5 THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'rate_limited',
                              'tenant_id', v_tenant);
  END IF;

  -- -----------------------------------------------------------------------------------
  -- 2) التحقق من كلمة مرور المرحلة الثانية على الخادم فقط
  -- -----------------------------------------------------------------------------------
  SELECT EXISTS (SELECT 1 FROM public.warehouses w
                  WHERE w.manager_id = v_user AND coalesce(w.password_hash, '') = v_hash)
      OR EXISTS (SELECT 1 FROM public.users u
                  WHERE u.id = v_user AND coalesce(u.manager_password_hash, '') = v_hash)
      OR EXISTS (SELECT 1 FROM public.warehouse_password_hashes ph
                  WHERE ph.user_id = v_user AND ph.hash = v_hash)
    INTO v_mgr_match;

  SELECT EXISTS (SELECT 1 FROM public.users u
                  WHERE u.id = v_user AND coalesce(u.staff_password_hash, '') = v_hash)
    INTO v_staff_match;

  SELECT (EXISTS (SELECT 1 FROM public.warehouses w
                   WHERE w.manager_id = v_user AND coalesce(w.password_hash, '') <> '')
       OR EXISTS (SELECT 1 FROM public.warehouse_password_hashes ph WHERE ph.user_id = v_user)
       OR EXISTS (SELECT 1 FROM public.users u
                   WHERE u.id = v_user
                     AND (coalesce(u.manager_password_hash, '') <> ''
                          OR coalesce(u.staff_password_hash, '') <> '')))
    INTO v_any_hash;

  BEGIN
    SELECT p.role INTO v_profile_role FROM public.profiles p WHERE p.id = v_user;
  EXCEPTION WHEN others THEN
    v_profile_role := NULL;
  END;

  IF v_mgr_match THEN
    v_role := 'manager';
  ELSIF v_staff_match THEN
    v_role := 'employee';
  ELSIF NOT v_any_hash THEN
    -- حساب جديد بلا بصمة ثانية مسجلة: يُسمح بالدخول، والدور من العضوية الحقيقية
    IF v_manages
       OR lower(coalesce(v_profile_role, '')) LIKE '%manager%'
       OR EXISTS (SELECT 1 FROM public.user_warehouses uw
                    JOIN public.roles r ON r.id = uw.role_id
                   WHERE uw.user_id = v_user AND lower(r.name) LIKE '%manager%') THEN
      v_role := 'manager';
    ELSE
      v_role := 'employee';
    END IF;

    PERFORM public.two_step_audit(v_tenant, v_user, v_wh, 'two_step_success', v_user,
      jsonb_build_object('source', 'web', 'initialized', true, 'role', v_role,
                         'tenant_id', v_tenant, 'at', now()));

    RETURN jsonb_build_object('granted', true, 'initialized', true, 'role', v_role,
                              'tenant_id', v_tenant, 'warehouse_id', v_wh);
  ELSE
    PERFORM public.two_step_audit(v_tenant, v_user, v_wh, 'two_step_failed', v_user,
      jsonb_build_object('source', 'web', 'submitted_chars', char_length(v_hash),
                         'reason', 'wrong_password', 'tenant_id', v_tenant, 'at', now()));

    RETURN jsonb_build_object('granted', false, 'reason', 'wrong_password',
                              'tenant_id', v_tenant);
  END IF;

  -- -----------------------------------------------------------------------------------
  -- 3) سجل التدقيق بالمعرّفين الحقيقيين — أي خطأ هنا لا يُفشل الدخول
  -- -----------------------------------------------------------------------------------
  PERFORM public.two_step_audit(v_tenant, v_user, v_wh, 'two_step_success', v_user,
    jsonb_build_object('source', 'web', 'initialized', false, 'role', v_role,
                       'tenant_id', v_tenant, 'at', now()));

  RETURN jsonb_build_object('granted', true, 'initialized', false, 'role', v_role,
                            'tenant_id', v_tenant, 'warehouse_id', v_wh);
END
$fn$;

REVOKE ALL ON FUNCTION public.two_step_verify(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.two_step_verify(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.two_step_verify(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.two_step_verify(text) TO service_role;

NOTIFY pgrst, 'reload schema';
