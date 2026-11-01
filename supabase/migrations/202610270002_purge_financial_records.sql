-- Purge financial records
CREATE OR REPLACE FUNCTION purge_financial_records()
RETURNS void AS $$
BEGIN
  DELETE FROM financial_records WHERE created_at < NOW() - INTERVAL '1 year';
END;
$$ LANGUAGE plpgsql;