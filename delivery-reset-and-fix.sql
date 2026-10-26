-- ============================================
-- إصلاح عاجل: حذف سياسات RLS + تعديل العمود
-- الخطوات: حذف السياسات → تعديل العمود → إعادة السياسات
-- ============================================

-- الخطوة 1: تعطيل RLS مؤقتاً (اختياري للتأكد)
ALTER TABLE delivery DISABLE ROW LEVEL SECURITY;

-- الخطوة 2: حذف جميع السياسات (حتى لو غير موجودة)
DO $$
BEGIN
    DROP POLICY IF EXISTS "delivery_select_policy" ON delivery;
    DROP POLICY IF EXISTS "delivery_insert_policy" ON delivery;
    DROP POLICY IF EXISTS "delivery_update_policy" ON delivery;
    DROP POLICY IF EXISTS "delivery_delete_policy" ON delivery;
    DROP POLICY IF EXISTS "Users can view their delivery" ON delivery;
    DROP POLICY IF EXISTS "Users can insert their delivery" ON delivery;
    DROP POLICY IF EXISTS "Users can update their delivery" ON delivery;
    DROP POLICY IF EXISTS "Users can delete their delivery" ON delivery;
    DROP POLICY IF EXISTS "Users can manage their delivery" ON delivery;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Policy drop error: %', SQLERRM;
END $$;

-- الخطوة 3: تغيير نوع user_id إلى UUID
ALTER TABLE delivery 
    ALTER COLUMN user_id DROP NOT NULL,
    ALTER COLUMN user_id TYPE UUID USING user_id::UUID,
    ALTER COLUMN user_id SET NOT NULL;

-- الخطوة 4: إضافة عمود preparer_number
ALTER TABLE delivery 
    ADD COLUMN IF NOT EXISTS preparer_number TEXT;

-- الخطوة 5: إنشاء فهرس
CREATE INDEX IF NOT EXISTS idx_delivery_user_id ON delivery(user_id);

-- الخطوة 6: إعادة تفعيل RLS
ALTER TABLE delivery ENABLE ROW LEVEL SECURITY;

-- الخطوة 7: إنشاء السياسات من جديد
CREATE POLICY "delivery_select_policy" ON delivery
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "delivery_insert_policy" ON delivery
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "delivery_update_policy" ON delivery
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "delivery_delete_policy" ON delivery
    FOR DELETE USING (user_id = auth.uid());

SELECT '✅ تم إصلاح الجدول بنجاح! user_id الآن UUID وRLS نشطة' AS status;
