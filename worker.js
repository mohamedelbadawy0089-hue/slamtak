// Worker.js for Freebuff ERP Application
// Features: SPA routing, AES-GCM ticket verification, error protection

// مساعد esbuild `keepNames` الذي كان يُستدعى 43 مرة دون تعريفه، فيفشل تحميل
// الوحدة عند الرفع (Cloudflare 10021 / 400) — التعريف هنا يعيد التقييم بنجاح.
var __name = /* @__PURE__ */ (() => {
  return (target, value) => {
    target.__name = value;
    return target;
  };
})();

var SUPABASE_URL = "https://iksjhjxwphmvthryfeae.supabase.co";
var CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, apikey"
};
var VALID_ROLES = ["super-admin", "manager", "employee"];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS }
  });
}
__name(json, "json");

function serviceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json"
  };
}
__name(serviceHeaders, "serviceHeaders");

async function supa(path, env, { method = "GET", body, userToken, extraHeaders } = {}) {
  const headers = serviceHeaders(env);
  if (userToken) headers.authorization = `Bearer ${userToken}`;
  Object.assign(headers, extraHeaders || {});
  const res = await fetch(SUPABASE_URL + path, {
    method,
    headers,
    body: body === void 0 ? void 0 : JSON.stringify(body)
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
  }
  return { ok: res.ok, status: res.status, data };
}
__name(supa, "supa");

function errMsg(data, fallback) {
  if (!data) return fallback;
  return data.msg || data.message || data.error_description || data.error || fallback;
}
__name(errMsg, "errMsg");

// قراءة قائمة من قاعدة البيانات: أي فشل أو استجابة غير متوقعة يرجع خطأً صريحاً
// بدلاً من مصفوفة فارغة تبدو كأن الجدول فارغ فعلاً (قراءة صفراً زائفة).
function readRows(res, label) {
  if (!res.ok) {
    // التفاصيل تُسجَّل في سجلات الخادم فقط — لا نعيد أسماء الجداول
    // والأعمدة (تفاصيل PostgREST) إلى المتصفح.
    console.error(`[api] read "${label}" failed (${res.status}):`, errMsg(res.data, "no detail"));
    return { rows: null, error: json({ error: "Failed to read " + label }, 502) };
  }
  if (!Array.isArray(res.data)) {
    return { rows: null, error: json({ error: "Unexpected database response while reading " + label }, 502) };
  }
  return { rows: res.data, error: null };
}
__name(readRows, "readRows");

function metaRole(meta) {
  if (!meta || typeof meta !== "object") return null;
  const r = String(meta.role || "").trim();
  if (VALID_ROLES.includes(r)) return r;
  if (meta.admin_password_hash) return "manager";
  return null;
}
__name(metaRole, "metaRole");

async function upsertProfile(env, { id, role, name, phone, governorate }) {
  const body = { id };
  if (VALID_ROLES.includes(role)) body.role = role;
  if (name) body.full_name = name;
  if (phone) body.phone = phone;
  if (governorate) body.governorate = governorate;
  try {
    const r = await supa("/rest/v1/profiles?on_conflict=id", env, {
      method: "POST",
      body,
      extraHeaders: { prefer: "resolution=merge-duplicates,return=minimal" }
    });
    return r.ok;
  } catch (_) {
    return false;
  }
}
__name(upsertProfile, "upsertProfile");

async function fetchAuthUser(token, env) {
  const res = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch (_) {
    return null;
  }
}
__name(fetchAuthUser, "fetchAuthUser");

async function getRole(uid, env, userToken, metaHint) {
  try {
    const r = await supa(`/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=role`, env);
    const row = r.ok && Array.isArray(r.data) ? r.data[0] : null;
    if (row && typeof row.role === "string" && VALID_ROLES.includes(row.role)) return row.role;
  } catch (_) {
  }
  let meta = metaHint;
  if (!meta && userToken) {
    const u = await fetchAuthUser(userToken, env);
    meta = u && u.raw_user_meta_data;
  }
  const role = metaRole(meta) || "employee";
  await upsertProfile(env, {
    id: uid,
    role,
    name: meta && meta.name,
    phone: meta && meta.phone,
    governorate: meta && meta.governorate
  });
  return role;
}
__name(getRole, "getRole");

async function requireUser(request, env) {
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  const u = await fetchAuthUser(token, env);
  if (!u || !u.id) return null;
  return { id: u.id, email: u.email, token, meta: u.raw_user_meta_data || null };
}
__name(requireUser, "requireUser");

var tenantCache = null;
async function getTenantId(env) {
  if (tenantCache) return tenantCache;
  try {
    const w = await supa("/rest/v1/warehouses?select=tenant_id&limit=1", env);
    const row = w.ok && Array.isArray(w.data) ? w.data[0] : null;
    if (row && row.tenant_id) {
      tenantCache = row.tenant_id;
      return tenantCache;
    }
  } catch (_) {
  }
  try {
    const t = await supa("/rest/v1/tenants?select=id&order=created_at.asc&limit=1", env);
    const row = t.ok && Array.isArray(t.data) ? t.data[0] : null;
    if (row && row.id) {
      tenantCache = row.id;
      return tenantCache;
    }
  } catch (_) {
  }
  return null;
}
__name(getTenantId, "getTenantId");

async function defaultWarehouseId(userId, env) {
  try {
    const r = await supa(
      `/rest/v1/user_warehouses?user_id=eq.${encodeURIComponent(userId)}&select=warehouse_id,is_default&order=is_default.desc&limit=1`,
      env
    );
    const row = r.ok && Array.isArray(r.data) ? r.data[0] : null;
    if (row && row.warehouse_id) return row.warehouse_id;
  } catch (_) {
  }
  try {
    const r = await supa("/rest/v1/warehouses?is_main=eq.true&select=id", env);
    const row = r.ok && Array.isArray(r.data) ? r.data[0] : null;
    if (row && row.id) return row.id;
  } catch (_) {
  }
  return null;
}
__name(defaultWarehouseId, "defaultWarehouseId");

async function productName(pid, env) {
  try {
    const r = await supa(`/rest/v1/products?id=eq.${encodeURIComponent(pid)}&select=name,name_ar&limit=1`, env);
    const row = r.ok && Array.isArray(r.data) ? r.data[0] : null;
    if (row) return row.name_ar || row.name || "";
  } catch (_) {
  }
  return "";
}
__name(productName, "productName");

async function productStockMap(env, warehouseId) {
  try {
    const r = await supa(
      `/rest/v1/inventory?select=product_id,available_quantity,unit_cost,cost_price&warehouse_id=eq.${encodeURIComponent(warehouseId)}`,
      env
    );
    if (r.ok && Array.isArray(r.data)) {
      const map = {};
      for (const row of r.data) {
        map[row.product_id] = {
          available_quantity: row.available_quantity || 0,
          unit_cost: row.unit_cost || 0,
          cost_price: row.cost_price || 0
        };
      }
      return map;
    }
  } catch (_) {
  }
  return {};
}
__name(productStockMap, "productStockMap");

// AES-GCM ticket verification with error protection
function isSha256Hex(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value.trim());
}
__name(isSha256Hex, "isSha256Hex");

