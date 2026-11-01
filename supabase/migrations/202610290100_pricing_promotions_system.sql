-- Pricing and promotions
CREATE TABLE IF NOT EXISTS promotions (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE,
  discount_percent NUMERIC(5,2),
  start_date DATE,
  end_date DATE
);