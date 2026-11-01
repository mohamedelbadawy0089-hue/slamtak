#!/usr/bin/env node
// Patch public/app.js to add independent store registration

const fs = require('fs');
const path = require('path');

const APP_JS = path.join(__dirname, '..', 'public', 'app.js');
let src = fs.readFileSync(APP_JS, 'utf8');

// 1) Update the header text
src = src.replace(
  '<h1>${isRegister ? "🆕 إنشاء مخزن جديد" : "🔐 تسجيل الدخول للمخزن"}</h1>',
  '<h1>${isIndependentStore ? "🆕 إنشاء مخزن مستقل خاص بي" : isRegister ? "🆕 إنشاء مخزن جديد" : "🔐 تسجيل الدخول للمخزن"}</h1>'
);

// 2) Add isIndependentStore variable + info banner
src = src.replace(
  '  const isRegister = routePath === "/register";\n  const flash = authFlash;',
  '  const isRegister = routePath === "/register";\n  const isIndependentStore = routePath === "/register/store";\n  const flash = authFlash;'
);

// 3) Replace the register form header section
const oldFormHeader = `          ${isRegister ? \`
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
          </label>\` : ""}\n          \${isRegister ? \`<label>البريد الإلكتروني
            <input type="email" name="email" required placeholder="user@example.com" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>\` : \`<label>اسم المستخدم
            <input type="text" name="login" required autocomplete="username" placeholder="مثال: ahmed.ali" dir="ltr" style="width:100%;padding:0.5rem;margin-top:0.25rem;text-align:left;" />
          </label>\`}\n          <label>كلمة المرور
            <input type="password" name="password" required minlength="6" placeholder="••••••" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
          \${isRegister ? \`
          <label>تأكيد كلمة المرور
            <input type="password" name="password2" required minlength="6" placeholder="••••••" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
          <label>كلمة مرور المدير
            <input type="password" name="admin_password" required minlength="6" placeholder="••••••" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
          <label>تأكيد كلمة مرور المدير
            <input type="password" name="admin_password2" required minlength="6" placeholder="••••••" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>\` : ""}\n          <p id="auth-form-error" style="color:#d33;min-height:1.2em;margin:0;"></p>
          <button class="btn primary" type="submit">\${isRegister ? "تسجيل المخزن" : "دخول"}</button>
          <p class="muted" style="font-size:0.85rem;margin:0;">مصادقة حقيقية عبر Supabase — تُحمى قاعدة البيانات بسياسات الأمان (RLS).</p>
          <a class="btn" data-link href="\${isRegister ? "/login" : "/register"}">\${isRegister ? "لدي حساب بالفعل — تسجيل دخول" : "إنشاء مخزن جديد ←"}</a>
          <a class="btn" data-link href="/">← العودة للرئيسية</a>`;

const newFormHeader = `          \${isIndependentStore ? \`
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
          <p class="muted" style="font-size:0.8rem;margin:0;">تركها فارغة ← كلمة مرور مؤقتة مؤقتة (يغيرها بعد الدخول).</p>
          \` : \${isRegister ? \`
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
          </label>
          <label>البريد الإلكتروني
            <input type="email" name="email" required placeholder="user@example.com" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
          <label>كلمة المرور
            <input type="password" name="password" required minlength="6" placeholder="••••••" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
          <label>تأكيد كلمة المرور
            <input type="password" name="password2" required minlength="6" placeholder="••••••" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
          <label>كلمة مرور المدير
            <input type="password" name="admin_password" required minlength="6" placeholder="••••••" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
          <label>تأكيد كلمة مرور المدير
            <input type="password" name="admin_password2" required minlength="6" placeholder="••••••" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
          <p id="auth-form-error" style="color:#d33;min-height:1.2em;margin:0;"></p>
          <button class="btn primary" type="submit">تسجيل المخزن</button>
          <p class="muted" style="font-size:0.85rem;margin:0;">مصادقة حقيقية عبر Supabase — تُحمى قاعدة البيانات بسياسات الأمان (RLS).</p>
          <a class="btn" data-link href="/login">لدي حساب بالفعل — تسجيل دخول</a>
          <a class="btn" data-link href="/">← العودة للرئيسية</a>
          \` : \`
          <label>اسم المستخدم
            <input type="text" name="login" required autocomplete="username" placeholder="مثال: ahmed.ali" dir="ltr" style="width:100%;padding:0.5rem;margin-top:0.25rem;text-align:left;" />
          </label>
          <label>كلمة المرور
            <input type="password" name="password" required minlength="6" placeholder="••••••" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
          <p id="auth-form-error" style="color:#d33;min-height:1.2em;margin:0;"></p>
          <button class="btn primary" type="submit">دخول</button>
          <p class="muted" style="font-size:0.85rem;margin:0;">مصادقة حقيقية عبر Supabase — تُحمى قاعدة البيانات بسياسات الأمان (RLS).</p>
          <a class="btn" data-link href="/register">إنشاء مخزن جديد ←</a>
          <a class="btn" data-link href="/">← العودة للرئيسية</a>
          \`}\n          <p id="auth-form-error" style="color:#d33;min-height:1.2em;margin:0;"></p>
          <button class="btn primary" type="submit">\${isIndependentStore ? "إنشاء مخزن مستقل" : isRegister ? "تسجيل المخزن" : "دخول"}</button>
          <p class="muted" style="font-size:0.85rem;margin:0;">مصادقة حقيقية عبر Supabase — تُحمى قاعدة البيانات بسياسات الأمان (RLS).</p>
          <a class="btn" data-link href="\${isIndependentStore ? "/register" : isRegister ? "/login" : "/register"}">\${isIndependentStore ? "عرض خيارات التسجيل الأخرى" : isRegister ? "لدي حساب بالفعل — تسجيل دخول" : "إنشاء مخزن جديد ←"}</a>
          <a class="btn" data-link href="/">← العودة للرئيسية</a>`;

