// ============================================================
// صفحة اعتمادات المشتريات
// ============================================================

(function() {
  'use strict';

  let pendingApprovals = [];

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
  if (!currentPath.startsWith('/purchases/approvals')) return;

  const sectionBody = document.getElementById('section-body');
  if (!sectionBody) return;

  // ===== جلب البيانات =====

  async function loadApprovals() {
    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال بقاعدة البيانات', 'error');
      return;
    }

    try {
      const res = await client
        .from('purchase_orders')
        .select('*,supplier:suppliers(id,name,name_ar,code,phone,email)')
        .in('status', ['pending_approval', 'approved', 'rejected'])
        .order('created_at', { ascending: false })
        .limit(500);

      pendingApprovals = res.data || [];
      renderPage();
    } catch (e) {
      console.error('Error loading approvals:', e);
      showNotification('خطأ في جلب البيانات', 'error');
    }
  }

  // ===== حساب الإحصائيات =====

  function getTotalPending() {
    return pendingApprovals.filter(p => p.status === 'pending_approval').length;
  }

  function getTotalApproved() {
    return pendingApprovals.filter(p => p.status === 'approved').length;
  }

  function getTotalRejected() {
    return pendingApprovals.filter(p => p.status === 'rejected').length;
  }

  function getTotalPendingAmount() {
    return pendingApprovals
      .filter(p => p.status === 'pending_approval')
      .reduce((sum, p) => sum + (Number(p.total_amount) || 0), 0);
  }

  function getTotalApprovedAmount() {
    return pendingApprovals
      .filter(p => p.status === 'approved')
      .reduce((sum, p) => sum + (Number(p.total_amount) || 0), 0);
  }

  function getTotalRejectedAmount() {
    return pendingApprovals
      .filter(p => p.status === 'rejected')
      .reduce((sum, p) => sum + (Number(p.total_amount) || 0), 0);
  }

  // ===== رسم الصفحة =====

  function renderPage() {
    sectionBody.innerHTML = `
      <div class="card" style="animation:fadeIn 0.3s ease-in;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
          <h1 style="margin:0;font-size:1.5rem;">📌 اعتمادات المشتريات</h1>
          <a class="btn" href="/purchases">🔙 返回</a>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0.75rem;margin-bottom:1rem;">
          <div class="card stat-card" style="text-align:center;background:#d97706;">
            <div style="font-size:2rem;font-weight:bold;color:white;">${pendingApprovals.length}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">إجمالي الطلبات</div>
          </div>
          <div class="card stat-card" style="text-align:center;background:#d97706;">
            <div style="font-size:2rem;font-weight:bold;color:white;">${getTotalPending()}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">بانتظار الموافقة</div>
          </div>
          <div class="card stat-card" style="text-align:center;background:#16a34a;">
            <div style="font-size:2rem;font-weight:bold;color:white;">${getTotalApproved()}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">معتمدة</div>
          </div>
          <div class="card stat-card" style="text-align:center;background:#dc2626;">
            <div style="font-size:2rem;font-weight:bold;color:white;">${getTotalRejected()}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">مرفوضة</div>
          </div>
          <div class="card stat-card" style="text-align:center;background:#2563eb;">
            <div style="font-size:1.5rem;font-weight:bold;color:white;">${formatCurrency(getTotalPendingAmount())}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">إجمالي قيمة الانتظار (جنيه)</div>
          </div>
          <div class="card stat-card" style="text-align:center;background:#16a34a;">
            <div style="font-size:1.5rem;font-weight:bold;color:white;">${formatCurrency(getTotalApprovedAmount())}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">إجمالي المعتمدة (جنيه)</div>
          </div>
        </div>

        <!-- الانتظار للموافقة -->
        ${getTotalPending() > 0 ? `
          <div class="card" style="margin-bottom:1rem;border:2px solid #d97706;border-radius:8px;border-left:6px solid #d97706;">
            <h3 style="margin:0 0 1rem 0;color:#d97706;">⏳ بانتظار الموافقة (${getTotalPending()})</h3>
            <div id="pending-approvals-list" style="display:grid;gap:0.75rem;"></div>
          </div>
        ` : `
          <div class="card" style="margin-bottom:1rem;background:#f0fdf4;border:2px solid #16a34a;border-radius:8px;border-left:6px solid #16a34a;text-align:center;padding:1rem;">
            <strong style="color:#166534;">✅ لا توجد طلبات بانتظار الموافقة الآن</strong>
            <div class="muted" style="color:#166534;margin-top:0.25rem;">كل الطلبات تمت معالجتها</div>
          </div>
        `}

        <!-- المعتمدة -->
        ${getTotalApproved() > 0 ? `
          <div class="card" style="margin-bottom:1rem;border:2px solid #16a34a;border-radius:8px;border-left:6px solid #16a34a;">
            <h3 style="margin:0 0 1rem 0;color:#16a34a;">✅ المعتمدة (${getTotalApproved()})</h3>
            <div id="approved-list" style="display:grid;gap:0.75rem;"></div>
          </div>
        ` : ''}

        <!-- المرفوضة -->
        ${getTotalRejected() > 0 ? `
          <div class="card" style="border:2px solid #dc2626;border-radius:8px;border-left:6px solid #dc2626;">
            <h3 style="margin:0 0 1rem 0;color:#dc2626;">❌ المرفوضة (${getTotalRejected()})</h3>
            <div id="rejected-list" style="display:grid;gap:0.75rem;"></div>
          </div>
        ` : `
          <div class="card" style="background:#f0fdf4;border:2px solid #16a34a;border-radius:8px;border-left:6px solid #16a34a;text-align:center;padding:1rem;margin-bottom:1rem;">
            <strong style="color:#166534;">✅ لا توجد طلبات مرفوضة</strong>
          </div>
        `}
      </div>
    `;

    // ملء القوائم
    renderPendingApprovals();
    renderApproved();
    renderRejected();
  }

  // ===== قائمة الانتظار للموافقة =====

  function renderPendingApprovals() {
    const container = document.getElementById('pending-approvals-list');
    if (!container) return;

    const pending = pendingApprovals.filter(p => p.status === 'pending_approval');
    if (pending.length === 0) {
      container.innerHTML = '<div class="muted" style="text-align:center;padding:1rem;">لا توجد طلبات انتظار</div>';
      return;
    }

    container.innerHTML = pending.map(po => {
      const supplier = po.supplier;
      const totalAmount = Number(po.total_amount) || 0;

      return `
        <div style="border:1px solid #e5d9c3;border-radius:8px;padding:1rem;background:#fff7ed;display:grid;grid-template-columns:1fr auto;gap:0.75rem;align-items:center;">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
              <div>
                <strong style="color:#92400e;font-size:1.1rem;">${esc(po.order_number || String(po.id).slice(0, 8))}</strong>
                <span class="muted" style="font-size:0.85rem;margin-left:0.5rem;">${supplier ? esc(supplier.name_ar || supplier.name) : '—'}</span>
              </div>
              <div style="font-size:1.3rem;font-weight:bold;color:#d97706;">${formatCurrency(totalAmount)} جنيه</div>
            </div>
            <div style="display:flex;gap:1rem;margin-top:0.5rem;font-size:0.9rem;color:#666;">
              ${supplier ? `<span>📞 ${esc(supplier.phone || '—')}</span>` : ''}
              ${supplier && supplier.email ? `<span>📧 ${esc(supplier.email)}</span>` : ''}
              <span>📅 ${po.created_at ? new Date(po.created_at).toLocaleDateString('ar-EG') : '—'}</span>
            </div>
            ${po.notes ? `<div style="margin-top:0.5rem;padding:0.5rem;background:#fff3cd;border-left:3px solid #ffc107;border-radius:3px;font-size:0.9rem;color:#856404;">📝 ${esc(po.notes)}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:0.5rem;align-items:flex-end;">
            <button class="btn success" style="background:#16a34a;width:120px;align-self:flex-end;"
              onclick="approvePurchaseOrder('${po.id}')"
              ${!canApprove(po) ? 'disabled' : ''}>
              ✅ موافقة
            </button>
            <button class="btn danger" style="background:#dc2626;width:120px;align-self:flex-end;"
              onclick="rejectPurchaseOrder('${po.id}')">
              ❌ رفض
            </button>
            <button class="btn" style="width:120px;align-self:flex-end;"
              onclick="viewFullOrder('${po.id}')">
              📋 عرض
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  function canApprove(po) {
    // معايير بسيطة - يمكن تعديلها
    if (!po.supplier) return false;
    return true;
  }

  // ===== قائمة المعتمدة =====

  function renderApproved() {
    const container = document.getElementById('approved-list');
    if (!container) return;

    const approved = pendingApprovals.filter(p => p.status === 'approved');
    if (approved.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = approved.map(po => {
      const supplier = po.supplier;
      const totalAmount = Number(po.total_amount) || 0;

      return `
        <div style="border:1px solid #bbf7d0;border-left:4px solid #16a34a;border-radius:8px;padding:1rem;background:#f0fdf4;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
            <div>
              <strong style="color:#166534;font-size:1.05rem;">${esc(po.order_number || String(po.id).slice(0, 8))}</strong>
              <span class="muted" style="font-size:0.85rem;margin-left:0.5rem;">${supplier ? esc(supplier.name_ar || supplier.name) : '—'}</span>
            </div>
            <div style="font-size:1.2rem;font-weight:bold;color:#16a34a;">${formatCurrency(totalAmount)} جنيه</div>
          </div>
          <div style="display:flex;gap:0.5rem;margin-top:0.5rem;font-size:0.9rem;color:#666;">
            ${supplier ? `<span>📞 ${esc(supplier.phone || '—')}</span>` : ''}
            ${po.created_at ? `<span>📅 ${new Date(po.created_at).toLocaleDateString('ar-EG')}</span>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  // ===== قائمة المرفوضة =====

  function renderRejected() {
    const container = document.getElementById('rejected-list');
    if (!container) return;

    const rejected = pendingApprovals.filter(p => p.status === 'rejected');
    if (rejected.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = rejected.map(po => {
      const supplier = po.supplier;
      const totalAmount = Number(po.total_amount) || 0;

      return `
        <div style="border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:8px;padding:1rem;background:#fef2f2;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
            <div>
              <strong style="color:#991b1b;font-size:1.05rem;">${esc(po.order_number || String(po.id).slice(0, 8))}</strong>
              <span class="muted" style="font-size:0.85rem;margin-left:0.5rem;">${supplier ? esc(supplier.name_ar || supplier.name) : '—'}</span>
            </div>
            <div style="font-size:1.2rem;font-weight:bold;color:#dc2626;">${formatCurrency(totalAmount)} جنيه</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ===== عمليات الموافقة والرفض =====

  window.approvePurchaseOrder = async function(orderId) {
    if (!confirm('هل تريد اعتماد أمر الشراء ' + orderId + '؟')) return;

    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال', 'error');
      return;
    }

    try {
      const { error } = await client.from('purchase_orders').update({
        status: 'approved',
        updated_at: new Date().toISOString(),
        approved_by: getCurrentSession()?.id || 'system',
        approved_at: new Date().toISOString(),
      }).eq('id', orderId);

      if (error) {
        console.error('Error:', error);
        showNotification('خطأ: ' + (error.message || 'فشل الاعتماد'), 'error');
        return;
      }

      showNotification('تم اعتماد أمر الشراء ✓', 'success');
      loadApprovals();
    } catch (e) {
      console.error('Error:', e);
      showNotification('خطأ: ' + (e.message || 'فشل العملية'), 'error');
    }
  };

  window.rejectPurchaseOrder = async function(orderId) {
    const reason = prompt('سبب الرفض (اختياري):');
    if (reason === null) return; // تم إغلاق النافذة

    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال', 'error');
      return;
    }

    try {
      const { error } = await client.from('purchase_orders').update({
        status: 'rejected',
        updated_at: new Date().toISOString(),
        rejected_by: getCurrentSession()?.id || 'system',
        rejected_at: new Date().toISOString(),
        rejection_reason: reason || null,
      }).eq('id', orderId);

      if (error) {
        console.error('Error:', error);
        showNotification('خطأ: ' + (error.message || 'فشل الرفض'), 'error');
        return;
      }

      showNotification('تم رفض أمر الشراء ✓', 'success');
      loadApprovals();
    } catch (e) {
      console.error('Error:', e);
      showNotification('خطأ: ' + (e.message || 'فشل العملية'), 'error');
    }
  };

  window.viewFullOrder = function(orderId) {
    navigate('/purchases/orders/' + orderId);
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
    .card {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      padding: 1rem;
    }
    .stat-card {
      border-radius: 8px;
    }
    .muted {
      color: #6b7280;
      font-size: 0.9rem;
    }
    .btn {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
      font-weight: bold;
      transition: all 0.2s;
    }
    .btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn.success { background: #16a34a; color: white; }
    .btn.danger { background: #dc2626; color: white; }
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
