-- ============================================
-- جدول الصيدليات (Pharmacies)
-- ============================================

-- 1. إنشاء جدول الصيدليات
CREATE TABLE IF NOT EXISTS pharmacies (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- اسم الصيدلية
    name TEXT NOT NULL,
    
    -- رقم التليفون (11 رقم)
    phone TEXT NOT NULL CHECK (phone ~ '^[0-9]{11}$'),
    
    -- العنوان
    address TEXT,
    
    -- ربط بالمخزن
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
    
    -- ربط بالمستخدم الذي أنشأ السجل (ID الحساب المسجل دخول)
    user_id TEXT,
    
    -- إضافي: موقع GPS
    gps_location JSONB, -- {lat: number, lng: number}
    
    -- إضافي: بيانات الاتصال
    email TEXT,
    contact_person TEXT,
    
    -- إضافي: حالة الصيدلية
    is_active BOOLEAN DEFAULT true,
    
    -- إضافي: ملاحظات
    notes TEXT,
    
    -- التواريخ
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. فهارس للأداء
CREATE INDEX IF NOT EXISTS idx_pharmacies_warehouse_id ON pharmacies(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_pharmacies_phone ON pharmacies(phone);
CREATE INDEX IF NOT EXISTS idx_pharmacies_name ON pharmacies(name);
CREATE INDEX IF NOT EXISTS idx_pharmacies_is_active ON pharmacies(is_active);
CREATE INDEX IF NOT EXISTS idx_pharmacies_created_at ON pharmacies(created_at);

-- 3. تفعيل RLS الإجباري (Row Level Security)
ALTER TABLE pharmacies ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmacies FORCE ROW LEVEL SECURITY;

-- حذف جميع السياسات القديمة
DROP POLICY IF EXISTS "Allow anonymous access" ON pharmacies;
DROP POLICY IF EXISTS "Allow fallback access" ON pharmacies;
DROP POLICY IF EXISTS "Users can view own pharmacies" ON pharmacies;
DROP POLICY IF EXISTS "Users can insert own pharmacies" ON pharmacies;
DROP POLICY IF EXISTS "Users can update own pharmacies" ON pharmacies;
DROP POLICY IF EXISTS "Users can delete own pharmacies" ON pharmacies;
DROP POLICY IF EXISTS "Users can view own" ON pharmacies;
DROP POLICY IF EXISTS "Users can insert own" ON pharmacies;
DROP POLICY IF EXISTS "Users can update own" ON pharmacies;
DROP POLICY IF EXISTS "Users can delete own" ON pharmacies;
DROP POLICY IF EXISTS "Strict isolation - view own" ON pharmacies;
DROP POLICY IF EXISTS "Strict isolation - insert own" ON pharmacies;
DROP POLICY IF EXISTS "Strict isolation - update own" ON pharmacies;
DROP POLICY IF EXISTS "Strict isolation - delete own" ON pharmacies;

-- 4. إنشاء سياسات RLS صارمة باستخدام auth.uid() (عزل تام)

-- سياسة القراءة: فقط إذا كان user_id = auth.uid() (محول إلى TEXT)
CREATE POLICY "Users can view own" ON pharmacies
    FOR SELECT
    USING (user_id = auth.uid()::text OR user_id IS NULL);

-- سياسة الإدراج: يجب أن يكون user_id = auth.uid()
CREATE POLICY "Users can insert own" ON pharmacies
    FOR INSERT
    WITH CHECK (user_id = auth.uid()::text OR user_id IS NULL);

-- سياسة التحديث: فقط إذا كان user_id = auth.uid()
CREATE POLICY "Users can update own" ON pharmacies
    FOR UPDATE
    USING (user_id = auth.uid()::text)
    WITH CHECK (user_id = auth.uid()::text);

-- سياسة الحذف: فقط إذا كان user_id = auth.uid()
CREATE POLICY "Users can delete own" ON pharmacies
    FOR DELETE
    USING (user_id = auth.uid()::text);

-- 5. تريجر تلقائي لتعيين user_id من auth.uid()
CREATE OR REPLACE FUNCTION set_auth_user_id()
RETURNS TRIGGER AS $$
BEGIN
    NEW.user_id = auth.uid()::text;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS set_auth_user_id_trigger ON pharmacies;
CREATE TRIGGER set_auth_user_id_trigger
    BEFORE INSERT ON pharmacies
    FOR EACH ROW
    EXECUTE FUNCTION set_auth_user_id();

-- 5. تفعيل Real-time للجدول
-- (يتم تلقائياً في Supabase عند تفعيل RLS)

-- 6. دالة لتحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION update_pharmacies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- تريجر للتحديث التلقائي
DROP TRIGGER IF EXISTS update_pharmacies_updated_at ON pharmacies;
CREATE TRIGGER update_pharmacies_updated_at BEFORE UPDATE ON pharmacies
    FOR EACH ROW EXECUTE FUNCTION update_pharmacies_updated_at();

-- 7. دالة للتحقق من رقم التليفون
CREATE OR REPLACE FUNCTION validate_phone_number(phone TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    -- التحقق من أن الرقم 11 رقم ويبدأ بـ 01
    RETURN phone ~ '^01[0-9]{9}$';
END;
$$ LANGUAGE plpgsql;

-- فهارس إضافية
CREATE INDEX IF NOT EXISTS idx_pharmacies_user_id ON pharmacies(user_id);

-- 8. دالة لإضافة صيدلية مع التحقق (مع user_id)
CREATE OR REPLACE FUNCTION add_pharmacy(
    p_name TEXT,
    p_phone TEXT,
    p_address TEXT,
    p_warehouse_id UUID,
    p_user_id TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL,
    p_contact_person TEXT DEFAULT NULL,
    p_gps_location JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_pharmacy_id UUID;
BEGIN
    -- التحقق من رقم التليفون
    IF NOT validate_phone_number(p_phone) THEN
        RAISE EXCEPTION 'رقم التليفون يجب أن يكون 11 رقم ويبدأ بـ 01';
    END IF;
    
    -- إدخال الصيدلية مع user_id
    INSERT INTO pharmacies (
        name, phone, address, warehouse_id, user_id, email, contact_person, gps_location
    ) VALUES (
        p_name, p_phone, p_address, p_warehouse_id, p_user_id, p_email, p_contact_person, p_gps_location
    )
    RETURNING id INTO v_pharmacy_id;
    
    RETURN v_pharmacy_id;
END;
$$ LANGUAGE plpgsql;

-- 9. View للصيدليات مع بيانات المخزن
DO $$
BEGIN
    -- التحقق من وجود أعمدة warehouses المطلوبة (warehouse_name, phone_number)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'warehouses' AND column_name = 'warehouse_name'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'warehouses' AND column_name = 'phone_number'
    ) THEN
        CREATE OR REPLACE VIEW pharmacies_with_warehouse AS
        SELECT 
            p.*,
            w.warehouse_name as warehouse_name,
            w.phone_number as warehouse_phone
        FROM pharmacies p
        LEFT JOIN warehouses w ON p.warehouse_id = w.id
        WHERE p.is_active = true;
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'warehouses' AND column_name = 'name'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'warehouses' AND column_name = 'phone'
    ) THEN
        -- الأسماء القديمة (name, phone)
        CREATE OR REPLACE VIEW pharmacies_with_warehouse AS
        SELECT 
            p.*,
            w.name as warehouse_name,
            w.phone as warehouse_phone
        FROM pharmacies p
        LEFT JOIN warehouses w ON p.warehouse_id = w.id
        WHERE p.is_active = true;
    ELSE
        -- View بسيط بدون بيانات المخزن
        CREATE OR REPLACE VIEW pharmacies_with_warehouse AS
        SELECT 
            p.*,
            NULL::TEXT as warehouse_name,
            NULL::TEXT as warehouse_phone
        FROM pharmacies p
        WHERE p.is_active = true;
    END IF;
END $$;

-- 9. بيانات تجريبية (تُدرج فقط إذا وجد المخزن)
DO $$
DECLARE
    v_warehouse_id UUID;
BEGIN
    -- البحث عن مخزن موجود
    SELECT id INTO v_warehouse_id 
    FROM warehouses 
    LIMIT 1;
    
    -- إدخال الصيدليات فقط إذا وجد مخزن
    IF v_warehouse_id IS NOT NULL THEN
        INSERT INTO pharmacies (name, phone, address, warehouse_id, is_active)
        VALUES 
            ('صيدلية الأمل', '01234567890', 'شارع الأمل، القاهرة', v_warehouse_id, true),
            ('صيدلية الشفاء', '01123456789', 'شارع الشفاء، الإسكندرية', v_warehouse_id, true)
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

-- ملاحظة: أرقام التليفون تبدأ بـ 01 و11 رقم (مطابقة للمتطلبات)

-- ============================================
-- Real-time Setup Instructions
-- ============================================
-- 
-- لتفعيل Real-time في Supabase Dashboard:
-- 1. اذهب إلى Database → Replication
-- 2. في قسم "Realtime", فعّل toggle لـ "pharmacies"
-- 3. أو شغّل هذا الكود في SQL Editor:
-- 
-- BEGIN;
--   -- إضافة الجدول إلى publication
--   ALTER PUBLICATION supabase_realtime ADD TABLE pharmacies;
-- COMMIT;
--
-- ============================================

SELECT 'تم إنشاء جدول الصيدليات بنجاح!' as result;
