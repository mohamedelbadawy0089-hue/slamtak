-- Part 3: Sales policies
CREATE POLICY sales_select ON sales
FOR SELECT USING (auth.uid() = customer_id);