-- نظام الصلاحيات المخصصة - RBAC مع JSON
-- Dedicated permissions system with JSON

-- 1) جدول الصلاحيات
CREATE TABLE IF NOT EXISTS public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  category text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2) جدول أدوار الصلاحيات
CREATE TABLE IF NOT EXISTS public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3) جدول تعيينات الصلاحيات للأدوار
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- 4) جدول تعيينات الأدوار للمستخدمين (داخل كل مخزن)
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, warehouse_id, role_id)
);

-- 5) صلاحيات افتراضية للأنظمة
INSERT INTO public.roles (name, description, is_system) VALUES
  ('super_admin', 'مدير النظام - صلاحيات كاملة', true),
  ('admin', 'مدير المخزن - صلاحيات إدارية', true),
  ('manager', 'مدير القسم - صلاحيات محدودة', true),
  ('employee', 'موظف - صلاحيات أساسية', true),
  ('viewer', 'مشاهد فقط - صلاحيات القراءة', true)
ON CONFLICT DO NOTHING;

-- 6) صلاحيات افتراضية
INSERT INTO public.permissions (name, description, category) VALUES
  ('employees.manage', 'إدارة الموظفين', 'hr'),
  ('employees.view', 'عرض الموظفين', 'hr'),
  ('sales.manage', 'إدارة المبيعات', 'sales'),
  ('sales.view', 'عرض المبيعات', 'sales'),
  ('purchases.manage', 'إدارة المشتريات', 'purchases'),
  ('purchases.view', 'عرض المشتريات', 'purchases'),
  ('inventory.manage', 'إدارة المخزون', 'inventory'),
  ('inventory.view', 'عرض المخزون', 'inventory'),
  ('warehouse.manage', 'إدارة المخازن', 'warehouse'),
  ('warehouse.view', 'عرض المخازن', 'warehouse'),
  ('settings.manage', 'إدارة الإعدادات', 'settings'),
  ('reports.view', 'عرض التقارير', 'reports')
ON CONFLICT DO NOTHING;

-- 7) تعيين الصلاحيات الافتراضية للأدوار
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE (r.name = 'super_admin')
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE (r.name = 'admin' OR r.name = 'manager')
  AND p.category != 'settings'
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'employee'
  AND p.category IN ('hr', 'sales', 'purchases', 'inventory')
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'viewer'
  AND p.name LIKE '%view'
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)
ON CONFLICT DO NOTHING;

-- 8) صلاحيات
GRANT SELECT ON public.permissions TO authenticated;
GRANT SELECT ON public.roles TO authenticated;
GRANT SELECT ON public.role_permissions TO authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;

COMMENT ON TABLE public.permissions IS 'الصلاحيات المخصصة للنظام';
COMMENT ON TABLE public.roles IS 'أدوار المستخدمين في النظام';
COMMENT ON TABLE public.role_permissions IS 'تعيين الصلاحيات للأدوار';
COMMENT ON TABLE public.user_roles IS 'تعيين الأدوار للمستخدمين داخل كل مخزن';
