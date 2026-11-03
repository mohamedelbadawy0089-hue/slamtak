-- =====================================================================================
-- 202611030001_two_step_verify.sql
-- إعادة إنشاء دالة المرحلة الثانية two_step_verify على الخادم (كانت مفقودة من القاعدة،
-- لذلك كان PostgREST يرد: Could not find the function public.two_step_verify(p_password)).
--
-- السلوك:
--   * مقارنة بصمة SHA-256/base64url المُدخلة مع بصمات نفس المستخدم فقط (لا شيء في المتصفح).
--   * بصمة كلمة مرور المدير  → role = 'manager'  (لوحة المدير).
--   * بصمة كلمة مرور الموظف  → role = 'employee' (لوحة الموظف لنفس المخزن).
--   * حساب جديد بلا أي بصمة ثانية مسجلة → يُسمح بالدخول (granted = true) ويُحدد الدور
--     من عضويته الحقيقية، بدل رفض الدخول.
--   * حد المحاولات: 5 إخفاقات خلال 10 دقائق، والإيقاف، وعدم العضوية — كلها تُرفض بوضوح.
--   * كل المحاولات تُسجَّل في audit_logs.
-- آمن للتشغيل المتكرر.
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.two_step_verify(p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user      uuid := auth.uid();
  v_hash      text := btrim(coalesce(p_password, ''));
  v_attempt   int;
  v_is_member boolean := false;
  v_manages   boolean := false;
  v_suspended boolean := false;
  v_mgr_match boolean := false;
  v_staff_match boolean := false;
  v_any_hash  boolean := false;
  v_role      text;
  v_wh        uuid;
  v_tenant    uuid;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'no_session');
  END IF;

  IF v_hash = '' OR char_length(v_hash) < 6 OR char_length(v_hash) > 200 THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'invalid_password');
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.user_warehouses uw WHERE uw.user_id = v_user),
         EXISTS (SELECT 1 FROM public.warehouses w WHERE w.manager_id = v_user),
         EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user AND coalesce(u.is_active, true) = false)
    INTO v_is_member, v_manages, v_suspended;

  IF NOT v_is_member AND NOT v_manages THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'no_membership');
  END IF;

  IF v_suspended OR (NOT v_manages AND NOT EXISTS (
        SELECT 1 FROM public.user_warehouses uw
         WHERE uw.user_id = v_user AND coalesce(uw.is_active, true))) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'suspended');
  END IF;

  SELECT count(*) INTO v_attempt
    FROM public.audit_logs al
   WHERE al.user_id = v_user
     AND al.action = 'two_step_failed'
     AND coalesce(al.created_at, now()) > now() - interval '10 minutes';

  IF v_attempt >= 5 THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'rate_limited');
  END IF;

  -- مطابقة كلمة مرور المدير: بصمة المخزن الذي يديره + بصمة المدير في users + جدول البصمات
  SELECT EXISTS (SELECT 1 FROM public.warehouses w
                  WHERE w.manager_id = v_user AND coalesce(w.password_hash, '') = v_hash)
      OR EXISTS (SELECT 1 FROM public.users u
                  WHERE u.id = v_user AND coalesce(u.manager_password_hash, '') = v_hash)
      OR EXISTS (SELECT 1 FROM public.warehouse_password_hashes ph
                  WHERE ph.user_id = v_user AND ph.hash = v_hash)
    INTO v_mgr_match;

  -- مطابقة كلمة مرور الموظف
  SELECT EXISTS (SELECT 1 FROM public.users u
                  WHERE u.id = v_user AND coalesce(u.staff_password_hash, '') = v_hash)
    INTO v_staff_match;

  -- هل للمستخدم أي بصمة ثانية محفوظة أصلاً؟
  SELECT (EXISTS (SELECT 1 FROM public.warehouses w
                   WHERE w.manager_id = v_user AND coalesce(w.password_hash, '') <> '')
       OR EXISTS (SELECT 1 FROM public.warehouse_password_hashes ph WHERE ph.user_id = v_user)
       OR EXISTS (SELECT 1 FROM public.users u
                   WHERE u.id = v_user
                     AND (coalesce(u.manager_password_hash, '') <> ''
                          OR coalesce(u.staff_password_hash, '') <> '')))
    INTO v_any_hash;

  -- المخزن والمستأجر يُشتقان من الخادم فقط
  v_wh := (SELECT uw.warehouse_id FROM public.user_warehouses uw
            WHERE uw.user_id = v_user
            ORDER BY uw.is_default DESC NULLS LAST, uw.created_at DESC NULLS LAST LIMIT 1);
  IF v_wh IS NULL THEN
    v_wh := (SELECT w.id FROM public.warehouses w WHERE w.manager_id = v_user
              ORDER BY w.created_at NULLS LAST LIMIT 1);
  END IF;

  v_tenant := (SELECT w.tenant_id FROM public.warehouses w WHERE w.manager_id = v_user LIMIT 1);
  IF v_tenant IS NULL THEN
    v_tenant := (SELECT uw.tenant_id FROM public.user_warehouses uw WHERE uw.user_id = v_user
                  ORDER BY uw.created_at DESC NULLS LAST LIMIT 1);
  END IF;

  IF v_mgr_match THEN
    v_role := 'manager';
  ELSIF v_staff_match THEN
    v_role := 'employee';
  ELSIF NOT v_any_hash THEN
    -- حساب جديد بلا بصمة ثانية: يُسمح بالدخول، والدور من العضوية الحقيقية
    IF v_manages OR EXISTS (
         SELECT 1 FROM public.user_warehouses uw
           JOIN public.roles r ON r.id = uw.role_id
          WHERE uw.user_id = v_user AND lower(r.name) LIKE '%manager%') THEN
      v_role := 'manager';
    ELSE
      v_role := 'employee';
    END IF;

    INSERT INTO public.audit_logs
      (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
    VALUES (v_tenant, v_user, v_wh, 'two_step_success', 'auth_sessions', v_user,
            jsonb_build_object('source', 'web', 'initialized', true, 'role', v_role, 'at', now()));

    RETURN jsonb_build_object('granted', true, 'initialized', true,
                              'role', v_role, 'warehouse_id', v_wh);
  ELSE
    INSERT INTO public.audit_logs
      (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
    VALUES (v_tenant, v_user, v_wh, 'two_step_failed', 'auth_sessions', v_user,
            jsonb_build_object('source', 'web', 'submitted_chars', char_length(v_hash),
                               'reason', 'wrong_password', 'at', now()));

    RETURN jsonb_build_object('granted', false, 'reason', 'wrong_password');
  END IF;

  INSERT INTO public.audit_logs
    (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
  VALUES (v_tenant, v_user, v_wh, 'two_step_success', 'auth_sessions', v_user,
          jsonb_build_object('source', 'web', 'initialized', false, 'role', v_role, 'at', now()));

  RETURN jsonb_build_object('granted', true, 'initialized', false,
                            'role', v_role, 'warehouse_id', v_wh);
END
$fn$;

REVOKE ALL ON FUNCTION public.two_step_verify(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.two_step_verify(text) TO authenticated;

-- إجبار PostgREST على تحديث ذاكرة المخطط كي يرى الدالة فوراً
NOTIFY pgrst, 'reload schema';
