-- WMS register workspace warehouse code
CREATE TABLE IF NOT EXISTS warehouse_codes (
  id SERIAL PRIMARY KEY,
  warehouse_id INTEGER,
  code TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);