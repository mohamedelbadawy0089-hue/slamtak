-- حل المشكلة: مقارنة TEXT مع UUID
-- Option 1: تغيير نوع العمود إلى UUID
DROP TABLE IF EXISTS delivery;

CREATE TABLE delivery (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,  -- تغيير من TEXT إلى UUID
    warehouse_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS Policy (الآن يعمل بشكل صحيح)
ALTER TABLE delivery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their delivery" ON delivery
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert their delivery" ON delivery
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their delivery" ON delivery
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete their delivery" ON delivery
    FOR DELETE USING (user_id = auth.uid());

-- Option 2: إذا أردت الاحتفاظ بـ TEXT (مع تحويل auth.uid() إلى TEXT)
-- استخدم هذا البديل في Policy:
-- CREATE POLICY "Users can manage their delivery" ON delivery
--     FOR ALL USING (user_id = auth.uid()::TEXT);
