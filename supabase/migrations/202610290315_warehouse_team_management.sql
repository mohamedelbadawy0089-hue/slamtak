-- إدارة فريق المخزن
CREATE TABLE IF NOT EXISTS warehouse_team (
  id SERIAL PRIMARY KEY,
  warehouse_id INTEGER REFERENCES independent_warehouses(id),
  user_id UUID REFERENCES auth.users(id),
  role TEXT DEFAULT 'member',
  joined_at TIMESTAMP DEFAULT NOW()
);