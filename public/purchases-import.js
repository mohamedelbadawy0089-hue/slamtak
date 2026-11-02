// ============================================================
// وحدة استيراد من Excel وCSV
// يدعم drag-drop، رفع ملف، ومعالجة صيغ CSV/TSV وExcel (XLS/XLSX)
// ============================================================

(function() {
  'use strict';

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

  // نحدد إذا كان المستخدم ق��د.addAction إلى صفحة محددة
  let targetPage = null;
  if (path.includes('/new')) targetPage = 'new';
  else if (path.includes('/receiving')) targetPage = 'receiving';
  else if (path.includes('/orders')) targetPage = 'orders';

  // إضافة زر استيراد
  addImportButton();

  function addImportButton() {
    const btnContainer = document.querySelector('.card .btn-group') ||
                         document.querySelector('.card > div:first-child > div:last-child') ||
                         document.querySelector('h1 + div');

    if (!btnContainer) {
      // الميكانيزمة البعيدة: الإضافة إلى أي حاوية أزرار في الصفحة
      const cards = document.querySelectorAll('.card');
      for (const card of cards) {
        const headerDiv = card.querySelector('div:first-child');
        if (headerDiv) {
          const container = headerDiv.querySelector('div[style*="display:flex"]') ||
                           headerDiv.querySelector('.d-flex') ||
                           headerDiv;
          if (container && !container.querySelector('#import-file-btn')) {
            const importBtn = createImportButton(targetPage);
            container.appendChild(importBtn);
            break;
          }
        }
      }
    }
  }

  function createImportButton(targetPage) {
    const btn = document.createElement('button');
    btn.id = 'import-file-btn';
    btn.textContent = '📁';
    btn.title = 'استيراد من Excel أو CSV';
    btn.style.cssText = `
      padding: 0.5rem 0.75rem;
      background: #d97706;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 1rem;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    `;

    // إخفاءه إذا لم يكن الهدف معروفاً
    if (!targetPage) {
      btn.style.opacity = '0.5';
      btn.title += ' (توفتر على هذه الصفحة)';
    }

    btn.addEventListener('mouseenter', () => btn.style.background = '#b45309');
    btn.addEventListener('mouseleave', () => btn.style.background = '#d97706');
    btn.addEventListener('click', () => showImportModal(targetPage));

    return btn;
  }

  // عرض نموذج الاستيراد
  window.showImportModal = function(targetPage) {
    const isNewPage = targetPage === 'new';

    const overlay = document.createElement('div');
    overlay.id = 'import-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      z-index: 10000;
      display: flex;
      justify-content: center;
      align-items: center;
      animation: fadeIn 0.2s ease-in;
    `;

    overlay.innerHTML = `
      <div style="background:white;border-radius:8px;padding:1.5rem;max-width:600px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.2);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <h2 style="margin:0;font-size:1.3rem;color:#667eea;">📁 استيراد من Excel أو CSV</h2>
          <button style="background:none;border:none;font-size:1.5rem;cursor:pointer;" onclick="closeImportModal()">&times;</button>
        </div>

        <p style="color:#666;margin-bottom:1rem;">
          ارفع ملف CSV أو Excel (XLS/XLSX) يحتوي على أصناف المشتريات.
          <br>الملف يجب أن يحتوي على الأعمدة التالية (اختياري):
        </p>

        <div style="background:#f8f9fa;border:1px solid #ddd;border-radius:4px;padding:0.5rem 0.75rem;font-size:0.85rem;color:#666;margin-bottom:1rem;">
          <strong style="color:#333;">الأعمدة المدعومة:</strong>
          <code style="background:#eee;padding:0.1rem 0.3rem;border-radius:2px;">barcode</code> (الباركود) |
          <code style="background:#eee;padding:0.1rem 0.3rem;border-radius:2px;">sku</code> (الرمز) |
          <code style="background:#eee;padding:0.1rem 0.3rem;border-radius:2px;">name_ar</code> (الاسم العربي) |
          <code style="background:#eee;padding:0.1rem 0.3rem;border-radius:2px;">name</code> (الاسم الإنجليزي) |
          <code style="background:#eee;padding:0.1rem 0.3rem;border-radius:2px;">quantity</code> (الكمية) |
          <code style="background:#eee;padding:0.1rem 0.3rem;border-radius:2px;">price</code> (السعر) |
          <code style="background:#eee;padding:0.1rem 0.3rem;border-radius:2px;">batch_number</code> (رقم التشغيلة) |
          <code style="background:#eee;padding:0.1rem 0.3rem;border-radius:2px;">expiry_date</code> (تاريخ الانتهاء)
        </div>

        <div id="import-dropzone" style="border:2px dashed #667eea;border-radius:8px;padding:2rem;text-align:center;background:#f0f4ff;cursor:pointer;margin-bottom:1rem;transition:all 0.2s;">
          <div style="font-size:2rem;margin-bottom:0.5rem;">📄</div>
          <div style="color:#667eea;font-weight:bold;margin-bottom:0.25rem;">اسحب الملف هنا أو اضغط للتحميل</div>
          <div class="muted" style="font-size:0.85rem;">يدعم: CSV, TSV, XLS, XLSX (حتى 10 MB)</div>
          <input type="file" id="import-file-input" accept=".csv,.tsv,.xls,.xlsx" style="display:none;">
        </div>

        <div id="import-preview" style="display:none;border:1px solid #ddd;border-radius:4px;overflow:hidden;margin-bottom:1rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.75rem;background:#f8f9fa;border-bottom:1px solid #ddd;">
            <strong style="color:#667eea;">📋 معاينة البيانات:</strong>
            <span id="import-rows-count" class="muted"></span>
          </div>
          <div style="max-height:200px;overflow-y:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:0.85rem;" id="import-preview-table"></table>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-top:1rem;">
          <div>
            <label class="form-label" style="font-weight:bold;font-size:0.9rem;">خريطة الأعمدة (اختياري):</label>
            <select id="import-column-map" class="form-select"
              style="padding:0.3rem;border:1px solid #ddd;border-radius:3px;font-size:0.85rem;width:auto;display:inline-block;margin-top:0.25rem;">
              <option value="auto">-- اكتشاف تلقائي --</option>
              <option value="barcode">الباركود</option>
              <option value="sku">الرمز (SKU)</option>
              <option value="name_ar">الاسم العربي</option>
              <option value="name">الاسم الإنجليزي</option>
              <option value="quantity">الكمية</option>
              <option value="price">السعر</option>
            </select>
            <span class="muted" style="font-size:0.8rem;margin-left:0.5rem;">(اختر العمود الأساسي للبحث عن المنتج)</span>
          </div>
          <div style="display:flex;gap:0.5rem;">
            <button class="btn" onclick="closeImportModal()">إلغاء</button>
            <button class="btn primary" style="background:#667eea;" onclick="importFile()">✅ استيراد (${isNewPage ? 'إلى فاتورة جديدة' : 'إلى الاستلام'})</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // إعداد drag-drop
    const dropzone = document.getElementById('import-dropzone');
    const fileInput = document.getElementById('import-file-input');

    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.style.background = '#e0f2fe';
      dropzone.style.borderColor = '#2563eb';
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.style.background = '#f0f4ff';
      dropzone.style.borderColor = '#667eea';
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.style.background = '#f0f4ff';
      dropzone.style.borderColor = '#667eea';
      if (e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        handleFile(fileInput.files[0]);
      }
    });
  };

  window.closeImportModal = function() {
    const overlay = document.getElementById('import-overlay');
    if (overlay) overlay.remove();
  };

  function handleFile(file) {
    const maxSize = 10 * 1024 * 1024; // 10 MB
    if (file.size > maxSize) {
      showNotification('الملف كبير جداً (أكبر من 10 MB)', 'error');
      return;
    }

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'tsv', 'xls', 'xlsx'].includes(ext)) {
      showNotification('نوع الملف غير مدعوم. يرجى رفع CSV أو Excel.', 'error');
      return;
    }

    const dropzone = document.getElementById('import-dropzone');
    const preview = document.getElementById('import-preview');
    const previewTable = document.getElementById('import-preview-table');
    const rowsCount = document.getElementById('import-rows-count');

    if (preview) preview.style.display = 'block';
    if (dropzone) dropzone.style.display = 'none';

    rowsCount.textContent = 'جارٍ معالجة...';

    const reader = new FileReader();

    reader.onload = function(e) {
      try {
        if (ext === 'csv' || ext === 'tsv') {
          processCSVContent(e.target.result, ext);
        } else if (ext === 'xls' || ext === 'xlsx') {
          // Excel requires SheetJS library
          if (typeof XLSX === 'undefined') {
            // محاولة تحميل مكتبة SheetJS
            loadSheetJS(() => processExcel(e.target.result));
          } else {
            processExcel(e.target.result);
          }
        }
      } catch (err) {
        console.error('Parse error:', err);
        showNotification('خطأ في معالجة الملف: ' + err.message, 'error');
        resetDropzone();
      }
    };

    if (ext === 'csv' || ext === 'tsv') {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  }

  function loadSheetJS(callback) {
    const script = document.createElement('script');
    script.src = 'https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js';
    script.onload = callback;
    script.onerror = () => {
      showNotification('لم يتم تحميل مكتبة Excel. حاول استخدام CSV.', 'warning');
    };
    document.head.appendChild(script);
  }

  function parseCSV(content, delimiter) {
    const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) return { headers: [], rows: [] };

    const separator = delimiter === 'tsv' ? '\t' : ',';
    const parseLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === separator && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());

      // دمج الخلايا الفارغة في النهاية
      return result;
    };

    const headers = parseLine(lines[0]);
    const rows = lines.slice(1).map(line => {
      const values = parseLine(line);
      const obj = {};
      headers.forEach((header, i) => {
        obj[header] = values[i] || '';
      });
      return obj;
    });

    return { headers, rows };
  }

  function processCSVContent(content, ext) {
    const { headers, rows } = parseCSV(content, ext);

    if (rows.length === 0) {
      showNotification('الملف فارغ أو غير صحيح', 'error');
      resetDropzone();
      return;
    }

    displayPreview(headers, rows);
    storeParsedData({ headers, rows });
  }

  function processExcel(arrayBuffer) {
    if (typeof XLSX === 'undefined') {
      showNotification('يلزم تحميل مكتبة Excel أولاً', 'warning');
      return;
    }

    try {
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length === 0) {
        showNotification('الملف فارغ', 'error');
        resetDropzone();
        return;
      }

      const headers = Object.keys(jsonData[0]);
      displayPreview(headers, jsonData);
      storeParsedData({ headers, rows: jsonData });
    } catch (err) {
      console.error('Excel error:', err);
      showNotification('خطأ في قراءة ملف Excel: ' + err.message, 'error');
      resetDropzone();
    }
  }

  let parsedData = null;

  function storeParsedData(data) {
    parsedData = data;
  }

  function displayPreview(headers, rows) {
    const previewTable = document.getElementById('import-preview-table');
    const rowsCount = document.getElementById('import-rows-count');

    if (!previewTable) return;

    // عرض أول 10 صفوف فقط
    const displayRows = rows.slice(0, 10);
    const remaining = rows.length - 10;

    let html = '<thead><tr>';
    headers.forEach(h => {
      html += `<th style="padding:0.3rem;background:#f8f9fa;border-bottom:1px solid #ddd;text-align:right;font-weight:bold;">${esc(h)}</th>`;
    });
    html += '</tr></thead><tbody>';

    displayRows.forEach(row => {
      html += '<tr>';
      headers.forEach(h => {
        html += `<td style="padding:0.25rem;border-bottom:1px solid #eee;text-align:right;">${esc(row[h] || '')}</td>`;
      });
      html += '</tr>';
    });

    if (remaining > 0) {
      html += `<tr><td colspan="${headers.length}" style="padding:0.5rem;text-align:center;background:#f0f4ff;color:#667eea;">
        ... +${remaining} صفوف أخرى
      </td></tr>`;
    }

    html += '</tbody>';

    previewTable.innerHTML = html;
    if (rowsCount) rowsCount.textContent = `${rows.length} صف${(rows.length !== 1) ? 'وف' : ''} (عرض первых 10)`;
  }

  async function importFile() {
    if (!parsedData || parsedData.rows.length === 0) {
      showNotification('لا توجد بيانات للاستيراد', 'warning');
      return;
    }

    const mapSelect = document.getElementById('import-column-map');
    const mapType = mapSelect ? mapSelect.value : 'auto';

    const { headers, rows } = parsedData;
    const client = getSupabaseClient();
    if (!client) {
      showNotification('خطأ في الاتصال بقاعدة البيانات', 'error');
      return;
    }

    const session = getCurrentSession();
    if (!session) {
      showNotification('يجب تسجيل الدخول أولاً', 'error');
      return;
    }

    try {
      showNotification('جارٍ البحث عن المنتجات...', 'info');

      let successful = 0;
      let failed = 0;
      let processed = 0;
      const total = rows.length;

      for (const row of rows) {
        processed++;

        // تحديد مصفف البحث
        let searchValue = null;

        if (mapType === 'auto') {
          // اكتشاف تلقائي - الباركود أولاً ثم الـ SKU
          searchValue = row['barcode'] || row['Barcode'] || row['BARCODE'] ||
                       row['sku'] || row['SKU'] || row['SKU'] ||
                       row['name_ar'] || row['Name_AR'] ||
                       row['name'] || row['Name'];
        } else if (mapType === 'barcode') {
          searchValue = row['barcode'] || row['Barcode'] || row['BARCODE'] || '';
        } else if (mapType === 'sku') {
          searchValue = row['sku'] || row['SKU'] || row['Sku'] || '';
        } else if (mapType === 'name_ar') {
          searchValue = row['name_ar'] || row['Name_AR'] || '';
        } else if (mapType === 'name') {
          searchValue = row['name'] || row['Name'] || row['NAME'] || '';
        }

        if (!searchValue) {
          failed++;
          continue;
        }

        // البحث عن المنتج
        const products = await searchProduct(searchValue);
        if (products.length === 0) {
          failed++;
          continue;
        }

        const product = products[0];

        // تحديد الكمية والسعر
        const quantity = Number(row['quantity'] || row['Quantity'] || row['QUANTITY'] || 1);
        const price = Number(row['price'] || row['Price'] || row['PRICE'] || 0);
        const batch = row['batch_number'] || row['Batch_Number'] || row['BATCH_NUMBER'] || '';
        const expiry = row['expiry_date'] || row['Expiry_Date'] || row['EXPIRY_DATE'] || '';

        if (targetPage === 'new') {
          // إضافة إلى الفاتورة الجديدة
          if (typeof window.addProductToNewOrder === 'function') {
            window.addProductToNewOrder({
              id: product.id,
              name: product.name,
              name_ar: product.name_ar || product.name,
              sku: product.sku || '',
              barcode: product.barcode || '',
              dosage_form: product.dosage_form || '',
              strength: product.strength || '',
              unit_of_measure: product.unit_of_measure || 'piece',
            });
            // تعديل الكمية والسعر
            setTimeout(() => {
              const inputs = document.querySelectorAll('.item-quantity-input');
              if (inputs.length > 0) inputs[inputs.length - 1].value = quantity;
              const priceInputs = document.querySelectorAll('.item-price-input');
              if (priceInputs.length > 0) priceInputs[priceInputs.length - 1].value = price;
            }, 100);
          }
        } else if (targetPage === 'receiving') {
          // إضافة إلى استلام بضائع
          if (typeof window.addEmptyRow === 'function') {
            window.addEmptyRow();
            setTimeout(() => {
              const skuInputs = document.querySelectorAll('.receive-sku-input');
              if (skuInputs.length > 0) skuInputs[skuInputs.length - 1].value = product.barcode || product.sku || '';
              const batchInputs = document.querySelectorAll('.receive-batch-input');
              if (batchInputs.length > 0) batchInputs[batchInputs.length - 1].value = batch;
              const expiryInputs = document.querySelectorAll('.receive-expiry-input');
              if (expiryInputs.length > 0) expiryInputs[expiryInputs.length - 1].value = expiry;
              setTimeout(() => {
                const qtyInputs = document.querySelectorAll('.receive-quantity-input');
                if (qtyInputs.length > 0) qtyInputs[qtyInputs.length - 1].value = quantity;
                qtyInputs[qtyInputs.length - 1]?.dispatchEvent(new Event('input'));
              }, 50);
            }, 50);
          }
        }

        successful++;
      }

      showNotification(`تم الاستيراد: ${successful} منتج${successful !== 1 ? 'ات' : ''}، ${failed} غير موجود${failed !== 1 ? 'ة' : ''}`, 'success');
      closeImportModal();
      resetDropzone();
    } catch (e) {
      console.error('Import error:', e);
      showNotification('خطأ: ' + (e.message || 'فشل الاستيراد'), 'error');
    }
  }

  window.importFile = importFile;

  async function searchProduct(query) {
    if (!query || query.trim() === '') return [];

    const client = getSupabaseClient();
    if (!client) return [];

    const exactRes = await client
      .from('products')
      .select('id,name,name_ar,scientific_name,barcode,sku,dosage_form,strength,unit_of_measure')
      .or(`barcode.eq.${query.trim()},sku.eq.${query.trim()}`)
      .eq('is_active', true)
      .limit(5);

    if (exactRes.data && exactRes.data.length > 0) return exactRes.data;

    const searchRes = await client
      .from('products')
      .select('id,name,name_ar,scientific_name,barcode,sku,dosage_form,strength,unit_of_measure')
      .ilike('name_ar', '%' + query.trim() + '%')
      .eq('is_active', true)
      .limit(5);

    if (searchRes.data && searchRes.data.length > 0) return searchRes.data;

    const enRes = await client
      .from('products')
      .select('id,name,name_ar,scientific_name,barcode,sku,dosage_form,strength,unit_of_measure')
      .ilike('name', '%' + query.trim() + '%')
      .eq('is_active', true)
      .limit(5);

    return (enRes.data && enRes.data.length > 0) ? enRes.data : [];
  }

  function resetDropzone() {
    parsedData = null;
    const dropzone = document.getElementById('import-dropzone');
    const preview = document.getElementById('import-preview');
    const fileInput = document.getElementById('import-file-input');

    if (dropzone) {
      dropzone.style.display = 'block';
      dropzone.style.background = '#f0f4ff';
      dropzone.style.borderColor = '#667eea';
    }
    if (preview) preview.style.display = 'none';
    if (fileInput) fileInput.value = '';
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

  const style = document.createElement('style');
  style.textContent = `
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    .form-label { display:block; margin-bottom:0.25rem; font-weight:bold; color:#333; font-size:0.9rem; }
    .form-select { padding:0.3rem;border:1px solid #ddd;border-radius:3px;font-size:0.85rem; }
    .form-select:focus { border-color:#667eea; outline:none; }
    .muted { color:#6b7280; font-size:0.85rem; }
  `;
  document.head.appendChild(style);

})();
