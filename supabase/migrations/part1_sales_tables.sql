-- Part 1: Sales tables
CREATE TABLE IF NOT EXISTS sales_items (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER REFERENCES sales(id),
  product_name TEXT,
  quantity INTEGER,
  price NUMERIC(10,2)
);