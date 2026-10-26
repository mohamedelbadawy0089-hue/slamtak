# دليل استخدام نظام Multi-Tenant SaaS

## نظرة عامة
الآن المشروع يدعم **عزل كامل** بين المخازن - كل مستخدم يرى بياناته فقط.

## طريقة الاستخدام

### 1. جلب البيانات (مع فلتر user_id تلقائي)

```javascript
// ❌ الطريقة القديمة (بدون عزل):
const { data } = await supabase
    .from('products')
    .select('*');

// ✅ الطريقة الجديدة (مع عزل تلقائي):
const query = SupabaseSingleton.createTenantQuery('products');
const { data, error } = await query;

// أو استخدام الدالة المساعدة:
const result = await SupabaseSingleton.insertWithTenant('products', {
    name: 'منتج جديد',
    price: 100
});
```

### 2. إضافة سجل (مع user_id تلقائي)

```javascript
// ✅ الطريقة الموصى بها:
const result = await SupabaseSingleton.insertWithTenant('products', {
    name: 'منتج جديد',
    price: 100,
    quantity: 50
});

// user_id و warehouse_id يُضافان تلقائياً!
```

### 3. تحديث سجل (فقط للمستخدم الحالي)

```javascript
// ✅ التحديث مع التحقق من المالك:
const result = await SupabaseSingleton.updateWithTenant('products', productId, {
    price: 150,
    quantity: 30
});
```

### 4. حذف سجل (فقط للمستخدم الحالي)

```javascript
// ✅ الحذف مع التحقق من المالك:
const result = await SupabaseSingleton.deleteWithTenant('products', productId);
```

### 5. استخدام MultiTenantManager

```javascript
// إنشاء مدير متعدد المستأجرين
const tenantManager = new MultiTenantManager(SupabaseSingleton.getClient());

// جلب المنتجات (مع فلتر user_id)
const products = await tenantManager.select('products');

// إضافة منتج (مع user_id تلقائي)
await tenantManager.insert('products', {
    name: 'منتج جديد',
    price: 100
});

// Real-time (مع عزل)
tenantManager.subscribeToTable('products', (payload) => {
    console.log('تم تحديث المنتج:', payload);
});
```

## الجداول المدعومة

نظام العزل يعمل تلقائياً على:
- ✅ `warehouses` - المخازن
- ✅ `products` - المنتجات
- ✅ `orders` - الطلبات
- ✅ `pharmacies` - الصيدليات
- ✅ `delivery_personnel` - المندوبين
- ✅ `categories` - التصنيفات
- ✅ `suppliers` - الموردين
- ✅ `sales` - المبيعات
- ✅ `settings` - الإعدادات
- ✅ `order_status_history` - تاريخ الطلبات
- ✅ `delivery_tracking` - تتبع التوصيل
- ✅ `analytics` - التحليلات

## مثال كامل لصفحة

```html
<!DOCTYPE html>
<html>
<head>
    <script src="supabase-singleton.js"></script>
    <script src="multi-tenant-integration.js"></script>
</head>
<body>
    <script>
        document.addEventListener('DOMContentLoaded', async () => {
            // 1. الحصول على client
            const client = SupabaseSingleton.getClient();
            
            // 2. إنشاء مدير متعدد المستأجرين
            const tenant = new MultiTenantManager(client);
            
            // 3. جلب المنتجات (فقط للمستخدم الحالي)
            const result = await tenant.select('products', {
                orderBy: 'name',
                ascending: true
            });
            
            if (result.success) {
                console.log('منتجاتي:', result.data);
                renderProducts(result.data);
            }
            
            // 4. إضافة منتج جديد
            document.getElementById('saveBtn').addEventListener('click', async () => {
                const result = await tenant.insert('products', {
                    name: document.getElementById('name').value,
                    price: parseFloat(document.getElementById('price').value),
                    quantity: parseInt(document.getElementById('qty').value)
                });
                
                if (result.success) {
                    alert('✅ تم الحفظ!');
                    // Real-time سيظهر التحديث فوراً
                }
            });
            
            // 5. Real-time - تحديث فوري
            tenant.subscribeToTable('products', (payload) => {
                if (payload.eventType === 'INSERT') {
                    addProductToUI(payload.new);
                }
            });
        });
    </script>
</body>
</html>
```

## الملفات الجديدة

| الملف | الوصف |
|-------|-------|
| `supabase-singleton.js` | مُحدَّث - يتضمن دوال Multi-Tenant |
| `multi-tenant-integration.js` | كلاس MultiTenantManager |
| `apply-rls-all-tables.sql` | سياسات RLS لجميع الجداول |

## التحقق من العزل

للتأكد أن العزل يعمل:

```javascript
// جلب user_id الحالي
const userId = SupabaseSingleton.getCurrentUserId();
console.log('مستخدمي:', userId);

// جلب warehouse_id
const warehouseId = SupabaseSingleton.getCurrentWarehouseId();
console.log('مخزني:', warehouseId);

// التحقق من الفلتر
const query = SupabaseSingleton.createTenantQuery('products');
// هذا يُرجع فقط منتجات المستخدم الحالي
```

## ملاحظات أمان

1. **user_id** يُضاف تلقائياً عند الإدراج
2. **فلتر user_id** يُطبق تلقائياً عند الجلب
3. **التحديث والحذف** يتطلبان مطابقة user_id
4. **RLS policies** في Supabase تضيف طبقة حماية إضافية
5. **Real-time** مُفلتر حسب user_id

## خطوات التفعيل

1. شغّل `apply-rls-all-tables.sql` في Supabase
2. أضف `<script src="multi-tenant-integration.js"></script>` للصفحات
3. استخدم `MultiTenantManager` أو `SupabaseSingleton.*WithTenant` functions
4. تأكد من وجود `slamtak-user-id` في localStorage
