-- إصلاحات التطبيق
CREATE POLICY enforce_business ON transactions
FOR INSERT WITH CHECK (auth.uid() = user_id);