// ============================================================
// صفحة استلام بضائع بدون أمر شراء مسبق
// ============================================================

(function() {
  'use strict';

  let items = [];
  let suppliers = [];
  let productsCache = [];

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

  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
  if (!currentPath.startsWith('/purchases/receiving') || currentPath === '/purchases/orders/:id/receive') return;

  const sectionBody = document.getElementById('section-body');
  if (!sectionBody) return;

  function generateRowId() {
    return 'row_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  function addEmptyRow() {
    items.push({
      rowId: generateRowId(),
      product_id: '',
      name: '',
      name_ar: '',
      sku: '',
      barcode: '',
      dosage_form: '',
      strength: '',
      unit_of_measure: '',
      quantity: 0,
      batch_number: '',
      expiry_date: '',
      unit_price: 0,
      notes: '',
    });
    renderItemsTable();
    setTimeout(() => {
      const inputs = document.querySelectorAll('.receive-quantity-input');
      if (inputs.length > 0) inputs[inputs.length - 1].focus();
    }, 50);
  }

  function removeItem(rowId) {
    items = items.filter(i => i.rowId !== rowId);
    renderItemsTable();
  }

  window.addEmptyRow = addEmptyRow;
  window.removeItem = removeItem;

  function calculateLineTotal(item) {
    return Number(item.quantity || 0) * Number(item.unit_price || 0);
  }

  function renderItemsTable() {
    const tbody = document.getElementById('receive-items-body');
    if (!tbody) return;

    if (items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="muted" style="text-align:center;padding:2rem;">
            لا توجد أصناف للاستلام. اضغط <kbd>➕ إضافة صنف</kbd> أو ابحث عن دواء.
          </td>
        </tr>
      `;
      updateTotal();
      return;
    }

    tbody.innerHTML = items.map((item, index) => `
      <tr data-row-id="${item.rowId}" style="border-bottom:1px solid #eee;">
        <td style="padding:0.4rem;text-align:center;font-weight:bold;color:#667eea;">${index + 1}</td>
        <td style="padding:0.4rem;">
          <input type="text" class="receive-sku-input" value="${esc(item.sku || item.barcode || '')}"
            style="width:100%;padding:0.3rem;border:1px solid #ddd;border-radius:3px;font-size:0.85rem;"
            data-row-id="${item.rowId}" placeholder="باركود/SKU"
            onchange="handleReceiveSkuChange(this)">
          <input type="hidden" class="receive-product-id" value="${item.product_id || ''}" data-row-id="${item.rowId}">
        </td>
        <td style="padding:0.4rem;">
          <div style="font-weight:bold;">${esc(item.name_ar || item.name || '— بدون منتج —')}</div>
          <div class="muted" style="font-size:0.8rem;">${item.dosage_form || ''}${item.strength ? ' ' + item.strength : ''}</div>
        </td>
        <td style="padding:0.4rem;">
          <input type="text" class="receive-batch-input" value="${esc(item.batch_number || '')}"
            style="width:100%;padding:0.3rem;border:1px solid #ddd;border-radius:3px;font-size:0.85rem;"
            data-row-id="${item.rowId}" placeholder="رقم التشغيلة">
        </td>
        <td style="padding:0.4rem;">
          <input type="date" class="receive-expiry-input" value="${item.expiry_date || ''}"
            style="width:100%;padding:0.3rem;border:1px solid #ddd;border-radius:3px;font-size:0.85rem;"
            data-row-id="${item.rowId}">
        </td>
        <td style="padding:0.4rem;font-size:0.85rem;">${esc(item.unit_of_measure || 'وحدة')}</td>
        <td style="padding:0.4rem;">
          <input type="number" class="receive-quantity-input" value="${item.quantity || 0}"
            style="width:100%;padding:0.3rem;border:1px solid #ddd;border-radius:3px;font-size:0.85rem;text-align:right;"
            data-row-id="${item.rowId}" min="0" step="0.01" oninput="updateReceiveRow(this)">
        </td>
        <td style="padding:0.4rem;">
          <input type="number" class="receive-price-input" value="${item.unit_price || 0}"
            style="width:100%;padding:0.3rem;border:1px solid #ddd;border-radius:3px;font-size:0.85rem;text-align:right;"
            data-row-id="${item.rowId}" min="0" step="0.01" oninput="updateReceiveRow(this)">
        </td>
        <td style="padding:0.4rem;font-weight:bold;color:#16a34a;">
          ${formatCurrency(calculateLineTotal(item))} جنيه
        </td>
        <td style="padding:0.4rem;text-align:center;">
          <button class="btn small" style="background:#dc2626;color:white;"
            onclick="removeItem('${item.rowId}')">🗑️</button>
        </td>
      </tr>
    `).join('');

    updateTotal();
  }

  window.updateReceiveRow = function(input) {
    const rowId = input.dataset.rowId;
    const item = items.find(i => i.rowId === rowId);
    if (!item) return;

    if (input.classList.contains('receive-quantity-input')) {
      item.quantity = Number(input.value) || 0;
    } else if (input.classList.contains('receive-price-input')) {
      item.unit_price = Number(input.value) || 0;
    }

    const row = input.closest('tr');
    if (row) {
      const cells = row.querySelectorAll('td');
      if (cells[8]) cells[8].textContent = formatCurrency(calculateLineTotal(item)) + ' جنيه';
    }
    updateTotal();
  };

  function updateTotal() {
    const total = items.reduce((sum, i) => sum + calculateLineTotal(i), 0);
    const el = document.getElementById('receive-total');
    if (el) el.textContent = formatCurrency(total);
  }

  async function handleReceiveSkuChange(input) {
    const sku = input.value.trim();
    if (!sku) return;

    const rowId = input.dataset.rowId;
    const item = items.find(i => i.rowId === rowId);
    if (!item) return;

    const results = await searchProducts(sku);
    if (results.length > 0) {
      const product = results[0];
      item.product_id = product.id;
      item.name = product.name;
      item.name_ar = product.name_ar || product.name;
      item.sku = product.sku || '';
      item.barcode = product.barcode || '';
      item.dosage_form = product.dosage_form || '';
      item.strength = product.strength || '';
      item.unit_of_measure = product.unit_of_measure || '';

      const row = input.closest('tr');
      if (row) {
        const nameCell = row.querySelector('td:nth-child(3)');
        if (nameCell) {
          nameCell.innerHTML = `
            <div style="font-weight:bold;">${esc(item.name_ar || item.name)}</div>
            <div class="muted" style="font-size:0.8rem;">${item.dosage_form || ''}${item.strength ? ' ' + item.strength : ''}</div>
          `;
        }
      }
      showNotification('تم العثور على: ' + (item.name_ar || item.name), 'success');
    } else {
      showNotification('لا يوجد منتج بهذا الباركود أو الـ SKU', 'warning');
    }
  }

  window.handleReceiveSkuChange = handleReceiveSkuChange;

  async function searchProducts(query) {
    if (!query || query.trim() === '') return [];
    const client = getSupabaseClient();
    if (!client) return [];

    const exactRes = await client
      .from('products')
      .select('id,name,name_ar,scientific_name,barcode,sku,dosage_form,strength,unit_of_measure,min_stock_level,max_stock_level,is_active')
      .or(`barcode.eq.${query.trim()},sku.eq.${query.trim()}`)
      .eq('is_active', true)
      .limit(5);

    if (exactRes.data && exactRes.data.length > 0) return exactRes.data;

    const searchRes = await client
      .from('products')
      .select('id,name,name_ar,scientific_name,barcode,sku,dosage_form,strength,unit_of_measure')
      .ilike('name_ar', '%' + query.trim() + '%')
      .eq('is_active', true)
      .limit(10);

    if (searchRes.data && searchRes.data.length > 0) return searchRes.data;

    const enRes = await client
      .from('products')
      .select('id,name,name_ar,scientific_name,barcode,sku,dosage_form,strength,unit_of_measure')
      .ilike('name', '%' + query.trim() + '%')
      .eq('is_active', true)
      .limit(10);

    return (enRes.data && enRes.data.length > 0) ? enRes.data : [];
  }

  async function loadSuppliers() {
    const client = getSupabaseClient();
    if (!client) return;

    try {
      const res = await client
        .from('suppliers')
        .select('id,name,name_ar,code')
        .eq('is_active', true)
        .order('name')
        .limit(200);

      suppliers = res.data || [];
      const select = document.getElementById('receive-supplier-select');
      if (select) {
        select.innerHTML = '<option value="">-- اختر مورد --</option>' +
          suppliers.map(s =>
            `<option value="${s.id}">${esc(s.name_ar || s.name)} (${s.code || 'بدون كود'})</option>`
          ).join('');
      }
    } catch (e) {}
  }

  async function submitReceiving() {
    if (items.filter(i => i.product_id).length === 0) {
      showNotification('يجب إضافة أصناف للاستلام', 'warning');
      return;
    }

    const supplierId = document.getElementById('receive-supplier-select')?.value;
    if (!supplierId) {
      showNotification('يجب اختيار مورد', 'warning');
      return;
    }

    const session = getCurrentSession();
    if (!session) {
      showNotification('يجب تسجيل الدخول أولاً', 'error');
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال', 'error');
      return;
    }

    try {
      showNotification('جارٍ إنشاء إيصال الاستلام...', 'info');

      const grId = crypto.randomUUID ? crypto.randomUUID() : 'GR-NO-PO-' + Date.now().toString(36);

      await client.from('goods_receipts').insert({
        id: grId,
        warehouse_id: session.warehouse_id,
        supplier_id: supplierId,
        purchase_order_id: null,
        created_by: session.id,
        created_at: new Date().toISOString(),
        status: 'draft',
        notes: (document.getElementById('receive-notes')?.value || '').trim() || null,
      });

      const validItems = items.filter(i => i.product_id && Number(i.quantity) > 0);

      for (const item of validItems) {
        await client.from('goods_receipt_items').insert({
          id: crypto.randomUUID ? crypto.randomUUID() : 'GRIT-' + Date.now().toString(36),
          goods_receipt_id: grId,
          product_id: item.product_id,
          quantity: Number(item.quantity),
          batch_number: item.batch_number || null,
          expiry_date: item.expiry_date || null,
          unit_price: Number(item.unit_price) || 0,
          created_at: new Date().toISOString(),
        });
      }

      // تحديث المخزون
      for (const item of validItems) {
        const inventoryRes = await client
          .from('inventory')
          .select('id')
          .eq('product_id', item.product_id)
          .eq('warehouse_id', session.warehouse_id)
          .single();

        if (inventoryRes.data) {
          const currentQty = Number(inventoryRes.data.quantity) || 0;
          await client.from('inventory').update({
            quantity: currentQty + Number(item.quantity),
            last_counted_at: new Date().toISOString(),
          }).eq('id', inventoryRes.data.id);
        } else {
          await client.from('inventory').insert({
            id: crypto.randomUUID ? crypto.randomUUID() : 'INV-' + Date.now().toString(36),
            product_id: item.product_id,
            warehouse_id: session.warehouse_id,
            quantity: Number(item.quantity),
            unit_of_measure: item.unit_of_measure || 'piece',
            last_counted_at: new Date().toISOString(),
          });
        }

        // سجل حركة
        await client.from('inventory_movements').insert({
          id: crypto.randomUUID ? crypto.randomUUID() : 'IME-' + Date.now().toString(36),
          inventory_id: (inventoryRes.data && inventoryRes.data.id) || null,
          product_id: item.product_id,
          warehouse_id: session.warehouse_id,
          movement_type: 'in',
          quantity: Number(item.quantity),
          unit_of_measure: item.unit_of_measure || 'piece',
          source_type: 'goods_receipt',
          source_id: grId,
          reference_number: grId,
          created_by: session.id,
          created_at: new Date().toISOString(),
          notes: item.notes || null,
        });
      }

      showNotification(`تم إنشاء إيصال الاستلام ${grId} ✓`, 'success');
      navigate('/purchases/orders/' + grId + '/receive');
    } catch (e) {
      console.error('Error:', e);
      showNotification('خطأ: ' + (e.message || 'فشل العملية'), 'error');
    }
  }

  window.submitReceiving = submitReceiving;

  function renderPage() {
    sectionBody.innerHTML = `
      <div class="card" style="animation:fadeIn 0.3s ease-in;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <h1 style="margin:0;font-size:1.5rem;">📥 استلام بضائع (بدون أمر شراء)</h1>
          <a class="btn" href="/purchases">🔙 返回</a>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
          <div>
            <label class="form-label" style="font-weight:bold;">المورد <span style="color:red;">*</span></label>
            <select id="receive-supplier-select" class="form-select"
              style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;">
              <option value="">-- اختر مورد --</option>
            </select>
          </div>
          <div>
            <label class="form-label" style="font-weight:bold;">تاريخ الاستلام</label>
            <input type="date" id="receive-date"
              style="padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;"
              value="${new Date().toISOString().substr(0, 10)}">
          </div>
          <div>
            <label class="form-label" style="font-weight:bold;">تاريخ الإنهاء (ف필요시)</label>
            <input type="date" id="receive-date2"
              style="padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;">
          </div>
          <div>
            <label class="form-label" style="font-weight:bold;">طريقة الاستلام</label>
            <select id="receive-method" class="form-select"
              style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;">
              <option value="direct">تسليم مباشر</option>
              <option value="delivery">توصيل</option>
              <option value="pickup">استلام من المستودع</option>
            </select>
          </div>
        </div>

        <div style="background:#e0f2fe;border:2px solid #38bdf8;border-radius:8px;padding:0.75rem;margin-bottom:1rem;">
          <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
            <input type="text" id="receive-product-search" placeholder="🔍 ابحث عن دواء بالباركود أو الاسم..."
              style="flex:1;min-width:200px;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;"
              onkeyup="if(event.key==='Enter')handleReceiveSkuChange(this)">
            <button class="btn" onclick="addEmptyRow()">➕ إضافة صنف</button>
            <button class="btn" onclick="document.getElementById('receive-product-search').value=''">✖️</button>
          </div>
        </div>

        <div style="background:white;border:1px solid #ddd;border-radius:8px;overflow:hidden;margin-bottom:1rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.75rem;background:#f8f9fa;border-bottom:2px solid #ddd;">
            <h3 style="margin:0;">📋 الأصناف للاستلام</h3>
            <span class="muted">${items.length} صنف${items.length !== 1 ? 'ات' : ''}</span>
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
              <thead>
                <tr style="background:#f8f9fa;border-bottom:2px solid #ddd;text-align:right;">
                  <th style="padding:0.5rem;width:30px;">#</th>
                  <th style="padding:0.5rem;width:120px;">🎯 باركود/SKU</th>
                  <th style="padding:0.5rem;width:150px;">🧪 المنتج</th>
                  <th style="padding:0.5rem;width:100px;">📦 تشغيلة</th>
                  <th style="padding:0.5rem;width:100px;">📅 الصلاحية</th>
                  <th style="padding:0.5rem;width:80px;">الوحدة</th>
                  <th style="padding:0.5rem;width:80px;">الكمية</th>
                  <th style="padding:0.5rem;width:100px;">💰 السعر</th>
                  <th style="padding:0.5rem;width:100px;">💵 الإجمالي</th>
                  <th style="padding:0.5rem;width:50px;">🗑️</th>
                </tr>
              </thead>
              <tbody id="receive-items-body"></tbody>
            </table>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.75rem;background:#f8f9fa;border-top:2px solid #ddd;">
            <span class="muted">إجمالي الاستلام: <strong id="receive-total">0.00</strong> جنيه</span>
            <div style="display:flex;gap:0.5rem;">
              <button class="btn" onclick="clearAllItems()">🗑️ مسح الكل</button>
              <button class="btn primary" onclick="submitReceiving()" style="background:#667eea;">📥 تسجيل الاستلام</button>
            </div>
          </div>
        </div>

        <div style="margin-bottom:1rem;">
          <label class="form-label" style="font-weight:bold;">ملاحظات (اختياري)</label>
          <textarea id="receive-notes" rows="2"
            style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;resize:vertical;" placeholder="أي ملاحظات إضافية..."></textarea>
        </div>

        <div class="card" style="background:#f0f9ff;border:2px solid #38bdf8;border-radius:8px;padding:0.75rem;text-align:center;color:#0369a1;">
          <strong>💡 نصيحة:</strong> إذا كان لديك أمر شراء موجود، استخدم مسار /purchases/orders/:id/receive للاستلام المرتبط.
        </div>
      </div>
    `;

    loadSuppliers();
    addEmptyRow();
  }

  window.clearAllItems = function() {
    if (confirm('مسح جميع الأصناف؟')) {
      items = [];
      renderItemsTable();
    }
  };

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

  const style = document.createElement('style');
  style.textContent = `
    .notification { animation: slideIn 0.3s ease-out; }
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .form-label { display:block; margin-bottom:0.25rem; font-weight:bold; color:#333; font-size:0.9rem; }
    .form-input, .form-select { padding:0.5rem; border:1px solid #ddd; border-radius:4px; font-size:1rem; }
    .form-input:focus, .form-select:focus { border-color:#667eea; outline:none; box-shadow:0 0 0 2px rgba(102,126,234,0.2); }
  `;
  document.head.appendChild(style);

  function navigate(path) {
    if (typeof window.safeNavigate === 'function') safeNavigate(path);
    else window.location.href = path;
  }

  renderPage();

})();
