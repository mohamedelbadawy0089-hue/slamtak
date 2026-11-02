// ============================================================
// صفحة إنشاء أمر شراء جديد
// ============================================================

(function() {
  'use strict';

  let insertedId = null;

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

  // ===== مسار الصفحة =====

  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
  if (currentPath !== '/purchases/new' && currentPath !== '/purchases/create') return;

  const sectionBody = document.getElementById('section-body');
  if (!sectionBody) return;

  const session = getCurrentSession();

  // هوية التاجر الافتراضية (مؤقتة حتى تتم المصادقة الكاملة)
  const tenantId = session?.tenant_id || '00000000-0000-0000-0000-000000000001';
  const warehouseId = session?.warehouse_id || null;

  // ===== جلب البيانات =====

  async function loadData() {
    const client = getSupabaseClient();
    if (!client) return;

    try {
      // جلب الموردين
      const supRes = await client
        .from('suppliers')
        .select('id,name,name_ar,code,phone,email')
        .eq('is_active', true)
        .order('name')
        .limit(200);

      renderSuppliers(supRes.data || []);

      // جلب المخازن
      if (warehouseId) {
        const whRes = await client
          .from('warehouses')
          .select('id,name,name_ar,code')
          .eq('id', warehouseId)
          .single();

        renderWarehouse(whRes.data);
      }

      // جلب العملة الافتراضية والمعلومات
      try {
        const orgRes = await client
          .from('organizations')
          .select('id,name,currency,currency_symbol')
          .eq('id', tenantId)
          .single();

        if (orgRes.data) {
          renderOrganization(orgRes.data);
        }
      } catch (e) {}
    } catch (e) {
      console.error('Error loading data:', e);
    }
  }

  // ===== بناء الصفحة =====

  function renderPage() {
    const supplierOptions = suppliers.map(s =>
      `<option value="${s.id}">${esc(s.name_ar || s.name)} (${s.code || 'بدون كود'})</option>`
    ).join('');

    const warehouseOptions = warehouseId
      ? `<option value="${warehouseId}" selected>${esc(warehouseName || 'المخزن الرئيسي')}</option>`
      : '<option value="">-- اختر مخزن --</option>';

    sectionBody.innerHTML = `
      <div class="card" style="animation:fadeIn 0.3s ease-in;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <h1 style="margin:0;font-size:1.5rem;">➕ أمر شراء جديد</h1>
          <a class="btn" href="/purchases">🔙返回</a>
        </div>

        <div style="max-width:800px;">
          <!-- معلومات أساسية -->
          <div style="background:#f8f9fa;border-radius:8px;padding:1rem;margin-bottom:1rem;">
            <h3 style="margin:0 0 0.5rem 0;color:#667eea;">📝 معلومات الفاتورة</h3>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
              <div>
                <label class="form-label">المورد <span style="color:red;">*</span></label>
                <select id="supplier-select" class="form-select" style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;">
                  <option value="">-- اختر مورد --</option>
                  ${supplierOptions}
                </select>
              </div>

              <div>
                <label class="form-label">تاريخ الفاتورة</label>
                <input type="date" id="order-date" class="form-input" value="${new Date().toISOString().substr(0, 10)}"
                  style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;">
              </div>

              <div>
                <label class="form-label">رقم الفاتورة (اختياري)</label>
                <input type="text" id="invoice-number" class="form-input" placeholder="رقم الفاتورة من المورد"
                  style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;">
              </div>

              <div>
                <label class="form-label">طريقة الشراء</label>
                <select id="purchase-type" class="form-select" style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;">
                  <option value="direct">شراء مباشر</option>
                  <option value="tender">من خلال مزاد/عرض سعر</option>
                  <option value="emergency">طلب طارئ</option>
                </select>
              </div>

              ${warehouseId ? `
                <div>
                  <label class="form-label">المخزن</label>
                  <select id="warehouse-select" class="form-select" style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;cursor:default;" disabled>
                    <option value="${warehouseId}" selected>${esc(warehouseName || 'المخزن الرئيسي')}</option>
                  </select>
                </div>
              ` : ''}

              <div>
                <label class="form-label">تاريخ التسليم المتوقع</label>
                <input type="date" id="delivery-date" class="form-input"
                  value="${new Date(Date.now() + 7 * 86400000).toISOString().substr(0, 10)}"
                  style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;">
              </div>
            </div>

            <div>
              <label class="form-label">ملاحظات</label>
              <textarea id="notes" class="form-input" rows="3" placeholder="أي ملاحظات إضافية..."
                style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;resize:vertical;"></textarea>
            </div>
          </div>

          <!-- جدول البنود -->
          <div style="background:white;border:1px solid #ddd;border-radius:8px;overflow:hidden;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.75rem;background:#f8f9fa;border-bottom:2px solid #ddd;">
              <h3 style="margin:0;">📋 بنود الفاتورة <span class="muted" style="font-size:0.85rem;">(اضغط Enter بعد كل صنف)</span></h3>
              <button class="btn" onclick="addEmptyRow()">➕ إضافة صنف</button>
            </div>
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
                <thead>
                  <tr style="background:#f8f9fa;border-bottom:2px solid #ddd;text-align:right;">
                    <th style="padding:0.5rem;width:30px;">#</th>
                    <th style="padding:0.5rem;width:150px;">🔍 منتج</th>
                    <th style="padding:0.5rem;width:80px;">الباركود</th>
                    <th style="padding:0.5rem;width:80px;">النوع</th>
                    <th style="padding:0.5rem;width:80px;">الكمية</th>
                    <th style="padding:0.5rem;width:100px;">السعر الوحيدي (جنيه)</th>
                    <th style="padding:0.5rem;width:80px;">الخصم %</th>
                    <th style="padding:0.5rem;width:100px;">الإجمالي</th>
                    <th style="padding:0.5rem;width:80px;">حذف</th>
                  </tr>
                </thead>
                <tbody id="items-body">
                  <tr style="background:#fff3cd;">
                    <td colspan="9" style="padding:1rem;text-align:center;color:#856404;">
                      لا توجد بنود بعد. اضغط <kbd>➕ إضافة صنف</kbd> أو ابحث عن دواء أعلاه.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.75rem;background:#f8f9fa;border-top:2px solid #ddd;">
              <span class="muted">إجمالي الفاتورة: <strong id="grand-total">0.00</strong> جنيه</span>
              <div style="display:flex;gap:0.5rem;">
                <button class="btn" onclick="clearItems()">🗑️ مسح الكل</button>
                <button class="btn primary" onclick="savePurchaseOrder()" style="background:#667eea;">💾 حفظ كمسودة</button>
                <button class="btn success" onclick="submitPurchaseOrder()" style="background:#16a34a;">SendMessage إرسال للموافقة</button>
              </div>
            </div>
          </div>

          <!-- شريط البحث السريع -->
          <div style="margin-top:1rem;background:#e0f2fe;border:2px solid #38bdf8;border-radius:8px;padding:0.75rem;">
            <h4 style="margin:0 0 0.5rem 0;color:#0369a1;">🔍 بحث سريع عن دواء</h4>
            <div style="display:flex;gap:0.5rem;">
              <input type="text" id="quick-search" placeholder="أدخل الاسم، الباركود أو الـ SKU..."
                style="flex:1;padding:0.5rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;"
                onkeyup="handleQuickSearch(event, this.value)">
              <button class="btn" onclick="handleQuickSearch({key:'Enter'}, document.getElementById('quick-search').value)">
                🔍 بحث
              </button>
              <button class="btn" onclick="document.getElementById('quick-search').value = ''; document.getElementById('quick-search').focus();">
                ✖️ مسح
              </button>
            </div>
            <div id="quick-search-results" style="margin-top:0.5rem;display:none;max-height:200px;overflow-y:auto;border:1px solid #ddd;border-radius:4px;background:white;"></div>
          </div>

          <!-- معلومات المشتري -->
          <div style="margin-top:1rem;background:#f0f9ff;border:2px solid #38bdf8;border-radius:8px;padding:0.75rem;">
            <div class="muted">تم إنشاؤه بواسطة: ${session?.email || 'مستخدم مسجل'}</div>
            <div class="muted">التاريخ: ${new Date().toLocaleDateString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' })}</div>
          </div>
        </div>
      </div>
    `;

    // إضافة صف فارغ واحد
    items = [{ rowId: generateRowId(), product_id: '', name: '', name_ar: '', sku: '', barcode: '', dosage_form: '', strength: '', unit_of_measure: '', quantity: 0, unit_price: 0, discount_percent: 0, notes: '' }];
    renderItemsTable();

    // طلب البيانات
    loadData();
  }

  // ===== حالات صفحة الفاتورة =====

  let items = [];
  let suppliers = [];
  let warehouseName = '';

  function generateRowId() {
    return 'row_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  function renderSuppliers(data) {
    suppliers = data;
  }

  function renderWarehouse(data) {
    if (data) {
      warehouseName = data.name_ar || data.name;
    }
  }

  function renderOrganization(org) {
    // لا شيء هنا
  }

  // ===== جدول البنود =====

  function renderItemsTable() {
    const tbody = document.getElementById('items-body');
    if (!tbody) return;

    if (items.length === 0) {
      tbody.innerHTML = `
        <tr style="background:#fff3cd;">
          <td colspan="9" style="padding:1rem;text-align:center;color:#856404;">
            لا توجد بنود. اضغط <kbd>➕ إضافة صنف</kbd>
          </td>
        </tr>
      `;
      updateGrandTotal();
      return;
    }

    tbody.innerHTML = items.map((item, index) => `
      <tr data-row-id="${item.rowId}" style="border-bottom:1px solid #eee;">
        <td style="padding:0.4rem;text-align:center;font-weight:bold;color:#667eea;">${index + 1}</td>
        <td style="padding:0.4rem;">
          <div style="font-weight:bold;color:#333;">${escapeHtml(item.name_ar || item.name || '— بدون منتج —')}</div>
          <div class="muted" style="font-size:0.8rem;">${item.dosage_form || ''}${item.strength ? ' ' + item.strength : ''}</div>
          <input type="hidden" class="item-product-id" value="${item.product_id || ''}" data-row-id="${item.rowId}">
        </td>
        <td style="padding:0.4rem;">
          <input type="text" class="item-barcode-input" value="${escapeHtml(item.barcode || '')}"
            style="width:100%;padding:0.3rem;border:1px solid #ddd;border-radius:3px;font-size:0.85rem;"
            data-row-id="${item.rowId}" placeholder="باركود">
          <div class="muted" style="font-size:0.75rem;">${escapeHtml(item.sku || '')}</div>
        </td>
        <td style="padding:0.4rem;">
          <select class="item-dosage-select" data-row-id="${item.rowId}"
            style="padding:0.3rem;border:1px solid #ddd;border-radius:3px;font-size:0.85rem;width:100%;direction:rtl;">
            <option value="">--</option>
            <option value="tablet" ${item.dosage_form === 'tablet' ? 'selected' : ''}>✅ أقراص</option>
            <option value="capsule" ${item.dosage_form === 'capsule' ? 'selected' : ''}>💊 كبسولات</option>
            <option value="syrup" ${item.dosage_form === 'syrup' ? 'selected' : ''}>🧪 سيروبه</option>
            <option value="ampoule" ${item.dosage_form === 'ampoule' ? 'selected' : ''}>💡 مفصل</option>
            <option value="injection" ${item.dosage_form === 'injection' ? 'selected' : ''}>💉 حقن</option>
            <option value="cream" ${item.dosage_form === 'cream' ? 'selected' : ''}>🧴 كريم</option>
            <option value="drop" ${item.dosage_form === 'drop' ? 'selected' : ''}>👁️ قطرات</option>
            <option value="spray" ${item.dosage_form === 'spray' ? 'selected' : ''}>💨 رذاذ</option>
            <option value="drop_eye" ${item.dosage_form === 'drop_eye' ? 'selected' : ''}>👁️ قطرات عين</option>
            <option value="drop_nose" ${item.dosage_form === 'drop_nose' ? 'selected' : ''}>👃 قطرات أنف</option>
          </select>
        </td>
        <td style="padding:0.4rem;">
          <input type="number" class="item-quantity-input" value="${item.quantity || 0}"
            style="width:100%;padding:0.3rem;border:1px solid #ddd;border-radius:3px;font-size:0.85rem;text-align:right;"
            data-row-id="${item.rowId}" min="0" step="0.01" oninput="updateRowFromInput(this)">
        </td>
        <td style="padding:0.4rem;">
          <input type="number" class="item-price-input" value="${item.unit_price || 0}"
            style="width:100%;padding:0.3rem;border:1px solid #ddd;border-radius:3px;font-size:0.85rem;text-align:right;"
            data-row-id="${item.rowId}" min="0" step="0.01" oninput="updateRowFromInput(this)">
        </td>
        <td style="padding:0.4rem;">
          <input type="number" class="item-discount-input" value="${item.discount_percent || 0}"
            style="width:100%;padding:0.3rem;border:1px solid #ddd;border-radius:3px;font-size:0.85rem;text-align:right;"
            data-row-id="${item.rowId}" min="0" max="100" step="0.5" oninput="updateRowFromInput(this)">
          <span class="muted" style="font-size:0.75rem;">%</span>
        </td>
        <td style="padding:0.4rem;">
          <span style="font-weight:bold;color:#16a34a;">${formatCurrency(calculateLineTotal(item))}</span>
        </td>
        <td style="padding:0.4rem;text-align:center;">
          <button class="btn small" style="background:#dc2626;color:white;"
            onclick="removeItem('${item.rowId}')">🗑️</button>
        </td>
      </tr>
    `).join('');

    updateGrandTotal();
  }

  function calculateLineTotal(item) {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unit_price) || 0;
    const discount = Number(item.discount_percent) || 0;
    return qty * price * (1 - discount / 100);
  }

  function updateGrandTotal() {
    const total = items.reduce((sum, item) => sum + calculateLineTotal(item), 0);
    const el = document.getElementById('grand-total');
    if (el) el.textContent = formatCurrency(total);
  }

  function updateRowFromInput(input) {
    const rowId = input.dataset.rowId;
    const item = items.find(i => i.rowId === rowId);
    if (!item) return;

    if (input.classList.contains('item-quantity-input')) {
      item.quantity = Number(input.value) || 0;
    } else if (input.classList.contains('item-price-input')) {
      item.unit_price = Number(input.value) || 0;
    } else if (input.classList.contains('item-discount-input')) {
      item.discount_percent = Number(input.value) || 0;
    }

    const row = input.closest('tr');
    if (row) {
      const cells = row.querySelectorAll('td');
      if (cells[7]) { // الخلية الثامنة = الإجمالي
        cells[7].innerHTML = `<span style="font-weight:bold;color:#16a34a;">${formatCurrency(calculateLineTotal(item))}</span>`;
      }
    }
    updateGrandTotal();
  }

  function removeItem(rowId) {
    items = items.filter(i => i.rowId !== rowId);
    renderItemsTable();
  }

  function clearItems() {
    if (confirm('مسح جميع البنود؟')) {
      items = [];
      renderItemsTable();
    }
  }

  window.addEmptyRow = function() {
    items.push({
      rowId: generateRowId(),
      product_id: '',
      name: '',
      name_ar: '',
      sku: '',
      barcode: '',
      dosage_form: 'tablet',
      strength: '',
      unit_of_measure: 'وحدة',
      quantity: 0,
      unit_price: 0,
      discount_percent: 0,
      notes: '',
    });
    renderItemsTable();

    // التركيز على حقل الكمية في الصف الجديد
    setTimeout(() => {
      const inputs = document.querySelectorAll('.item-quantity-input');
      if (inputs.length > 0) {
        inputs[inputs.length - 1].focus();
      }
    }, 50);
  };

  window.removeItem = removeItem;
  window.clearItems = clearItems;
  window.updateRowFromInput = updateRowFromInput;

  // ===== البحث السريع =====

  async function searchProducts(query) {
    if (!query || query.trim() === '') {
      document.getElementById('quick-search-results').style.display = 'none';
      return [];
    }

    const client = getSupabaseClient();
    if (!client) return [];

    // بحث بالباركود أو SKU أولاً (دقيق)
    const exactRes = await client
      .from('products')
      .select('id,name,name_ar,scientific_name,barcode,sku,dosage_form,strength,unit_of_measure')
      .or(`barcode.eq.${query.trim()},sku.eq.${query.trim()}`)
      .eq('is_active', true)
      .limit(5);

    if (exactRes.data && exactRes.data.length > 0) {
      return exactRes.data;
    }

    // بحث نصي
    const searchRes = await client
      .from('products')
      .select('id,name,name_ar,scientific_name,barcode,sku,dosage_form,strength,unit_of_measure')
      .ilike('name_ar', `%${query.trim()}%`)
      .eq('is_active', true)
      .limit(10);

    if (searchRes.data && searchRes.data.length > 0) {
      return searchRes.data;
    }

    // بحث إنجليزي
    const enRes = await client
      .from('products')
      .select('id,name,name_ar,scientific_name,barcode,sku,dosage_form,strength,unit_of_measure')
      .ilike('name', `%${query.trim()}%`)
      .eq('is_active', true)
      .limit(10);

    return (enRes.data && enRes.data.length > 0) ? enRes.data : [];
  }

  window.handleQuickSearch = async function(event, query) {
    if (event.key !== 'Enter' && query.trim() === '') {
      document.getElementById('quick-search-results').style.display = 'none';
      return;
    }

    const resultsDiv = document.getElementById('quick-search-results');
    if (!resultsDiv) return;

    resultsDiv.style.display = 'block';
    resultsDiv.innerHTML = '<div class="muted" style="padding:0.5rem;">جارٍ البحث...</div>';

    const results = await searchProducts(query);
    if (results.length === 0) {
      resultsDiv.innerHTML = '<div class="muted" style="padding:0.5rem;">لا يوجد نتائج لـ "' + escapeHtml(query) + '"</div>';
      return;
    }

    resultsDiv.innerHTML = results.map(p => `
      <div style="padding:0.5rem;border-bottom:1px solid #eee;cursor:pointer;display:flex;justify-content:space-between;align-items:center;"
           onmouseover="this.style.background='#f0f0f0'"
           onmouseout="this.style.background='white'"
           onclick="addProductToNewOrder(${JSON.stringify({ id: p.id, name: p.name, name_ar: p.name_ar, sku: p.sku, barcode: p.barcode, dosage_form: p.dosage_form, strength: p.strength, unit_of_measure: p.unit_of_measure }).replace(/"/g, '&quot;')})">
        <div>
          <strong>${escapeHtml(p.name_ar || p.name)}</strong>
          <span class="muted" style="margin-left:0.5rem;">${p.dosage_form || ''} ${p.strength ? ' ' + p.strength : ''}</span>
        </div>
        <div class="muted" style="font-size:0.8rem;text-align:right;">${p.sku || '—'} | ${p.barcode || '—'}</div>
      </div>
    `).join('');
  };

  window.addProductToNewOrder = function(product) {
    // إضافة منتج جديد كصف
    items.push({
      rowId: generateRowId(),
      product_id: product.id,
      name: product.name,
      name_ar: product.name_ar || product.name,
      sku: product.sku || '',
      barcode: product.barcode || '',
      dosage_form: product.dosage_form || '',
      strength: product.strength || '',
      unit_of_measure: product.unit_of_measure || 'وحدة',
      quantity: 1,
      unit_price: 0,
      discount_percent: 0,
      notes: '',
    });

    renderItemsTable();

    // مسح حقل البحث
    document.getElementById('quick-search').value = '';
    document.getElementById('quick-search-results').style.display = 'none';

    // التركيز على حقل الكمية للصف الجديد
    setTimeout(() => {
      const inputs = document.querySelectorAll('.item-quantity-input');
      if (inputs.length > 0) {
        inputs[inputs.length - 1].focus();
      }
    }, 50);
  };

  // ===== حفظ الفاتورة =====

  async function savePurchaseOrderDraft() {
    const supplierId = document.getElementById('supplier-select')?.value;
    if (!supplierId) {
      showNotification('يجب اختيار مورد', 'warning');
      return;
    }

    if (items.filter(i => i.product_id).length === 0) {
      showNotification('لا توجد بنود محددة', 'warning');
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال', 'error');
      return;
    }

    try {
      showNotification('جارٍ الحفظ...', 'info');

      const orderNumber = 'PO-' + new Date().toISOString().substr(0, 10).replace(/-/g, '') + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();

      const orderData = {
        id: crypto.randomUUID ? crypto.randomUUID() : orderNumber,
        tenant_id: tenantId,
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        order_number: orderNumber,
        order_date: new Date().toISOString(),
        status: 'pending',
        notes: (document.getElementById('notes')?.value || '').trim(),
        created_by: session?.id || 'system',
      };

      const { data: order, error: orderError } = await client
        .from('purchase_orders')
        .insert(orderData)
        .select('id,order_number')
        .single();

      if (orderError) {
        console.error('Error creating PO:', orderError);
        showNotification('خطأ: ' + (orderError.message || 'فشل الإنشاء'), 'error');
        return;
      }

      insertedId = order.id;

      // إضافة البنود
      const validItems = items.filter(i => i.product_id && Number(i.quantity) > 0);

      for (const item of validItems) {
        const qty = Number(item.quantity) || 0;
        const price = Number(item.unit_price) || 0;
        const discount = Number(item.discount_percent) || 0;

        await client.from('purchase_order_items').insert({
          id: crypto.randomUUID ? crypto.randomUUID() : 'POI-' + Date.now().toString(36),
          purchase_order_id: order.id,
          product_id: item.product_id,
          quantity: qty,
          unit_price: price,
          discount_percent: discount,
          subtotal: qty * price * (1 - discount / 100),
          notes: item.notes || '',
        });
      }

      showNotification(`تم إنشاء أمر الشراء ${order.order_number} كمسودة ✓`, 'success');
      setTimeout(() => navigate('/purchases/orders/' + order.id), 1500);
    } catch (e) {
      console.error('Error:', e);
      showNotification('خطأ: ' + (e.message || 'فشل الحفظ'), 'error');
    }
  }

  async function submitPurchaseOrder() {
    const supplierId = document.getElementById('supplier-select')?.value;
    if (!supplierId) {
      showNotification('يجب اختيار مورد', 'warning');
      return;
    }

    if (items.filter(i => i.product_id).length === 0) {
      showNotification('لا توجد بنود محددة', 'warning');
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال', 'error');
      return;
    }

    try {
      showNotification('جارٍ الإرسال...', 'info');

      const orderNumber = 'PO-' + new Date().toISOString().substr(0, 10).replace(/-/g, '') + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();

      const orderData = {
        id: crypto.randomUUID ? crypto.randomUUID() : orderNumber,
        tenant_id: tenantId,
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        order_number: orderNumber,
        order_date: new Date().toISOString(),
        status: 'pending_approval',
        notes: (document.getElementById('notes')?.value || '').trim(),
        created_by: session?.id || 'system',
      };

      const { data: order, error: orderError } = await client
        .from('purchase_orders')
        .insert(orderData)
        .select('id,order_number')
        .single();

      if (orderError) {
        console.error('Error creating PO:', orderError);
        showNotification('خطأ: ' + (orderError.message || 'فشل الإنشاء'), 'error');
        return;
      }

      insertedId = order.id;

      const validItems = items.filter(i => i.product_id && Number(i.quantity) > 0);

      for (const item of validItems) {
        const qty = Number(item.quantity) || 0;
        const price = Number(item.unit_price) || 0;
        const discount = Number(item.discount_percent) || 0;

        await client.from('purchase_order_items').insert({
          id: crypto.randomUUID ? crypto.randomUUID() : 'POI-' + Date.now().toString(36),
          purchase_order_id: order.id,
          product_id: item.product_id,
          quantity: qty,
          unit_price: price,
          discount_percent: discount,
          subtotal: qty * price * (1 - discount / 100),
          notes: item.notes || '',
        });
      }

      showNotification(`تم إرسال أمر الشراء ${order.order_number} للموافقة ✓`, 'success');
      setTimeout(() => navigate('/purchases/orders/' + order.id), 1500);
    } catch (e) {
      console.error('Error:', e);
      showNotification('خطأ: ' + (e.message || 'فشل الإرسال'), 'error');
    }
  }

  window.savePurchaseOrder = savePurchaseOrderDraft;
  window.submitPurchaseOrder = submitPurchaseOrder;

  // ===== مساعدة إضافية =====

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[<>"'&]/g, function(c) {
      return { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c];
    });
  }

  function generateRowId() {
    return 'row_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
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

  // ===== بدء =====

  renderPage();

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
    .badge {
      display: inline-block;
      padding: 0.2rem 0.5rem;
      border-radius: 3px;
      font-size: 0.8rem;
      font-weight: bold;
    }
    .badge-success { background: #16a34a; color: white; }
    .badge-warning { background: #d97706; color: white; }
    .badge-danger { background: #dc2626; color: white; }
    .badge-info { background: #2563eb; color: white; }
    .badge-secondary { background: #6b7280; color: white; }
    .badge-sm { padding: 0.15rem 0.4rem; font-size: 0.75rem; }
  `;
  document.head.appendChild(style);

})();
