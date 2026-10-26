// نظام إدارة المخزن — واجهة عربية كاملة + استمارة تسجيل مخزن + صفحات تشغيلية حقيقية

// --- Supabase Client (real auth + PostgreSQL with Row Level Security) ---
// Public configuration comes from supabase-config.js (browser-safe keys only;
// the database is protected by RLS policies, never by key secrecy).
const SUPABASE_URL = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) || "https://iksjhjxwphmvthryfeae.supabase.co";
const SUPABASE_ANON_KEY = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.anonKey) || "";
let sbClient = null;

function getSupabase() {
  if (sbClient) return sbClient;
  if (!SUPABASE_ANON_KEY || !window.supabase || typeof window.supabase.createClient !== "function") {
    return null;
  }
  sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  // Keep the app in sync with Supabase Auth state changes.
  sbClient.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      clearSession();
      const p = location.pathname.replace(/\/+$/, "") || "/";
      if (isProtectedRoute(p)) navigate("/login");
    }
  });
  return sbClient;
}

function authErrorMessage(error, fallback) {
  const msg = String((error && error.message) || "").toLowerCase();
  if (msg.includes("invalid login")) return "بيانات الدخول غير صحيحة";
  if (msg.includes("already registered")) return "هذا البريد الإلكتروني مسجل بالفعل";
  if (msg.includes("password")) return "كلمة المرور يجب أن تكون 6 أحرف على الأقل";
  if (msg.includes("email")) return "تحقق من صحة البريد الإلكتروني";
  if (msg.includes("network") || msg.includes("fetch")) return "تعذر الاتصال بقاعدة البيانات — تحقق من الإنترنت";
  return fallback || "حدث خطأ أثناء المصادقة";
}

// --- Global Error Boundary & Fallback UI ---
function showErrorFallback(error) {
  // شاشة طوارئ تعرض رسالة الخطأ وزر إعادة الضبط
  const fallbackHtml = `
    <div class="page center error-page">
      <div class="card error-card">
        <div class="brand">
          <h1>⚠️ خطأ في التطبيق</h1>
        </div>
        <div class="content">
          <p class="muted">حدث خطأ غير متوقع أثناء تحميل التطبيق</p>
          <p class="muted" style="margin:1rem 0">${error.message || error}</p>
          <button class="btn primary" id="reset-btn" style="width:100%;margin-top:1rem">إعادة ضبط التطبيق</button>
        </div>
      </div>
    </div>`;
  // Try to find app element, create if not exists
  let appEl = document.getElementById("app");
  if (!appEl) {
    appEl = document.createElement("div");
    appEl.id = "app";
    appEl.style.cssText = "width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#f0f0f0";
    document.body.appendChild(appEl);
  }
  appEl.innerHTML = fallbackHtml;
  // Event listener for reset button
  const resetBtn = document.getElementById("reset-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      localStorage.clear();
      location.reload();
    });
  }
}

// Global error handler to catch unhandled errors during app initialization
// This prevents the white screen by displaying a clear error message
window.addEventListener("error", function(e) {
  console.error("Unhandled error caught:", e.error);
  // Prevent the default browser error handling
  try {
    showErrorFallback(e.error);
  } catch (_) {
    // If showErrorFallback fails, try minimal fallback
    try {
      const appEl = document.getElementById("app");
      if (appEl) {
        appEl.innerHTML = '<div style="padding:2rem;text-align:center;color:#d33;background:#fff;border:1px solid #d33;margin:2rem;"><h3>⚠️ خطأ في التطبيق</h3><p>' + (e.error.message || e.error) + '</p><button style="padding:0.5rem 1rem;background:#d33;color:#fff;border:none;border-radius:4px;cursor:pointer;" onclick="location.reload()">إعادة الضبط</button></div>';
      }
    } catch (__) {
      // Last resort: write to document body
      document.body.innerHTML = '<div style="padding:2rem;text-align:center;color:#d33;background:#fff;border:1px solid #d33;margin:2rem;"><h3>⚠️ خطأ في التطبيق</h3><p>' + (e.error.message || e.error) + '</p><button style="padding:0.5rem 1rem;background:#d33;color:#fff;border:none;border-radius:4px;cursor:pointer;" onclick="location.reload()">إعادة الضبط</button></div>';
    }
  }
  e.preventDefault();
});

// Also catch unhandled promise rejections
window.addEventListener("unhandledrejection", function(e) {
  console.error("Unhandled promise rejection:", e.reason);
  try {
    showErrorFallback(new Error("Unhandled promise rejection: " + (e.reason.message || e.reason)));
  } catch (_) {
    // Ignore errors in the error handler itself
  }
});

// Ensure app element exists before initializing - wrapped in DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  let appElement = document.getElementById('app');
  if (!appElement) {
    // Create fallback element for mobile browsers
    appElement = document.createElement('div');
    appElement.id = 'app';
    appElement.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#f0f0f0;';
    document.body.appendChild(appElement);
  }
  const app = appElement;
});

// Add fallback for if the script itself fails to load properly
document.addEventListener("DOMContentLoaded", function() {
  // Verify app element exists after DOM is loaded
  if (!document.getElementById("app")) {
    const fallback = document.createElement("div");
    fallback.id = "app";
    fallback.style.cssText = "width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#f0f0f0;color:#333;font-family:sans-serif";
    fallback.innerHTML = '<div style="text-align:center;padding:2rem;"><h1>🏪 نظام إدارة المخزن</h1><p>جارٍ التحميل...</p></div>';
    document.body.appendChild(fallback);
  }
});

// Error overlay for development - shows errors without white screen
if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "0.0.0.0") {
  // Add style for error visibility
  const style = document.createElement("style");
  style.textContent = `
    .error-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.8);
      color: #fff;
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: sans-serif;
    }
  `;
  document.head.appendChild(style);
}

// Initialize the application with safety checks
// NOTE: the authenticated boot guard at the bottom of this file is the only
// place that triggers the first render, so no dashboard view can appear
// before the session has been verified.

// --- Constants ---

const GOVERNORATES = [
  "القاهرة", "الجيزة", "الإسكندرية", "الدقهلية", "البحر الأحمر", "البحيرة",
  "الفيوم", "الغربية", "الإسماعيلية", "المنوفية", "المنيا", "القليوبية",
  "الوادي الجديد", "السويس", "أسوان", "أسيوط", "بني سويف", "بورسعيد",
  "دمياط", "الشرقية", "جنوب سيناء", "كفر الشيخ", "مطروح", "الأقصر",
  "قنا", "شمال سيناء", "سوهاج",
];

const STATUS_LABELS = {
  pending: "قيد الانتظار",
  confirmed: "مؤكد",
  completed: "تم التنفيذ",
  cancelled: "ملغي",
  // حالات المشتريات
  draft: "مسودة",
  pending_approval: "بانتظار الموافقة",
  approved: "معتمد",
  rejected: "مرفوض",
  ordered: "تم الطلب",
  submitted: "مُقدَّم",
  selected: "مُختار",
  expired: "منتهي",
  sent: "مُرسل",
  partially_received: "مستلم جزئياً",
  received: "مستلم",
  paid: "مدفوعة",
  partially_paid: "مدفوعة جزئياً",
};

// --- Routes Object (strings, not functions) ---

const routes = {
  "/": "/",
  "/login": "/login",
  "/register": "/register",
  "/inventory": "/inventory",
  "/receiving": "/receiving",
  "/sales": "/sales",
  "/sales/quotes": "/sales/quotes",
  "/sales/invoices": "/sales/invoices",
  "/sales/returns": "/sales/returns",
  "/sales/payments": "/sales/payments",
  "/purchases": "/purchases",
  "/financial": "/financial"
};

const MODULE_ROUTES = ["/inventory", "/receiving", "/sales", "/purchases", "/financial",
  "/sales/quotes", "/sales/invoices", "/sales/returns", "/sales/payments"];

// --- Strict Authentication Guard ---
// All routes that require a verified warehouse session before they may render.
const PROTECTED_ROUTES = new Set(["/"].concat(MODULE_ROUTES));

function isProtectedRoute(routePath) {
  return PROTECTED_ROUTES.has(routePath);
}

// Returns the stored session only if it looks like a real warehouse login
// (id + role + token). Anything incomplete is cleared and treated as logged-out.
function getValidSession() {
  const s = getSession();
  if (!s) return null;
  if (!s.id || !s.role) {
    clearSession();
    return null;
  }
  const token = s.access_token || s.token || null;
  if (!token) {
    clearSession();
    return null;
  }
  s.access_token = token;
  return s;
}

