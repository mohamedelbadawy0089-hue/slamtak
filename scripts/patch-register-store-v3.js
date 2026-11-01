#!/usr/bin/env node
// Patch public/app.js to add /register/store independent warehouse registration
const fs = require('fs');
const path = require('path');

const APP_JS = path.join(__dirname, '..', 'public', 'app.js');
let src = fs.readFileSync(APP_JS, 'utf8');

function findIdx(haystack, needle, start = 0) {
  const i = haystack.indexOf(needle, start);
  if (i === -1) throw new Error('NOT_FOUND: ' + JSON.stringify(needle));
  return i;
}

// 1) Add isIndependentStore variable
const A = '  const isRegister = routePath === "/register";';
const B = '  const isIndependentStore = routePath === "/register/store";\n';
if (!src.includes(B)) {
  src = src.replace(A, A + '\n' + B);
}

// 2) Header text
src = src.replace(
  '${isRegister ? "🆕 إنشاء مخزن جديد" : "🔐 تسجيل الدخول للمخزن"}',
  '${isIndependentStore ? "🆕 إنشاء مخزن مستقل خاص بي" : isRegister ? "🆕 إنشاء مخزن جديد" : "🔐 تسجيل الدخول للمخزن"}'
);

// 3) wireGovernorateSearch for both
src = src.replace(
  '  if (isRegister) wireGovernorateSearch();',
  '  if (isIndependentStore || isRegister) wireGovernorateSearch();'
);

// 4) Add isIndependentStore branch before isRegister in form HTML
const formBlockAnchor = '          ${isRegister ? `\n          <label>اسم المخزن';
const iForm = findIdx(src, formBlockAnchor);

