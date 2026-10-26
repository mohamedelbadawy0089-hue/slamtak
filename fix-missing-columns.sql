-- ============================================
-- إصلاح: إضافة الأعمدة المفقودة للجداول الموجودة
-- شغل هذا الملف أولاً ثم الشامل
-- ============================================

-- إضافة أعمدة مفقودة في جدول products
ALTER TABLE IF EXISTS products 
    ADD COLUMN IF NOT EXISTS product_name TEXT,
    ADD COLUMN IF NOT EXISTS prod_date DATE,
    ADD COLUMN IF NOT EXISTS exp_date DATE,
    ADD COLUMN IF NOT EXISTS unlimited BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS is_unlimited BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS low_stock_alert INTEGER DEFAULT 10,
    ADD COLUMN IF NOT EXISTS min_stock INTEGER DEFAULT 10,
    ADD COLUMN IF NOT EXISTS added_date TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- إضافة أعمدة مفقودة في جدول orders
ALTER TABLE IF EXISTS orders 
    ADD COLUMN IF NOT EXISTS order_num TEXT,
    ADD COLUMN IF NOT EXISTS order_status TEXT DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS pharmacy TEXT,
    ADD COLUMN IF NOT EXISTS total DECIMAL(10,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS user_id TEXT;

-- إضافة أعمدة مفقودة في جدول warehouses (جميع الأعمدة)
-- ملاحظة: الأعمدة الأساسية هي warehouse_name و phone_number
ALTER TABLE IF EXISTS warehouses 
    ADD COLUMN IF NOT EXISTS warehouse_name TEXT DEFAULT 'المخزن الرئيسي',
    ADD COLUMN IF NOT EXISTS phone_number TEXT,
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS address TEXT,
    ADD COLUMN IF NOT EXISTS gps_location JSONB,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- إضافة أعمدة مفقودة في جدول delivery_personnel
ALTER TABLE IF EXISTS delivery_personnel 
    ADD COLUMN IF NOT EXISTS warehouse_id UUID,
    ADD COLUMN IF NOT EXISTS current_orders_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_delivered INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- إضافة أعمدة مفقودة في جدول sales
ALTER TABLE IF EXISTS sales 
    ADD COLUMN IF NOT EXISTS warehouse_id TEXT,
    ADD COLUMN IF NOT EXISTS user_id TEXT;

-- إضافة أعمدة مفقودة في جدول order_status_history
ALTER TABLE IF EXISTS order_status_history 
    ADD COLUMN IF NOT EXISTS changed_by UUID,
    ADD COLUMN IF NOT EXISTS notes TEXT;

-- إضافة أعمدة مفقودة في جدول delivery_tracking
ALTER TABLE IF EXISTS delivery_tracking 
    ADD COLUMN IF NOT EXISTS delivery_person_id UUID,
    ADD COLUMN IF NOT EXISTS location JSONB,
    ADD COLUMN IF NOT EXISTS notes TEXT;

-- إضافة أعمدة مفقودة في جدول settings
ALTER TABLE IF EXISTS settings 
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- التأكد من وجود جدول warehouses ثم إدخال المخزن الافتراضي
DO $$
BEGIN
    -- إنشاء الجدول إذا لم يكن موجوداً (مع الأعمدة الصحيحة)
    CREATE TABLE IF NOT EXISTS warehouses (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        warehouse_name TEXT NOT NULL DEFAULT 'المخزن الرئيسي',
        phone_number TEXT,
        email TEXT,
        address TEXT,
        gps_location JSONB,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    
    -- إدخال المخزن الافتراضي (بـ UUID صالح)
    INSERT INTO warehouses (id, warehouse_name, phone_number, email, address, is_active)
    VALUES ('550e8400-e29b-41d4-a716-446655440000', 'المخزن الرئيسي', '01234567890', 'warehouse@slamtak.com', 'القاهرة، مصر', true)
    ON CONFLICT (id) DO NOTHING;
END $$;

SELECT 'تم إضافة الأعمدة المفقودة بنجاح!' as result;