// Verifies the CURRENT Supabase session (supabase.auth.getSession) before any
// dashboard view is shown. No valid session → login page, dashboard blocked.
async function verifySession() {
  const client = getSupabase();
  if (!client) return null;
  try {
    const { data, error } = await client.auth.getSession();
    if (error || !data || !data.session) {
      clearSession();
      return null;
    }
    const s = data.session;
    const user = s.user || {};
    const meta = user.user_metadata || {};
    const appSession = {
      id: user.id,
      email: user.email || "",
      role: meta.role || "manager",
      name: meta.warehouse_name || meta.full_name || meta.name || user.email || "",
      warehouse_id: meta.warehouse_id || "",
      access_token: s.access_token
    };
    // لا تُفتح لوحة التحكم قبل نجاح الخطوة الثانية (كلمة مرور المدير)
    if (!step2Ok(user.id)) {
      clearSession();
      return null;
    }
    setSession(appSession);
    return appSession;
  } catch (_) {
    clearSession();
    return null;
  }
}

// Lock screen shown while the session is being verified. It replaces the app
// container so no dashboard element can be visible before verification.
function renderAuthGate() {
  const appEl = document.getElementById("app");
  if (!appEl) return;
  appEl.innerHTML = `
    <div class="page center" style="display:flex;align-items:center;justify-content:center;min-height:100vh;">
      <div class="card" style="text-align:center;padding:2rem;">
        <p class="muted">🔒 جارٍ التحقق من بيانات الحساب...</p>
      </div>
    </div>`;
}

// --- Navigation Function (the actual function to use) ---

/**
 * Safe navigation function that checks if route is available
 * @param {string} path - The path to navigate to
 */
function safeNavigate(path) {
  // Try window.route first if available
  if (typeof window.route === 'function') {
    return window.route(path);
  }
  
  // Use internal navigate function
  navigate(path);
}

/**
 * Safely call the route handler with fallback
 * @param {string} pathPath - The path to check/routes to use
 */
function safeRouteHandler(pathPath) {
  // Check if routes object has this path
  if (routes[pathPath]) {
    // Navigate to the path
    safeNavigate(pathPath);
  } else if (MODULE_ROUTES.includes(pathPath)) {
    // Module route - navigate to login
    safeNavigate("/login");
  } else {
    // Default route
    safeNavigate("/");
  }
}

// --- Session Management ---

function getSession() {
  let sessionData = null;
  try {
    const raw = localStorage.getItem("session");
    if (raw) {
      sessionData = JSON.parse(raw);
      // التحقق من البيانات الأساسية
      if (sessionData.id && sessionData.role) {
        return sessionData;
      }
    }
  } catch (_) {
    // تجاهل أخطاء القراءة والمحاولة لاستعادة الجلسة من الخادم لاحقاً
  }
  return null;
}
function setSession(s) { localStorage.setItem("session", JSON.stringify(s)); }
function clearSession() { localStorage.removeItem("session"); }

// --- API ---

async function api(path, opts = {}) {
  const headers = { "content-type": "application/json", ...(opts.headers || {}) };
  const session = getSession();
  if (session && session.access_token) headers.authorization = "Bearer " + session.access_token;
  const res = await fetch(path, { ...opts, headers });
  let data = null;
  try { data = await res.json(); } catch (_) { /* استجابة فارغة */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || "حدث خطأ (" + res.status + ")");
    err.status = res.status;
    throw err;
  }
  return data;
}

// --- Render Functions ---

// Loading indicator shown while async route data is fetched
function renderLoading() {
  const appEl = document.getElementById("app");
  if (!appEl) return;
  appEl.innerHTML = `
    <div class="page center" style="display:flex;align-items:center;justify-content:center;min-height:60vh;">
      <div class="card" style="text-align:center;padding:2rem;">
        <p class="muted" style="font-size:1.1rem;">⏳ جارٍ التحميل...</p>
      </div>
    </div>`;
}

async function render() {
  let path = location.pathname.replace(/\/+$/, "") || "/";
  const routePath = routes[path];
  
  // Safety check: ensure routePath is valid before using it
  if (!routePath) {
    // مسار وحدة بدون مصادقة → تسجيل الدخول
    if (MODULE_ROUTES.includes(path)) return safeNavigate("/login");
    return safeNavigate("/");
  }
  
  // --- Strict authentication guard ---
  // Dashboard + module views stay hidden behind the auth gate until the
  // session has been verified against the server.
  if (isProtectedRoute(routePath)) {
    renderAuthGate(); // 1) hide all dashboard UI
    const session = await verifySession(); // 2) verify the account
    if (!session) {
      clearSession();
      return navigate("/login"); // 3) block dashboard, go to login
    }
    // المستخدم قد يتنقل أثناء التحقق — أعد الرسم للمسار الحالي بدل رسم قديم
    const nowPath = location.pathname.replace(/\/+$/, "") || "/";
    if (nowPath !== path) return render();
    if (path !== routePath) {
      return safeNavigate(routePath);
    }
    return renderRouteView(routePath, session);
  }

  // Public routes (/login, /register) never require a session.
  if (path !== routePath) {
    return safeNavigate(routePath);
  }
  renderRouteView(routePath, null);
}

// Renders the view for a route whose URL is already correct (no history changes).
// This breaks the pushState -> render -> navigate infinite recursion.
function renderRouteView(routePath, session) {
  // Defense in depth: a protected view must never render without a verified
  // session, no matter who calls this function.
  if (isProtectedRoute(routePath) && !session) {
    return navigate("/login");
  }
  const appEl = document.getElementById("app");
  if (!appEl) return;

  // Local login / new-warehouse forms (no backend required).
  if (routePath === "/login" || routePath === "/register") {
    renderLocalAuthForm(appEl, routePath);
    return;
  }

  if (routePath === "/") {
    appEl.innerHTML = `
      <div class="page">
        <header class="app-header">
          <h1>🏪 نظام إدارة المخزن</h1>
          <button class="btn" id="logout-btn" type="button">تسجيل الخروج</button>
        </header>
        <nav class="app-nav" aria-label="التنقل الرئيسي">
          <a href="/" data-link class="nav-link">الرئيسية</a>
          <a href="/inventory" data-link class="nav-link">📦 المخزون</a>
          <a href="/receiving" data-link class="nav-link">📥 الاستلام</a>
          <a href="/sales" class="nav-link accent" data-link>🛍️ المبيعات</a>
          <a href="/purchases" data-link class="nav-link">🛒 المشتريات</a>
          <a href="/financial" data-link class="nav-link">💰 المالية</a>
        </nav>
        <main style="padding:1rem;">
          <div class="hero-row">
            <div>
              <h2>إدارة دورة المبيعات</h2>
              <p class="muted">عروض الأسعار والفواتير والمرتجعات والمدفوعات في مكان واحد.</p>
            </div>
            <a class="btn sales-cta" data-link href="/sales">🛍️ فتح قسم المبيعات</a>
          </div>
          <div class="modules-grid grid">${moduleCardsHtml()}</div>
        </main>
      </div>`;
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        const client = getSupabase();
        try {
          if (client) await client.auth.signOut(); // Supabase Auth signOut
        } catch (_) { /* ignore network errors on signOut */ }
        clearSession();
        clearStep2Mark(); // خروج كامل: تُلغى أيضاً علامة الخطوة الثانية
        navigate("/login");
      });
    }
    return;
  }

  // Module data views: live queries against Supabase PostgreSQL (RLS applies).
  const titles = {
    "/inventory": "المخزون",
    "/receiving": "الاستلام",
    "/sales": "المبيعات",
    "/sales/quotes": "عروض الأسعار",
    "/sales/invoices": "فواتير المبيعات",
    "/sales/returns": "مرتجعات المبيعات",
    "/sales/payments": "مدفوعات المبيعات",
    "/purchases": "المشتريات",
    "/financial": "المالية"
  };
  const sectionTitle = titles[routePath] || routePath;
  // شريط أقسام المبيعات يُرسم فوراً (بدون انتظار قاعدة البيانات)
  const salesSections = routePath === "/sales" ? `
      <div class="modules-grid grid" style="margin-bottom:1rem;">
        ${SALES_SECTIONS.map(s => `
        <a class="card link-card sales-featured" data-link href="${s.href}">
          <h3>${s.icon} ${s.title}</h3>
          <p>${s.desc}</p>
          <span class="card-cta">فتح الصفحة ←</span>
        </a>`).join("")}
      </div>` : "";
  appEl.innerHTML = `
    <div class="page">
      <header class="app-header">
        <h1>${sectionTitle}</h1>
        <button class="btn" id="back-home-btn" type="button">← الرئيسية</button>
      </header>
      <main style="padding:1rem;">${salesSections}
        <div id="section-body" class="card" style="text-align:center;padding:1.5rem;">
          <p class="muted">⏳ جارٍ تحميل البيانات من قاعدة البيانات...</p>
        </div>
      </main>
    </div>`;
  const backBtn = document.getElementById("back-home-btn");
  if (backBtn) backBtn.addEventListener("click", () => navigate("/"));
  loadSectionData(routePath, sectionTitle);
}

