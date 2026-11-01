-- Sales system
CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER,
  sale_date DATE DEFAULT CURRENT_DATE,
  total_amount NUMERIC(10,2)
);