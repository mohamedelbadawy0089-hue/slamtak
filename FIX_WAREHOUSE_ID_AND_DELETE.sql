-- ============================================================
-- تصحيح معرف المخزن وحذف البيانات
-- ============================================================

-- 1. عرض معرفات المستخدمين والمخازن الحالية
SELECT 
    u.id as user_id,
    u.email,
    w.id as warehouse_id,
    w.warehouse_name,
    w.warehouse_code
FROM users u
LEFT JOIN warehouses w ON u.id = w.user_id;

-- 2. عرض عدد المنتجات لكل مخزن
SELECT 
    warehouse_id,
    COUNT(*) as product_count
FROM warehouse_products_flexible
GROUP BY warehouse_id
ORDER BY product_count DESC;

-- 3. عرض معرف المخزن للمستخدم الحالي (00970023-0726-45c3-98a4-a320ec1d21e3)
SELECT 
    w.id as correct_warehouse_id,
    w.warehouse_name,
    w.warehouse_code,
    w.user_id
FROM warehouses w
WHERE w.user_id = '00970023-0726-45c3-98a4-a320ec1d21e3';

-- 4. عرض عدد المنتجات لهذا المعرف
SELECT 
    COUNT(*) as product_count,
    warehouse_id
FROM warehouse_products_flexible
WHERE warehouse_id = '00970023-0726-45c3-98a4-a320ec1d21e3'
GROUP BY warehouse_id;