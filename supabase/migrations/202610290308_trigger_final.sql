-- Trigger final
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Handle new user
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;