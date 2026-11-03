-- =====================================================================================
-- 202611030005_single_warehouse_per_account.sql
-- مبدأ: مخزن واحد حصرياً لكل حساب
--
-- 1) التأكد من وجود tenant_id في profiles وإنشاء فهرس
-- 2) توحيد user_warehouses: إبقاء مخزن واحد نشط لكل مستخدم، وتعطيل الباقي
-- 3) مزامنة profiles.tenant_id و users.warehouse_id مع المخزن الحصري
-- 4) فرض القيد مستقبلاً: فهرس فريد جزئي + trigger وقائي
-- =====================================================================================

-- 1) profiles.tenant_id + فهرس
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

CREATE INDEX IF NOT EXISTS idx_profiles_tenant_id ON public.profiles(tenant_id);

-- 2) توحيد user_warehouses لكل مستخدم لمخزن واحد نشط
DO $$
DECLARE
  r record;
  v_keep uuid;
BEGIN
  FOR r IN
    SELECT user_id, count(*) c
      FROM public.user_warehouses
     WHERE coalesce(is_active, true)
     GROUP BY user_id
    HAVING count(*) > 1
  LOOP
    -- يفضل المخزن الموجود في users.warehouse_id
    SELECT uw.id
      INTO v_keep
      FROM public.user_warehouses uw
      LEFT JOIN public.users u ON u.id = uw.user_id
     WHERE uw.user_id = r.user_id
       AND coalesce(uw.is_active, true)
     ORDER BY (uw.warehouse_id = u.warehouse_id) DESC,
              coalesce(uw.is_default, false) DESC,
              uw.created_at ASC NULLS LAST,
              uw.id ASC
     LIMIT 1;

    IF v_keep IS NOT NULL THEN
      UPDATE public.user_warehouses
         SET is_active = false,
             updated_at = now()
       WHERE user_id = r.user_id
         AND coalesce(is_active, true)
         AND id <> v_keep;
    END IF;
  END LOOP;
EXCEPTION WHEN others THEN NULL;
END
$$;

-- 3) مزامنة
DO $$
BEGIN
  -- users.warehouse_id
  UPDATE public.users u
     SET warehouse_id = uw.warehouse_id,
         updated_at = coalesce(u.updated_at, now())
    FROM (
      SELECT DISTINCT ON (user_id) user_id, warehouse_id
        FROM public.user_warehouses
       WHERE coalesce(is_active, true)
       ORDER BY user_id, is_default DESC NULLS LAST, created_at ASC NULLS LAST
    ) uw
   WHERE u.id = uw.user_id
     AND (u.warehouse_id IS DISTINCT FROM uw.warehouse_id);

  -- profiles.tenant_id
  UPDATE public.profiles p
     SET tenant_id = w.tenant_id
    FROM public.users u
    JOIN public.warehouses w ON w.id = u.warehouse_id
   WHERE p.id = u.id
     AND w.tenant_id IS NOT NULL
     AND (p.tenant_id IS DISTINCT FROM w.tenant_id);
EXCEPTION WHEN others THEN NULL;
END
$$;

-- 4) فرض القيد مستقبلاً
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_warehouses_one_active_per_user
  ON public.user_warehouses(user_id)
 WHERE coalesce(is_active, true);

-- trigger وقائي
CREATE OR REPLACE FUNCTION public.enforce_single_active_warehouse()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $tr$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    IF coalesce(NEW.is_active, true) THEN
      IF EXISTS (
        SELECT 1 FROM public.user_warehouses uw
         WHERE uw.user_id = NEW.user_id
           AND uw.id <> NEW.id
           AND coalesce(uw.is_active, true)
      ) THEN
        RAISE EXCEPTION 'single_warehouse_per_account: user % already has an active warehouse', NEW.user_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$tr$;

DROP TRIGGER IF EXISTS trg_enforce_single_active_warehouse ON public.user_warehouses;
CREATE TRIGGER trg_enforce_single_active_warehouse
  BEFORE INSERT OR UPDATE ON public.user_warehouses
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_single_active_warehouse();

-- تحديث ذاكرة PostgREST
NOTIFY pgrst, 'reload schema';
