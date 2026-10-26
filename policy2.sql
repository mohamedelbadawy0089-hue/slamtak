CREATE POLICY "Users can insert their own warehouse" ON warehouses FOR INSERT WITH CHECK (auth.uid()::text = email OR auth.role() = 'service_role');