// --- Section loaders: real SELECT / INSERT / UPDATE against Supabase ---

function sectionErrorHtml(msg) {
  return `
    <div style="text-align:center;padding:1rem;">
      <p style="color:#d33;">⚠️ ${msg}</p>
      <p class="muted" style="font-size:0.85rem;">تأكد من تفعيل حسابك ومن سياسات الأمان (RLS) الممنوحة لدورك في قاعدة البيانات.</p>
      <button class="btn" type="button" onclick="location.reload()">إعادة المحاولة</button>
    </div>`;
}

function sectionEmptyHtml(msg) {
  return `<div style="text-align:center;padding:1rem;"><p class="muted">${msg}</p></div>`;
}

async function loadSectionData(routePath, title) {
  const body = document.getElementById("section-body");
  if (!body) return;
  const client = getSupabase();
  if (!client) {
    body.innerHTML = sectionErrorHtml("تعذر الاتصال بقاعدة Supabase — لم يتم ضبط المفتاح العام (anon key) بعد.");
    return;
  }
  try {
    await assertWarehouseScope(client);

    if (routePath === "/inventory") {
      await loadInventorySection(body, client);
      return;
    }

    if (routePath === "/receiving") {
      await loadReceivingSection(body, client);
      return;
    }

    if (routePath === "/sales") {
      const cust = await client.from("customers").select("id,name,name_ar,phone").order("created_at", { ascending: false }).limit(30);
      const ord = await client.from("orders").select("id,status,created_at").order("created_at", { ascending: false }).limit(30);
      if (cust.error && ord.error) throw new Error(cust.error.message);
      const customers = cust.data || [];
      const orders = ord.data || [];
      body.innerHTML = `
        <h3>العملاء</h3>
        ${customers.length ? `<ul style="padding-inline-start:1rem;">${customers.map(c => `<li>${c.name_ar || c.name}${c.phone ? " — " + c.phone : ""}</li>`).join("")}</ul>` : sectionEmptyHtml("لا يوجد عملاء بعد.")}
        <h3 style="margin-top:1rem;">آخر الطلبات</h3>
        ${orders.length ? `<ul style="padding-inline-start:1rem;">${orders.map(o => `<li>#${String(o.id).slice(0, 8)} — ${STATUS_LABELS[o.status] || o.status || "—"} — ${new Date(o.created_at).toLocaleDateString("ar-EG")}</li>`).join("")}</ul>` : sectionEmptyHtml("لا توجد طلبات بعد.")}
        ${ord.error ? `<p class="muted" style="font-size:0.85rem;">ملاحظة: ${ord.error.message}</p>` : ""}`;
      return;
    }

    // أقسام المبيعات الفرعية: شاشات قيد الإعداد تُعرض كرسالة واضحة
    // (روابطها موجودة في صفحة المبيعات، ولا يبقى التحميل معلّقاً إلى الأبد)
    if (routePath.indexOf("/sales/") === 0) {
      body.innerHTML = sectionEmptyHtml("هذه الشاشة قيد الإعداد — سيتم ربطها ببيانات القاعدة قريباً.");
      return;
    }

    if (routePath === "/purchases") {
      let po = await client.from("purchase_orders").select("id,order_number,status,total_amount,order_date,created_at").order("created_at", { ascending: false }).limit(30);
      if (po.error) po = await client.from("purchase_orders").select("*").order("created_at", { ascending: false }).limit(30);
      if (po.error) throw new Error(po.error.message);
      const rows = po.data || [];
      body.innerHTML = rows.length ? `
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="border-bottom:2px solid #ddd;text-align:right;">
            <th style="padding:0.5rem;">رقم الأمر</th>
            <th style="padding:0.5rem;">الحالة</th>
            <th style="padding:0.5rem;">الإجمالي</th>
          </tr></thead>
          <tbody>
            ${rows.map(o => `
            <tr style="border-bottom:1px solid #eee;">
              <td style="padding:0.5rem;">${o.order_number || String(o.id).slice(0, 8)}</td>
              <td style="padding:0.5rem;">${STATUS_LABELS[o.status] || o.status || "—"}</td>
              <td style="padding:0.5rem;">${o.total_amount ?? 0}</td>
            </tr>`).join("")}
          </tbody>
        </table>` : sectionEmptyHtml("لا توجد أوامر شراء بعد.");
      return;
    }

    if (routePath === "/financial") {
      const inv = await client.from("sales_invoices").select("*").order("created_at", { ascending: false }).limit(30);
      if (inv.error) throw new Error(inv.error.message);
      const rows = inv.data || [];
      const total = rows.reduce((s, r) => s + (Number(r.total_amount ?? r.total ?? 0) || 0), 0);
      body.innerHTML = `
        <div class="card" style="text-align:center;margin-bottom:1rem;">
          <p class="muted">إجمالي آخر الفواتير المعروضة</p>
          <h2>${total.toLocaleString("en-US")}</h2>
        </div>
        ${rows.length ? rows.map(r => `
          <div class="card" style="display:flex;justify-content:space-between;padding:0.75rem;margin-bottom:0.5rem;">
            <span>#${String(r.id).slice(0, 8)}</span>
            <span>${STATUS_LABELS[r.status] || r.status || "—"}</span>
            <span>${r.total_amount ?? r.total ?? 0}</span>
          </div>`).join("") : sectionEmptyHtml("لا توجد فواتير مبيعات بعد.")}`;
      return;
    }
  } catch (e) {
    body.innerHTML = sectionErrorHtml("تعذر تحميل البيانات: " + ((e && e.message) || e));
  }
}


// --- المرحلة 1: استدعاءات RPC الآمنة (الخادم يتحقق من الهوية والمخزن) ---

function esc(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function debounce(fn, wait) {
  let t = null;
  return function () {
    clearTimeout(t);
    t = setTimeout(fn, wait);
  };
}

async function wmsRpc(client, name, args = {}) {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    const err = new Error(error.message || "حدث خطأ أثناء الاتصال بقاعدة البيانات");
    err.code = error.code;
    throw err;
  }
  return data;
}

// --- المرحلة 2: سياق المستخدم/المخزن من الخادم (يمنع القراءات الصفراً الصامتة) ---

async function loadWmsContext(client) {
  try {
    const { data, error } = await client.rpc("wms_context");
    if (error || !data || !data.authenticated) return null;
    return data;
  } catch (_) {
    return null;
  }
}

// قبل تحميل أي قسم: إذا لم يُربط الحساب بمخزن فسترجع الجداول صفراً صفحات دون خطأ،
// فنوقف التحميل ونعرض سبباً واضحاً بدل جداول فارغة تبدو "صحيحة".
async function assertWarehouseScope(client) {
  const ctx = await loadWmsContext(client);
  if (ctx && !ctx.warehouse_id) {
    const err = new Error("حسابك غير مرتبط بأي مخزن، ولذلك لن تُعرض أي بيانات. راجع مدير النظام لربط حسابك بمخزن.");
    err.code = "WMS_NO_WAREHOUSE";
    throw err;
  }
  return ctx;
}

