# دليل إضافة Warehouse ID للجداول

## ✅ تم الإنشاء

تم إنشاء ملف SQL: `add-warehouse-id-to-tables.sql`

## 📋 الجداول المُحدثة

| الجدول | الحالة | الغرض |
|--------|--------|-------|
| `products` | ✅ مُحدث | كل منتج مربوط بمخزن |
| `orders` | ✅ مُحدث | كل طلب مربوط بمخزن |
| `sales` | ✅ مُحدث | كل عملية بيع مربوطة بمخزن |
| `delivery_personnel` | ✅ موجود | كل مندوب مربوط بمخزن |
| `order_status_history` | ➕ مُضاف | تتبع تغييرات الحالة |
| `delivery_tracking` | ➕ مُضاف | تتبع عمليات التوصيل |

## 🚀 كيفية التطبيق

### الخيار 1: تشغيل SQL في Supabase Dashboard

1. افتح Supabase Dashboard
2. اذهب إلى SQL Editor
3. انسخ محتوى ملف `add-warehouse-id-to-tables.sql`
4. اضغط Run

### الخيار 2: استخدام الـ API

```javascript
// في purchases.html - warehouse_id يُضاف تلقائياً
const product = {
    name: "منتج",
    price: 100,
    warehouse_id: user.user_metadata.warehouse_id  // ← ربط تلقائي
};
```

## 🔒 سياسات RLS المُحدثة

```sql
-- كل مخزن يرى بياناته فقط
CREATE POLICY warehouse_isolation ON products
    FOR ALL
    USING (warehouse_id = current_setting('app.current_warehouse_id'));
```

## 📊 أمثلة على الاستعلامات

```sql
-- جلب منتجات مخزن محدد
SELECT * FROM products 
WHERE warehouse_id = 'abc-123-xyz';

-- جلب طلبات مخزن محدد
SELECT * FROM orders 
WHERE warehouse_id = 'abc-123-xyz';

-- جلب مبيعات مخزن محدد
SELECT * FROM sales 
WHERE warehouse_id = 'abc-123-xyz';
```

## ✅ التحقق من الربط

```sql
-- التأكد من وجود warehouse_id في جميع الجداول
SELECT column_name, table_name 
FROM information_schema.columns 
WHERE column_name = 'warehouse_id';
```

## 🎯 النتيجة

✅ كل صنف يرفع من `purchases.html` يحمل `warehouse_id` تلقائياً  
✅ لا تداخل بين بيانات المخازن المختلفة  
✅ استعلامات سريعة بفضل Index  
✅ حماية RLS تمنع الوصول غير المصرح  
