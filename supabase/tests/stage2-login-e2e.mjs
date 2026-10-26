// اختبار تجريبي شامل لتسجيل الدخول المكوّن من مرحلتين على موقع منشور
// الاستخدام: node supabase/tests/stage2-login-e2e.mjs <site-url> [--keep]
import { createHash, randomUUID } from "crypto";
import { readFileSync } from "fs";

const SITE = (process.argv[2] || "").replace(/\/$/, "");
const KEEP = process.argv.includes("--keep");
if (!SITE.startsWith("http")) {
  console.error("استخدم: node stage2-login-e2e.mjs https://site-....freebuff.page");
  process.exit(2);
}

// بيانات الإدارة لحذف حساب الاختبار بعد الاختبار
const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  if (line.startsWith("#") || !line.trim()) continue;
  const i = line.indexOf("=");
  if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}
const ADMIN = {
  url: env.SUPABASE_URL,
  key: env.SUPABASE_SERVICE_ROLE_KEY
};

const sha = (s) => createHash("sha256").update(s).digest("hex");
const stamp = Date.now().toString(36);
const ACCOUNT = {
  email: `stage2-test-${stamp}@example.com`,
  password: "TestLogin#1",
  warehousePassword: "Warehouse#1",
  wrongPassword: "WrongPass#9"
};
let userId = null;
let warehouseId = null;
let results = 0;
let failures = 0;

