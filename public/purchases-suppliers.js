// ============================================================
// صفحة قائمة الموردين
// ============================================================

(function() {
  'use strict';

  let suppliers = [];

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/[<>"'&]/g, function(c) {
      return { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c];
    });
  }

  function getCurrentSession() {
    try {
      const raw = localStorage.getItem('session');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function getSupabaseClient() {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      const config = window.SUPABASE_CONFIG || {};
      return window.supabase.createClient(
        config.url || 'https://iksjhjxwphmvthryfeae.supabase.co',
        config.anonKey || '',
        { auth: { persistSession: true, autoRefreshToken: true } }
      );
    }
    return null;
  }

  // ===== المسار =====

  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
  if (!currentPath.startsWith('/purchases/suppliers')) return;

  const sectionBody = document.getElementById('section-body');
  if (!sectionBody) return;

  // ===== جلب البيانات =====

  async function loadSuppliers() {
    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال بقاعدة البيانات', 'error');
      return;
    }

    try {
      const res = await client
        .from('suppliers')
        .select('*')
        .order('name')
        .limit(500);

      suppliers = res.data || [];
      renderTable();

      // إحصائيات
      const activeCount = suppliers.filter(s => s.is_active).length;
      const totalCount = suppliers.length;

      const statsRow = document.getElementById('suppliers-stats');
      if (statsRow) {
        statsRow.innerHTML = `
          <div class="muted">إجمالي الموردين: <strong>${totalCount}</strong></div>
          <div class="muted" style="margin-left:1rem;">نشطين: <strong style="color:#16a34a;">${activeCount}</strong></div>
          <div class="muted" style="margin-left:1rem;">غير نشطين: <strong style="color:#dc2626;">${totalCount - activeCount}</strong></div>
        `;
      }

    } catch (e) {
      console.error('Error loading suppliers:', e);
      showNotification('خطأ في جلب البيانات', 'error');
    }
  }

  // ===== رسم الجدول =====

  function renderTable() {
    const tbody = document.getElementById('suppliers-table-body');
    if (!tbody) return;

    if (suppliers.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="muted" style="text-align:center;padding:2rem;">
            لا توجد موردين حتى الآن.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = suppliers.map((s, i) => {
      const statusBadge = s.is_active
        ? '<span class="badge badge-success badge-sm">نشط</span>'
        : '<span class="badge badge-danger badge-sm">غير نشط</span>';

      return `
        <tr style="border-bottom:1px solid #eee;">
          <td style="padding:0.5rem;text-align:center;color:#667eea;font-weight:bold;">${i + 1}</td>
          <td style="padding:0.5rem;">
            <div style="font-weight:bold;font-size:1rem;">${esc(s.name_ar || s.name)}</div>
            <div class="muted" style="font-size:0.85rem;">كود: ${esc(s.code || '—')}</div>
          </td>
          <td style="padding:0.5rem;font-size:0.9rem;">${esc(s.phone || '—')}</td>
          <td style="padding:0.5rem;font-size:0.9rem;">${esc(s.email || '—')}</td>
          <td style="padding:0.5rem;text-align:center;">${statusBadge}</td>
          <td style="padding:0.5rem;font-size:0.85rem;color:#666;">${s.created_at ? new Date(s.created_at).toLocaleDateString('ar-EG') : '—'}</td>
          <td style="padding:0.5rem;text-align:center;">
            <button class="btn small" onclick="editSupplier(${s.id})" style="background:#f59e0b;color:white;">✏️ تعديل</button>
            <button class="btn small" onclick="toggleSupplierStatus(${s.id}, ${s.is_active})" style="background:${s.is_active ? '#dc2626' : '#16a34a'};color:white;">
              ${s.is_active ? '❌ تعطيل' : '✅ تفعيل'}
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ===== بناء الصفحة =====

  function renderPage() {
    sectionBody.innerHTML = `
      <div class="card" style="animation:fadeIn 0.3s ease-in;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
          <h1 style="margin:0;font-size:1.5rem;">🏭 الموردون</h1>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button class="btn primary" onclick="showAddSupplierModal()">➕ مورد جديد</button>
            <a class="btn" href="/purchases">🔙返回</a>
          </div>
        </div>

        <div id="suppliers-stats" style="margin-bottom:1rem;padding:0.5rem 0.75rem;background:#f8f9fa;border-radius:4px;"></div>

        <div class="card" style="overflow:hidden;">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.75rem;background:#f8f9fa;border-bottom:2px solid #ddd;">
            <h3 style="margin:0;">📋 جميع الموردين (${suppliers.length})</h3>
            <input type="text" id="supplier-search" placeholder="🔍 بحث بالتسمية..."
              style="padding:0.4rem;border:1px solid #ddd;border-radius:4px;font-size:0.9rem;width:200px;"
              oninput="filterSuppliers(this.value)">
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:0.95rem;">
              <thead>
                <tr style="background:#f8f9fa;border-bottom:2px solid #ddd;text-align:right;">
                  <th style="padding:0.5rem;width:50px;">#</th>
                  <th style="padding:0.5rem;">🧑‍💼 الاسم</th>
                  <th style="padding:0.5rem;width:150px;">📞 الهاتف</th>
                  <th style="padding:0.5rem;width:200px;">📧 البريد الإلكتروني</th>
                  <th style="padding:0.5rem;width:100px;">الحالة</th>
                  <th style="padding:0.5rem;width:120px;">تاريخ الإضافة</th>
                  <th style="padding:0.5rem;width:150px;">العمليات</th>
                </tr>
              </thead>
              <tbody id="suppliers-table-body">
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    loadSuppliers();
  }

  // ===== البحث =====

  window.filterSuppliers = function(query) {
    const filtered = suppliers.filter(s =>
      (s.name_ar || s.name).toLowerCase().includes(query.toLowerCase()) ||
      (s.code || '').toLowerCase().includes(query.toLowerCase()) ||
      (s.phone || '').includes(query)
    );

    const tbody = document.getElementById('suppliers-table-body');
    if (!tbody) return;

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="muted" style="text-align:center;padding:2rem;">
            لا توجد نتائج لـ "${esc(query)}"
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered.map((s, i) => {
      const statusBadge = s.is_active
        ? '<span class="badge badge-success badge-sm">نشط</span>'
        : '<span class="badge badge-danger badge-sm">غير نشط</span>';

      return `
        <tr style="border-bottom:1px solid #eee;">
          <td style="padding:0.5rem;text-align:center;color:#667eea;font-weight:bold;">${i + 1}</td>
          <td style="padding:0.5rem;">
            <div style="font-weight:bold;font-size:1rem;">${esc(s.name_ar || s.name)}</div>
            <div class="muted" style="font-size:0.85rem;">كود: ${esc(s.code || '—')}</div>
          </td>
          <td style="padding:0.5rem;font-size:0.9rem;">${esc(s.phone || '—')}</td>
          <td style="padding:0.5rem;font-size:0.9rem;">${esc(s.email || '—')}</td>
          <td style="padding:0.5rem;text-align:center;">${statusBadge}</td>
          <td style="padding:0.5rem;font-size:0.85rem;color:#666;">${s.created_at ? new Date(s.created_at).toLocaleDateString('ar-EG') : '—'}</td>
          <td style="padding:0.5rem;text-align:center;">
            <button class="btn small" onclick="editSupplier(${s.id})" style="background:#f59e0b;color:white;">✏️ تعديل</button>
            <button class="btn small" onclick="toggleSupplierStatus(${s.id}, ${s.is_active})" style="background:${s.is_active ? '#dc2626' : '#16a34a'};color:white;">
              ${s.is_active ? '❌ تعطيل' : '✅ تفعيل'}
            </button>
          </td>
        </tr>
      `;
    }).join('');
  };

  // ===== عمليات على الموردين =====

  async function toggleSupplierStatus(supplierId, currentlyActive) {
    if (!confirm(`${currentlyActive ? 'تعطيل' : 'تفعيل'} المورد؟`)) return;

    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال', 'error');
      return;
    }

    try {
      const { error } = await client
        .from('suppliers')
        .update({ is_active: !currentlyActive })
        .eq('id', supplierId);

      if (error) {
        console.error('Error:', error);
        showNotification('خطأ: ' + (error.message || 'فشل العملية'), 'error');
        return;
      }

      showNotification(`تم ${currentlyActive ? 'تعطيل' : 'تفعيل'} المورد`, 'success');
      loadSuppliers();
    } catch (e) {
      console.error('Error:', e);
      showNotification('خطأ: ' + (e.message || 'فشل العملية'), 'error');
    }
  }

  window.toggleSupplierStatus = toggleSupplierStatus;

  async function editSupplier(supplierId) {
    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال', 'error');
      return;
    }

    try {
      const res = await client.from('suppliers').select('*').eq('id', supplierId).single();
      if (!res.data) {
        showNotification('المورد غير موجود', 'error');
        return;
      }

      showAddSupplierModal(res.data);
    } catch (e) {
      console.error('Error:', e);
      showNotification('خطأ: ' + (e.message || 'فشل الجلب'), 'error');
    }
  }

  window.editSupplier = editSupplier;

  let editingSupplierId = null;

  function showAddSupplierModal(supplierData) {
    editingSupplierId = supplierData ? supplierData.id : null;
    const isEdit = !!supplierData;

    const overlay = document.createElement('div');
    overlay.id = 'supplier-modal-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1000;
      animation: fadeIn 0.2s ease-in;
    `;

    overlay.innerHTML = `
      <div style="background:white;border-radius:8px;padding:1.5rem;max-width:500px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.2);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <h2 style="margin:0;font-size:1.3rem;">${isEdit ? '✏️ تعديل المورد' : '➕ مورد جديد'}</h2>
          <button style="background:none;border:none;font-size:1.5rem;cursor:pointer;" onclick="closeSupplierModal()">&times;</button>
        </div>

        <form id="supplier-form" onsubmit="saveSupplier(event)">
          <div style="margin-bottom:1rem;">
            <label class="form-label" style="font-weight:bold;">اسم المورد <span style="color:red;">*</span></label>
            <input type="text" id="supplier-name" required
              style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;"
              value="${isEdit ? esc(supplierData.name_ar || supplierData.name) : ''}" placeholder="اسم المورد">
            <input type="hidden" id="supplier-name-ar">
          </div>

          <div style="margin-bottom:1rem;">
            <label class="form-label" style="font-weight:bold;">كود المورد</label>
            <input type="text" id="supplier-code"
              style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;"
              value="${isEdit ? esc(supplierData.code || '') : ''}" placeholder="كود المورد (اختياري)">
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem;">
            <div>
              <label class="form-label" style="font-weight:bold;">📞 الهاتف</label>
              <input type="tel" id="supplier-phone"
                style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;"
                value="${isEdit ? esc(supplierData.phone || '') : ''}" placeholder="+20 1xx xxx xxxx">
            </div>
            <div>
              <label class="form-label" style="font-weight:bold;">📧 البريد الإلكتروني</label>
              <input type="email" id="supplier-email"
                style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;"
                value="${isEdit ? esc(supplierData.email || '') : ''}" placeholder="email@example.com">
            </div>
          </div>

          <div style="margin-bottom:1rem;">
            <label class="form-label" style="font-weight:bold;">📝 العنوان / الملاحظات</label>
            <textarea id="supplier-notes" rows="3"
              style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;resize:vertical;">${isEdit ? esc(supplierData.notes || '') : ''}</textarea>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:1rem;">
            <button type="button" class="btn" onclick="closeSupplierModal()">إلغاء</button>
            <button type="submit" class="btn primary" style="background:#667eea;">
              ${isEdit ? '💾 تحديث' : '➕ إضافة العالم'}
            </button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);

    if (isEdit) {
      document.getElementById('supplier-name').value = supplierData.name_ar || supplierData.name;
      document.getElementById('supplier-name-ar').value = supplierData.name_ar || '';
      document.getElementById('supplier-code').value = supplierData.code || '';
      document.getElementById('supplier-phone').value = supplierData.phone || '';
      document.getElementById('supplier-email').value = supplierData.email || '';
      document.getElementById('supplier-notes').value = supplierData.notes || '';
    }
  }

  window.showAddSupplierModal = showAddSupplierModal;

  window.closeSupplierModal = function() {
    const overlay = document.getElementById('supplier-modal-overlay');
    if (overlay) overlay.remove();
    editingSupplierId = null;
  };

  async function saveSupplier(event) {
    event.preventDefault();

    const name = document.getElementById('supplier-name').value.trim();
    const code = document.getElementById('supplier-code').value.trim();
    const phone = document.getElementById('supplier-phone').value.trim();
    const email = document.getElementById('supplier-email').value.trim();
    const notes = document.getElementById('supplier-notes').value.trim();

    if (!name) {
      showNotification('يجب إدخال اسم المورد', 'warning');
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال', 'error');
      return;
    }

    try {
      if (editingSupplierId) {
        // تحديث
        const { error } = await client
          .from('suppliers')
          .update({
            name: name,
            name_ar: name,
            code: code || null,
            phone: phone || null,
            email: email || null,
            notes: notes || null,
          })
          .eq('id', editingSupplierId);

        if (error) {
          console.error('Error:', error);
          showNotification('خطأ: ' + (error.message || 'فشل التحديث'), 'error');
          return;
        }

        showNotification('تم تحديث المورد ✓', 'success');
      } else {
        // إنشاء جديد
        const { error } = await client.from('suppliers').insert({
          id: crypto.randomUUID ? crypto.randomUUID() : 'SUP-' + Date.now().toString(36),
          name: name,
          name_ar: name,
          code: code || null,
          phone: phone || null,
          email: email || null,
          notes: notes || null,
          is_active: true,
          created_at: new Date().toISOString(),
        });

        if (error) {
          console.error('Error:', error);
          showNotification('خطأ: ' + (error.message || 'فشل الإنشاء'), 'error');
          return;
        }

        showNotification('تم إضافة المورد ✓', 'success');
      }

      closeSupplierModal();
      loadSuppliers();
    } catch (e) {
      console.error('Error:', e);
      showNotification('خطأ: ' + (e.message || 'فشل العملية'), 'error');
    }
  }

  window.saveSupplier = saveSupplier;

  function showNotification(message, type) {
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();

    const colors = {
      success: '#16a34a',
      error: '#dc2626',
      warning: '#d97706',
      info: '#2563eb',
    };

    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.style.cssText = `
      position: fixed;
      top: 1rem;
      right: 1rem;
      padding: 0.75rem 1rem;
      border-radius: 4px;
      color: white;
      font-weight: bold;
      z-index: 9999;
      background: ${colors[type] || colors.info};
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      animation: slideIn 0.3s ease-out;
    `;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transition = 'opacity 0.3s';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  // CSS إضافي
  const style = document.createElement('style');
  style.textContent = `
    .notification {
      animation: slideIn 0.3s ease-out;
    }
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .form-label {
      display: block;
      margin-bottom: 0.25rem;
      font-size: 0.9rem;
    }
    .form-input, .form-select {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 1rem;
    }
    .badge {
      display: inline-block;
      padding: 0.2rem 0.5rem;
      border-radius: 3px;
      font-size: 0.8rem;
      font-weight: bold;
    }
    .badge-success { background: #16a34a; color: white; }
    .badge-danger { background: #dc2626; color: white; }
    .badge-sm { padding: 0.15rem 0.4rem; font-size: 0.75rem; }
  `;
  document.head.appendChild(style);

  // بدء
  renderPage();

})();
