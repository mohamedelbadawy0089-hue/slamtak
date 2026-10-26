ALTER TABLE drugs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own drugs" ON drugs;
DROP POLICY IF EXISTS "Users can insert their own drugs" ON drugs;
DROP POLICY IF EXISTS "Users can update their own drugs" ON drugs;
DROP POLICY IF EXISTS "Users can delete their own drugs" ON drugs;

DROP POLICY IF EXISTS "Users can view their warehouse drugs" ON drugs;
DROP POLICY IF EXISTS "Users can insert warehouse drugs" ON drugs;
DROP POLICY IF EXISTS "Users can update warehouse drugs" ON drugs;
DROP POLICY IF EXISTS "Users can delete warehouse drugs" ON drugs;

DROP POLICY IF EXISTS "Enable all for authenticated users" ON drugs;
DROP POLICY IF EXISTS "Users can access their own warehouse only" ON drugs;
DROP POLICY IF EXISTS "Users can view their own warehouse only" ON drugs;
DROP POLICY IF EXISTS "Users can insert their own warehouse only" ON drugs;
DROP POLICY IF EXISTS "Users can update their own warehouse only" ON drugs;
DROP POLICY IF EXISTS "Users can delete their own warehouse only" ON drugs;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON drugs;

-- سياسات RLS الصحيحة للعزل بين المخازن
CREATE POLICY "Users can view their own warehouse only" ON drugs FOR SELECT 
USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
        SELECT 1 FROM user_warehouses 
        WHERE user_id = auth.uid() 
        AND id = drugs.warehouse_id
    )
);

CREATE POLICY "Users can insert their own warehouse only" ON drugs FOR INSERT 
WITH CHECK (
    auth.uid() IS NOT NULL AND
    EXISTS (
        SELECT 1 FROM user_warehouses 
        WHERE user_id = auth.uid() 
        AND id = drugs.warehouse_id
    )
);

CREATE POLICY "Users can update their own warehouse only" ON drugs FOR UPDATE 
USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
        SELECT 1 FROM user_warehouses 
        WHERE user_id = auth.uid() 
        AND id = drugs.warehouse_id
    )
);

CREATE POLICY "Users can delete their own warehouse only" ON drugs FOR DELETE 
USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
        SELECT 1 FROM user_warehouses 
        WHERE user_id = auth.uid() 
        AND id = drugs.warehouse_id
    )
);

ALTER TABLE drugs DROP CONSTRAINT IF EXISTS drugs_batchNumber_warehouse_id_key;
ALTER TABLE drugs DROP CONSTRAINT IF EXISTS drugs_batchNumber_key;
ALTER TABLE drugs DROP CONSTRAINT IF EXISTS drugs_batchNumber_warehouse_id_tradeName_key;
ALTER TABLE drugs DROP CONSTRAINT IF EXISTS drugs_batchnumber_warehouse_id_tradename_key;

ALTER TABLE drugs ADD CONSTRAINT drugs_tradeName_warehouse_id_key UNIQUE ("tradeName", warehouse_id);

-- إضافة سياسات RLS لجدول user_warehouses
ALTER TABLE user_warehouses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own warehouses" ON user_warehouses;
DROP POLICY IF EXISTS "Users can insert their own warehouses" ON user_warehouses;
DROP POLICY IF EXISTS "Users can update their own warehouses" ON user_warehouses;
DROP POLICY IF EXISTS "Users can delete their own warehouses" ON user_warehouses;

CREATE POLICY "Users can view their own warehouses" ON user_warehouses FOR SELECT 
USING (
    auth.uid() IS NOT NULL AND
    user_id = auth.uid()
);

CREATE POLICY "Users can insert their own warehouses" ON user_warehouses FOR INSERT 
WITH CHECK (
    auth.uid() IS NOT NULL AND
    user_id = auth.uid()
);

CREATE POLICY "Users can update their own warehouses" ON user_warehouses FOR UPDATE 
USING (
    auth.uid() IS NOT NULL AND
    user_id = auth.uid()
);

CREATE POLICY "Users can delete their own warehouses" ON user_warehouses FOR DELETE 
USING (
    auth.uid() IS NOT NULL AND
    user_id = auth.uid()
);
