-- 202610290316_username_auth.sql
-- دخول باسم المستخدم وكلمة المرور فقط، وإنشاء موظف من داخل المخزن.
-- Supabase Auth يحتاج بريدًا داخليًا، لذلك يُولَّد بريد داخلي غير مرئي للمستخدم:
--   <username>@warehouse.local
-- وكلمة المرور تُخزَّن كـ bcrypt داخل auth.users (لا تُخزَّن نصًا صريحًا في أي جدول).

-- ============================================================
-- 1) جدول موظفي المخزن
-- ============================================================
CREATE TABLE IF NOT EXISTS public.warehouse_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  full_name text NOT NULL,
  username text NOT NULL,
  login_email text NOT NULL,
  role_id uuid REFERENCES public.roles(id) ON DELETE SET NULL,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouse_employees_username
  ON public.warehouse_employees (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouse_employees_user
  ON public.warehouse_employees (user_id);
CREATE INDEX IF NOT EXISTS ix_warehouse_employees_warehouse
  ON public.warehouse_employees (warehouse_id);
CREATE INDEX IF NOT EXISTS ix_warehouse_employees_tenant
  ON public.warehouse_employees (tenant_id);

ALTER TABLE public.warehouse_employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warehouse_employees_read ON public.warehouse_employees;
CREATE POLICY warehouse_employees_read ON public.warehouse_employees
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.current_actor_manages(warehouse_id));

GRANT SELECT ON public.warehouse_employees TO authenticated;

