// ============================================================
// وحدة تقارير المخزون - FIFO/LIFO/الكلي مع تصدير PDF
// ============================================================

(function() {
  'use strict';

  let inventoryData = [];
  let fifoReport = null;
  let lifoReport = null;
  let totalValue = 0;

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

  const path = window.location.pathname;
  if (!path.startsWith('/purchases')) return;

  const sectionBody = document.getElementById('section-body');
  if (!sectionBody) return;

  // إضافة أزرار التقارير
  addReportButtons();

  function addReportButtons() {
    // إضافة إلى زر الإجراءات
    const actionContainer = document.querySelector('.card .btn-group') ||
                           document.querySelector('.stat-card + div') ||
                           document.querySelector('h1 + div > div:last-child');

    if (!actionContainer) {
      const cards = document.querySelectorAll('.card');
      for (const card of cards) {
        const headerDiv = card.querySelector('div:first-child');
        if (headerDiv) {
          const btnGroup = headerDiv.querySelector('.btn-group') ||
                          headerDiv.querySelector('div:last-child > div:last-child');
          if (btnGroup && !btnGroup.querySelector('#report-menu-btn')) {
            const menuBtn = createReportButton();
            btnGroup.appendChild(menuBtn);
            break;
          }
        }
      }
    }
  }

  function createReportButton() {
    const btn = document.createElement('button');
    btn.id = 'report-menu-btn';
    btn.innerHTML = '📊<span style="margin-left:0.3rem;">تقارير</span>';
    btn.style.cssText = `
      padding: 0.5rem 0.75rem;
      background: #7c3aed;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
      font-weight: bold;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
    `;
    btn.addEventListener('mouseenter', () => btn.style.background = '#6d28d9');
    btn.addEventListener('mouseleave', () => btn.style.background = '#7c3aed');
    btn.addEventListener('click', showReportMenu);
    return btn;
  }

  function showReportMenu() {
    const existing = document.getElementById('report-menu-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'report-menu-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5);
      z-index: 10000;
      display: flex;
      justify-content: center;
      align-items: center;
      animation: fadeIn 0.2s ease-in;
    `;

    overlay.innerHTML = `
      <div style="background:white;border-radius:12px;padding:1.5rem;max-width:500px;width:90%;box-shadow:0 10px 40px rgba(0,0,0,0.3);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
          <h2 style="margin:0;font-size:1.3rem;color:#7c3aed;">📊 تقارير المخزون</h2>
          <button style="background:none;border:none;font-size:1.5rem;cursor:pointer;" onclick="closeReportMenu()">&times;</button>
        </div>

        <div style="display:grid;gap:0.75rem;">
          <button class="report-option" onclick="loadInventoryData('total')">
            <div style="padding:1rem;background:#f0f4ff;border-radius:8px;border-left:4px solid #2563eb;display:flex;justify-content:space-between;">
              <div style="display:flex;flex-direction:column;">
                <strong style="font-size:1.1rem;color:#1e40af;">📋 تقرير المخزون الكلي</strong>
                <span class="muted" style="font-size:0.85rem;">قائمة جميع المنتجات مع الكميات والقيم</span>
              </div>
              <div style="font-size:1.5rem;color:#2563eb;">📋</div>
            </div>
          </button>

          <button class="report-option" onclick="loadInventoryData('fifo')">
            <div style="padding:1rem;background:#f0fdf4;border-radius:8px;border-left:4px solid #16a34a;display:flex;justify-content:space-between;">
              <div style="display:flex;flex-direction:column;">
                <strong style="font-size:1.1rem;color:#15803d;">🔄 تقرير محسوب FIFO</strong>
                <span class="muted" style="font-size:0.85rem;">نفقات First-In-First-Out للبضائع المستلمة</span>
              </div>
              <div style="font-size:1.5rem;color:#16a34a;">FIFO</div>
            </div>
          </button>

          <button class="report-option" onclick="loadInventoryData('lifo')">
            <div style="padding:1rem;background:#fef2f2;border-radius:8px;border-left:4px solid #dc2626;display:flex;justify-content:space-between;">
              <div style="display:flex;flex-direction:column;">
                <strong style="font-size:1.1rem;color:#b91c1c;">🎯 تقرير محسوب LIFO</strong>
                <span class="muted" style="font-size:0.85rem;">نفقات Last-In-First-Out للبضائع المستلمة</span>
              </div>
              <div style="font-size:1.5rem;color:#dc2626;">LIFO</div>
            </div>
          </button>

          <button class="report-option" onclick="loadInventoryData('valuation')">
            <div style="padding:1rem;background:#faf5ff;border-radius:8px;border-left:4px solid #7c3aed;display:flex;justify-content:space-between;">
              <div style="display:flex;flex-direction:column;">
                <strong style="font-size:1.1rem;color:#5b21b6;">💰 تقرير تقييم المخزون</strong>
                <span class="muted" style="font-size:0.85rem;">قيمة المخزون حسب طرق التقييم المختلفة</span>
              </div>
              <div style="font-size:1.5rem;color:#7c3aed;">💰</div>
            </div>
          </button>
        </div>

        <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid #eee;display:flex;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;">
          <div style="display:flex;gap:0.5rem;">
            <button class="btn secondary" onclick="exportPDF('total')">📄 تصدير PDF (الكلي)</button>
            <button class="btn primary" onclick="exportPDF('fifo')" style="background:#2563eb;">📄 PDF FIFO</button>
            <button class="btn danger" onclick="exportPDF('lifo')" style="background:#dc2626;">📄 PDF LIFO</button>
          </div>
          <button class="btn" onclick="closeReportMenu()">✖️ إغلاق</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  window.closeReportMenu = function() {
    const overlay = document.getElementById('report-menu-overlay');
    if (overlay) overlay.remove();
  };

  async function loadInventoryData(method) {
    showNotification('جارٍ تحميل بيانات المخزون...', 'info');

    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال', 'error');
      return;
    }

    try {
      // جلب جميع المنتجات
      const productsRes = await client
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('name')
        .limit(2000);

      const products = productsRes.data || [];

      // جلب المخزون لكل منتج
      const warehouseId = getCurrentSession()?.warehouse_id;

      const inventoryPromises = products.map(product => {
        const query = client.from('inventory')
          .select('*')
          .eq('product_id', product.id);

        if (warehouseId) {
          return query.eq('warehouse_id', warehouseId).single();
        }
        return query.single();
      });

      const inventoryResults = await Promise.all(inventoryPromises);
      const inventory = inventoryResults
        .filter(r => r.data && r.data.quantity > 0)
        .map(r => ({
          product: products.find(p => p.id === r.data.product_id),
          inv: r.data,
        }))
        .filter(item => item.product);

      inventoryData = inventory;
      totalValue = inventory.reduce((sum, item) => {
        return sum + (Number(item.inv.quantity) || 0) * (Number(item.inv.unit_cost) || Number(item.product.latest_purchase_price) || 0);
      }, 0);

      // حساب FIFO/LIFO إذا كان المطلوب
      if (method === 'fifo' || method === 'lifo' || method === 'valuation') {
        await calculateValuation(method);
      }

      showReportView(method);
    } catch (e) {
      console.error('Error:', e);
      showNotification('خطأ: ' + (e.message || 'فشل التحميل'), 'error');
    }
  }

  async function calculateValuation(method) {
    const client = getSupabaseClient();
    if (!client) return;

    try {
      const goodsReceiptsRes = await client
        .from('goods_receipts')
        .select('*')
        .order('created_at', { ascending: true });

      const receipts = goodsReceiptsRes.data || [];

      // تجميع البيانات حسب الصنف
      const itemsByProduct = {};

      for (const receipt of receipts) {
        if (!receipt.items) continue;
        for (const item of receipt.items) {
          if (!item.product_id) continue;
          if (!itemsByProduct[item.product_id]) {
            itemsByProduct[item.product_id] = {
              fifo: [],
              lifo: [],
              totalCost: 0,
              totalQty: 0,
            };
          }
          const cost = Number(item.unit_price) || 0;
          const qty = Number(item.quantity) || 0;

          itemsByProduct[item.product_id].fifo.push({ qty, cost });
          itemsByProduct[item.product_id].lifo.push({ qty, cost });
          itemsByProduct[item.product_id].totalCost += cost * qty;
          itemsByProduct[item.product_id].totalQty += qty;
        }
      }

      // حساب FIFO
      const fifoData = [];
      for (const [productId, data] of Object.entries(itemsByProduct)) {
        let remainingQty = 0;
        let fifoCost = 0;

        // FIFO: تأخذ الكميات من oldest إلى newest
        for (const receiptItem of data.fifo) {
          const take = Math.min(remainingQty + receiptItem.qty, receiptItem.qty);
          fifoCost += take * receiptItem.cost;
          remainingQty += receiptItem.qty;
        }

        // LIFO: تأخذ الكميات من newest إلى oldest
        let lifoCost = 0;
        let remainingQtyLIFO = data.lifo.reduce((sum, r) => sum + r.qty, 0);
        for (let i = data.lifo.length - 1; i >= 0; i--) {
          const item = data.lifo[i];
          const take = Math.min(remainingQtyLIFO, item.qty);
          lifoCost += take * item.cost;
          remainingQtyLIFO -= take;
          if (remainingQtyLIFO <= 0) break;
        }

        fifoData.push({
          product_id: productId,
          fifo_cost: fifoCost,
          lifo_cost: lifoCost,
          total_qty: data.totalQty,
          avg_cost: data.totalCost / data.totalQty,
        });
      }

      fifoReport = fifoData;
      lifoReport = fifoData;

      // حساب إجمالي القيمة
      totalValue = fifoData.reduce((sum, item) => sum + item.fifo_cost, 0);
    } catch (e) {
      console.error('Error calculating valuation:', e);
    }
  }

  window.loadInventoryData = loadInventoryData;

  function showReportView(method) {
    const sectionBody = document.getElementById('section-body');
    if (!sectionBody) return;

    const title = method === 'total' ? '📋 تقرير المخزون الكلي' :
                  method === 'fifo' ? '🔄 تقرير محسوب FIFO (First-In-First-Out)' :
                  method === 'lifo' ? '🎯 تقرير محسوب LIFO (Last-In-First-Out)' :
                  '💰 تقرير تقييم المخزون';

    let reportRows = '';
    let grandTotal = 0;

    if (method === 'total') {
      inventoryData.forEach((item, index) => {
        const qty = Number(item.inv.quantity) || 0;
        const unitCost = Number(item.inv.unit_cost) || Number(item.product.latest_purchase_price) || 0;
        const total = qty * unitCost;
        grandTotal += total;

        reportRows += `
          <tr>
            <td style="padding:0.4rem;text-align:center;width:30px;">${index + 1}</td>
            <td style="padding:0.4rem;width:120px;">
              <strong style="color:#667eea;">${esc(item.product.name_ar || item.product.name)}</strong>
              <div class="muted" style="font-size:0.8rem;">${esc(item.product.sku || item.product.barcode || '')}</div>
            </td>
            <td style="padding:0.4rem;text-align:right;">${esc(item.product.dosage_form || '')}${item.product.strength ? ' ' + item.product.strength : ''}</td>
            <td style="padding:0.4rem;text-align:right;">${esc(item.product.unit_of_measure || 'وحدة')}</td>
            <td style="padding:0.4rem;text-align:right;font-weight:bold;">${qty}</td>
            <td style="padding:0.4rem;text-align:right;">${formatCurrency(unitCost)}</td>
            <td style="padding:0.4rem;text-align:right;font-weight:bold;color:#16a34a;">${formatCurrency(total)}</td>
          </tr>
        `;
      });
    } else if (method === 'fifo') {
      // FIFO report
      for (const product of inventoryData) {
        const fifoItem = fifoReport?.find(f => f.product_id === product.product.id);
        if (!fifoItem) continue;

        grandTotal += fifoItem.fifo_cost;

        reportRows += `
          <tr>
            <td style="padding:0.4rem;text-align:center;width:30px;">${index + 1}</td>
            <td style="padding:0.4rem;">
              <strong style="color:#667eea;">${esc(product.product.name_ar || product.product.name)}</strong>
              <div class="muted" style="font-size:0.8rem;">${esc(product.product.sku || product.product.barcode || '')}</div>
            </td>
            <td style="padding:0.4rem;text-align:right;">${fifoItem.total_qty} وحدة</td>
            <td style="padding:0.4rem;text-align:right;">${formatCurrency(fifoItem.fifo_cost)}</td>
            <td style="padding:0.4rem;text-align:right;font-weight:bold;color:#16a34a;">${formatCurrency(fifoItem.fifo_cost)}</td>
          </tr>
        `;
      }
    } else if (method === 'lifo') {
      for (const product of inventoryData) {
        const lifoItem = lifoReport?.find(l => l.product_id === product.product.id);
        if (!lifoItem) continue;

        grandTotal += lifoItem.lifo_cost;

        reportRows += `
          <tr>
            <td style="padding:0.4rem;text-align:center;width:30px;">${index + 1}</td>
            <td style="padding:0.4rem;">
              <strong style="color:#667eea;">${esc(product.product.name_ar || product.product.name)}</strong>
              <div class="muted" style="font-size:0.8rem;">${esc(product.product.sku || product.product.barcode || '')}</div>
            </td>
            <td style="padding:0.4rem;text-align:right;">${lifoItem.total_qty} وحدة</td>
            <td style="padding:0.4rem;text-align:right;">${formatCurrency(lifoItem.lifo_cost)}</td>
            <td style="padding:0.4rem;text-align:right;font-weight:bold;color:#dc2626;">${formatCurrency(lifoItem.lifo_cost)}</td>
          </tr>
        `;
      }
    } else if (method === 'valuation') {
      // تقرير التقييم - مقارنة الطرق
      inventoryData.forEach((item, index) => {
        const fifoItem = fifoReport?.find(f => f.product_id === item.product.id);
        const lifoItem = lifoReport?.find(l => l.product_id === item.product.id);
        const fifoVal = fifoItem ? fifoItem.fifo_cost : 0;
        const lifoVal = lifoItem ? lifoItem.lifo_cost : 0;
        const avgVal = (fifoVal + lifoVal) / 2;

        grandTotal += avgVal;

        reportRows += `
          <tr>
            <td style="padding:0.4rem;text-align:center;width:30px;">${index + 1}</td>
            <td style="padding:0.4rem;">
              <strong style="color:#667eea;">${esc(item.product.name_ar || item.product.name)}</strong>
            </td>
            <td style="padding:0.4rem;text-align:right;">${formatCurrency(fifoVal)}</td>
            <td style="padding:0.4rem;text-align:right;">${formatCurrency(lifoVal)}</td>
            <td style="padding:0.4rem;text-align:right;font-weight:bold;">${formatCurrency(avgVal)}</td>
          </tr>
        `;
      });
    }

    sectionBody.innerHTML = `
      <div class="card" style="animation:fadeIn 0.3s ease-in;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
          <h1 style="margin:0;font-size:1.3rem;">${title}</h1>
          <div style="display:flex;gap:0.5rem;">
            <button class="btn" onclick="downloadAsPDF()" style="background:#667eea;color:white;">📄 حفظ كـ PDF</button>
            <button class="btn" onclick="printReport()">🖨️ طباعة</button>
            <button class="btn" onclick="closeReportMenu()">🔙 إغلاق</button>
          </div>
        </div>

        <div style="background:#f8f9fa;border-radius:8px;padding:1rem;margin-bottom:1rem;">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem;">
            <div style="padding:0.75rem;background:#667eea;border-radius:6px;text-align:center;color:white;">
              <div class="muted" style="color:rgba(255,255,255,0.8);font-size:0.85rem;">إجمالي المنتجات</div>
              <div style="font-size:1.5rem;font-weight:bold;">${inventoryData.length}</div>
            </div>
            <div style="padding:0.75rem;background:#2563eb;border-radius:6px;text-align:center;color:white;">
              <div class="muted" style="color:rgba(255,255,255,0.8);font-size:0.85rem;">إجمالي الكمية</div>
              <div style="font-size:1.5rem;font-weight:bold;">${inventoryData.reduce((sum, i) => sum + (Number(i.inv.quantity) || 0), 0)}</div>
            </div>
            <div style="padding:0.75rem;background:#16a34a;border-radius:6px;text-align:center;color:white;">
              <div class="muted" style="color:rgba(255,255,255,0.8);font-size:0.85rem;">إجمالي القيمة (جنيه)</div>
              <div style="font-size:1.5rem;font-weight:bold;">${formatCurrency(grandTotal)}</div>
            </div>
          </div>
        </div>

        <div style="overflow-x:auto;border:1px solid #ddd;border-radius:8px;">
          <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
            <thead>
              <tr style="background:#f8f9fa;border-bottom:2px solid #ddd;text-align:right;">
                <th style="padding:0.5rem;width:30px;">#</th>
                <th style="padding:0.5rem;">🧪 المنتج</th>
                ${method === 'total' ? '<th style="padding:0.5rem;width:150px;">📦 النوع</th><th style="padding:0.5rem;width:80px;">الوحدة</th>' : ''}
                <th style="padding:0.5rem;width:100px;">الكمية</th>
                <th style="padding:0.5rem;width:100px;">${method === 'total' ? 'سعر الوحدة' : 'الكمية'}</th>
                <th style="padding:0.5rem;width:120px;">${method === 'valuation' ? 'FIFO' : method === 'total' ? 'الإجمالي' : 'القيمة (FIFO)'}</th>
                ${method === 'valuation' ? '<th style="padding:0.5rem;width:120px;">LIFO</th><th style="padding:0.5rem;width:120px;">المتوسط</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${reportRows}
            </tbody>
            <tfoot style="border-top:2px solid #333;background:#f8f9fa;">
              <tr>
                <td colspan="${method === 'valuation' ? '5' : '7'}" style="padding:0.75rem;font-weight:bold;text-align:right;">
                  إجمالي: ${formatCurrency(grandTotal)} جنيه
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `;

    // تخزين البيانات للـ PDF
    window._reportData = {
      title: title,
      method: method,
      inventoryData: inventoryData,
      fifoReport: fifoReport,
      lifoReport: lifoReport,
      grandTotal: grandTotal,
      reportRows: reportRows,
    };

    addReportToMenu(method);
  }

  function addReportToMenu(method) {
    const menu = document.getElementById('report-menu-overlay');
    if (!menu) return;

    // تحديث الأزرار
    const reportOptions = menu.querySelectorAll('.report-option');
    reportOptions.forEach((opt, i) => {
      opt.onclick = () => loadInventoryData(['total', 'fifo', 'lifo', 'valuation'][i]);
    });
  }

  window.exportPDF = function(method) {
    if (!window._reportData || window._reportData.method !== method) {
      loadInventoryData(method);
      // ننتظر قليلاً ثم نحمّل
      setTimeout(() => generatePDF(), 500);
    } else {
      generatePDF();
    }
  };

  window.printReport = function() {
    window.print();
  };

  window.downloadAsPDF = function() {
    generatePDF();
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

  function generatePDF() {
    const data = window._reportData;
    if (!data) {
      showNotification('لا توجد بيانات للتقرير', 'warning');
      return;
    }

    showNotification('جارٍ إنشاء PDF...', 'info');

    // استخدام html2canvas + jsPDF إذا كانت متاحة
    if (typeof html2canvas === 'undefined' || typeof jsPDF === 'undefined') {
      // تحميل المكتبات
      loadPDFLibraries(() => generatePDF());
      return;
    }

    const content = document.querySelector('.card');
    if (!content) {
      showNotification('لا يوجد تقرير لعرضه', 'error');
      return;
    }

    html2canvas(content, {
      scale: 2,
      useCORS: true,
      logging: false,
    }).then(canvas => {
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
      });

      const imgWidth = 297;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pdf.internal.pageSize.height;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pdf.internal.pageSize.height;
      }

      const fileName = `inventory_report_${data.method}_${new Date().toISOString().substr(0, 10)}.pdf`;
      pdf.save(fileName);
      showNotification('تم إنشاء PDF ✓', 'success');
    }).catch(err => {
      console.error('PDF error:', err);
      showNotification('خطأ في إنشاء PDF: ' + err.message, 'error');
    });
  }

  function loadPDFLibraries(callback) {
    if (typeof window.html2canvas_loaded === 'undefined') {
      const h2c = document.createElement('script');
      h2c.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
      h2c.onload = () => {
        window.html2canvas_loaded = true;
        loadJSPDF(callback);
      };
      h2c.onerror = () => {
        showNotification('فشل تحميل html2canvas', 'error');
      };
      document.head.appendChild(h2c);
    } else {
      loadJSPDF(callback);
    }
  }

  function loadJSPDF(callback) {
    if (typeof window.jsPDF_loaded === 'undefined') {
      const jsPDF = document.createElement('script');
      jsPDF.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      jsPDF.onload = () => {
        window.jsPDF_loaded = true;
        callback();
      };
      jsPDF.onerror = () => {
        showNotification('فشل تحميل jsPDF', 'error');
      };
      document.head.appendChild(jsPDF);
    } else {
      callback();
    }
  }

  const style = document.createElement('style');
  style.textContent = `
    .report-option {
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 0.5rem;
      cursor: pointer;
      text-align: left;
      transition: all 0.2s;
      width: 100%;
    }
    .report-option:hover {
      border-color: #7c3aed;
      box-shadow: 0 2px 8px rgba(124,58,237,0.15);
      transform: translateY(-2px);
    }
    .muted {
      color: #6b7280;
      font-size: 0.85rem;
    }
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
