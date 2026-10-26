-- ============================================
-- جدول رقم موظف التحضير (Preparation Phone)
-- كل مخزن له رقم واحد فقط
-- ============================================

-- إنشاء الجدول
CREATE TABLE IF NOT EXISTS preparation_phone (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    phone TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- تعليق على الجدول
COMMENT ON TABLE preparation_phone IS 'جدول تخزين رقم موظف التحضير - كل مخزن له رقم واحد فقط';

-- إنشاء فهرس
CREATE INDEX IF NOT EXISTS idx_preparation_phone_user_id ON preparation_phone(user_id);

-- تفعيل RLS
ALTER TABLE preparation_phone ENABLE ROW LEVEL SECURITY;

-- حذف السياسات القديمة إن وجدت
DROP POLICY IF EXISTS "preparation_phone_select" ON preparation_phone;
DROP POLICY IF EXISTS "preparation_phone_insert" ON preparation_phone;
DROP POLICY IF EXISTS "preparation_phone_update" ON preparation_phone;
DROP POLICY IF EXISTS "preparation_phone_delete" ON preparation_phone;

-- سياسة العرض: كل مخزن يرى فقط رقمه
CREATE POLICY "preparation_phone_select" ON preparation_phone
    FOR SELECT USING (user_id = auth.uid());

-- سياسة الإضافة: إضافة فقط لنفس المستخدم
CREATE POLICY "preparation_phone_insert" ON preparation_phone
    FOR INSERT WITH CHECK (user_id = auth.uid());

-- سياسة التعديل: تعديل فقط الرقم الخاص
CREATE POLICY "preparation_phone_update" ON preparation_phone
    FOR UPDATE USING (user_id = auth.uid());

-- سياسة الحذف: حذف فقط الرقم الخاص
CREATE POLICY "preparation_phone_delete" ON preparation_phone
    FOR DELETE USING (user_id = auth.uid());

SELECT '✅ تم إنشاء جدول preparation_phone بنجاح!' AS status;
