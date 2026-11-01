-- RBAC للمؤسسات
CREATE TABLE IF NOT EXISTS enterprise_roles (
  id SERIAL PRIMARY KEY,
  enterprise_id UUID,
  role_name TEXT,
  permissions JSONB
);