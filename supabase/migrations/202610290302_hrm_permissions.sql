-- HR permissions
CREATE TABLE IF NOT EXISTS hrm_permissions (
  id SERIAL PRIMARY KEY,
  permission_name TEXT UNIQUE
);