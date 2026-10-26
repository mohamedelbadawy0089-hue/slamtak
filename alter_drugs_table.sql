-- إضافة الأعمدة المفقودة إلى جدول drugs
-- هذا الملف يقوم بإضافة الأعمدة المفقودة إلى الجدول الموجود

-- إضافة عمود batch_number إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'drugs' 
        AND column_name = 'batch_number'
    ) THEN
        ALTER TABLE drugs ADD COLUMN batch_number VARCHAR(255);
        RAISE NOTICE 'Added batch_number column to drugs table';
    ELSE
        RAISE NOTICE 'batch_number column already exists in drugs table';
    END IF;
END $$;

-- إضافة عمود trade_name إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'drugs' 
        AND column_name = 'trade_name'
    ) THEN
        ALTER TABLE drugs ADD COLUMN trade_name VARCHAR(255);
        RAISE NOTICE 'Added trade_name column to drugs table';
    ELSE
        RAISE NOTICE 'trade_name column already exists in drugs table';
    END IF;
END $$;

-- إضافة عمود public_price إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'drugs' 
        AND column_name = 'public_price'
    ) THEN
        ALTER TABLE drugs ADD COLUMN public_price DECIMAL(10, 2);
        RAISE NOTICE 'Added public_price column to drugs table';
    ELSE
        RAISE NOTICE 'public_price column already exists in drugs table';
    END IF;
END $$;

-- إضافة عمود net_price إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'drugs' 
        AND column_name = 'net_price'
    ) THEN
        ALTER TABLE drugs ADD COLUMN net_price DECIMAL(10, 2);
        RAISE NOTICE 'Added net_price column to drugs table';
    ELSE
        RAISE NOTICE 'net_price column already exists in drugs table';
    END IF;
END $$;

-- إضافة عمود production_date إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'drugs' 
        AND column_name = 'production_date'
    ) THEN
        ALTER TABLE drugs ADD COLUMN production_date DATE;
        RAISE NOTICE 'Added production_date column to drugs table';
    ELSE
        RAISE NOTICE 'production_date column already exists in drugs table';
    END IF;
END $$;

-- إضافة عمود expiry_date إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'drugs' 
        AND column_name = 'expiry_date'
    ) THEN
        ALTER TABLE drugs ADD COLUMN expiry_date DATE;
        RAISE NOTICE 'Added expiry_date column to drugs table';
    ELSE
        RAISE NOTICE 'expiry_date column already exists in drugs table';
    END IF;
END $$;

-- إضافة عمود quantity إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'drugs' 
        AND column_name = 'quantity'
    ) THEN
        ALTER TABLE drugs ADD COLUMN quantity INTEGER DEFAULT 0;
        RAISE NOTICE 'Added quantity column to drugs table';
    ELSE
        RAISE NOTICE 'quantity column already exists in drugs table';
    END IF;
END $$;

-- إضافة عمود purchase_discount إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'drugs' 
        AND column_name = 'purchase_discount'
    ) THEN
        ALTER TABLE drugs ADD COLUMN purchase_discount DECIMAL(5, 2) DEFAULT 0;
        RAISE NOTICE 'Added purchase_discount column to drugs table';
    ELSE
        RAISE NOTICE 'purchase_discount column already exists in drugs table';
    END IF;
END $$;

-- إضافة عمود sales_discount إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'drugs' 
        AND column_name = 'sales_discount'
    ) THEN
        ALTER TABLE drugs ADD COLUMN sales_discount DECIMAL(5, 2) DEFAULT 0;
        RAISE NOTICE 'Added sales_discount column to drugs table';
    ELSE
        RAISE NOTICE 'sales_discount column already exists in drugs table';
    END IF;
END $$;

-- إضافة عمود category إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'drugs' 
        AND column_name = 'category'
    ) THEN
        ALTER TABLE drugs ADD COLUMN category VARCHAR(255);
        RAISE NOTICE 'Added category column to drugs table';
    ELSE
        RAISE NOTICE 'category column already exists in drugs table';
    END IF;
END $$;

-- إضافة عمود updated_at إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'drugs' 
        AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE drugs ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        RAISE NOTICE 'Added updated_at column to drugs table';
    ELSE
        RAISE NOTICE 'updated_at column already exists in drugs table';
    END IF;
END $$;

-- إنشاء Indexes إذا لم تكن موجودة
CREATE INDEX IF NOT EXISTS idx_drugs_warehouse_id ON drugs(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_drugs_batch_number ON drugs(batch_number);
CREATE INDEX IF NOT EXISTS idx_drugs_trade_name ON drugs(trade_name);
CREATE INDEX IF NOT EXISTS idx_drugs_expiry_date ON drugs(expiry_date);

-- إنشاء Trigger لتحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION update_drugs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_drugs_updated_at_trigger ON drugs;
CREATE TRIGGER update_drugs_updated_at_trigger
BEFORE UPDATE ON drugs
FOR EACH ROW
EXECUTE FUNCTION update_drugs_updated_at();

-- Grant permissions
GRANT ALL ON drugs TO authenticated;
GRANT ALL ON drugs TO anon;
GRANT ALL ON drugs TO service_role;
