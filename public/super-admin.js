/**
 * super-admin.js
 * ===============
 * لوحة Super Admin المركزية لإدارة كل المخازن والاشتراكات والمراقبة
 * متاحة فقط لمسؤولي النظام (super admin / owner)
 */

(function () {
  'use strict';

  // ============================================================
  // فحص أن المستخدم مسؤول نظام
  // ============================================================
  async function requireSuperAdmin(client) {
    const { data, error } = await client.rpc('rbac_my_context');
    if (error || !data || !data.authenticated) {
      throw new Error('غير مصادوق');
    }
    if (data.is_owner || data.role === 'super_admin' || data.role === 'super admin') {
      return true;
    }
    // تحقق من full access
    const ctx = window.__permCtx;
    if (ctx && ctx.full) return true;
    throw new Error('عدم الصلاحية - Super Admin فقط');
  }

  // ============================================================
  // جلب قائمة جميع المخازن
  // ============================================================
  async function fetchAllWarehouses(client) {
    if (!client) return [];
    try {
      const { data, error } = await client
        .from('warehouses')
        .select('id, name, code, tenant_id, status, plan, max_users, max_products, max_storage_mb, subscription_started_at, subscription_expires_at, trial_started_at, trial_expires_at, created_at, updated_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (e) {
      console.error('fetchAllWarehouses error:', e);
      return [];
    }
  }

  // ============================================================
  // fetch all tenants
  // ============================================================
  async function fetchAllTenants(client) {
    if (!client) return [];
    try {
      const { data, error } = await client
        .from('tenants')
        .select('id, name, identifier, status, created_at, updated_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (e) {
      console.error('fetchAllTenants error:', e);
      return [];
    }
  }

  // ============================================================
  // fetch subscriptions/usage stats
  // ============================================================
  async function fetchSubscriptionStats(client, warehouseId) {
    if (!client || !warehouseId) return null;
    try {
      // جلب مستخدمي المخزن
      const { count: userCount } = await client
        .from('user_warehouses')
        .select('id', { count: 'exact', head: true })
        .eq('warehouse_id', warehouseId)
        .eq('is_active', true);
      
      // جلب عدد الموظفين
      const { count: employeeCount } = await client
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('warehouse_id', warehouseId)
        .eq('is_active', true);
      
      // جلب عدد المنتجات
      const { count: productCount } = await client
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('warehouse_id', warehouseId);
      
      // جلب عدد العملاء
      const { count: customerCount } = await client
        .from('customers')
        .select('id', { count: 'exact', head: true })
        .eq('warehouse_id', warehouseId);
      
      return { userCount, employeeCount, productCount, customerCount };
    } catch (_) {
      return { userCount: 0, employeeCount: 0, productCount: 0, customerCount: 0 };
    }
  }

  // ============================================================
  // إنشاء مخزن جديد من لوحة التحكم
  // ============================================================
  async function createWarehouse(client, name, code, plan, maxUsers, maxProducts) {
    if (!client) throw new Error('غير متصل');
    
    // الحصول على tenant الحالي (للمسؤول)
    const { data: tenantId } = await client.rpc('current_tenant_id');
    
    const payload = {
      name: name.trim(),
      code: code.trim().toUpperCase().slice(0, 20),
      plan: plan || 'free',
      max_users: maxUsers || 10,
      max_products: maxProducts || 1000,
      tenant_id: tenantId || null
    };
    
    const { data, error } = await client
      .from('warehouses')
      .insert(payload)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  // ============================================================
  // تحديث خطة اشتراك مخزن
  // ============================================================
  async function updateWarehousePlan(client, warehouseId, plan, maxUsers, maxProducts) {
    if (!client) throw new Error('غير متصل');
    
    const payload = {
      plan: plan,
      max_users: maxUsers,
      max_products: maxProducts
    };
    
    const { data, error } = await client
      .from('warehouses')
      .update(payload)
      .eq('id', warehouseId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  // ============================================================
  // تعطيل/تفعيل مخزن
  // ============================================================
  async function toggleWarehouseStatus(client, warehouseId, active) {
    if (!client) throw new Error('غير متصل');
    
    const { data, error } = await client
      .from('warehouses')
      .update({ status: active ? 'active' : 'suspended' })
      .eq('id', warehouseId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  // ============================================================
  // حذف مخزن (ناعم - يتم تعيين deleted_at)
  // ============================================================
  async function deleteWarehouse(client, warehouseId) {
    if (!client) throw new Error('غير متصل');
    
    const { error } = await client
      .from('warehouses')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', warehouseId);
    
    if (error) throw error;
    return true;
  }

  // ============================================================
  // عرض لوحة Super Admin
  // ============================================================
  function renderSuperAdminPanel(appEl, data) {
    if (!appEl) return;

    const {
      warehouses = [],
      tenants = [],
      stats = {}
    } = data || {};

    // إحصائيات عامة
    const totalWarehouses = warehouses.length;
    const activeWarehouses = warehouses.filter(w => w.status === 'active' || !w.status).length;
    const suspendedWarehouses = warehouses.filter(w => w.status === 'suspended').length;
    const totalTenants = tenants.length;

    appEl.innerHTML = `
      <div class="page">
        <header class="app-header">
          <h1>👑 لوحة التحكم الإدارية (Super Admin)</h1>
          <button class="btn" id="back-home-btn" type="button">← الرئيسية</button>
          <span class="muted" style="font-size:0.85rem;font-weight:normal;">نظام إدارة Multi-Tenant SaaS</span>
        </header>
        
        <nav class="app-nav" aria-label="الإدارة">
          <a href="/admin" data-link class="nav-link active">👑 Dashboard</a>
          <a href="/admin/warehouses" data-link class="nav-link">🏢 المخازن (${warehouses.length})</a>
          <a href="/admin/tenants" data-link class="nav-link">🏛️ المستأجرين (${tenants.length})</a>
          <a href="/admin/subscriptions" data-link class="nav-link">💳 الاشتراكات</a>
          <a href="/admin/audit" data-link class="nav-link">🧾 السجلات</a>
        </nav>
        
        <main style="padding:1rem;">
          <!-- Stats Cards -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;margin-bottom:1.5rem;">
            <div class="card" style="background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;text-align:center;">
              <div style="font-size:2.5rem;font-weight:bold;">${totalWarehouses}</div>
              <div class="muted" style="color:rgba(255,255,255,0.8);font-size:0.85rem;">إجمالي المخازن</div>
            </div>
            <div class="card" style="background:linear-gradient(135deg,#166534,#15803d);color:white;text-align:center;">
              <div style="font-size:2.5rem;font-weight:bold;">${activeWarehouses}</div>
              <div class="muted" style="color:rgba(255,255,255,0.8);font-size:0.85rem;">مخزن نشط</div>
            </div>
            <div class="card" style="background:linear-gradient(135deg,#7c2d12,#dd2914);color:white;text-align:center;">
              <div style="font-size:2.5rem;font-weight:bold;">${suspendedWarehouses}</div>
              <div class="muted" style="color:rgba(255,255,255,0.8);font-size:0.85rem;">مخزن معطّل</div>
            </div>
            <div class="card" style="background:linear-gradient(135deg,#4c1d95,#7c3aed);color:white;text-align:center;">
              <div style="font-size:2.5rem;font-weight:bold;">${totalTenants}</div>
              <div class="muted" style="color:rgba(255,255,255,0.8);font-size:0.85rem;">المستأجرين</div>
            </div>
          </div>
          
          <!--Tabs-->
          <div style="display:flex;gap:0.5rem;margin-bottom:1rem;flex-wrap:wrap;">
            <button class="btn tab-btn active" data-tab="warehouses">🏢 المخازن</button>
            <button class="btn tab-btn" data-tab="tenants">🏛️ المستأجرين</button>
            <button class="btn tab-btn" data-tab="subscriptions">💳 الاشتراكات</button>
            <button class="btn tab-btn" data-tab="audit">🧾 السجلات</button>
          </div>
          
          <!-- Tab content -->
          <div id="tab-warehouses" class="tab-content">
            <div style="display:flex;gap:0.5rem;margin-bottom:1rem;flex-wrap:wrap;">
              <button class="btn primary" id="new-warehouse-btn">➕ مخزن جديد</button>
              <button class="btn" id="refresh-stats-btn">🔄 تحديث الإحصائيات</button>
            </div>
            <div id="warehouses-table-container">
              <table class="data-table" style="width:100%;border-collapse:collapse;">
                <thead>
                  <tr style="background:#f8f9fa;border-bottom:2px solid #dee2e6;">
                    <th style="padding:0.75rem;text-align:right;">الرمز</th>
                    <th style="padding:0.75rem;text-align:right;">الاسم</th>
                    <th style="padding:0.75rem;text-align:right;">الخطة</th>
                    <th style="padding:0.75rem;text-align:right;">المستأجر</th>
                    <th style="padding:0.75rem;text-align:right;">المستخدمون</th>
                    <th style="padding:0.75rem;text-align:right;">المنتجات</th>
                    <th style="padding:0.75rem;text-align:right;">الحالة</th>
                    <th style="padding:0.75rem;text-align:right;">الإجراءات</th>
                  </tr>
                </thead>
                <tbody id="warehouses-tbody">
                  ${warehouses.map(w => renderWarehouseRow(w)).join('')}
                </tbody>
              </table>
            </div>
          </div>
          
          <div id="tab-tenants" class="tab-content" style="display:none;">
            <div class="card" style="padding:1rem;">
              <h3>🏛️ قائمة المستأجرين (Tenants)</h3>
              <p class="muted">كل مستأجر يمثل عميلاً أو منظمة تستأجر نظام إدارة المخازن</p>
              <table class="data-table" style="width:100%;margin-top:1rem;border-collapse:collapse;">
                <thead>
                  <tr style="background:#f8f9fa;border-bottom:2px solid #dee2e6;">
                    <th style="padding:0.75rem;">المعرف</th>
                    <th style="padding:0.75rem;">الاسم</th>
                    <th style="padding:0.75rem;">الرمز</th>
                    <th style="padding:0.75rem;">الحالة</th>
                    <th style="padding:0.75rem;">تاريخ الإنشاء</th>
                  </tr>
                </thead>
                <tbody id="tenants-tbody">
                  ${tenants.map(t => `
                    <tr style="border-bottom:1px solid #eee;">
                      <td style="padding:0.75rem;font-family:monospace;font-size:0.8rem;">${t.id ? String(t.id).slice(0,8) : '—'}</td>
                      <td style="padding:0.75rem;">${t.name || '—'}</td>
                      <td style="padding:0.75rem;font-family:monospace;font-size:0.8rem;">${t.identifier || '—'}</td>
                      <td style="padding:0.75rem;">
                        ${t.status === 'active' ? '<span class="badge badge-success">نشط</span>' 
                          : t.status === 'suspended' ? '<span class="badge badge-warning">معطّل</span>'
                          : '<span class="badge badge-default">—</span>'}
                      </td>
                      <td style="padding:0.75rem;font-size:0.85rem;">${t.created_at ? new Date(t.created_at).toLocaleDateString('ar-EG') : '—'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
          
          <div id="tab-subscriptions" class="tab-content" style="display:none;">
            <div class="card" style="padding:1rem;">
              <h3>💳 إدارة الاشتراكات</h3>
              <p class="muted">إدارة باقات الاشتراك لكل مخزن</p>
              <div style="margin-top:1rem;padding:1rem;background:#f8f9fa;border-radius:8px;">
                <p style="margin:0 0 1rem 0;">عرض وتعديل خطط الاشتراك والمحدودات لكل مخزن:</p>
                <ul style="padding-inline-start:1.5rem;font-size:0.9rem;">
                  <li><strong>Free:</strong> 10 مستخدمين، 1000 منتج، 100 ميجابايت</li>
                  <li><strong>Starter:</strong> 50 مستخدم، 10000 منتج، 1 جيجابايت - 99 روبل/شهر</li>
                  <li><strong>Professional:</strong> 200 مستخدم، 100000 منتج، 10 جيجابايت - 299 روبل/شهر</li>
                  <li><strong>Enterprise:</strong>=user محدود، منتج غير محدود، تخزين غير محدود - حسب الاتفاق</li>
                </ul>
              </div>
            </div>
          </div>
          
          <div id="tab-audit" class="tab-content" style="display:none;">
            <div class="card" style="padding:1rem;">
              <h3>🧾 سجل المراجعة (Audit Log)</h3>
              <p class="muted">سجل جميع العمليات على النظام عبر جميع المخازن</p>
              <p style="margin-top:1rem;" class="muted">قريباً: سجل كامل للعمليات مع تصفية حسب المخزن والمستخدم والتاريخ</p>
            </div>
          </div>
        </main>
      </div>
    `;

    // إضافة حالات الـ tabs
    setTimeout(() => {
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
      });
    }, 0);

    // زر مخزن جديد
    const newBtn = document.getElementById('new-warehouse-btn');
    if (newBtn) {
      newBtn.addEventListener('click', () => showNewWarehouseModal());
    }

    // زر تحديث
    const refreshBtn = document.getElementById('refresh-stats-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.textContent = 'جارٍ التحديث...';
        await refreshWarehouseStats();
        refreshBtn.textContent = '🔄 تحديث الإحصائيات';
      });
    }
  }

  function renderWarehouseRow(w) {
    const statusClass = w.status === 'active' || !w.status ? 'badge-success' : 'badge-warning';
    const statusLabel = w.status === 'active' || !w.status ? 'نشط' : 'معطّل';
    const tenantName = w.tenant_name || w.tenant_id ? '✅' : '—';
    
    return `
      <tr style="border-bottom:1px solid #eee;">
        <td style="padding:0.75rem;font-family:monospace;font-size:0.8rem;">${w.code || String(w.id).slice(0,8)}</td>
        <td style="padding:0.75rem;font-weight:500;">${w.name || '—'}</td>
        <td style="padding:0.75rem;">
          <span class="badge ${w.plan === 'pro' ? 'badge-info' : w.plan === 'enterprise' ? 'badge-primary' : 'badge-default'}">
            ${w.plan || 'Free'} ${w.plan === 'free' ? '(مجاني)' : ''}
          </span>
        </td>
        <td style="padding:0.75rem;">${tenantName}</td>
        <td style="padding:0.75rem;text-align:center;">${w.max_users || '—'}</td>
        <td style="padding:0.75rem;text-align:center;">${w.max_products || '—'}</td>
        <td style="padding:0.75rem;">
          <span class="badge ${statusClass}">${statusLabel}</span>
        </td>
        <td style="padding:0.75rem;white-space:nowrap;">
          <button class="btn btn-sm" data-action="edit" data-id="${w.id}">✏️ تعديل</button>
          <button class="btn btn-sm" data-action="toggle" data-id="${w.id}" ${statusLabel === 'معطّل' ? '' : 'style="background:#dc2626;color:white;"'}>
            ${statusLabel === 'معطّل' ? '✅ تفعيل' : '🚫 تعطيل'}
          </button>
          <button class="btn btn-sm" data-action="delete" data-id="${w.id}" style="background:#7c3aed;color:white;">🗑️</button>
        </td>
      </tr>
    `;
  }

  // ============================================================
  // تبديل الـ tabs
  // ============================================================
  function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    
    const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    const content = document.getElementById(`tab-${tabId}`);
    if (btn) btn.classList.add('active');
    if (content) content.style.display = 'block';
  }

  // ============================================================
  // عرض نموذج مخزن جديد
  // ============================================================
  async function showNewWarehouseModal() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000;';
    
    const modal = document.createElement('div');
    modal.style.cssText = 'background:white;padding:2rem;border-radius:12px;width:100%;max-width:450px;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
    modal.innerHTML = `
      <h2 style="margin-top:0;">➕ إنشاء مخزن جديد</h2>
      <p class="muted">أضف مخزن جديد للنظام</p>
      <form id="new-warehouse-form" style="display:grid;gap:1rem;margin-top:1rem;">
        <div>
          <label class="form-label">اسم المخزن *</label>
          <input type="text" class="input" id="wh-name" required placeholder="مخزن الأدوية - الرياض" />
        </div>
        <div>
          <label class="form-label">رمز المخزن *</label>
          <input type="text" class="input" id="wh-code" required placeholder="RXR" style="text-transform:uppercase;" />
        </div>
        <div>
          <label class="form-label">الخطة</label>
          <select class="input" id="wh-plan">
            <option value="free">Free (مجاني)</option>
            <option value="starter">Starter</option>
            <option value="pro">Professional</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>
        <div>
          <label class="form-label">الحد الأقصى للمستخدمين</label>
          <input type="number" class="input" id="wh-max-users" value="10" min="1" max="9999" />
        </div>
        <div>
          <label class="form-label">الحد الأقصى للمنتجات</label>
          <input type="number" class="input" id="wh-max-products" value="1000" min="100" max="999999" />
        </div>
        <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:0.5rem;">
          <button type="button" class="btn" id="modal-cancel">إلغاء</button>
          <button type="submit" class="btn primary">✅ إنشاء المخزن</button>
        </div>
      </form>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    modal.querySelector('#modal-cancel').addEventListener('click', () => {
      document.body.removeChild(overlay);
    });
    
    modal.querySelector('#new-warehouse-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const client = getSupabase();
      if (!client) {
        alert('خطأ في الاتصال');
        return;
      }
      
      const btn = modal.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'جارٍ الإنشاء...';
      
      try {
        const name = modal.querySelector('#wh-name').value.trim();
        const code = modal.querySelector('#wh-code').value.trim().toUpperCase();
        const plan = modal.querySelector('#wh-plan').value;
        const maxUsers = parseInt(modal.querySelector('#wh-max-users').value) || 10;
        const maxProducts = parseInt(modal.querySelector('#wh-max-products').value) || 1000;
        
        const newWh = await createWarehouse(client, name, code, plan, maxUsers, maxProducts);
        
        alert(`✅ تم إنشاء المخزن "${newWh.name}" بنجاح!`);
        document.body.removeChild(overlay);
        window.location.reload();
      } catch (err) {
        alert('خطأ في إنشاء المخزن: ' + (err.message || err));
        btn.disabled = false;
        btn.textContent = '✅ إنشاء المخزن';
      }
    });
  }

  // ============================================================
  // تحديث إحصائيات المخازن
  // ============================================================
  async function refreshWarehouseStats() {
    const client = getSupabase();
    if (!client) return;
    
    const tbody = document.getElementById('warehouses-tbody');
    if (!tbody) return;
    
    // إضافة عمليات التحديث لكل صف
    tbody.querySelectorAll('tr').forEach(row => {
      const id = row.querySelector('[data-action]')?.dataset?.id;
      if (!id) return;
      
      const btnToggle = row.querySelector('[data-action="toggle"]');
      const btnDelete = row.querySelector('[data-action="delete"]');
      
      // فعّل الأزرار
      if (btnToggle) {
        btnToggle.onclick = async () => {
          btnToggle.disabled = true;
          try {
            const wh = await toggleWarehouseStatus(client, id, true);
            alert(`✅ تم تفعيل المخزن ${wh.name}`);
            window.location.reload();
          } catch (e) {
            alert('خطأ: ' + (e.message || e));
            btnToggle.disabled = false;
          }
        };
      }
      
      if (btnDelete) {
        btnDelete.onclick = async () => {
          if (!confirm('هل أنت متأكد من حذف هذا المخزن؟ هذه العملية لا يمكن التراجع عنها!')) {
            return;
          }
          btnDelete.disabled = true;
          try {
            await deleteWarehouse(client, id);
            alert('✅ تم حذف المخزن');
            window.location.reload();
          } catch (e) {
            alert('خطأ: ' + (e.message || e));
            btnDelete.disabled = false;
          }
        };
      }
    });
  }

  // ============================================================
  // المكالمات
  // ============================================================
  async function loadSuperAdminData(client) {
    const [warehouses, tenants] = await Promise.all([
      fetchAllWarehouses(client),
      fetchAllTenants(client)
    ]);
    
    return {
      warehouses,
      tenants,
      stats: {
        totalWarehouses: warehouses.length,
        activeWarehouses: warehouses.filter(w => w.status === 'active' || !w.status).length,
        suspendedWarehouses: warehouses.filter(w => w.status === 'suspended').length,
        totalTenants: tenants.length
      }
    };
  }

  // ============================================================
  // exports
  // ============================================================
  window.SuperAdminPanel = {
    requireSuperAdmin,
    fetchAllWarehouses,
    fetchAllTenants,
    fetchSubscriptionStats,
    createWarehouse,
    updateWarehousePlan,
    toggleWarehouseStatus,
    deleteWarehouse,
    renderSuperAdminPanel,
    loadSuperAdminData,
    refreshWarehouseStats
  };

})();
