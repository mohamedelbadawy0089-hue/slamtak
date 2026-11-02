// ============================================================================
// SLAMTAL AI: Inventory Predictions & Alerts UI
// الذكاء الاصطناعي للتنبؤ بالمخزون والتنبيهات
// ============================================================================

(function() {
  'use strict';

  // تنسيق التاريخ
  function formatDate(date) {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleDateString('ar-EG', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatTime(date) {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  }

  // عرض التنبؤات
  async function renderPredictions(client, container) {
    container.innerHTML = `
      <h3>🤖 تنبؤات الذكاء الاصطناعي للمخزون</h3>
      <p class="muted" style="margin-bottom:1rem;">
        تظهر هنا التنبؤات التي أنشأها النظام تلقائياً للمخزون.
      </p>
      <div id="predictions-list">
        <div class="card" style="text-align:center;padding:2rem;">
          <p class="muted">جارٍ تحميل التنبؤات...</p>
        </div>
      </div>
    `;

    try {
      const { data: predictions, error } = await client
        .from('ml_inventory_predictions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      const list = document.getElementById('predictions-list');
      if (!predictions || predictions.length === 0) {
        list.innerHTML = `
          <div class="card" style="text-align:center;padding:2rem;">
            <p class="muted">لا توجد تنبؤات حتى الآن.</p>
            <p class="muted" style="font-size:0.85rem;margin-top:0.5rem;">
              ستظهر التنبؤات هنا عندما يقوم النظام بتحليل بياناتك.
            </p>
          </div>
        `;
        return;
      }

      list.innerHTML = `
        <div style="margin-bottom:1rem;">
          <span style="background:#6366f1;color:white;padding:0.25rem 0.75rem;border-radius:9999px;font-size:0.85rem;">
            ${predictions.length} تنبؤ
          </span>
        </div>
        <div style="display:flex;flex-direction:column;gap:0.75rem;">
          ${predictions.map(p => `
            <div class="card" style="padding:1rem;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.5rem;">
                <div>
                  <span class="badge ${p.prediction_type === 'demand_forecast' ? 'bg-blue' :
                    p.prediction_type === 'restock_alert' ? 'bg-orange' :
                    p.prediction_type === 'overstock_warning' ? 'bg-red' :
                    p.prediction_type === 'expiry_risk' ? 'bg-yellow' : 'bg-purple'}">
                    ${PREDICTION_TYPE_LABELS[p.prediction_type] || p.prediction_type}
                  </span>
                  <span class="muted" style="font-size:0.8rem;margin-left:0.5rem;">
                    الثقة: ${(p.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <span class="muted" style="font-size:0.8rem;">
                  ${formatDate(p.created_at)}
                </span>
              </div>
              <div style="font-size:1.25rem;font-weight:600;margin-bottom:0.5rem;">
                ${p.predicted_value} ${p.details?.unit || ''}
              </div>
              ${p.details?.note ? `<p class="muted" style="font-size:0.9rem;">${p.details.note}</p>` : ''}
            </div>
          `).join('')}
        </div>
      `;
    } catch (err) {
      container.innerHTML = `
        <h3>🤖 تنبؤات الذكاء الاصطناعي للمخزون</h3>
        <div class="card" style="padding:1rem;text-align:center;">
          <p class="muted">حدث خطأ أثناء تحميل التنبؤات: ${err.message}</p>
        </div>
      `;
    }
  }

  // عرض التنبيهات
  async function renderAlerts(client, container) {
    container.innerHTML = `
      <h3>🚨 تنبيهات الذكاء الاصطناعي</h3>
      <p class="muted" style="margin-bottom:1rem;">
        تنبيهات تلقائية من النظام حول حالة المخزون.
      </p>
      <div id="alerts-list">
        <div class="card" style="text-align:center;padding:2rem;">
          <p class="muted">جارٍ تحميل التنبيهات...</p>
        </div>
      </div>
    `;

    try {
      const { data: alerts, error } = await client
        .from('ai_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      const list = document.getElementById('alerts-list');
      if (!alerts || alerts.length === 0) {
        list.innerHTML = `
          <div class="card" style="text-align:center;padding:2rem;">
            <p class="muted">✅ لا توجد تنبيهات</p>
            <p class="muted" style="font-size:0.85rem;margin-top:0.5rem;">
              كل شيء على ما يرام!
            </p>
          </div>
        `;
        return;
      }

      // إحصائيات سريعة
      const critical = alerts.filter(a => a.severity === 'critical' && !a.is_resolved).length;
      const warning = alerts.filter(a => a.severity === 'warning' && !a.is_resolved).length;

      list.innerHTML = `
        <div style="display:flex;gap:1rem;margin-bottom:1rem;">
          ${critical > 0 
            ? `<span class="badge bg-red" style="padding:0.25rem 0.75rem;border-radius:9999px;">
                 ${critical} حرج
               </span>`
            : `<span class="badge bg-green" style="padding:0.25rem 0.75rem;border-radius:9999px;">
                 ✅ لا توجد حالات حرجة
               </span>`
          }
          ${warning > 0 
            ? `<span class="badge bg-orange" style="padding:0.25rem 0.75rem;border-radius:9999px;">
                 ${warning} تحذير
               </span>`
            : ''
          }
        </div>
        <div style="display:flex;flex-direction:column;gap:0.75rem;">
          ${alerts.map(a => `
            <div class="card ${a.is_resolved ? 'resolved' : ''}" 
                 style="padding:1rem;border-left:4px solid ${a.severity === 'critical' ? '#ef4444' : a.severity === 'warning' ? '#f97316' : '#3b82f6'};">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.5rem;">
                <div style="display:flex;gap:0.5rem;align-items:center;">
                  <span class="badge ${a.severity === 'critical' ? 'bg-red' : a.severity === 'warning' ? 'bg-orange' : 'bg-blue'}">
                    ${ALERT_TYPE_LABELS[a.alert_type] || a.alert_type}
                  </span>
                  ${a.is_resolved ? '<span class="badge bg-green" style="font-size:0.75rem;">حُلّ</span>' : ''}
                </div>
                <span class="muted" style="font-size:0.8rem;">
                  ${formatDate(a.created_at)} ${formatTime(a.created_at)}
                </span>
              </div>
              <div style="font-weight:500;margin-bottom:0.25rem;">${a.title}</div>
              ${a.message ? `<p class="muted" style="font-size:0.9rem;max-width:600px;">${a.message}</p>` : ''}
            </div>
          `).join('')}
        </div>
      `;
    } catch (err) {
      container.innerHTML = `
        <h3>🚨 تنبيهات الذكاء الاصطناعي</h3>
        <div class="card" style="padding:1rem;text-align:center;">
          <p class="muted">حدث خطأ أثناء تحميل التنبيهات: ${err.message}</p>
        </div>
      `;
    }
  }

  // عرض إحصائيات النموذج
  async function renderModelStats(client, container) {
    container.innerHTML = `
      <h3>📊 إحصائيات نموذج الذكاء الاصطناعي</h3>
      <p class="muted" style="margin-bottom:1rem;">
        أداء نموذج التنبؤ للمخزون.
      </p>
      <div id="model-stats">
        <div class="card" style="text-align:center;padding:2rem;">
          <p class="muted">جارٍ تحميل الإحصائيات...</p>
        </div>
      </div>
    `;

    try {
      const { data: stats, error } = await client
        .from('ml_model_stats')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;

      const list = document.getElementById('model-stats');
      if (!stats || stats.length === 0) {
        list.innerHTML = `
          <div class="card" style="text-align:center;padding:2rem;">
            <p class="muted">لا توجد إحصائيات نموذج بعد.</p>
            <p class="muted" style="font-size:0.85rem;margin-top:0.5rem;">
              سيظهر هنا عند تدريب النموذج الأول.
            </p>
          </div>
        `;
        return;
      }

      list.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:1rem;">
          ${stats.map(s => `
            <div class="card" style="padding:1rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
                <div>
                  <strong>${s.model_name}</strong>
                  ${s.model_version ? `<span class="muted" style="font-size:0.85rem;">v${s.model_version}</span>` : ''}
                </div>
                <div style="text-align:right;">
                  <span style="font-size:1.5rem;font-weight:600;color:#6366f1;">
                    ${(s.accuracy * 100).toFixed(1)}%
                  </span>
                  <div class="muted" style="font-size:0.8rem;">الدقة</div>
                </div>
              </div>
              <div style="display:flex;gap:1rem;font-size:0.9rem;color:#666;">
                <span>${s.total_predictions} تنبؤ إجمالي</span>
                <span>${s.successful_predictions} نجح</span>
                <span>آخر تدريب: ${s.last_trained_at ? formatDate(s.last_trained_at) : '—'}</span>
              </div>
              <div style="margin-top:0.5rem;width:100%;height:6px;background:#eee;border-radius:3px;overflow:hidden;">
                <div style="width:${(s.accuracy * 100).toFixed(0)}%;height:100%;background:#6366f1;border-radius:3px;"></div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    } catch (err) {
      container.innerHTML = `
        <h3>📊 إحصائيات نموذج الذكاء الاصطناعي</h3>
        <div class="card" style="padding:1rem;text-align:center;">
          <p class="muted">حدث خطأ: ${err.message}</p>
        </div>
      `;
    }
  }

  // عرض الشاشة الرئيسية لـ AI
  async function renderAIOverview(client, state) {
    const panel = document.getElementById('app-main');
    if (!panel) return;

    panel.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem;margin-bottom:1.5rem;">
        <a href="#ai/predictions" data-link 
           class="card" style="cursor:pointer;padding:1.25rem;text-align:center;border:2px solid #6366f1;">
          <div style="font-size:2rem;margin-bottom:0.5rem;">🔮</div>
          <div style="font-weight:600;">التنبؤات</div>
          <div class="muted">تنبؤات الطلب والمخزون</div>
        </a>
        <a href="#ai/alerts" data-link 
           class="card" style="cursor:pointer;padding:1.25rem;text-align:center;">
          <div style="font-size:2rem;margin-bottom:0.5rem;">🚨</div>
          <div style="font-weight:600;">التنبيهات</div>
          <div class="muted">تنبيهات الذكاء الاصطناعي</div>
        </a>
        <a href="#ai/models" data-link 
           class="card" style="cursor:pointer;padding:1.25rem;text-align:center;">
          <div style="font-size:2rem;margin-bottom:0.5rem;">📊</div>
          <div style="font-weight:600;">النماذج</div>
          <div class="muted">إحصائيات الأداء</div>
        </a>
      </div>
      <div class="card">
        <h3>🤖 نظرة عامة</h3>
        <p style="margin-bottom:0.5rem;">
          يستخدم النظام الذكاء الاصطناعي للتنبؤ بالمخزون وتحليل الأنماط.
        </p>
        <ul style="padding-inline-start:1.5rem;line-height:2;">
          <li>🔮 <strong>تنبؤات الطلب:</strong> تنبؤ بالكمية المتوقعة للطلب</li>
          <li>📦 <strong>تنبيهات إعادة المخزون:</strong> تنبيه عندما ينخفض المخزون عن الحد</li>
          <li>⚠️ <strong>فائض المخزون:</strong> تنبيه عند وجود فائض</li>
          <li>📅 <strong>انتهاء الصلاحية:</strong> تنبيه للمنتجات القريبة من انتهاء الصلاحية</li>
          <li>💰 <strong>تحسين السعر:</strong> اقتراحات لتحسين الأسعار</li>
        </ul>
        <p class="muted" style="margin-top:1rem;font-size:0.85rem;">
          جميع التنبؤات والتنبيهات معزولة لكل مخزن (tenant) ولا يمكن لمخزن أن يرى بيانات مخزن آخر.
        </p>
      </div>
    `;
  }

  // التنبيهات النشطة (AJAX Instant)
  async function loadActiveAlertsBadge(client) {
    try {
      const { data, error } = await client
        .rpc('get_unresolved_alerts', { p_limit: 100 });
      
      if (error) return;
      
      const criticalCount = (data || []).filter(a => a.severity === 'critical').length;
      const warningCount = (data || []).filter(a => a.severity === 'warning').length;
      
      const badge = document.getElementById('ai-alerts-badge');
      if (badge && (criticalCount > 0 || warningCount > 0)) {
        badge.textContent = criticalCount > 0 
          ? `${criticalCount} ⚠️` 
          : `${warningCount} ⚡`;
        badge.style.display = 'inline-flex';
      } else if (badge) {
        badge.style.display = 'none';
      }
    } catch (_) {}
  }

  const PREDICTION_TYPE_LABELS = {
    'demand_forecast': '🔮 تنبؤ بالطلب',
    'restock_alert': '📦 إعادة مخزون',
    'overstock_warning': '⚠️ فائض',
    'expiry_risk': '📅 انتهاء الصلاحية',
    'price_optimization': '💰 تحسين السعر'
  };

  const ALERT_TYPE_LABELS = {
    'low_stock': '📦 مخزون منخفض',
    'overstock': '📦 فائض',
    'demand_spike': '📈 ارتفاع الطلب',
    'expiry_imminent': '📅 انتهاء صلاحية',
    'price_anomaly': '💰 تشويه سعر',
    'supplier_risk': '🏢 خطر مورد',
    'inventory_discrepancy': '❌ discrepency'
  };

  // التصدير
  window.AIInventory = {
    renderPredictions,
    renderAlerts,
    renderModelStats,
    renderAIOverview,
    loadActiveAlertsBadge
  };
})();

console.log('[AI Inventory] Module loaded');
