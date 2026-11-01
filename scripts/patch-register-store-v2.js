#!/usr/bin/env node
// Patch public/app.js to add independent store registration support
const fs = require('fs');
const path = require('path');

const APP_JS = path.join(__dirname, '..', 'public', 'app.js');
let src = fs.readFileSync(APP_JS, 'utf8');

if (!src.includes('const isRegister = routePath === "/register";')) {
  console.error('FAIL: expected register form not found in app.js');
  process.exit(1);
}

// 1) Add isIndependentStore variable
src = src.replace(
  '  const isRegister = routePath === "/register";',
  '  const isRegister = routePath === "/register";\n  const isIndependentStore = routePath === "/register/store";'
);

// 2) Update header
src = src.replace(
  '<h1>${isRegister ? "🆕 إنشاء مخزن جديد" : "🔐 تسجيل الدخول للمخزن"}</h1>',
  '<h1>${isIndependentStore ? "🆕 إنشاء مخزن مستقل خاص بي" : isRegister ? "🆕 إنشاء مخزن جديد" : "🔐 تسجيل الدخول للمخزن"}</h1>'
);

// 3) wireGovernorateSearch for both forms
src = src.replace(
  '  if (isRegister) wireGovernorateSearch();',
  '  if (isIndependentStore || isRegister) wireGovernorateSearch();'
);

// 4) The submit handler block
const blockStart = src.indexOf('      if (isRegister) {');
const verifyBlockStart = src.indexOf('      if (isRegister) {', blockStart + 10);
if (verifyBlockStart === -1) {
  console.error('FAIL: second isRegister block not found');
  process.exit(1);
}
const loginAnchor = src.indexOf('      // الخطوة الأولى: Supabase Auth', verifyBlockStart);
if (loginAnchor === -1) {
  console.error('FAIL: login anchor not found');
  process.exit(1);
}

const oldRegisterBlock = src.slice(verifyBlockStart, loginAnchor);

const newRegisterBlock =
`      if (isIndependentStore) {
        // مسار تسجيل مخزن مستقل
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

      if (isRegister) {
${oldRegisterBlock.slice(oldRegisterBlock.indexOf('\n        // 1)'))}`;

src = src.slice(0, verifyBlockStart) + newRegisterBlock + src.slice(loginAnchor);

// 5) Patch the form HTML
const oldFormBlockStart = src.indexOf('          ${isRegister ? `);
if (oldFormBlockStart === -1) {
  console.error('FAIL: old isRegister form template not found');
  process.exit(1);
}

const oldFormBlockEnd = src.indexOf('          </label>` : ""}', oldFormBlockStart);
if (oldFormBlockEnd === -1) {
  console.error('FAIL: old form block end not found');
  process.exit(1);
}

const oldFormBlock = src.slice(oldFormBlockStart, oldFormBlockEnd + '          </label>` : ""}'.length);

const newFormBlock =
`          ${isIndependentStore ? `
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
          ` : ${isRegister ? `
          <label>اسم المخزن
            <input type="text" name="warehouse" required placeholder="مثال: مخزن القاهرة" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
          <label>رقم التليفون
            <input type="tel" name="phone" required placeholder="01012345678" inputmode="numeric" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
          <label>المحافظة (قائمة تدعم البحث)
            <div style="position:relative;">
              <input type="text" id="governorate-input" name="governorate" required autocomplete="off" placeholder="اكتب للبحث... مثال: القاهرة" style="width:100%;padding:0.5rem;margin-top:0.25rem;box-sizing:border-box;" />
              <div id="governorate-menu" style="display:none;position:absolute;top:100%;right:0;left:0;background:#fff;border:1px solid #ccc;border-radius:6px;max-height:200px;overflow-y:auto;z-index:50;box-shadow:0 4px 12px rgba(0,0,0,0.15);"></div>
            </div>
          </label>` : ""}
          ${isRegister ? `<label>البريد الإلكتروني
            <input type="email" name="email" required placeholder="user@example.com" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>` : `<label>اسم المستخدم
            <input type="text" name="login" required autocomplete="username" placeholder="مثال: ahmed.ali" dir="ltr" style="width:100%;padding:0.5rem;margin-top:0.25rem;text-align:left;" />
          </label>`}
          <label>كلمة المرور
            <input type="password" name="password" required minlength="6" placeholder="••••••" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
          ${isRegister ? `
          <label>تأكيد كلمة المرور
            <input type="password" name="password2" required minlength="6" placeholder="••••••" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
          <label>كلمة مرور المدير
            <input type="password" name="admin_password" required minlength="6" placeholder="••••••" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
          <label>تأكيد كلمة مرور المدير
            <input type="password" name="admin_password2" required minlength="6" placeholder="••••••" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>` : ""}`;

src = src.slice(0, oldFormBlockStart) + newFormBlock + src.slice(oldFormBlockEnd + '          </label>` : ""}'.length);

// 6) Patch button text and links
src = src.replace(
  '<button class="btn primary" type="submit">${isRegister ? "تسجيل المخزن" : "دخول"}</button>',
  '<button class="btn primary" type="submit">${isIndependentStore ? "إنشاء مخزن مستقل" : isRegister ? "تسجيل المخزن" : "دخول"}</button>'
);

src = src.replace(
  '<a class="btn" data-link href="${isRegister ? "/login" : "/register"}">${isRegister ? "لدي حساب بالفعل — تسجيل دخول" : "إنشاء مخزن جديد ←"}</a>',
  '<a class="btn" data-link href="${isIndependentStore ? "/register" : isRegister ? "/login" : "/register"}">${isIndependentStore ? "عرض خيارات التسجيل الأخرى" : isRegister ? "لدي حساب بالفعل — تسجيل دخول" : "إنشاء مخزن جديد ←"}</a>'
);

// 7) Remove duplicate error paragraph
const errP = src.indexOf('<p id="auth-form-error" style="color:#d33;min-height:1.2em;margin:0;"></p>');
let pos = errP;
let count = 0;
while (pos !== -1) {
  count++;
  pos = src.indexOf('<p id="auth-form-error"', pos + 1);
}
if (count > 1) {
  let second = src.indexOf('<p id="auth-form-error"', errP + 1);
  if (second !== -1) {
    const end2 = src.indexOf('</p>', second) + 4;
    src = src.slice(0, second) + src.slice(end2);
  }
}

fs.writeFileSync(APP_JS, src, 'utf8');
console.log('✅ public/app.js patched successfully');
