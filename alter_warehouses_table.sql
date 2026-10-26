-- إضافة الأعمدة المفقودة إلى جدول warehouses
-- هذا الملف يقوم بإضافة الأعمدة المفقودة إلى الجدول الموجود

-- إضافة عمود phone إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'warehouses' 
        AND column_name = 'phone'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN phone VARCHAR(255) UNIQUE;
        RAISE NOTICE 'Added phone column to warehouses table';
    ELSE
        RAISE NOTICE 'phone column already exists in warehouses table';
    END IF;
END $$;

-- إضافة عمود governorate إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'warehouses' 
        AND column_name = 'governorate'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN governorate VARCHAR(255);
        RAISE NOTICE 'Added governorate column to warehouses table';
    ELSE
        RAISE NOTICE 'governorate column already exists in warehouses table';
    END IF;
END $$;

-- إضافة عمود password إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'warehouses' 
        AND column_name = 'password'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN password VARCHAR(255);
        RAISE NOTICE 'Added password column to warehouses table';
    ELSE
        RAISE NOTICE 'password column already exists in warehouses table';
    END IF;
END $$;

-- إضافة عمود updated_at إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'warehouses' 
        AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        RAISE NOTICE 'Added updated_at column to warehouses table';
    ELSE
        RAISE NOTICE 'updated_at column already exists in warehouses table';
    END IF;
END $$;

-- إنشاء Indexes إذا لم تكن موجودة
CREATE INDEX IF NOT EXISTS idx_warehouses_email ON warehouses(email);
CREATE INDEX IF NOT EXISTS idx_warehouses_phone ON warehouses(phone);
CREATE INDEX IF NOT EXISTS idx_warehouses_governorate ON warehouses(governorate);

-- إنشاء Trigger لتحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_warehouses_updated_at ON warehouses;
CREATE TRIGGER update_warehouses_updated_at
BEFORE UPDATE ON warehouses
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT ALL ON warehouses TO authenticated;
GRANT ALL ON warehouses TO anon;
GRANT ALL ON warehouses TO service_role;
