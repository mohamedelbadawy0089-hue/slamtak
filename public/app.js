// Slamtak ERP Application
// This is the main frontend application

const SUPABASE_URL = 'https://iksjhjxwphmvthryfeae.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwNzU1MzYsImV4cCI6MjA4NTY1MTUzNn0.gGEGhlh8MOAdqNxY9nmHippmOe6qN1rGRAaGH8B2ooQ';

let sbClient = null;

function getSupabase() {
  if (sbClient) return sbClient;
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    return null;
  }
  sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return sbClient;
}

function initApp() {
  const appEl = document.getElementById('app');
  if (!appEl) {
    console.error('App element not found');
    return;
  }
  
  const sb = getSupabase();
  if (!sb) {
    appEl.innerHTML = '<div class="card error-card"><h2>خطأ في التحميل</h2><p>لم يتمكن من تحميل تطبيق Supabase. تأكد من وجود اتصال بالإنترنت.</p></div>';
    return;
  }
  
  appEl.innerHTML = '<div class="card"><h2>مرحباً بك في Slamtak ERP</h2><p>اختر من القائمة أدناه:</p><ul><li><a href="/login">تسجيل الدخول</a></li><li><a href="/register">تسجيل مخزن جديد</a></li></ul></div>';
}

document.addEventListener('DOMContentLoaded', initApp);