async function ticketKey(env) {
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("login-ticket:v1:" + (env.SUPABASE_SERVICE_ROLE_KEY || "")));
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
__name(ticketKey, "ticketKey");

function b64urlEncode(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
}
__name(b64urlEncode, "b64urlEncode");

function b64urlDecode(text) {
  const s = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - s.length % 4) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
__name(b64urlDecode, "b64urlDecode");

async function sealTicket(payload, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await ticketKey(env), new TextEncoder().encode(JSON.stringify(payload)))
  );
  return b64urlEncode(iv) + "." + b64urlEncode(ct);
}
__name(sealTicket, "sealTicket");

async function openTicket(text, env) {
  try {
    const [ivPart, ctPart] = String(text || "").split(".");
    if (!ivPart || !ctPart) return null;
    const plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64urlDecode(ivPart) }, await ticketKey(env), b64urlDecode(ctPart))
    );
    const payload = JSON.parse(new TextDecoder().decode(plain));
    if (!payload || !payload.uid || !payload.at) return null;
    if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
    return payload;
  } catch (_) {
    return null;
  }
}
__name(openTicket, "openTicket");

// Warehouse password hashes with try/catch protection
async function warehousePasswordHashes(userId, env) {
  try {
    const r = await supa(`/rest/v1/warehouse_password_hashes?user_id=eq.${encodeURIComponent(userId)}&select=hash&limit=10`, env);
    if (r.ok && Array.isArray(r.data)) {
      return r.data.map(row => row.hash);
    }
  } catch (e) {
    console.error("Error fetching warehouse password hashes:", e && e.message);
  }
  return [];
}
__name(warehousePasswordHashes, "warehousePasswordHashes");

// حفظ أول كلمة مرور مخزن في مسار الإعداد (setup) — كانت الدالة مفقودة تماماً
// فكان handleVerifyWarehouse يرمي ReferenceError ويعيد 500. نفس أعمدة الإدراج
// المستخدمة في الهجرات: warehouse_password_hashes(user_id, hash).
async function storeWarehousePassword(uid, hash, env) {
  try {
    const r = await supa("/rest/v1/warehouse_password_hashes", env, {
      method: "POST",
      body: { user_id: uid, hash },
      extraHeaders: { prefer: "return=minimal" }
    });
    if (!r.ok) console.error("Error storing warehouse password:", r.status, errMsg(r.data, "no detail"));
    return !!r.ok;
  } catch (e) {
    console.error("Error storing warehouse password:", e && e.message);
    return false;
  }
}
__name(storeWarehousePassword, "storeWarehousePassword");

