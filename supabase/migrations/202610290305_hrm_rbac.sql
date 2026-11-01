-- HR RBAC
CREATE TABLE IF NOT EXISTS hrm_rbac (
  id SERIAL PRIMARY KEY,
  role_name TEXT,
  permissions JSONB
);