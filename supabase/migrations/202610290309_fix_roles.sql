-- Fix roles
UPDATE rbac_roles SET is_active = true WHERE role_name = 'user';