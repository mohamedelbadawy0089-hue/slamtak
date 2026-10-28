-- =====================================================================================
-- 202610290331_rbac_manager_settings_scope.sql
-- إصلاح كشفه اختبار منع التصعيد: مدير المخزن كان يملك settings.manage (منحتُها في
-- ترقية سابقة)، فأصبح قادرًا على منح إدارة إعدادات النظام لغيره — وهو تصعيد إداري
-- خارج نطاقه. إعدادات النظام تبقى لمالك النظام/مدير المؤسسة.
--
-- كما أن settings.update لم يعد فرضًا مستقلًا: الكتابة على جدول settings تتطلب
-- settings.manage، فتعليمه «مطبق» كان مضلّلًا.
-- آمن للتشغيل المتكرر.
-- =====================================================================================

DELETE FROM public.role_permissions rp
USING public.roles r, public.permissions p
 WHERE rp.role_id = r.id
   AND rp.permission_id = p.id
   AND lower(btrim(r.name)) IN ('warehouse manager', 'manager')
   AND p.name = 'settings.manage';

UPDATE public.permissions SET is_enforced = false WHERE name = 'settings.update';

SELECT
  (SELECT count(*) FROM public.role_permissions rp
     JOIN public.roles r ON r.id = rp.role_id
     JOIN public.permissions p ON p.id = rp.permission_id
    WHERE lower(btrim(r.name)) = 'warehouse manager' AND p.name = 'settings.manage') AS manager_has_settings_manage,
  (SELECT count(*) FROM public.role_permissions rp
     JOIN public.roles r ON r.id = rp.role_id
     JOIN public.permissions p ON p.id = rp.permission_id
    WHERE lower(btrim(r.name)) = 'warehouse manager' AND p.category = 'settings') AS manager_settings_perms,
  (SELECT count(*) FROM public.permissions WHERE is_enforced) AS enforced_perms,
  (SELECT count(*) FROM public.permissions WHERE NOT is_enforced) AS hidden_perms;