// Login flow - two-stage authentication
var TICKET_TTL_MS = 10 * 60 * 1e3;

async function handleRegister(request, env) {
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "Invalid JSON body" }, 400); }
  const { email, password, name } = body || {};
  if (!email || !password || !name) return json({ error: "Email, password, and name are required" }, 400);
  try {
    // supa() تعيد {ok,status,data} لا {data,error} — كان فشل التسجيل يمرّ صامتاً،
    // واسم المستخدم يُهمل لأنه لا يُرسل إلى GoTrue في حقلا `data`.
    const r = await supa("/auth/v1/signup", env, {
      method: "POST",
      body: { email, password, data: { full_name: name } }
    });
    if (!r.ok) {
      console.error("[api] signup failed:", r.status, errMsg(r.data, "no detail"));
      return json({ error: errMsg(r.data, "Failed to create user") }, 400);
    }
    // شكلان لاستجابة GoTrue: {user:{...}} عند إرجاع جلسة، أو المستخدم نفسه عند تأكيد البريد
    const created = r.data || {};
    const u = created.user || (created.id ? created : null);
    if (!u) return json({ error: "Failed to create user" }, 400);
    return json({ id: u.id, email: u.email, name: name, role: "viewer" }, 201);
  } catch (error) {
    console.error("Registration error:", error && error.message);
    return json({ error: "Internal server error" }, 500);
  }
}
__name(handleRegister, "handleRegister");

async function handleLogin(request, env) {
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "Invalid JSON body" }, 400); }
  const { email, password } = body || {};
  if (!email || !password) return json({ error: "Email and password are required" }, 400);
  try {
    // GoTrue لا يملك مسار /auth/v1/login — يُرجع 404 صفحة، فكان الدخول من هذه
    // الواجهة عاجزاً تماماً. المسار الصحيح هو /token?grant_type=password.
    const r = await supa("/auth/v1/token?grant_type=password", env, {
      method: "POST",
      body: { email, password }
    });
    if (!r.ok) {
      console.error("[api] login failed:", r.status, errMsg(r.data, "no detail"));
      return json({ error: errMsg(r.data, "Login failed") }, 400);
    }
    const session = r.data || {};
    const authUser = session.user || {};
    if (!session.access_token || !authUser.id) return json({ error: "Login failed" }, 400);
    
    // تذكرة المرحلة الثانية: تحمل الآن التوكنين الحقيقيين والدور والاسم والمخزن،
    // وإلا عادت المرحلة الثانية access_token = طابع زمني وrole/warehouse_id مفقودة.
    const [role, warehouseId, hashes] = await Promise.all([
      getRole(authUser.id, env, session.access_token),
      defaultWarehouseId(authUser.id, env),
      warehousePasswordHashes(authUser.id, env)
    ]);
    const meta = authUser.user_metadata || {};
    const ticket = await sealTicket({
      uid: authUser.id,
      email: authUser.email,
      name: meta.full_name || meta.name || authUser.email || "",
      role,
      warehouse_id: warehouseId,
      access_token: session.access_token,
      refresh_token: session.refresh_token || "",
      at: Date.now(),
      exp: Date.now() + TICKET_TTL_MS,
      mode: "login"
    }, env);
    
    if (!ticket) return json({ error: "Failed to create ticket" }, 500);
    
    // إذا لم يكن هناك كلمة مخزن مطلوبة فالدخول منتهٍ في المرحلة الأولى، فلا معنى
    // لإرجاع تذكرة بلا توكنين (العميل لا يستطيع إتمام الدخول أبداً).
    const out = {
      stage: 1,
      ticket,
      requires_warehouse_password: hashes.length > 0,
      base: { id: authUser.id, email: authUser.email }
    };
    if (!hashes.length) {
      out.role = role;
      out.warehouse_id = warehouseId;
      out.access_token = session.access_token;
      out.refresh_token = session.refresh_token || "";
    }
    return json(out);
  } catch (error) {
    console.error("Login error:", error && error.message);
    return json({ error: "Internal server error" }, 500);
  }
}
__name(handleLogin, "handleLogin");

