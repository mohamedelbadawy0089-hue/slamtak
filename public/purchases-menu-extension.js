// ============================================================
// إضافة قائمة تنقل موسعة لصفحة المشتريات
// يُضاف تلقائياً بعد تحميل الصفحة
// ============================================================

(function() {
  'use strict';

  // ترقب صفحة المشتريات الرئيسية
  const path = window.location.pathname;
  if (!path.startsWith('/purchases')) return;

  const sectionBody = document.getElementById('section-body');
  if (!sectionBody) return;

  // إضافة قائمة التنقل بعد العنوان الرئيسي
  const mainTitle = sectionBody.querySelector('h1');
  if (!mainTitle) return;

  const parent = mainTitle.parentElement;
  if (!parent) return;

  const extraLinks = document.createElement('div');
  extraLinks.id = 'purchases-extra-nav';
  extraLinks.style.cssText = `
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding: 0.5rem 0;
    margin-bottom: 1rem;
    animation: fadeIn 0.3s ease-in;
  `;

  const links = [
    { href: '#vendors', label: '🏭 التقارير الموردون'},
    { href: '#variance', label: '📈 differed المخزون'},
    { href: '#alerts', label: '📉 تنبيهات'},
    { href: '#reports', label: '📊 تقارير PDF'},
  ];

  links.forEach(link => {
    const a = document.createElement('a');
    a.href = link.href;
    a.textContent = link.label;
    a.style.cssText = `
      padding: 0.35rem 0.75rem;
      background: ${link.href === '#reports' ? '#7c3aed' : 'white'};
      color: ${link.href === '#reports' ? 'white' : '#333'};
      border: ${link.href === '#reports' ? 'none' : '1px solid #ddd'};
      border-radius: 4px;
      text-decoration: none;
      font-size: 0.85rem;
      font-weight: bold;
      transition: all 0.2s;
    `;
    a.addEventListener('mouseenter', () => {
      if (link.href !== '#reports') {
        a.style.background = '#f0f4ff';
        a.style.borderColor = '#667eea';
      }
    });
    a.addEventListener('mouseleave', () => {
      if (link.href !== '#reports') {
        a.style.background = 'white';
        a.style.borderColor = '#ddd';
      }
    });
    a.addEventListener('click', (e) => {
      if (link.href === '#reports') {
        e.preventDefault();
        showReportMenu();
      }
    });
    extraLinks.appendChild(a);
  });

  parent.insertBefore(extraLinks, mainTitle.nextSibling);

  // دالة عرض قائمة التقارير
  function showReportMenu() {
    const existing = document.getElementById('report-menu-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'report-menu-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 10000;
      display: flex;
      justify-content: center;
      align-items: center;
      animation: fadeIn 0.2s ease-in;
    `;

    overlay.innerHTML = `
      <div style="background:white;border-radius:12px;padding:1.5rem;max-width:450px;width:90%;box-shadow:0 10px 40px rgba(0,0,0,0.3);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <h2 style="margin:0;font-size:1.2rem;color:#7c3aed;">📊 تقارير PDF</h2>
          <button style="background:none;border:none;font-size:1.5rem;cursor:pointer;" onclick="closeReportMenu()">&times;</button>
        </div>

        <div style="display:flex;flex-direction:column;gap:0.5rem;">
          <button class="report-option" onclick="loadInventoryData('total');closeReportMenu();">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;background:#f0f4ff;border-radius:6px;">
              <span>📋 تقرير المخزون الكلي</span>
              <span style="color:#667eea;font-weight:bold;">PDF</span>
            </div>
          </button>
          <button class="report-option" onclick="loadInventoryData('fifo');closeReportMenu();">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;background:#f0fdf4;border-radius:6px;">
              <span>🔄 تقرير محسوب FIFO</span>
              <span style="color:#16a34a;font-weight:bold;">PDF</span>
            </div>
          </button>
          <button class="report-option" onclick="loadInventoryData('lifo');closeReportMenu();">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;background:#fef2f2;border-radius:6px;">
              <span>🎯 تقرير محسوب LIFO</span>
              <span style="color:#dc2626;font-weight:bold;">PDF</span>
            </div>
          </button>
          <button class="report-option" onclick="loadInventoryData('valuation');closeReportMenu();">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;background:#faf5ff;border-radius:6px;">
              <span>💰 تقرير تقييم المخزون</span>
              <span style="color:#7c3aed;font-weight:bold;">PDF</span>
            </div>
          </button>
          <hr style="margin:0.75rem 0;border-color:#eee;">
          <button class="report-option" onclick="loadInventoryData('vendors');closeReportMenu();">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;background:#f0f4ff;border-radius:6px;">
              <span>🏭 تقارير إيرادات الموردين</span>
              <span style="color:#667eea;font-weight:bold;">عرض</span>
            </div>
          </button>
          <button class="report-option" onclick="loadInventoryData('variance');closeReportMenu();">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;background:#f0fdf4;border-radius:6px;">
              <span>📈 differed المخزون</span>
              <span style="color:#16a34a;font-weight:bold;">عرض</span>
            </div>
          </button>
          <button class="report-option" onclick="loadInventoryData('alerts');closeReportMenu();">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;background:#fef2f2;border-radius:6px;">
              <span>📉 تنبيهات نقص المخزون</span>
              <span style="color:#dc2626;font-weight:bold;">عرض</span>
            </div>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  window.closeReportMenu = function() {
    const overlay = document.getElementById('report-menu-overlay');
    if (overlay) overlay.remove();
  };

  const style = document.createElement('style');
  style.textContent = `
    .report-option {
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 0;
      cursor: pointer;
      text-align: left;
      width: 100%;
      transition: all 0.2s;
    }
    .report-option:hover {
      border-color: #7c3aed;
      transform: translateX(2px);
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `;
  document.head.appendChild(style);

})();
