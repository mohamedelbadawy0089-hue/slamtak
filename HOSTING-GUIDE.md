# إعدادات الاستضافة للمساعد الذكي

## 📋 متطلبات الاستضافة

### 1. SSL/HTTPS (ضروري)
الميكروفون يعمل فقط على HTTPS. تأكد من:
- شهادة SSL مفعّلة
- إعادة توجيه HTTP إلى HTTPS تلقائياً

### 2. ترميز UTF-8
تأكد من إعدادات السيرفر:

#### Apache (.htaccess):
```apache
# Force UTF-8 encoding
AddDefaultCharset UTF-8
AddCharset UTF-8 .html .css .js

# Force HTTPS
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]

# Enable CORS (if needed for API)
Header set Access-Control-Allow-Origin "*"
Header set Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS"
Header set Access-Control-Allow-Headers "Content-Type, Authorization"
```

#### Nginx (nginx.conf):
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    charset utf-8;
    
    location / {
        root /var/www/html;
        index index.html;
    }
    
    # CORS headers (if needed)
    add_header Access-Control-Allow-Origin *;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS";
    add_header Access-Control-Allow-Headers "Content-Type, Authorization";
}
```

### 3. MIME Types
تأكد من تعريف أنواع الملفات:

```apache
AddType text/html .html
AddType text/css .css
AddType application/javascript .js
AddType application/json .json
```

---

## 🔧 إعداد API (مستقبلاً)

### في ملف ai-database.js:

```javascript
// قبل الرفع، غيّر هذا السطر:
AIDatabase.init('https://yourdomain.com/api');
```

### مثال API Endpoint:

```javascript
// GET /api/products
{
    "success": true,
    "data": [
        {
            "id": 1,
            "name": "منتج 1",
            "price": 100,
            "quantity": 50
        }
    ]
}

// POST /api/products
{
    "name": "منتج جديد",
    "price": 150,
    "quantity": 100
}

// Response:
{
    "success": true,
    "message": "تم إضافة المنتج بنجاح",
    "data": {
        "id": 2,
        "name": "منتج جديد",
        "price": 150,
        "quantity": 100
    }
}
```

---

## 🔒 الأمان

### 1. Content Security Policy (CSP):

```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; 
               script-src 'self' 'unsafe-inline'; 
               style-src 'self' 'unsafe-inline'; 
               media-src 'self' blob:;">
```

### 2. Permissions Policy:

```html
<meta http-equiv="Permissions-Policy" 
      content="microphone=(self), 
               camera=(), 
               geolocation=()">
```

### 3. Headers الأمان:

```apache
# Apache
Header set X-Content-Type-Options "nosniff"
Header set X-Frame-Options "SAMEORIGIN"
Header set X-XSS-Protection "1; mode=block"
Header set Referrer-Policy "strict-origin-when-cross-origin"
```

```nginx
# Nginx
add_header X-Content-Type-Options "nosniff";
add_header X-Frame-Options "SAMEORIGIN";
add_header X-XSS-Protection "1; mode=block";
add_header Referrer-Policy "strict-origin-when-cross-origin";
```

---

## 📦 ملفات الرفع

تأكد من رفع جميع الملفات التالية:

### الملفات الأساسية:
- ✅ ai-core.js
- ✅ ai-validation.js
- ✅ ai-speech.js
- ✅ ai-database.js
- ✅ ai-ui.js
- ✅ ai-assistant.js

### ملفات HTML:
- ✅ login.html
- ✅ register.html
- ✅ products.html
- ✅ pharmacies.html
- ✅ orders.html
- ✅ (جميع الصفحات الأخرى)

### ملفات إضافية:
- ✅ voice-search.js (إن وجد)
- ✅ AI-README.md (للتوثيق)
- ✅ ai-example.html (للاختبار)

---

## 🧪 الاختبار بعد الرفع

### 1. اختبار SSL:
```
https://yourdomain.com
```
يجب أن يظهر القفل 🔒 في المتصفح

### 2. اختبار الميكروفون:
- افتح أي صفحة
- اضغط على 🤖
- اضغط على 🎤
- يجب أن يطلب إذن الميكروفون

### 3. اختبار الترميز:
- تأكد من ظهور النصوص العربية بشكل صحيح
- لا توجد رموز غريبة

### 4. اختبار Console:
افتح Console (F12) وتحقق من:
```
✅ AI Core loaded
✅ AI Validation loaded
✅ AI Speech loaded
✅ AI Database loaded
✅ AI UI loaded
✅ المساعد الذكي جاهز للاستخدام!
```

---

## 🐛 حل مشاكل الاستضافة

### المشكلة: الميكروفون لا يعمل
**الحل:**
- تأكد من SSL مفعّل
- تحقق من URL يبدأ بـ https://
- جرب متصفح آخر

### المشكلة: رموز غريبة
**الحل:**
- تأكد من حفظ الملفات بـ UTF-8
- أضف `AddDefaultCharset UTF-8` في .htaccess
- تحقق من `<meta charset="UTF-8">`

### المشكلة: الملفات لا تحمّل
**الحل:**
- تحقق من مسارات الملفات
- تأكد من رفع جميع الملفات الـ 6
- افتح Console وابحث عن أخطاء 404

### المشكلة: CORS Error
**الحل:**
- أضف CORS headers في السيرفر
- تحقق من إعدادات API

---

## 📊 مراقبة الأداء

### Google Analytics (اختياري):

```html
<!-- في head -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'GA_MEASUREMENT_ID');
</script>
```

### تتبع استخدام المساعد:

```javascript
// في ai-ui.js بعد askQuestion
if (typeof gtag !== 'undefined') {
    gtag('event', 'ai_question', {
        'question': question,
        'found_answer': match ? 'yes' : 'no'
    });
}
```

---

## 🔄 التحديثات

عند تحديث الملفات:
1. احتفظ بنسخة احتياطية
2. ارفع الملفات الجديدة
3. امسح Cache المتصفح (Ctrl+Shift+R)
4. اختبر جميع الوظائف

---

## 📞 الدعم

للمساعدة:
1. افتح Console (F12)
2. ابحث عن رسائل الأخطاء
3. تحقق من Network tab
4. تأكد من تحميل جميع الملفات

---

## ✅ قائمة التحقق النهائية

قبل الإطلاق:

- [ ] SSL/HTTPS مفعّل ويعمل
- [ ] جميع الملفات مرفوعة
- [ ] الترميز UTF-8 صحيح
- [ ] الميكروفون يعمل
- [ ] التحقق من المدخلات يعمل
- [ ] الرد الصوتي يعمل
- [ ] البحث يعمل
- [ ] لا توجد أخطاء في Console
- [ ] تم الاختبار على أجهزة مختلفة
- [ ] تم الاختبار على متصفحات مختلفة

---

**جاهز للإطلاق! 🚀**
