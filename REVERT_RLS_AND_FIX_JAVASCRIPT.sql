-- ============================================================
-- إرجاع سياسات RLS إلى الحالة الأصلية
-- ============================================================

-- إزالة السياسات الموسعة
DROP POLICY IF EXISTS "Users can view all warehouses" ON warehouses;
DROP POLICY IF EXISTS "Users can create warehouses" ON warehouses;
DROP POLICY IF EXISTS "Users can update warehouses" ON warehouses;
DROP POLICY IF EXISTS "Users can delete warehouses" ON warehouses;

-- إعادة سياسات RLS الأصلية
CREATE POLICY "Users can view their warehouses"
    ON warehouses FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create warehouses"
    ON warehouses FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their warehouses"
    ON warehouses FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their warehouses"
    ON warehouses FOR DELETE
    USING (auth.uid() = user_id);

-- عرض جميع المخازن للتأكد من الربط
SELECT 
    w.id as warehouse_id,
    w.user_id,
    w.warehouse_name
FROM warehouses w
ORDER BY w.created_at DESC;