async function handleVerifyWarehouse(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { ticket, warehousePasswordHash } = body || {};
  // Open ticket with error protection
  let t;
  try {
    t = ticket ? await openTicket(ticket, env) : null;
  } catch (e) {
    console.error("Error opening ticket:", e && e.message);
    return json({ error: "Session expired - please login again" }, 401);
  }
  if (!t) return json({ error: "Session expired - please login again" }, 401);
  
  // Look up warehouse password hashes with try/catch protection
  const hashes = await warehousePasswordHashes(t.uid, env);
  const submitted = String(warehousePasswordHash || "").trim().toLowerCase();
  
  if (hashes.length) {
    if (!submitted || !hashes.includes(submitted)) {
      return json({ error: "Warehouse password incorrect" }, 401);
    }
  } else {
    if (t.mode !== "setup" || t.role !== "manager" && t.role !== "super-admin") {
      return json({ error: "Cannot complete login this way" }, 403);
    }
    if (!isSha256Hex(submitted)) {
      return json({ error: "Warehouse password must be at least 6 characters" }, 400);
    }
    if (!await storeWarehousePassword(t.uid, submitted, env)) {
      return json({ error: "Failed to save warehouse password" }, 500);
    }
  }
  // التذاكر القديمة كانت تحمل at = Date.now() أي أن access_token يعود طابعاً زمنياً،
  // وrole/warehouse_id غير موجودين أصلاً. نرفض أي تذكرة بلا توكن حقيقي.
  if (!t.access_token) return json({ error: "Session expired - please login again" }, 401);
  return json({
    id: t.uid,
    email: t.email,
    name: t.name,
    role: t.role || "employee",
    warehouse_id: t.warehouse_id || null,
    access_token: t.access_token,
    refresh_token: t.refresh_token || ""
  });
}
__name(handleVerifyWarehouse, "handleVerifyWarehouse");

async function handleSetWarehousePassword(request, env, user) {
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "Invalid JSON body" }, 400); }
  const { password } = body || {};
  if (!password || password.length < 6) {
    return json({ error: "Warehouse password must be at least 6 characters" }, 400);
  }
  try {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
    const h = b64urlEncode(new Uint8Array(hash));
    const r = await supa("/rest/v1/warehouse_password_hashes", env, {
      method: "POST",
      body: { user_id: user.id, hash: h },
      extraHeaders: { prefer: "return=minimal" }
    });
    if (!r.ok) return json({ error: "Failed to save password" }, 500);
  } catch (e) {
    console.error("Error storing warehouse password:", e && e.message);
    return json({ error: "Internal server error" }, 500);
  }
  // user من requireUser لا يحمل role ولا warehouse_id — كانتا يظهران undefined
  const role = await getRole(user.id, env, user.token);
  const warehouse_id = await defaultWarehouseId(user.id, env);
  return json({ id: user.id, email: user.email, role, warehouse_id });
}
__name(handleSetWarehousePassword, "handleSetWarehousePassword");

// Additional handler functions (essential API endpoints)
// في المخطط الحيّ لا يوجد مفتاح خارجي من inventory_movements إلى products أو
// warehouses، لذلك كان استعلام الـ embed يفشل كلّياً (PGRST200). نقرأ الصفوف
// كما هي ثم نجلب الأسماء باستعلامين منفصلين ونربطها يدوياً بالنتيجة نفسها.
async function lookupByIds(env, table, ids, columns) {
  const map = new Map();
  if (!ids.length) return map;
  const list = ids.map((i) => `"${i}"`).join(",");
  const r = await supa(`/rest/v1/${table}?select=${columns.join(",")}&id=in.(${list})&limit=500`, env);
  const got = readRows(r, table);
  if (got.error || !Array.isArray(got.rows)) return map;
  for (const row of got.rows) map.set(row.id, row);
  return map;
}
__name(lookupByIds, "lookupByIds");

async function handleMovementsList(env, url) {
  const r = await supa("/rest/v1/inventory_movements?select=*&order=created_at.desc&limit=100", env);
  const got = readRows(r, "movements");
  if (got.error) return got.error;
  const rows = Array.isArray(got.rows) ? got.rows : [];
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  const productIds = uniq(rows.map((m) => m.product_id));
  const warehouseIds = uniq(rows.flatMap((m) => [m.warehouse_id, m.from_warehouse_id, m.to_warehouse_id]));
  const products = await lookupByIds(env, "products", productIds, ["id", "name", "name_ar"]);
  const warehouses = await lookupByIds(env, "warehouses", warehouseIds, ["id", "name"]);
  for (const row of rows) {
    const p = row.product_id ? products.get(row.product_id) : null;
    row.product = p ? { name: p.name, name_ar: p.name_ar } : null;
    const wid = row.warehouse_id || row.from_warehouse_id || row.to_warehouse_id;
    row.warehouse = wid && warehouses.get(wid) ? { name: warehouses.get(wid).name } : null;
  }
  return json({ movements: rows });
}
__name(handleMovementsList, "handleMovementsList");

async function handleProducts(env, url) {
  const r = await supa("/rest/v1/products?select=*,warehouse:warehouses(name)&order=created_at.desc&limit=100", env);
  const got = readRows(r, "products");
  if (got.error) return got.error;
  return json({ products: got.rows });
}
__name(handleProducts, "handleProducts");

