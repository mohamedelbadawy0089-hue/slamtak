/**
 * dashboard-tenant.js
 * ====================
 * لوحة التحكم المستقلة لكل مخزن - عرض tenant info + stats
 * يعرض معلومات المخزن الحالي وإحصائيات سريعة
 */

(function() {
  'use strict';

  // ============================================================
  // دالة عرض لوحة التحكم الرئيسية
  // ============================================================
  function renderTenantDashboard(appEl, tenantContext) {
    if (!appEl) return;
    
    const ctx = tenantContext || { tenant_id: null, warehouse_id: null, warehouse_name: '', tenant_name: '' };
    
    // إحصائيات سريعة (تُملأ لاحقاً من قبل loadSectionData)
    const statsHtml = `
      <div class="dashboard-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem;margin-bottom:1rem;">
        <div class="card text-center" style="padding:1rem;">
          <div style="font-size:2.5rem;font-weight:bold;color:#2563eb;" id="stat-products">0</div>
          <div class="muted" style="font-size:0.85rem;">الأصناف</div>
        </div>
        <div class="card text-center" style="padding:1rem;">
          <div style="font-size:2.5rem;font-weight:bold;color:#16a34a;" id="stat-inventory">0</div>
          <div class="muted" style="font-size:0.85rem;">.unitات في المخزن</div>
        </div>
        <div class="card text-center" style="padding:1rem;">
          <div style="font-size:2.5rem;font-weight:bold;color:#7c3aed;" id="stat-suppliers">0</div>
          <div class="muted" style="font-size:0.85rem;">الموردون</div>
        </div>
        <div class="card text-center" style="padding:1rem;">
          <div style="font-size:2.5rem;font-weight:bold;color:#dc2626;" id="stat-customers">0</div>
          <div class="muted" style="font-size:0.85rem;">العملاء</div>
        </div>
        <div class="card text-center" style="padding:1rem;">
          <div style="font-size:2.5rem;font-weight:bold;color:#0ea5e9;" id="stat-employees">0</div>
          <div class="muted" style="font-size:0.85rem;">الموظفون</div>
        </div>
      </div>
    `;
    
    appEl.innerHTML = `
      <div class="page">
        <header class="app-header">
          <h1>🏪 ${esc(ctx.warehouse_name || 'المخزن')}</h1>
          <div style="display:flex;gap:0.5rem;align-items:center;margin-left:auto;">
            <span class="muted" style="font-size:0.85rem;">
              ${ctx.warehouse_code ? '#' + esc(ctx.warehouse_code) : ''}
              ${ctx.tenant_id ? ' • ' : ''}
              ${ctx.tenant_id ? 'المستأجر: ' + esc(ctx.tenant_name || 'N/A') : ''}
            </span>
          </div>
          <button class="btn" id="logout-btn" type="button">تسجيل الخروج</button>
        </header>
        <nav class="app-nav" aria-label="التنقل الرئيسي">
          <a href="/" data-link class="nav-link">🏠 الرئيسية</a>
          <a href="/inventory" data-link class="nav-link" data-perm="inventory.read">📦 المخزون</a>
          <a href="/receiving" data-link class="nav-link" data-perm="purchases.read">📥 الاستلام</a>
          <a href="/sales" data-link class="nav-link accent" data-perm="sales.read">🛍️ المبيعات</a>
          <a href="/purchases" data-link class="nav-link" data-perm="purchases.read">🛒 المشتريات</a>
          <a href="/hr" data-link class="nav-link" data-perm="employees.view" style="background:#667eea;color:white;font-weight:bold;">👥 HRM</a>
          <a href="/delivery" data-link class="nav-link" data-perm="sales.read" style="background:#dc2626;color:white;font-weight:bold;">🚚 التوصيل</a>
          <a href="/customer-service" data-link class="nav-link" data-perm="customers.read" style="background:#2563eb;color:white;font-weight:bold;">🎧 CRM</a>
          <a href="/automation" data-link class="nav-link" data-perm="settings.read" style="background:#16a34a;color:white;font-weight:bold;">⚡ الأتمتة</a>
          <a href="/financial" data-link class="nav-link" data-perm="reports.read">💰 المالية</a>
          <a href="/reports" data-link class="nav-link" data-perm="reports.read">📊 التقارير</a>
          <a href="/team" data-link class="nav-link" data-perm="users.read">👥 الفريق</a>
        </nav>
        <main style="padding:1rem;">
          ${statsHtml}
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1rem;">
            <div class="card" style="padding:1rem;">
              <h3 style="margin-top:0;">⚡ سريع</h3>
              <ul style="padding-inline-start:1rem;font-size:0.9rem;">
                <li><a href="/inventory" data-link style="color:#2563eb;">📦 المخزون والفاتورة</a></li>
                <li><a href="/purchases/new" data-link style="color:#2563eb;">➕ شراء جديد</a></li>
                <li><a href="/sales" data-link style="color:#2563eb;">🛍️ مبيعات</a></li>
                <li><a href="/reports" data-link style="color:#2563eb;">📊 تقارير</a></li>
                <li><a href="/team" data-link style="color:#2563eb;">👥 إدارة الفريق</a></li>
              </ul>
            </div>
            <div class="card" style="padding:1rem;">
              <h3 style="margin-top:0;">ℹ️ معلومات المخزن</h3>
              <table style="width:100%;font-size:0.9rem;border-collapse:collapse;">
                <tr><td style="padding:0.5rem;border-bottom:1px solid #eee;color:#666;">الرمز</td><td style="padding:0.5rem;border-bottom:1px solid #eee;font-weight:bold;" id="info-code">${ctx.warehouse_code || '—'}</td></tr>
                <tr><td style="padding:0.5rem;border-bottom:1px solid #eee;color:#666;">المستأجر</td><td style="padding:0.5rem;border-bottom:1px solid #eee;font-weight:bold;" id="info-tenant">${ctx.tenant_id ? '✅ مفعل' : '—'}</td></tr>
                <tr><td style="padding:0.5rem;border-bottom:1px solid #eee;color:#666;">المدير</td><td style="padding:0.5rem;border-bottom:1px solid #eee;" id="info-manager">${esc(ctx.warehouse_name || '—')}</td></tr>
              </table>
            </div>
          </div>
        </main>
      </div>
    `;
    
    // Tenancy isolation notice
    const isolationNotice = document.createElement('div');
    isolationNotice.style.cssText = 'background:#f0f9ff;border:1px solid #93d0ff;border-radius:8px;padding:0.75rem;margin-bottom:1rem;color:#0c4a6e;font-size:0.85rem;';
    isolationNotice.textContent = '🔒 هذا المخزن معزول تماماً عن المخازن الأخرى. بياناتك مرئية فقط لك وفريقك.';
    appEl.querySelector('main')?.prepend(isolationNotice);
    
    // Logout button
    const logoutBtn = appEl.querySelector('#logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        const client = getSupabase();
        try {
          if (client) await client.auth.signOut();
        } catch (_) {}
        clearSession();
        clearStep2Mark();
        navigate('/login');
      });
    }
  }

  // Escaping helper
  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ============================================================
  // تحميل بيانات tenant من الخادم
  // ============================================================
  async function fetchTenantDashboardData(client) {
    if (!client) return null;
    
    try {
      // استخدام دالة current_tenant_context()
      const { data, error } = await client.rpc('current_tenant_context');
      if (error || !data) {
        console.warn('fetchTenantDashboardData: current_tenant_context failed:', error?.message);
        return null;
      }
      
      const ctx = {
        tenant_id: data.tenant_id,
        warehouse_id: data.warehouse_id,
        warehouse_name: data.warehouse_name || '',
        tenant_name: ''
      };
      
      // جلب statistics سريعة
      try {
        const [products, inventory, suppliers, customers, employees] = await Promise.all([
          client.from('products').select('id').limit(1).then(r => r.data?.length || 0),
          client.from('inventory').select('id').limit(1).then(r => r.data?.length || 0),
          client.from('suppliers').select('id').limit(1).then(r => r.data?.length || 0),
          client.from('customers').select('id').limit(1).then(r => r.data?.length || 0),
          client.from('employees').select('id').limit(1).then(r => r.data?.length || 0)
        ]);
        
        return {
          ...ctx,
          stats: { products, inventory, suppliers, customers, employees }
        };
      } catch (e) {
        console.warn('fetchTenantDashboardData: stats error:', e.message);
      }
      
      return ctx;
    } catch (e) {
      console.error('fetchTenantDashboardData:', e);
      return null;
    }
  }

  // ============================================================
  // إظهار stats في dashboard
  // ============================================================
  function updateStats(stats) {
    if (!stats) return;
    
    const sel = (id) => document.getElementById(id);
    
    if (sel('stat-products')) sel('stat-products').textContent = stats.products ?? 0;
    if (sel('stat-inventory')) sel('stat-inventory').textContent = stats.inventory ?? 0;
    if (sel('stat-suppliers')) sel('stat-suppliers').textContent = stats.suppliers ?? 0;
    if (sel('stat-customers')) sel('stat-customers').textContent = stats.customers ?? 0;
    if (sel('stat-employees')) sel('stat-employees').textContent = stats.employees ?? 0;
  }

  // ============================================================
  // exports
  // ============================================================
  window.TenantDashboard = {
    render: renderTenantDashboard,
    fetchData: fetchTenantDashboardData,
    updateStats: updateStats
  };
  
  console.log('✅ TenantDashboard loaded');
})();
