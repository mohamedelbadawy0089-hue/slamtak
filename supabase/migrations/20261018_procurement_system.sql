-- Procurement system
CREATE TABLE IF NOT EXISTS procurement_orders (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER,
  order_date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'pending'
);