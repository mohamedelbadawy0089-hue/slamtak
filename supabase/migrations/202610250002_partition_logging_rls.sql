-- Partition logging RLS
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  action TEXT,
  table_name TEXT,
  record_id INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);