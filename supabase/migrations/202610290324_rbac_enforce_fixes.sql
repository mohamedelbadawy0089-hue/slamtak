-- =====================================================================================
-- 202610290324_rbac_enforce_fixes.sql
-- إصلاحات بعد اختبار فرض الصلاحيات على جداول الأعمال:
--   1) الترقية لمرة واحدة كانت تتعرّف على الأسماء الحديثة (view) فقط، فتجاوزت
--      الأدوار التي ما زالت تستخدم الأسماء القديمة (read) — فأصبح دور "مشاهد"
--      يملك كتابة في وحدات لا يملكها مدير المخزن، وهو ما يكسر قاعدة منع التصعيد.
--   2) الاعتماد/الرفض/الإلغاء للمستندات: تضاف لمديري المخازن حتى لا يتوقف سير
--      الاعتماد بعد الفرض (كانوا يغيّرون الحالة فعلاً قبل التغيير).
--   3) ضمان أن دور مدير المخزن داخل كل مخزن يحتوي صلاحيات الأدوار التي يديرها
--      (عدا صلاحيات إدارة النظام) حتى تبقى قاعدة "لا تمنح ما لا تملك" قابلة للتنفيذ.
-- آمن للتشغيل المتكرر.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1) إعادة الترقية مع احتساب المرادفات
-- -------------------------------------------------------------------------------------
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, p.id
  FROM public.role_permissions rp
  JOIN public.permissions vp ON vp.id = rp.permission_id
  JOIN public.permissions p
    ON p.category = vp.category
   AND p.name IN (vp.category || '.create', vp.category || '.update')
 WHERE vp.name IN (vp.category || '.view', vp.category || '.read')
   AND vp.category IN ('products','inventory','suppliers','customers','purchases',
                       'sales','payments','hr','accounting','notifications')
ON CONFLICT DO NOTHING;

-- -------------------------------------------------------------------------------------
-- 2) صلاحيات اعتماد وإلغاء المستندات لمديري المخازن
-- -------------------------------------------------------------------------------------
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT DISTINCT r.id, p.id
  FROM public.roles r
  JOIN public.permissions p
    ON p.name IN ('purchases.approve','purchases.reject','purchases.cancel',
                  'sales.cancel','returns.approve','returns.reject','returns.cancel')
 WHERE r.deleted_at IS NULL
   AND lower(btrim(r.name)) IN ('warehouse manager','tenant admin','super admin','manager','admin')
ON CONFLICT DO NOTHING;

-- -------------------------------------------------------------------------------------
-- 3) مدير المخزن = مجموعة اتحاد صلاحيات الأدوار في مخزنه (بلا صلاحيات إدارة النظام)
-- -------------------------------------------------------------------------------------
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT DISTINCT mgr_role.id, p.id
  FROM public.user_warehouses mw
  JOIN public.roles mgr_role ON mgr_role.id = mw.role_id
  JOIN public.user_warehouses m2 ON m2.warehouse_id = mw.warehouse_id
  JOIN public.role_permissions rp2 ON rp2.role_id = m2.role_id
  JOIN public.permissions p ON p.id = rp2.permission_id
 WHERE lower(btrim(mgr_role.name)) = 'warehouse manager'
   AND mgr_role.deleted_at IS NULL
   AND coalesce(p.category, '') NOT IN ('users','roles')
   AND p.name NOT LIKE 'settings.%'
   AND p.name NOT LIKE 'audit.%'
ON CONFLICT DO NOTHING;

-- -------------------------------------------------------------------------------------
-- 4) التحقق: كل دور مشاهد داخل مخزن يجب أن تكون صلاحياته محتواة في صلاحيات المدير
-- -------------------------------------------------------------------------------------
DO $verify$
DECLARE
  v_extra text;
BEGIN
  SELECT string_agg(DISTINCT p.name, ', ') INTO v_extra
    FROM public.user_warehouses mw
    JOIN public.roles mgr_role ON mgr_role.id = mw.role_id AND lower(btrim(mgr_role.name)) = 'warehouse manager'
    JOIN public.user_warehouses m2 ON m2.warehouse_id = mw.warehouse_id AND m2.role_id <> mw.role_id
    JOIN public.role_permissions rp2 ON rp2.role_id = m2.role_id
    JOIN public.permissions p ON p.id = rp2.permission_id
   WHERE coalesce(p.category,'') NOT IN ('users','roles')
     AND p.name NOT LIKE 'settings.%'
     AND p.name NOT LIKE 'audit.%'
     AND NOT EXISTS (
       SELECT 1 FROM public.role_permissions mr
        JOIN public.permissions mp ON mp.id = mr.permission_id
        WHERE mr.role_id = mgr_role.id AND mp.name = p.name
     );
  IF v_extra IS NOT NULL THEN
    RAISE NOTICE 'صلاحيات غير محتواة في دور المدير: %', v_extra;
  ELSE
    RAISE NOTICE 'كل صلاحيات أدوار المخازن محتواة في دور المدير';
  END IF;
END
$verify$;
