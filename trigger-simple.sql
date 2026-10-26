-- =====================================================
-- Trigger بسيط لتعيين user_id تلقائياً
-- =====================================================

-- 1. إنشاء دالة بسيطة
CREATE OR REPLACE FUNCTION set_product_user_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $func$
BEGIN
    NEW.user_id := auth.uid();
    RETURN NEW;
END;
$func$;

-- 2. تفعيل الـ Trigger
DROP TRIGGER IF EXISTS set_product_user_id_trigger ON products;

CREATE TRIGGER set_product_user_id_trigger
    BEFORE INSERT OR UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION set_product_user_id();

-- 3. التحقق
SELECT '✅ Trigger تم إنشاؤه بنجاح!' as status;
