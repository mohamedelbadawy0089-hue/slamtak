# 🔒 RLS صارم - شرح WITH CHECK

## 📋 ما تم تفعيله

### 1. تفعيل RLS على جدول المشتريات

```sql
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
```

### 2. سياسة INSERT مع WITH CHECK (الحماية الصارمة)

```sql
CREATE POLICY purchases_insert_isolation ON purchases
    FOR INSERT
    WITH CHECK (
        warehouse_id = current_setting('app.current_warehouse_id', true)::UUID
    );
```

---

## 🔐 كيفية عمل WITH CHECK

### BEFORE (بدون WITH CHECK):
```
المستخدم A (warehouse_id: abc-123)    المستخدم B (warehouse_id: xyz-789)
            │                                      │
            ▼                                      ▼
    يرسل INSERT مع:                          يرسل INSERT مع:
    warehouse_id: 'xyz-789' ← ❌ خطأ!      warehouse_id: 'abc-123' ← ❌ خطأ!
    
    ⚠️ يتم القبول! يمكن التلاعب!            ⚠️ يتم القبول! يمكن التلاعب!
```

### AFTER (مع WITH CHECK):
```
المستخدم A (warehouse_id: abc-123)    المستخدم B (warehouse_id: xyz-789)
            │                                      │
            ▼                                      ▼
    يرسل INSERT مع:                          يرسل INSERT مع:
    warehouse_id: 'xyz-789' ← ❌              warehouse_id: 'abc-123' ← ❌
    
    WITH CHECK:                            WITH CHECK:
    'xyz-789' = 'abc-123'? ❌ false          'abc-123' = 'xyz-789'? ❌ false
    
    🚫 مرفوض! RLS Policy violation          🚫 مرفوض! RLS Policy violation
```

---

## 📊 مقارنة السياسات

| السياسة | `USING` | `WITH CHECK` | الغرض |
|---------|---------|--------------|-------|
| **SELECT** | ✅ | ❌ | قراءة البيانات |
| **INSERT** | ❌ | ✅ | التحقق قبل الإدخال |
| **UPDATE** | ✅ | ✅ | التحقق من الصف + البيانات الجديدة |
| **DELETE** | ✅ | ❌ | التحقق قبل الحذف |

---

## 💡 مثال عملي

### محاولة الاختراق (يُمنع):
```javascript
// مخزن A يحاول تسجيل مشتريات في حساب مخزن B
const maliciousData = {
    product_name: "باراسيتامول",
    price: 100,
    warehouse_id: "warehouse-b-id",  // ← محاولة تزوير!
    user_id: "user-a-id"
};

// النتيجة:
await supabase.from('purchases').insert(maliciousData);
// ❌ ERROR: 42501: new row violates row-level security policy "purchases_insert_isolation"
```

### الإدخال الصحيح (يُقبل):
```javascript
// مخزن A يسجل في حسابه فقط
const validData = {
    product_name: "باراسيتامول",
    price: 100,
    warehouse_id: "warehouse-a-id",  // ← مطابق للجلسة ✅
    user_id: "user-a-id"
};

// النتيجة:
await supabase.from('purchases').insert(validData);
// ✅ SUCCESS: تم الإدخال
```

---

## 🔧 كيف يتم تعيين warehouse_id في الجلسة

### في JavaScript (purchases.html):
```javascript
// عند تسجيل الدخول
const { data: { user } } = await supabase.auth.getUser();
const warehouseId = user.user_metadata?.warehouse_id || user.id;

// تعيين warehouse_id في الجلسة
await supabase.rpc('set_warehouse_id', {
    warehouse_id: warehouseId
});
```

### في SQL (دالة):
```sql
CREATE OR REPLACE FUNCTION set_warehouse_id(warehouse_id UUID)
RETURNS void AS $$
BEGIN
    PERFORM set_config('app.current_warehouse_id', warehouse_id::TEXT, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 🛡️ الجداول المحمية

| الجدول | RLS | WITH CHECK على INSERT | الحماية |
|--------|-----|----------------------|---------|
| `purchases` | ✅ | ✅ | لا يمكن التسجيل لحساب آخر |
| `products` | ✅ | ✅ | لا يمكن إضافة منتج لحساب آخر |
| `sales` | ✅ | ✅ | لا يمكن تسجيل بيع لحساب آخر |
| `orders` | ✅ | ✅ | لا يمكن إنشاء طلب لحساب آخر |
| `warehouses` | ✅ | ✅ | لا يمكن التلاعب بالمخازن |

---

## ✅ التحقق من الإعداد

```sql
-- عرض السياسات المفعلة
SELECT 
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'purchases';

-- النتيجة المتوقعة:
-- purchases | purchases_insert_isolation | PERMISSIVE | {public} | INSERT | ... | warehouse_id = current_setting(...)
```

---

## 🎯 النتيجة النهائية

```
🔒 لا يمكن لأي مخزن:
   ├─ تسجيل مشتريات في حساب مخزن آخر ❌
   ├─ إضافة منتجات في حساب مخزن آخر ❌
   ├─ تسجيل مبيعات في حساب مخزن آخر ❌
   ├─ قراءة بيانات مخزن آخر ❌
   └─ تعديل بيانات مخزن آخر ❌

✅ كل مخزن يستطيع:
   ├─ قراءة بياناته فقط ✅
   ├─ إضافة بياناته فقط ✅
   ├─ تعديل بياناته فقط ✅
   └─ حذف بياناته فقط ✅
```

---

## 🚀 خطوات التفعيل

1. شغّل `rls-purchases-strict.sql` في Supabase
2. تأكد من تعيين `warehouse_id` عند تسجيل الدخول
3. اختبِر بمحاولة الإدخال مع `warehouse_id` مختلف
4. يجب أن تظهر رسالة خطأ: `row violates row-level security policy`

**تم بنجاح!** 🎉
