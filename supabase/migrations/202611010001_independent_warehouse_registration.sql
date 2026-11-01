-- Independent warehouse registration
CREATE TABLE IF NOT EXISTS independent_warehouses (
  id SERIAL PRIMARY KEY,
  owner_id UUID REFERENCES auth.users(id),
  warehouse_name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);