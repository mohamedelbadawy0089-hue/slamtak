// ============================================================
// صفحة مرتجعات المشتريات
// ============================================================

(function() {
  'use strict';

  let returnsList = [];
  let suppliers = [];

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/[<>"'&]/g, function(c) {
      return { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c];
    });
  }

  function formatCurrency(amount) {
    return (amount || 0).toFixed(2);
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
  if (!currentPath.startsWith('/purchases/returns')) return;

  const sectionBody = document.getElementById('section-body');
  if (!sectionBody) return;

  // ===== جلب البيانات =====

  async function loadData() {
    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال بقاعدة البيانات', 'error');
      return;
    }

    try {
      // جلب المرتجعات
      const res = await client
        .from('purchase_order_returns')
        .select('*,supplier:suppliers(id,name,name_ar,code),returned_items(return_qa_value)')
        .order('created_at', { ascending: false })
        .limit(200);

      returnsList = res.data || [];

      // جلب الموردين
      const supRes = await client
        .from('suppliers')
        .select('id,name,name_ar,code')
        .eq('is_active', true)
        .order('name')
        .limit(200);

      suppliers = supRes.data || [];

      renderPage();
    } catch (e) {
      console.error('Error loading data:', e);
      showNotification('خطأ في جلب البيانات', 'error');
    }
  }

  // ===== حساب الإحصائيات =====

  function getTotalReturned() {
    return returnsList.reduce((sum, r) => sum + (Number(r.total_amount) || 0), 0);
  }

  function getPendingReturns() {
    return returnsList.filter(r => r.status === 'pending' || r.status === 'pending_approval').length;
  }

  // ===== رسم الصفحة =====

  function renderPage() {
    sectionBody.innerHTML = `
      <div class="card" style="animation:fadeIn 0.3s ease-in;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
          <h1 style="margin:0;font-size:1.5rem;">↩️ مرتجعات المشتريات</h1>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button class="btn primary" onclick="showReturnModal()">➕ مرتجعة جديدة</button>
            <input type="text" id="return-search" placeholder="🔍 بحث بـ رقم أو اسم..."
              style="padding:0.4rem;border:1px solid #ddd;border-radius:4px;font-size:0.9rem;width:250px;"
              oninput="filterReturns(this.value)">
            <a class="btn" href="/purchases">🔙返回</a>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:0.75rem;margin-bottom:1rem;">
          <div class="card stat-card" style="text-align:center;background:#dc2626;">
            <div style="font-size:1.5rem;font-weight:bold;color:white;">${returnsList.length}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">إجمالي المرتجعات</div>
          </div>
          <div class="card stat-card" style="text-align:center;background:#d97706;">
            <div style="font-size:1.5rem;font-weight:bold;color:white;">${formatCurrency(getTotalReturned())}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">إجمالي قيمة المرتجعات (جنيه)</div>
          </div>
          <div class="card stat-card" style="text-align:center;background:#2563eb;">
            <div style="font-size:1.5rem;font-weight:bold;color:white;">${getPendingReturns()}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">قيد الانتظار</div>
          </div>
        </div>

        <!-- نموذج المرتجعة -->
        <div class="card" style="margin-bottom:1rem;">
          <h3 style="margin:0 0 1rem 0;color:#667eea;">➕ تسجيل مرتجعة جديدة</h3>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem;">
            <div>
              <label class="form-label" style="font-weight:bold;">المورد <span style="color:red;">*</span></label>
              <select id="return-supplier" class="form-select"
                style="padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;">
                <option value="">-- اختر مورد --</option>
                ${suppliers.map(s =>
                  `<option value="${s.id}">${esc(s.name_ar || s.name)} (${s.code || 'بدون كود'})</option>`
                ).join('')}
              </select>
            </div>
            <div>
              <label class="form-label" style="font-weight:bold;">سبب المرتجعة <span style="color:red;">*</span></label>
              <select id="return-reason" class="form-select"
                style="padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;">
                <option value="defective">🔴 defective/تالف</option>
                <option value="expired">⏰ منتهي الصلاحية</option>
                <option value="wrong_item">📦 صنف خطأ</option>
                <option value="quantity_issue">📊 مشكلة كمية</option>
                <option value="quality_issue">🔍 جودة غير مقبولة</option>
                <option value="over_delivery">📈 فائض في الكمية</option>
                <option value="damage_during_transit">📦 تلف أثناء الشحن</option>
                <option value="other">📌 سبب آخر</option>
              </select>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem;">
            <div>
              <label class="form-label" style="font-weight:bold;">قيمة المرتجعة (جنيه) <span style="color:red;">*</span></label>
              <input type="number" id="return-amount" min="0" step="0.01"
                style="padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;text-align:right;"
                placeholder="0.00">
            </div>
            <div>
              <label class="form-label" style="font-weight:bold;">تاريخ المرتجعة</label>
              <input type="date" id="return-date"
                style="padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;"
                value="${new Date().toISOString().substr(0, 10)}">
            </div>
          </div>

          <div style="margin-bottom:1rem;">
            <label class="form-label" style="font-weight:bold;">ملاحظات</label>
            <textarea id="return-notes" rows="2"
              style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;resize:vertical;" placeholder="أي ملاحظات إضافية..."></textarea>
          </div>

          <button class="btn primary" style="background:#667eea;"
            onclick="submitReturn()">➕ تسجيل المرتجعة</button>
        </div>

        <!-- جدول المرتجعات -->
        <div class="card">
          <h3 style="margin:0 0 1rem 0;color:#667eea;">📋 سجل المرتجعات (${returnsList.length})</h3>

          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:0.95rem;">
              <thead>
                <tr style="background:#f8f9fa;border-bottom:2px solid #ddd;text-align:right;">
                  <th style="padding:0.5rem;width:50px;">#</th>
                  <th style="padding:0.5rem;width:150px;">تاريخ المرتجعة</th>
                  <th style="padding:0.5rem;width:200px;">المورد</th>
                  <th style="padding:0.5rem;width:150px;">سبب المرتجعة</th>
                  <th style="padding:0.5rem;width:120px;">قيمة المرتجعة</th>
                  <th style="padding:0.5rem;width:100px;">الحالة</th>
                  <th style="padding:0.5rem;width:150px;">العمليات</th>
                </tr>
              </thead>
              <tbody id="returns-table-body">
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    renderReturnsTable();
  }

  // ===== جدول المرتجعات =====

  function renderReturnsTable() {
    const tbody = document.getElementById('returns-table-body');
    if (!tbody) return;

    if (returnsList.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="muted" style="text-align:center;padding:2rem;">
            لا توجد مرتجعات حتى الآن.
          </td>
        </tr>
      `;
      return;
    }

    const reasonLabels = {
      defective: 'تالف',
      expired: 'منتهي الصلاحية',
      wrong_item: 'صنف خطأ',
      quantity_issue: 'مشكلة كمية',
      quality_issue: 'جودة غير مقبولة',
      over_delivery: 'فائض في الكمية',
      damage_during_transit: 'تلف أثناء الشحن',
      other: 'سبب آخر',
    };

    const statusBadges = {
      pending: 'badge badge-warning badge-sm',
      pending_approval: 'badge badge-info badge-sm',
      approved: 'badge badge-success badge-sm',
      rejected: 'badge badge-danger badge-sm',
      completed: 'badge badge-success badge-sm',
      closed: 'badge badge-success badge-sm',
    };

    tbody.innerHTML = returnsList.map((ret, i) => {
      const supplier = ret.supplier;
      const reasonLabel = reasonLabels[ret.reason] || ret.reason;
      const statusBadges = statusBadges[ret.status] || '';

      return `
        <tr style="border-bottom:1px solid #eee;">
          <td style="padding:0.5rem;text-align:center;color:#667eea;font-weight:bold;">${i + 1}</td>
          <td style="padding:0.5rem;">${ret.created_at ? new Date(ret.created_at).toLocaleDateString('ar-EG') : '—'}</td>
          <td style="padding:0.5rem;">
            <div style="font-weight:bold;">${supplier ? esc(supplier.name_ar || supplier.name) : '—'}</div>
          </td>
          <td style="padding:0.5rem;">${reasonLabel}</td>
          <td style="padding:0.5rem;font-weight:bold;text-align:right;color:#dc2626;">${formatCurrency(ret.total_amount)} جنيه</td>
          <td style="padding:0.5rem;text-align:center;">
            ${ret.status === 'pending' || ret.status === 'pending_approval'
              ? `<span class="${statusBadges}">${ret.status === 'pending' ? '📝 قيد المراجعة' : '⏳ بانتظار الموافقة'}</span>`
              : `<span class="badge badge-success badge-sm">✅ مكتملة</span>`
            }
          </td>
          <td style="padding:0.5rem;text-align:center;">
            <button class="btn small" onclick="editReturn(${ret.id})" style="background:#f59e0b;color:white;">✏️ تعديل</button>
            <button class="btn small" onclick="viewReturn(${ret.id})" style="background:#667eea;color:white;">عرض</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ===== عمليات المرتجعة =====

  window.filterReturns = function(query) {
    if (!query || query.trim() === '') {
      renderReturnsTable();
      return;
    }

    const filtered = returnsList.filter(r => {
      const supplier = r.supplier;
      return (
        (r.number || '').toLowerCase().includes(query.toLowerCase()) ||
        (supplier && (supplier.name_ar || supplier.name).toLowerCase().includes(query.toLowerCase())) ||
        (supplier && (supplier.code || '').toLowerCase().includes(query.toLowerCase())) ||
        (r.reason || '').toLowerCase().includes(query.toLowerCase()) ||
        (r.notes || '').toLowerCase().includes(query.toLowerCase())
      );
    });

    const tbody = document.getElementById('returns-table-body');
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

    renderReturnsTableWithData(filtered);
  };

  function renderReturnsTableWithData(data) {
    const tbody = document.getElementById('returns-table-body');
    if (!tbody) return;

    const reasonLabels = {
      defective: 'تالف',
      expired: 'منتهي الصلاحية',
      wrong_item: 'صنف خطأ',
      quantity_issue: 'مشكلة كمية',
      quality_issue: 'جودة غير مقبولة',
      over_delivery: 'فائض في الكمية',
      damage_during_transit: 'تلف أثناء الشحن',
      other: 'سبب آخر',
    };

    tbody.innerHTML = data.map((ret, i) => {
      const supplier = ret.supplier;

      return `
        <tr style="border-bottom:1px solid #eee;">
          <td style="padding:0.5rem;text-align:center;color:#667eea;font-weight:bold;">${i + 1}</td>
          <td style="padding:0.5rem;">${ret.created_at ? new Date(ret.created_at).toLocaleDateString('ar-EG') : '—'}</td>
          <td style="padding:0.5rem;">
            <div style="font-weight:bold;">${supplier ? esc(supplier.name_ar || supplier.name) : '—'}</div>
          </td>
          <td style="padding:0.5rem;">${reasonLabels[ret.reason] || ret.reason}</td>
          <td style="padding:0.5rem;font-weight:bold;text-align:right;color:#dc2626;">${formatCurrency(ret.total_amount)} جنيه</td>
          <td style="padding:0.5rem;text-align:center;">
            <span class="badge badge-success badge-sm">✅ مكتملة</span>
          </td>
          <td style="padding:0.5rem;text-align:center;">
            <button class="btn small" onclick="editReturn(${ret.id})" style="background:#f59e0b;color:white;">✏️</button>
            <button class="btn small" onclick="viewReturn(${ret.id})" style="background:#667eea;color:white;">عرض</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  let editingReturnId = null;

  window.showReturnModal = function(returnData) {
    editingReturnId = returnData ? returnData.id : null;
    const isEdit = !!returnData;

    const overlay = document.createElement('div');
    overlay.id = 'return-modal-overlay';
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
          <h2 style="margin:0;font-size:1.3rem;">${isEdit ? '✏️ تعديل المرتجعة' : '➕ مرتجعة جديدة'}</h2>
          <button style="background:none;border:none;font-size:1.5rem;cursor:pointer;" onclick="closeReturnModal()">&times;</button>
        </div>

        <form id="return-form" onsubmit="saveReturn(event)">
          <div style="margin-bottom:1rem;">
            <label class="form-label" style="font-weight:bold;">المورد <span style="color:red;">*</span></label>
            <select id="edit-return-supplier" class="form-select"
              style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;">
              <option value="">-- اختر مورد --</option>
              ${suppliers.map(s =>
                `<option value="${s.id}" ${returnData?.supplier_id === s.id ? 'selected' : ''}>
                  ${esc(s.name_ar || s.name)} (${s.code || 'بدون كود'})
                </option>`
              ).join('')}
            </select>
          </div>

          <div style="margin-bottom:1rem;">
            <label class="form-label" style="font-weight:bold;">سبب المرتجعة <span style="color:red;">*</span></label>
            <select id="edit-return-reason" class="form-select"
              style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;">
              <option value="defective" ${returnData?.reason === 'defective' ? 'selected' : ''}>🔴 تالف</option>
              <option value="expired" ${returnData?.reason === 'expired' ? 'selected' : ''}>⏰ منتهي الصلاحية</option>
              <option value="wrong_item" ${returnData?.reason === 'wrong_item' ? 'selected' : ''}>📦 صنف خطأ</option>
              <option value="quantity_issue" ${returnData?.reason === 'quantity_issue' ? 'selected' : ''}>📊 مشكلة كمية</option>
              <option value="quality_issue" ${returnData?.reason === 'quality_issue' ? 'selected' : ''}>🔍 جودة غير مقبولة</option>
              <option value="over_delivery" ${returnData?.reason === 'over_delivery' ? 'selected' : ''}>📈 فائض في الكمية</option>
              <option value="damage_during_transit" ${returnData?.reason === 'damage_during_transit' ? 'selected' : ''}>📦 تلف أثناء الشحن</option>
              <option value="other" ${returnData?.reason === 'other' ? 'selected' : ''}>📌 سبب آخر</option>
            </select>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem;">
            <div>
              <label class="form-label" style="font-weight:bold;">قيمة المرتجعة (جنيه) <span style="color:red;">*</span></label>
              <input type="number" id="edit-return-amount" min="0" step="0.01" required
                style="padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;text-align:right;"
                value="${isEdit ? returnData.total_amount : ''}" placeholder="0.00">
            </div>
            <div>
              <label class="form-label" style="font-weight:bold;">تاريخ المرتجعة</label>
              <input type="date" id="edit-return-date"
                style="padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;"
                value="${isEdit && returnData.created_at ? new Date(returnData.created_at).toISOString().substr(0, 10) : new Date().toISOString().substr(0, 10)}">
            </div>
          </div>

          <div style="margin-bottom:1rem;">
            <label class="form-label" style="font-weight:bold;">ملاحظات</label>
            <textarea id="edit-return-notes" rows="2"
              style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;resize:vertical;">${isEdit ? esc(returnData.notes || '') : ''}</textarea>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:1rem;">
            <button type="button" class="btn" onclick="closeReturnModal()">إلغاء</button>
            <button type="submit" class="btn primary" style="background:#667eea;">
              ${isEdit ? '💾 تحديث' : '➕ تسجيل المرتجعة'}
            </button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);
  };

  window.closeReturnModal = function() {
    const overlay = document.getElementById('return-modal-overlay');
    if (overlay) overlay.remove();
    editingReturnId = null;
  };

  window.saveReturn = async function(event) {
    event.preventDefault();

    const supplierId = document.getElementById('edit-return-supplier').value;
    const reason = document.getElementById('edit-return-reason').value;
    const amount = parseFloat(document.getElementById('edit-return-amount').value);
    const date = document.getElementById('edit-return-date').value;
    const notes = (document.getElementById('edit-return-notes').value || '').trim();

    if (!supplierId) {
      showNotification('يجب اختيار مورد', 'warning');
      return;
    }

    if (!reason) {
      showNotification('يجب اختيار سبب المرتجعة', 'warning');
      return;
    }

    if (!amount || amount <= 0) {
      showNotification('يجب إدخال قيمة المرتجعة', 'warning');
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال', 'error');
      return;
    }

    try {
      if (editingReturnId) {
        // تحديث
        const { error } = await client.from('purchase_order_returns').update({
          supplier_id: supplierId,
          reason: reason,
          total_amount: amount,
          notes: notes || null,
          created_at: date ? new Date(date).toISOString() : new Date().toISOString(),
        }).eq('id', editingReturnId);

        if (error) {
          console.error('Error:', error);
          showNotification('خطأ: ' + (error.message || 'فشل التحديث'), 'error');
          return;
        }

        showNotification('تم تحديث المرتجعة ✓', 'success');
      } else {
        // إنشاء جديدة
        const { error } = await client.from('purchase_order_returns').insert({
          id: crypto.randomUUID ? crypto.randomUUID() : 'RET-' + Date.now().toString(36),
          supplier_id: supplierId,
          reason: reason,
          total_amount: amount,
          notes: notes || null,
          created_at: date ? new Date(date).toISOString() : new Date().toISOString(),
          status: 'pending',
        });

        if (error) {
          console.error('Error:', error);
          showNotification('خطأ: ' + (error.message || 'فشل الإنشاء'), 'error');
          return;
        }

        showNotification('تم تسجيل المرتجعة ✓', 'success');
      }

      closeReturnModal();
      loadData();
    } catch (e) {
      console.error('Error:', e);
      showNotification('خطأ: ' + (e.message || 'فشل العملية'), 'error');
    }
  };

  window.editReturn = function(retId) {
    showReturnModal(returnsList.find(r => r.id === retId));
  };

  window.viewReturn = function(retId) {
    showReturnModal(returnsList.find(r => r.id === retId));
  };

  window.submitReturn = async function() {
    const supplierId = document.getElementById('return-supplier').value;
    const reason = document.getElementById('return-reason').value;
    const amount = parseFloat(document.getElementById('return-amount').value);
    const date = document.getElementById('return-date').value;
    const notes = (document.getElementById('return-notes').value || '').trim();

    if (!supplierId) {
      showNotification('يجب اختيار مورد', 'warning');
      return;
    }

    if (!reason) {
      showNotification('يجب اختيار سبب المرتجعة', 'warning');
      return;
    }

    if (!amount || amount <= 0) {
      showNotification('يجب إدخال قيمة المرتجعة', 'warning');
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال', 'error');
      return;
    }

    try {
      const { error } = await client.from('purchase_order_returns').insert({
        id: crypto.randomUUID ? crypto.randomUUID() : 'RET-' + Date.now().toString(36),
        supplier_id: supplierId,
        reason: reason,
        total_amount: amount,
        notes: notes || null,
        created_at: date ? new Date(date).toISOString() : new Date().toISOString(),
        status: 'pending',
      });

      if (error) {
        console.error('Error:', error);
        showNotification('خطأ: ' + (error.message || 'فشل الإنشاء'), 'error');
        return;
      }

      showNotification('تم تسجيل المرتجعة ✓', 'success');
      closeReturnModal();
      loadData();
    } catch (e) {
      console.error('Error:', e);
      showNotification('خطأ: ' + (e.message || 'فشل العملية'), 'error');
    }
  };

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
      font-weight: bold;
      color: #333;
      font-size: 0.9rem;
    }
    .form-input, .form-select {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 1rem;
    }
    .form-input:focus, .form-select:focus {
      border-color: #667eea;
      outline: none;
      box-shadow: 0 0 0 2px rgba(102,126,234,0.2);
    }
    .card {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      padding: 1rem;
    }
    .stat-card {
      border-radius: 8px;
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
    .badge-info { background: #2563eb; color: white; }
    .badge-warning { background: #d97706; color: white; }
    .badge-sm { padding: 0.15rem 0.4rem; font-size: 0.75rem; }
  `;
  document.head.appendChild(style);

  // بدء
  renderPage();

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

})();
