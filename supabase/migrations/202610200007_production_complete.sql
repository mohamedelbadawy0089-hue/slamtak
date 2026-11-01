-- Production complete
CREATE TABLE IF NOT EXISTS production_orders (
  id SERIAL PRIMARY KEY,
  product_id INTEGER,
  quantity INTEGER,
  status TEXT DEFAULT 'pending'
);