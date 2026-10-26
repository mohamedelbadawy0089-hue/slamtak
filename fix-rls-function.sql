-- ============================================
-- إصلاح: إنشاء دالة get_current_user_id أولاً
-- ============================================

-- 1. إنشاء الدالة في البداية (public schema)
CREATE OR REPLACE FUNCTION public.get_current_user_id()
RETURNS TEXT AS $$
BEGIN
    -- محاولة جلب user_id من JWT claims
    RETURN COALESCE(
        nullif(current_setting('request.jwt.claims', true)::json->>'sub', ''),
        nullif(current_setting('request.jwt.claims', true)::json->>'user_id', ''),
        NULL
    );
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. التأكد من أن الدالة تعمل
SELECT '✅ دالة get_current_user_id تم إنشاؤها بنجاح' as status;

-- اختبار سريع
SELECT public.get_current_user_id() as current_user_test;
