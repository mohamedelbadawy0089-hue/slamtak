-- =====================================================================================
-- 202611030007_handle_new_user_trigger.sql
-- ربط تلقائي: عند إنشاء مستخدم في auth.users يُنشأ سجل في public.profiles
-- يُستخدم tenant_id من raw_user_meta_data إن وُجد وإلا gen_random_uuid()
-- ON CONFLICT (id) DO UPDATE للحفاظ على tenant_id دون تغيير
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $fn$
DECLARE
  v_tenant_id uuid;
  v_full_name text;
  v_phone     text;
  v_role      text;
BEGIN
  -- محاولة الحصول على tenant_id من raw_user_meta_data
  BEGIN
    v_tenant_id := (NEW.raw_user_meta_data ->> 'tenant_id')::uuid;
  EXCEPTION WHEN others THEN
    v_tenant_id := NULL;
  END;

  IF v_tenant_id IS NULL THEN
    BEGIN
      v_tenant_id := (NEW.raw_app_meta_data ->> 'tenant_id')::uuid;
    EXCEPTION WHEN others THEN
      v_tenant_id := NULL;
    END;
  END IF;

  IF v_tenant_id IS NULL THEN
    v_tenant_id := gen_random_uuid();
  END IF;

  -- بيانات إضافية اختيارية
  BEGIN
    v_full_name := coalesce(
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'name',
      trim(coalesce(NEW.raw_user_meta_data ->> 'first_name','') || ' ' || coalesce(NEW.raw_user_meta_data ->> 'last_name',''))
    );
    IF v_full_name IS NULL OR btrim(v_full_name) = '' THEN
      v_full_name := split_part(coalesce(NEW.email,''), '@', 1);
    END IF;
  EXCEPTION WHEN others THEN
    v_full_name := split_part(coalesce(NEW.email,''), '@', 1);
  END;

  BEGIN
    v_phone := NEW.raw_user_meta_data ->> 'phone';
  EXCEPTION WHEN others THEN
    v_phone := NULL;
  END;

  BEGIN
    v_role := lower(coalesce(NEW.raw_user_meta_data ->> 'role', NEW.raw_app_meta_data ->> 'role', 'user'));
  EXCEPTION WHEN others THEN
    v_role := 'user';
  END;

  -- إنشاء/تحديث profile مع الحفاظ على tenant_id الحالي إن وُجد
  INSERT INTO public.profiles (id, full_name, phone, role, is_active, tenant_id, created_at, updated_at)
  VALUES (NEW.id, v_full_name, v_phone, v_role, true, v_tenant_id, now(), now())
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    phone     = COALESCE(EXCLUDED.phone, public.profiles.phone),
    role      = COALESCE(NULLIF(EXCLUDED.role,''), public.profiles.role),
    is_active = COALESCE(public.profiles.is_active, EXCLUDED.is_active),
    tenant_id = COALESCE(public.profiles.tenant_id, EXCLUDED.tenant_id),
    updated_at = now();

  RETURN NEW;
EXCEPTION WHEN others THEN
  -- لا نمنع إنشاء المستخدم في auth.users أبداً
  RETURN NEW;
END
$fn$;

-- صلاحيات
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role;

-- حذف المشغل إن وُجد وإعادة إنشائه
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- تحديث مخطط PostgREST
NOTIFY pgrst, 'reload schema';