// تسجيل دائم لفشل حركة استلام/ترحيل.
// معاملة الفشل نفسها تُلغى بالكامل عند رفع الاستثناء من قاعدة البيانات،
// لذلك يُسجَّل الحدث هنا في طلب PostgREST مستقل يبقى محفوظاً.
async function logMovementFailure(client, error, context) {
  try {
    const ctx = await loadWmsContext(client);
    if (!ctx || !ctx.tenant_id) return false;
    const { error: insertError } = await client.from("audit_logs").insert({
      tenant_id: ctx.tenant_id,
      user_id: ctx.user_id || null,
      warehouse_id: ctx.warehouse_id || null,
      action: "inventory_movement_failed",
      entity_type: (context && context.entity_type) || "inventory_movements",
      entity_id: (context && context.entity_id) || null,
      new_values: {
        error: String((error && error.message) || error),
        code: (error && error.code) || null,
        source: "web",
        at: new Date().toISOString(),
      },
    });
    return !insertError;
  } catch (_) {
    return false;
  }
}

const GR_STATUS_LABELS = {
  draft: "مسودة",
  pending_review: "بانتظار المراجعة",
  posted: "مرحّل",
  received: "مستلم",
  cancelled: "ملغي",
};

const PO_STATUS_LABELS = {
  pending: "بانتظار الاعتماد",
  approved: "معتمد",
  ordered: "تم الطلب",
  sent: "مُرسل",
  partially_received: "استلام جزئي",
  received: "مستلم بالكامل",
  cancelled: "ملغي",
  rejected: "مرفوض",
};

const STOCK_STATUS_LABELS = {
  available: "متاح",
  reserved: "محجوز/تجهيز",
  quarantine: "تحت الفحص",
  damaged: "تالف",
  expired: "منتهي الصلاحية",
  out_of_stock: "نافد",
};

function badge(label, kind) {
  return '<span class="wms-badge wms-badge-' + esc(kind || "muted") + '">' + esc(label) + "</span>";
}

function stockBadge(status) {
  const kinds = {
    available: "ok", reserved: "info", quarantine: "warn",
    damaged: "danger", expired: "danger", out_of_stock: "muted",
  };
  return badge(STOCK_STATUS_LABELS[status] || status, kinds[status] || "muted");
}


// --- المرحلة 1: شاشة الاستلام (أوامر الشراء ← مستند الاستلام ← الترحيل) ---

async function loadReceivingSection(body, client) {
  body.innerHTML = `
    <div class="wms-toolbar">
      <input id="rcv-search" class="wms-input" type="search" placeholder="🔎 بحث برقم أمر الشراء..." />
      <button class="btn" id="rcv-refresh" type="button">🔄 تحديث</button>
    </div>
    <div id="rcv-error"></div>
    <section class="wms-block">
      <h3 class="wms-block-title">🛒 أوامر الشراء المفتوحة</h3>
      <div id="rcv-po-list"><p class="muted">⏳ جارٍ التحميل...</p></div>
    </section>
    <section class="wms-block">
      <h3 class="wms-block-title">📥 مستندات الاستلام</h3>
      <div id="rcv-gr-list"><p class="muted">⏳ جارٍ التحميل...</p></div>
    </section>
    <section id="rcv-editor" class="wms-block" style="display:none;"></section>`;

  const errBox = document.getElementById("rcv-error");
  const refresh = async () => {
    errBox.innerHTML = "";
    try {
      await renderReceivingLists(client);
    } catch (e) {
      errBox.innerHTML = sectionErrorHtml("تعذر تحميل بيانات الاستلام: " + (e && e.message));
    }
  };

  document.getElementById("rcv-refresh").addEventListener("click", refresh);
  const search = document.getElementById("rcv-search");
  search.addEventListener("input", debounce(refresh, 350));
  await refresh();
}

async function renderReceivingLists(client) {
  const term = (document.getElementById("rcv-search") || {}).value || "";
  const pos = await wmsRpc(client, "wms_po_list", { p_search: term.trim(), p_limit: 50 });
  const grs = await wmsRpc(client, "wms_gr_list", { p_search: "", p_status: "", p_limit: 50 });

  const poBox = document.getElementById("rcv-po-list");
  const poRows = (pos || []).filter((po) => (po.items || []).some((i) => Number(i.remaining) > 0));
  poBox.innerHTML = poRows.length ? `
    <div class="wms-table-wrap">
      <table class="wms-table">
        <thead><tr>
          <th>رقم أمر الشراء</th><th>المورد</th><th>التاريخ</th><th>الحالة</th>
          <th>البنود المتبقية</th><th></th>
        </tr></thead>
        <tbody>
          ${poRows.map((po) => {
            const remaining = (po.items || []).filter((i) => Number(i.remaining) > 0);
            return `<tr>
              <td data-label="أمر الشراء">${esc(po.order_number)}</td>
              <td data-label="المورد">${esc(po.supplier_name || "—")}</td>
              <td data-label="التاريخ">${esc(po.order_date || "")}</td>
              <td data-label="الحالة">${badge(PO_STATUS_LABELS[po.status] || po.status, po.status === "partially_received" ? "warn" : "info")}</td>
              <td data-label="المتبقي">${remaining.length} صنف (${remaining.reduce((s, i) => s + Number(i.remaining || 0), 0)} وحدة)</td>
              <td data-label=""><button class="btn primary" type="button" data-rcv-po="${esc(po.id)}">📥 استلام</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>` : sectionEmptyHtml("لا توجد أوامر شراء مفتوحة للاستلام.");

  const grBox = document.getElementById("rcv-gr-list");
  grBox.innerHTML = (grs || []).length ? `
    <div class="wms-table-wrap">
      <table class="wms-table">
        <thead><tr>
          <th>رقم المستند</th><th>أمر الشراء</th><th>المورد</th><th>الحالة</th>
          <th>البنود</th><th>الكمية</th><th></th>
        </tr></thead>
        <tbody>
          ${grs.map((gr) => `<tr>
            <td data-label="المستند">${esc(gr.receipt_number)}</td>
            <td data-label="أمر الشراء">${esc(gr.purchase_order_number || "—")}</td>
            <td data-label="المورد">${esc(gr.supplier_name || "—")}</td>
            <td data-label="الحالة">${badge(GR_STATUS_LABELS[gr.status] || gr.status,
              gr.status === "posted" ? "ok" : gr.status === "draft" ? "info" : "muted")}</td>
            <td data-label="البنود">${(gr.items || []).length}</td>
            <td data-label="الكمية">${(gr.items || []).reduce((s, i) => s + Number(i.quantity_received || 0), 0)}</td>
            <td data-label="">
              ${gr.status === "draft" ? `
                <button class="btn primary" type="button" data-rcv-post="${esc(gr.id)}">✔ ترحيل</button>
                <button class="btn" type="button" data-rcv-cancel="${esc(gr.id)}">✖ إلغاء</button>` : "—"}
            </td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>` : sectionEmptyHtml("لا توجد مستندات استلام بعد.");

  document.querySelectorAll("[data-rcv-po]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const po = poRows.find((p) => p.id === btn.getAttribute("data-rcv-po"));
      if (po) openReceivingEditor(client, po);
    });
  });
  document.querySelectorAll("[data-rcv-post]").forEach((btn) => {
    btn.addEventListener("click", () => postReceipt(client, btn.getAttribute("data-rcv-post")));
  });
  document.querySelectorAll("[data-rcv-cancel]").forEach((btn) => {
    btn.addEventListener("click", () => cancelReceipt(client, btn.getAttribute("data-rcv-cancel")));
  });
}

