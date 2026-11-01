-- إصلاح تعيين العضو
UPDATE rbac_members SET status = 'active' WHERE status IS NULL;