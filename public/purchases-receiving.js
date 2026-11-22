// ============================================================
// صفحة استلام البضائع - لعرض تفاصيل أمر الشراء والاستلام
// ============================================================

(function() {
  'use strict';

  let currentPOId = null;
  let currentPO = null;
  let items = [];
  let receivedItems = [];
  let grId = null;

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

  // ===== جلب بيانات أمر الشراء =====

  async function loadPurchaseOrder(poId) {
    currentPOId = poId;
    const client = getSupabaseClient();
    if (!client) {
      renderLoadError('تعذر الاتصال بقاعدة البيانات', 'لم يُنشأ عميل Supabase — تحقق من تحميل supabase-config.js ومفتاح anon.', null);
      return;
    }

    try {
      // جلب أمر الشراء
      const poRes = await client
        .from('purchase_orders')
        .select(`
          *,
          supplier:suppliers(id,name,name_ar,code,phone,email),
          items:purchase_order_items(
            *,
            product:products(id,name,name_ar,scientific_name,barcode,sku,dosage_form,strength,unit_of_measure,
              min_stock_level,max_stock_level,reorder_point,is_active)
          )
        `)
        .eq('id', poId)
        .single();

      if (poRes.data) {
        currentPO = poRes.data;
        items = poRes.data.items || [];
      } else {
        // لا يُترك الصفحة فارغة: نعرض السبب مع زر رجوع.
        renderLoadError(
          poRes.error ? 'تعذر جلب أمر الشراء' : 'أمر الشراء غير موجود',
          poRes.error ? describeError(poRes.error) : 'تحقق من رقم أمر الشراء أو أنه لم يُحذف.',
          poRes.error && (poRes.error.code || poRes.error.status)
        );
        return;
      }

      // جلب إيصالات الاستلام الموجودة
      const grRes = await client
        .from('goods_receipts')
        .select('*,items:goods_receipt_items(*)')
        .eq('purchase_order_id', poId)
        .order('created_at', { ascending: false })
        .limit(10);

      receivedItems = grRes.data || [];
      grId = receivedItems.length > 0 ? receivedItems[0].id : null;

      renderPage();
    } catch (e) {
      console.error('Error loading purchase order:', e);
      renderLoadError('تعذر جلب أمر الشراء', describeError(e), e && (e.code || e.status));
    }
  }

  // رسالة خطأ مقروءة بدل صفحة بيضاء عند فشل الجلب.
  function describeError(e) {
    if (!e) return 'سبب غير معروف';
    const parts = [e.message || String(e)];
    if (e.status) parts.push('HTTP ' + e.status);
    if (e.code) parts.push('(' + e.code + ')');
    if (e.details) parts.push(e.details);
    if (e.hint) parts.push('تلميح: ' + e.hint);
    return parts.filter(Boolean).join(' — ');
  }

  function renderLoadError(title, detail, code) {
    const host = document.getElementById('section-body');
    if (!host) {
      showNotification(title + ': ' + detail, 'error');
      return;
    }
    host.innerHTML = `
      <div class="card" style="border-right:4px solid #dc2626;text-align:right;">
        <h3 style="margin:0 0 0.5rem;color:#dc2626;">⚠️ ${esc(title)}</h3>
        <p class="muted" style="margin:0 0 0.75rem;">${esc(detail)}</p>
        ${code ? `<p class="muted" style="margin:0 0 0.75rem;font-size:0.8rem;">الرمز: ${esc(String(code))}</p>` : ''}
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          <a class="btn" data-link href="/purchases/receiving">🔙 رجوع لقائمة الاستلام</a>
          <a class="btn" data-link href="/purchases/orders">📋 أوامر الشراء</a>
          <button class="btn" type="button" id="reload-po-btn">🔄 إعادة المحاولة</button>
        </div>
      </div>`;
    const retry = document.getElementById('reload-po-btn');
    if (retry) retry.addEventListener('click', () => loadPurchaseOrder(currentPOId));
  }

  // ===== حساب الإحصائيات =====

  function getItemStatus(itemId) {
    if (!grId) return 'not_received';
    const gr = receivedItems.find(r => r.id === grId);
    if (!gr) return 'not_received';
    const ri = gr.items ? gr.items.find(i => i.purchase_order_item_id === itemId) : null;
    if (!ri) return 'not_received';
    return 'partial';
  }

  function getReceivedQty(itemId) {
    if (!grId) return 0;
    const gr = receivedItems.find(r => r.id === grId);
    if (!gr) return 0;
    const ri = gr.items ? (gr.items.find(i => i.purchase_order_item_id === itemId) || {}) : {};
    return Number(ri.quantity) || 0;
  }

  function getRemainingQty(item) {
    return Number(item.quantity) - getReceivedQty(item.id);
  }

  function getTotalReceived() {
    return items.reduce((sum, item) => sum + getReceivedQty(item.id), 0);
  }

  function getTotalOrdered() {
    return items.reduce((sum, item) => sum + Number(item.quantity), 0);
  }

  function getItemTotalPrice(item) {
    const qty = Number(item.quantity);
    const price = Number(item.unit_price);
    const discount = Number(item.discount_percent) || 0;
    return qty * price * (1 - discount / 100);
  }

  function getItemSubtotal(item) {
    const qty = Number(item.quantity);
    const price = Number(item.unit_price);
    const discount = Number(item.discount_percent) || 0;
    return qty * price * (1 - discount / 100);
  }

  function getReceivedSubtotal(itemId) {
    const receivedQty = getReceivedQty(itemId);
    const item = items.find(i => i.id === itemId);
    if (!item) return 0;
    const unitPrice = Number(item.unit_price);
    const discount = Number(item.discount_percent) || 0;
    return receivedQty * unitPrice * (1 - discount / 100);
  }

  function getOrderTotal() {
    return items.reduce((sum, item) => sum + getItemTotalPrice(item), 0);
  }

  function getReceivedTotal() {
    return items.reduce((sum, item) => sum + getReceivedSubtotal(item.id), 0);
  }

  function getRemainingTotal() {
    return getOrderTotal() - getReceivedTotal();
  }

  function getReceivedPercentage() {
    const ordered = getTotalOrdered();
    if (ordered === 0) return 0;
    return (getTotalReceived() / ordered) * 100;
  }

  // ===== رسم الصفحة =====

  function renderPage() {
    if (!currentPO) return;

    const sectionBody = document.getElementById('section-body');
    if (!sectionBody) return;

    const po = currentPO;

    // تحديد حالة الطلب
    let statusBadge = '';
    if (po.status === 'received' || po.status === 'posted') {
      statusBadge = '<span class="badge badge-success">تم الاستلام</span>';
    } else if (po.status === 'partially_received') {
      statusBadge = '<span class="badge badge-warning">مستلم جزئياً</span>';
    } else if (po.status === 'cancelled') {
      statusBadge = '<span class="badge badge-danger">ملغي</span>';
    } else if (po.status === 'pending_approval') {
      statusBadge = '<span class="badge badge-info">بانتظار الموافقة</span>';
    } else if (po.status === 'pending') {
      statusBadge = '<span class="badge badge-secondary">قيد الانتظار</span>';
    } else {
      statusBadge = '<span class="badge">' + esc(po.status) + '</span>';
    }

    const receivedPct = getReceivedPercentage();
    const isFullyReceived = receivedPct >= 100;
    const canReceive = !isFullyReceived &&
      (po.status === 'pending' || po.status === 'confirmed' ||
       po.status === 'pending_approval' || po.status === 'approved' ||
       po.status === 'ordered' || po.status === 'submitted');

    const supplier = po.supplier;

    // حساب التاريخ للميلاد
    const orderDate = po.order_date ? new Date(po.order_date) : new Date();
    const orderDateStr = orderDate.toLocaleDateString('ar-EG', { dateStyle: 'medium' });

    sectionBody.innerHTML = `
      <div class="card" style="animation:fadeIn 0.3s ease-in;">
        <!-- رأس الصفحة -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
          <div>
            <h1 style="margin:0;font-size:1.5rem;">📦 استلام بضائع</h1>
            <span class="muted" style="font-size:0.9rem;">${esc(po.order_number)}</span>
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <a class="btn" href="/purchases/orders/${po.id}/edit">✏️ تعديل</a>
            <button class="btn" onclick="navigate('/purchases/orders/${po.id}/receive')" style="display:${canReceive ? 'inline-block' : 'none'};">📥 استلام بضائع</button>
            <a class="btn" href="/purchases">🔙に戻る</a>
            <a class="btn" href="/purchases/orders/${po.id}">📋 عرض</a>
          </div>
        </div>

        <!-- معلومات الطلب -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:1rem;">
          <div class="card info-card">
            <div class="muted">رقم الأمر</div>
            <div style="font-size:1.2rem;font-weight:bold;color:#667eea;word-break:break-all;">${esc(po.order_number)}</div>
          </div>
          <div class="card info-card">
            <div class="muted">المورد</div>
            <div style="font-weight:bold;">${supplier ? esc(supplier.name_ar || supplier.name) : 'غير معروف'}</div>
            <div class="muted">${supplier ? esc(supplier.code || '') : ''}</div>
          </div>
          <div class="card info-card">
            <div class="muted">تاريخ الطلب</div>
            <div>${orderDateStr}</div>
          </div>
          <div class="card info-card">
            <div class="muted">الحالة</div>
            <div>${statusBadge}</div>
          </div>
          <div class="card info-card">
            <div class="muted">إجمالي الطلب</div>
            <div style="font-size:1.2rem;font-weight:bold;color:#dc2626;">${formatCurrency(getOrderTotal())} جنيه</div>
          </div>
          <div class="card info-card">
            <div class="muted">إجمالي المستلم</div>
            <div style="font-size:1.2rem;font-weight:bold;color:#16a34a;">${formatCurrency(getReceivedTotal())} جنيه</div>
          </div>
          <div class="card info-card">
            <div class="muted">الباقي للاستلام</div>
            <div style="font-size:1.2rem;font-weight:bold;color:#d97706;">${formatCurrency(getRemainingTotal())} جنيه</div>
          </div>
          <div class="card info-card">
            <div class="muted">الاستلام#${(getTotalReceived() / getTotalOrdered() * 100).toFixed(0)}%</div>
            <div style="font-size:1.2rem;font-weight:bold;">${getTotalReceived()} / ${getTotalOrdered()} وحدة</div>
          </div>
        </div>

        ${isFullyReceived ? `
          <div style="background:#fef3c7;border:2px solid #f59e0b;border-radius:4px;padding:0.75rem;margin-bottom:1rem;text-align:center;">
            <span class="muted">تم استلام جميع البضائع لهذا الأمر</span>
          </div>
        ` : `
          <div style="background:#e0f2fe;border:2px solid #38bdf8;border-radius:4px;padding:0.75rem;margin-bottom:1rem;text-align:center;color:#0369a1;">
            <span class="muted">${isFullyReceived ? 'تم استلام الكل' : 'باقي للاستلام: ' + (getTotalOrdered() - getTotalReceived()) + ' وحدة (' + (100 - receivedPct).toFixed(1) + '%)'}</span>
            ${canReceive ? '<button class="btn primary" style="margin-left:0.5rem;" onclick="startReceiving()">📥 استلام الآن</button>' : ''}
          </div>
        `}

        <!-- جدول البنود -->
        <div class="card" style="overflow:hidden;">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.75rem;background:#f8f9fa;border-bottom:2px solid #ddd;">
            <h3 style="margin:0;">📋 بنود الأمر</h3>
            <span class="muted">${items.length} صنف${items.length !== 1 ? 'ات' : ''}</span>
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
              <thead>
                <tr style="background:#f8f9fa;border-bottom:2px solid #ddd;text-align:right;">
                  <th style="padding:0.5rem;width:30px;">#</th>
                  <th style="padding:0.5rem;width:180px;">🧪 المنتج</th>
                  <th style="padding:0.5rem;width:80px;">الباركود / SKU</th>
                  <th style="padding:0.5rem;width:80px;">النوع</th>
                  <th style="padding:0.5rem;width:80px;">الصبغة</th>
                  <th style="padding:0.5rem;width:100px;">الوحدة</th>
                  <th style="padding:0.5rem;width:80px;">الكمية المطلوبة</th>
                  <th style="padding:0.5rem;width:100px;">الكمية المسلمة</th>
                  <th style="padding:0.5rem;width:100px;">الباقي</th>
                  <th style="padding:0.5rem;width:100px;">السعر الوحيدي</th>
                  <th style="padding:0.5rem;width:100px;">الإجمالي (طلب)</th>
                  <th style="padding:0.5rem;width:100px;">الإجمالي (استلام)</th>
                  <th style="padding:0.5rem;width:80px;">الخصم %</th>
                  <th style="padding:0.5rem;width:80px;">ملاحظات</th>
                  <th style="padding:0.5rem;width:80px;">إجراء</th>
                </tr>
              </thead>
              <tbody>
                ${items.map((item, index) => {
                  const receivedQty = getReceivedQty(item.id);
                  const remainingQty = getRemainingQty(item);
                  const isPartial = receivedQty > 0 && remainingQty > 0;
                  const isFullyReceivedItem = receivedQty >= Number(item.quantity);
                  const statusClass = isFullyReceivedItem ? 'text-success' : (isPartial ? 'text-warning' : 'text-muted');

                  return `
                    <tr style="border-bottom:1px solid #eee;">
                      <td style="padding:0.5rem;text-align:center;font-weight:bold;">${index + 1}</td>
                      <td style="padding:0.5rem;">
                        <div style="font-weight:bold;">${esc(item.product.name_ar || item.product.name)}</div>
                        <div class="muted" style="font-size:0.8rem;">${esc(item.product.scientific_name || '')}</div>
                      </td>
                      <td style="padding:0.5rem;font-size:0.85rem;">
                        <span class="badge badge-sm badge-secondary">${esc(item.product.sku || '—')}</span>
                        ${item.product.barcode ? ' <span class="muted">' + esc(item.product.barcode) + '</span>' : ''}
                      </td>
                      <td style="padding:0.5rem;font-size:0.85rem;">${esc(item.product.dosage_form || '')}</td>
                      <td style="padding:0.5rem;font-size:0.85rem;">${esc(item.product.strength || '')}</td>
                      <td style="padding:0.5rem;font-size:0.85rem;">${esc(item.product.unit_of_measure || 'وحدة')}</td>
                      <td style="padding:0.5rem;font-weight:bold;">${item.quantity}</td>
                      <td style="padding:0.5rem;font-weight:bold;color:#16a34a;">${receivedQty}</td>
                      <td style="padding:0.5rem;color:#d97706;font-weight:bold;">${remainingQty > 0 ? remainingQty : '<span class="text-success">■</span>'}</td>
                      <td style="padding:0.5rem;text-align:right;">${formatCurrency(item.unit_price)}</td>
                      <td style="padding:0.5rem;text-align:right;font-weight:bold;">${formatCurrency(getItemTotalPrice(item))}</td>
                      <td style="padding:0.5rem;text-align:right;color:#16a34a;">${formatCurrency(getReceivedSubtotal(item.id))}</td>
                      <td style="padding:0.5rem;">${item.discount_percent || 0}%</td>
                      <td style="padding:0.5rem;font-size:0.85rem;color:#666;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(item.notes || '')}">${esc(item.notes || '—')}</td>
                      <td style="padding:0.5rem;text-align:center;">
                        ${!isFullyReceivedItem && canReceive
                          ? '<button class="btn small" onclick="receiveItem(\'' + item.id + '\')">📥 استلام</button>'
                          : isFullyReceivedItem ? '<span class="badge badge-success badge-sm">تمت</span>' : '<span class="badge badge-sm">—</span>'}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
              <tfoot style="background:#f8f9fa;border-top:2px solid #ddd;">
                <tr>
                  <td colspan="10" style="padding:0.5rem;font-weight:bold;text-align:right;">الم totals:</td>
                  <td style="padding:0.5rem;font-weight:bold;text-align:right;color:#dc2626;">${getOrderTotal().toFixed(2)} جنيه</td>
                  <td style="padding:0.5rem;font-weight:bold;text-align:right;color:#16a34a;">${getReceivedTotal().toFixed(2)} جنيه</td>
                  <td colspan="2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <!-- ملاحظات الطلب -->
        ${po.notes ? `
          <div style="margin-top:0.75rem;padding:0.5rem 0.75rem;background:#fff3cd;border-left:4px solid #ffc107;border-radius:4px;">
            <strong style="color:#856404;">📝 ملاحظات الطلب:</strong>
            <p style="margin:0.25rem 0 0;color:#856404;">${esc(po.notes)}</p>
          </div>
        ` : ''}

        <!-- إصدارات الاستلام -->
        <div style="margin-top:1rem;">
          <h3 style="margin:0 0 0.5rem 0;">📦 إيصالات الاستلام (${receivedItems.length})</h3>
          ${receivedItems.map(gr => {
            const totalItems = (gr.items || []).length;
            const totalQty = (gr.items || []).reduce((sum, i) => sum + Number(i.quantity), 0);
            const totalAmount = (gr.items || []).reduce((sum, i) => {
              const item = items.find(it => it.id === i.purchase_order_item_id);
              if (!item) return sum;
              return sum + Number(i.quantity) * Number(item.unit_price) * (1 - (item.discount_percent || 0) / 100);
            }, 0);

            const createdAt = gr.created_at ? new Date(gr.created_at) : new Date();
            const createdStr = createdAt.toLocaleDateString('ar-EG', { dateStyle: 'medium' });

            return `
              <div style="border:1px solid #ddd;border-radius:4px;padding:0.75rem;margin-bottom:0.5rem;display:grid;grid-template-columns:1fr auto;gap:0.5rem;align-items:center;">
                <div>
                  <span class="badge badge-info badge-sm">GR-${String(gr.id).slice(0,8)}</span>
                  <span class="muted">| ${createdStr}</span>
                  <span class="muted">| ${totalItems} صنف ${totalItems !== 1 ? 'ات' : ''}</span>
                  <span class="muted">| ${totalQty} وحدة</span>
                  <span style="font-weight:bold;color:#16a34a;">| ${formatCurrency(totalAmount)} جنيه</span>
                </div>
                <button class="btn small" onclick="viewGrReceipt('${gr.id}')">عرض</button>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // ===== بدء استلام =====

  window.startReceiving = async function() {
    if (!currentPOId) return;

    const session = getCurrentSession();
    if (!session) {
      showNotification('يجب تسجيل الدخول أولاً', 'error');
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال بقاعدة البيانات', 'error');
      return;
    }

    showNotification('جارٍ إنشاء إيصال الاستلام...', 'info');

    try {
      // إنشاء إيصال استلام
      const now = new Date().toISOString();
      const grData = {
        id: crypto.randomUUID ? crypto.randomUUID() : 'GR-' + now.replace(/[^0-9]/g, '').slice(0, 14),
        purchase_order_id: currentPOId,
        warehouse_id: session.warehouse_id || currentPO?.warehouse_id,
        created_by: session.id,
        created_at: now,
        status: 'draft',
      };

      const { data: gr, error: grError } = await client
        .from('goods_receipts')
        .insert(grData)
        .select('id')
        .single();

      if (grError) {
        console.error('Error creating goods receipt:', grError);
        showNotification('خطأ: ' + (grError.message || 'فشل الإنشاء'), 'error');
        return;
      }

      grId = gr.id;
      showNotification('تم إنشاء إيصال الاستلام ' + grId, 'success');

      // إعادة تحميل البيانات
      await loadPurchaseOrder(currentPOId);
    } catch (e) {
      console.error('Error:', e);
      showNotification('خطأ: ' + (e.message || 'فشل العملية'), 'error');
    }
  };

  // ===== استلام صنف =====

  window.receiveItem = async function(itemId) {
    if (!currentPOId || !grId) {
      showNotification('يجب أولاً إنشاء إيصال استلام', 'warning');
      return;
    }

    const item = items.find(i => i.id === itemId);
    if (!item) {
      showNotification('الصنف غير موجود', 'error');
      return;
    }

    const remaining = getRemainingQty(item);
    if (remaining <= 0) {
      showNotification('هذا الصنف مستلم بالكامل بالفعل', 'info');
      return;
    }

    const session = getCurrentSession();
    if (!session) {
      showNotification('يجب تسجيل الدخول أولاً', 'error');
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال بقاعدة البيانات', 'error');
      return;
    }

    // إضافة صنف إلى إيصال الاستلام
    const { error } = await client
      .from('goods_receipt_items')
      .insert({
        id: crypto.randomUUID ? crypto.randomUUID() : 'GRIT-' + Date.now().toString(36),
        goods_receipt_id: grId,
        purchase_order_item_id: itemId,
        product_id: item.product_id,
        quantity: remaining,
        unit_price: item.unit_price,
        discount_percent: item.discount_percent || 0,
        created_at: new Date().toISOString(),
      });

    if (error) {
      console.error('Error adding item to receipt:', error);
      showNotification('خطأ: ' + (error.message || 'فشل الإضافة'), 'error');
      return;
    }

    showNotification('تم إضافة الصنف إلى الاستلام', 'success');
    await loadPurchaseOrder(currentPOId);
  };

  // ===== عرض إيصال الاستلام =====

  window.viewGrReceipt = async function(grId) {
    const session = getCurrentSession();
    if (!session) {
      showNotification('يجب تسجيل الدخول أولاً', 'error');
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال بقاعدة البيانات', 'error');
      return;
    }

    try {
      const res = await client
        .from('goods_receipts')
        .select(`
          *,
          items:goods_receipt_items(
            *,
            product:products(id,name,name_ar,scientific_name,barcode,sku,dosage_form,strength,unit_of_measure),
            purchase_order:purchase_orders(id,order_number)
          )
        `)
        .eq('id', grId)
        .single();

      if (!res.data) {
        showNotification('إيصال الاستلام غير موجود', 'error');
        return;
      }

      renderGRReceiptView(res.data);
    } catch (e) {
      console.error('Error:', e);
      showNotification('خطأ: ' + (e.message || 'فشل الجلب'), 'error');
    }
  };

  function renderGRReceiptView(gr) {
    const sectionBody = document.getElementById('section-body');
    if (!sectionBody) return;

    const createdAt = gr.created_at ? new Date(gr.created_at) : new Date();
    const createdStr = createdAt.toLocaleDateString('ar-EG', { dateStyle: 'medium' });

    const items = gr.items || [];
    const totalQty = items.reduce((sum, i) => sum + Number(i.quantity), 0);
    const totalAmount = items.reduce((sum, i) => {
      const price = Number(i.unit_price);
      const discount = Number(i.discount_percent) || 0;
      return sum + Number(i.quantity) * price * (1 - discount / 100);
    }, 0);

    const po = gr.purchase_order;

    sectionBody.innerHTML = `
      <div class="card" style="animation:fadeIn 0.3s ease-in;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0 0.75rem 0.75rem 0.75rem;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
          <div>
            <h1 style="margin:0;font-size:1.5rem;">📦 إيصال استلام</h1>
            <span class="muted">رقم: ${gr.id}</span>
          </div>
          <div style="display:flex;gap:0.5rem;">
            <button class="btn" onclick="printGrReceipt('${gr.id}')">🖨️ طباعة</button>
            <a class="btn" href="/purchases/orders/${po.id}">🔙 返回 بـ 2017-2018</a>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:1rem;">
          <div class="card info-card">
            <div class="muted">رقم الإيصالات</div>
            <div style="font-size:1.2rem;font-weight:bold;color:#667eea;">${esc(gr.id)}</div>
          </div>
          <div class="card info-card">
            <div class="muted">تاريخ الإصدار</div>
            <div style="font-weight:bold;">${createdStr}</div>
          </div>
          <div class="card info-card">
            <div class="muted">حالة</div>
            <div>${gr.status === 'posted' ? '<span class="badge badge-success">مُصدَّر</span>' : '<span class="badge badge-warning">قيد المراجعة</span>'}</div>
          </div>
          <div class="card info-card">
            <div class="muted">مخزن</div>
            <div>${gr.warehouse_id ? String(gr.warehouse_id).slice(0, 8) : '—'}</div>
          </div>
          <div class="card info-card">
            <div class="muted">إجمالي الأصناف</div>
            <div style="font-weight:bold;">${items.length} صنف${items.length !== 1 ? 'ات' : ''}</div>
          </div>
          <div class="card info-card">
            <div class="muted">إجمالي الكمية</div>
            <div style="font-weight:bold;">${totalQty} وحدة</div>
          </div>
          <div class="card info-card">
            <div class="muted">إجمالي المبلغ</div>
            <div style="font-size:1.2rem;font-weight:bold;color:#16a34a;">${formatCurrency(totalAmount)} جنيه</div>
          </div>
        </div>

        <div style="border:2px solid #38bdf8;border-radius:8px;padding:1rem;margin-bottom:1rem;background:#f0f9ff;">
          <h3 style="margin:0 0 0.5rem 0;color:#0369a1;">📋 تفاصيل الإيصال</h3>
          <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
            <thead>
              <tr style="background:#e0f2fe;text-align:right;">
                <th style="padding:0.5rem;">المنتج</th>
                <th style="padding:0.5rem;">الكمية</th>
                <th style="padding:0.5rem;">السعر</th>
                <th style="padding:0.5rem;">الخصم %</th>
                <th style="padding:0.5rem;">الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              ${items.map((item, i) => `
                <tr style="border-bottom:1px solid #eee;">
                  <td style="padding:0.5rem;">${esc(item.product.name_ar || item.product.name)}</td>
                  <td style="padding:0.5rem;">${item.quantity} ${item.product.unit_of_measure || 'وحدة'}</td>
                  <td style="padding:0.5rem;text-align:right;">${formatCurrency(item.unit_price)}</td>
                  <td style="padding:0.5rem;">${item.discount_percent || 0}%</td>
                  <td style="padding:0.5rem;text-align:right;font-weight:bold;color:#16a34a;">${formatCurrency(Number(item.quantity) * Number(item.unit_price) * (1 - (item.discount_percent || 0) / 100))}</td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot style="border-top:2px solid #38bdf8;">
              <tr>
                <td colspan="4" style="padding:0.5rem;font-weight:bold;text-align:right;">الم totals:</td>
                <td style="padding:0.5rem;font-weight:bold;text-align:right;color:#16a34a;font-size:1rem;">${formatCurrency(totalAmount)} جنيه</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style="margin-bottom:1rem;">
          <button class="btn success" onclick="postGrReceipt()" style="margin-right:0.5rem;">✅ تأكيد الإصدار (Post)</button>
          <button class="btn" onclick="navigate('/purchases/orders/${po.id}')">🔙 返回</button>
        </div>
      </div>
    `;
  }

  window.postGrReceipt = async function() {
    if (!grId) return;

    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال بقاعدة البيانات', 'error');
      return;
    }

    showNotification('جارٍ تأكيد إصدار الاستلام...', 'info');

    try {
      const { error } = await client
        .from('goods_receipts')
        .update({
          status: 'posted',
          updated_at: new Date().toISOString(),
        })
        .eq('id', grId);

      if (error) {
        console.error('Error:', error);
        showNotification('خطأ: ' + (error.message || 'فشل التأكيد'), 'error');
        return;
      }

      showNotification('تم تأكيد إصدار الاستلام', 'success');
      navigate('/purchases/orders/' + currentPOId);
    } catch (e) {
      console.error('Error:', e);
      showNotification('خطأ: ' + (e.message || 'فشل العملية'), 'error');
    }
  };

  // ===== طباعة إيصال الاستلام (بديل /api/receipts/:id/print) =====
  // تفتح النافذة فورًا قبل أي await، لأن المتصفح يحجب النوافذ التي تُفتح بعد انتظار غير متزامن.
  window.printGrReceipt = async function(grId) {
    const win = window.open('', '_blank');
    if (!win) {
      showNotification('المتصفح منع فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة لهذا الموقع', 'error');
      return;
    }

    win.document.write('<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>إيصال استلام</title></head><body style="font-family:system-ui,sans-serif;padding:1rem;">جارٍ تجهيز الإيصال…</body></html>');
    win.document.close();

    function fail(message) {
      try { win.close(); } catch (e) { /* أُغلقت يدويًا */ }
      showNotification(message, 'error');
    }

    const session = getCurrentSession();
    if (!session) {
      fail('يجب تسجيل الدخول أولاً');
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      fail('خطأ في الاتصال بقاعدة البيانات');
      return;
    }

    let gr = null;
    try {
      // نفس استعلام viewGrReceipt كي لا نفترض أعمدة أو علاقات غير موجودة في القاعدة.
      const res = await client
        .from('goods_receipts')
        .select(`
          *,
          items:goods_receipt_items(
            *,
            product:products(id,name,name_ar,scientific_name,barcode,sku,dosage_form,strength,unit_of_measure),
            purchase_order:purchase_orders(id,order_number)
          )
        `)
        .eq('id', grId)
        .single();

      if (res.error) {
        console.error('Error:', res.error);
        fail('خطأ: ' + (res.error.message || 'فشل الجلب'));
        return;
      }
      gr = res.data;
    } catch (e) {
      console.error('Error:', e);
      fail('خطأ في الاتصال');
      return;
    }

    if (!gr) {
      fail('إيصال الاستلام غير موجود');
      return;
    }

    const receiptItems = gr.items || [];
    const totalQty = receiptItems.reduce(function(sum, item) { return sum + Number(item.quantity || 0); }, 0);
    const totalAmount = receiptItems.reduce(function(sum, item) {
      const price = Number(item.unit_price || 0);
      const discount = Number(item.discount_percent) || 0;
      return sum + Number(item.quantity || 0) * price * (1 - discount / 100);
    }, 0);
    const orderNumber = (gr.purchase_order && gr.purchase_order.order_number) || '—';
    const createdStr = (gr.created_at ? new Date(gr.created_at) : new Date()).toLocaleDateString('ar-EG', { dateStyle: 'medium' });
    // draft و posted و cancelled كلها قيم ممكنة في goods_receipts.status؛ أي قيمة أخرى تُطبع كما هي.
    const statusLabel = { draft: 'مسودة', posted: 'مُصدَّر', cancelled: 'ملغى' }[gr.status] || gr.status || '—';

    const rows = receiptItems.map(function(item) {
      const product = item.product || {};
      const name = product.name_ar || product.name || '—';
      const unit = product.unit_of_measure || 'وحدة';
      const lineTotal = Number(item.quantity || 0) * Number(item.unit_price || 0) * (1 - (Number(item.discount_percent) || 0) / 100);
      return '<tr>'
        + '<td>' + esc(name) + '</td>'
        + '<td>' + esc(String(item.quantity || 0)) + ' ' + esc(unit) + '</td>'
        + '<td class="num">' + esc(formatCurrency(Number(item.unit_price || 0))) + '</td>'
        + '<td class="num">' + esc(String(item.discount_percent || 0)) + '%</td>'
        + '<td class="num strong">' + esc(formatCurrency(lineTotal)) + '</td>'
        + '</tr>';
    }).join('');

    const html = '<!DOCTYPE html>'
      + '<html lang="ar" dir="rtl"><head><meta charset="utf-8">'
      + '<title>إيصال استلام ' + esc(String(gr.id).slice(0, 8)) + '</title>'
      + '<style>'
      + '@page{size:A4;margin:12mm;}'
      + 'body{font-family:system-ui,"Segoe UI",Tahoma,sans-serif;color:#111;margin:0;padding:1rem;}'
      + 'h1{font-size:1.4rem;margin:0 0 0.25rem 0;}'
      + '.muted{color:#555;font-size:0.85rem;}'
      + '.head{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;border-bottom:2px solid #333;padding-bottom:0.75rem;margin-bottom:1rem;}'
      + '.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.5rem;margin-bottom:1rem;font-size:0.9rem;}'
      + '.meta div span{display:block;color:#555;font-size:0.78rem;}'
      + 'table{width:100%;border-collapse:collapse;font-size:0.9rem;}'
      + 'th,td{padding:0.45rem;border-bottom:1px solid #ddd;text-align:right;}'
      + 'thead th{background:#f1f5f9;border-bottom:2px solid #333;}'
      + '.num{text-align:left;font-variant-numeric:tabular-nums;}'
      + '.strong{font-weight:bold;}'
      + 'tfoot td{border-top:2px solid #333;font-weight:bold;}'
      + '.actions{margin-bottom:1rem;}'
      + '.actions button{font:inherit;padding:0.5rem 1rem;cursor:pointer;}'
      + '@media print{.no-print{display:none !important;}body{padding:0;}}'
      + '</style></head><body>'
      + '<div class="actions no-print"><button type="button" onclick="window.print()">🖨️ طباعة</button></div>'
      + '<div class="head"><div><h1>📦 إيصال استلام</h1>'
      + '<div class="muted">رقم الإيصال: ' + esc(String(gr.id)) + '</div></div>'
      + '<div class="muted">أمر الشراء: ' + esc(String(orderNumber)) + '</div></div>'
      + '<div class="meta">'
      + '<div><span>التاريخ</span>' + esc(createdStr) + '</div>'
      + '<div><span>الحالة</span>' + esc(statusLabel) + '</div>'
      + '<div><span>المخزن</span>' + esc(gr.warehouse_id ? String(gr.warehouse_id).slice(0, 8) : '—') + '</div>'
      + '<div><span>عدد الأصناف</span>' + esc(String(receiptItems.length)) + '</div>'
      + '<div><span>إجمالي الكمية</span>' + esc(String(totalQty)) + '</div>'
      + '</div>'
      + '<table><thead><tr><th>المنتج</th><th>الكمية</th><th class="num">السعر</th><th class="num">الخصم %</th><th class="num">الإجمالي</th></tr></thead>'
      + '<tbody>' + (rows || '<tr><td colspan="5">لا توجد أصناف</td></tr>') + '</tbody>'
      + '<tfoot><tr><td colspan="4">إجمالي المبلغ</td><td class="num">' + esc(formatCurrency(totalAmount)) + ' جنيه</td></tr></tfoot>'
      + '</table></body></html>';

    win.document.write(html);
    win.document.close();
    setTimeout(function() {
      try { win.focus(); win.print(); } catch (e) { console.error('print failed:', e); }
    }, 150);
  };

  // ===== عرض واحد =====

  async function renderOrderDetail(orderId) {
    currentPOId = orderId;
    await loadPurchaseOrder(orderId);
  }

  // ===== بدء الصفحة =====

  const currentPath = window.SlamtakRoute.current();
  const orderMatch = currentPath.match(/^\/purchases\/orders\/(.+)$/);
  if (orderMatch) {
    renderOrderDetail(orderMatch[1]);
  }

})();
