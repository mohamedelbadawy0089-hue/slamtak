-- Link HR permissions
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id UUID REFERENCES auth.users(id),
  permission_id INTEGER REFERENCES hrm_permissions(id)
);