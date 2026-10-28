-- =====================================================================================
-- إصلاح شامل وآمن لجداول نظام الصلاحيات (RBAC)
-- Repair / reconcile RBAC schema before running the permissions migrations
--
-- الغرض: معالجة الأخطاء من نوع
--   42703: column "category" of relation "permissions" does not exist
--   23502: null value in column "name_ar" of relation "roles"
-- عند وجود الجداول مسبقاً بتعريف قديم أو ناقص.
--
-- الملف آمن للتشغيل أكثر من مرة (idempotent) ولا يحذف أي بيانات.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1) جدول الصلاحيات permissions
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  description text,
  category text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- تعبئة القيم الفارغة قبل فرض القيود
UPDATE public.permissions SET category = 'general' WHERE category IS NULL OR btrim(category) = '';
UPDATE public.permissions SET created_at = now() WHERE created_at IS NULL;
UPDATE public.permissions SET name = 'permission_' || replace(id::text, '-', '')
 WHERE name IS NULL OR btrim(name) = '';

-- فرض القيود المطلوبة
ALTER TABLE public.permissions ALTER COLUMN category SET DEFAULT 'general';
ALTER TABLE public.permissions ALTER COLUMN category SET NOT NULL;
ALTER TABLE public.permissions ALTER COLUMN created_at SET DEFAULT now();

-- إزالة أي تكرار سابق على الاسم قبل فرض القيد
WITH dups AS (
  SELECT id, row_number() OVER (PARTITION BY name ORDER BY created_at, id) AS rn
    FROM public.permissions
)
UPDATE public.permissions p
   SET name = p.name || '_' || substr(replace(p.id::text, '-', ''), 1, 6)
  FROM dups d
 WHERE d.id = p.id AND d.rn > 1;

-- منع تكرار اسم الصلاحية
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'uq_permissions_name'
       AND conrelid = 'public.permissions'::regclass
  ) THEN
    ALTER TABLE public.permissions
      ADD CONSTRAINT uq_permissions_name UNIQUE (name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_permissions_category ON public.permissions (category);

-- -------------------------------------------------------------------------------------
-- 2) جدول الأدوار roles
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  description text,
  is_system boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS is_system boolean DEFAULT false;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS name_ar text;

UPDATE public.roles SET created_at = now() WHERE created_at IS NULL;
UPDATE public.roles SET name = 'role_' || replace(id::text, '-', '')
 WHERE name IS NULL OR btrim(name) = '';
UPDATE public.roles SET name_ar = name WHERE name_ar IS NULL OR btrim(name_ar) = '';

ALTER TABLE public.roles ALTER COLUMN name_ar DROP NOT NULL;

WITH dups AS (
  SELECT id, row_number() OVER (PARTITION BY name ORDER BY created_at, id) AS rn
    FROM public.roles
)
UPDATE public.roles r
   SET name = r.name || '_' || substr(replace(r.id::text, '-', ''), 1, 6)
  FROM dups d
 WHERE d.id = r.id AND d.rn > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'uq_roles_name'
       AND conrelid = 'public.roles'::regclass
  ) THEN
    ALTER TABLE public.roles
      ADD CONSTRAINT uq_roles_name UNIQUE (name);
  END IF;
END $$;

-- -------------------------------------------------------------------------------------
-- 3) جدول ربط الصلاحيات بالأدوار role_permissions
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id uuid,
  permission_id uuid
);

ALTER TABLE public.role_permissions ADD COLUMN IF NOT EXISTS role_id uuid;
ALTER TABLE public.role_permissions ADD COLUMN IF NOT EXISTS permission_id uuid;

DELETE FROM public.role_permissions
 WHERE role_id IS NULL OR permission_id IS NULL;

-- إزالة التكرار قبل إنشاء المفتاح الأساسي
DELETE FROM public.role_permissions a
 USING public.role_permissions b
 WHERE a.ctid < b.ctid
   AND a.role_id = b.role_id
   AND a.permission_id = b.permission_id;

DO $$
BEGIN
  -- لا نضيف مفتاحاً أساسياً إن كان الجدول يملك واحداً بالفعل بأي اسم
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.role_permissions'::regclass
       AND contype = 'p'
  ) THEN
    ALTER TABLE public.role_permissions
      ADD CONSTRAINT pk_role_permissions PRIMARY KEY (role_id, permission_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_role_permissions_role'
       AND conrelid = 'public.role_permissions'::regclass
  ) THEN
    ALTER TABLE public.role_permissions
      ADD CONSTRAINT fk_role_permissions_role
      FOREIGN KEY (role_id) REFERENCES public.roles (id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_role_permissions_permission'
       AND conrelid = 'public.role_permissions'::regclass
  ) THEN
    ALTER TABLE public.role_permissions
      ADD CONSTRAINT fk_role_permissions_permission
      FOREIGN KEY (permission_id) REFERENCES public.permissions (id) ON DELETE CASCADE;
  END IF;
END $$;

-- -------------------------------------------------------------------------------------
-- 4) جدول أعمدة الأدوار داخل المخزن user_warehouses
-- -------------------------------------------------------------------------------------
ALTER TABLE public.user_warehouses ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.user_warehouses ADD COLUMN IF NOT EXISTS role_id uuid;

UPDATE public.user_warehouses SET permissions = '{}'::jsonb WHERE permissions IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_warehouses_permissions
  ON public.user_warehouses USING GIN (permissions);

-- -------------------------------------------------------------------------------------
-- 5) صلاحيات القراءة الأساسية
-- -------------------------------------------------------------------------------------
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.permissions TO authenticated;
GRANT SELECT ON public.roles TO authenticated;
GRANT SELECT ON public.role_permissions TO authenticated;

-- -------------------------------------------------------------------------------------
-- 6) تحقق نهائي — يعرض الأعمدة الفعلية بعد الإصلاح
-- -------------------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(x.col, ', ') INTO v_missing
    FROM (VALUES ('permissions.id'), ('permissions.name'), ('permissions.category'),
                 ('roles.id'), ('roles.name')) AS x(col)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name  = split_part(x.col, '.', 1)
        AND c.column_name = split_part(x.col, '.', 2)
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'أعمدة مفقودة بعد الإصلاح: %', v_missing;
  END IF;

  RAISE NOTICE 'تم إصلاح مخطط الصلاحيات بنجاح. يمكنك الآن تشغيل ملفات RBAC.';
END $$;
