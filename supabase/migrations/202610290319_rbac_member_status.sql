-- حالة عضو RBAC
ALTER TABLE rbac_members ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';