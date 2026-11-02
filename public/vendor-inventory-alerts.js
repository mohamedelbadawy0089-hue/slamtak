// ============================================================
// تقارير الموردين + differed المخزون + تنبيهات إعادة الطلب
// نسخة مصلحة بدون recursion
// ============================================================

(function() {
  'use strict';

  // ===== الحالة =====
  let vendorSpendData = [];
  let inventoryVarianceData = [];
  let lowStockAlerts = [];
  let isLoading = false;

  // ===== utility functions =====
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/[<>"'&]/g, function(c) {
      return { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c];
    });
  }

  function formatCurrency(amount) {
    return (amount || 0).toFixed(2);
  }

  function formatNumber(num, decimal) {
    decimal = decimal || 0;
    return Number(num || 0).toFixed(decimal);
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
  const path = window.location.pathname;
  if (!path.startsWith('/purchases')) return;

  const sectionBody = document.getElementById('section-body');
  if (!sectionBody) return;

  let initialType = 'dashboard';
  if (path.includes('/vendors') || path.includes('/spend')) initialType = 'vendors';
  else if (path.includes('/variance') || path.includes('/difference')) initialType = 'variance';
  else if (path.includes('/low-stock') || path.includes('/alerts')) initialType = 'alerts';

  // تعطيل إعادة التشغيل التلقائي
  let initialized = false;

  function init() {
    if (initialized) return;
    initialized = true;

    addNavigationButtons(sectionBody);
    loadAllData().then(() => {
      renderSection(initialType);
    });
  }

  init();

  // ===== navigation buttons =====
  function addNavigationButtons(container) {
    if (container.querySelector('#vendor-reports-nav')) return; // لا تضف مرتين

    const nav = document.createElement('div');
    nav.id = 'vendor-reports-nav';
    nav.style.cssText = `
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    `;

    const tabs = [
      { id: 'dashboard', label: '📊 لوحة التحكم' },
      { id: 'vendors', label: '🏭 تقارير الموردين' },
      { id: 'variance', label: '📈 differed المخزون' },
      { id: 'alerts', label: '📉 تنبيهات الطلب' },
    ];

    tabs.forEach(tab => {
      const btn = document.createElement('button');
      btn.textContent = tab.label;
      btn.dataset.tabId = tab.id;
      btn.style.cssText = `
        padding: 0.5rem 1rem;
        border: 1px solid #ddd;
        background: white;
        color: #333;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.9rem;
        font-weight: bold;
        transition: all 0.2s;
      `;

      btn.addEventListener('mouseenter', () => {
        btn.style.background = '#f0f4ff';
        btn.style.borderColor = '#667eea';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'white';
        btn.style.borderColor = '#ddd';
      });
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        const type = this.dataset.tabId;
        if (type && type !== currentDisplayedType) {
          currentDisplayedType = type;
          updateTabStyles();
          loadAllData().then(() => {
            renderSection(type);
          });
        }
      });

      nav.appendChild(btn);
    });

    container.insertBefore(nav, container.firstChild);
  }

  let currentDisplayedType = initialType;

  function updateTabStyles() {
    const container = document.getElementById('vendor-reports-nav');
    if (!container) return;

    container.querySelectorAll('button').forEach(btn => {
      const id = btn.dataset.tabId;
      btn.style.background = id === currentDisplayedType ? '#667eea' : 'white';
      btn.style.color = id === currentDisplayedType ? 'white' : '#333';
      btn.style.borderColor = id === currentDisplayedType ? '#667eea' : '#ddd';
    });
  }

  // ===== تحميل البيانات =====
  async function loadAllData() {
    if (isLoading) return Promise.resolve();
    if (vendorSpendData.length > 0 && inventoryVarianceData.length > 0) {
      // البيانات موجودة بالفعل
      return Promise.resolve();
    }

    isLoading = true;

    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال', 'error');
      isLoading = false;
      return;
    }

    try {
      // 1. أوامر الشراء
      const spendRes = await client
        .from('purchase_orders')
        .select(`
          id,
          order_number,
          order_date,
          status,
          total_amount,
          supplier_id,
          created_at,
          supplier:suppliers(id,name,name_ar,code,phone,email)
        `)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(500);

      vendorSpendData = spendRes.data || [];

      // 2. حساب differed المخزون
      await calculateInventoryVariance();

      // 3. تنبيهات نقص المخزون
      await loadLowStockAlerts();

    } catch (e) {
      console.error('Error loading data:', e);
      showNotification('خطأ في تحميل البيانات', 'error');
    } finally {
      isLoading = false;
    }
  }

  // ===== حساب differed المخزون =====
  async function calculateInventoryVariance() {
    const client = getSupabaseClient();
    if (!client) return;

    try {
      const productsRes = await client
        .from('products')
        .select(`
          *,
          inventory:inventory(quantity, unit_cost, last_counted_at),
          purchase_orders:purchase_order_items(quantity, unit_price, created_at)
        `)
        .eq('is_active', true)
        .limit(2000);

      const products = productsRes.data || [];

      inventoryVarianceData = products.map(product => {
        const inv = product.inventory?.[0] || null;
        const qtyInStock = Number(inv?.quantity) || 0;
        const avgCost = Number(inv?.unit_cost) || Number(product.latest_purchase_price) || 0;

        const purchases = product.purchase_orders || [];
        const totalPurchased = purchases.reduce((sum, p) => sum + (Number(p.quantity) || 0), 0);

        const expectedQty = totalPurchased;
        const varianceQty = qtyInStock - expectedQty;
        const varianceValue = varianceQty * avgCost;

        return {
          product_id: product.id,
          name: product.name_ar || product.name,
          sku: product.sku,
          barcode: product.barcode,
          dosage_form: product.dosage_form,
          strength: product.strength,
          unit_of_measure: product.unit_of_measure,
          qty_in_stock: qtyInStock,
          qty_purchased: totalPurchased,
          avg_cost: avgCost,
          variance_qty: varianceQty,
          variance_value: varianceValue,
          expected_qty: expectedQty,
        };
      }).filter(item => item.qty_in_stock > 0 || item.variance_qty !== 0);

    } catch (e) {
      console.error('Error calculating variance:', e);
    }
  }

  // ===== تنبيهات نقص المخزون =====
  async function loadLowStockAlerts() {
    const client = getSupabaseClient();
    if (!client) return;

    try {
      const productsRes = await client
        .from('products')
        .select(`
          *,
          inventory:inventory(quantity, unit_cost, last_counted_at),
          reorder_point,
          min_stock_level,
          max_stock_level
        `)
        .eq('is_active', true)
        .limit(2000);

      const products = productsRes.data || [];

      lowStockAlerts = products.map(product => {
        const inv = product.inventory?.[0] || null;
        const qtyInStock = Number(inv?.quantity) || 0;
        const reorderPoint = Number(product.reorder_point) || Number(product.min_stock_level) || 0;
        const maxLevel = Number(product.max_stock_level) || 0;

        let alertLevel = 'normal';

        if (qtyInStock <= 0) {
          alertLevel = 'out_of_stock';
        } else if (qtyInStock <= reorderPoint) {
          alertLevel = 'critical';
        } else if (qtyInStock <= reorderPoint * 1.5) {
          alertLevel = 'low';
        }

        const orderQuantity = maxLevel > 0
          ? Math.max(0, maxLevel - qtyInStock)
          : (reorderPoint > 0 ? reorderPoint * 2 : 0);

        return {
          product_id: product.id,
          name: product.name_ar || product.name,
          sku: product.sku,
          barcode: product.barcode,
          dosage_form: product.dosage_form,
          strength: product.strength,
          unit_of_measure: product.unit_of_measure,
          qty_in_stock: qtyInStock,
          reorder_point: reorderPoint,
          max_stock_level: maxLevel,
          alert_level: alertLevel,
          suggested_order_qty: orderQuantity,
          stock_status: qtyInStock <= 0 ? 'نفدت' :
                      qtyInStock <= reorderPoint ? 'حرج' :
                      qtyInStock <= reorderPoint * 1.5 ? 'منخفض' : 'طبيعي',
        };
      }).filter(item => item.alert_level !== 'normal');

      const priority = { 'out_of_stock': 0, 'critical': 1, 'low': 2 };
      lowStockAlerts.sort((a, b) => priority[a.alert_level] - priority[b.alert_level]);

    } catch (e) {
      console.error('Error loading alerts:', e);
    }
  }

  // ===== render functions =====
  function renderSection(type) {
    switch (type) {
      case 'vendors': return renderVendors();
      case 'variance': return renderVariance();
      case 'alerts': return renderAlerts();
      default: return renderDashboard();
    }
  }

  function renderDashboard() {
    const totalSpend = vendorSpendData.reduce((sum, v) => sum + (Number(v.total_amount) || 0), 0);
    const activeVendors = new Set(vendorSpendData.filter(v => v.supplier).map(v => v.supplier_id)).size;
    const totalProducts = inventoryVarianceData.length;
    const lowStockCount = lowStockAlerts.filter(a => a.alert_level === 'low').length;
    const criticalCount = lowStockAlerts.filter(a => a.alert_level === 'critical' || a.alert_level === 'out_of_stock').length;
    const outOfStockCount = lowStockAlerts.filter(a => a.alert_level === 'out_of_stock').length;

    sectionBody.innerHTML = `
      <div class="card" style="animation:fadeIn 0.3s ease-in;">
        <h1 style="margin:0 0 1rem 0;font-size:1.5rem;">📊 لوحة تحكم المشتريات</h1>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0.75rem;margin-bottom:1.5rem;">
          <div class="card stat-card" style="background:#667eea;text-align:center;">
            <div style="font-size:2rem;font-weight:bold;color:white;">${vendorSpendData.length}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">إجمالي الأوامر</div>
          </div>
          <div class="card stat-card" style="background:#2563eb;text-align:center;">
            <div style="font-size:2rem;font-weight:bold;color:white;">${formatCurrency(totalSpend)}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">إجمالي الإنفاق (جنيه)</div>
          </div>
          <div class="card stat-card" style="background:#16a34a;text-align:center;">
            <div style="font-size:2rem;font-weight:bold;color:white;">${activeVendors}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">عدد الموردون</div>
          </div>
          <div class="card stat-card" style="background:#7c3aed;text-align:center;">
            <div style="font-size:2rem;font-weight:bold;color:white;">${totalProducts}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">منتجات في المخزون</div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0.75rem;margin-bottom:1rem;">
          <div class="card stat-card" style="background:#d97706;text-align:center;">
            <div style="font-size:1.5rem;font-weight:bold;color:white;">${lowStockCount}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">منخفضة</div>
          </div>
          <div class="card stat-card" style="background:#dc2626;text-align:center;">
            <div style="font-size:1.5rem;font-weight:bold;color:white;">${criticalCount + outOfStockCount}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">حرجة / نفدت</div>
          </div>
          <div class="card stat-card" style="background:#dc2626;text-align:center;">
            <div style="font-size:1.5rem;font-weight:bold;color:white;">${outOfStockCount}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">نفدت من المخزون</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderVendors() {
    const vendorMap = new Map();

    vendorSpendData.forEach(order => {
      if (!order.supplier) return;
      const id = order.supplier_id;
      if (!vendorMap.has(id)) {
        vendorMap.set(id, {
          id: id,
          name: order.supplier.name_ar || order.supplier.name,
          code: order.supplier.code,
          phone: order.supplier.phone,
          email: order.supplier.email,
          totalOrders: 0,
          totalAmount: 0,
          pendingOrders: 0,
        });
      }
      const vendor = vendorMap.get(id);
      vendor.totalOrders++;
      vendor.totalAmount += Number(order.total_amount) || 0;
      if (order.status === 'pending' || order.status === 'pending_approval') {
        vendor.pendingOrders++;
      }
    });

    const vendors = Array.from(vendorMap.values());
    vendors.sort((a, b) => b.totalAmount - a.totalAmount);

    const totalSpendAll = vendors.reduce((sum, v) => sum + v.totalAmount, 0);
    const topVendor = vendors[0] || null;

    sectionBody.innerHTML = `
      <div class="card" style="animation:fadeIn 0.3s ease-in;">
        <h1 style="margin:0 0 1rem 0;font-size:1.5rem;">🏭 تقارير إيرادات الموردين 📊</h1>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:0.75rem;margin-bottom:1.5rem;">
          <div class="card stat-card" style="background:#667eea;text-align:center;">
            <div style="font-size:2rem;font-weight:bold;color:white;">${vendors.length}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">عدد الموردون</div>
          </div>
          <div class="card stat-card" style="background:#2563eb;text-align:center;">
            <div style="font-size:2rem;font-weight:bold;color:white;">${formatCurrency(totalSpendAll)}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">إجمالي الإنفاق (جنيه)</div>
          </div>
          <div class="card stat-card" style="background:#16a34a;text-align:center;">
            <div style="font-size:2rem;font-weight:bold;color:white;">${formatCurrency(vendors.length > 0 ? totalSpendAll / vendors.length : 0)}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">متوسط PER مورد</div>
          </div>
          <div class="card stat-card" style="background:#d97706;text-align:center;">
            <div style="font-size:2rem;font-weight:bold;color:white;">${formatCurrency(topVendor ? topVendor.totalAmount : 0)}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">أعلى مورد</div>
          </div>
        </div>

        <div style="overflow-x:auto;border:1px solid #ddd;border-radius:8px;">
          <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
            <thead>
              <tr style="background:#f8f9fa;border-bottom:2px solid #ddd;text-align:right;">
                <th style="padding:0.5rem;width:30px;">#</th>
                <th style="padding:0.5rem;">🏭 المورد</th>
                <th style="padding:0.5rem;width:80px;">كود</th>
                <th style="padding:0.5rem;width:100px;">📞 هاتف</th>
                <th style="padding:0.5rem;width:100px;">📧 بريد</th>
                <th style="padding:0.5rem;width:80px;">عدد الطلبات</th>
                <th style="padding:0.5rem;width:100px;">إجمالي المبلغ</th>
                <th style="padding:0.5rem;width:80px;">متوسط/طلب</th>
                <th style="padding:0.5rem;width:80px;">قيد الانتظار</th>
                <th style="padding:0.5rem;width:100px;">النسبة</th>
              </tr>
            </thead>
            <tbody>
              ${vendors.map((vendor, i) => `
                <tr style="border-bottom:1px solid #eee;${i === 0 ? 'background:#fef3c7;' : ''}">
                  <td style="padding:0.5rem;text-align:center;font-weight:bold;color:#667eea;">${i + 1}</td>
                  <td style="padding:0.5rem;">
                    <strong style="color:${i === 0 ? '#d97706' : '#333'};">${esc(vendor.name)}</strong>
                    ${i === 0 ? '<span class="badge badge-gold badge-sm" style="margin-left:0.3rem;">🏆 الأعلى</span>' : ''}
                  </td>
                  <td style="padding:0.5rem;font-size:0.85rem;color:#666;">${esc(vendor.code || '—')}</td>
                  <td style="padding:0.5rem;font-size:0.85rem;">${esc(vendor.phone || '—')}</td>
                  <td style="padding:0.5rem;font-size:0.85rem;color:#666;">${esc(vendor.email || '—')}</td>
                  <td style="padding:0.5rem;text-align:center;font-weight:bold;">${vendor.totalOrders}</td>
                  <td style="padding:0.5rem;text-align:right;font-weight:bold;color:#16a34a;">${formatCurrency(vendor.totalAmount)}</td>
                  <td style="padding:0.5rem;text-align:right;color:#666;">${formatCurrency(vendor.totalOrders > 0 ? vendor.totalAmount / vendor.totalOrders : 0)}</td>
                  <td style="padding:0.5rem;text-align:center;color:${vendor.pendingOrders > 0 ? '#d97706' : '#16a34a'};">
                    ${vendor.pendingOrders > 0 ? vendor.pendingOrders : '<span class="text-success">0</span>'}
                  </td>
                  <td style="padding:0.5rem;text-align:right;font-size:0.85rem;">
                    ${totalSpendAll > 0 ? (vendor.totalAmount / totalSpendAll * 100).toFixed(1) + '%' : '0%'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot style="background:#f8f9fa;border-top:2px solid #333;">
              <tr>
                <td colspan="6" style="padding:0.5rem;text-align:right;font-weight:bold;">المجموع الكلي:</td>
                <td style="padding:0.5rem;text-align:right;font-weight:bold;color:#16a34a;">${formatCurrency(totalSpendAll)}</td>
                <td colspan="2"></td>
                <td style="padding:0.5rem;text-align:right;font-weight:bold;color:#16a34a;">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style="margin-top:1rem;padding:1rem;background:#f0f9ff;border:2px solid #38bdf8;border-radius:8px;">
          <h3 style="margin:0 0 0.5rem 0;color:#0369a1;">📌 رؤى حول الموردين</h3>
          <ul style="margin:0;padding-left:1.5rem;color:#666;font-size:0.9rem;">
            <li>المورد الأول: ${topVendor ? esc(topVendor.name) : '—'} (${formatCurrency(topVendor ? topVendor.totalAmount : 0)} جنيه)</li>
            <li>عدد الطلبات: ${vendors.reduce((sum, v) => sum + v.totalOrders, 0)} طلبات إجمالاً</li>
            <li>متوسط قيمة الطلب: ${formatCurrency(vendors.length > 0 && vendors.reduce((sum, v) => sum + v.totalOrders, 0) > 0 ? totalSpendAll / vendors.reduce((sum, v) => sum + v.totalOrders, 0) : 0)} جنيه</li>
          </ul>
        </div>
      </div>
    `;
  }

  function renderVariance() {
    const significantVariance = inventoryVarianceData.filter(v => Math.abs(v.variance_qty) > 0);
    const totalVarianceValue = inventoryVarianceData.reduce((sum, v) => sum + v.variance_value, 0);

    sectionBody.innerHTML = `
      <div class="card" style="animation:fadeIn 0.3s ease-in;">
        <h1 style="margin:0 0 1rem 0;font-size:1.5rem;">📈 differed المخزون (المخزون الفعلي vs المتوقع)</h1>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0.75rem;margin-bottom:1.5rem;">
          <div class="card stat-card" style="background:#2563eb;text-align:center;">
            <div style="font-size:2rem;font-weight:bold;color:white;">${inventoryVarianceData.length}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">إجمالي المنتجات</div>
          </div>
          <div class="card stat-card" style="background:${totalVarianceValue >= 0 ? '#16a34a' : '#dc2626'};text-align:center;">
            <div style="font-size:2rem;font-weight:bold;color:white;">${formatCurrency(Math.abs(totalVarianceValue))}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">إجمالي differed القيمة (جنيه)</div>
          </div>
          <div class="card stat-card" style="background:#d97706;text-align:center;">
            <div style="font-size:2rem;font-weight:bold;color:white;">${significantVariance.length}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">منتجات فيها differed</div>
          </div>
        </div>

        <div style="overflow-x:auto;border:1px solid #ddd;border-radius:8px;">
          <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
            <thead>
              <tr style="background:#f8f9fa;border-bottom:2px solid #ddd;text-align:right;">
                <th style="padding:0.5rem;width:30px;">#</th>
                <th style="padding:0.5rem;">🧪 المنتج</th>
                <th style="padding:0.5rem;width:80px;">الباركود/SKU</th>
                <th style="padding:0.5rem;width:80px;">الكمية المتوقعة</th>
                <th style="padding:0.5rem;width:80px;">الكمية الفعلية</th>
                <th style="padding:0.5rem;width:80px;">differed الكمية</th>
                <th style="padding:0.5rem;width:80px;">سعر الوحدة</th>
                <th style="padding:0.5rem;width:100px;">differed القيمة</th>
                <th style="padding:0.5rem;width:100px;">الحالة</th>
              </tr>
            </thead>
            <tbody>
              ${inventoryVarianceData.map((item, i) => {
                const isNegative = item.variance_qty < 0;
                const isPositive = item.variance_qty > 0;
                return `
                  <tr style="border-bottom:1px solid #eee;${isNegative ? 'background:#fef2f2;' : (isPositive ? 'background:#f0fdf4;' : '')}">
                    <td style="padding:0.5rem;text-align:center;color:#667eea;">${i + 1}</td>
                    <td style="padding:0.5rem;">
                      <strong style="color:#333;">${esc(item.name)}</strong>
                      <div class="muted" style="font-size:0.8rem;">${esc(item.dosage_form || '')}${item.strength ? ' ' + item.strength : ''}</div>
                    </td>
                    <td style="padding:0.5rem;font-size:0.85rem;color:#666;">${esc(item.barcode || item.sku || '—')}</td>
                    <td style="padding:0.5rem;text-align:right;">${formatNumber(item.expected_qty)} ${item.unit_of_measure}</td>
                    <td style="padding:0.5rem;text-align:right;font-weight:bold;">${formatNumber(item.qty_in_stock)} ${item.unit_of_measure}</td>
                    <td style="padding:0.5rem;text-align:right;font-weight:bold;color:${isNegative ? '#dc2626' : (isPositive ? '#16a34a' : '#666')};">
                      ${isNegative ? '−' : ''}${formatNumber(Math.abs(item.variance_qty))} ${item.unit_of_measure}
                    </td>
                    <td style="padding:0.5rem;text-align:right;">${formatCurrency(item.avg_cost)}</td>
                    <td style="padding:0.5rem;text-align:right;font-weight:bold;color:${isNegative ? '#dc2626' : (isPositive ? '#16a34a' : '#666')};">
                      ${isNegative ? '−' : ''}${formatCurrency(Math.abs(item.variance_value))} جنيه
                    </td>
                    <td style="padding:0.5rem;text-align:center;">
                      ${isNegative ? '<span class="badge badge-danger badge-sm">نقص</span>' :
                        isPositive ? '<span class="badge badge-success badge-sm">فائض</span>' :
                        '<span class="badge badge-secondary badge-sm">متطابق</span>'}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        <div style="padding:1rem;background:#f8f9fa;border-radius:8px;">
          <h3 style="margin:0 0 0.5rem 0;color:#333;">📌 ملخص differed المخزون</h3>
          <ul style="margin:0;padding-left:1.5rem;color:#666;font-size:0.9rem;">
            <li>إجمالي differed الكمية: ${formatNumber(inventoryVarianceData.reduce((sum, v) => sum + v.variance_qty, 0))} وحدة</li>
            <li>إجمالي differed القيمة: ${formatCurrency(totalVarianceValue)} جنيه</li>
            <li>${significantVariance.length > 0 ? significantVariance.length + ' منتجات تحتاج مراجعة' : 'لا توجد differedات كبيرة'}</li>
          </ul>
        </div>
      </div>
    `;
  }

  function renderAlerts() {
    const outOfStock = lowStockAlerts.filter(a => a.alert_level === 'out_of_stock');
    const critical = lowStockAlerts.filter(a => a.alert_level === 'critical');
    const low = lowStockAlerts.filter(a => a.alert_level === 'low');
    const totalSuggestedOrder = lowStockAlerts.reduce((sum, a) => sum + a.suggested_order_qty, 0);

    sectionBody.innerHTML = `
      <div class="card" style="animation:fadeIn 0.3s ease-in;">
        <h1 style="margin:0 0 1rem 0;font-size:1.5rem;color:#dc2626;">📉 تنبيهات نقص المخزون ⚠</h1>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:0.75rem;margin-bottom:1.5rem;">
          <div class="card stat-card" style="background:#dc2626;text-align:center;">
            <div style="font-size:2rem;font-weight:bold;color:white;">${outOfStock.length}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">نفدت من المخزون</div>
          </div>
          <div class="card stat-card" style="background:#d97706;text-align:center;">
            <div style="font-size:2rem;font-weight:bold;color:white;">${critical.length}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">حرج (تحت نقطة إعادة الطلب)</div>
          </div>
          <div class="card stat-card" style="background:#f59e0b;text-align:center;">
            <div style="font-size:2rem;font-weight:bold;color:white;">${low.length}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">منخفضة</div>
          </div>
          <div class="card stat-card" style="background:#2563eb;text-align:center;">
            <div style="font-size:2rem;font-weight:bold;color:white;">${formatNumber(totalSuggestedOrder)}</div>
            <div class="muted" style="color:rgba(255,255,255,0.8);">إجمالي الكمية المقترحة للطلب</div>
          </div>
        </div>

        ${outOfStock.length > 0 ? `
          <div class="card" style="background:#fef2f2;border:2px solid #dc2626;border-left:6px solid #dc2626;margin-bottom:1rem;">
            <h3 style="margin:0 0 0.5rem 0;color:#dc2626;">🚨 منتجات نفدت من المخزون (${outOfStock.length})</h3>
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
                <thead>
                  <tr style="background:#fca5a5;border-bottom:2px solid #dc2626;text-align:right;">
                    <th style="padding:0.5rem;">المنتج</th>
                    <th style="padding:0.5rem;width:80px;">الباركود</th>
                    <th style="padding:0.5rem;width:80px;">الكمية</th>
                    <th style="padding:0.5rem;width:80px;">نقطة إعادة الطلب</th>
                    <th style="padding:0.5rem;width:100px;">الكمية المقترحة للطلب</th>
                    <th style="padding:0.5rem;width:80px;">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  ${outOfStock.map(item => `
                    <tr style="border-bottom:1px solid #fee2e2;">
                      <td style="padding:0.5rem;"><strong style="color:#991b1b;">${esc(item.name)}</strong></td>
                      <td style="padding:0.5rem;font-size:0.85rem;">${esc(item.barcode || item.sku || '—')}</td>
                      <td style="padding:0.5rem;text-align:right;font-weight:bold;color:#dc2626;">${formatNumber(item.qty_in_stock)}</td>
                      <td style="padding:0.5rem;text-align:right;">${formatNumber(item.reorder_point)}</td>
                      <td style="padding:0.5rem;text-align:right;font-weight:bold;color:#16a34a;">${formatNumber(item.suggested_order_qty)}</td>
                      <td style="padding:0.5rem;text-align:center;"><span class="badge badge-danger badge-sm">🚨 نفدت</span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}

        ${critical.length > 0 ? `
          <div class="card" style="background:#fff7ed;border:2px solid #d97706;border-left:6px solid #d97706;margin-bottom:1rem;">
            <h3 style="margin:0 0 0.5rem 0;color:#92400e;">⚠ منتجات حرج (${critical.length})</h3>
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
                <thead>
                  <tr style="background:#fde68a;border-bottom:2px solid #d97706;text-align:right;">
                    <th style="padding:0.5rem;">المنتج</th>
                    <th style="padding:0.5rem;width:80px;">الباركود</th>
                    <th style="padding:0.5rem;width:80px;">الكمية</th>
                    <th style="padding:0.5rem;width:80px;">نقطة إعادة الطلب</th>
                    <th style="padding:0.5rem;width:100px;">الكمية المقترحة للطلب</th>
                    <th style="padding:0.5rem;width:80px;">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  ${critical.map(item => `
                    <tr style="border-bottom:1px solid #fef3c7;">
                      <td style="padding:0.5rem;"><strong style="color:#92400e;">${esc(item.name)}</strong></td>
                      <td style="padding:0.5rem;font-size:0.85rem;">${esc(item.barcode || item.sku || '—')}</td>
                      <td style="padding:0.5rem;text-align:right;font-weight:bold;color:#d97706;">${formatNumber(item.qty_in_stock)}</td>
                      <td style="padding:0.5rem;text-align:right;">${formatNumber(item.reorder_point)}</td>
                      <td style="padding:0.5rem;text-align:right;font-weight:bold;color:#16a34a;">${formatNumber(item.suggested_order_qty)}</td>
                      <td style="padding:0.5rem;text-align:center;"><span class="badge badge-warning badge-sm">⚠ حرج</span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}

        ${low.length > 0 ? `
          <div class="card" style="background:#fefce8;border:2px solid #f59e0b;border-left:6px solid #f59e0b;">
            <h3 style="margin:0 0 0.5rem 0;color:#92400e;">📊 منتجات منخفضة (${low.length})</h3>
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
                <thead>
                  <tr style="background:#fde68a;border-bottom:2px solid #f59e0b;text-align:right;">
                    <th style="padding:0.5rem;">المنتج</th>
                    <th style="padding:0.5rem;width:80px;">الباركود</th>
                    <th style="padding:0.5rem;width:80px;">الكمية</th>
                    <th style="padding:0.5rem;width:80px;">نقطة إعادة الطلب</th>
                    <th style="padding:0.5rem;width:100px;">الكمية المقترحة للطلب</th>
                    <th style="padding:0.5rem;width:80px;">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  ${low.map(item => `
                    <tr style="border-bottom:1px solid #fef9c3;">
                      <td style="padding:0.5rem;"><strong style="color:#92400e;">${esc(item.name)}</strong></td>
                      <td style="padding:0.5rem;font-size:0.85rem;">${esc(item.barcode || item.sku || '—')}</td>
                      <td style="padding:0.5rem;text-align:right;font-weight:bold;color:#d97706;">${formatNumber(item.qty_in_stock)}</td>
                      <td style="padding:0.5rem;text-align:right;">${formatNumber(item.reorder_point)}</td>
                      <td style="padding:0.5rem;text-align:right;font-weight:bold;color:#16a34a;">${formatNumber(item.suggested_order_qty)}</td>
                      <td style="padding:0.5rem;text-align:center;"><span class="badge badge-warning badge-sm">📊 منخفض</span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}

        ${lowStockAlerts.length === 0 ? `
          <div class="card" style="background:#f0fdf4;border:2px solid #16a34a;border-left:6px solid #16a34a;text-align:center;padding:2rem;">
            <span style="font-size:3rem;">✅</span>
            <h3 style="margin:0.5rem 0;color:#166534;">كل المنتجات في مستوى ممتاز!</h3>
            <p class="muted" style="color:#166534;">لا توجد منتجات منخفضة أو حرجة أو نفدت</p>
          </div>
        ` : ''}

        <div style="margin-top:1rem;text-align:right;">
          <span class="muted">إجمالي الكمية المقترحة للطلب: <strong style="color:#16a34a;">${formatNumber(totalSuggestedOrder)} وحدة</strong></span>
        </div>
      </div>
    `;
  }

  // ===== إشعارات =====
  window.showNotification = function(message, type) {
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
  };

  // ===== CSS =====
  const style = document.createElement('style');
  style.textContent = `
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
      font-size: 0.85rem;
    }
    .badge {
      display: inline-block;
      padding: 0.15rem 0.4rem;
      border-radius: 3px;
      font-size: 0.75rem;
      font-weight: bold;
    }
    .badge-success { background: #16a34a; color: white; }
    .badge-danger { background: #dc2626; color: white; }
    .badge-warning { background: #d97706; color: white; }
    .badge-secondary { background: #6b7280; color: white; }
    .badge-gold { background: #d97706; color: white; }
    .text-success { color: #16a34a; font-weight: bold; }
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
  `;
  document.head.appendChild(style);

})();
