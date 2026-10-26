# إرشادات لتجنب مشكلة الرموز الغريبة

## ✅ الطريقة الصحيحة

### 1. استخدام Visual Studio Code

**التحميل:**
- اذهب إلى: https://code.visualstudio.com
- حمّل النسخة المناسبة لنظام التشغيل
- ثبّت البرنامج

**الإعدادات:**
1. افتح VS Code
2. اضغط: Ctrl+Shift+P
3. اكتب: "Preferences: Open Settings (JSON)"
4. أضف:

```json
{
    "files.encoding": "utf8",
    "files.autoGuessEncoding": false,
    "files.eol": "\n",
    "[html]": {
        "editor.defaultFormatter": "esbenp.prettier-vscode",
        "editor.formatOnSave": true
    },
    "[javascript]": {
        "editor.defaultFormatter": "esbenp.prettier-vscode",
        "editor.formatOnSave": true
    }
}
```

### 2. إنشاء ملف جديد

**الخطوات:**
1. افتح VS Code
2. اضغط: Ctrl+N (ملف جديد)
3. اكتب الكود
4. اضغط: Ctrl+Shift+P
5. اكتب: "Change End of Line Sequence"
6. اختر: "LF"
7. احفظ الملف

**التحقق:**
- انظر للشريط السفلي على اليمين
- يجب أن يظهر: "UTF-8" و "LF"

### 3. تحرير ملف موجود

**الخطوات:**
1. افتح الملف في VS Code
2. انظر للشريط السفلي على اليمين
3. اضغط على الترميز (مثل: ANSI, UTF-8)
4. اختر: "Save with Encoding"
5. اختر: "UTF-8"
6. احفظ الملف

### 4. إضافة meta charset

**في كل ملف HTML:**
```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <!-- باقي الـ head -->
</head>
```

## ❌ ما يجب تجنبه

### لا تستخدم:
- ❌ Notepad العادي (Windows)
- ❌ Notepad2
- ❌ محررات قديمة
- ❌ Word أو LibreOffice

### لا تحفظ بـ:
- ❌ ANSI
- ❌ Windows-1256
- ❌ ISO-8859-6
- ❌ أي ترميز غير UTF-8

## 🧪 التحقق

### في المتصفح:
```javascript
// افتح Console (F12)
document.characterSet  // يجب أن يظهر: "UTF-8"
```

### في الملف:
```html
<!-- يجب أن يكون في head -->
<meta charset="UTF-8">
```

### في VS Code:
- انظر للشريط السفلي على اليمين
- يجب أن يظهر: "UTF-8"

## 📋 قائمة التحقق قبل الحفظ

- [ ] استخدام VS Code
- [ ] الترميز: UTF-8
- [ ] Line Ending: LF
- [ ] `<meta charset="UTF-8">` في HTML
- [ ] لا توجد رموز غريبة
- [ ] النصوص العربية تظهر بشكل صحيح

## 🚀 الخطوات السريعة

### لملف جديد:
1. Ctrl+N (ملف جديد)
2. اكتب الكود
3. Ctrl+Shift+P > "Change End of Line Sequence" > LF
4. Ctrl+S (حفظ)
5. تأكد من UTF-8 في الشريط السفلي

### لملف موجود:
1. افتح الملف
2. اضغط على الترميز في الشريط السفلي
3. اختر "Save with Encoding"
4. اختر "UTF-8"
5. احفظ

## 💡 نصائح مهمة

1. **استخدم VS Code دائماً** - أفضل محرر للتطوير
2. **تحقق من الترميز** قبل الحفظ
3. **أضف meta charset** في كل ملف HTML
4. **استخدم LF** بدلاً من CRLF
5. **اختبر في المتصفح** بعد كل تعديل

## 🔧 إعدادات إضافية

### في .gitattributes:
```
* text=auto
*.html text eol=lf encoding=utf-8
*.js text eol=lf encoding=utf-8
*.css text eol=lf encoding=utf-8
*.md text eol=lf encoding=utf-8
```

### في .editorconfig:
```
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true

[*.{html,js,css,md}]
indent_style = space
indent_size = 4
```

## 📞 إذا حدثت المشكلة مرة أخرى

1. افتح الملف في VS Code
2. اضغط على الترميز في الشريط السفلي
3. اختر "Save with Encoding"
4. اختر "UTF-8"
5. احفظ الملف
6. اختبر في المتصفح

---

**اتبع هذه الإرشادات لتجنب المشكلة مستقبلاً! ✅**
