-- إصلاح wms_register_workspace: عمود warehouses.code إلزامي ومفتاح فريد بلا قيمة افتراضية.
-- الدالة كانت تفشل دائماً بـ(23502) عند أول إدراج مخزن، فتعطّل مسار تسجيل مساحة العمل كاملاً
-- (استُدعيت من الواجهة في شاشة التسجيل). تُولَّد قيمة فريدة داخل الدالة، مع الحفاظ على
-- السلّم الدفاعي الأصلي (undefined_column) عبر درج ختامي بلا code لتركيبات لا تملكه.
CREATE OR REPLACE FUNCTION public.wms_register_workspace(p_name text, p_phone text DEFAULT ''::text, p_governorate text DEFAULT ''::text, p_admin_hash text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_wh     uuid;
  v_name   text := btrim(coalesce(p_name, ''));
  v_code   text;
  v_known_user uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'إنشاء مساحة العمل يتطلب جلسة مستخدم' USING ERRCODE = '42501';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'اسم المخزن إلزامي' USING ERRCODE = '23514';
  END IF;

  -- المستأجر: أول مستأجر قائم، وإلّا يُنشأ اسمه اسم المخزن (نفس سلوك التسجيل السابق)
  SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at LIMIT 1;
  IF v_tenant IS NULL THEN
    INSERT INTO public.tenants (name) VALUES (v_name) RETURNING id INTO v_tenant;
  END IF;

  -- رمز المخزن: إلزامي ومفتاح فريد — مأخوذ من UUID عشوائي، ومع احتمال التصادم النادر
  -- (32 صفّاً من 4.3 مليارات احتمال) يُوسَّع إلى كامل الـUUID الذي يندرج ضمن varchar(50).
  v_code := 'WH-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  IF EXISTS (SELECT 1 FROM public.warehouses w WHERE w.code = v_code) THEN
    v_code := 'WH-' || replace(gen_random_uuid()::text, '-', '');
  END IF;

  -- معرّف المستخدم داخل public.users: كل من warehouses.manager_id و audit_logs.user_id
  -- مقيّدان بهذا الجدول القديم الذي لا يحوي كل مستخدمي auth.users (32 من 446).
  -- نستعمل المعرّف عند وجود الصف، وإلّا يبقى الفراغ (كلا العمودين nullable) بدل فشل
  -- المقيّد بـ(23503) الذي كان يسقط التسجيل كاملاً.
  SELECT u.id INTO v_known_user FROM public.users u WHERE u.id = v_user;

  -- المخزن: كل الأعمدة إن وُجدت مع رجوع تدريجي (كل درج يضيف code)
  BEGIN
    INSERT INTO public.warehouses (tenant_id, name, phone, governorate, is_main, password_hash, manager_id, code)
    VALUES (v_tenant, v_name, nullif(p_phone, ''), nullif(p_governorate, ''), true, nullif(p_admin_hash, ''), v_known_user, v_code)
    RETURNING id INTO v_wh;
  EXCEPTION WHEN undefined_column THEN
    BEGIN
      WITH ins AS (
        INSERT INTO public.warehouses (tenant_id, name, phone, governorate, is_main, manager_id, code)
        VALUES (v_tenant, v_name, nullif(p_phone, ''), nullif(p_governorate, ''), true, v_known_user, v_code)
        RETURNING id
      )
      SELECT id INTO v_wh FROM ins;
    EXCEPTION WHEN undefined_column THEN
      BEGIN
        WITH ins2 AS (
          INSERT INTO public.warehouses (tenant_id, name, phone, governorate, is_main, code)
          VALUES (v_tenant, v_name, nullif(p_phone, ''), nullif(p_governorate, ''), true, v_code)
          RETURNING id
        )
        SELECT id INTO v_wh FROM ins2;
      EXCEPTION WHEN undefined_column THEN
        BEGIN
          INSERT INTO public.warehouses (tenant_id, name, code)
          VALUES (v_tenant, v_name, v_code)
          RETURNING id INTO v_wh;
        EXCEPTION WHEN undefined_column THEN
          -- درج أخير لتركيبات لا تملك عمود code إطلاقاً
          INSERT INTO public.warehouses (tenant_id, name) VALUES (v_tenant, v_name)
          RETURNING id INTO v_wh;
        END;
      END;
    END;
  END;

  -- الملف الشخصي: لا نكتب فوق صف موجود (المتصفح كان يفعل ذلك)
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user) THEN
    BEGIN
      INSERT INTO public.profiles (id, full_name, phone, governorate, role)
      VALUES (v_user, v_name, nullif(p_phone, ''), nullif(p_governorate, ''), 'manager');
    EXCEPTION WHEN undefined_column THEN
      INSERT INTO public.profiles (id, full_name) VALUES (v_user, v_name);
    END;
  END IF;

  -- بصمة كلمة مرور المدير (Shea-256 base64url كما في الخادم)
  IF coalesce(p_admin_hash, '') <> '' AND NOT EXISTS (
      SELECT 1 FROM public.warehouse_password_hashes WHERE user_id = v_user) THEN
    INSERT INTO public.warehouse_password_hashes (user_id, hash) VALUES (v_user, p_admin_hash);
  END IF;

  -- ربط المدير بمخزنه إن لم يحدث ذلك بمُشغّل التسجيل
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

  INSERT INTO public.audit_logs (tenant_id, user_id, warehouse_id, action, entity_type, entity_id, new_values)
  VALUES (v_tenant, v_known_user, v_wh, 'register_workspace_created', 'warehouses', v_wh,
          jsonb_build_object('name', v_name, 'phone', nullif(p_phone, ''), 'governorate', nullif(p_governorate, '')));

  RETURN jsonb_build_object('tenant_id', v_tenant, 'warehouse_id', v_wh);
END
$function$
