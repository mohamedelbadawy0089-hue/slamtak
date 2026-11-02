/**
 * tenant-context.js
 * ====================
 * وحدة JavaScript للتعامل مع tenant_id في تطبيق multi-tenant.
 * 
 * يوفر هذه الوحدة:
 * - getTenantContext(): الحصول على tenant_id و warehouse_id للمستخدم الحالي
 * - withTenantFilter(query): إضافة tenant_id фильتر للـ Supabase queries
 * - assertTenantAccess(): التحقق من صلاحية tenant الحالي
 * - getDefaultWarehouse(): اختيار warehouse الافتراضي للمستخدم
 */

window.TenantContext = (function() {
  'use strict';

  // ============================================================
  // المتغيرات الداخلية ( 캐시 )
  // ============================================================
  let _cachedContext = null;
  let _lastFetchTime = 0;
  const CACHE_TTL = 30000; // 30 ثانية

  // ============================================================
  // getCurrentSession()
  // ============================================================
  function getCurrentSession() {
    try {
      const raw = localStorage.getItem('session');
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  // ============================================================
  // getCurrentTenantId()
  // استعلام مباشر لقاعدة البيانات للحصول على tenant_id
  // ============================================================
  async function getCurrentTenantId(client) {
    if (!client) return null;
    
    try {
      // استخدام دالة current_tenant_id() التي أنشأناها في migration
      const { data, error } = await client.rpc('current_tenant_id');
      if (error) {
        console.warn(' current_tenant_id() failed:', error.message);
        return null;
      }
      return data;
    } catch (err) {
      console.warn(' getCurrentTenantId error:', err.message);
      return null;
    }
  }

  // ============================================================
  // getCurrentContext()
  // الحصول على سياق tenant الحالي (tenant_id + warehouse_id)
  // ============================================================
  async function getCurrentContext(client) {
    if (!client) return null;

    // محاولة استخدام الدالة الحسابية أولاً
    try {
      // استخدام دالة current_tenant_context()
      const { data, error } = await client.rpc('current_tenant_context');
      if (error) {
        console.warn(' current_tenant_context() failed:', error.message);
      } else if (data) {
        return data;
      }
    } catch (err) {
      console.warn(' getCurrentContext rpc error:', err.message);
    }

    // فشل الاستعلام - حاول الاستعلام المباشر
    try {
      const { data: uwData, error: uwError } = await client
        .from('user_warehouses')
        .select('tenant_id, warehouse_id, is_default')
        .eq('user_id', client.auth.getUser().then ? undefined : getCurrentSession()?.id || '00000000-0000-0000-0000-000000000000')
        .order('is_default', { ascending: false })
        .limit(1)
        .single();

      if (!uwError && uwData) {
        return {
          tenant_id: uwData.tenant_id,
          warehouse_id: uwData.warehouse_id,
          is_default: uwData.is_default
        };
      }
    } catch (_) {}

    // لا يوجد سياق
    return null;
  }

  // ============================================================
  // getTenantContext()
  // الواجهة العامة - الحصول على tenant_id الحالي
  // ============================================================
  async function getTenantContext(options = {}) {
    const { client, forceRefresh = false } = options;

    // استخدام العميل المقدم أو الأت من getSupabase()
    const supabase = client || (window.supabase && typeof window.supabase.createClient === 'function' 
      ? window.supabase.createClient(
          window.SUPABASE_CONFIG?.url || 'https://iksjhjxwphmvthryfeae.supabase.co',
          window.SUPABASE_CONFIG?.anonKey || ''
        )
      : null);

    if (!supabase) {
      // بدون عميل Supabase - حاول الحصول من الجلسة النصية
      const session = getCurrentSession();
      if (session?.tenant_id) {
        return { tenant_id: session.tenant_id, warehouse_id: session.warehouse_id };
      }
      return null;
    }

    // التحقق من الكاش
    if (!_cachedContext || forceRefresh || Date.now() - _lastFetchTime > CACHE_TTL) {
      _cachedContext = await getCurrentContext(supabase);
      _lastFetchTime = Date.now();
    }

    return _cachedContext;
  }

  // ============================================================
  // withTenantFilter()
  // إضافة tenant_id filter لـ Supabase query
  // ============================================================
  async function withTenantFilter(client, table, baseQuery, additionalFilters = {}) {
    if (!client || !table) return null;

    // الحصول على tenant_id
    const ctx = await getTenantContext({ client });
    if (!ctx?.tenant_id) {
      // tenant غير معروف - لا نفلتر (مشاكل توافق)
      console.warn(` withTenantFilter: no tenant_id for table ${table}`);
      return null;
    }

    // بناء الاستعلام
    let query = client.from(table);

    // تطبيق tenant_id filter
    // الأولوية للجداول التي لها tenant_id أساسية
    const tenantColumn = 'tenant_id';
    query = query.eq(tenantColumn, ctx.tenant_id);

    // تطبيق الفلاتر الإضافية
    Object.entries(additionalFilters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        query = query[key](value);
      }
    });

    return query;
  }

  // ============================================================
  // assertTenantAccess()
  // التحقق من صلاحية الوصول للـ tenant الحالي
  // ============================================================
  async function assertTenantAccess(client) {
    const ctx = await getTenantContext({ client });
    
    if (!ctx || !ctx.tenant_id) {
      throw new Error('لا يوجد tenant مخصص لهذا المستخدم. يجب إنشاء مخزن أولاً.');
    }

    if (!ctx.warehouse_id) {
      throw new Error('لا يوجد مخزن مصاحب لهذا المستخدم.');
    }

    return ctx;
  }

  // ============================================================
  // getDefaultWarehouse()
  // الحصول على warehouse_id الافتراضي
  // ============================================================
  async function getDefaultWarehouse(client) {
    const ctx = await getTenantContext({ client });
    return ctx?.warehouse_id || null;
  }

  // ============================================================
  // إ экспорт واجهات
  // ============================================================
  return {
    getTenantContext,
    withTenantFilter,
    assertTenantAccess,
    getDefaultWarehouse,
    getCurrentTenantId: (client) => getCurrentTenantId(client || (window.supabase ? null : null)),
    clearCache: () => {
      _cachedContext = null;
      _lastFetchTime = 0;
    }
  };
})();

// جعل الوظائف متاحة عالمياً في النافذة
window.getTenantContext = TenantContext.getTenantContext.bind(TenantContext);
window.withTenantFilter = TenantContext.withTenantFilter.bind(TenantContext);
window.assertTenantAccess = TenantContext.assertTenantAccess.bind(TenantContext);
window.getDefaultWarehouse = TenantContext.getDefaultWarehouse.bind(TenantContext);
