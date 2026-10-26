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
  "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
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
    return { rows: null, error: json({ error: errMsg(res.data, "Failed to fetch " + label) }, 502) };
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

// Login flow - two-stage authentication
var TICKET_TTL_MS = 10 * 60 * 1e3;

async function handleRegister(request, env) {
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "Invalid JSON body" }, 400); }
  const { email, password, name } = body || {};
  if (!email || !password || !name) return json({ error: "Email, password, and name are required" }, 400);
  try {
    const { data: authData, error: authError } = await supa("/auth/v1/signup", env, {
      method: "POST",
      body: { email, password }
    });
    if (authError) return json({ error: authError.message }, 400);
    if (!authData || !authData.user) return json({ error: "Failed to create user" }, 400);
    return json({ id: authData.user.id, email: authData.user.email, name: name, role: "viewer" }, 201);
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
    const { data: authData, error: authError } = await supa("/auth/v1/login", env, {
      method: "POST",
      body: { email, password }
    });
    if (authError) return json({ error: authError.message }, 400);
    if (!authData || !authData.user) return json({ error: "Login failed" }, 400);
    
    // Create ticket for second stage
    const session = authData.session || {};
    const ticket = await sealTicket({ uid: authData.user.id, email: authData.user.email, at: Date.now(), exp: Date.now() + TICKET_TTL_MS, mode: "login" }, env);
    
    if (!ticket) return json({ error: "Failed to create ticket" }, 500);
    
    return json({ stage: 1, ticket, requires_warehouse_password: false, base: { id: authData.user.id, email: authData.user.email } });
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
  return json({
    id: t.uid,
    email: t.email,
    name: t.name,
    role: t.role,
    warehouse_id: t.warehouse_id,
    access_token: t.at,
    refresh_token: t.rt
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
  return json({ id: user.id, email: user.email, role: user.role, warehouse_id: user.warehouse_id });
}
__name(handleSetWarehousePassword, "handleSetWarehousePassword");

// Additional handler functions (essential API endpoints)
async function handleMovementsList(env, url) {
  const r = await supa("/rest/v1/inventory_movements?select=*,product:products(name,name_ar),warehouse:warehouses(name)&order=created_at.desc&limit=100", env);
  const got = readRows(r, "movements");
  if (got.error) return got.error;
  return json({ movements: got.rows });
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
  if (!r.ok) return json({ error: errMsg(r.data, "Failed to create customer") }, 502);
  return json({ customer: Array.isArray(r.data) ? r.data[0] : r.data }, 201);
}
__name(handleCustomersCreate, "handleCustomersCreate");

async function handleOrdersList(env, url) {
  const status = (url.searchParams.get("status") || "").trim();
  const warehouseId = url.searchParams.get("warehouse_id") || "";
  let path = "/rest/v1/orders?select=*,customer:customers(name,name_ar),warehouse:warehouses(name)&order=created_at.desc&limit=100";
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
  const { customer_id, items, notes } = body || {};
  if (!customer_id || !items || !Array.isArray(items) || items.length === 0) return json({ error: "Customer and items are required" }, 400);
  const tenantId = await getTenantId(env);
  if (!tenantId) return json({ error: "Unable to resolve tenant for this request" }, 503);
  const orderId = crypto.randomUUID();
  const orderBody = { id: orderId, tenant_id: tenantId, customer_id, status: "pending", created_by: user.id, notes };
  const orderR = await supa("/rest/v1/orders", env, { method: "POST", body: orderBody });
  if (!orderR.ok) return json({ error: errMsg(orderR.data, "Failed to create order") }, 502);
  
  for (const item of items) {
    const { product_id, quantity } = item;
    if (!product_id || !quantity) continue;
    const itemId = crypto.randomUUID();
    await supa("/rest/v1/order_items", env, {
      method: "POST",
      body: { id: itemId, order_id: orderId, product_id, quantity }
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
  if (!q.ok) return json({ error: errMsg(q.data, "Failed to fetch quote") }, 502);
  if (!Array.isArray(q.data) || q.data.length === 0) return json({ error: "Quote not found" }, 404);
  const items = await supa(`/rest/v1/sales_quote_items?sales_quote_id=eq.${encodeURIComponent(id)}&select=*,product:products(id,name,name_ar)&order=created_at.asc`, env);
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
  if (!inv.ok) return json({ error: errMsg(inv.data, "Failed to fetch invoice") }, 502);
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
  if (!result.ok) return json({ error: errMsg(result.data, "Failed to approve invoice") }, 400);
  return json({ success: true, data: result.data }, 200);
}
__name(handleApproveInvoice, "handleApproveInvoice");

async function handleRecordPayment(request, env, user) {
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "Invalid JSON body" }, 400); }
  const { invoice_id, amount, payment_method } = body || {};
  if (!invoice_id) return json({ error: "Invoice ID is required" }, 400);
  if (!amount || amount <= 0) return json({ error: "Amount must be greater than 0" }, 400);
  const result = await supa("/rest/v1/rpc/p_sale_record_payment", env, {
    method: "POST",
    body: { p_invoice_id: invoice_id, amount: amount, p_method: payment_method || "cash", p_user_id: user.id }
  });
  if (!result.ok) return json({ error: errMsg(result.data, "Failed to record payment") }, 400);
  return json({ success: true, data: result.data }, 200);
}
__name(handleRecordPayment, "handleRecordPayment");

async function handleCreateReturn(request, env, user) {
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "Invalid JSON body" }, 400); }
  const { invoice_id, reason, return_type } = body || {};
  if (!invoice_id) return json({ error: "Invoice ID is required" }, 400);
  const result = await supa("/rest/v1/rpc/p_sale_create_return", env, {
    method: "POST",
    body: { p_invoice_id: invoice_id, p_reason: reason || "", p_return_type: return_type || "return" }
  });
  if (!result.ok) return json({ error: errMsg(result.data, "Failed to create return") }, 400);
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
  if (!ur.ok) return json({ error: errMsg(ur.data, "Failed to fetch purchase order") }, 502);
  if (!Array.isArray(ur.data) || ur.data.length === 0) return json({ error: "Order not found" }, 404);
  return json(ur.data[0]);
}
__name(handlePurchaseOrderGet, "handlePurchaseOrderStatus");

// API route handler - routes to appropriate handler based on path
function handleApi(request, env, url) {
  const path = url.pathname;
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
  if (path.startsWith("/api/sales-invoices/")) return handleSalesInvoiceGet(request, env, url);
  // Purchase order routes
  if (path === "/api/purchase_orders") return handlePurchaseOrders(env, url);
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

var worker_default = {
  async fetch(request, env) {
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
};
__name(worker_default, "worker_default");

// Export the worker
export default worker_default;