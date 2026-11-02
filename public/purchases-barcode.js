// ============================================================
// دعم مسح الباركود عبر كاميرا الموبايل
// يدعم HTML5 Barcode Detection API و zxing-js Fallback
// ============================================================

(function() {
  'use strict';

  let barcodeScannerActive = false;
  let scannerStream = null;
  let scannerVideo = null;

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

  // استCampaign الموديولات عبر المسارات
  const path = window.location.pathname;

  // إضافة زر مسح الباركود إلى صفحات المشتريات
  if (path.startsWith('/purchases')) {
    addBarcodeButton();
  }

  function addBarcodeButton() {
    // إضافة زر لمسح الباركود إلى لوحة الإدخال السريع
    const searchInput = document.getElementById('product-search-input') ||
                       document.getElementById('quick-search') ||
                       document.getElementById('receive-product-search');

    if (searchInput && !document.getElementById('barcode-scanner-btn')) {
      const wrapper = searchInput.parentElement || searchInput.closest('div') || searchInput;

      const scanBtn = document.createElement('button');
      scanBtn.id = 'barcode-scanner-btn';
      scanBtn.textContent = '📸';
      scanBtn.title = 'مسح باركود بالكاميرا';
      scanBtn.style.cssText = `
        padding: 0.5rem 0.75rem;
        background: #2563eb;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 1rem;
        transition: all 0.2s;
      `;
      scanBtn.addEventListener('mouseenter', () => scanBtn.style.background = '#1d4ed8');
      scanBtn.addEventListener('mouseleave', () => scanBtn.style.background = '#2563eb');
      scanBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startBarcodeScanner(searchInput);
      });

      // إدراج الزر قبل حقل البحث
      wrapper.insertBefore(scanBtn, searchInput);
    }

    // إضافة زر للجدول الخاص بالاستلام المباشر
    const receiveSearch = document.getElementById('receive-product-search');
    if (receiveSearch && !document.getElementById('receive-barcode-scanner-btn')) {
      const wrapper = receiveSearch.parentElement || receiveSearch.closest('div') || receiveSearch;

      const scanBtn = document.createElement('button');
      scanBtn.id = 'receive-barcode-scanner-btn';
      scanBtn.textContent = '📸';
      scanBtn.title = 'مسح باركود بالكاميرا';
      scanBtn.style.cssText = `
        padding: 0.5rem 0.75rem;
        background: #2563eb;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 1rem;
        transition: all 0.2s;
      `;
      scanBtn.addEventListener('mouseenter', () => scanBtn.style.background = '#1d4ed8');
      scanBtn.addEventListener('mouseleave', () => scanBtn.style.background = '#2563eb');
      scanBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startBarcodeScanner(receiveSearch);
      });

      wrapper.insertBefore(scanBtn, receiveSearch);
    }
  }

  // بدء مسح الباركود
  window.startBarcodeScanner = function(targetInput) {
    if (typeof targetInput === 'string') {
      targetInput = document.getElementById(targetInput);
    }
    if (!targetInput) targetInput = document.activeElement;

    if (barcodeScannerActive) {
      stopBarcodeScanner();
    }

    // إذا لم يكن هناك دعم للـ BarcodeDetector، نستخدم fallback
    if (!('BarcodeDetector' in window)) {
      showBarcodeScannerFallback(targetInput);
      return;
    }

    startNativeScanner(targetInput);
  };

  function startNativeScanner(targetInput) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showNotification('هذا المتصفح لا يدعم كاميرا الهاتف', 'error');
      return;
    }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        scannerStream = stream;

        const overlay = document.createElement('div');
        overlay.id = 'barcode-scanner-overlay';
        overlay.style.cssText = `
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.9);
          z-index: 10000;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        `;

        const video = document.createElement('video');
        video.id = 'barcode-scanner-video';
        video.style.cssText = `
          width: 100%;
          max-width: 600px;
          height: auto;
          border-radius: 8px;
          margin-bottom: 1rem;
        `;
        video.setAttribute('playsinline', '');
        video.setAttribute('autoplay', '');
        video.setAttribute('muted', '');
        video.srcObject = stream;
        overlay.appendChild(video);
        scannerVideo = video;

        const info = document.createElement('div');
        info.style.cssText = `
          color: white;
          font-size: 1.1rem;
          margin-bottom: 0.5rem;
          text-align: center;
        `;
        info.textContent = '📸 ضع الباركود أمام الكاميرا';
        overlay.appendChild(info);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✖️ إغلاق';
        closeBtn.style.cssText = `
          margin-top: 1rem;
          padding: 0.75rem 1.5rem;
          background: #dc2626;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 1rem;
        `;
        closeBtn.addEventListener('click', () => {
          stopBarcodeScanner();
        });
        overlay.appendChild(closeBtn);

        // إضافة overlay للصورة
        const scanArea = document.createElement('div');
        scanArea.id = 'barcode-scanner-area';
        scanArea.style.cssText = `
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 250px;
          height: 150px;
          border: 3px solid #22c55e;
          border-radius: 4px;
          box-shadow: 0 0 20px rgba(34,197,94,0.5);
        `;
        overlay.appendChild(scanArea);

        document.body.appendChild(overlay);

        // محاولة استخدام BarcodeDetector
        const barcodeDetector = new BarcodeDetector({
          formats: ['qr_code', 'code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_39', 'data_matrix']
        });

        let scanInterval = null;
        barcodeScannerActive = true;

        function scanFrame() {
          if (!barcodeScannerActive || !video || video.readyState < 2) {
            scanInterval = requestAnimationFrame(scanFrame);
            return;
          }

          try {
            barcodeDetector.detect(video).then(barcodes => {
              if (barcodes && barcodes.length > 0) {
                const value = barcodes[0].rawValue;
                stopBarcodeScanner();
                if (targetInput) {
                  targetInput.value = value;
                  targetInput.dispatchEvent(new Event('input', { bubbles: true }));
                  targetInput.dispatchEvent(new Event('change', { bubbles: true }));
                  targetInput.focus();
                }
                showNotification('تم مسح الباركود: ' + value, 'success');
                // تفعيل الحدث المناسب اعتماداً على السياق
                if (typeof window.handleQuickSearch === 'function') {
                  window.handleQuickSearch({ key: 'Enter' }, value);
                }
              }
            }).catch(() => {
              // ignore detection errors
            });
          } catch (e) {
            // ignore detection errors
          }

          scanInterval = requestAnimationFrame(scanFrame);
        }

        scanFrame();
      })
      .catch((err) => {
        console.error('Camera error:', err);
        showNotification('لا يمكن الوصول إلى الكاميرا. تحقق من الأذونات.', 'error');
      });
  }

  function startBarcodeScannerFallback(targetInput) {
    // استخدم واجهة بديلة - طلب من المستخدم إدخال الباركود يدوياً
    const overlay = document.createElement('div');
    overlay.id = 'barcode-scanner-fallback-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.9);
      z-index: 10000;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    `;

    const title = document.createElement('h2');
    title.textContent = '📸 مسح الباركود';
    title.style.cssText = `
      color: white;
      font-size: 1.5rem;
      margin-bottom: 1rem;
      text-align: center;
    `;
    overlay.appendChild(title);

    const desc = document.createElement('p');
    desc.textContent = 'هذا المتصفح لا يدعم مسح الباركود تلقائياً.';
    desc.style.cssText = `
      color: #ccc;
      font-size: 1rem;
      margin-bottom: 1.5rem;
      text-align: center;
    `;
    overlay.appendChild(desc);

    const inputGroup = document.createElement('div');
    inputGroup.style.cssText = `
      width: 100%;
      max-width: 400px;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    `;

    const inputLabel = document.createElement('label');
    inputLabel.textContent = 'أدخل الباركود يدوياً:';
    inputLabel.style.cssText = `
      color: white;
      font-size: 1rem;
      margin-bottom: 0.5rem;
    `;
    inputGroup.appendChild(inputLabel);

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'barcode-fallback-input';
    input.placeholder = 'أدخل رقم الباركود...';
    input.style.cssText = `
      padding: 0.75rem 1rem;
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.3);
      border-radius: 4px;
      color: white;
      font-size: 1rem;
      width: 100%;
    `;
    inputGroup.appendChild(input);

    const buttonsDiv = document.createElement('div');
    buttonsDiv.style.cssText = `
      display: flex;
      gap: 0.75rem;
      justify-content: center;
      margin-top: 0.5rem;
    `;

    const scanBtn = document.createElement('button');
    scanBtn.textContent = '🔍 بحث';
    scanBtn.style.cssText = `
      padding: 0.75rem 1.5rem;
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 1rem;
    `;
    scanBtn.addEventListener('click', () => {
      const value = input.value.trim();
      if (!value) {
        showNotification('يجب إدخال الباركود', 'warning');
        return;
      }
      overlay.remove();
      if (targetInput) {
        targetInput.value = value;
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        targetInput.focus();
      }
      if (typeof window.handleQuickSearch === 'function') {
        window.handleQuickSearch({ key: 'Enter' }, value);
      }
    });
    buttonsDiv.appendChild(scanBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '✖️ إلغاء';
    cancelBtn.style.cssText = `
      padding: 0.75rem 1.5rem;
      background: #6b7280;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 1rem;
    `;
    cancelBtn.addEventListener('click', () => overlay.remove());
    buttonsDiv.appendChild(cancelBtn);

    inputGroup.appendChild(buttonsDiv);
    overlay.appendChild(inputGroup);

    // تركيز على حقل الإدخال
    setTimeout(() => input.focus(), 100);

    document.body.appendChild(overlay);
  }

  function stopBarcodeScanner() {
    barcodeScannerActive = false;

    const overlay = document.getElementById('barcode-scanner-overlay');
    if (overlay) overlay.remove();

    const fallbackOverlay = document.getElementById('barcode-scanner-fallback-overlay');
    if (fallbackOverlay) fallbackOverlay.remove();

    if (scannerStream) {
      scannerStream.getTracks().forEach(track => track.stop());
      scannerStream = null;
    }

    scannerVideo = null;
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

  // إنشاء CSS للـ overlay
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

})();
