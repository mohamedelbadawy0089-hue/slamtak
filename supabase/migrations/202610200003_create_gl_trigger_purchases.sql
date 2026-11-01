-- GL trigger for purchases
CREATE OR REPLACE FUNCTION gl_trigger_purchases()
RETURNS TRIGGER AS $$
BEGIN
  -- GL entry creation
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;