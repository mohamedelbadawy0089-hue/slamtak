# كيفية تفعيل سياسات RLS في Supabase

## الخطوات:

### 1. الدخول إلى Supabase Dashboard
- افتح [https://supabase.com/dashboard](https://supabase.com/dashboard)
- سجل الدخول بحسابك
- اختر مشروعك (slamtak)

### 2. فتح SQL Editor
- من القائمة الجانبية، اختر "SQL Editor"
- انقر على "New Query"

### 3. تنفيذ ملف السياسات
- افتح الملف `rls_policies_warehouse_products_flexible.sql`
- انسخ محتواه بالكامل
- الصقه في SQL Editor
- انقر على "Run" أو اضغط `Ctrl+Enter`

### 4. التحقق من تفعيل السياسات
بعد التنفيذ، ستظهر نتيجة الاستعلام الأخير في الملف:
```sql
SELECT 
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'warehouse_products_flexible';
```

يجب أن ترى 4 سياسات:
- Users can view products in their warehouses (SELECT)
- Users can insert products in their warehouses (INSERT)
- Users can update products in their warehouses (UPDATE)
- Users can delete products in their warehouses (DELETE)

### 5. التحقق من الفهارس
تأكد من أن الفهارس التالية قد تم إنشاؤها:
- idx_warehouse_products_warehouse_id_user_id
- idx_warehouses_user_id

### 6. إعادة تفعيل الجدول المرن في الكود
بعد تفعيل السياسات بنجاح، قم بتحديث الكود لإعادة تفعيل الجدول المرن:
- افتح `stock.html`
- ابحث عن دالة `fetchWarehouseDrugs`
- استبدل الكود الحالي بالكود الذي يستخدم الجدول المرن

## ملاحظات مهمة:

### الأمان:
- السياسات تضمن أن كل مستخدم يمكنه فقط رؤية وتعديل المنتجات في مخازنه الخاصة
- التحقق يتم عبر `warehouse_id` و `user_id` لضمان العزل الكامل للبيانات

### الأداء:
- الفهارس المضافة تضمن أداءً عالياً حتى مع 20,000 منتج
- استخدام `IN` مع `SELECT` أكثر كفاءة من `EXISTS` في بعض الحالات

### الاختبار:
- بعد تفعيل السياسات، اختبر:
  1. جلب البيانات (SELECT)
  2. إضافة منتجات جديدة (INSERT)
  3. تعديل منتجات موجودة (UPDATE)
  4. حذف منتجات (DELETE)

## استكشاف الأخطاء:

### إذا ظهر خطأ 403:
- تأكد من أن المستخدم مسجل الدخول
- تحقق من أن `auth.uid()` يرجع قيمة صحيحة
- تأكد من أن `warehouse_id` موجود في جدول `warehouses` للمستخدم الحالي

### إذا كان الأداء بطيئاً:
- تحقق من أن الفهارس قد تم إنشاؤها
- استخدم `EXPLAIN ANALYZE` لتحليل الاستعلامات
- تأكد من أن `warehouse_id` مفهرس

## دعم:
إذا واجهت أي مشاكل، راجع:
- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- [Supabase Performance Guide](https://supabase.com/docs/guides/platform/performance)
