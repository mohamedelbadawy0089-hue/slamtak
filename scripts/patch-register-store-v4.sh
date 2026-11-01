#!/bin/bash
# Patch public/app.js to add /register/store independent warehouse registration
set -euo pipefail
APP_JS="public/app.js"
TMP="public/app.js.patched"

if ! grep -q 'const isRegister = routePath === "/register";' "$APP_JS"; then
  echo "FAIL: expected register form not found"
  exit 1
fi

cp "$APP_JS" "$TMP"

# 1) Add isIndependentStore variable
if ! grep -q 'const isIndependentStore = routePath === "/register/store";' "$TMP"; then
  sed -i 's/^  const isRegister = routePath === "\/register";$/  const isRegister = routePath === "\/register";\n  const isIndependentStore = routePath === "\/register\/store";/' "$TMP"
fi

# 2) Update header
sed -i 's/\${isRegister ? "🆕 إنشاء مخزن جديد" : "🔐 تسجيل الدخول للمخزن"}/\${isIndependentStore ? "🆕 إنشاء مخزن مستقل خاص بي" : isRegister ? "🆕 إنشاء مخزن جديد" : "🔐 تسجيل الدخول للمخزن"}/g' "$TMP"

# 3) wireGovernorateSearch for both
sed -i 's/  if (isRegister) wireGovernorateSearch();/  if (isIndependentStore || isRegister) wireGovernorateSearch();÷' "$TMP"

sed -i 's/  if (isRegister) wireGovernorateSearch();/  if (isIndependentStore || isRegister) wireGovernorateSearch();/' "$TMP"

# 4) Add independent store HTML block
python3 - "$TMP" <<'PYEOF'
import sys

with open(sys.argv[1], 'r', encoding='utf-8') as f:
    src = f.read()

IND_STORE_BLOCK = """          ${isIndependentStore ? `
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
          ` : ${isRegister ? `"""

anchor = '          ${isRegister ? `'
i = src.find(anchor)
if i == -1:
    print("FAIL: isRegister form block not found")
    sys.exit(1)

src = src[:i] + IND_STORE_BLOCK + src[i:]

src = src.replace(
    '<button class="btn primary" type="submit">${isRegister ? "تسجيل المخزن" : "دخول"}</button>',
    '<button class="btn primary" type="submit">${isIndependentStore ? "إنشاء مخزن مستقل" : isRegister ? "تسجيل المخزن" : "دخول"}</button>'
)
src = src.replace(
    '<a class="btn" data-link href="${isRegister ? "/login" : "/register"}">${isRegister ? "لدي حساب بالفعل — تسجيل دخول" : "إنشاء مخزن جديد ←"}</a>',
    '<a class="btn" data-link href="${isIndependentStore ? "/register" : isRegister ? "/login" : "/register"}">${isIndependentStore ? "عرض خيارات التسجيل الأخرى" : isRegister ? "لدي حساب بالفعل — تسجيل دخول" : "إنشاء مخزن جديد ←"}</a>'
)

var_decl = '    let phone = "", governorate = "", password2 = "", adminPassword = "", adminPassword2 = "";'
ind_js = """    if (isIndependentStore) {
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
"""
if var_decl in src:
    src = src.replace(var_decl, ind_js + var_decl)

api_anchor = '      if (isRegister) {\n        // 1) إنشاء حساب المخزن (Supabase Auth signUp)'
ind_api = """      if (isIndependentStore) {
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

"""
if api_anchor in src:
    src = src.replace(api_anchor, ind_api + api_anchor)

parts = src.split('<p id="auth-form-error"')
if len(parts) > 2:
    first = parts[0] + parts[1]
    rest = ''.join(parts[2:])
    end_first = first.find('</p>') + 4
    src = first[:end_first] + rest

with open(sys.argv[1], 'w', encoding='utf-8') as f:
    f.write(src)
print("Python patch applied")
PYEOF

mv "$TMP" "$APP_JS"
echo "✅ public/app.js patched successfully"