function openReceivingEditor(client, po) {
  const editor = document.getElementById("rcv-editor");
  const items = (po.items || []).filter((i) => Number(i.remaining) > 0);
  const today = new Date().toISOString().slice(0, 10);
  editor.style.display = "block";
  editor.innerHTML = `
    <h3 class="wms-block-title">📦 إنشاء مستند استلام — ${esc(po.order_number)}</h3>
    <p class="muted">أدخل رقم التشغيلة وتاريخ الصلاحية وكمية الاستلام لكل صنف.</p>
    <div class="wms-table-wrap">
      <table class="wms-table">
        <thead><tr><th>الصنف</th><th>المتبقي</th><th>رقم التشغيلة</th><th>تاريخ الصلاحية</th><th>الكمية</th></tr></thead>
        <tbody>
          ${items.map((i, idx) => `<tr>
            <td data-label="الصنف">${esc(i.product_name)}</td>
            <td data-label="المتبقي">${esc(i.remaining)}</td>
            <td data-label="رقم التشغيلة"><input class="wms-input" data-rcv-batch="${idx}" placeholder="B-001" /></td>
            <td data-label="الصلاحية"><input class="wms-input" type="date" data-rcv-expiry="${idx}" min="${today}" value="${today}" /></td>
            <td data-label="الكمية"><input class="wms-input wms-input-sm" type="number" min="1" max="${esc(i.remaining)}" value="${esc(i.remaining)}" data-rcv-qty="${idx}" /></td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <p id="rcv-editor-msg" class="wms-msg"></p>
    <div class="wms-actions">
      <button class="btn primary" id="rcv-save" type="button">💾 حفظ كمسودة</button>
      <button class="btn" id="rcv-close" type="button">إغلاق</button>
    </div>`;

  document.getElementById("rcv-close").addEventListener("click", () => {
    editor.style.display = "none";
    editor.innerHTML = "";
  });
  document.getElementById("rcv-save").addEventListener("click", async () => {
    const msg = document.getElementById("rcv-editor-msg");
    msg.className = "wms-msg";
    const payload = [];
    for (let idx = 0; idx < items.length; idx++) {
      const batch = String((document.querySelector('[data-rcv-batch="' + idx + '"]') || {}).value || "").trim();
      const expiry = String((document.querySelector('[data-rcv-expiry="' + idx + '"]') || {}).value || "");
      const qty = Number((document.querySelector('[data-rcv-qty="' + idx + '"]') || {}).value || 0);
      const remaining = Number(items[idx].remaining || 0);
      if (!batch) { msg.className = "wms-msg error"; msg.textContent = "أدخل رقم التشغيلة لكل الأصناف"; return; }
      if (!expiry) { msg.className = "wms-msg error"; msg.textContent = "أدخل تاريخ الصلاحية لكل الأصناف"; return; }
      if (qty <= 0) { msg.className = "wms-msg error"; msg.textContent = "الكمية يجب أن تكون أكبر من صفر"; return; }
      if (qty > remaining) { msg.className = "wms-msg error"; msg.textContent = "كمية تتجاوز المتبقي في أمر الشراء لصنف: " + items[idx].product_name; return; }
      payload.push({
        product_id: items[idx].product_id,
        batch_number: batch,
        expiry_date: expiry,
        quantity: qty,
        unit_cost: Number(items[idx].unit_price || 0),
      });
    }
    try {
      const created = await wmsRpc(client, "wms_gr_create", {
        p_purchase_order_id: po.id,
        p_items: payload,
        p_notes: "استلام من شاشة التشغيل",
      });
      msg.className = "wms-msg ok";
      msg.textContent = "✅ تم حفظ المسودة " + created.receipt_number;
      await renderReceivingLists(client);
      const postBtn = document.querySelector('[data-rcv-post="' + created.receipt_id + '"]');
      if (postBtn) postBtn.focus();
    } catch (e) {
      await logMovementFailure(client, e, { entity_type: "goods_receipt" });
      msg.className = "wms-msg error";
      msg.textContent = "تعذر الحفظ: " + (e && e.message);
    }
  });
}

async function postReceipt(client, receiptId) {
  if (!confirm("تأكيد ترحيل مستند الاستلام؟ الترحيل يزيد المخزون ويُنشئ سجلاً غير قابل للتعديل.")) return;
  try {
    const res = await wmsRpc(client, "wms_gr_post", { p_receipt_id: receiptId });
    alert("✅ تم الترحيل: " + res.receipt_number + " — " + res.total_quantity + " وحدة");
    await renderReceivingLists(client);
  } catch (e) {
    await logMovementFailure(client, e, { entity_type: "goods_receipt", entity_id: receiptId });
    alert("تعذر الترحيل: " + (e && e.message));
  }
}

async function cancelReceipt(client, receiptId) {
  if (!confirm("إلغاء مستند الاستلام؟")) return;
  try {
    await wmsRpc(client, "wms_gr_cancel", { p_receipt_id: receiptId });
    await renderReceivingLists(client);
  } catch (e) {
    alert("تعذر الإلغاء: " + (e && e.message));
  }
}


// --- المرحلة 1: شاشة المخزون (مخزون FEFO / أصناف / حركات) ---

let inventoryTab = "stock";

async function loadInventorySection(body, client) {
  body.innerHTML = `
    <div class="wms-tabs">
      <button class="wms-tab" data-tab="stock" type="button">📦 المخزون</button>
      <button class="wms-tab" data-tab="products" type="button">🏷️ الأصناف</button>
      <button class="wms-tab" data-tab="movements" type="button">🔁 الحركات</button>
    </div>
    <div id="inv-error"></div>
    <div id="inv-panel"></div>`;

  document.querySelectorAll(".wms-tab").forEach((tab) => {
    if (tab.getAttribute("data-tab") === inventoryTab) tab.classList.add("active");
    tab.addEventListener("click", () => {
      inventoryTab = tab.getAttribute("data-tab");
      document.querySelectorAll(".wms-tab").forEach((t) => t.classList.toggle("active", t === tab));
      renderInventoryTab(client);
    });
  });
  await renderInventoryTab(client);
}

async function renderInventoryTab(client) {
  const panel = document.getElementById("inv-panel");
  const errBox = document.getElementById("inv-error");
  if (!panel) return;
  errBox.innerHTML = "";
  try {
    if (inventoryTab === "stock") await renderStockTab(client, panel);
    else if (inventoryTab === "products") await renderProductsTab(client, panel);
    else await renderMovementsTab(client, panel);
  } catch (e) {
    panel.innerHTML = "";
    errBox.innerHTML = sectionErrorHtml("تعذر تحميل البيانات: " + (e && e.message));
  }
}

async function renderStockTab(client, panel) {
  panel.innerHTML = `
    <div class="wms-toolbar">
      <input id="stock-search" class="wms-input" type="search" placeholder="🔎 اسم الصنف أو رقم التشغيلة..." />
      <input id="stock-barcode" class="wms-input" placeholder="📱 مسح الباركود ثم Enter" />
      <select id="stock-status" class="wms-input">
        <option value="all">كل الحالات</option>
        <option value="available">متاح</option>
        <option value="reserved">محجوز/تجهيز</option>
        <option value="quarantine">تحت الفحص</option>
        <option value="damaged">تالف</option>
        <option value="expired">منتهي الصلاحية</option>
      </select>
      <button class="btn" id="stock-refresh" type="button">🔄</button>
    </div>
    <div id="stock-result"><p class="muted">⏳ جارٍ التحميل...</p></div>`;

  const load = async () => {
    const box = document.getElementById("stock-result");
    try {
      const search = String((document.getElementById("stock-search") || {}).value || "").trim();
      const status = String((document.getElementById("stock-status") || {}).value || "all");
      const res = await wmsRpc(client, "wms_stock_list", {
        p_search: search, p_status: status, p_limit: 200, p_offset: 0,
      });
      const rows = (res && res.rows) || [];
      box.innerHTML = `
        <p class="mms-sub muted">${rows.length} صنف (مرتب حسب أقرب تاريخ صلاحية FEFO) — الإجمالي ${(res && res.total) || 0}</p>
        ${rows.length ? `
        <div class="wms-table-wrap">
          <table class="wms-table">
            <thead><tr>
              <th>الصنف</th><th>التشغيليلة</th><th>الصلاحية</th>
              <th>المتاح</th><th>محجوز</th><th>تجهيز</th><th>فحص</th><th>تالف</th><th>منتهي</th>
              <th>الحالة</th>
            </tr></thead>
            <tbody>
              ${rows.map((r) => `<tr>
                <td data-label="الصنф">${esc(r.product_name)}<br/><span class="muted small">${esc(r.barcode || "")}</span></td>
                <td data-label="التشغيليلة">${esc(r.batch_number)}</td>
                <td data-label="الصلاحية">${esc(r.expiry_date)}</td>
                <td data-label="متاح"><strong>${esc(r.available_quantity)}</strong></td>
                <td data-label="محجوز">${esc(r.reserved_quantity)}</td>
                <td data-label="تجهيز">${esc(r.staging_quantity)}</td>
                <td data-label="فحص">${esc(r.quarantine_quantity)}</td>
                <td data-label="تالف">${esc(r.damaged_quantity)}</td>
                <td data-label="منتهي">${esc(r.expired_quantity)}</td>
                <td data-label="الحالة">${stockBadge(r.stock_status)}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>` : sectionEmptyHtml("لا يوجد مخزون مطابق للفلاتر الحالية.")}`;
    } catch (e) {
      box.innerHTML = sectionErrorHtml("تعذر تحميل المخزون: " + (e && e.message));
    }
  };

  document.getElementById("stock-refresh").addEventListener("click", load);
  document.getElementById("stock-status").addEventListener("change", load);
  document.getElementById("stock-search").addEventListener("input", debounce(load, 350));
  document.getElementById("stock-barcode").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const code = String(e.target.value || "").trim();
    if (!code) return;
    document.getElementById("stock-search").value = code;
    e.target.value = "";
    load();
  });
  await load();
}

