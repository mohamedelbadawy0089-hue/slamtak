-- تحقق من البيانات في جدول user_warehouses للمستخدم الحالي
SELECT * FROM user_warehouses WHERE user_id = '30a19c99-ae45-4e62-8e72-32a06d54014d';

-- تحقق من وجود المخزن المحدد
SELECT * FROM user_warehouses WHERE id = '30a19c99-ae45-4e62-8e72-32a06d54014d';

-- تحقق من جميع المستخدمين والمخازن
SELECT * FROM user_warehouses;
