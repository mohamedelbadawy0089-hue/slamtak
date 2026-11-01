-- Egyptian tax engine
CREATE TABLE IF NOT EXISTS tax_rates (
  id SERIAL PRIMARY KEY,
  tax_name TEXT,
  tax_rate NUMERIC(5,2),
  effective_date DATE
);