async function handleCustomersList(env, url) {
  const r = await supa("/rest/v1/customers?select=*,warehouse:warehouses(name)&order=created_at.desc&limit=100", env);
  const got = readRows(r, "customers");
  if (got.error) return got.error;
  return json({ customers: got.rows });
}
__name(handleCustomersList, "handleCustomersList");

async function handleCustomersCreate(request, env, user) {
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "Invalid JSON body" }, 400); }
  const { name, name_ar, code, warehouse_id } = body || {};
  if (!name) return json({ error: "Customer name is required" }, 400);
  const tenantId = await getTenantId(env);
  if (!tenantId) return json({ error: "Unable to resolve tenant for this request" }, 503);
  const r = await supa("/rest/v1/customers", env, {
    method: "POST",
    body: { tenant_id: tenantId, name, name_ar, code, warehouse_id },
    extraHeaders: { prefer: "return=representation" }
  });
  if (!r.ok) {
    console.error("[api] create customer failed:", errMsg(r.data, "no detail"));
    return json({ error: "Failed to create customer" }, 502);
  }
  return json({ customer: Array.isArray(r.data) ? r.data[0] : r.data }, 201);
}
__name(handleCustomersCreate, "handleCustomersCreate");

async function handleOrdersList(env, url) {
  const status = (url.searchParams.get("status") || "").trim();
  const warehouseId = url.searchParams.get("warehouse_id") || "";
  // الجدول الفعلي في المخطط الحيّ هو sales_orders (orders غير موجود — PGRST205)
  let path = "/rest/v1/sales_orders?select=*,customer:customers(name,name_ar),warehouse:warehouses(name)&order=created_at.desc&limit=100";
  if (status) path += `&status=eq.${status}`;
  if (warehouseId) path += `&warehouse_id=eq.${encodeURIComponent(warehouseId)}`;
  const r = await supa(path, env);
  const got = readRows(r, "orders");
  if (got.error) return got.error;
  return json({ orders: got.rows });
}
__name(handleOrdersList, "handleOrdersList");

async function handleOrdersCreate(request, env, user) {
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "Invalid JSON body" }, 400); }
  const { customer_id, items, notes, warehouse_id, order_number } = body || {};
  if (!customer_id || !items || !Array.isArray(items) || items.length === 0) return json({ error: "Customer and items are required" }, 400);
  const tenantId = await getTenantId(env);
  if (!tenantId) return json({ error: "Unable to resolve tenant for this request" }, 503);
  const orderId = crypto.randomUUID();
  const orderBody = { id: orderId, tenant_id: tenantId, customer_id, status: "pending", created_by: user.id, notes };
  if (warehouse_id) orderBody.warehouse_id = warehouse_id;
  if (order_number) orderBody.order_number = order_number;
  const orderR = await supa("/rest/v1/sales_orders", env, { method: "POST", body: orderBody });
  if (!orderR.ok) {
    console.error("[api] create order failed:", errMsg(orderR.data, "no detail"));
    return json({ error: "Failed to create order" }, 502);
  }

  for (const item of items) {
    const { product_id, quantity } = item;
    if (!product_id || !quantity) continue;
    const itemId = crypto.randomUUID();
    const unitPrice = Number(item.unit_price) || 0;
    await supa("/rest/v1/sales_order_items", env, {
      method: "POST",
      body: {
        id: itemId,
        sales_order_id: orderId,
        product_id,
        quantity,
        unit_price: unitPrice,
        subtotal: unitPrice * Number(quantity)
      }
    });
  }
  return json({ success: true, order_id: orderId }, 201);
}
__name(handleOrdersCreate, "handleOrdersCreate");

// Sales quotes handlers
async function handleSalesQuotes(env, url) {
  const r = await supa("/rest/v1/sales_quotes?select=*,customer:customers(name,name_ar),warehouse:warehouses(name)&order=created_at.desc&limit=100", env);
  const got = readRows(r, "sales quotes");
  if (got.error) return got.error;
  return json({ quotes: got.rows });
}
__name(handleSalesQuotes, "handleSalesQuotes");

async function handleSalesQuoteGet(request, env, url) {
  const m = url.pathname.match(/^\/api\/sales_quotes\/([0-9a-fA-F-]{36})$/);
  if (!m) return json({ error: "Invalid ID" }, 400);
  const id = m[1];
  const q = await supa(`/rest/v1/sales_quotes?id=eq.${encodeURIComponent(id)}&select=*,customer:customers(id,name,name_ar),warehouse:warehouses(name)&limit=1`, env);
  // فصل فشل القراءة عن "غير موجود" — كان خطأ الاستعلام يظهر كـ 404 زائف
  if (!q.ok) {
    console.error("[api] read quote failed:", errMsg(q.data, "no detail"));
    return json({ error: "Failed to read quote" }, 502);
  }
  if (!Array.isArray(q.data) || q.data.length === 0) return json({ error: "Quote not found" }, 404);
  // العمود الفعلي في المخطط الحيّ هو quote_id (sales_quote_id غير موجود — 42703)
  const items = await supa(`/rest/v1/sales_quote_items?quote_id=eq.${encodeURIComponent(id)}&select=*,product:products(id,name,name_ar)&order=created_at.asc`, env);
  const gotItems = readRows(items, "quote items");
  if (gotItems.error) return gotItems.error;
  return json({ quote: q.data[0], items: gotItems.rows });
}
__name(handleSalesQuoteGet, "handleSalesQuoteGet");

