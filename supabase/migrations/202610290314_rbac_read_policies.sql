-- RBAC read policies
CREATE POLICY read_own_data ON users
FOR SELECT USING (auth.uid() = id);