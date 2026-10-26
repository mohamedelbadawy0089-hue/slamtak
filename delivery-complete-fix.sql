-- ============================================
-- حل شامل: حذف جميع السياسات → تعديل العمود → إعادة السياسات
-- ============================================

-- الخطوة 1: تعطيل RLS مؤقتاً
ALTER TABLE IF EXISTS delivery DISABLE ROW LEVEL SECURITY;

-- الخطوة 2: حذف جميع السياسات (حتى الجديدة والقديمة)
DROP POLICY IF EXISTS "delivery_select_policy" ON delivery;
DROP POLICY IF EXISTS "delivery_insert_policy" ON delivery;
DROP POLICY IF EXISTS "delivery_update_policy" ON delivery;
DROP POLICY IF EXISTS "delivery_delete_policy" ON delivery;
DROP POLICY IF EXISTS "delivery_secure_insert" ON delivery;
DROP POLICY IF EXISTS "Users can view their delivery" ON delivery;
DROP POLICY IF EXISTS "Users can insert their delivery" ON delivery;
DROP POLICY IF EXISTS "Users can update their delivery" ON delivery;
DROP POLICY IF EXISTS "Users can delete their delivery" ON delivery;
DROP POLICY IF EXISTS "Users can manage their delivery" ON delivery;

-- الخطوة 3: تعديل نوع العمود (بعد حذف جميع السياسات)
ALTER TABLE delivery 
    ALTER COLUMN user_id DROP NOT NULL,
    ALTER COLUMN user_id TYPE UUID USING user_id::UUID,
    ALTER COLUMN user_id SET NOT NULL;

-- الخطوة 4: إضافة عمود preparer_number
ALTER TABLE delivery 
    ADD COLUMN IF NOT EXISTS preparer_number TEXT;

-- الخطوة 5: إنشاء فهرس
CREATE INDEX IF NOT EXISTS idx_delivery_user_id ON delivery(user_id);

-- الخطوة 6: تفعيل RLS
ALTER TABLE delivery ENABLE ROW LEVEL SECURITY;

-- الخطوة 7: إنشاء سياسات RLS الجديدة
CREATE POLICY "delivery_select_policy" ON delivery
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "delivery_insert_policy" ON delivery
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "delivery_update_policy" ON delivery
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "delivery_delete_policy" ON delivery
    FOR DELETE USING (user_id = auth.uid());

SELECT '✅ تم إصلاح الجدول بنجاح!' AS status;