const IND_STORE_HTML = `          ${'${'}isIndependentStore ? `
          <div class="card" style="background:#f0f7ff;border-left:4px solid #2563eb;padding:0.75rem 1rem;text-align:center;">
            <p style="margin:0;font-size:0.9rem;">🔒<strong>مخزن مستقل</strong> — سيُنشَأ مخزنك الخاص بك مع عزل كامل عن المخازن الأخرى،
            وستكون أنت المدير الوحيد له. بياناتك وبيانات مخزنك لن تظهر لأحد سوى أنت وفريقك الذي تضعه.</p>
          </div>
          <label>البريد الإلكتروني
            <input type="email" name="email" required placeholder="user@example.com" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
          <label>اسم المخزن (العرضي)
            <input type="text" name="store_name" required placeholder="مثال: مخزن السلامة — القاهرة" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
          <label>رقم التليفون
            <input type="tel" name="phone" placeholder="01012345678" inputmode="numeric" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
          <label>المحافظة (قائمة تدعم البحث)
            <div style="position:relative;">
              <input type="text" id="governorate-input" name="governorate" autocomplete="off" placeholder="اكتب للبحث... مثال: القاهرة" style="width:100%;padding:0.5rem;margin-top:0.25rem;box-sizing:border-box;" />
              <div id="governorate-menu" style="display:none;position:absolute;top:100%;right:0;left:0;background:#fff;border:1px solid #ccc;border-radius:6px;max-height:200px;overflow-y:auto;z-index:50;box-shadow:0 4px 12px rgba(0,0,0,0.15);"></div>
            </div>
          </label>
          <label>كلمة المرور
            <input type="password" name="password" required minlength="6" placeholder="••••••" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
          <label>كلمة مرور المدير (للوصول إلى إعدادات المخزن)
            <input type="password" name="admin_password" minlength="6" placeholder="••••••" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
          <p class="muted" style="font-size:0.8rem;margin:0;">تركها فارغة ← كلمة مرور مؤقتة (يغيرها بعد الدخول).</p>
          ${'}'`} : ${'${'}isRegister ? `
`;

src = src.slice(0, iForm) + IND_STORE_HTML + src.slice(iForm);

// 5) Replace button and links
src = src.replace(
  '<button class="btn primary" type="submit">${isRegister ? "تسجيل المخزن" : "دخول"}</button>',
  '<button class="btn primary" type="submit">${isIndependentStore ? "إنشاء مخزن مستقل" : isRegister ? "تسجيل المخزن" : "دخول"}</button>'
);

src = src.replace(
  '<a class="btn" data-link href="${isRegister ? "/login" : "/register"}">${isRegister ? "لدي حساب بالفعل — تسجيل دخول" : "إنشاء مخزن جديد ←"}</a>',
  '<a class="btn" data-link href="${isIndependentStore ? "/register" : isRegister ? "/login" : "/register"}">${isIndependentStore ? "عرض خيارات التسجيل الأخرى" : isRegister ? "لدي حساب بالفعل — تسجيل دخول" : "إنشاء مخزن جديد ←"}</a>'
);

// 6) Submit handler: var declarations
const IND_STORE_JS = `
    if (isIndependentStore) {
      const email = String(fd.get("email") || "").trim();
      const password = String(fd.get("password") || "");
      const storeName = String(fd.get("store_name") || "").trim();
      const phone = String(fd.get("phone") || "").trim().replace(/[^0-9]/g, "");
      const governorate = String(fd.get("governorate") || "").trim();
      const adminPassword = String(fd.get("admin_password") || "").trim();

      if (!email || password.length < 6) { setError("أدخل البريد وكلمة مرور من 6 أحرف على الأقل"); return; }
      if (!storeName) { setError("أدخل اسم المخزن"); return; }
      if (phone && !/^01[0125][0-9]{8}$/.test(phone)) { setError("رقم التليفون غير صحيح — مثال: 01012345678"); return; }
      if (governorate && !GOVERNORATES.some(g => g.indexOf(governorate) !== -1)) { setError("المحافظة غير موجودة — اختر من القائمة"); return; }
    }

`;

const varDeclsStart = findIdx(src, '\n    let phone = "", governorate = "", password2 = "", adminPassword = "", adminPassword2 = "";\n    if (isRegister) {', findIdx(src, '\n      if (isRegister) {\n        // 1) إنشاء حساب المخزن') - 500);
src = src.slice(0, varDeclsStart) + IND_STORE_JS + src.slice(varDeclsStart);

// 7) API call before isRegister block
const IND_STORE_API_CALL = `
      if (isIndependentStore) {
        const res = await api("/api/auth/register-store", {
          method: "POST",
          body: { email: email, password: password, store_name: storeName, phone: phone, governorate: governorate, admin_password: adminPassword }
        });
        clearSession();
        clearStep2Mark();
        authFlash = "تم إنشاء مخزنك المستقل بنجاح: " + (res.store_name || storeName) + " (الرمز: " + (res.warehouse_code || "—") + ")";
        navigate("/login");
        return;
      }

`;

const apiCallAnchor = '      if (isRegister) {\n        // 1) إنشاء حساب المخزن (Supabase Auth signUp)';
const iApi = findIdx(src, apiCallAnchor);
src = src.slice(0, iApi) + IND_STORE_API_CALL + src.slice(iApi);

// 8) Clean up duplicate error paragraphs
let errCount = 0;
let searchPos = 0;
while ((searchPos = src.indexOf('<p id="auth-form-error"', searchPos)) !== -1) {
  errCount++;
  searchPos += 1;
}
if (errCount > 1) {
  let pos = src.indexOf('<p id="auth-form-error"');
  while (pos !== -1) {
    const nextPos = src.indexOf('<p id="auth-form-error"', pos + 1);
    if (nextPos === -1) break;
    const end = src.indexOf('</p>', nextPos) + 4;
    src = src.slice(0, nextPos) + src.slice(end);
    pos = src.indexOf('<p id="auth-form-error"', pos);
  }
}

fs.writeFileSync(APP_JS, src, 'utf8');
console.log('✅ public/app.js patched successfully');
console.log('   - /register/store route added');
console.log('   - Independent store form fields added');
console.log('   - /api/auth/register-store API call added');
