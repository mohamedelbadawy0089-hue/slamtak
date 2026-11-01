-- RBAC member permissions filter
CREATE OR REPLACE FUNCTION filter_member_permissions(member_id UUID)
RETURNS TABLE(permission TEXT) AS $$
BEGIN
  RETURN QUERY SELECT permission FROM member_permissions WHERE member_id = member_id;
END;
$$ LANGUAGE plpgsql;