async function renderProductsTab(client, panel) {
  panel.innerHTML = `
    <form id="product-form" class="wms-form">
      <h3 class="wms-block-title">➕ إضافة صنف</h3>
      <div class="wms-form-grid">
        <label>اسم الصنف *<input class="wms-input" name="name" required placeholder="مثال: باراسيتامول 500" /></label>
        <label>الاسم بالعربية<input class="wms-input" name="name_ar" placeholder="اختياري" /></label>
        <label>الباركود<input class="wms-input" name="barcode" placeholder="622..." /></label>
        <label>وحدة القياس
          <select class="wms-input" name="unit">
            <option value="box">علبة (box)</option>
            <option value="piece">قطعة (piece)</option>
            <option value="ampoule">أمبول (ampoule)</option>
            <option value="bottle">زجاجة (bottle)</option>
          </select>
        </label>
        <label>الصلاحية (شهر)<input class="wms-input" type="number" name="shelf" min="0" value="24" /></label>
        <label>الحد الأدنى<input class="wms-input" type="number" name="min" min="0" value="0" /></label>
        <label>الحد الأقصى<input class="wms-input" type="number" name="max" min="0" value="1000" /></label>
      </div>
      <p id="product-msg" class="wms-msg"></p>
      <button class="btn primary" type="submit">💾 حفظ الصنف</button>
    </form>
    <div class="wms-toolbar">
      <input id="product-search" class="wms-input" type="search" placeholder="🔎 بحث عن صنف..." />
    </div>
    <div id="product-list"><p class="muted">⏳ جارٍ التحميل...</p></div>`;

  const load = async () => {
    const box = document.getElementById("product-list");
    try {
      const term = String((document.getElementById("product-search") || {}).value || "").trim();
      const rows = await wmsRpc(client, "wms_product_list", { p_search: term, p_limit: 200 });
      box.innerHTML = (rows || []).length ? `
        <div class="wms-table-wrap">
          <table class="wms-table">
            <thead><tr><th>الصنف</th><th>الباركود</th><th>الوحدة</th><th>الصلاحية</th><th>الحد الأدنى</th></tr></thead>
            <tbody>
              ${rows.map((p) => `<tr>
                <td data-label="الصنф">${esc(p.name_ar || p.name)}</td>
                <td data-label="الباركود">${esc(p.barcode || "—")}</td>
                <td data-label="الوحدة">${esc(p.unit_of_measure || "—")}</td>
                <td data-label="الصلاحية">${p.shelf_life_months ? esc(p.shelf_life_months) + " شهر" : "—"}</td>
                <td data-label="الحد الأدنى">${esc(p.min_stock_level)}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>` : sectionEmptyHtml("لا توجد أصناف بعد — أضف أول صنف من النموذج أعلاه.");
    } catch (e) {
      box.innerHTML = sectionErrorHtml("تعذر تحميل الأصناف: " + (e && e.message));
    }
  };

  document.getElementById("product-search").addEventListener("input", debounce(load, 350));
  document.getElementById("product-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const msg = document.getElementById("product-msg");
    const name = String(fd.get("name") || "").trim();
    if (!name) return;
    try {
      await wmsRpc(client, "wms_product_create", {
        p_name: name,
        p_name_ar: String(fd.get("name_ar") || "").trim(),
        p_barcode: String(fd.get("barcode") || "").trim(),
        p_unit: String(fd.get("unit") || "box"),
        p_shelf_life_months: Number(fd.get("shelf") || 0),
        p_min_stock: Number(fd.get("min") || 0),
        p_max_stock: Number(fd.get("max") || 1000),
      });
      msg.className = "wms-msg ok";
      msg.textContent = "✅ تم حفظ الصنف";
      e.target.reset();
      await load();
    } catch (err) {
      msg.className = "wms-msg error";
      msg.textContent = "تعذر الحفظ: " + (err && err.message);
    }
  });
  await load();
}

async function renderMovementsTab(client, panel) {
  panel.innerHTML = `
    <div class="wms-toolbar">
      <input id="mov-search" class="wms-input" type="search" placeholder="🔎 بحث بالتشغيلة أو نوع المستند..." />
    </div>
    <div id="mov-list"><p class="muted">⏳ جارٍ التحميل...</p></div>`;

  const load = async () => {
    const box = document.getElementById("mov-list");
    try {
      const term = String((document.getElementById("mov-search") || {}).value || "").trim();
      const rows = await wmsRpc(client, "wms_movements_list", { p_search: term, p_limit: 100, p_offset: 0 });
      box.innerHTML = (rows || []).length ? `
        <div class="wms-table-wrap">
          <table class="wms-table">
            <thead><tr><th>التاريخ</th><th>النوع</th><th>الصنف</th><th>التشغيلة</th><th>الكمية</th><th>المستند</th></tr></thead>
            <tbody>
              ${rows.map((m) => `<tr>
                <td data-label="التاريخ">${new Date(m.created_at).toLocaleString("ar-EG")}</td>
                <td data-label="النوع">${badge(m.movement_type === "receipt" ? "استلام" : m.movement_type, "ok")}</td>
                <td data-label="الصنف">${esc(m.product_name)}</td>
                <td data-label="التشغيلة">${esc(m.batch_number || "—")}</td>
                <td data-label="الكمية">${esc(m.quantity)}</td>
                <td data-label="المستند">${esc(m.reference_number || m.reference_type || "—")}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>` : sectionEmptyHtml("لا توجد حركات مسجلة بعد.");
    } catch (e) {
      box.innerHTML = sectionErrorHtml("تعذر تحميل الحركات: " + (e && e.message));
    }
  };

  document.getElementById("mov-search").addEventListener("input", debounce(load, 350));
  await load();
}

// --- Auth forms: real Supabase Auth (signUp / signInWithPassword) ---
// Creating a new warehouse also stores its details in the warehouses table
// (subject to RLS). verifySession() blocks the dashboard without a session.
// رسالة عابرة (flash) تُعرض مرة واحدة في نموذج تسجيل الدخول ثم تُمسح
let authFlash = "";

function renderLocalAuthForm(appEl, routePath) {
  const isRegister = routePath === "/register";
  const flash = authFlash;
  authFlash = "";
  appEl.innerHTML = `
    <div class="page">
      <header class="app-header">
        <h1>${isRegister ? "🆕 إنشاء مخزن جديد" : "🔐 تسجيل الدخول للمخزن"}</h1>
      </header>
      <main style="padding:1rem;max-width:480px;margin:0 auto;">
        <form class="card" id="local-auth-form" style="padding:1.5rem;display:flex;flex-direction:column;gap:0.75rem;">
          ${flash ? `<div style="border:1px solid #2a9d5c;background:#e9f9f0;color:#146c43;text-align:center;padding:0.75rem;border-radius:6px;margin-bottom:0.25rem;">✅ ${flash}</div>` : ""}
          ${isRegister ? `
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
          <label>البريد الإلكتروني
            <input type="email" name="email" required placeholder="user@example.com" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
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
          </label>` : ""}
          <p id="auth-form-error" style="color:#d33;min-height:1.2em;margin:0;"></p>
          <button class="btn primary" type="submit">${isRegister ? "تسجيل المخزن" : "دخول"}</button>
          <p class="muted" style="font-size:0.85rem;margin:0;">مصادقة حقيقية عبر Supabase — تُحمى قاعدة البيانات بسياسات الأمان (RLS).</p>
          <a class="btn" data-link href="${isRegister ? "/login" : "/register"}">${isRegister ? "لدي حساب بالفعل — تسجيل دخول" : "إنشاء مخزن جديد ←"}</a>
          <a class="btn" data-link href="/">← العودة للرئيسية</a>
        </form>
      </main>
    </div>`;

  const form = document.getElementById("local-auth-form");
  if (!form) return;
  if (isRegister) wireGovernorateSearch();
  else resumePendingStep2(appEl);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const email = String(fd.get("email") || "").trim();
    const password = String(fd.get("password") || "");
    const warehouse = String(fd.get("warehouse") || "").trim();
    const errEl = document.getElementById("auth-form-error");
    const setError = (m) => { if (errEl) errEl.textContent = m; };
    let phone = "", governorate = "", password2 = "", adminPassword = "", adminPassword2 = "";
    if (isRegister) {
      phone = String(fd.get("phone") || "").trim().replace(/[^0-9]/g, "");
      governorate = String(fd.get("governorate") || "").trim();
      password2 = String(fd.get("password2") || "");
      adminPassword = String(fd.get("admin_password") || "");
      adminPassword2 = String(fd.get("admin_password2") || "");
      if (!warehouse) { setError("أدخل اسم المخزن"); return; }
      if (!/^01[0125][0-9]{8}$/.test(phone)) { setError("رقم التليفون غير صحيح — مثال: 01012345678"); return; }
      if (!governorate) { setError("اختر المحافظة من القائمة المنسدلة"); return; }
      if (!email || password.length < 6) { setError("أدخل البريد وكلمة مرور من 6 أحرف على الأقل"); return; }
      if (password !== password2) { setError("كلمتا المرور غير متطابقتين"); return; }
      if (adminPassword.length < 6) { setError("كلمة مرور المدير يجب ألا تقل عن 6 أحرف"); return; }
      if (adminPassword !== adminPassword2) { setError("كلمتا مرور المدير غير متطابقتين"); return; }
    } else if (!email || password.length < 6) {
      setError("أدخل البريد وكلمة مرور من 6 أحرف على الأقل");
      return;
    }
    const client = getSupabase();
    if (!client) {
      setError("تعذر الاتصال بخدمة Supabase — لم يتم ضبط المفتاح العام (anon key) بعد.");
      return;
    }
    try {
      if (isRegister) {
        // 1) إنشاء حساب المخزن (Supabase Auth signUp)
        const { data, error } = await client.auth.signUp({
          email: email,
          password: password,
          options: { data: { warehouse_name: warehouse, phone: phone, governorate: governorate, full_name: warehouse, role: "manager" } }
        });
        if (error) { setError(authErrorMessage(error)); return; }
        const user = data && data.user;
        if (user) {
          // 2) حفظ البيانات الكاملة في جداول Supabase (أفضل جهد — خاضع لـ RLS)
          try {
            const adminHash = await sha256b64url(adminPassword);
            let tenantId = null;
            const t = await client.from("tenants").select("id").limit(1);
            if (t.data && t.data[0]) tenantId = t.data[0].id;
            if (!tenantId) {
              const created = await client.from("tenants").insert({ name: warehouse }).select("id").single();
              if (created.data) tenantId = created.data.id;
            }
            if (tenantId) {
              // جدول المخازن بكل حقوله المتاحة: بيانات التواصل + hash كلمة مرور
              // المدير + المالك (manager_id)، مع رجوع تدريجي إن رفض المخطط حقل ما
              const whPayload = { tenant_id: tenantId, name: warehouse, phone: phone, governorate: governorate, is_main: true, password_hash: adminHash, manager_id: user.id };
              let wh = await client.from("warehouses").insert(whPayload);
              if (wh.error) {
                delete whPayload.password_hash;
                delete whPayload.manager_id;
                wh = await client.from("warehouses").insert(whPayload);
              }
            }
            // التليفون والمحافظة في profiles (أعمدة مثبتة هناك)
            await client.from("profiles").upsert({ id: user.id, full_name: warehouse, phone: phone, governorate: governorate, role: "manager" }, { onConflict: "id" });
            // كلمة مرور المدير بصيغة worker.js: SHA-256 → base64url
            await client.from("warehouse_password_hashes").insert({ user_id: user.id, hash: adminHash });
          } catch (_) { /* قد ترفض RLS إدراج صفوف لمستخدم جديد */ }
        }
        // إنشاء الحساب نجح → تسجيل خروج فوري وتوجيه لصفحة الدخول برسالة
        try { await client.auth.signOut(); } catch (_) { /* لا جلسة إن طُلب تفعيل */ }
        clearSession();
        clearStep2Mark();
        authFlash = data && data.session
          ? "تم إنشاء الحساب بنجاح، يرجى تسجيل الدخول"
          : "تم إنشاء الحساب بنجاح، يرجى تسجيل الدخول بعد تفعيل حسابك عبر البريد";
        navigate("/login");
        return;
      }
      // الخطوة الأولى: Supabase Auth — التحقق من البريد وكلمة المرور
      const { data, error } = await client.auth.signInWithPassword({ email: email, password: password });
      if (error) { setError(authErrorMessage(error)); return; }
      const user = data.user;
      const meta = (user && user.user_metadata) || {};
      // لا فتح للوحة التحكم بعد — تظهر الخطوة الثانية أولاً
      renderStep2Form(appEl, {
        id: user.id,
        email: user.email || email,
        name: meta.warehouse_name || meta.full_name || meta.name || email,
        warehouse_id: meta.warehouse_id || "",
        token: data.session.access_token,
        meta: meta
      });
    } catch (err) {
      setError(authErrorMessage(err, "تعذر الاتصال بقاعدة البيانات"));
    }
  });
}