if (!src.includes(oldFormHeader.slice(0, 100))) {
  console.error('ERROR: Could not find the old form header.');
  process.exit(1);
}

src = src.replace(oldFormHeader, newFormHeader);

// 4) Update wireGovernorateSearch call
src = src.replace(
  '  if (isRegister) wireGovernorateSearch();',
  '  if (isIndependentStore || isRegister) wireGovernorateSearch();'
);

// 5) Replace the submit handler for register
const oldSubmitRegister = `      if (isRegister) {
        // 1) إنشاء حساب المخزن (Supabase Auth signUp)
        const { data, error } = await client.auth.signUp({
          email: email,
          password: password,
          options: { data: { warehouse_name: warehouse, phone: phone, governorate: governorate, full_name: warehouse, role: "manager" } }
        });
        if (error) { setError(authErrorMessage(error)); return; }
        const user = data && data.user;
        if (user) {
          try {
            const adminHash = await sha256b64url(adminPassword);
            if (user && data && data.session) {
              const ws = await client.rpc("wms_register_workspace", {
                p_name: warehouse,
                p_phone: phone,
                p_governorate: governorate,
                p_admin_hash: adminHash
              });
              if (ws && ws.error) console.warn("wms_register_workspace:", ws.error.message);
            }
          } catch (_) { }
        }
        try { await client.auth.signOut(); } catch (_) { }
        clearSession();
        clearStep2Mark();
        authFlash = data && data.session
          ? "تم إنشاء الحساب بنجاح، يرجى تسجيل الدخول"
          : "تم إنشاء الحساب بنجاح، يرجى تسجيل الدخول بعد تفعيل حسابك عبر البريد";
        navigate("/login");
        return;
      }`;

const newSubmitRegister = `      if (isIndependentStore) {
        const res = await api("/api/auth/register-store", {
          method: "POST",
          body: { email, password, store_name: storeName, phone, governorate, admin_password: adminPassword }
        });
        clearSession();
        clearStep2Mark();
        authFlash = "تم إنشاء مخزنك المستقل بنجاح: " + (res.store_name || storeName) + " (الرمز: " + (res.warehouse_code || "—") + ")";
        navigate("/login");
        return;
      }

      if (isRegister) {
        const { data, error } = await client.auth.signUp({
          email: email,
          password: password,
          options: { data: { warehouse_name: warehouse, phone: phone, governorate: governorate, full_name: warehouse, role: "manager" } }
        });
        if (error) { setError(authErrorMessage(error)); return; }
        const user = data && data.user;
        if (user) {
          try {
            const adminHash = await sha256b64url(adminPassword);
            if (user && data && data.session) {
              const ws = await client.rpc("wms_register_workspace", {
                p_name: warehouse,
                p_phone: phone,
                p_governorate: governorate,
                p_admin_hash: adminHash
              });
              if (ws && ws.error) console.warn("wms_register_workspace:", ws.error.message);
            }
          } catch (_) { }
        }
        try { await client.auth.signOut(); } catch (_) { }
        clearSession();
        clearStep2Mark();
        authFlash = data && data.session
          ? "تم إنشاء الحساب بنجاح، يرجى تسجيل الدخول"
          : "تم إنشاء الحساب بنجاح، يرجى تسجيل الدخول بعد تفعيل حسابك عبر البريد";
        navigate("/login");
        return;
      }`;

if (!src.includes(oldSubmitRegister.slice(0, 50))) {
  console.error('ERROR: Could not find old submit register block.');
  process.exit(1);
}

src = src.replace(oldSubmitRegister, newSubmitRegister);

// 6) Add variable declarations for the independent store form
const oldVarDecls = `    let phone = "", governorate = "", password2 = "", adminPassword = "", adminPassword2 = "";\n    if (isRegister) {`;

const newVarDecls = `    let phone = "", governorate = "", password2 = "", adminPassword = "", adminPassword2 = "";\n\n    if (isIndependentStore) {\n      const email = String(fd.get("email") || "").trim();\n      const password = String(fd.get("password") || "");\n      const storeName = String(fd.get("store_name") || "").trim();\n      const phone = String(fd.get("phone") || "").trim().replace(/[^0-9]/g, "");\n      const governorate = String(fd.get("governorate") || "").trim();\n      const adminPassword = String(fd.get("admin_password") || "").trim();\n\n      if (!email || password.length < 6) { setError("أدخل البريد وكلمة مرور من 6 أحرف على الأقل"); return; }\n      if (!storeName) { setError("أدخل اسم المخزن"); return; }\n      if (phone && !/^01[0125][0-9]{8}$/.test(phone)) { setError("رقم التليفون غير صحيح — مثال: 01012345678"); return; }\n      if (governorate && !GOVERNORATES.some(g => g.indexOf(governorate) !== -1)) { setError("المحافظة غير موجودة — اختر من القائمة"); return; }\n    }\n\n    if (isRegister) {`;

if (!src.includes(oldVarDecls)) {
  console.error('ERROR: Could not find variable declaration block.');
  process.exit(1);
}

src = src.replace(oldVarDecls, newVarDecls);

fs.writeFileSync(APP_JS, src, 'utf8');
console.log('✅ public/app.js patched successfully');