-- ============================================================
-- 2) تحويل اسم المستخدم إلى البريد الداخلي عند تسجيل الدخول
--    (يُستدعى قبل تسجيل الدخول، لذلك متاح لـ anon أيضًا)
-- ============================================================
CREATE OR REPLACE FUNCTION public.employee_login_email(p_username text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT e.login_email
    FROM public.warehouse_employees e
   WHERE lower(e.username) = lower(btrim(coalesce(p_username, '')))
     AND e.is_active
   LIMIT 1;
$fn$;

GRANT EXECUTE ON FUNCTION public.employee_login_email(text) TO anon, authenticated;

-- ============================================================
-- 3) إنشاء موظف (حساب + كلمة مرور + دور + صلاحيات) — المدير فقط
-- ============================================================
CREATE OR REPLACE FUNCTION public.employee_create(
  p_warehouse uuid,
  p_full_name text,
  p_username text,
  p_password text,
  p_role_name text DEFAULT NULL,
  p_permissions jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user_id   uuid := gen_random_uuid();
  v_tenant_id uuid;
  v_role_id   uuid;
  v_username  text;
  v_email     text;
  v_instance  uuid;
BEGIN
  IF NOT public.current_actor_manages(p_warehouse) THEN
    RAISE EXCEPTION 'غير مصرح بإضافة موظفين لهذا المخزن' USING ERRCODE = '42501';
  END IF;

  IF p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RAISE EXCEPTION 'اسم الموظف مطلوب';
  END IF;

  v_username := lower(btrim(coalesce(p_username, '')));
  IF v_username !~ '^[a-z0-9._-]{3,32}$' THEN
    RAISE EXCEPTION 'اسم المستخدم: 3 إلى 32 حرفًا إنجليزيًا صغيرًا أو أرقامًا أو . _ - بدون مسافات';
  END IF;

  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'كلمة المرور يجب ألا تقل عن 6 أحرف';
  END IF;

  SELECT w.tenant_id INTO v_tenant_id FROM public.warehouses w WHERE w.id = p_warehouse;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'المخزن غير موجود';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.warehouse_employees e WHERE lower(e.username) = v_username
  ) OR EXISTS (
    SELECT 1 FROM public.user_warehouses uw
      JOIN auth.users au ON au.id = uw.user_id
     WHERE lower(split_part(coalesce(au.email, ''), '@', 1)) = v_username
  ) THEN
    RAISE EXCEPTION 'اسم المستخدم مستخدم بالفعل، اختر اسمًا آخر';
  END IF;

  IF p_role_name IS NOT NULL AND btrim(p_role_name) <> '' THEN
    SELECT r.id INTO v_role_id FROM public.roles r WHERE r.name = p_role_name LIMIT 1;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION 'الدور غير موجود: %', p_role_name;
    END IF;
  END IF;

  v_email := v_username || '@warehouse.local';
  SELECT au.instance_id INTO v_instance FROM auth.users au LIMIT 1;

  INSERT INTO auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
     confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
     phone_change, phone_change_token, email_change_confirm_status, is_super_admin, is_sso_user, is_anonymous,
     raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_user_id, v_instance, 'authenticated', 'authenticated', v_email,
     public.crypt(p_password, public.gen_salt('bf')), now(), now(), now(),
     '', '', '', '', '', '', '', 0, false, false, false,
     jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
     jsonb_build_object('full_name', btrim(p_full_name), 'username', v_username, 'warehouse_id', p_warehouse));

  INSERT INTO auth.identities
    (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
  VALUES
    (gen_random_uuid(), v_user_id, v_user_id, 'email',
     jsonb_build_object('sub', v_user_id, 'email', v_email), now(), now(), now());

  -- مشغّلات auth.users تربط المستخدم الجديد بالمخزن الرئيسي؛ نُلغي ذلك
  -- حتى يبقى الموظف داخل المخزن المطلوب فقط.
  DELETE FROM public.user_roles         WHERE user_id = v_user_id AND warehouse_id <> p_warehouse;
  DELETE FROM public.user_warehouses    WHERE user_id = v_user_id AND warehouse_id <> p_warehouse;
  DELETE FROM public.warehouse_employees WHERE user_id = v_user_id AND warehouse_id <> p_warehouse;

  INSERT INTO public.profiles (id, full_name, role)
  VALUES (v_user_id, btrim(p_full_name), 'viewer')
  ON CONFLICT (id) DO UPDATE SET full_name = excluded.full_name;

  INSERT INTO public.warehouse_employees
    (tenant_id, warehouse_id, user_id, full_name, username, login_email, role_id, permissions, created_by)
  VALUES
    (v_tenant_id, p_warehouse, v_user_id, btrim(p_full_name), v_username, v_email,
     v_role_id, coalesce(p_permissions, '{}'::jsonb), auth.uid());

  INSERT INTO public.user_warehouses AS uw
    (user_id, warehouse_id, tenant_id, role_id, permissions, is_default)
  VALUES
    (v_user_id, p_warehouse, v_tenant_id, v_role_id, coalesce(p_permissions, '{}'::jsonb), true)
  ON CONFLICT (user_id, warehouse_id) DO UPDATE
    SET role_id     = coalesce(excluded.role_id, uw.role_id),
        permissions = excluded.permissions;

  IF v_role_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, warehouse_id, role_id, assigned_by, is_active)
    VALUES (v_user_id, p_warehouse, v_role_id, auth.uid(), true)
    ON CONFLICT (user_id, warehouse_id, role_id) DO UPDATE SET is_active = true;
  END IF;

  BEGIN
    INSERT INTO public.audit_logs
      (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
    VALUES
      (v_tenant_id, auth.uid(), p_warehouse, 'employee_create', 'warehouse_employees', v_user_id,
       jsonb_build_object('username', v_username, 'full_name', btrim(p_full_name),
                          'role', p_role_name, 'permissions', coalesce(p_permissions, '{}'::jsonb)));
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'تعذر تسجيل العملية في سجل التدقيق: %', SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'user_id', v_user_id, 'username', v_username, 'login_email', v_email);
END
$fn$;

GRANT EXECUTE ON FUNCTION public.employee_create(uuid, text, text, text, text, jsonb) TO authenticated;

-- ============================================================
-- 4) تحقق
-- ============================================================
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'warehouse_employees'
  ) THEN
    RAISE EXCEPTION 'جدول warehouse_employees غير موجود بعد الإنشاء';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'employee_login_email' AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'دالة employee_login_email غير موجودة';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'employee_create' AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'دالة employee_create غير موجودة';
  END IF;

  RAISE NOTICE 'نظام الدخول باسم المستخدم جاهز';
END
$do$;
