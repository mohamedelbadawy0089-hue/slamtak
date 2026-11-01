-- Part 2: Sales functions
CREATE OR REPLACE FUNCTION calculate_sale_total(sale_id INTEGER)
RETURNS NUMERIC AS $$
DECLARE
  total NUMERIC := 0;
BEGIN
  SELECT SUM(price * quantity) INTO total FROM sales_items WHERE sale_id = $1;
  RETURN total;
END;
$$ LANGUAGE plpgsql;