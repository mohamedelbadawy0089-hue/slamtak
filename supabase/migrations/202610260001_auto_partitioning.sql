-- Auto partitioning
CREATE TABLE IF NOT EXISTS partitioned_sales (
  id SERIAL,
  sale_date DATE,
  amount NUMERIC(10,2)
) PARTITION BY RANGE (sale_date);