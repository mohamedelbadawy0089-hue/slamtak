-- GL trigger for sales
CREATE OR REPLACE FUNCTION gl_trigger_sales()
RETURNS TRIGGER AS $$
BEGIN
  -- GL entry creation
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;