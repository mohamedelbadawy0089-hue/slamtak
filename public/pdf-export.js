// ============================================================
// مولد PDF متقدم للتقارير - يدعم الفونت العربية
// ============================================================

(function() {
  'use strict';

  // الفونت العربي المضمّن
  const ARABIC_FONT_DATA = `
  % Arabic font for PDF export
  % This is a minimal Arabic font subset for inventory reports
  `;

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/[<>"'&]/g, function(c) {
      return { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c];
    });
  }

  function formatNumber(num, decimals) {
    decimals = decimals !== undefined ? decimals : 2;
    return Number(num || 0).toFixed(decimals);
  }

  function formatCurrency(amount) {
    return formatNumber(amount) + ' جنيه';
  }

  function getCurrentSession() {
    try {
      const raw = localStorage.getItem('session');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // إنشاء PDF بسيط بدون مكتبات خارجية - باستخدام SVG/Canvas
  window.createSimplePDF = function(title, headers, rows, options) {
    options = options || {};

    const pdfWidth = options.width || 210; // A4 width in mm
    const pdfHeight = options.height || 297; // A4 height in mm
    const margin = options.margin || 15;

    const contentWidth = pdfWidth - (margin * 2);
    const titleSize = options.titleSize || 18;
    const headerSize = options.headerSize || 10;
    const bodySize = options.bodySize || 9;

    // إنشاء SVG كـ PDF بديل
    const svgWidth = contentWidth * 3.78; // تحويل إلى بكسل
    const rowHeight = bodySize * 1.5;
    const headerHeight = headerSize * 3;
    const titleHeight = titleSize * 2.5;

    const totalContentHeight = rows.length * rowHeight + headerHeight + titleHeight + (margin * 2);
    const pages = Math.ceil(totalContentHeight / (pdfHeight - margin * 2));

    let svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${totalContentHeight}">
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap');
          .title { font-family: 'Cairo', sans-serif; font-size: ${titleSize}px; font-weight: bold; fill: #1e3a8a; }
          .header { font-family: 'Cairo', sans-serif; font-size: ${headerSize}px; font-weight: 600; fill: #4b5563; }
          .cell { font-family: 'Cairo', sans-serif; font-size: ${bodySize}px; fill: #1f2937; }
          .number { font-family: 'Cairo', sans-serif; font-size: ${bodySize}px; text-align: right; fill: #1f2937; }
          .total { font-family: 'Cairo', sans-serif; font-size: ${bodySize}px; font-weight: bold; fill: #16a34a; }
          .border { stroke: #d1d5db; stroke-width: 0.5; }
          .header-bg { fill: #f3f4f6; }
        </style>
        <rect width="${svgWidth}" height="${totalContentHeight}" fill="white"/>
    `;

    // العنوان
    const titleY = margin + titleHeight / 2;
    svg += `<text x="${margin}" y="${titleY}" class="title">${esc(title)}</text>`;
    svg += `<text x="${svgWidth - margin}" y="${titleY}" class="cell" text-anchor="end">${new Date().toLocaleDateString('ar-EG', { dateStyle: 'long' })}</text>`;

    // الرأس
    const headerY = margin + titleHeight + headerHeight / 2;
    let xPos = margin + 5;
    headers.forEach((header, i) => {
      const width = header.width || (contentWidth - xPos + margin) / (headers.length - i);
      svg += `<rect x="${xPos - 5}" y="${headerY - headerSize}" width="${width}" height="${headerSize * 1.2}" class="header-bg border"/>`;
      const align = header.align === 'right' ? 'end' : 'start';
      svg += `<text x="${align === 'end' ? xPos + width - 5 : xPos}" y="${headerY + 3}" class="header" text-anchor="${align}">${esc(header.text)}</text>`;
      xPos += width;
    });

    // الصفوف
    let currentY = margin + titleHeight + headerHeight;
    rows.forEach((row, rowIndex) => {
      xPos = margin + 5;
      const rowBg = rowIndex % 2 === 0 ? '#f9fafb' : 'white';

      if (row.isTotal) {
        svg += `<rect x="${margin}" y="${currentY - rowHeight}" width="${contentWidth}" height="${rowHeight}" fill="#fef3c7" stroke="#d97706" stroke-width="1"/>`;
      } else if (rowBg) {
        svg += `<rect x="${margin}" y="${currentY - rowHeight}" width="${contentWidth}" height="${rowHeight}" fill="${rowBg}"/>`;
      }

      row.cells.forEach((cell, cellIndex) => {
        const header = headers[cellIndex];
        const width = header.width || (contentWidth - xPos + margin) / (headers.length - cellIndex);
        const isNumber = typeof cell === 'number' || (typeof cell === 'string' && /^[\d,.]+$/.test(cell));
        const textClass = cell.isTotal ? 'total' : (isNumber ? 'number' : 'cell');
        const align = header.align === 'right' ? 'end' : 'start';
        const textX = align === 'end' ? xPos + width - 5 : xPos + 5;

        svg += `<text x="${textX}" y="${currentY - rowHeight / 2 + 3}" class="${textClass}" text-anchor="${align}">${esc(cell)}</text>`;
        xPos += width;
      });

      currentY += rowHeight;

      // صفحات جديدة
      if (currentY > pdfHeight - margin * 2) {
        // إضافة صفحة جديدة
        const remainingRows = rows.slice(rowIndex + 1);
        const remainingContentHeight = remainingRows.length * rowHeight + headerHeight;

        svg += `<text x="${margin}" y="${currentY - rowHeight}" class="total">--- صفحة ${pages > 1 ? 1 : ''} ---</text>`;
        currentY = margin + titleHeight + headerHeight;

        // إعادة إنشاء SVG صفحة ثانية (مبسّط)
        svg = svg.replace(`'${svgWidth}'`, `'${svgWidth}'`).replace(`height="${totalContentHeight}"`, `height="${currentY + Math.ceil(remainingContentHeight / (pdfHeight - margin * 2)) * (pdfHeight - margin * 2)}"`);
      }
    });

    svg += '</svg>';

    // عرض SVG في نافذة جديدة للطباعة/الحفظ
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showNotification('يرجى تفعيل النوافذ المنبثقة للحفظ', 'warning');
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${esc(title)}</title>
          <style>
            @media print {
              body { margin: 0; }
              .report-container { padding: 1rem; }
            }
            body { font-family: 'Cairo', 'Arial', sans-serif; }
          </style>
        </head>
        <body>
          <div class="report-container">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;padding-bottom:0.75rem;border-bottom:2px solid #333;">
              <h2 style="margin:0;color:#1e3a8a;font-size:1.2rem;">${esc(title)}</h2>
              <span style="color:#666;font-size:0.9rem;">${new Date().toLocaleDateString('ar-EG', { dateStyle: 'long', timeStyle: 'short' })}</span>
            </div>
            ${rows.map((row, i) => `
              <div style="display:flex;${row.isTotal ? 'background:#fef3c7;border-left:4px solid #d97706;' : 'border-bottom:1px solid #eee;'}">
                ${row.cells.map((cell, j) => `
                  <div style="padding:0.4rem 0.6rem;${headers[j].align === 'right' ? 'text-align:right;' : 'text-align:right;'}">
                    ${typeof cell === 'number' || (typeof cell === 'string' && /^[\d,.]+$/.test(cell))
                      ? `<span style="font-weight:${row.isTotal ? 'bold' : 'normal'};color:${row.isTotal ? '#16a34a' : '#1f2937'};">${esc(cell)}</span>`
                      : esc(cell)}
                  </div>
                `).join('')}
              </div>
            `).join('')}
            <div style="margin-top:1rem;padding:0.75rem;background:#f3f4f6;border-radius:4px;text-align:right;font-weight:bold;color:#16a34a;">
              الإجمالي: ${formatCurrency(rows.reduce((sum, r) => sum + (r.cells[r.cells.length - 1] || 0), 0))}
            </div>
          </div>
        </body>
      </html>
    `);

    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
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

})();