// --- الخطوة الثانية: كلمة مرور المدير/الموظف ---
// علامة نجاح الخطوة الثانية تُحفظ لكل مستخدم؛ بدونها يبقى الحارس مغلقاً.
function step2Ok(uid) {
  try {
    const m = JSON.parse(localStorage.getItem("step2_ok") || "null");
    return !!(m && m.uid === uid);
  } catch (_) { return false; }
}
function writeStep2Mark(uid) {
  try { localStorage.setItem("step2_ok", JSON.stringify({ uid: uid, at: Date.now() })); } catch (_) { /* ignore */ }
}
function clearStep2Mark() {
  try { localStorage.removeItem("step2_ok"); } catch (_) { /* ignore */ }
}

// جمع كلمات مرور المدير المخزنة: جدول المخازن أولاً ثم جدول الهاش (تحت RLS)
async function fetchManagerHashes(client, uid) {
  const hashes = [];
  try {
    const w = await client.from("warehouses").select("id,manager_id,password_hash").eq("manager_id", uid).limit(10);
    if (!w.error && Array.isArray(w.data)) {
      w.data.forEach((r) => { if (r && r.password_hash) hashes.push(r.password_hash); });
    }
  } catch (_) { /* جدول قد يرفض RLS */ }
  try {
    const r = await client.from("warehouse_password_hashes").select("hash").eq("user_id", uid);
    if (!r.error && Array.isArray(r.data)) {
      r.data.forEach((x) => { if (x && x.hash) hashes.push(x.hash); });
    }
  } catch (_) { /* جدول قد لا يكون منشأاً */ }
  // بيانات مستخدم Supabase: نفس حقل worker.js (admin_password_hash)
  try {
    const s = await client.auth.getSession();
    const meta = s && s.data && s.data.session && s.data.session.user && s.data.session.user.user_metadata;
    if (meta && meta.admin_password_hash) hashes.push(meta.admin_password_hash);
  } catch (_) { /* ignore */ }
  return hashes;
}

// إن كانت هناك جلسة Supabase سليمة لم تُكمل بعد الخطوة الثانية،
// اعرض نموذج كلمة مرور المدير مباشرة بدلاً من الخطوة الأولى.
async function resumePendingStep2(appEl) {
  const client = getSupabase();
  if (!client) return;
  try {
    const { data } = await client.auth.getSession();
    if (!data || !data.session || !data.session.user) return;
    const u = data.session.user;
    if (step2Ok(u.id)) return; // مكتملة — الحارس سيفتح لوحة التحكم
    const meta = u.user_metadata || {};
    renderStep2Form(appEl, {
      id: u.id,
      email: u.email || "",
      name: meta.warehouse_name || meta.full_name || meta.name || "",
      warehouse_id: meta.warehouse_id || "",
      token: data.session.access_token,
      meta: meta
    });
  } catch (_) { /* ignore */ }
}

