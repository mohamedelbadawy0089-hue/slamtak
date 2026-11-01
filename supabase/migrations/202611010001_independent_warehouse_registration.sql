-- =====================================================================================
-- 202611010001_independent_warehouse_registration.sql
-- مخزن مستقل لكل مخزن: مسار تسجيل يُنشئ مخزنًا خاصًّا بالمستخدم كمالك him
-- =====================================================================================

-- دالة التسجيل: تنشئ مخزنًا جديدًا مع المستخدم كمدير (manager_id)
-- وتعود المخزن + tenant + ربط العضوية الافتراضية
CREATE OR REPLACE FUNCTION public.register_independent_warehouse(
  p_name text,
  p_phone text DEFAULT ''::text,
  p_governorate text DEFAULT ''::text,
  p_admin_hash text DEFAULT ''::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_wh uuid;
  v_code text;
  v_known_user uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'يتطلب تسجيل مخزن مستقل جلسة مستخدم' USING ERRCODE = '42501';
  END IF;
  IF btrim(coalesce(p_name, '')) = '' THEN
    RAISE EXCEPTION 'اسم المخزن إلزامي' USING ERRCODE = '23514';
  END IF;

  -- مستأجر جديد لكل مخزن مستقل (عزل كامل)
  v_tenant := gen_random_uuid();
  INSERT INTO public.tenants (id, name)
  VALUES (v_tenant, btrim(p_name));

  -- رمز فريد للمخزن
  v_code := 'WH-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  IF EXISTS (SELECT 1 FROM public.warehouses w WHERE w.code = v_code) THEN
    v_code := 'WH-' || replace(gen_random_uuid()::text, '-', '');
  END IF;

  SELECT u.id INTO v_known_user FROM public.users u WHERE u.id = v_user;

  -- مخزن mới: المستخدم هو المدير (manager_id = v_user)
  BEGIN
    INSERT INTO public.warehouses (tenant_id, name, phone, governorate, is_main, password_hash, manager_id, code)
    VALUES (v_tenant, p_name, nullif(p_phone, ''), nullif(p_governorate, ''), false, nullif(p_admin_hash, ''), v_known_user, v_code)
    RETURNING id INTO v_wh;
  EXCEPTION WHEN undefined_column THEN
    BEGIN
      INSERT INTO public.warehouses (tenant_id, name, phone, governorate, is_main, manager_id, code)
      VALUES (v_tenant, p_name, nullif(p_phone, ''), nullif(p_governorate, ''), false, v_known_user, v_code)
      RETURNING id INTO v_wh;
    EXCEPTION WHEN undefined_column THEN
      BEGIN
        INSERT INTO public.warehouses (tenant_id, name, phone, governorate, is_main, code)
        VALUES (v_tenant, p_name, nullif(p_phone, ''), nullif(p_governorate, ''), false, v_code)
        RETURNING id INTO v_wh;
      EXCEPTION WHEN undefined_column THEN
        INSERT INTO public.warehouses (tenant_id, name, code)
        VALUES (v_tenant, p_name, v_code)
        RETURNING id INTO v_wh;
      END;
    END;
  END;

  -- ملف شخصي للمدير
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user) THEN
    BEGIN
      INSERT INTO public.profiles (id, full_name, phone, governorate, role)
      VALUES (v_user, p_name, nullif(p_phone, ''), nullif(p_governorate, ''), 'manager');
    EXCEPTION WHEN undefined_column THEN
      INSERT INTO public.profiles (id, full_name) VALUES (v_user, p_name);
    END;
  END IF;

  -- بصمة كلمة مرور المدير
  IF coalesce(p_admin_hash, '') <> '' AND NOT EXISTS (
      SELECT 1 FROM public.warehouse_password_hashes WHERE user_id = v_user) THEN
    INSERT INTO public.warehouse_password_hashes (user_id, hash) VALUES (v_user, p_admin_hash);
  END IF;

  -- ربط المستخدم بمخزنه كعضو افتراضي (مالك)
  IF NOT EXISTS (SELECT 1 FROM public.user_warehouses
                 WHERE user_id = v_user AND warehouse_id = v_wh) THEN
    BEGIN
      INSERT INTO public.user_warehouses (user_id, warehouse_id, tenant_id, is_default)
      VALUES (v_user, v_wh, v_tenant, true);
    EXCEPTION WHEN undefined_column THEN
      INSERT INTO public.user_warehouses (user_id, warehouse_id, tenant_id)
      VALUES (v_user, v_wh, v_tenant);
    END;
  END IF;

  -- صلاحيات المدير على مخ Zahnewه (إدارة كاملة)
  INSERT INTO public.user_warehouses AS uw (user_id, warehouse_id, tenant_id, permissions, is_default)
  VALUES (v_user, v_wh, v_tenant, jsonb_build_object('warehouse.manage', true, 'users.manage', true), true)
  ON CONFLICT (user_id, warehouse_id) DO UPDATE
    SET permissions = coalesce(uw.permissions, '{}'::jsonb) || jsonb_build_object('warehouse.manage', true, 'users.manage', true);

  -- سجل مراجعة
  INSERT INTO public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
  VALUES (v_tenant, v_known_user, v_wh, 'register_independent_warehouse', 'warehouses', v_wh,
          jsonb_build_object('name', p_name, 'phone', nullif(p_phone, ''), 'governorate', nullif(p_governorate, '')));

  RETURN jsonb_build_object(
    'tenant_id', v_tenant,
    'warehouse_id', v_wh,
    'warehouse_name', p_name,
    'warehouse_code', v_code
  );
END
$fn$;

GRANT EXECUTE ON FUNCTION public.register_independent_warehouse(text, text, text, text) TO authenticated;

-- تحديث:ğ boredom -- ensure linking function prefers user's own warehouse over shared main
CREATE OR REPLACE FUNCTION public.default_user_warehouse(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT uw.warehouse_id
     FROM public.user_warehouses uw
     WHERE uw.user_id = p_user_id
     ORDER BY uw.is_default DESC, uw.created_at NULLS LAST
     LIMIT 1),
    (SELECT w.id
     FROM public.warehouses w
     WHERE w.is_main IS TRUE
     LIMIT 1)
  );
$$;

GRANT EXECUTE ON FUNCTION public.default_user_warehouse(uuid) TO authenticated;
