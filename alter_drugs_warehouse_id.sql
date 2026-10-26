-- تعديل نوع عمود warehouse_id في جدول drugs من character varying إلى UUID
-- هذا ضروري لضمان التوافق مع RPC functions

-- حذف جميع الـ policies على جدول drugs
DO $$
DECLARE
    policy_name TEXT;
BEGIN
    FOR policy_name IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'drugs'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON drugs', policy_name);
        RAISE NOTICE 'Dropped policy: %', policy_name;
    END LOOP;
END $$;

-- تعديل نوع عمود warehouse_id
DO $$
BEGIN
    -- التحقق من نوع العمود الحالي
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'drugs' 
        AND column_name = 'warehouse_id'
        AND data_type != 'uuid'
    ) THEN
        -- تحويل العمود إلى UUID
        ALTER TABLE drugs ALTER COLUMN warehouse_id TYPE UUID USING warehouse_id::UUID;
        RAISE NOTICE 'Converted warehouse_id column to UUID';
    ELSE
        RAISE NOTICE 'warehouse_id column is already UUID or does not exist';
    END IF;
END $$;

-- إضافة Index لتحسين الأداء
DROP INDEX IF EXISTS idx_drugs_warehouse_id;
CREATE INDEX idx_drugs_warehouse_id ON drugs(warehouse_id);

-- Grant permissions
GRANT ALL ON drugs TO authenticated;
GRANT ALL ON drugs TO anon;
GRANT ALL ON drugs TO service_role;
