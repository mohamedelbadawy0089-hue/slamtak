// ============================================================
// صفحة مدفوعات الموردين
// ============================================================

(function() {
  'use strict';

  let payments = [];
  let suppliers = [];
  let pendingInvoices = [];

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
  if (!currentPath.startsWith('/purchases/payments')) return;

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
      // جلب المدفوعات
      const payRes = await client
        .from('payments')
        .select('*,supplier:suppliers(id,name,name_ar,code)')
        .order('created_at', { ascending: false })
        .limit(200);

      payments = payRes.data || [];

      // جلب الموردين
      const supRes = await client
        .from('suppliers')
        .select('id,name,name_ar,code')
        .eq('is_active', true)
        .order('name')
        .limit(200);

      suppliers = supRes.data || [];

      // جلب الفواتير المعلقة للدفع
      const invRes = await client
        .from('purchase_orders')
        .select('*,supplier:suppliers(id,name,name_ar,code)')
        .eq('status', 'received')
        .or('status.eq.partially_received')
        .order('created_at', { ascending: false })
        .limit(50);

      pendingInvoices = invRes.data || [];

      renderPage();
    } catch (e) {
      console.error('Error loading data:', e);
      showNotification('خطأ في جلب البيانات', 'error');
    }
  }

  // ===== رسم الصفحة =====

  function renderPage() {
    sectionBody.innerHTML = `
      <div class="card" style="animation:fadeIn 0.3s ease-in;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
          <h1 style="margin:0;font-size:1.5rem;">💰 مدفوعات الموردين</h1>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button class="btn primary" onclick="showAddPaymentModal()">➕ دفعة جديدة</button>
            <a class="btn" href="/purchases">🔙返回</a>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:0.75rem;margin-bottom:1rem;">
          <div class="card stat-card" style="text-align:center;background:#2563eb;">
            <div style="font-size:1.5rem;font-weight:bold;color:white;">${payments.length}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">إجمالي الدفعات</div>
          </div>
          <div class="card stat-card" style="text-align:center;background:#16a34a;">
            <div style="font-size:1.5rem;font-weight:bold;color:white;">${formatCurrency(getTotalPaidAmount())}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">إجمالي المدفوعات (جنيه)</div>
          </div>
          <div class="card stat-card" style="text-align:center;background:#d97706;">
            <div style="font-size:1.5rem;font-weight:bold;color:white;">${formatCurrency(getTotalPendingAmount())}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">إجمالي المOutstanding (جنيه)</div>
          </div>
          <div class="card stat-card" style="text-align:center;background:#667eea;">
            <div style="font-size:1.5rem;font-weight:bold;color:white;">${pendingInvoices.length}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">فواتير معلقة للدفع</div>
          </div>
        </div>

        <!-- دفعة جديدة -->
        <div class="card" style="margin-bottom:1rem;">
          <h3 style="margin:0 0 1rem 0;color:#667eea;">➕ تسجيل دفعة جديدة</h3>

          <div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:1rem;flex-wrap:wrap;">
            <div>
              <label class="form-label" style="font-weight:bold;min-width:100px;">المورد <span style="color:red;">*</span></label>
              <select id="payment-supplier" class="form-select"
                style="padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;min-width:200px;">
                <option value="">-- اختر مورد --</option>
                ${suppliers.map(s =>
                  `<option value="${s.id}">${esc(s.name_ar || s.name)} (${s.code || 'بدون كود'})</option>`
                ).join('')}
              </select>
            </div>

            <div>
              <label class="form-label" style="font-weight:bold;min-width:100px;">مبلغ الدفعة (جنيه) <span style="color:red;">*</span></label>
              <input type="number" id="payment-amount" min="0" step="0.01"
                style="padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;width:150px;text-align:right;"
                placeholder="0.00">
            </div>

            <div>
              <label class="form-label" style="font-weight:bold;min-width:100px;">طريقة الدفع</label>
              <select id="payment-method" class="form-select"
                style="padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;min-width:150px;">
                <option value="cash">نقداً</option>
                <option value="bank_transfer">تحويل بنكي</option>
                <option value="cheque">شيك</option>
                <option value="card">بطاقة ائتمانية</option>
                <option value="other">أخرى</option>
              </select>
            </div>

            <button class="btn primary" style="background:#667eea;"
              onclick="addPayment()">➕ تسجيل الدفعة</button>
          </div>

          ${pendingInvoices.length > 0 ? `
            <div style="background:#fef3c7;border:2px solid #f59e0b;border-radius:8px;padding:1rem;">
              <h4 style="margin:0 0 0.5rem 0;color:#92400e;">📋 فواتير معلقة للدفع (${pendingInvoices.length})</h4>
              <table style="width:100%;border-collapse:collapse;font-size:0.9rem;margin-top:0.5rem;">
                <thead>
                  <tr style="background:#fde68a;text-align:right;">
                    <th style="padding:0.5rem;">رقم الفاتورة</th>
                    <th style="padding:0.5rem;">المورد</th>
                    <th style="padding:0.5rem;">المبلغ الم Outstanding</th>
                    <th style="padding:0.5rem;">تاريخ الفاتورة</th>
                    <th style="padding:0.5rem;">الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  ${pendingInvoices.map(inv => `
                    <tr style="border-bottom:1px solid #eee;">
                      <td style="padding:0.5rem;">${esc(inv.order_number || '—')}</td>
                      <td style="padding:0.5rem;">${inv.supplier ? esc(inv.supplier.name_ar || inv.supplier.name) : '—'}</td>
                      <td style="padding:0.5rem;font-weight:bold;text-align:right;color:#d97706;">
                        ${(Number(inv.total_amount) || 0).toFixed(2)} جنيه
                      </td>
                      <td style="padding:0.5rem;">${inv.created_at ? new Date(inv.created_at).toLocaleDateString('ar-EG') : '—'}</td>
                      <td style="padding:0.5rem;text-align:center;">
                        <button class="btn small" style="background:#16a34a;color:white;"
                          onclick="quickPayInvoice('${inv.id}')">💳 دفع للفاتورة</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
              <div style="margin-top:0.75rem;font-weight:bold;color:#92400e;">
                إجمالي الم Outstanding: ${formatCurrency(pendingInvoices.reduce((sum, inv) => sum + (Number(inv.total_amount) || 0), 0))} جنيه
              </div>
            </div>
          ` : `
            <div style="background:#f0fdf4;border:2px solid #16a34a;border-radius:8px;padding:1rem;text-align:center;color:#166534;">
              <strong>✅ لا توجد فواتير معلقة للدفع</strong>
              <span class="muted"> - تم دفع جميع الفواتير</span>
            </div>
          `}
        </div>

        <!-- سجل الدفعات -->
        <div class="card">
          <h3 style="margin:0 0 1rem 0;color:#667eea;">📚 سجل الدفعات (${payments.length})</h3>

          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:0.95rem;">
              <thead>
                <tr style="background:#f8f9fa;border-bottom:2px solid #ddd;text-align:right;">
                  <th style="padding:0.5rem;width:50px;">#</th>
                  <th style="padding:0.5rem;width:150px;">تاريخ الدفعة</th>
                  <th style="padding:0.5rem;width:200px;">المورد</th>
                  <th style="padding:0.5rem;width:120px;">المبلغ</th>
                  <th style="padding:0.5rem;width:120px;">طريقة الدفع</th>
                  <th style="padding:0.5rem;width:150px;">الحساب / الشيك</th>
                  <th style="padding:0.5rem;width:120px;">ملاحظات</th>
                  <th style="padding:0.5rem;width:100px;">العمليات</th>
                </tr>
              </thead>
              <tbody id="payments-table-body">
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    renderPaymentsTable();
  }

  // ===== حساب الإحصائيات =====

  function getTotalPaidAmount() {
    return payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  }

  function getTotalPendingAmount() {
    const totalReceivedAmount = pendingInvoices.reduce((sum, inv) => sum + (Number(inv.total_amount) || 0), 0);
    const totalPaymentsForThese = payments
      .filter(p => p.reference_type === 'purchase_order' && pendingInvoices.some(inv => inv.id === p.reference_id))
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    return Math.max(0, totalReceivedAmount - totalPaymentsForThese);
  }

  // ===== جدول الدفعات =====

  function renderPaymentsTable() {
    const tbody = document.getElementById('payments-table-body');
    if (!tbody) return;

    if (payments.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="muted" style="text-align:center;padding:2rem;">
            لا توجد دفعات حتى الآن.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = payments.map((p, i) => {
      const supplier = p.supplier;
      const methodLabels = {
        cash: '💵 نقداً',
        bank_transfer: '🏦 تحويل بنكي',
        cheque: '📝 شيك',
        card: '💳 بطاقة',
        other: '📌 أخرى',
      };

      return `
        <tr style="border-bottom:1px solid #eee;">
          <td style="padding:0.5rem;text-align:center;color:#667eea;font-weight:bold;">${i + 1}</td>
          <td style="padding:0.5rem;">${p.created_at ? new Date(p.created_at).toLocaleDateString('ar-EG') : '—'}</td>
          <td style="padding:0.5rem;">
            <div style="font-weight:bold;">${supplier ? esc(supplier.name_ar || supplier.name) : '—'}</div>
            <div class="muted" style="font-size:0.85rem;">${supplier ? esc(supplier.code || '') : ''}</div>
          </td>
          <td style="padding:0.5rem;font-weight:bold;text-align:right;color:#16a34a;">${formatCurrency(p.amount)} جنيه</td>
          <td style="padding:0.5rem;">${methodLabels[p.method] || esc(p.method || '—')}</td>
          <td style="padding:0.5rem;font-size:0.85rem;">${esc(p.account_number || p.cheque_number || p.reference || '—')}</td>
          <td style="padding:0.5rem;font-size:0.85rem;color:#666;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.notes || '—')}</td>
          <td style="padding:0.5rem;text-align:center;">
            <button class="btn small" onclick="editPayment(${p.id})" style="background:#f59e0b;color:white;">✏️ تعديل</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ===== عمليات الدفع =====

  window.quickPayInvoice = async function(invId) {
    const supplier = pendingInvoices.find(i => i.id === invId);
    if (!supplier) {
      showNotification('الفاتورة غير موجودة', 'error');
      return;
    }

    document.getElementById('payment-supplier').value = supplier.supplier_id;
    document.getElementById('payment-amount').value = (Number(supplier.total_amount) || 0).toFixed(2);
    showAddPaymentModal();
  };

  window.addPayment = async function() {
    const supplierId = document.getElementById('payment-supplier').value;
    const amount = parseFloat(document.getElementById('payment-amount').value);
    const method = document.getElementById('payment-method').value;

    if (!supplierId) {
      showNotification('يجب اختيار مورد', 'warning');
      return;
    }

    if (!amount || amount <= 0) {
      showNotification('يجب إدخال مبلغ الدفعة', 'warning');
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال', 'error');
      return;
    }

    try {
      const { error } = await client.from('payments').insert({
        id: crypto.randomUUID ? crypto.randomUUID() : 'PAY-' + Date.now().toString(36),
        supplier_id: supplierId,
        amount: amount,
        method: method,
        created_at: new Date().toISOString(),
        reference_type: 'purchase_order',
        notes: (document.getElementById('payment-notes')?.value || '').trim(),
      });

      if (error) {
        console.error('Error:', error);
        showNotification('خطأ: ' + (error.message || 'فشل الإنشاء'), 'error');
        return;
      }

      showNotification(`تم تسجيل دفعة ${formatCurrency(amount)} جنيه ✓`, 'success');

      // إعادة تحميل البيانات
      loadData();
    } catch (e) {
      console.error('Error:', e);
      showNotification('خطأ: ' + (e.message || 'فشل العملية'), 'error');
    }
  };

  window.editPayment = async function(paymentId) {
    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال', 'error');
      return;
    }

    try {
      const res = await client.from('payments').select('*').eq('id', paymentId).single();
      if (!res.data) {
        showNotification('الدفعة غير موجودة', 'error');
        return;
      }

      showAddPaymentModal(res.data);
    } catch (e) {
      console.error('Error:', e);
      showNotification('خطأ: ' + (e.message || 'فشل الجلب'), 'error');
    }
  };

  window.showAddPaymentModal = function(paymentData) {
    const isEdit = !!paymentData;

    const overlay = document.createElement('div');
    overlay.id = 'payment-modal-overlay';
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
          <h2 style="margin:0;font-size:1.3rem;">${isEdit ? '✏️ تعديل الدفعة' : '➕ دفعة جديدة'}</h2>
          <button style="background:none;border:none;font-size:1.5rem;cursor:pointer;" onclick="closePaymentModal()">&times;</button>
        </div>

        <form id="payment-form" onsubmit="savePayment(event)">
          <div style="margin-bottom:1rem;">
            <label class="form-label" style="font-weight:bold;">المورد <span style="color:red;">*</span></label>
            <select id="edit-payment-supplier" class="form-select"
              style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;">
              <option value="">-- اختر مورد --</option>
              ${suppliers.map(s =>
                `<option value="${s.id}" ${paymentData?.supplier_id === s.id ? 'selected' : ''}>
                  ${esc(s.name_ar || s.name)} (${s.code || 'بدون كود'})
                </option>`
              ).join('')}
            </select>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem;">
            <div>
              <label class="form-label" style="font-weight:bold;">مبلغ الدفعة (جنيه) <span style="color:red;">*</span></label>
              <input type="number" id="edit-payment-amount" min="0" step="0.01" required
                style="padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;text-align:right;"
                value="${isEdit ? paymentData.amount : ''}" placeholder="0.00">
            </div>
            <div>
              <label class="form-label" style="font-weight:bold;">طريقة الدفع</label>
              <select id="edit-payment-method" class="form-select"
                style="padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;">
                <option value="cash" ${paymentData?.method === 'cash' ? 'selected' : ''}>💵 نقداً</option>
                <option value="bank_transfer" ${paymentData?.method === 'bank_transfer' ? 'selected' : ''}>🏦 تحويل بنكي</option>
                <option value="cheque" ${paymentData?.method === 'cheque' ? 'selected' : ''}>📝 شيك</option>
                <option value="card" ${paymentData?.method === 'card' ? 'selected' : ''}>💳 بطاقة</option>
                <option value="other" ${paymentData?.method === 'other' ? 'selected' : ''}>📌 أخرى</option>
              </select>
            </div>
          </div>

          ${(paymentData?.method === 'bank_transfer' || (!isEdit)) ? `
            <div style="margin-bottom:1rem;">
              <label class="form-label" style="font-weight:bold;">رقم الحساب / تحويل بنكي</label>
              <input type="text" id="edit-payment-account"
                style="padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;"
                value="${isEdit ? esc(paymentData.account_number || '') : ''}" placeholder="رقم الحساب">
            </div>
          ` : ''}

          ${(paymentData?.method === 'cheque') ? `
            <div style="margin-bottom:1rem;">
              <label class="form-label" style="font-weight:bold;">رقم الشيك</label>
              <input type="text" id="edit-payment-cheque"
                style="padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;"
                value="${isEdit ? esc(paymentData.cheque_number || '') : ''}" placeholder="رقم الشيك">
            </div>
          ` : ''}

          <div style="margin-bottom:1rem;">
            <label class="form-label" style="font-weight:bold;">ملاحظات</label>
            <textarea id="edit-payment-notes" rows="2"
              style="padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;resize:vertical;">${isEdit ? esc(paymentData.notes || '') : ''}</textarea>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:1rem;">
            <button type="button" class="btn" onclick="closePaymentModal()">إلغاء</button>
            <button type="submit" class="btn primary" style="background:#667eea;">
              ${isEdit ? '💾 تحديث' : '➕ تسجيل الدفعة'}
            </button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);

    if (isEdit) {
      document.getElementById('edit-payment-supplier').value = paymentData.supplier_id;
      document.getElementById('edit-payment-amount').value = paymentData.amount;
      document.getElementById('edit-payment-method').value = paymentData.method || 'cash';
      document.getElementById('edit-payment-account').value = paymentData.account_number || '';
      document.getElementById('edit-payment-cheque').value = paymentData.cheque_number || '';
      document.getElementById('edit-payment-notes').value = paymentData.notes || '';
    }
  };

  window.closePaymentModal = function() {
    const overlay = document.getElementById('payment-modal-overlay');
    if (overlay) overlay.remove();
  };

  window.savePayment = async function(event) {
    event.preventDefault();

    // تحديد أي نموذج كان مفتوحاً
    const isEdit = !!editingPaymentId;
    const supplierId = document.getElementById(isEdit ? 'edit-payment-supplier' : 'payment-supplier').value;
    const amount = parseFloat(document.getElementById(isEdit ? 'edit-payment-amount' : 'payment-amount').value);
    const method = document.getElementById(isEdit ? 'edit-payment-method' : 'payment-method').value;

    if (!supplierId) {
      showNotification('يجب اختيار مورد', 'warning');
      return;
    }

    if (!amount || amount <= 0) {
      showNotification('يجب إدخال مبلغ الدفعة', 'warning');
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال', 'error');
      return;
    }

    try {
      let result;
      if (isEdit) {
        result = await client.from('payments').update({
          supplier_id: supplierId,
          amount: amount,
          method: method,
          account_number: (paymentData?.method === 'bank_transfer' || method === 'bank_transfer') ?
            document.getElementById('edit-payment-account').value.trim() || null : null,
          cheque_number: (paymentData?.method === 'cheque' || method === 'cheque') ?
            document.getElementById('edit-payment-cheque').value.trim() || null : null,
          notes: (document.getElementById('edit-payment-notes').value || '').trim() || null,
        }).eq('id', editingPaymentId);
      } else {
        result = await client.from('payments').insert({
          id: crypto.randomUUID ? crypto.randomUUID() : 'PAY-' + Date.now().toString(36),
          supplier_id: supplierId,
          amount: amount,
          method: method,
          account_number: method === 'bank_transfer' ? (document.getElementById('payment-account')?.value.trim() || null) : null,
          cheque_number: method === 'cheque' ? (document.getElementById('payment-cheque')?.value.trim() || null) : null,
          notes: (document.getElementById('payment-notes')?.value || '').trim() || null,
          created_at: new Date().toISOString(),
          reference_type: 'purchase_order',
        });
      }

      if (result.error) {
        console.error('Error:', result.error);
        showNotification('خطأ: ' + (result.error.message || 'فشل العملية'), 'error');
        return;
      }

      showNotification(isEdit ? 'تم تحديث الدفعة ✓' : 'تم تسجيل الدفعة ✓', 'success');
      closePaymentModal();
      loadData();
    } catch (e) {
      console.error('Error:', e);
      showNotification('خطأ: ' + (e.message || 'فشل العملية'), 'error');
    }
  };

  let editingPaymentId = null;
  let editingPaymentData = null;

  // تعديل يحتاج تعديل متغير
  const originalEditPayment = window.editPayment;
  window.editPayment = async function(paymentId) {
    editingPaymentId = paymentId;
    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال', 'error');
      return;
    }

    try {
      const res = await client.from('payments').select('*').eq('id', paymentId).single();
      if (!res.data) {
        showNotification('الدفعة غير موجودة', 'error');
        return;
      }
      editingPaymentData = res.data;
      window.showAddPaymentModal(res.data);
    } catch (e) {
      console.error('Error:', e);
      showNotification('خطأ: ' + (e.message || 'فشل الجلب'), 'error');
    }
  };

  window.savePayment = async function(event) {
    event.preventDefault();

    const supplierId = document.getElementById('edit-payment-supplier').value;
    const amount = parseFloat(document.getElementById('edit-payment-amount').value);
    const method = document.getElementById('edit-payment-method').value;

    if (!supplierId) {
      showNotification('يجب اختيار مورد', 'warning');
      return;
    }

    if (!amount || amount <= 0) {
      showNotification('يجب إدخال مبلغ الدفعة', 'warning');
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال', 'error');
      return;
    }

    try {
      const accountNumber = method === 'bank_transfer' ?
        document.getElementById('edit-payment-account').value.trim() || null : null;
      const chequeNumber = method === 'cheque' ?
        document.getElementById('edit-payment-cheque').value.trim() || null : null;
      const notes = (document.getElementById('edit-payment-notes').value || '').trim() || null;

      const { error } = await client.from('payments').update({
        supplier_id: supplierId,
        amount: amount,
        method: method,
        account_number: accountNumber,
        cheque_number: chequeNumber,
        notes: notes,
      }).eq('id', editingPaymentId);

      if (error) {
        console.error('Error:', error);
        showNotification('خطأ: ' + (error.message || 'فشل التحديث'), 'error');
        return;
      }

      showNotification('تم تحديث الدفعة ✓', 'success');
      closePaymentModal();
      editingPaymentId = null;
      editingPaymentData = null;
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
  `;
  document.head.appendChild(style);

  // بدء
  renderPage();

  function navigate(path) {
    if (typeof window.safeNavigate === 'function') {
      window.safeNavigate(path);
    } else {
      window.location.href = path;
    }
  }

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
