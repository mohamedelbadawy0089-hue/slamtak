-- ============================================
-- تعديل عمود user_id (بعد حذف السياسات)
-- ============================================

-- تعديل نوع العمود
ALTER TABLE delivery 
    ALTER COLUMN user_id DROP NOT NULL,
    ALTER COLUMN user_id TYPE UUID USING user_id::UUID,
    ALTER COLUMN user_id SET NOT NULL;

-- إضافة عمود preparer_number
ALTER TABLE delivery 
    ADD COLUMN IF NOT EXISTS preparer_number TEXT;

-- إنشاء فهرس
CREATE INDEX IF NOT EXISTS idx_delivery_user_id ON delivery(user_id);