async function call(path, { method = "POST", body, token } = {}) {
  const r = await fetch(SITE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await r.json(); } catch (_) {}
  return { status: r.status, data };
}
function check(label, cond, extra) {
  const ok = !!cond;
  results += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

try {
  // 1) تسجيل مخزن جديد (حساب اختبار)
  const reg = await call("/api/auth/register", {
    body: {
      name: "مخزن اختبار المرحلة الثانية",
      email: ACCOUNT.email,
      password: ACCOUNT.password,
      adminPasswordHash: sha(ACCOUNT.warehousePassword)
    }
  });
  userId = reg.data && reg.data.id;
  warehouseId = reg.data && reg.data.warehouse_id;
  check("1) التسجيل ينشئ حساباً", reg.status === 201 && !!userId, `status=${reg.status}`);
  check("1) المخزن أُنشئ", !!(reg.data && reg.data.warehouse_id), `warehouse=${reg.data && reg.data.warehouse_id}`);

  // 2) المرحلة الأولى: إيميل + كلمة مرور → يجب ألا تُسلّم الرموز
  const login = await call("/api/auth/login", { body: { email: ACCOUNT.email, password: ACCOUNT.password } });
  check("2) المرحلة الأولى ترجع stage=2", login.data && login.data.stage === 2, `status=${login.status}`);
  check("2) المرحلة الأولى وضع verify", login.data && login.data.mode === "verify", `mode=${login.data && login.data.mode}`);
  check("2) لا تُسلّم رموز الجلسة قبل المرحلة الثانية", !(login.data && login.data.access_token));
  check("2) تذكرة مشفّرة موجودة", !!(login.data && login.data.ticket && String(login.data.ticket).includes(".")));
  check("2) المخزن في المرحلة الأولى هو مخزنه", login.data && login.data.warehouse_id === reg.data.warehouse_id, `login=${login.data && login.data.warehouse_id} own=${reg.data.warehouse_id}`);

  // 3) كلمة مرور مخزن خاطئة → رفض
  const wrong = await call("/api/auth/verify-warehouse", {
    body: { ticket: login.data.ticket, warehousePasswordHash: sha(ACCOUNT.wrongPassword) }
  });
  check("3) كلمة مرور خاطئة مرفوضة", wrong.status === 401, `status=${wrong.status} msg=${wrong.data && wrong.data.error}`);

  // 3ب) تذكرة مزيفة مرفوضة
  const fake = await call("/api/auth/verify-warehouse", {
    body: { ticket: "aaaa.bbbb", warehousePasswordHash: sha(ACCOUNT.warehousePassword) }
  });
  check("3ب) تذكرة مزيفة مرفوضة", fake.status === 401, `status=${fake.status}`);

  // 4) كلمة مرور صحيحة → تسليم الجلسة
  const ok2 = await call("/api/auth/verify-warehouse", {
    body: { ticket: login.data.ticket, warehousePasswordHash: sha(ACCOUNT.warehousePassword) }
  });
  check("4) المرحلة الثانية تنجح", ok2.status === 200, `status=${ok2.status} msg=${ok2.data && ok2.data.error}`);
  check("4) رموز الجلسة تسلّمت", !!(ok2.data && ok2.data.access_token));
  check("4) الدور والمخزن صحيحان", ok2.data && ok2.data.role === "manager" && !!ok2.data.warehouse_id, `role=${ok2.data && ok2.data.role}`);
  check("4) المخزن هو مخزنه هو (لا مخزن عام)", ok2.data && ok2.data.warehouse_id === reg.data.warehouse_id, `session=${ok2.data && ok2.data.warehouse_id} own=${reg.data.warehouse_id}`);
  check("4) /api/auth/me يعمل بالرمز بعد المرحلة الثانية", (await call("/api/auth/me", { method: "GET", token: ok2.data.access_token })).status === 200);

  // 5) وضع الإعداد: بلا أي كلمة مرور صالحة → شاشة إنشاء كلمة مرور المخزن
  if (ADMIN.url && ADMIN.key && reg.data.warehouse_id) {
    await fetch(`${ADMIN.url}/rest/v1/warehouses?id=eq.${reg.data.warehouse_id}`, {
      method: "PATCH",
      headers: { apikey: ADMIN.key, authorization: "Bearer " + ADMIN.key, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({ password_hash: null })
    });
    await fetch(`${ADMIN.url}/rest/v1/users?id=eq.${userId}`, {
      method: "PATCH",
      headers: { apikey: ADMIN.key, authorization: "Bearer " + ADMIN.key, "content-type": "application/json", prefer: "return=minimal" },
      // users.password_hash عمود NOT NULL — نحاكي به حساباً قديماً بلا كلمة مرور مخزن صالحة
      body: JSON.stringify({ password_hash: "$2b$10$legacylegacylegacylegacylegacylegacylegacylegacyl" })
    });
    const login2 = await call("/api/auth/login", { body: { email: ACCOUNT.email, password: ACCOUNT.password } });
    check("5) بلا كلمة مرور → وضع setup", login2.data && login2.data.stage === 2 && login2.data.mode === "setup", `mode=${login2.data && login2.data.mode}`);
    const setup = await call("/api/auth/verify-warehouse", {
      body: { ticket: login2.data.ticket, warehousePasswordHash: sha(ACCOUNT.warehousePassword) }
    });
    check("5) إنشاء كلمة المرور يكمل الدخول", setup.status === 200 && !!setup.data.access_token, `status=${setup.status}`);
    const after = await fetch(`${ADMIN.url}/rest/v1/warehouses?id=eq.${reg.data.warehouse_id}&select=password_hash`, {
      headers: { apikey: ADMIN.key, authorization: "Bearer " + ADMIN.key }
    }).then((r) => r.json());
    check("5) كلمة المرور حُفظت على المخزن", !!(after[0] && after[0].password_hash === sha(ACCOUNT.warehousePassword)));
  } else {
    console.log("⚠️ تخطي اختبار وضع الإعداد (لا توجد بيانات إدارة)");
  }
} catch (e) {
  failures += 1;
  console.log("❌ خطأ في الاختبار:", e.message);
} finally {
  // 6) تنظيف حساب الاختبار بالكامل (لا نترك أي بيانات في قاعدة العميل)
  if (userId && !KEEP) {
    const del = async (path) => {
      try {
        await fetch(ADMIN.url + path, {
          method: "DELETE",
          headers: { apikey: ADMIN.key, authorization: "Bearer " + ADMIN.key }
        });
      } catch (_) {}
    };
    await del(`/rest/v1/user_warehouses?user_id=eq.${userId}`);
    await del(`/rest/v1/users?id=eq.${userId}`);
    await del(`/rest/v1/profiles?id=eq.${userId}`);
    if (warehouseId) await del(`/rest/v1/warehouses?id=eq.${warehouseId}`);
    await del(`/auth/v1/admin/users/${userId}`);
    console.log("🧹 تم تنظيف حساب الاختبار وكل صفوفه");
  }
}

console.log(`\nالنتيجة: ${results - failures}/${results} ناجح${failures ? ` — ${failures} فاشل` : ""}`);
process.exit(failures ? 1 : 0);
