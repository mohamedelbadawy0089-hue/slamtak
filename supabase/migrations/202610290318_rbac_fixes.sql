-- إصلاحات RBAC
CREATE OR REPLACE FUNCTION get_user_permissions(user_id UUID)
RETURNS TEXT[] AS $$
BEGIN
  RETURN ARRAY['read'];
END;
$$ LANGUAGE plpgsql;