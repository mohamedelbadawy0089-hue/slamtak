-- =====================================================================================
-- 202610290338_manager_second_hash_best_effort.sql
-- تليين صعيد البصمة الثانية للمدير في wms_manager_password_set:
--   * جدول warehouse_password_hashes.user_id مرتبط بـ auth.users — تحديثه جزء من
--     التوازي، ويُستكمل بالأعلى جدول المخازن (warehouses.password_hash) وهو المصدر
--     الأول للتحقق الثانوي.
--   * الكتابة عليه صارت للألمضğu: اختيارية، وفشلها (عميل اصطناعي / أدنى مهمة) لا يمنع
--     توثيق البصمة في جدول المخازن ولا منح الدخول الثاني.
-- آمن للتشغيل المتكرر.
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.wms_manager_password_set(p_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_wh   uuid := NULL;
  v_rows int  := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'حفظ كلمة مرور المدير يتطلب جلسة مستخدم' USING ERRCODE = '42501';
  END IF;
  IF p_hash IS NULL OR btrim(p_hash) = '' OR char_length(btrim(p_hash)) < 8 THEN
    RAISE EXCEPTION 'بصمة كلمة مرور غير صالحة' USING ERRCODE = '23514';
  END IF;

  -- المصدر الأول للتحقق الثانوي: بصمة مخزن المدير
  UPDATE public.warehouses SET password_hash = btrim(p_hash) WHERE manager_id = v_user RETURNING id INTO v_wh;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- الصم₨ الثانوية (الجدول المرتبط بـ auth.users): أفضل جهد، وفشلها لا يمنع المنح
  BEGIN
    IF EXISTS (SELECT 1 FROM public.warehouse_password_hashes WHERE user_id = v_user) THEN
      UPDATE public.warehouse_password_hashes SET hash = btrim(p_hash) WHERE user_id = v_user;
    ELSE
      INSERT INTO public.warehouse_password_hashes (user_id, hash) VALUES (v_user, btrim(p_hash));
    END IF;
  EXCEPTION
    WHEN foreign_key_violation OR undefined_object THEN
      NULL;
  END;

  INSERT INTO public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
  VALUES (COALESCE((SELECT tenant_id FROM public.warehouses WHERE manager_id = v_user LIMIT 1),
                   (SELECT tenant_id FROM public.user_warehouses WHERE user_id = v_user
                    ORDER BY created_at DESC LIMIT 1)),
          v_user, v_wh, 'manager_password_set', 'warehouses', v_wh,
          jsonb_build_object('warehouses_updated', v_rows,
                             'note', 'بصمة SHA-256 base64url؛ لا كلمة مرور صريحة'));

  RETURN jsonb_build_object('warehouses_updated', v_rows, 'warehouse_id', v_wh);
END
$fn$;

REVOKE ALL ON FUNCTION public.wms_manager_password_set(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wms_manager_password_set(text) TO authenticated;

SELECT 'wms_manager_password_set best-effort ready' AS status;
