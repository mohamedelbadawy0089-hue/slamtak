-- نظام العزل الكامل (Multi-tenancy) لجدول delivery
-- يضمن عدم تداخل بيانات المخازن المختلفة

-- 1. تفعيل RLS على الجدول
ALTER TABLE delivery ENABLE ROW LEVEL SECURITY;

-- 2. إلغاء أي سياسات قديمة
DROP POLICY IF EXISTS "delivery_select_policy" ON delivery;
DROP POLICY IF EXISTS "delivery_insert_policy" ON delivery;
DROP POLICY IF EXISTS "delivery_update_policy" ON delivery;
DROP POLICY IF EXISTS "delivery_delete_policy" ON delivery;
DROP POLICY IF EXISTS "Users can view their delivery" ON delivery;
DROP POLICY IF EXISTS "Users can insert their delivery" ON delivery;
DROP POLICY IF EXISTS "Users can update their delivery" ON delivery;
DROP POLICY IF EXISTS "Users can delete their delivery" ON delivery;
DROP POLICY IF EXISTS "Users can manage their delivery" ON delivery;

-- 3. سياسة العرض (Select Policy)
-- كل مخزن يرى فقط موظفي التحضير الذين أضافهم
CREATE POLICY "delivery_select_policy" ON delivery
    FOR SELECT
    USING (user_id = auth.uid());

-- 4. سياسة الإضافة (Insert Policy) 
-- كل مخزن يضيف فقط لحسابه مع التحقق التلقائي من user_id
CREATE POLICY "delivery_insert_policy" ON delivery
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- 5. سياسة التعديل (Update Policy)
-- كل مخزن يعدل فقط بياناته الخاصة
CREATE POLICY "delivery_update_policy" ON delivery
    FOR UPDATE
    USING (user_id = auth.uid());

-- 6. سياسة الحذف (Delete Policy)
-- كل مخزن يحذف فقط بياناته الخاصة
CREATE POLICY "delivery_delete_policy" ON delivery
    FOR DELETE
    USING (user_id = auth.uid());

-- 7. إجبار أن user_id يكون UUID (مطابق لـ auth.uid())
ALTER TABLE delivery 
    ALTER COLUMN user_id TYPE UUID,
    ALTER COLUMN user_id SET NOT NULL;

-- 8. إضافة تعليق توضيحي للجدول
COMMENT ON TABLE delivery IS 'جدول رجال الدليفري مع عزل كامل (Multi-tenancy) - كل مخزن يرى ويتحكم فقط في بياناته';

-- 9. إنشاء عمود preparer_number إذا لم يكن موجوداً
ALTER TABLE delivery 
    ADD COLUMN IF NOT EXISTS preparer_number TEXT;

COMMENT ON COLUMN delivery.preparer_number IS 'رقم تليفون موظف التحضير - محمي ضمن سياسات RLS';

-- 10. إنشاء فهرس للبحث السريع حسب user_id
CREATE INDEX IF NOT EXISTS idx_delivery_user_id ON delivery(user_id);

SELECT '✅ تم تفعيل نظام العزل الكامل (Multi-tenancy) بنجاح!' AS status;
