// نظام إدارة المخزن - Slamtak ERP
// واجهة عربية كاملة + استمارة تسجيل مخزن + صفحات تشغيلية حقيقية

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
  sbClient.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      window.location.href = "/login";
    }
  });
  return sbClient;
}

function initApp() {
  const appEl = document.getElementById("app");
  const sb = getSupabase();
  if (!sb) {
    appEl.innerHTML = '<div class="card error-card"><h2>خطأ في التحميل</h2><p>لم يتمكن من تحميل تطبيق Supabase.</p></div>';
    return;
  }
  appEl.innerHTML = '<div class="card"><h2>مرحباً بك في Slamtak ERP</h2><p>اختر من القائمة:</p><ul><li><a href="/login">تسجيل الدخول</a></li><li><a href="/register">تسجيل مخزن جديد</a></li></ul></div>';
}

document.addEventListener("DOMContentLoaded", initApp);