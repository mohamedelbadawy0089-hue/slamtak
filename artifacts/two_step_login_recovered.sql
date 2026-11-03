-- =====================================================================================
-- 202610290337_two_step_login.sql
-- تحقق الدخول على مرحلتين — المرحلة الثانية على الخادم حصرًا:
--   المرحلة الأولى: supabase.auth.signInWithPassword (جلسة أولية داخل متصفح).
--   المرحلة الثانية: two_step_verify(p_password) — دالة خادمية تقارن البصمة المُدخلة
--     مع محدد ثانٍ معتمد لنفس المستخدم فقط، داخل نفس نطاق المخزن:
--       * vault manager: warehouses.password_hash حيث manager_id = جلستك.
--       * users.manager_password_hash / users.staff_password_hash لمستخدمك.
--       * warehouse_password_hashes لمستخدمك (الخادم SECOND والبديل على نفس الجلسة).
--   مفاتيح أخرى: منع الحسبة عبر بطاقات سابقة: قبول أولى تسوية بهدوء (لا نشارك بصمات من أطراف أخرى).
--   أول توثيق (ل مدير مخزنه بلا ببصمة مخزنة بعد): يهيّئ البصمة لحسابه (نفس سلوك wms_manager_password_set) ويمنح.
--   الحد: بعد 5 فشل خلال 10 دقائق → رفض حتى انقضاء المدة (حساب من audit_logs على الخادم).
--   فشل/نجاح/تهيئة كلها تُسجّل في audit_logs بهوية الخادم.
-- آمن للتشغيل المتكرر.
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.two_step_verify(p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_hash text := btrim(coalesce(p_password, ''));
  v_attempt int;
  v_is_member boolean;
  v_is_manager boolean;
  v_active_ok boolean;
  v_matches boolean;
  v_any_hash boolean;
  v_wh uuid;
  v_tenant uuid;
  v_cnt int;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'المرحلة الثانية تتطلب جلسة مستخدم' USING ERRCODE = '42501';
  END IF;

  IF v_hash = '' OR char_length(v_hash) < 6 OR char_length(v_hash) > 200 THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'invalid_password');
  END IF;

  -- العضوية أو إدارة مخزن
  SELECT EXISTS (SELECT 1 FROM public.user_warehouses WHERE user_id = v_user),
         EXISTS (SELECT 1 FROM public.warehouses  WHERE manager_id = v_user)
    INTO v_is_member, v_is_manager;

  IF NOT v_is_member AND NOT v_is_manager THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'no_membership');
  END IF;

  -- حساب محاولات الفشل (الخادم يحسب؛ العميل لا يخطط لها)
  SELECT count(*) INTO v_attempt
    FROM public.audit_logs
   WHERE user_id = v_user
     AND action = 'two_step_failed'
     AND coalesce(created_at, now()) > now() - interval '10 minutes';

  IF v_attempt >= 5 THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'rate_limited');
  END IF;

  -- نقطة القصوى: ملغي حساب؟
  SELECT (SELECT NOT coalesce(u.is_active, true) FROM public.users u WHERE u.id = v_user),
         (SELECT count(*) FROM public.user_warehouses m WHERE m.user_id = v_user AND coalesce(m.is_active, true) = false)
    INTO v_active_ok, v_cnt;

  IF coalesce(v_active_ok, false) OR v_cnt > 0 THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'suspended');
  END IF;

  -- مقارنة بصمة مرحلتين ببصمات المستخدم نفسه فقط (لا بصمات من متصفح أو مستخدم آخر)
  SELECT EXISTS (
            SELECT 1 FROM public.warehouses w
             WHERE w.manager_id = v_user AND coalesce(w.password_hash, '') = v_hash
          )
       OR EXISTS (
            SELECT 1 FROM public.users su
             WHERE su.id = v_user
               AND (coalesce(su.manager_password_hash, '') = v_hash
                    OR coalesce(su.staff_password_hash, '') = v_hash)
          )
       OR EXISTS (
            SELECT 1 FROM public.warehouse_password_hashes ph
             WHERE ph.user_id = v_user AND ph.hash = v_hash
          )
    INTO v_matches;

  -- هل تُرسم ببصمة المرحلة الثانية أصلًا؟
  SELECT EXISTS (SELECT 1 FROM public.warehouses w WHERE w.manager_id = v_user AND coalesce(w.password_hash, '') <> '')
       OR EXISTS (SELECT 1 FROM public.warehouse_password_hashes ph WHERE ph.user_id = v_user)
       OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user
                  AND (coalesce(u.manager_password_hash, '') <> '' OR coalesce(u.staff_password_hash, '') <> ''))
    INTO v_any_hash;

  -- نطاق المستأجر/المخزن مشتقّ من الخادم فقط
  v_tenant := (SELECT tenant_id FROM public.warehouses WHERE manager_id = v_user LIMIT 1);
  IF v_tenant IS NULL THEN
    v_tenant := (SELECT tenant_id FROM public.user_warehouses WHERE user_id = v_user
                 ORDER BY created_at DESC LIMIT 1);
  END IF;
  v_wh := (SELECT warehouse_id FROM public.user_warehouses WHERE user_id = v_user
           ORDER BY is_default DESC NULLS LAST, created_at DESC LIMIT 1);
  IF v_wh IS NULL THEN
    v_wh := (SELECT id FROM public.warehouses WHERE manager_id = v_user ORDER BY created_at LIMIT 1);
  END IF;

  IF NOT v_any_hash THEN
    -- أول توثيق: لا ببصمة ثانية محفوظة — يُتاح فقط لمدير مخزنه
    IF v_is_manager THEN
      PERFORM public.wms_manager_password_set(v_hash);
    ELSE
      INSERT INTO public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
      VALUES (v_tenant, v_user, v_wh, 'two_step_failed', 'auth_sessions', v_user,
              jsonb_build_object('source', 'web', 'submitted_chars', char_length(v_hash), 'reason', 'no_second_factor_yet', 'at', now()));
      RETURN jsonb_build_object('granted', false, 'reason', 'no_second_factor_yet');
    END IF;
  ELSIF NOT v_matches THEN
    -- الفشل يُسجّل ويُعاد كنتيجة (بدون استثناء) لتُبقى محاولات الفشل في سجلات التدقيق
    -- وفي عدّاد المحاولات حتى لو أبطل المتصفح المعاملة بعد النتيجة
    INSERT INTO public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
    VALUES (v_tenant, v_user, v_wh, 'two_step_failed', 'auth_sessions', v_user,
            jsonb_build_object('source', 'web', 'submitted_chars', char_length(v_hash), 'reason', 'wrong_password', 'at', now()));

    RETURN jsonb_build_object('granted', false, 'reason', 'wrong_password');
  END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
  VALUES (v_tenant, v_user, v_wh, 'two_step_success', 'auth_sessions', v_user,
          jsonb_build_object('source', 'web', 'initialized', (NOT v_any_hash), 'at', now()));

  RETURN jsonb_build_object('granted', true, 'initialized', (NOT v_any_hash),
                            'warehouse_id', v_wh);
END
$fn$;

-- -------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.two_step_verify(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.two_step_verify(text) TO authenticated;

-- -------------------------------------------------------------------------------------
-- ملخّص
-- -------------------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.routines WHERE routine_schema='public' AND routine_name='two_step_verify') AS rpc_registered,
  (SELECT position('TWO_STEP' IN 'demo') = 0) AS sanity;