// Sales invoices handlers
async function handleSalesInvoices(env, url) {
  const status = (url.searchParams.get("status") || "").trim();
  const customerId = url.searchParams.get("customer_id") || "";
  let path = "/rest/v1/sales_invoices?select=*,customer:customers(id,name,name_ar),warehouse:warehouses(name)&order=created_at.desc&limit=100";
  if (status) path += `&status=eq.${status}`;
  if (customerId) path += `&customer_id=eq.${encodeURIComponent(customerId)}`;
  const r = await supa(path, env);
  const got = readRows(r, "sales invoices");
  if (got.error) return got.error;
  return json({ invoices: got.rows });
}
__name(handleSalesInvoices, "handleSalesInvoices");

async function handleSalesInvoiceGet(request, env, url) {
  const m = url.pathname.match(/^\/api\/sales-invoices\/([0-9a-fA-F-]{36})$/);
  if (!m) return json({ error: "Invalid ID" }, 400);
  const id = m[1];
  const inv = await supa(`/rest/v1/sales_invoices?id=eq.${encodeURIComponent(id)}&select=*,customer:customers(id,name,name_ar,phone),warehouse:warehouses(name)&limit=1`, env);
  // فصل فشل القراءة عن "غير موجود"
  if (!inv.ok) {
    console.error("[api] read invoice failed:", errMsg(inv.data, "no detail"));
    return json({ error: "Failed to read invoice" }, 502);
  }
  if (!Array.isArray(inv.data) || inv.data.length === 0) return json({ error: "Invoice not found" }, 404);
  const items = await supa(`/rest/v1/sales_invoice_items?sales_invoice_id=eq.${encodeURIComponent(id)}&select=*,product:products(id,name,name_ar)&order=created_at.asc`, env);
  const gotItems = readRows(items, "invoice items");
  if (gotItems.error) return gotItems.error;
  return json({ invoice: inv.data[0], items: gotItems.rows });
}
__name(handleSalesInvoiceGet, "handleSalesInvoiceGet");

// Sales return and payment handlers
async function handleApproveInvoice(request, env, user) {
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "Invalid JSON body" }, 400); }
  const { invoice_id } = body || {};
  if (!invoice_id) return json({ error: "Invoice ID is required" }, 400);
  const result = await supa("/rest/v1/rpc/p_sale_approve_invoice", env, {
    method: "POST",
    body: { p_invoice_id: invoice_id, p_user_id: user.id }
  });
  if (!result.ok) {
    // تفاصيل PostgREST لا تُعاد للمتصفح — تُسجَّل في سجلات الخادم فقط
    console.error("[api] approve invoice failed:", result.status, errMsg(result.data, "no detail"));
    return json({ error: "Failed to approve invoice" }, 400);
  }
  return json({ success: true, data: result.data }, 200);
}
__name(handleApproveInvoice, "handleApproveInvoice");

async function handleRecordPayment(request, env, user) {
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "Invalid JSON body" }, 400); }
  const { invoice_id, amount, payment_method, payment_number, notes } = body || {};
  if (!invoice_id) return json({ error: "Invoice ID is required" }, 400);
  if (!amount || amount <= 0) return json({ error: "Amount must be greater than 0" }, 400);
  // أسماء المعاملات يجب أن تطابق تعريف الدالة حرفياً وإلا رفض PostgREST النداء
  // (كان يُرسل amount وp_method ويتخلّى عن p_user_id):
  // p_sale_record_payment(p_invoice_id, p_amount, p_payment_method, p_payment_number, p_notes, p_user_id)
  const result = await supa("/rest/v1/rpc/p_sale_record_payment", env, {
    method: "POST",
    body: {
      p_invoice_id: invoice_id,
      p_amount: Number(amount),
      p_payment_method: payment_method || "cash",
      p_payment_number: payment_number || "",
      p_notes: notes || "",
      p_user_id: user.id
    }
  });
  if (!result.ok) {
    console.error("[api] record payment failed:", result.status, errMsg(result.data, "no detail"));
    return json({ error: "Failed to record payment" }, 400);
  }
  return json({ success: true, data: result.data }, 200);
}
__name(handleRecordPayment, "handleRecordPayment");

