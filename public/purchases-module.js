// ============================================================
// نظام المشتريات فائق السرعة - وحدة مستقلة
// يُضاف إلى index.html بعد module-pages.js وراء app.js
// ============================================================

(function() {
  'use strict';

  // --- الثوابت ---
  const STATUS_LABELS = {
    pending: "قيد الانتظار",
    confirmed: "مؤكد",
    completed: "تم التنفيذ",
    cancelled: "ملغي",
    draft: "مسودة",
    pending_approval: "بانتظار الموافقة",
    approved: "معتمد",
    rejected: "مرفوض",
    ordered: "تم الطلب",
    submitted: "مُقدَّم",
    selected: "مُختار",
    expired: "منتهي",
    sent: "مُرسل",
    partially_received: "مستلم جزئياً",
    received: "مستلم",
    paid: "مدفوعة",
    partially_paid: "مدفوعة جزئياً",
  };

  // --- الحالة المحلية ---
  let purchaseEntries = []; // [{product_id, name, name_ar, sku, barcode, dosage_form, strength, unit_of_measure, quantity, unit_price, discount_percent, batch_number, expiry_date, notes, rowId}]
  let selectedSupplierId = null;
  let suppliers = [];
  let productsCache = []; // cache للبحث

  // --- العناصر ---
  const appEl = document.getElementById('app');
  let sectionBody = null;

  // --- دوال مساعدة ---

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/[<>"'&]/g, function(c) {
      return { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c];
    });
  }

  function formatCurrency(amount) {
    return (amount || 0).toFixed(2);
  }

  function generateRowId() {
    return 'row_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
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

  // --- البحث عن منتج ---

  async function searchProducts(query) {
    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ: لا يمكن الاتصال بقاعدة البيانات', 'error');
      return [];
    }

    if (!query || query.trim() === '') return [];

    // أولوية: بحث بالباركود أو SKU (دقيق)
    const barcodeQuery = query.trim();
    const exactRes = await client
      .from('products')
      .select('id,name,name_ar,scientific_name,barcode,sku,dosage_form,strength,unit_of_measure,min_stock_level,max_stock_level,reorder_point,is_active')
      .or(`barcode.eq.${barcodeQuery},sku.eq.${barcodeQuery}`)
      .eq('is_active', true)
      .limit(10);

    if (exactRes.data && exactRes.data.length > 0) {
      return exactRes.data;
    }

    // بحث نصي بالاسم أو الاسم العلمي
    const searchRes = await client
      .from('products')
      .select('id,name,name_ar,scientific_name,barcode,sku,dosage_form,strength,unit_of_measure,min_stock_level,max_stock_level,reorder_point,is_active')
      .textSearch('name_ar', query)
      .eq('is_active', true)
      .limit(15);

    if (searchRes.data && searchRes.data.length > 0) {
      return searchRes.data;
    }

    // بحث بديل بالاسم الإنجليزي
    const enRes = await client
      .from('products')
      .select('id,name,name_ar,scientific_name,barcode,sku,dosage_form,strength,unit_of_measure,min_stock_level,max_stock_level,reorder_point,is_active')
      .textSearch('name', query)
      .eq('is_active', true)
      .limit(15);

    return (enRes.data && enRes.data.length > 0) ? enRes.data : [];
  }

  async function searchProductByBarcode(barcode) {
    const client = getSupabaseClient();
    if (!client) return [];

    const res = await client
      .from('products')
      .select('id,name,name_ar,scientific_name,barcode,sku,dosage_form,strength,unit_of_measure,min_stock_level,max_stock_level,is_active')
      .eq('barcode', barcode)
      .eq('is_active', true)
      .limit(5);

    return res.data || [];
  }

  // --- جلب الموردين ---

  async function loadSuppliers() {
    const client = getSupabaseClient();
    if (!client) return;

    try {
      const res = await client
        .from('suppliers')
        .select('id,name,name_ar,code,phone,email')
        .eq('is_active', true)
        .order('name')
        .limit(100);

      suppliers = res.data || [];
      renderSupplierSelect();
    } catch (e) {
      console.error('Error loading suppliers:', e);
      showNotification('خطأ في جلب قائمة الموردين', 'error');
    }
  }

  function renderSupplierSelect() {
    const select = document.getElementById('supplier-select');
    if (!select) return;

    const currentVal = select.value;
    select.innerHTML = '<option value="">-- اختر مورد --</option>' +
      suppliers.map(s =>
        `<option value="${s.id}" ${s.id === currentVal ? 'selected' : ''}>
          ${esc(s.name_ar || s.name)} (${s.code || 'بدون كود'})
        </option>`
      ).join('');
  }

  // --- جدول إدخال المشتريات السريع ---

  function renderPurchaseTable() {
    const tbody = document.getElementById('purchase-entries-body');
    if (!tbody) return;

    if (purchaseEntries.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="11" class="muted" style="text-align:center;padding:2rem;">
            no rows yet. Add a row below or search for a product above.
          </td>
        </tr>`;
      updateTotal();
      return;
    }

    tbody.innerHTML = purchaseEntries.map((entry, index) => `
      <tr data-row-id="${entry.rowId}" style="border-bottom:1px solid #eee;">
        <td style="padding:0.4rem;text-align:center;font-weight:bold;color:#667eea;">${index + 1}</td>
        <td style="padding:0.4rem;text-align:right;">
          <input type="text" class="entry-sku-input" value="${esc(entry.sku || entry.barcode || '')}" placeholder="SKU / باركود"
            style="width:100%;padding:0.3rem;border:1px solid #ddd;border-radius:3px;font-size:0.85rem;"
            data-row-id="${entry.rowId}">
          <input type="hidden" class="entry-product-id" value="${entry.product_id || ''}" data-row-id="${entry.rowId}">
        </td>
        <td style="padding:0.4rem;text-align:right;font-weight:bold;">
          ${esc(entry.name_ar || entry.name || '— بدون اسم')}
          <div class="muted" style="font-size:0.8rem;">${entry.dosage_form || ''}${entry.strength ? ' ' + entry.strength : ''}</div>
        </td>
        <td style="padding:0.4rem;text-align:right;">
          <input type="text" class="entry-unit-input" value="${esc(entry.unit_of_measure || '')}"
            style="width:100%;padding:0.3rem;border:1px solid #ddd;border-radius:3px;font-size:0.85rem;"
            data-row-id="${entry.rowId}" disabled>
        </td>
        <td style="padding:0.4rem;text-align:right;">
          <input type="number" class="entry-quantity-input" value="${entry.quantity || 0}"
            style="width:100%;padding:0.3rem;border:1px solid #ddd;border-radius:3px;font-size:0.85rem;text-align:right;"
            data-row-id="${entry.rowId}" min="0" step="0.01">
        </td>
        <td style="padding:0.4rem;text-align:right;">
          <input type="number" class="entry-price-input" value="${entry.unit_price || 0}"
            style="width:100%;padding:0.3rem;border:1px solid #ddd;border-radius:3px;font-size:0.85rem;text-align:right;"
            data-row-id="${entry.rowId}" min="0" step="0.01">
        </td>
        <td style="padding:0.4rem;text-align:right;">
          <input type="number" class="entry-discount-input" value="${entry.discount_percent || 0}"
            style="width:100%;padding:0.3rem;border:1px solid #ddd;border-radius:3px;font-size:0.85rem;text-align:right;"
            data-row-id="${entry.rowId}" min="0" max="100" step="0.5">
          <span class="muted" style="font-size:0.75rem;">%</span>
        </td>
        <td style="padding:0.4rem;text-align:right;font-weight:bold;">
          ${formatCurrency(calculateLineTotal(entry))}
        </td>
        <td style="padding:0.4rem;text-align:right;">
          <input type="text" class="entry-batch-input" value="${esc(entry.batch_number || '')}"
            style="width:100%;padding:0.3rem;border:1px solid #ddd;border-radius:3px;font-size:0.85rem;"
            data-row-id="${entry.rowId}" placeholder="تشغيلة">
        </td>
        <td style="padding:0.4rem;text-align:right;">
          <input type="date" class="entry-expiry-input" value="${entry.expiry_date || ''}"
            style="width:100%;padding:0.3rem;border:1px solid #ddd;border-radius:3px;font-size:0.85rem;"
            data-row-id="${entry.rowId}">
        </td>
        <td style="padding:0.4rem;text-align:center;">
          <button class="btn small remove-row-btn" data-row-id="${entry.rowId}"
            style="background:#dc2626;color:white;padding:0.2rem 0.5rem;">🗑️</button>
        </td>
      </tr>
    `).join('');

    // ربط الأحداث
    tbody.querySelectorAll('.entry-quantity-input').forEach(inp => {
      inp.addEventListener('input', function() {
        updateRowFromInput(this);
      });
    });
    tbody.querySelectorAll('.entry-price-input').forEach(inp => {
      inp.addEventListener('input', function() {
        updateRowFromInput(this);
      });
    });
    tbody.querySelectorAll('.entry-discount-input').forEach(inp => {
      inp.addEventListener('input', function() {
        updateRowFromInput(this);
      });
    });
    tbody.querySelectorAll('.remove-row-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const rowId = this.dataset.rowId;
        removeRow(rowId);
      });
    });
    tbody.querySelectorAll('.entry-sku-input').forEach(inp => {
      inp.addEventListener('change', function() {
        handleSkuChange(this);
      });
    });

    updateTotal();
  }

  function calculateLineTotal(entry) {
    const qty = Number(entry.quantity) || 0;
    const price = Number(entry.unit_price) || 0;
    const discount = Number(entry.discount_percent) || 0;
    return qty * price * (1 - discount / 100);
  }

  function updateTotal() {
    const total = purchaseEntries.reduce((sum, e) => sum + calculateLineTotal(e), 0);
    const el = document.getElementById('purchase-total-amount');
    if (el) el.textContent = formatCurrency(total);
  }

  function addEmptyRow() {
    const newEntry = {
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
      unit_price: 0,
      discount_percent: 0,
      batch_number: '',
      expiry_date: '',
      notes: '',
    };
    purchaseEntries.push(newEntry);
    renderPurchaseTable();
    // التركيز على حقل SKU الجديد
    setTimeout(() => {
      const inputs = document.querySelectorAll('.entry-sku-input');
      if (inputs.length > 0) {
        inputs[inputs.length - 1].focus();
      }
    }, 50);
  }

  function removeRow(rowId) {
    purchaseEntries = purchaseEntries.filter(e => e.rowId !== rowId);
    renderPurchaseTable();
  }

  function updateRowFromInput(input) {
    const rowId = input.dataset.rowId;
    const entry = purchaseEntries.find(e => e.rowId === rowId);
    if (!entry) return;

    if (input.classList.contains('entry-quantity-input')) {
      entry.quantity = Number(input.value) || 0;
    } else if (input.classList.contains('entry-price-input')) {
      entry.unit_price = Number(input.value) || 0;
    } else if (input.classList.contains('entry-discount-input')) {
      entry.discount_percent = Number(input.value) || 0;
    }

    // تحديث الخلية المحسوبة
    const row = input.closest('tr');
    if (row) {
      const totalCells = row.querySelectorAll('td');
      // الخلية الثامنة (الفهرس 7) هي الإجمالي
      if (totalCells[7]) {
        totalCells[7].textContent = formatCurrency(calculateLineTotal(entry));
      }
    }
    updateTotal();
  }

  async function handleSkuChange(input) {
    const sku = input.value.trim();
    if (!sku) return;

    const rowId = input.dataset.rowId;
    const entry = purchaseEntries.find(e => e.rowId === rowId);
    if (!entry) return;

    // بحث عن المنتج
    const results = await searchProductByBarcode(sku);
    if (results.length === 0) {
      // محاولة بحث بالاسم
      const nameResults = await searchProducts(sku);
      if (nameResults.length > 0) {
        const bestMatch = nameResults[0];
        fillEntryFromProduct(entry, bestMatch);
        showNotification(`تم العثور على: ${bestMatch.name_ar || bestMatch.name}`, 'info');
      } else {
        showNotification(`لا يوجد منتج بالباركود أو الاسم: ${sku}`, 'warning');
      }
    } else {
      const product = results[0];
      fillEntryFromProduct(entry, product);
      showNotification(`تم العثور على: ${product.name_ar || product.name}`, 'success');
    }
  }

  function fillEntryFromProduct(entry, product) {
    entry.product_id = product.id;
    entry.name = product.name;
    entry.name_ar = product.name_ar || product.name;
    entry.sku = product.sku || '';
    entry.barcode = product.barcode || '';
    entry.dosage_form = product.dosage_form || '';
    entry.strength = product.strength || '';
    entry.unit_of_measure = product.unit_of_measure || '';

    // تحديث واجهة المستخدم
    const row = document.querySelector(`tr[data-row-id="${entry.rowId}"]`);
    if (row) {
      const skuInput = row.querySelector('.entry-sku-input');
      if (skuInput) skuInput.value = entry.sku || entry.barcode || '';

      const nameCell = row.querySelector('td:nth-child(3)');
      if (nameCell) {
        nameCell.innerHTML = `
          ${esc(entry.name_ar || entry.name)}
          <div class="muted" style="font-size:0.8rem;">${entry.dosage_form || ''}${entry.strength ? ' ' + entry.strength : ''}</div>
        `;
      }

      const unitInput = row.querySelector('.entry-unit-input');
      if (unitInput) unitInput.value = entry.unit_of_measure || '';
    }
  }

  async function searchProduct(query) {
    if (!query || query.trim() === '') return;

    const resultsDiv = document.getElementById('search-results');
    if (!resultsDiv) return;

    resultsDiv.style.display = 'block';
    resultsDiv.innerHTML = '<div class="muted" style="padding:0.5rem;">جارٍ البحث...</div>';

    const results = await searchProducts(query);

    if (results.length === 0) {
      resultsDiv.innerHTML = '<div class="muted" style="padding:0.5rem;">لا يوجد نتائج لـ "' + esc(query) + '"</div>';
      return;
    }

    resultsDiv.innerHTML = `
      <div style="border:1px solid #ddd;border-radius:4px;max-height:200px;overflow-y:auto;">
        ${results.map(p => `
          <div style="padding:0.5rem;border-bottom:1px solid #eee;cursor:pointer;"
               onmouseover="this.style.background='#f0f0f0'"
               onmouseout="this.style.background='white'"
               onclick="selectSearchResult('${p.id}','${esc(p.name_ar || p.name)}','${esc(p.sku || '')}','${esc(p.barcode || '')}','${esc(p.dosage_form || '')}','${esc(p.strength || '')}','${esc(p.unit_of_measure || '')}')">
            <strong style="color:#667eea;">${esc(p.name_ar || p.name)}</strong>
            <span class="muted" style="margin-left:0.5rem;">${p.dosage_form || ''}${p.strength ? ' ' + p.strength : ''}</span>
            <div class="muted" style="font-size:0.8rem;margin-top:0.2rem;">
              SKU: ${p.sku || '—'} | باركود: ${p.barcode || '—'} | ${p.unit_of_measure || 'وحدة'}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  window.selectSearchResult = function(productId, name, sku, barcode, dosageForm, strength, unit) {
    // إضافة منتج كصف جديد في الجدول
    const newEntry = {
      rowId: generateRowId(),
      product_id: productId,
      name: name,
      name_ar: name,
      sku: sku,
      barcode: barcode,
      dosage_form: dosageForm,
      strength: strength,
      unit_of_measure: unit,
      quantity: 1,
      unit_price: 0,
      discount_percent: 0,
      batch_number: '',
      expiry_date: '',
      notes: '',
    };
    purchaseEntries.push(newEntry);
    renderPurchaseTable();

    document.getElementById('search-results').style.display = 'none';
    document.getElementById('product-search-input').value = '';

    // التركيز على حقل الكمية
    setTimeout(() => {
      const inputs = document.querySelectorAll('.entry-quantity-input');
      if (inputs.length > 0) {
        inputs[inputs.length - 1].focus();
      }
    }, 50);
  };

  // --- حفظ الفاتورة كمسودة ---

  async function savePurchaseOrderDraft() {
    const session = getCurrentSession();
    if (!session) {
      showNotification('يجب تسجيل الدخول أولاً', 'error');
      return;
    }

    if (purchaseEntries.length === 0) {
      showNotification('لا توجد أسطر في الفاتورة', 'warning');
      return;
    }

    const supplierId = document.getElementById('supplier-select')?.value;
    if (!supplierId) {
      showNotification('يجب اختيار مورد', 'warning');
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال بقاعدة البيانات', 'error');
      return;
    }

    try {
      // التحقق من وجود warehouse_id
      const warehouseId = session.warehouse_id;
      if (!warehouseId) {
        showNotification('لم يتم تحديد مخزن', 'error');
        return;
      }

      showNotification('جارٍ حفظ المسودة...', 'info');

      // إنشاء أمر الشراء
      const orderId = await createPurchaseOrder(client, session, supplierId, warehouseId);

      if (!orderId) {
        showNotification('فشل إنشاء أمر الشراء', 'error');
        return;
      }

      // إضافة البنود
      for (const entry of purchaseEntries) {
        if (entry.product_id) {
          await addPurchaseOrderItem(client, orderId, entry);
        }
      }

      showNotification(`تم حفظ أمر الشراء ${orderId} كمسودة`, 'success');
      navigate('/purchases/orders/' + orderId);
    } catch (e) {
      console.error('Error saving purchase order:', e);
      showNotification('خطأ: ' + (e.message || 'فشل الحفظ'), 'error');
    }
  }

  async function createPurchaseOrder(client, session, supplierId, warehouseId) {
    const orderNumber = 'PO-' + new Date().toISOString().substr(0, 10).replace(/-/g, '') + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();

    const { data, error } = await client.from('purchase_orders').insert({
      id: crypto.randomUUID ? crypto.randomUUID() : orderNumber,
      tenant_id: session.tenant_id || '00000000-0000-0000-0000-000000000001',
      supplier_id: supplierId,
      warehouse_id: warehouseId,
      order_number: orderNumber,
      order_date: new Date().toISOString(),
      status: 'pending',
      notes: '',
      created_by: session.id,
    }).select('id,order_number').single();

    if (error) {
      console.error('Error creating purchase order:', error);
      throw new Error(error.message);
    }

    return data.id;
  }

  async function addPurchaseOrderItem(client, orderId, entry) {
    const quantity = Number(entry.quantity) || 0;
    const unitPrice = Number(entry.unit_price) || 0;
    const discount = Number(entry.discount_percent) || 0;
    const subtotal = quantity * unitPrice * (1 - discount / 100);

    const { error } = await client.from('purchase_order_items').insert({
      id: crypto.randomUUID ? crypto.randomUUID() : generateRowId(),
      purchase_order_id: orderId,
      product_id: entry.product_id,
      quantity: quantity,
      unit_price: unitPrice,
      discount_percent: discount,
      subtotal: subtotal,
      notes: entry.notes || '',
    });

    if (error) {
      console.error('Error adding item:', error);
      throw new Error(error.message);
    }
  }

  // --- إرسال الفاتورة للموافقة ---

  async function submitPurchaseOrder() {
    const session = getCurrentSession();
    if (!session) {
      showNotification('يجب تسجيل الدخول أولاً', 'error');
      return;
    }

    if (purchaseEntries.length === 0) {
      showNotification('لا توجد أسطر في الفاتورة', 'warning');
      return;
    }

    const supplierId = document.getElementById('supplier-select')?.value;
    if (!supplierId) {
      showNotification('يجب اختيار مورد', 'warning');
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال بقاعدة البيانات', 'error');
      return;
    }

    try {
      const warehouseId = session.warehouse_id;
      if (!warehouseId) {
        showNotification('لم يتم تحديد مخزن', 'error');
        return;
      }

      showNotification('جارٍ إرسال الفاتورة للموافقة...', 'info');

      const orderId = await createPurchaseOrder(client, session, supplierId, warehouseId);

      for (const entry of purchaseEntries) {
        if (entry.product_id) {
          await addPurchaseOrderItem(client, orderId, entry);
        }
      }

      // تحديث حالة إلى pending_approval
      await client.from('purchase_orders').update({
        status: 'pending_approval',
        updated_at: new Date().toISOString(),
      }).eq('id', orderId);

      showNotification(`تم إرسال أمر الشراء ${orderId} للموافقة`, 'success');
      navigate('/purchases/orders/' + orderId);
    } catch (e) {
      console.error('Error submitting purchase order:', e);
      showNotification('خطأ: ' + (e.message || 'فشل الإرسال'), 'error');
    }
  }

  // --- عرض الإشعارات ---

  function showNotification(message, type) {
    const existing = document.querySelector('.purchases-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = 'purchases-notification';
    notification.style.cssText = `
      position: fixed;
      top: 1rem;
      right: 1rem;
      padding: 0.75rem 1rem;
      border-radius: 4px;
      color: white;
      font-weight: bold;
      z-index: 9999;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      animation: slideIn 0.3s ease-out;
    `;

    const colors = {
      success: '#16a34a',
      error: '#dc2626',
      warning: '#d97706',
      info: '#2563eb',
    };

    notification.style.background = colors[type] || colors.info;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transition = 'opacity 0.3s';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  // --- التنقل ---

  window.navigate = function(path) {
    if (typeof window.safeNavigate === 'function') {
      window.safeNavigate(path);
    } else {
      window.location.href = path;
    }
  };

  // --- رسم الصفحة الرئيسية ---

  function renderMainPage() {
    sectionBody = document.getElementById('section-body');

    // تحميل الموردين
    loadSuppliers();

    // إنشاء هيكل الصفحة
    const html = `
      <div class="card" style="padding:1rem;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;margin-bottom:1rem;">
          <div class="card stat-card" style="text-align:center;">
            <div style="font-size:2rem;font-weight:bold;color:#667eea;" id="stat-po-count">0</div>
            <div class="muted">أوامر الشراء</div>
          </div>
          <div class="card stat-card" style="text-align:center;">
            <div style="font-size:2rem;font-weight:bold;color:#16a34a;" id="stat-received-count">0</div>
            <div class="muted">استلام تم</div>
          </div>
          <div class="card stat-card" style="text-align:center;">
            <div style="font-size:2rem;font-weight:bold;color:#dc2626;" id="stat-pending-count">0</div>
            <div class="muted">قيد الانتظار</div>
          </div>
          <div class="card stat-card" style="text-align:center;">
            <div style="font-size:2rem;font-weight:bold;color:#2563eb;" id="stat-supplier-count">0</div>
            <div class="muted">موردين نشطين</div>
          </div>
        </div>

        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;">
          <button class="btn primary large" id="new-purchase-order-btn">➕ أمر شراء جديد</button>
          <button class="btn" id="refresh-purchases-btn">🔄 تحديث</button>
        </div>

        <div class="card" style="padding:0.75rem;margin-bottom:1rem;">
          <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
            <input type="text" id="product-search-input" placeholder="🔍 ابحث عن دواء بالباركود أو الاسم..."
              style="flex:1;min-width:200px;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:0.9rem;"
              onkeyup="if(event.key==='Enter')searchProduct(this.value)">
            <select id="supplier-select" style="padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:0.9rem;min-width:150px;">
              <option value="">-- اختر مورد --</option>
            </select>
            <button class="btn" id="search-product-btn" onclick="searchProduct(document.getElementById('product-search-input').value)">بحث</button>
          </div>
          <div id="search-results" style="margin-top:0.5rem;display:none;"></div>
        </div>

        <div class="card" style="padding:0;">
          <div style="padding:0.5rem 0.75rem;background:#667eea;color:white;font-weight:bold;border-bottom:2px solid #5a67d8;">
            <span>📋 جدول إدخال المشتريات السريع</span>
            <span class="muted" style="font-size:0.8rem;color:#ddd;margin-left:auto;">Enter للتنقل | Ctrl+S لحفظ</span>
          </div>
          <div style="overflow-x:auto;">
            <table id="purchase-entries-table" style="width:100%;border-collapse:collapse;font-size:0.9rem;">
              <thead>
                <tr style="background:#f8f9fa;border-bottom:2px solid #ddd;">
                  <th style="padding:0.5rem;width:30px;">#</th>
                  <th style="padding:0.5rem;width:180px;">🎯 sku/barcode</th>
                  <th style="padding:0.5rem;width:150px;">🧪 المنتج</th>
                  <th style="padding:0.5rem;width:100px;">🔢 الكمية</th>
                  <th style="padding:0.5rem;width:100px;">💰 السعر</th>
                  <th style="padding:0.5rem;width:80px;">📊 خصم %</th>
                  <th style="padding:0.5rem;width:100px;">💵 الإجمالي</th>
                  <th style="padding:0.5rem;width:100px;">📦 تشغيلة</th>
                  <th style="padding:0.5rem;width:100px;">📅 صلاحية</th>
                  <th style="padding:0.5rem;width:50px;">🗑️</th>
                </tr>
              </thead>
              <tbody id="purchase-entries-body">
              </tbody>
            </table>
          </div>
          <div style="padding:0.5rem 0.75rem;border-top:1px solid #ddd;background:#f8f9fa;display:flex;justify-content:space-between;align-items:center;">
            <span class="muted">إجمالي الفاتورة: <strong id="purchase-total-amount">0.00</strong> جنيه</span>
            <div style="display:flex;gap:0.5rem;">
              <button class="btn" id="add-row-btn">➕ صف</button>
              <button class="btn" id="clear-entries-btn">🗑️ مسح</button>
              <button class="btn primary" id="save-purchase-btn">💾 حفظ مسودة</button>
              <button class="btn danger" id="submit-purchase-btn" style="background:#dc2626;">SendMessage ارسال</button>
            </div>
          </div>
        </div>

        <div class="card" style="margin-top:1rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.75rem;border-bottom:2px solid #ddd;">
            <h3 style="margin:0;">📋 أحدث أوامر الشراء</h3>
            <a class="btn" href="/purchases/orders">عرض الكل →</a>
          </div>
          <div id="recent-orders-container" style="padding:0.5rem;">
            <div class="muted" style="text-align:center;">جارٍ تحميل البيانات...</div>
          </div>
        </div>
      </div>
    `;

    sectionBody.innerHTML = html;

    // إضافة صف فارغ واحد
    addEmptyRow();

    // ربط الأحداث
    document.getElementById('add-row-btn')?.addEventListener('click', addEmptyRow);
    document.getElementById('clear-entries-btn')?.addEventListener('click', () => {
      if (confirm('مسح جميع الأسطر؟')) {
        purchaseEntries = [];
        renderPurchaseTable();
      }
    });
    document.getElementById('save-purchase-btn')?.addEventListener('click', savePurchaseOrderDraft);
    document.getElementById('submit-purchase-btn')?.addEventListener('click', submitPurchaseOrder);
    document.getElementById('refresh-purchases-btn')?.addEventListener('click', () => {
      location.reload();
    });
    document.getElementById('new-purchase-order-btn')?.addEventListener('click', () => {
      purchaseEntries = [];
      renderPurchaseTable();
      document.getElementById('supplier-select').value = '';
      document.getElementById('product-search-input').value = '';
      addEmptyRow();
    });

    // تحديث الإحصائيات
    updateStats();
  }

  async function updateStats() {
    const client = getSupabaseClient();
    if (!client) return;

    try {
      const [poRes, grRes, supRes] = await Promise.all([
        client.from('purchase_orders').select('id,status').limit(500),
        client.from('goods_receipts').select('id,status').limit(500),
        client.from('suppliers').select('id').eq('is_active', true).limit(500),
      ]);

      const poRows = poRes.data || [];
      const grRows = grRes.data || [];
      const supRows = supRes.data || [];

      document.getElementById('stat-po-count').textContent = poRows.length;
      document.getElementById('stat-received-count').textContent = grRows.filter(g => g.status === 'posted' || g.status === 'received').length;
      document.getElementById('stat-pending-count').textContent = poRows.filter(p => p.status === 'pending' || p.status === 'pending_approval').length;
      document.getElementById('stat-supplier-count').textContent = supRows.length;

      // عرض أحدث الأوامر
      const recentRes = await client.from('purchase_orders')
        .select('id,order_number,status,total_amount,created_at,supplier_id')
        .order('created_at', { ascending: false })
        .limit(10);

      const container = document.getElementById('recent-orders-container');
      if (!container) return;

      const recentRows = recentRes.data || [];
      if (recentRows.length === 0) {
        container.innerHTML = '<div class="muted" style="text-align:center;padding:1rem;">لا توجد أوامر شراء حتى الآن</div>';
        return;
      }

      // جلب أسماء الموردين
      const supplierIds = recentRows.map(r => r.supplier_id).filter(Boolean);
      const suppliersMap = new Map();
      if (supplierIds.length > 0) {
        const supRes = await client.from('suppliers')
          .select('id,name,name_ar')
          .in('id', supplierIds);
        (supRes.data || []).forEach(s => suppliersMap.set(s.id, s));
      }

      container.innerHTML = `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
            <thead>
              <tr style="background:#f8f9fa;border-bottom:2px solid #ddd;text-align:right;">
                <th style="padding:0.5rem;">رقم الأمر</th>
                <th style="padding:0.5rem;">المورد</th>
                <th style="padding:0.5rem;">الحالة</th>
                <th style="padding:0.5rem;">التاريخ</th>
                <th style="padding:0.5rem;">الإجمالي</th>
                <th style="padding:0.5rem;">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              ${recentRows.map(po => {
                const supplier = suppliersMap.get(po.supplier_id);
                return `
                  <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:0.5rem;font-weight:bold;">${po.order_number || String(po.id).slice(0, 8)}</td>
                    <td style="padding:0.5rem;">${supplier ? (supplier.name_ar || supplier.name) : '—'}</td>
                    <td style="padding:0.5rem;">${STATUS_LABELS[po.status] || po.status}</td>
                    <td style="padding:0.5rem;">${new Date(po.created_at).toLocaleDateString('ar-EG')}</td>
                    <td style="padding:0.5rem;font-weight:bold;">${po.total_amount?.toFixed(2) || '0.00'} جنيه</td>
                    <td style="padding:0.5rem;">
                      <button class="btn small" onclick="navigate('/purchases/orders/${po.id}')">عرض</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (e) {
      console.error('Error updating stats:', e);
    }
  }

  // --- تعزيز واجهة المستخدم بـ CSS إضافي ---

  const style = document.createElement('style');
  style.textContent = `
    .purchases-dashboard {
      animation: fadeIn 0.3s ease-in;
    }
    .stat-card {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 1rem;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .stat-card .muted {
      color: rgba(255,255,255,0.8);
      font-size: 0.85rem;
    }
    .card {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      padding: 1rem;
    }
    #purchase-entries-table th {
      background: #f8f9fa;
      font-weight: bold;
      color: #333;
      padding: 0.5rem;
      border-bottom: 2px solid #ddd;
    }
    #purchase-entries-table td {
      padding: 0.4rem;
      text-align: right;
      background: white;
    }
    #purchase-entries-table tr:hover {
      background: #f0f4ff;
    }
    #purchase-entries-table input {
      width: 100%;
      padding: 0.3rem;
      border: 1px solid #ddd;
      border-radius: 3px;
      font-size: 0.85rem;
    }
    .entry-sku-input:focus, .entry-quantity-input:focus, .entry-price-input:focus {
      border-color: #667eea;
      outline: none;
      box-shadow: 0 0 0 2px rgba(102,126,234,0.2);
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
    .btn:active {
      transform: translateY(0);
    }
    .btn.primary {
      background: #667eea;
      color: white;
    }
    .btn.primary:hover {
      background: #5a67d8;
    }
    .btn.success {
      background: #16a34a;
      color: white;
    }
    .btn.success:hover {
      background: #15803d;
    }
    .btn.danger {
      background: #dc2626;
      color: white;
    }
    .btn.danger:hover {
      background: #b91c1c;
    }
    .btn.small {
      padding: 0.2rem 0.5rem;
      font-size: 0.8rem;
    }
    .btn.large {
      padding: 0.75rem 1.5rem;
      font-size: 1rem;
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  // --- التحقق مما إذا كان المسار الحالي هو /purchases ---

  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';

  if (currentPath === '/purchases' || currentPath === '/purchases/new') {
    renderMainPage();
  }

  // إذا كان المسار /purchases/orders/id أو /purchases/receiving/id
  const orderMatch = currentPath.match(/^\/purchases\/orders\/(.+)$/);
  if (orderMatch) {
    renderOrderDetail(orderMatch[1]);
  }

  const receiptMatch = currentPath.match(/^\/purchases\/receiving\/(.+)$/);
  if (receiptMatch) {
    renderReceivePage(receiptMatch[1]);
  }

})();