function renderStep2Form(appEl, info) {
  appEl.innerHTML = `
    <div class="page">
      <header class="app-header">
        <h1>🔑 الخطوة الثانية: كلمة مرور المدير</h1>
      </header>
      <main style="padding:1rem;max-width:480px;margin:0 auto;">
        <form class="card" id="step2-form" style="padding:1.5rem;display:flex;flex-direction:column;gap:0.75rem;">
          <p style="margin:0;">✅ تم التحقق من البريد وكلمة المرور:<br /><b>${info.email}</b></p>
          <label>كلمة مرور المدير أو الموظف
            <input type="password" id="manager-password" required minlength="6" placeholder="••••••" style="width:100%;padding:0.5rem;margin-top:0.25rem;" />
          </label>
          <p id="step2-error" style="color:#d33;min-height:1.2em;margin:0;"></p>
          <button class="btn primary" type="submit">تأكيد ودخول لوحة التحكم</button>
          <p class="muted" style="font-size:0.85rem;margin:0;">لن تُفتح لوحة التحكم قبل نجاح الخطوتين معاً.</p>
          <button class="btn" type="button" id="switch-account">تسجيل الخروج من هذا الحساب</button>
        </form>
      </main>
    </div>`;

  const swBtn = document.getElementById("switch-account");
  if (swBtn) {
    swBtn.addEventListener("click", async () => {
      const client = getSupabase();
      try { if (client) await client.auth.signOut(); } catch (_) { /* ignore */ }
      clearSession();
      clearStep2Mark();
      navigate("/login");
    });
  }

  const form = document.getElementById("step2-form");
  const errEl = document.getElementById("step2-error");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pwInput = document.getElementById("manager-password");
    const pw = String((pwInput && pwInput.value) || "");
    const setErr = (m) => { if (errEl) errEl.textContent = m; };
    if (pw.length < 6) { setErr("كلمة مرور المدير يجب ألا تقل عن 6 أحرف"); return; }
    const client = getSupabase();
    if (!client) { setErr("تعذر الاتصال بقاعدة Supabase"); return; }
    try {
      const hash = await sha256b64url(pw);
      // التحقق من البيانات المخزنة في جدول المخازن (warehouses.password_hash)
      // أولاً، ثم warehouse_password_hashes للتوافق — كلاهما خاضع لـ RLS
      const hashes = await fetchManagerHashes(client, info.id);
      if (hashes.length === 0) {
        // أول دخول: حفظ كلمة مرور المدير في كل الأماكن المتاحة
        let saved = false;
        // 1) جدول المخازن (إذا كان للمستخدم صف مرتبط بـ manager_id)
        try {
          const wu = await client.from("warehouses").update({ password_hash: hash }).eq("manager_id", info.id).select("id");
          if (!wu.error && wu.data && wu.data.length) saved = true;
        } catch (_) { /* ignore */ }
        // 2) جدول warehouse_password_hashes إن وُجد (قد لا يكون منشأاً في بعض المشاريع)
        try {
          const ins = await client.from("warehouse_password_hashes").insert({ user_id: info.id, hash: hash });
          if (!ins.error) saved = true;
        } catch (_) { /* ignore */ }
        // 3) بيانات مستخدم Supabase — نفس حقل worker.js admin_password_hash
        try {
          const s = await client.auth.getSession();
          const cur = (s && s.data && s.data.session && s.data.session.user && s.data.session.user.user_metadata) || {};
          const up = await client.auth.updateUser({ data: Object.assign({}, cur, { admin_password_hash: hash }) });
          if (!up.error) saved = true;
        } catch (_) { /* ignore */ }
        if (!saved) {
          setErr("تعذر حفظ كلمة المرور المدير — أعد المحاولة أو تواصل مع المسؤول");
          return;
        }
      } else if (hashes.indexOf(hash) === -1) {
        setErr("كلمة مرور المدير غير صحيحة");
        return;
      }
      // نجاح الخطوتين معاً → فتح لوحة التحكم
      writeStep2Mark(info.id);
      setSession({
        id: info.id,
        email: info.email,
        role: (info.meta && info.meta.role) || "manager",
        name: info.name,
        warehouse_id: info.warehouse_id || "",
        access_token: info.token
      });
      navigate("/");
    } catch (err) {
      setErr(authErrorMessage(err, "تعذر التحقق من كلمة المرور"));
    }
  });
}

// --- SHA-256 → base64url (نفس صيغة worker.js لكلمة مرور المدير) ---
async function sha256b64url(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let s = "";
  new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// القائمة المنسدلة لمحافظات مصر مع دعم البحث (27 محافظة)
function wireGovernorateSearch() {
  const input = document.getElementById("governorate-input");
  const menu = document.getElementById("governorate-menu");
  if (!input || !menu) return;
  const renderMenu = (q) => {
    const query = String(q || "").trim();
    const list = GOVERNORATES.filter((g) => !query || g.indexOf(query) !== -1);
    menu.innerHTML = list.length
      ? list.map((g) => `<div class="gov-item" data-gov="${g}" style="padding:0.5rem;cursor:pointer;">${g}</div>`).join("")
      : `<div style="padding:0.5rem;color:#999;">لا توجد نتائج</div>`;
    menu.style.display = "block";
  };
  input.addEventListener("focus", () => renderMenu(input.value));
  input.addEventListener("input", () => renderMenu(input.value));
  input.addEventListener("blur", () => { setTimeout(() => { menu.style.display = "none"; }, 150); });
  menu.addEventListener("mousedown", (e) => {
    const item = e.target && e.target.closest ? e.target.closest("[data-gov]") : null;
    if (!item) return;
    e.preventDefault();
    input.value = item.getAttribute("data-gov") || "";
    menu.style.display = "none";
  });
}

// --- Navigation ---

function navigate(path) {
  const target = path.replace(/\/+$/, "") || "/";
  const current = location.pathname.replace(/\/+$/, "") || "/";
  // Only push history when the URL actually changes — calling pushState for the
  // same path re-triggers render() and causes "Maximum call stack size exceeded".
  if (current !== target) {
    history.pushState({}, "", target);
  }
  render();
}
window.addEventListener("popstate", render);

// --- Module Cards ---

const SALES_SECTIONS = [
  { href: "/sales/quotes", icon: "🏷️", title: "عروض الأسعار", desc: "إنشاء عرض سعر وتحويله إلى طلب" },
  { href: "/sales/invoices", icon: "🧾", title: "فواتير البيع", desc: "فواتير البيع وحالات الترحيل" },
  { href: "/sales/returns", icon: "↩️", title: "مرتجعات البيع", desc: "مرتجعات المبيعات والاسترداد" },
  { href: "/sales/payments", icon: "💵", title: "المدفوعات", desc: "تحصيل المدفوعات والمديونية" }
];

// بطاقات الأقسام تُرسم ضمن صفحة الرئيسية نفسها (innerHTML واحد) حتى تظهر فوراً.
function moduleCardsHtml() {
  const modules = [
    { href: "/inventory", icon: "📦", title: "المخزون", desc: "الرصيد بالتشغيلات وFEFO والأصناف والحركات" },
    { href: "/receiving", icon: "📥", title: "الاستلام", desc: "استلام أوامر الشراء وترحيل المستندات" },
    { href: "/sales", icon: "🛍️", title: "المبيعات", desc: "إدارة دورة المبيعات", cls: "sales-featured", cta: "فتح قسم المبيعات" },
    { href: "/purchases", icon: "🛒", title: "المشتريات", desc: "إدارة المشتريات والموردين" },
    { href: "/financial", icon: "💰", title: "المالية", desc: "الشجرة والحركات والميزان" }
  ];

  return modules.map(m => `
      <a class="card link-card${m.cls ? " " + m.cls : ""}" data-link href="${m.href}">
        <h3>${m.icon} ${m.title}</h3>
        <p>${m.desc}</p>
        <span class="card-cta">${m.cta || "فتح الصفحة ←"}</span>
      </a>`).join("");
}

// --- Event Delegation ---

document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link]");
  if (!a) return;
  e.preventDefault();
  // Use safe navigation for internal links
  const linkHref = a.getAttribute("href");
  if (linkHref) {
    safeNavigate(linkHref);
  }
});

// --- Boot: strict authentication guard ---
// Nothing is rendered on screen before the session check has finished.
(() => {
  // 1) Immediately hide the whole app behind the auth gate.
  renderAuthGate();

  // 2) Verify the session first; only then render the dashboard,
  //    otherwise bounce straight to the login / new-warehouse page.
  setTimeout(() => {
    render().catch((e) => {
      console.error("App render error:", e);
      // Fail closed: never leave a half-rendered dashboard on screen.
      clearSession();
      navigate("/login");
    });
  }, 50);
})();