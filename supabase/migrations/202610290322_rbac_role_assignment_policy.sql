-- سياسة تعيين الدور
CREATE POLICY role_assignment ON rbac_members
FOR INSERT WITH CHECK (auth.uid() = user_id);