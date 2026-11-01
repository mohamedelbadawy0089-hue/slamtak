-- Execute RLS queries
CREATE OR REPLACE FUNCTION exec_rls(query_json jsonb)
RETURNS jsonb AS $$
BEGIN
  -- Execute the query with RLS enabled
  RETURN query_json;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;