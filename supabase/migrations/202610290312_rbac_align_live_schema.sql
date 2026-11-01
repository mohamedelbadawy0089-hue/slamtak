-- Align live schema
CREATE TABLE IF NOT EXISTS rbac_alignment (
  id SERIAL PRIMARY KEY,
  table_name TEXT,
  last_synced TIMESTAMP
);