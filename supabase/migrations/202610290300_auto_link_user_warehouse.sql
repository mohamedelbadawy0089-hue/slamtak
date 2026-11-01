-- Auto link user warehouse
CREATE OR REPLACE FUNCTION auto_link_user_warehouse()
RETURNS TRIGGER AS $$
BEGIN
  -- Link user to warehouse
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;