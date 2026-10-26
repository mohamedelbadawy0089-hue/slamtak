-- Database Trigger لإنشاء Partition جديد لكل مخزن
-- هذا الـ Trigger يقوم تلقائياً بإنشاء Partition جديد في جدول drugs عند تسجيل مخزن جديد

-- أولاً، تأكد من أن جدول drugs موجود ويدعم Partitioning
-- إذا لم يكن موجوداً، قم بإنشائه أولاً

-- إنشاء جدول drugs مع Partitioning حسب warehouse_id
CREATE TABLE IF NOT EXISTS drugs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    warehouse_id UUID NOT NULL,
    batch_number VARCHAR(255) NOT NULL,
    trade_name VARCHAR(255) NOT NULL,
    public_price DECIMAL(10, 2),
    net_price DECIMAL(10, 2),
    production_date DATE,
    expiry_date DATE,
    quantity INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
) PARTITION BY LIST (warehouse_id);

-- إنشاء دالة لإنشاء Partition جديد
CREATE OR REPLACE FUNCTION create_warehouse_partition()
RETURNS TRIGGER AS $$
BEGIN
    -- إنشاء Partition جديد للمخزن المسجل
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS drugs_%s PARTITION OF drugs FOR VALUES IN (%L)',
        NEW.id::TEXT,
        NEW.id
    );
    
    -- إنشاء Index للـ Partition
    EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_drugs_%s_batch_number ON drugs_%s(batch_number)',
        NEW.id::TEXT,
        NEW.id::TEXT
    );
    
    EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_drugs_%s_trade_name ON drugs_%s(trade_name)',
        NEW.id::TEXT,
        NEW.id::TEXT
    );
    
    -- تسجيل العملية
    RAISE NOTICE 'Created partition for warehouse: %', NEW.id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- إنشاء Trigger على جدول warehouses
DROP TRIGGER IF EXISTS on_warehouse_created ON warehouses;
CREATE TRIGGER on_warehouse_created
AFTER INSERT ON warehouses
FOR EACH ROW
EXECUTE FUNCTION create_warehouse_partition();

-- إنشاء دالة لحذف Partition عند حذف المخزن
CREATE OR REPLACE FUNCTION drop_warehouse_partition()
RETURNS TRIGGER AS $$
BEGIN
    -- حذف Partition الخاص بالمخزن المحذوف
    EXECUTE format(
        'DROP TABLE IF EXISTS drugs_%s',
        OLD.id::TEXT
    );
    
    -- تسجيل العملية
    RAISE NOTICE 'Dropped partition for warehouse: %', OLD.id;
    
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- إنشاء Trigger لحذف Partition عند حذف المخزن
DROP TRIGGER IF EXISTS on_warehouse_deleted ON warehouses;
CREATE TRIGGER on_warehouse_deleted
AFTER DELETE ON warehouses
FOR EACH ROW
EXECUTE FUNCTION drop_warehouse_partition();

-- إنشاء دالة لتحديث Partition عند تحديث معرف المخزن
CREATE OR REPLACE FUNCTION update_warehouse_partition()
RETURNS TRIGGER AS $$
BEGIN
    -- إذا تم تغيير معرف المخزن
    IF NEW.id != OLD.id THEN
        -- إنشاء Partition جديد
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS drugs_%s PARTITION OF drugs FOR VALUES IN (%L)',
            NEW.id::TEXT,
            NEW.id
        );
        
        -- نقل البيانات من Partition القديم إلى الجديد
        EXECUTE format(
            'INSERT INTO drugs_%s SELECT * FROM drugs_%s',
            NEW.id::TEXT,
            OLD.id::TEXT
        );
        
        -- حذف Partition القديم
        EXECUTE format(
            'DROP TABLE IF EXISTS drugs_%s',
            OLD.id::TEXT
        );
        
        -- تسجيل العملية
        RAISE NOTICE 'Updated partition for warehouse: % -> %', OLD.id, NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- إنشاء Trigger لتحديث Partition عند تحديث معرف المخزن
DROP TRIGGER IF EXISTS on_warehouse_updated ON warehouses;
CREATE TRIGGER on_warehouse_updated
AFTER UPDATE ON warehouses
FOR EACH ROW
WHEN (OLD.id != NEW.id)
EXECUTE FUNCTION update_warehouse_partition();

-- ملاحظات:
-- 1. يجب تشغيل هذا الملف في Supabase SQL Editor
-- 2. تأكد من أن جدول warehouses موجود قبل تشغيل هذا الملف
-- 3. هذا الـ Trigger سيقوم تلقائياً بإنشاء Partition جديد لكل مخزن جديد
-- 4. سيتم حذف Partition تلقائياً عند حذف المخزن
-- 5. سيتم تحديث Partition تلقائياً عند تغيير معرف المخزن
