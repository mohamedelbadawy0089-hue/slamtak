#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const APP_JS = path.join(__dirname, '..', 'public', 'app.js');
let src = fs.readFileSync(APP_JS, 'utf8');

const oldLink = `          <a class="btn" data-link href="${'${'}isIndependentStore ? "/register" : isRegister ? "/login" : "/register"}">${'${'}isIndependentStore ? "عرض خيارات التسجيل الأخرى" : isRegister ? "لدي حساب بالفعل — تسجيل دخول" : "إنشاء مخزن جديد ←"}</a>
          <a class="btn" data-link href="/">← العودة للرئيسية</a>`;

const newLink = `          <a class="btn" data-link href="${'${'}isIndependentStore ? "/register" : isRegister ? "/login" : "/register"}">${'${'}isIndependentStore ? "عرض خيارات التسجيل الأخرى" : isRegister ? "لدي حساب بالفعل — تسجيل دخول" : "إنشاء مخزن جديد ←"}</a>
          ${'${'}!isIndependentStore && !isRegister ? '          <a class="btn" data-link href="/register/store">🆕 إنشاء مخزن مستقل خاص بي ←</a>
' : ""}
          <a class="btn" data-link href="/">← العودة للرئيسية</a>`;

if (src.includes(oldLink)) {
  src = src.replace(oldLink, newLink);
  fs.writeFileSync(APP_JS, src, 'utf8');
  console.log('✅ Login page link added');
} else {
  const simpleOld = `إنشاء مخزن جديد ←"}</a>
          <a class="btn" data-link href="/">← العودة للرئيسية</a>`;
  const simpleNew = `إنشاء مخزن جديد ←"}</a>
          ${'${'}!isIndependentStore && !isRegister ? '          <a class="btn" data-link href="/register/store">🆕 إنشاء مخزن مستقل خاص بي ←</a>
' : ""}
          <a class="btn" data-link href="/">← العودة للرئيسية</a>`;
  if (src.includes(simpleOld)) {
    src = src.replace(simpleOld, simpleNew);
    fs.writeFileSync(APP_JS, src, 'utf8');
    console.log('✅ Login page link added (simple pattern)');
  } else {
    console.error('FAIL: could not find login link pattern');
    process.exit(1);
  }
}
