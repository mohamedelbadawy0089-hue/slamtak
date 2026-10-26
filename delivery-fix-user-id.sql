-- ============================================
-- إصلاح نوع عمود user_id في جدول delivery
-- المشكلة: العمود مستخدم في سياسات RLS
-- الحل: حذف السياسات → تعديل العمود → إعادة إنشاء السياسات
-- ============================================

-- 1. حذف جميع السياسات المرتبطة بالجدول أولاً
DROP POLICY IF EXISTS "delivery_select_policy" ON delivery;
DROP POLICY IF EXISTS "delivery_insert_policy" ON delivery;
DROP POLICY IF EXISTS "delivery_update_policy" ON delivery;
DROP POLICY IF EXISTS "delivery_delete_policy" ON delivery;
DROP POLICY IF EXISTS "Users can view their delivery" ON delivery;
DROP POLICY IF EXISTS "Users can insert their delivery" ON delivery;
DROP POLICY IF EXISTS "Users can update their delivery" ON delivery;
DROP POLICY IF EXISTS "Users can delete their delivery" ON delivery;
DROP POLICY IF EXISTS "Users can manage their delivery" ON delivery;

-- 2. تغيير نوع العمود user_id إلى UUID (مطابق لـ auth.uid())
ALTER TABLE delivery 
    ALTER COLUMN user_id TYPE UUID,
    ALTER COLUMN user_id SET NOT NULL;

-- 3. إضافة عمود preparer_number إذا لم يكن موجوداً
ALTER TABLE delivery 
    ADD COLUMN IF NOT EXISTS preparer_number TEXT;

-- 4. إنشاء فهرس للبحث السريع
CREATE INDEX IF NOT EXISTS idx_delivery_user_id ON delivery(user_id);

-- 5. إعادة إنشاء سياسات RLS بعد تعديل العمود

-- سياسة العرض: كل مخزن يرى فقط بياناته
CREATE POLICY "delivery_select_policy" ON delivery
    FOR SELECT
    USING (user_id = auth.uid());

-- سياسة الإضافة: إضافة فقط لحساب المستخدم الحالي
CREATE POLICY "delivery_insert_policy" ON delivery
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- سياسة التعديل: تعديل فقط البيانات الخاصة
CREATE POLICY "delivery_update_policy" ON delivery
    FOR UPDATE
    USING (user_id = auth.uid());

-- سياسة الحذف: حذف فقط البيانات الخاصة
CREATE POLICY "delivery_delete_policy" ON delivery
    FOR DELETE
    USING (user_id = auth.uid());

-- 6. تفعيل RLS (إذا لم يكن مفعلاً)
ALTER TABLE delivery ENABLE ROW LEVEL SECURITY;

-- 7. إجبار السياسات على جميع المستخدمين (包括 المالك)
ALTER TABLE delivery FORCE ROW LEVEL SECURITY;

SELECT '✅ تم إصلاح نوع user_id وإعادة إنشاء سياسات RLS بنجاح!' AS status;
