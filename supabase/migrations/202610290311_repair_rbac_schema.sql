-- Repair RBAC schema
ALTER TABLE rbac_roles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;