ALTER TABLE IF EXISTS pharmacies RENAME TO warehouse_pharmacies;

-- تحديث السياسات لتشمل فلتر warehouse_id الصارم
DROP POLICY IF EXISTS "Users can view own" ON warehouse_pharmacies;
CREATE POLICY "Strict Warehouse Isolation - Select" ON warehouse_pharmacies
    FOR SELECT
    USING (warehouse_id::text = auth.jwt()->'user_metadata'->>'warehouse_id');

DROP POLICY IF EXISTS "Users can insert own" ON warehouse_pharmacies;
CREATE POLICY "Strict Warehouse Isolation - Insert" ON warehouse_pharmacies
    FOR INSERT
    WITH CHECK (warehouse_id::text = auth.jwt()->'user_metadata'->>'warehouse_id');

DROP POLICY IF EXISTS "Users can update own" ON warehouse_pharmacies;
CREATE POLICY "Strict Warehouse Isolation - Update" ON warehouse_pharmacies
    FOR UPDATE
    USING (warehouse_id::text = auth.jwt()->'user_metadata'->>'warehouse_id');

DROP POLICY IF EXISTS "Users can delete own" ON warehouse_pharmacies;
CREATE POLICY "Strict Warehouse Isolation - Delete" ON warehouse_pharmacies
    FOR DELETE
    USING (warehouse_id::text = auth.jwt()->'user_metadata'->>'warehouse_id');
