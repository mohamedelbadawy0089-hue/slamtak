-- Phase 1: Receiving inventory
CREATE TABLE IF NOT EXISTS receiving_orders (
  id SERIAL PRIMARY KEY,
  order_number TEXT UNIQUE,
  received_date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'pending'
);