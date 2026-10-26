-- ============================================
-- Fix RLS for products table - Correct Order
-- ============================================

-- Step 1: Drop all existing policies first (must drop before altering column)
DROP POLICY IF EXISTS "products_select_own" ON products;
DROP POLICY IF EXISTS "products_insert_own" ON products;
DROP POLICY IF EXISTS "products_update_own" ON products;
DROP POLICY IF EXISTS "products_delete_own" ON products;
DROP POLICY IF EXISTS "products_select_warehouse" ON products;
DROP POLICY IF EXISTS "products_insert_warehouse" ON products;
DROP POLICY IF EXISTS "products_update_warehouse" ON products;
DROP POLICY IF EXISTS "products_delete_warehouse" ON products;
DROP POLICY IF EXISTS "products_select_own_warehouse" ON products;
DROP POLICY IF EXISTS "products_insert_own_warehouse" ON products;
DROP POLICY IF EXISTS "products_update_own_warehouse" ON products;
DROP POLICY IF EXISTS "products_delete_own_warehouse" ON products;
DROP POLICY IF EXISTS "Allow anonymous access" ON products;
DROP POLICY IF EXISTS "Users can view own" ON products;
DROP POLICY IF EXISTS "Users can insert own" ON products;
DROP POLICY IF EXISTS "Users can update own" ON products;
DROP POLICY IF EXISTS "Users can delete own" ON products;
DROP POLICY IF EXISTS "warehouse_isolation_select" ON products;
DROP POLICY IF EXISTS "warehouse_isolation_insert" ON products;
DROP POLICY IF EXISTS "warehouse_isolation_update" ON products;
DROP POLICY IF EXISTS "warehouse_isolation_delete" ON products;
DROP POLICY IF EXISTS "Allow warehouse owners to manage products" ON products;

-- Step 2: Drop all Triggers
DROP TRIGGER IF EXISTS auto_set_product_user_id ON products;
DROP TRIGGER IF EXISTS auto_set_warehouse_id ON products;
DROP TRIGGER IF EXISTS set_warehouse_id ON products;
DROP TRIGGER IF EXISTS set_user_id ON products;

-- Step 3: Drop all Functions
DROP FUNCTION IF EXISTS auto_set_product_user_id();
DROP FUNCTION IF EXISTS auto_set_warehouse_id();
DROP FUNCTION IF EXISTS get_warehouse_id();
DROP FUNCTION IF EXISTS get_auth_user_id();
DROP FUNCTION IF EXISTS get_auth_warehouse_id();

-- Step 4: Remove FK constraints
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_user_id_fkey;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_warehouse_id_fkey;

-- Step 5: Now alter column type (after dropping policies)
ALTER TABLE products 
ALTER COLUMN warehouse_id TYPE TEXT USING warehouse_id::text;

-- Step 6: Enable RLS
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;

-- Step 7: Create new RLS policies (after column type change)
CREATE POLICY "warehouse_isolation_select" ON products
    FOR SELECT
    USING (warehouse_id = auth.uid()::text);

CREATE POLICY "warehouse_isolation_insert" ON products
    FOR INSERT
    WITH CHECK (warehouse_id = auth.uid()::text);

CREATE POLICY "warehouse_isolation_update" ON products
    FOR UPDATE
    USING (warehouse_id = auth.uid()::text)
    WITH CHECK (warehouse_id = auth.uid()::text);

CREATE POLICY "warehouse_isolation_delete" ON products
    FOR DELETE
    USING (warehouse_id = auth.uid()::text);

-- Step 8: Enable Realtime
BEGIN;
  ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS products;
  ALTER PUBLICATION supabase_realtime ADD TABLE products;
COMMIT;

-- Success message
SELECT 'RLS fixed successfully! Policies dropped, column altered, policies recreated.' as result;
