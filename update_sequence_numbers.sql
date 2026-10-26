-- تحديث البيانات القديمة لإضافة sequence_number بناءً على created_at
-- هذا الاستعلام يضيف sequence_number للبيانات الموجودة التي لا تحتوي عليه

-- تحديث جدول warehouse_products_flexible
UPDATE warehouse_products_flexible
SET product_data = product_data || jsonb_build_object(
    'sequence_number',
    (SELECT ROW_NUMBER() OVER (ORDER BY created_at ASC) FROM warehouse_products_flexible wpf2 WHERE wpf2.id = warehouse_products_flexible.id)
)
WHERE product_data->>'sequence_number' IS NULL
OR product_data->>'sequence_number' = ''
OR product_data->>'sequence_number' = '0';

-- التحقق من التحديث
SELECT 
    COUNT(*) as total_records,
    COUNT(CASE WHEN product_data->>'sequence_number' IS NOT NULL THEN 1 END) as records_with_sequence
FROM warehouse_products_flexible;
