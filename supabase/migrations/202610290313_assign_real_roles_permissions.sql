-- Assign real roles permissions
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p WHERE r.role_name = p.permission_name;