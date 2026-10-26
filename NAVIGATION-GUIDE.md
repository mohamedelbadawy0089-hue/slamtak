# نظام الملاحة الموحد - সম NAVIGATION SYSTEM

تم إنشاء نظام ملاحة موحد يربط جميع صفحات التطبيق ببعضها البعض.

## ✨ الميزات

- **ملاحة موحدة**: قائمة ملاحة واحدة على جميع الصفحات
- **متجاوب**: يعمل على أجهزة سطح المكتب والهواتف الذكية
- **سريع التحميل**: يحمل animation سلس وسريع
- **سهل التخصيص**: يمكن تعديل الروابط والأيقونات بسهولة

## 📝 الملفات المستخدمة

### 1. navigation.js
ملف JavaScript يحتوي على:
- قائمة الروابط لجميع الصفحات
- تحديد الصفحة الحالية تلقائياً
- معالجة الأحداث والتفاعلات
- الأنماط (CSS) المضمنة

### آلية العمل

عند تحميل أي صفحة:
1. يتم تحميل ملف `navigation.js`
2. يتم إنشاء شريط ملاحة في أعلى الصفحة
3. يتم إضافة الأنماط المطلوبة تلقائياً
4. يتم تحديد الصفحة الحالية (تظهر مرموقة)
5. يمكن للمستخدم التنقل بين الصفحات بسهولة

## 🎯 الصفحات المتاحة

| الصفحة | الرابط | الأيقونة |
|-------|--------|---------|
| الرئيسية | index.html | 🏠 |
| المنتجات | products.html | 💊 |
| السلة | cart.html | 🛒 |
| الطلبات | orders.html | 📦 |
| التوصيل | delivery.html | 🚚 |
| الصيدليات | pharmacies.html | 🏥 |
| المستودعات | warehouses.html | 📦 |
| الموظفون | employees.html | 👥 |
| المبيعات | telesales.html | 📞 |
| الإشعارات | notifications.html | 🔔 |
| لوحة التحكم | admin-dashboard.html | ⚙️ |
| الملف الشخصي | admin-profile.html | 👤 |
| دخول | login.html | 🔐 |
| تسجيل | register.html | ✍️ |

## 🎨 التخصيص

### لتغيير الألوان:
في ملف `navigation.js`، ابحث عن:
- `background-color: #2c3e50` - اللون الأساسي للملاحة
- `#27ae60` - لون التمرير (hover)
- `#f39c12` - لون الخط السفلي للصفحة الحالية

### لإضافة صفحة جديدة:
أضف عنصر جديد في مصفوفة `pages` في ملف `navigation.js`:

```javascript
{ name: 'اسم الصفحة', link: 'اسم-الملف.html', icon: '🎯' }
```

### لحذف صفحة:
قم بحذف الصفحة من مصفوفة `pages` أو أضفها للتعليق.

## 📱 التوافقية

- **هواتف ذكية**: قائمة منطوية قابلة للتوسع
- **أجهزة لوحية**: عرض محسّن
- **أجهزة سطح المكتب**: عرض كامل

## 🚀 الأداء

- حجم الملف: صغير جداً (~5KB)
- تحميل سريع
- لا توجد مكتبات خارجية مطلوبة (Vanilla JavaScript)
- لا يؤثر على أداء الصفحة

## ⚙️ متطلبات

- لا توجد مكتبات خارجية
- يدعم جميع المتصفحات الحديثة
- يعمل بدون JavaScript في الحد الأدنى (العرض الثابت)

## 🔧 استكشاف الأخطاء

### الملاحة لا تظهر:
- تأكد من أن ملف `navigation.js` في نفس المجلد
- تحقق من وجود `<script src="navigation.js"></script>` في `<head>`

### الألوان لا تظهر بشكل صحيح:
- امسح ذاكرة التخزين المؤقتة للمتصفح (Ctrl + Shift + Delete)
- تأكد من عدم وجود ملفات CSS أخرى تتضارب

### الروابط معطوبة:
- تحقق من أسماء الملفات في مصفوفة `pages`
- تأكد من توافق الأسماء مع أسماء الملفات الفعلية

## 📞 الدعم والمساعدة

إذا واجهت أي مشاكل:
1. تحقق من وحدة التحكم في المتصفح (F12)
2. تأكد من أن جميع الملفات موجودة
3. تحقق من الأسماء والروابط المكتوبة بشكل صحيح

---

## 📋 ملخص التحديثات

تم إضافة `<script src="navigation.js"></script>` إلى الملفات التالية:
✅ index.html
✅ products.html
✅ login.html
✅ register.html
✅ cart.html
✅ orders.html
✅ admin-dashboard.html
✅ delivery.html
✅ employees.html
✅ pharmacies.html
✅ telesales.html
✅ notifications.html
✅ warehouse.html
✅ admin-profile.html
✅ pharmacy-profile.html
✅ telesales-profile.html
✅ telesales-file.html
✅ add-product.html
✅ register-warehouse.html
✅ menu.html
✅ limited-products.html
✅ expiring-products.html
✅ store.html
✅ create-order.html
✅ bulk-add-products.html
✅ A.html
✅ dashboard.html
✅ dashboard-enhanced.html
✅ ai-pages-list.html
✅ ai-test.html
✅ ai-example.html
✅ register-warehouse-ultra.html
✅ register-warehouse-performance.html
✅ P.html

جميع الصفحات الآن متصلة ببعضها عبر نظام ملاحة موحد! 🎉
