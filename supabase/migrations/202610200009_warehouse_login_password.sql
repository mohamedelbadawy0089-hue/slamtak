-- Warehouse login password
CREATE TABLE IF NOT EXISTS warehouse_credentials (
  id SERIAL PRIMARY KEY,
  warehouse_id INTEGER,
  username TEXT UNIQUE,
  password_hash TEXT
);