-- إضافة عمود preparer_number لتخزين رقم موظف التحضير

-- 1. إضافة العمود الجديد
ALTER TABLE delivery 
    ADD COLUMN IF NOT EXISTS preparer_number TEXT;

-- 2. إضافة تعليق توضيحي
COMMENT ON COLUMN delivery.preparer_number IS 'رقم تليفون موظف التحضير للتواصل معه';

-- 3. RLS policy محدثة (العمود الجديد محمي تلقائياً)
-- لا تحتاج لتعديل السياسات لأن RLS يحمي الصف كاملاً

SELECT '✅ تم إضافة عمود preparer_number بنجاح!' AS status;
