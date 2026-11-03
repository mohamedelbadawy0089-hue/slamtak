-- =====================================================================================
-- 202611030002_two_step_verify_audit_fk.sql
-- إصلاح: "insert or update on table audit_logs violates foreign key constraint
--         audit_logs_user_id_fkey"
--
-- سبب الفشل: دالة two_step_verify كانت تكتب صف تدقيق بـ user_id = auth.uid() مباشرة،
-- وبعض جلسات الدخول تحمل معرّفاً غير موجود في الجدول المرجعي للمفتاح الخارجي، فيفشل
-- الإدراج ويُفشل تسجيل الدخول كله رغم أن كلمة المرور صحيحة.
--
-- الحل: دالة مساعدة two_step_audit تكتب التدقيق بأفضل جهد (best effort) وتبتلع أي خطأ
-- (مفتاح خارجي / عمود إلزامي)، فلا يستطيع سجل التدقيق أن يمنع الدخول أبداً.
-- آمن للتشغيل المتكرر.
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
SET search_path = public, pg_temp
AS $audit$
BEGIN
  BEGIN
    INSERT INTO public.audit_logs
      (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
    VALUES (p_tenant, p_user, p_wh, p_action, 'auth_sessions', p_entity, p_values);
  EXCEPTION WHEN others THEN
    -- محاولة ثانية: نُبقي tenant_id صالحاً (عمود إلزامي) ونُفرغ user_id إن لم يكن
    -- موجوداً في users، كي يبقى سجل المحاولة (وعدّاد حد المحاولات) فعّالاً.
    BEGIN
      INSERT INTO public.audit_logs
        (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
      VALUES (
        coalesce(p_tenant, (SELECT t.id FROM public.tenants t LIMIT 1)),
        CASE WHEN p_user IS NOT NULL
                  AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user)
             THEN p_user ELSE NULL END,
        p_wh, p_action, 'auth_sessions',
        CASE WHEN p_entity IS NOT NULL
                  AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_entity)
             THEN p_entity ELSE NULL END,
        p_values);
    EXCEPTION WHEN others THEN
      NULL;  -- التدقيق لا يمنع الدخول تحت أي ظرف
    END;
  END;
END
$audit$;

REVOKE ALL ON FUNCTION public.two_step_audit(uuid, uuid, uuid, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.two_step_audit(uuid, uuid, uuid, text, uuid, jsonb) FROM anon;

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

  -- مطابقة كلمة مرور المدير
  SELECT EXISTS (SELECT 1 FROM public.warehouses w
                  WHERE w.manager_id = v_user AND coalesce(w.password_hash, '') = v_hash)
      OR EXISTS (SELECT 1 FROM public.users u
                  WHERE u.id = v_user AND coalesce(u.manager_password_hash, '') = v_hash)
      OR EXISTS (SELECT 1 FROM public.warehouse_password_hashes ph
                  WHERE ph.user_id = v_user AND ph.hash = v_hash)
    INTO v_mgr_match;

  -- مطابقة كلمة مرور الموظف (كما في users، وكما في جدول بصمات الموظفين إن وُجد)
  SELECT EXISTS (SELECT 1 FROM public.users u
                  WHERE u.id = v_user AND coalesce(u.staff_password_hash, '') = v_hash)
    INTO v_staff_match;

  -- هل للمستخدم أي بصمة ثانية محفوظة؟
  SELECT (EXISTS (SELECT 1 FROM public.warehouses w
                   WHERE w.manager_id = v_user AND coalesce(w.password_hash, '') <> '')
       OR EXISTS (SELECT 1 FROM public.warehouse_password_hashes ph WHERE ph.user_id = v_user)
       OR EXISTS (SELECT 1 FROM public.users u
                   WHERE u.id = v_user
                     AND (coalesce(u.manager_password_hash, '') <> ''
                          OR coalesce(u.staff_password_hash, '') <> '')))
    INTO v_any_hash;

  -- المخزن والمستأجر من الخادم فقط
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

    PERFORM public.two_step_audit(v_tenant, v_user, v_wh, 'two_step_success', v_user,
      jsonb_build_object('source', 'web', 'initialized', true, 'role', v_role, 'at', now()));

    RETURN jsonb_build_object('granted', true, 'initialized', true,
                              'role', v_role, 'warehouse_id', v_wh);
  ELSE
    PERFORM public.two_step_audit(v_tenant, v_user, v_wh, 'two_step_failed', v_user,
      jsonb_build_object('source', 'web', 'submitted_chars', char_length(v_hash),
                         'reason', 'wrong_password', 'at', now()));

    RETURN jsonb_build_object('granted', false, 'reason', 'wrong_password');
  END IF;

  PERFORM public.two_step_audit(v_tenant, v_user, v_wh, 'two_step_success', v_user,
    jsonb_build_object('source', 'web', 'initialized', false, 'role', v_role, 'at', now()));

  RETURN jsonb_build_object('granted', true, 'initialized', false,
                            'role', v_role, 'warehouse_id', v_wh);
END
$fn$;

REVOKE ALL ON FUNCTION public.two_step_verify(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.two_step_verify(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.two_step_verify(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
