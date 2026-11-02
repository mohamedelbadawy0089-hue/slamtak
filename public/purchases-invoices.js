// ============================================================
// صفحة فواتير المشتريات
// ============================================================

(function() {
  'use strict';

  let invoices = [];

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
  if (!currentPath.startsWith('/purchases/invoices')) return;

  const sectionBody = document.getElementById('section-body');
  if (!sectionBody) return;

  // ===== جلب البيانات =====

  async function loadInvoices() {
    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال بقاعدة البيانات', 'error');
      return;
    }

    try {
      const res = await client
        .from('purchase_orders')
        .select(`
          *,
          supplier:suppliers(id,name,name_ar,code,phone,email)
        `)
        .order('created_at', { ascending: false })
        .limit(200);

      invoices = res.data || [];
      renderTable();

      // إحصائيات
      const stats = {
        total: invoices.length,
        pending: invoices.filter(i => ['pending', 'pending_approval'].includes(i.status)).length,
        received: invoices.filter(i => ['received', 'posted'].includes(i.status)).length,
        cancelled: invoices.filter(i => i.status === 'cancelled').length,
        totalAmount: invoices.reduce((sum, i) => sum + (Number(i.total_amount) || 0), 0),
      };

      const statsRow = document.getElementById('invoices-stats');
      if (statsRow) {
        statsRow.innerHTML = `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:0.75rem;">
            <div class="card stat-card" style="text-align:center;background:#667eea;">
              <div style="font-size:1.5rem;font-weight:bold;color:white;">${stats.total}</div>
              <div class="muted" style="color:rgba(255,255,255,0.8);">إجمالي الفواتير</div>
            </div>
            <div class="card stat-card" style="text-align:center;background:#d97706;">
              <div style="font-size:1.5rem;font-weight:bold;color:white;">${stats.pending}</div>
              <div class="muted" style="color:rgba(255,255,255,0.8);">قيد الانتظار</div>
            </div>
            <div class="card stat-card" style="text-align:center;background:#16a34a;">
              <div style="font-size:1.5rem;font-weight:bold;color:white;">${stats.received}</div>
              <div class="muted" style="color:rgba(255,255,255,0.8);">تم الاستلام</div>
            </div>
            <div class="card stat-card" style="text-align:center;background:#dc2626;">
              <div style="font-size:1.5rem;font-weight:bold;color:white;">${stats.cancelled}</div>
              <div class="muted" style="color:rgba(255,255,255,0.8);">ملغاة</div>
            </div>
            <div class="card stat-card" style="text-align:center;background:#2563eb;">
              <div style="font-size:1.5rem;font-weight:bold;color:white;">${stats.totalAmount.toFixed(0)}</div>
              <div class="muted" style="color:rgba(255,255,255,0.8);">إجمالي المبلغ (جنيه)</div>
            </div>
          </div>
        `;
      }

    } catch (e) {
      console.error('Error loading invoices:', e);
      showNotification('خطأ في جلب البيانات', 'error');
    }
  }

  // ===== رسم الجدول =====

  function renderTable() {
    const tbody = document.getElementById('invoices-table-body');
    if (!tbody) return;

    if (invoices.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="muted" style="text-align:center;padding:2rem;">
            لا توجد فواتير حتى الآن. ابدأ بإنشاء أمر شراء جديد.
          </td>
        </tr>
      `;
      return;
    }

    const STATUS_LABELS = {
      pending: 'قيد الانتظار',
      confirmed: 'مؤكد',
      completed: 'تم التنفيذ',
      cancelled: 'ملغي',
      pending_approval: 'بانتظار الموافقة',
      approved: 'معتمد',
      rejected: 'مرفوض',
      ordered: 'تم الطلب',
      submitted: 'مُقدَّم',
      selected: 'مُختار',
      expired: 'منتهي',
      sent: 'مُرسل',
      partially_received: 'مستلم جزئياً',
      received: 'مستلم',
      posted: 'مُصدر',
      draft: 'مسودة',
      paid: 'مدفوعة',
      partially_paid: 'مدفوعة جزئياً',
    };

    const statusBadges = {
      pending: 'badge-secondary',
      pending_approval: 'badge-info',
      confirmed: 'badge-primary',
      approved: 'badge-success',
      rejected: 'badge-danger',
      cancelled: 'badge-danger',
      ordered: 'badge-warning',
      submitted: 'badge-info',
      partially_received: 'badge-warning',
      received: 'badge-success',
      posted: 'badge-success',
      draft: 'badge-secondary',
      sent: 'badge-info',
      expired: 'badge-secondary',
      paid: 'badge-success',
      partially_paid: 'badge-warning',
    };

    tbody.innerHTML = invoices.map((inv, i) => {
      const supplier = inv.supplier;
      const statusClass = statusBadges[inv.status] || 'badge-secondary';
      const statusLabel = STATUS_LABELS[inv.status] || inv.status;

      const total = Number(inv.total_amount) || 0;

      return `
        <tr style="border-bottom:1px solid #eee;">
          <td style="padding:0.5rem;text-align:center;color:#667eea;font-weight:bold;">${i + 1}</td>
          <td style="padding:0.5rem;">
            <div style="font-weight:bold;font-size:1rem;color:#667eea;">${esc(inv.order_number || '—')}</div>
            <div class="muted" style="font-size:0.85rem;">تاريخ: ${inv.created_at ? new Date(inv.created_at).toLocaleDateString('ar-EG') : '—'}</div>
          </td>
          <td style="padding:0.5rem;">
            <div style="font-weight:bold;">${supplier ? esc(supplier.name_ar || supplier.name) : '—'}</div>
            <div class="muted" style="font-size:0.85rem;">${supplier ? esc(supplier.code || '') : ''}${supplier ? ' | ' + esc(supplier.phone || '') : ''}</div>
          </td>
          <td style="padding:0.5rem;text-align:center;">
            <span class="badge ${statusClass} badge-sm">${statusLabel}</span>
          </td>
          <td style="padding:0.5rem;font-weight:bold;text-align:right;">${total.toFixed(2)} جنيه</td>
          <td style="padding:0.5rem;text-align:center;">
            <button class="btn small" onclick="viewInvoice('${inv.id}')" style="background:#667eea;color:white;">عرض</button>
            ${inv.status === 'pending' && ['pending_approval', 'approved', 'confirmed', 'ordered', 'submitted'].includes(inv.status)
              ? ''
              : inv.status !== 'received' && inv.status !== 'posted' && inv.status !== 'cancelled'
                ? '<button class="btn small" onclick="receiveInvoice(\'' + inv.id + '\')" style="background:#16a34a;color:white;">📥 استلام</button>'
                : ''
            }
          </td>
          <td style="padding:0.5rem;font-size:0.85rem;color:#666;text-align:center;">${inv.created_at ? new Date(inv.created_at).toLocaleDateString('ar-EG') : '—'}</td>
        </tr>
      `;
    }).join('');
  }

  // ===== بناء الصفحة =====

  function renderPage() {
    sectionBody.innerHTML = `
      <div class="card" style="animation:fadeIn 0.3s ease-in;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
          <h1 style="margin:0;font-size:1.5rem;">📄 فواتير المشتريات</h1>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button class="btn primary" onclick="navigate('/purchases/new')">➕ فاتورة جديدة</button>
            <input type="text" id="invoice-search" placeholder="🔍 بحث بـ رقم أو اسم أو تاريخ..."
              style="padding:0.4rem;border:1px solid #ddd;border-radius:4px;font-size:0.9rem;width:250px;"
              oninput="filterInvoices(this.value)">
            <a class="btn" href="/purchases">🔙返回</a>
          </div>
        </div>

        <div id="invoices-stats" style="margin-bottom:1rem;"></div>

        <div class="card" style="overflow:hidden;">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.75rem;background:#f8f9fa;border-bottom:2px solid #ddd;">
            <h3 style="margin:0;">📋 جميع الفواتير (${invoices.length})</h3>
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:0.95rem;">
              <thead>
                <tr style="background:#f8f9fa;border-bottom:2px solid #ddd;text-align:right;">
                  <th style="padding:0.5rem;width:50px;">#</th>
                  <th style="padding:0.5rem;width:150px;">رقم الفاتورة</th>
                  <th style="padding:0.5rem;width:200px;">المورد</th>
                  <th style="padding:0.5rem;width:120px;">الحالة</th>
                  <th style="padding:0.5rem;width:120px;">المبلغ الإجمالي</th>
                  <th style="padding:0.5rem;width:150px;">العمليات</th>
                  <th style="padding:0.5rem;width:100px;">تاريخ الإنشاء</th>
                </tr>
              </thead>
              <tbody id="invoices-table-body">
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    loadInvoices();
  }

  // ===== البحث =====

  window.filterInvoices = function(query) {
    if (!query || query.trim() === '') {
      renderTable();
      return;
    }

    const filtered = invoices.filter(inv => {
      const supplier = inv.supplier;
      return (
        (inv.order_number || '').toLowerCase().includes(query.toLowerCase()) ||
        (supplier && (supplier.name_ar || supplier.name).toLowerCase().includes(query.toLowerCase())) ||
        (supplier && (supplier.code || '').toLowerCase().includes(query.toLowerCase())) ||
        (inv.created_at && new Date(inv.created_at).toLocaleDateString('ar-EG').includes(query))
      );
    });

    const tbody = document.getElementById('invoices-table-body');
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

    renderTableWithData(filtered);
  };

  function renderTableWithData(data) {
    const tbody = document.getElementById('invoices-table-body');
    if (!tbody) return;

    const STATUS_LABELS = {
      pending: 'قيد الانتظار',
      confirmed: 'مؤكد',
      completed: 'تم التنفيذ',
      cancelled: 'ملغي',
      pending_approval: 'بانتظار الموافقة',
      approved: 'معتمد',
      rejected: 'مرفوض',
      ordered: 'تم الطلب',
      submitted: 'مُقدَّم',
      selected: 'مُختار',
      expired: 'منتهي',
      sent: 'مُرسل',
      partially_received: 'مستلم جزئياً',
      received: 'مستلم',
      posted: 'مُصدر',
      draft: 'مسودة',
      paid: 'مدفوعة',
      partially_paid: 'مدفوعة جزئياً',
    };

    const statusBadges = {
      pending: 'badge-secondary',
      pending_approval: 'badge-info',
      confirmed: 'badge-primary',
      approved: 'badge-success',
      rejected: 'badge-danger',
      cancelled: 'badge-danger',
      ordered: 'badge-warning',
      submitted: 'badge-info',
      partially_received: 'badge-warning',
      received: 'badge-success',
      posted: 'badge-success',
      draft: 'badge-secondary',
      sent: 'badge-info',
      expired: 'badge-secondary',
      paid: 'badge-success',
      partially_paid: 'badge-warning',
    };

    tbody.innerHTML = data.map((inv, i) => {
      const supplier = inv.supplier;
      const statusClass = statusBadges[inv.status] || 'badge-secondary';
      const statusLabel = STATUS_LABELS[inv.status] || inv.status;
      const total = Number(inv.total_amount) || 0;

      return `
        <tr style="border-bottom:1px solid #eee;">
          <td style="padding:0.5rem;text-align:center;color:#667eea;font-weight:bold;">${i + 1}</td>
          <td style="padding:0.5rem;">
            <div style="font-weight:bold;font-size:1rem;color:#667eea;">${esc(inv.order_number || '—')}</div>
          </td>
          <td style="padding:0.5rem;">
            <div style="font-weight:bold;">${supplier ? esc(supplier.name_ar || supplier.name) : '—'}</div>
          </td>
          <td style="padding:0.5rem;text-align:center;">
            <span class="badge ${statusClass} badge-sm">${statusLabel}</span>
          </td>
          <td style="padding:0.5rem;font-weight:bold;text-align:right;">${total.toFixed(2)} جنيه</td>
          <td style="padding:0.5rem;text-align:center;">
            <button class="btn small" onclick="viewInvoice('${inv.id}')" style="background:#667eea;color:white;">عرض</button>
          </td>
          <td style="padding:0.5rem;font-size:0.85rem;color:#666;text-align:center;">${inv.created_at ? new Date(inv.created_at).toLocaleDateString('ar-EG') : '—'}</td>
        </tr>
      `;
    }).join('');
  }

  // ===== عمليات الفاتورة =====

  window.viewInvoice = async function(invId) {
    navigate('/purchases/orders/' + invId);
  };

  window.receiveInvoice = async function(invId) {
    if (!confirm('هل تريد استلام فاتورة ' + invId + '؟')) return;

    try {
      const response = await fetch('/api/purchase_orders/' + invId + '/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouse_id: localStorage.getItem('session') ? JSON.parse(localStorage.getItem('session')).warehouse_id : null }),
      });

      const data = await response.json();

      if (data.error) {
        showNotification('خطأ: ' + data.error, 'error');
      } else {
        showNotification('تم استلام الفاتورة ✓', 'success');
        loadInvoices();
      }
    } catch (e) {
      console.error('Error:', e);
      showNotification('خطأ في الاتصال', 'error');
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
    .badge-secondary { background: #6b7280; color: white; }
    .badge-primary { background: #667eea; color: white; }
    .badge-sm { padding: 0.15rem 0.4rem; font-size: 0.75rem; }
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
