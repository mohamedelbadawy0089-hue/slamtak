# 🚀 دليل إعداد Supabase للميكروفون

## 📋 الخطوات المطلوبة

### 1️⃣ إنشاء جدول products في Supabase

افتح SQL Editor في Supabase وقم بتنفيذ هذا الكود:

```sql
-- إنشاء جدول المنتجات
CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  discount DECIMAL(5,2) DEFAULT 0,
  production_date DATE,
  expiry_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- إضافة فهرس للبحث السريع
CREATE INDEX idx_products_name ON products(name);
CREATE INDEX idx_products_created_at ON products(created_at DESC);

-- تفعيل Row Level Security (اختياري)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- سياسة للسماح بالقراءة والكتابة للجميع (للتطوير فقط)
CREATE POLICY "Enable all access for products" ON products
  FOR ALL USING (true);
```

### 2️⃣ الحصول على بيانات الاتصال

1. اذهب إلى **Project Settings** → **API**
2. انسخ:
   - `Project URL` → SUPABASE_URL
   - `anon public` key → SUPABASE_KEY

### 3️⃣ تعديل الملف

افتح `voice-supabase-integration.html` وعدّل:

```javascript
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

---

## 🎤 كيفية الاستخدام

### الطريقة الأولى: الإدخال الصوتي

1. اضغط على زر **🎤 ابدأ التسجيل الصوتي**
2. قل: **"اسم المنتج، الكمية، السعر، الخصم"**
   - مثال: **"باراسيتامول، 100، 25 و 50، 10"**
3. سيتم ملء الخانات تلقائياً
4. بعد ثانيتين سيتم الإرسال تلقائياً

### الطريقة الثانية: الإدخال اليدوي

1. املأ الحقول يدوياً
2. اضغط على **✅ إضافة المنتج**

---

## 💰 معالجة الكسور

الكود يدعم جميع الصيغ:

| الإدخال الصوتي | النتيجة |
|----------------|---------|
| "25 و 50" | 25.50 |
| "25.50" | 25.50 |
| "25,50" | 25.50 |
| "١٥ و ٧٥" | 15.75 |

---

## 📊 البيانات المرسلة

```javascript
{
  name: "باراسيتامول",           // اسم المنتج
  quantity: 100,                  // الكمية (رقم صحيح)
  price: 25.50,                   // السعر (مجمع)
  discount: 10,                   // الخصم (%)
  production_date: "2024-01-15",  // تاريخ الإنتاج
  expiry_date: "2026-01-15",      // تاريخ الانتهاء
  created_at: "2024-01-20T10:30:00Z"
}
```

---

## 🔍 التحقق من الأخطاء

### في Console (F12):

```javascript
// عند النجاح:
✅ تم الإضافة بنجاح: [{...}]

// عند الفشل:
❌ خطأ Supabase: {message: "..."}
```

### على الشاشة:

- ✅ **أخضر**: تم الإضافة بنجاح
- ❌ **أحمر**: خطأ في الإرسال
- ℹ️ **أزرق**: جاري الإضافة...

---

## 🧪 اختبار الاتصال

عند فتح الصفحة، تحقق من Console:

```
🔗 جاري التحقق من اتصال Supabase...
✅ الاتصال بـ Supabase ناجح!
```

إذا ظهر خطأ:
```
❌ فشل الاتصال بـ Supabase: {...}
⚠️ تحقق من إعدادات Supabase
```

---

## 🎯 المميزات

✅ **التعرف الصوتي** باللهجة المصرية (ar-EG)
✅ **دعم الكسور** (25 و 50 → 25.50)
✅ **تحويل الأرقام العربية** للإنجليزية
✅ **إرسال تلقائي** بعد ثانيتين
✅ **معالجة الأخطاء** في Console
✅ **رسائل واضحة** للمستخدم
✅ **تلوين الحقول** عند الملء
✅ **مسح النموذج** بعد النجاح

---

## 🔧 استكشاف الأخطاء

### المشكلة: "المتصفح لا يدعم التعرف الصوتي"
**الحل**: استخدم Chrome أو Edge

### المشكلة: "فشل الاتصال بـ Supabase"
**الحل**: 
1. تحقق من SUPABASE_URL و SUPABASE_KEY
2. تأكد من إنشاء جدول products
3. تحقق من Row Level Security

### المشكلة: "خطأ: column does not exist"
**الحل**: تأكد من أسماء الأعمدة في جدول products

---

## 📱 المتصفحات المدعومة

✅ Chrome
✅ Edge
✅ Safari (iOS 14.5+)
❌ Firefox (لا يدعم التعرف الصوتي بالعربية)

---

## 🎉 جاهز للاستخدام!

افتح الملف وابدأ بإضافة المنتجات بالصوت! 🚀