async function handleCreateReturn(request, env, user) {
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "Invalid JSON body" }, 400); }
  const { invoice_id, reason, items } = body || {};
  if (!invoice_id) return json({ error: "Invoice ID is required" }, 400);
  // التوقيع الفعلي: p_sale_create_return(p_invoice_id, p_items, p_reason, p_user_id)
  // — كان النداء يرسل p_return_type (معامل غير موجود) ويغفل p_items وp_user_id.
  const result = await supa("/rest/v1/rpc/p_sale_create_return", env, {
    method: "POST",
    body: {
      p_invoice_id: invoice_id,
      p_items: Array.isArray(items) ? items : [],
      p_reason: reason || "",
      p_user_id: user.id
    }
  });
  if (!result.ok) {
    console.error("[api] create return failed:", result.status, errMsg(result.data, "no detail"));
    return json({ error: "Failed to create return" }, 400);
  }
  return json({ success: true, data: result.data }, 200);
}
__name(handleCreateReturn, "handleCreateReturn");

// Purchase orders handlers
async function handlePurchaseOrders(env, url) {
  const status = (url.searchParams.get("status") || "").trim();
  const warehouseId = url.searchParams.get("warehouse_id") || "";
  let path = "/rest/v1/purchase_orders?select=*,supplier:suppliers(name,name_ar),items:purchase_order_items(*),warehouse:warehouses(name)&order=created_at.desc&limit=100";
  if (status) path += `&status=eq.${status}`;
  if (warehouseId) path += `&warehouse_id=eq.${encodeURIComponent(warehouseId)}`;
  const r = await supa(path, env);
  const got = readRows(r, "purchase orders");
  if (got.error) return got.error;
  return json({ orders: got.rows });
}
__name(handlePurchaseOrders, "handlePurchaseOrders");

async function handlePurchaseOrderGet(request, env, user, orderId) {
  const ur = await supa(`/rest/v1/purchase_orders?id=eq.${encodeURIComponent(orderId)}&select=*,items:purchase_order_items(*),supplier:suppliers(name,name_ar),warehouse:warehouses(name)&limit=1`, env);
  // فصل فشل القراءة عن "السجل غير موجود" — من قبل كان خطأ الاستعلام يظهر كـ 404 زائف
  if (!ur.ok) {
    console.error("[api] read purchase order failed:", errMsg(ur.data, "no detail"));
    return json({ error: "Failed to read purchase order" }, 502);
  }
  if (!Array.isArray(ur.data) || ur.data.length === 0) return json({ error: "Order not found" }, 404);
  return json(ur.data[0]);
}
__name(handlePurchaseOrderGet, "handlePurchaseOrderStatus");

// API route handler - routes to appropriate handler based on path
// مسارات متاحة بدون جلسة (تدفّق الدخول نفسه). كل ما عداها يتطلب مصادقة —
// كانت قوائم المنتجات والعملاء تُقرأ بلا أي ترويسة Authorization إطلاقاً.
const PUBLIC_API_PATHS = new Set([
  "/api/auth/me",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/warehouse",
  "/api/health"
]);
// مسارات تُقبل POST فقط؛ وكل ما عداها قراءة بـ GET (كان DELETE يرجع 200).
const POST_API_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/warehouse",
  "/api/auth/set-warehouse-password",
  // عمليات الفوترة: تغيير حالة (اعتماد/دفع/إرجاع) — لا يجوز قبولها كـ GET
  "/api/sales-invoices/approve",
  "/api/sales-invoices/record-payment",
  "/api/sales-invoices/create-return"
]);

