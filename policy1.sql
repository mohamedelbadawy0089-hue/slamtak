CREATE POLICY "Users can view their own warehouse" ON warehouses FOR SELECT USING (auth.uid()::text = email OR auth.role() = 'service_role');
