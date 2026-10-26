# نظام المخزن الأوتوماتيكي الكامل - دليل التثبيت والاستخدام

## 📋 نظرة عامة

هذا النظام يوفر حلاً كاملاً وأوتوماتيكياً لإدارة المخازن في Supabase، حيث يتم:
- إنشاء مخزن تلقائياً لكل مستخدم جديد
- جلب معرف المخزن تلقائياً عند تسجيل الدخول
- حفظ معرف المخزن في localStorage بشكل آمن
- توفير دوال آمنة لحذف المنتجات بدون مشاكل

## 🚀 خطوات التثبيت

### 1. تنفيذ ملف SQL في Supabase

افتح **Supabase SQL Editor** ونفذ الملف التالي:

```sql
-- انسخ محتوى الملف: COMPLETE_AUTO_WAREHOUSE_SYSTEM.sql
-- الصقه في SQL Editor واضغط Run
```

هذا الملف سيقوم بـ:
- ✅ تفعيل RLS على الجداول
- ✅ إنشاء سياسات الأمان المناسبة
- ✅ إنشاء RPC functions اللازمة
- ✅ إنشاء مخازن للمستخدمين الحاليين
- ✅ التحقق من نجاح التثبيت

### 2. تحديث ملفات الواجهة الأمامية

#### أ. في `warehouse.html` (تم التحديث تلقائياً)

تم تحديث دالة `handleRegister` لـ:
- استدعاء RPC function لإنشاء المخزن
- حفظ معرف المخزن في جميع مفاتيح localStorage
- معالجة الأخطاء بشكل آمن

#### ب. في `stock.html` (تم التحديث تلقائياً)

تم تحديث دالة `getWarehouseId` لـ:
- استخدام RPC function للحصول على معرف المخزن
- محاولة إنشاء مخزن تلقائياً إذا لم يكن موجوداً
- حفظ معرف المخزن في localStorage و IndexedDB

#### ج. إضافة ملف JavaScript (اختياري)

يمكنك استيراد دوال مساعدة من ملف `COMPLETE_AUTO_WAREHOUSE_SYSTEM.js`:

```javascript
import {
    signUpWithAutoWarehouse,
    signInWithWarehouseId,
    getWarehouseIdFromServer,
    saveWarehouseIdToLocalStorage,
    fixLocalStorageWarehouseId,
    deleteAllWarehouseProducts,
    initializeApp
} from './COMPLETE_AUTO_WAREHOUSE_SYSTEM.js';
```

## 🔧 استخدام النظام

### 1. التسجيل مع إنشاء مخزن أوتوماتيكي

```javascript
// مثال على التسجيل (موجود بالفعل في warehouse.html)
const result = await signUpWithAutoWarehouse({
    email: 'user@example.com',
    password: 'securePassword123',
    phone: '+966501234567',
    metadata: {
        warehouse_name: 'مخزني الرئيسي',
        governorate: 'الرياض'
    }
});

if (result.success) {
    console.log('✅ تم التسجيل:', result.warehouse_id);
}
```

### 2. تسجيل الدخول مع جلب معرف المخزن

```javascript
// مثال على تسجيل الدخول
const result = await signInWithWarehouseId('user@example.com', 'securePassword123');

if (result.success) {
    console.log('✅ تم تسجيل الدخول:', result.warehouse_id);
}
```

### 3. إصلاح localStorage (للمستخدمين الحاليين)

افتح وحدة التحكم (Console) في المتصفح ونفذ:

```javascript
// انسخ محتوى دالة fixLocalStorageWarehouseId من الملف
// الصقه في Console واضغط Enter
await fixLocalStorageWarehouseId();
// ثم قم بتحديث الصفحة
```

### 4. حذف جميع المنتجات

```javascript
// مثال على الحذف (موجود بالفعل في stock.html)
const result = await deleteAllWarehouseProducts();

if (result.success) {
    console.log('✅ تم حذف', result.deleted_count, 'منتج');
}
```

### 5. تهيئة التطبيق عند التحميل

```javascript
// أضف هذا في بداية التطبيق
const initResult = await initializeApp();

if (initResult.success) {
    console.log('✅ تم تهيئة التطبيق:', initResult.warehouse_id);
}
```

## 🛡️ الأمان

