# 🗄️ نظام الإدخال الصوتي مع ربط Supabase لمشروع "سلامتك"

## ✅ **تم إنشاء الملفات التالية:**

### 📄 **1. ملف إعدادات Supabase**
`setup_supabase.sql` - يحتوي على:
- إنشاء جدول `pharmacy_products`
- حقول: product_name, price, discount, quantity, production_date, expiry_date
- فهارس محسّنة للأداء

### 🎤 **2. محرك الصوتي المحسّن**
`ai-speech.js` - يحتوي على:
- معالجة الكلام العربي المركب
- استخراج الكميات: "ميه وتلاتاشر" = 113
- استخراج الأسعار: "خمستاشر واربعتاشر من مية جنيه" = 15.14
- استخراج الخصومات: "ستاشر في المية" = 16%
- ربط تلقائي مع Supabase لحفظ البيانات

### 📝 **3. صفحة الإدخال المحدثة**
`add-product.html` - تحتوي على:
- واجهة مستخدم احترافية
- تعبئة تلقائية للحقول
- حفظ في Supabase و localStorage

---

## 🚀 **خطوات التنفيذ:**

### **الخطوة 1: إنشاء الجدول في Supabase**
```sql
-- قم بتنفيذ هذا الكود في لوحة تحكم Supabase
CREATE TABLE IF NOT EXISTS pharmacy_products (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    discount DECIMAL(5,2) DEFAULT 0,
    quantity INTEGER DEFAULT 0,
    production_date DATE,
    expiry_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### **الخطوة 2: تعديل إعدادات Supabase**
في ملف `ai-speech.js`، عدّل السطرين:
```javascript
const SUPABASE_URL = 'https://your-project.supabase.co'; // ضع رابط مشروعك
const SUPABASE_ANON_KEY = 'your-anon-key'; // ضع مفتاح API
```

### **الخطوة 3: تشغيل النظام**
1. افتح `add-product.html` في المتصفح
2. اضغط على زر "🎤 إدخال صوتي"
3. تحدث بالجمل العربية مثل:
   - "ميه وتلاتاشر بنادول" ← الكمية: 113، المنتج: بنادول
   - "خمستاشر واربعتاشر من مية جنيه" ← السعر: 15.14
   - "ستاشر في المية" ← الخصم: 16%

---

## 🎯 **المميزات:**

### 🧠 **معالجة متقدمة:**
- فهم الأرقام المركبة العربية
- التعرف على أسماء الأدوية الشائعة
- استخراج التواريخ تلقائياً
- حساب الخصومات بالنسب المئوية

### 🗄️ **ربط Supabase:**
- حفظ تلقائي في قاعدة البيانات
- معالجة الأخطاء بشكل احترافي
- رسائل تأكيد للمستخدم

### 📱 **واجهة مستخدم:**
- تصميم عصري وجذاب
- رسوم متحركة وتفاعلية
- دعم كامل للغة العربية RTL

---

## 🔧 **أمر Terminal بديل:**
إذا لم يعمل psql، يمكنك استخدام:
```bash
# نسخ محتوى الملف إلى الحافظة
cat setup_supabase.sql | clip

# ثم لصقه في لوحة تحكم Supabase
```

---

**النظام جاهز للاستخدام! 🎉**
