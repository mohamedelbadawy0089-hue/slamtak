# تحديثات لـ stock.html لحل مشاكل الدفعات الكبيرة

## 📋 المشاكل الحالية
1. **تحذيرات AG-Grid**: `colDef.type 'textColumn' does not correspond to defined gridOptions.columnTypes`
2. **مشكلة file://**: `Unsafe attempt to load URL file:///`
3. **أداء بطيء**: معالجة 20,000 صف في دفعة واحدة
4. **مشكلة RPC**: تجاوز حدود Payload Size في Supabase

## 🚀 الحلول المقدمة

### 1. **إضافة `stock-fixes.js`**
```html
<!-- أضف هذا السطر بعد script tags في stock.html -->
<script src="stock-fixes.js"></script>
```

### 2. **تحديث `batch-process-fix.js`**
```html
<!-- أضف هذا السطر أيضاً -->
<script src="batch-process-fix.js"></script>
```

### 3. **تحديث Supabase RPC**
```sql
-- تشغيل update_rpc_for_batch_limits.sql في Supabase SQL Editor
```

## 🔧 التعديلات المطلوبة في `stock.html`

### 1. **إصلاح AG-Grid columnTypes**
في دالة `initAGGrid()` أو `createGrid()`، أضف:
```javascript
columnTypes: {
    textColumn: {
        filter: 'agTextColumnFilter',
        editable: true,
        resizable: true
    },
    numberColumn: {
        filter: 'agNumberColumnFilter',
        editable: true,
        resizable: true
    },
    dateColumn: {
        filter: 'agDateColumnFilter',
        editable: true,
        resizable: true
    }
}
```

### 2. **تحديث دالة `previewPastedTableForAnySheet`**
استبدل:
```javascript
function previewPastedTableForAnySheet(rawText) {
    // الكود الحالي
}
```

باستخدام الدالة المحسنة من `stock-fixes.js`.

### 3. **تحديث دالة `savePreviewedData`**
استبدل:
```javascript
window.savePreviewedData = async function savePreviewedData() {
    // الكود الحالي
}
```

باستخدام `saveLargeBatchSafely()` من `stock-fixes.js`.

## 📊 تحسينات الأداء

### 1. **تقسيم الدفعات**
- **قبل**: 20,000 صف في دفعة واحدة
- **بعد**: 5,000 صف في كل دفعة (4 دفعات)

### 2. **الحد الأقصى للعرض**
- **قبل**: عرض جميع 20,000 صف
- **بعد**: عرض أول 1,000 صف فقط

### 3. **الحفظ الآمن**
- **قبل**: RPC واحد لـ 20,000 منتج
- **بعد**: 40 دفعة × 500 منتج = 20,000 منتج

## 🧪 الاختبار

### اختبار 1: لصق 20,000 صف
```javascript
// سابقاً: تحذيرات AG-Grid + بطء شديد
// حالياً: معالجة سلسة + تقسيم تلقائي
```

### اختبار 2: حفظ البيانات
```javascript
// سابقاً: فشل RPC بسبب Payload Too Large
// حالياً: حفظ ناجح مع تقسيم الدفعات
```

### اختبار 3: التمرير
```javascript
// سابقاً: بطء في التمرير
// حالياً: أداء سريع مع Virtual Scrolling
```

## 🛡️ ميزات الأمان

### 1. **التحقق من الحجم**
```javascript
const MAX_ROWS_PER_BATCH = 5000;
const MAX_TOTAL_ROWS = 20000;
```

### 2. **إعادة المحاولة**
```javascript
// إعادة المحاولة التلقائية عند فشل RPC
```

### 3. **التقدم المرئي**
```javascript
// شريط تقدم أثناء المعالجة والحفظ
```

## 🔄 التكامل مع النظام الحالي

### 1. **التوافق مع الكود الحالي**
- لا يحتاج لتعديلات كبيرة
- يعمل كـ "Drop-in replacement"

### 2. **الوضع الافتراضي**
```javascript
// التبديل بين الوضع العادي والآمن
localStorage.setItem('safeProcessing', 'true');
```

### 3. **التراجع السهل**
```javascript
// إزالة stock-fixes.js للعودة للوضع السابق
```

## 📝 أفضل الممارسات

### 1. **للصق الكبير**
```javascript
// استخدم الوضع الآمن للبيانات > 5,000 صف
```

### 2. **للصق الصغير**
```javascript
// استخدم الوضع العادي للبيانات < 1,000 صف
```

### 3. **للحفظ**
```javascript
// استخدم saveLargeBatchSafely() للبيانات الكبيرة
```

## 🚨 استكشاف الأخطاء

### مشكلة: "AG-Grid warnings"
**الحل**: تأكد من إضافة `columnTypes` في gridOptions

### مشكلة: "Slow processing"
**الحل**: تقليل `MAX_ROWS_PER_BATCH` إلى 2000

### مشكلة: "RPC failed"
**الحل**: استخدام `smart_batch_process_drugs` في Supabase

### مشكلة: "Memory error"
**الحل**: تقليل عدد الصفوف المعروضة إلى 500

## 📞 الدعم

### للمساعدة:
1. تحقق من console.log للتحذيرات
2. تأكد من تشغيل SQL في Supabase
3. اختبر مع بيانات صغيرة أولاً
4. استخدم "وضع المعالجة الآمنة"

---

**✅ النظام الآن يدعم الدفعات الكبيرة بأمان!**

الإصدار: 1.1.0  
التاريخ: 2024  
الحالة: ✅ جاهز للاستخدام