النظام يستخدم:
- ✅ **Row Level Security (RLS)** لضمان عزل البيانات
- ✅ **SECURITY DEFINER** في RPC functions لتجاوز RLS مع التحقق الصريح
- ✅ **التحقق من auth.uid()** في كل العمليات
- ✅ **سياسات مناسبة** لكل جدول

## 🔍 RPC Functions المتاحة

### 1. `setup_user_after_signup(p_user_id, p_email, p_phone)`
- إنشاء سجل مستخدم ومخزن
- تُستدعى بعد التسجيل الناجح
- تُرجع معرف المخزن

### 2. `get_user_warehouse_id()`
- جلب معرف المخزن للمستخدم الحالي
- تُستدعى عند تسجيل الدخول
- تُرجع معرف المخزن أو null

### 3. `delete_all_warehouse_products(p_warehouse_id)`
- حذف جميع منتجات المخزن
- تقبل معرف مخزن اختياري (تجلبه تلقائياً)
- تُرجع عدد المنتجات المحذوفة

## 📊 التحقق من التثبيت

بعد تنفيذ ملف SQL، يمكنك التحقق من نجاح التثبيت:

```sql
-- التحقق من وجود الـ functions
SELECT 
    routine_name,
    routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name IN (
    'setup_user_after_signup',
    'get_user_warehouse_id',
    'delete_all_warehouse_products'
);

-- التحقق من وجود المخازن
SELECT 
    COUNT(*) as total_warehouses,
    COUNT(DISTINCT user_id) as total_users_with_warehouses
FROM warehouses;

-- التحقق من سياسات RLS
SELECT 
    tablename,
    policyname,
    permissive,
    cmd
FROM pg_policies
WHERE tablename IN ('users', 'warehouses')
ORDER BY tablename, policyname;
```

## 🐛 حل المشاكل

### مشكلة: "المخزن غير موجود"

**الحل:**
1. تأكد من تنفيذ ملف SQL
2. نفذ دالة `fixLocalStorageWarehouseId()` في Console
3. قم بتحديث الصفحة

### مشكلة: خطأ 500 عند التسجيل

**الحل:**
1. تأكد من تنفيذ ملف SQL بالكامل
2. تحقق من Logs في Supabase Dashboard
3. تأكد من تفعيل RLS بشكل صحيح

### مشكلة: localStorage يحتوي على معرف قديم

**الحل:**
```javascript
// في Console
localStorage.clear();
// ثم سجل الدخول مرة أخرى
```

## 📝 ملاحظات مهمة

1. **تنفيذ SQL ضروري:** يجب تنفيذ ملف SQL قبل استخدام النظام
2. **للمستخدمين الحاليين:** الملف ينشئ مخازن لهم تلقائياً
3. **للمستخدمين الجدد:** المخزن يُنشأ تلقائياً عند التسجيل
4. **الأمان:** النظام يستخدم RLS ويضمن عزل البيانات
5. **التوافقية:** يعمل مع البيانات القديمة والجديدة

## 🎯 الملفات المضمنة

1. **COMPLETE_AUTO_WAREHOUSE_SYSTEM.sql** - ملف SQL الكامل
2. **COMPLETE_AUTO_WAREHOUSE_SYSTEM.js** - ملف JavaScript المساعد
3. **warehouse.html** - تم التحديث (التسجيل)
4. **stock.html** - تم التحديث (جلب معرف المخزن والحذف)
5. **README_AUTO_WAREHOUSE_SYSTEM.md** - هذا الملف

## ✅ قائمة التحقق

قبل استخدام النظام، تأكد من:

- [ ] تنفيذ ملف SQL في Supabase
- [ ] تحديث ملفات HTML (تم تلقائياً)
- [ ] اختبار التسجيل بمستخدم جديد
- [ ] اختبار تسجيل الدخول
- [ ] اختبار حذف المنتجات
- [ ] التحقق من localStorage

## 🆘 الدعم

إذا واجهت أي مشاكل:
1. تحقق من Logs في Supabase Dashboard
2. تأكد من تنفيذ جميع ملفات SQL
3. استخدم دالة `fixLocalStorageWarehouseId()`
4. تأكد من وجود جلسة نشطة

---

**ملاحظة:** هذا النظام مصمم ليكون آمناً وأوتوماتيكياً بالكامل، مما يلغي الحاجة للتدخل اليدوي في إدارة المخازن.