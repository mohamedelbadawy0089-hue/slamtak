-- =====================================================
-- إصلاح: إضافة عمود admin_key المفقود
-- =====================================================

-- 1. التحقق من وجود العمود وإضافته إذا لم يكن موجوداً
DO $$
BEGIN
    -- التحقق من وجود عمود admin_key
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'warehouses' 
        AND column_name = 'admin_key'
    ) THEN
        -- إضافة العمود إذا لم يكن موجوداً
        ALTER TABLE warehouses ADD COLUMN admin_key TEXT;
        
        -- تحديث القيم الموجودة بقيمة افتراضية
        UPDATE warehouses SET admin_key = 'default_admin_key' WHERE admin_key IS NULL;
        
        -- جعل العمود NOT NULL بعد التحديث
        ALTER TABLE warehouses ALTER COLUMN admin_key SET NOT NULL;
        
        RAISE NOTICE '✅ تم إضافة عمود admin_key بنجاح!';
    ELSE
        RAISE NOTICE '⚠️ عمود admin_key موجود بالفعل.';
    END IF;
END $$;

-- 2. التأكد من وجود جميع الأعمدة المطلوبة
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'warehouses' 
ORDER BY ordinal_position;

-- 3. رسالة نجاح
SELECT '✅ تم التحقق من جدول warehouses وإصلاح الأعمدة المفقودة!' as status;
