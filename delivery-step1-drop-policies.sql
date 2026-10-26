-- حذف جميع السياسات
DROP POLICY IF EXISTS "delivery_select_policy" ON delivery;
DROP POLICY IF EXISTS "delivery_insert_policy" ON delivery;
DROP POLICY IF EXISTS "delivery_update_policy" ON delivery;
DROP POLICY IF EXISTS "delivery_delete_policy" ON delivery;
DROP POLICY IF EXISTS "delivery_secure_insert" ON delivery;
DROP POLICY IF EXISTS "Users can view their delivery" ON delivery;
DROP POLICY IF EXISTS "Users can insert their delivery" ON delivery;
DROP POLICY IF EXISTS "Users can update their delivery" ON delivery;
DROP POLICY IF EXISTS "Users can delete their delivery" ON delivery;
DROP POLICY IF EXISTS "Users can manage their delivery" ON delivery;