function requiresPost(path) {
  return POST_API_PATHS.has(path) ||
    path.startsWith("/api/customers/create") ||
    path.startsWith("/api/orders/create");
}
__name(requiresPost, "requiresPost");

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = (request.method || "GET").toUpperCase();

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...CORS, "access-control-max-age": "86400" } });
  }

  // بوابة المصادقة: بيانات العمل تتطلب جلسة صالحة.
  // `user` يُمرَّر للم_handlers التي تستخدم user.id — كانت تُرجع 500 لأنها متغيّر غير معرّف.
  let user = null;
  if (!PUBLIC_API_PATHS.has(path)) {
    user = await requireUser(request, env);
    if (!user) return json({ error: "Unauthorized" }, 401);
  }

  const allowed = requiresPost(path) ? "POST" : "GET";
  if (method !== allowed) {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8", allow: allowed, ...CORS }
    });
  }

  if (path === "/api/health") return json({ status: "ok", timestamp: new Date().toISOString() });
  // Auth routes
  if (path === "/api/auth/me") return handleMe(request, env);
  if (path === "/api/auth/login") return handleLogin(request, env);
  if (path === "/api/auth/register") return handleRegister(request, env);
  if (path === "/api/auth/warehouse") return handleVerifyWarehouse(request, env);
  if (path === "/api/auth/set-warehouse-password") return handleSetWarehousePassword(request, env, user);
  // Movement routes
  if (path === "/api/inventory/movements") return handleMovementsList(env, url);
  if (path === "/api/products") return handleProducts(env, url);
  if (path === "/api/customers") return handleCustomersList(env, url);
  if (path.startsWith("/api/customers/create")) return handleCustomersCreate(request, env, user);
  // Order routes
  if (path === "/api/orders") return handleOrdersList(env, url);
  if (path.startsWith("/api/orders/create")) return handleOrdersCreate(request, env, user);
  // Sales quote routes
  if (path === "/api/sales_quotes") return handleSalesQuotes(env, url);
  if (path.startsWith("/api/sales_quotes/")) return handleSalesQuoteGet(request, env, url);
  // Sales invoice routes
  if (path === "/api/sales-invoices") return handleSalesInvoices(env, url);
  // هذه العمليات الثلاث كانت معرَّفة داخل الملف ولا يوصّل إليها أي مسار،
  // فكانت تقع تحت مطابقة البادئة وتُعامل كمعرّف فاتورة خاطئ (400/404/405).
  if (path === "/api/sales-invoices/approve") return handleApproveInvoice(request, env, user);
  if (path === "/api/sales-invoices/record-payment") return handleRecordPayment(request, env, user);
  if (path === "/api/sales-invoices/create-return") return handleCreateReturn(request, env, user);
  if (path.startsWith("/api/sales-invoices/")) return handleSalesInvoiceGet(request, env, url);
  // Purchase order routes
  if (path === "/api/purchase_orders") return handlePurchaseOrders(env, url);
  // تفصيل أمر الشراء كان معرَّفاً أيضاً ولا يوصّل إليه مسار (404 دائماً)
  if (path.startsWith("/api/purchase_orders/")) {
    const m = path.match(/^\/api\/purchase_orders\/([0-9a-fA-F-]{36})$/);
    if (!m) return json({ error: "Invalid ID" }, 400);
    return handlePurchaseOrderGet(request, env, user, m[1]);
  }
  // Stock Balance API routes (Oracle)
  // Stock balance APIs: الموديول api/stock-balance-api.js غير موجود في المستودع،
  // لذا كان require() يفشل دائماً داخل حزمة ESM ويعيد 503 مع تسريب مسار الملف.
  if (path === "/api/stock/balance" || path === "/api/stock/valuerisk" || path === "/api/stock/forecast") {
    console.error(`[api] ${path} called but the stock-balance module is not part of this build`);
    return json({ error: "Not implemented", details: "Stock balance endpoints are not available in this deployment" }, 501);
  }
  // Default: return not found for unhandled API routes
  return json({ error: "API endpoint not found" }, 404);
}
__name(handleApi, "handleApi");

// Me endpoint - get current user info
async function handleMe(request, env) {
  const auth = request.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const token = auth.slice(7).trim();
  const user = await fetchAuthUser(token, env);
  if (!user || !user.id) return json({ error: "Unauthorized" }, 401);
  // Fetch user role from profiles table
  const role = await getRole(user.id, env, token);
  return json({ id: user.id, email: user.email, role, name: user.user_metadata?.full_name || user.email });
}
__name(handleMe, "handleMe");
// Global error handler prevention - return index.html for any unmatched route
// This prevents blank white screen by ensuring the frontend always loads

// رؤوس أمان موحّدة لكل الاستجابات (الملفات الثابتة وواجهة الـ API معاً):
// كانت غائبة تماماً — لا HSTS ولا حماية من التضمين (clickjacking).
function withSecurityHeaders(resp) {
  if (!resp) return resp;
  const headers = new Headers(resp.headers);
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-frame-options", "SAMEORIGIN");
  // frame-ancestors فقط: يمنع التضمين دون تقييد السكربتات المضمّنة في index.html
  headers.set("content-security-policy", "frame-ancestors 'none'");
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
}
__name(withSecurityHeaders, "withSecurityHeaders");

var worker_default = {
  async fetch(request, env) {
    return withSecurityHeaders(await handleRequest(request, env));
  }
};

async function handleRequest(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        console.error("API error:", err && err.message);
        return json({ error: "Internal server error" }, 500);
      }
    }
    try {
      const resp = await env.ASSETS.fetch(request);
      if (resp.status === 404 && request.method === "GET") {
        const index = await env.ASSETS.fetch(new URL("/index.html", url));
        if (index.ok) return index;
      }
      return resp;
    } catch (err) {
      try {
        const index = await env.ASSETS.fetch(new URL("/index.html", url));
        if (index.ok) return index;
      } catch (_) {
      }
      console.error("Assets error:", err && err.message);
      // Fallback: return index.html even on error to prevent blank screen
      try {
        const fallback = await env.ASSETS.fetch(new URL("/index.html", url));
        if (fallback.ok) return fallback;
      } catch (_) {
      }
      return new Response("Not found", { status: 404 });
    }
}
__name(worker_default, "worker_default");

// Export the worker
export default worker_default;