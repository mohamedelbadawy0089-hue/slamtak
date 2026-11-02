/**
 * post-login-setup.js
 * ===================
 * إعدادات إضافية بعد تسجيل الدخول:
 * - إضافة tenant_id للـ session
 * - تحميل سياق RBAC
 * - تفعيل employee permissions
 */

(function () {
  'use strict';

  // متابعة بعد تحميل صفحة تسجيل الدخول
  addEventListener('DOMContentLoaded', async () => {
    await setupPostLogin();
  });

  // ============================================================
  // إعداد ما بعد تسجيل الدخول
  // ============================================================
  async function setupPostLogin() {
    if (!window.__supabase_loaded) {
      console.warn('post-login-setup: Supabase not loaded yet');
      return;
    }

    const client = getSupabase();
    if (!client) return;

    try {
      // جلب-session الحالية
      const { data: { session } } = await client.auth.getSession();
      if (!session) {
        // لمسجل دخوله
        return;
      }

      // إذا كان المستخدم مسجلاً بالفعل
      await enhanceSession(client, session);

      // تحميل سياق RBAC
      await loadUserContext(client, session);

    } catch (e) {
      console.error('post-login-setup error:', e);
    }
  }

  // ============================================================
  // تحسين الجلسة بإضافة tenant_id
  // ============================================================
  async function enhanceSession(client, session) {
    try {
      // جلب tenant_id الحالي
      const { data: { tenant_id }, error } = await client.rpc('current_tenant_id');
      if (!error && tenant_id) {
        session.tenant_id = tenant_id;
        // حفظ في localStorage للاستخدام المستقبلي
        try {
          localStorage.setItem('slamtak:tenant_id', tenant_id);
        } catch (_) {}
      }
    } catch (_) {}
  }

  // ============================================================
  // تحميل سياق المستخدم الكامل
  // ============================================================
  async function loadUserContext(client, session) {
    try {
      const ctx = await loadPermissionContext(client, session);
      if (ctx.loaded) {
        // تخزين السياق في الجلسة
        session.permissions = ctx.permissions;
        session.role = ctx.role;
        session.warehouse_id = ctx.warehouse_id;
        session.tenant_id = ctx.tenant_id;
      }
    } catch (_) {}
  }

  // ============================================================
  // مثبت الأحداث: عند تسجيل دخول جديد
  // ============================================================
  function onAuthStateChange(callback) {
    const client = getSupabase();
    if (!client) return;

    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        // إعادة تحميل السياق بعد تسجيل الدخول
        enhanceSession(client, session);
        loadUserContext(client, session);
      }
      if (event === 'SIGNED_OUT') {
        // مسح tenant_id عند الخروج
        try {
          localStorage.removeItem('slamtak:tenant_id');
        } catch (_) {}
      }
      callback && callback(event, session);
    });
  }

  // ============================================================
  // تعريف واجهات عامة
  // ============================================================
  window.PostLoginSetup = {
    setup: setupPostLogin,
    enhanceSession,
    loadUserContext,
    onAuthStateChange
  };

})();
