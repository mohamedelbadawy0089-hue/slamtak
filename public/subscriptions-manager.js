/**
 * subscriptions-manager.js
 * ======================
 * إدارة الاشتراكات والباقات - حدود المميزات والتحقق
 */

(function () {
  'use strict';

  // ============================================================
  // جلب خطة المخزن الحالية
  // ============================================================
  async function getWarehousePlan(client, warehouseId) {
    if (!client || !warehouseId) return null;
    try {
      const { data, error } = await client.rpc('get_warehouse_plan', { p_warehouse_id: warehouseId });
      if (error) throw error;
      return data || null;
    } catch (e) {
      console.error('getWarehousePlan:', e);
      return null;
    }
  }

  // ============================================================
  // جلب所有 plans
  // ============================================================
  async function getAllPlans(client) {
    if (!client) return [];
    try {
      const { data, error } = await client.from('plans').select('*').order('sort_order');
      if (error) throw error;
      return data || [];
    } catch (e) {
      console.error('getAllPlans:', e);
      return [];
    }
  }

  // ============================================================
  // فحص حد معين
  // ============================================================
  async function checkUsageLimit(client, warehouseId, limitKey) {
    if (!client || !warehouseId) return null;
    try {
      const { data, error } = await client.rpc('check_usage_limit', {
        p_warehouse_id: warehouseId,
        p_limit_key: limitKey
      });
      if (error) throw error;
      return data || null;
    } catch (e) {
      console.error('checkUsageLimit:', e);
      return null;
    }
  }

  // ============================================================
  // ترقية الخطة
  // ============================================================
  async function upgradePlan(client, warehouseId, planName) {
    if (!client || !warehouseId) throw new Error('بيانات غير مكتملة');
    try {
      const { data, error } = await client.rpc('upgrade_plan', {
        p_warehouse_id: warehouseId,
        p_plan_name: planName
      });
      if (error) throw error;
      return data || null;
    } catch (e) {
      console.error('upgradePlan:', e);
      throw e;
    }
  }

  // ============================================================
  // جلب نظرة عامة على الاشتراكات
  // ============================================================
  async function getSubscriptionOverview(client) {
    if (!client) return [];
    try {
      const { data, error } = await client.rpc('subscription_overview');
      if (error) throw error;
      return data || [];
    } catch (e) {
      console.error('getSubscriptionOverview:', e);
      return [];
    }
  }

  // ============================================================
  // تحديد ما إذا كان المخزن ي超ّط حداً معيناً
  // ============================================================
  function isOverLimit(checkResult) {
    if (!checkResult) return false;
    return checkResult.current >= checkResult.limit && checkResult.limit > 0;
  }

  function isNearLimit(checkResult, threshold = 90) {
    if (!checkResult) return false;
    return checkResult.percentage >= threshold && checkResult.limit > 0;
  }

  // ============================================================
  // عرض لوحة إدارة الاشتراكات
  // ============================================================
  function renderSubscriptionPanel(appEl, warehouseId, plan, plans, limitChecks) {
    if (!appEl) return;

    const currentPlanInfo = plan || {};
    const limits = currentPlanInfo.limits || {};
    const features = currentPlanInfo.features || [];

    appEl.innerHTML = `
      <div class="page">
        <header class="app-header">
          <h1>💳 إدارة الاشتراكات والباقات</h1>
          <button class="btn" id="back-home-btn" type="button">← الرئيسية</button>
        </header>
        
        <nav class="app-nav" aria-label="الاشتراكات">
          <a href="/admin/subscriptions" data-link class="nav-link">💳 Dashboard</a>
          <a href="/admin" data-link class="nav-link">👑 Super Admin</a>
        </nav>
        
        <main style="padding:1rem;">
          <!-- Card الحالية -->
          <div class="card" style="margin-bottom:1.5rem;border-left:4px solid #2563eb;padding:1.25rem;">
            <h3>📋 خطة المخزن الحالية</h3>
            <div style="display:flex;gap:0.75rem;align-items:center;margin-bottom:1rem;">
              <span class="badge badge-primary" style="font-size:1.2rem;padding:0.5rem 1rem;">
                ${currentPlanInfo.plan_name_ar || currentPlanInfo.plan_name || '—'}
              </span>
              <span class="badge ${currentPlanInfo.status === 'active' ? 'badge-success' : 'badge-default'}">
                ${currentPlanInfo.status || '—'}
              </span>
            </div>
            
            ${currentPlanInfo.trial_ends_at ? `
              <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:0.75rem;margin-bottom:1rem;">
                <p style="margin:0;font-size:0.9rem;color:#92400e;">
                  🎫 فترة تجريبية تنتهي في: ${formatDate(currentPlanInfo.trial_ends_at)}
                </p>
              </div>
            ` : ''}
            
            <table style="width:100%;font-size:0.9rem;border-collapse:collapse;background:#f8f9fa;border-radius:8px;padding:1rem;">
              <tr>
                <td style="padding:0.5rem;border-bottom:1px solid #eee;width:40%;">عدد المستخدمين المسموح</td>
                <td style="padding:0.5rem;border-bottom:1px solid #eee;font-weight:bold;">
                  ${limits.users ?? '—'} مستخدم
                </td>
              </tr>
              <tr>
                <td style="padding:0.5rem;border-bottom:1px solid #eee;">عدد الموظفين المسموح</td>
                <td style="padding:0.5rem;border-bottom:1px solid #eee;font-weight:bold;">
                  ${limits.employees ?? '—'} موظف
                </td>
              </tr>
              <tr>
                <td style="padding:0.5rem;border-bottom:1px solid #eee;">عدد المنتجات المسموح</td>
                <td style="padding:0.5rem;border-bottom:1px solid #eee;font-weight:bold;">
                  ${formatNumber(limits.products ?? 0)} منتج
                </td>
              </tr>
              <tr>
                <td style="padding:0.5rem;border-bottom:1px solid #eee;">عدد العملاء المسموح</td>
                <td style="padding:0.5rem;border-bottom:1px solid #eee;font-weight:bold;">
                  ${formatNumber(limits.customers ?? 0)} عميل
                </td>
              </tr>
              <tr>
                <td style="padding:0.5rem;border-bottom:1px solid #eee;">حد التخزين</td>
                <td style="padding:0.5rem;border-bottom:1px solid #eee;font-weight:bold;">
                  ${limits.storage_mb ?? '—'} ميجابايت
                </td>
              </tr>
              <tr>
                <td style="padding:0.5rem;border-bottom:1px solid #eee;">أوامر البيع الشهرية</td>
                <td style="padding:0.5rem;border-bottom:1px solid #eee;font-weight:bold;">
                  ${limits.orders_monthly ?? '—'} أمر
                </td>
              </tr>
              <tr>
                <td style="padding:0.5rem;">طلبات API الشهرية</td>
                <td style="padding:0.5rem;font-weight:bold;">
                  ${formatNumber(limits.requests_monthly ?? 0)} طلب
                </td>
              </tr>
            </table>
          </div>
          
          <!-- حدود الاستخدام -->
          <div class="card" style="margin-bottom:1.5rem;">
            <h3>📊 حدود الاستخدام الحالية</h3>
            <p class="muted" style="margin-bottom:1rem;">مراقبة الاستخدام مقابل الحدود المسموحة</p>
            <div style="display:grid;gap:0.75rem;">
              ${renderUsageBar('users', limitChecks?.users || {}, plans)}
              ${renderUsageBar('employees', limitChecks?.employees || {}, plans)}
              ${renderUsageBar('products', limitChecks?.products || {}, plans)}
              ${renderUsageBar('customers', limitChecks?.customers || {}, plans)}
              ${renderUsageBar('storage_mb', limitChecks?.storage_mb || {}, plans)}
              ${renderUsageBar('orders_monthly', limitChecks?.orders_monthly || {}, plans)}
              ${renderUsageBar('requests_monthly', limitChecks?.requests_monthly || {}, plans)}
            </div>
          </div>
          
          <!-- الباقات المتاحة -->
          <div class="card">
            <h3>📦 الباقات المتاحة</h3>
            <p class="muted" style="margin-bottom:1rem;">ترقية الخطة للاستفادة من مميزات إضافية</p>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem;">
              ${plans.map(p => renderPlanCard(p, currentPlanInfo.plan_name)).join('')}
            </div>
          </div>
        </main>
      </div>
    `;

    // أزرار الترقية
    setTimeout(() => {
      document.querySelectorAll('.upgrade-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          const targetPlan = btn.dataset.plan;
          const btnEl = btn;
          btnEl.disabled = true;
          btnEl.textContent = 'جارٍ الترقية...';
          
          try {
            const result = await upgradePlan(getSupabase(), warehouseId, targetPlan);
            if (result && result.success) {
              alert(`✅ تم الترقية إلى خطة ${targetPlan} بنجاح!`);
              window.location.reload();
            } else {
              alert('فشل الترقية: ' + (result?.message || 'خطأ غير معروف'));
              btnEl.disabled = false;
              btnEl.textContent = 'ترقية';
            }
          } catch (err) {
            alert('خطأ في الترقية: ' + (err.message || err));
            btnEl.disabled = false;
            btnEl.textContent = 'ترقية';
          }
        });
      });
    }, 0);
  }

  function renderUsageBar(limitKey, checkResult, plans) {
    if (!checkResult) {
      return `<div class="muted" style="font-size:0.85rem;">لا توجد بيانات للحد ${limitKey}</div>`;
    }
    
    const current = checkResult.current || 0;
    const limit = checkResult.limit || 0;
    const percentage = checkResult.percentage || 0;
    const isOver = isOverLimit(checkResult);
    const isNear = isNearLimit(checkResult);
    
    const barColor = isOver ? '#dc2626' : isNear ? '#f59e0b' : '#22c55e';
    const barWidth = Math.min(percentage, 100);
    
    return `
      <div style="padding:0.75rem;background:#f8f9fa;border-radius:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
          <span style="font-weight:500;">${formatLimitLabel(limitKey)}</span>
          <span style="font-size:0.85rem;${isOver ? 'color:#dc2626;font-weight:bold;' : ''}">
            ${formatNumber(current)} / ${formatNumber(limit)} ${(limit > 0 ? '(' + percentage + '%)' : '')}
          </span>
        </div>
        <div style="background:#e5e7eb;border-radius:4px;height:8px;overflow:hidden;">
          <div style="background:${barColor};height:100%;width:${barWidth}%;transition:width 0.3s ease;border-radius:4px;"></div>
        </div>
        ${isOver ? '<p style="color:#dc2626;font-size:0.8rem;margin-top:0.25rem;">⚠️ تجاوز الحد - يُرجى الترقية</p>' : ''}
        ${isNear && !isOver ? '<p style="color:#f59e0b;font-size:0.8rem;margin-top:0.25rem;">⚠️ اقتراب من الحد الأقصى</p>' : ''}
      </div>
    `;
  }

  function renderPlanCard(plan, currentPlanName) {
    const isCurrent = plan.name === currentPlanName;
    const limits = plan.limits || {};
    
    return `
      <div class="card ${isCurrent ? 'current-plan' : ''}" style="${isCurrent ? 'border:2px solid #2563eb;' : ''}padding:1.25rem;">
        ${isCurrent ? '<span class="badge badge-info" style="margin-bottom:0.5rem;">_current_</span>' : ''}
        <h3 style="margin-top:0;">${plan.name_ar || plan.name}</h3>
        <p class="muted" style="font-size:0.85rem;">${plan.description_ar || plan.description || ''}</p>
        
        <div style="margin:1rem 0;padding:0.75rem;background:#f8f9fa;border-radius:8px;">
          <ul style="padding-inline-start:1rem;font-size:0.85rem;">
            ${Object.entries(limits).filter(([k, v]) => k !== 'requests_monthly').map(([k, v]) => `
              <li>${formatLimitLabel(k)}: ${v}</li>
            `).join('')}
          </ul>
        </div>
        
        ${isCurrent ? `
          <div class="muted" style="font-size:0.85rem;">✅ هذه هي الخطة الحالية</div>
        ` : `
          <button class="btn primary upgrade-btn" data-plan="${plan.name}"
            style="width:100%;">
            ترقية إلى ${plan.name_ar || plan.name}
          </button>
        `}
      </div>
    `;
  }

  // ============================================================
  // Helpers
  // ============================================================
  function formatNumber(n) {
    if (n === undefined || n === null) return '—';
    return Number(n).toLocaleString('ar-EG');
  }

  function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('ar-EG', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  function formatLimitLabel(key) {
    const labels = {
      users: 'จำนวน المستخدمين',
      employees: 'العدد المسموح للموظفين',
      products: 'عدد المنتجات المسموح',
      customers: 'عدد العملاء المسموح',
      storage_mb: 'حد التخزين',
      orders_monthly: 'أوامر البيع الشهرية',
      requests_monthly: 'طلبات API الشهرية'
    };
    return labels[key] || key;
  }

  // ============================================================
  // exports
  // ============================================================
  window.SubscriptionsManager = {
    getWarehousePlan,
    getAllPlans,
    checkUsageLimit,
    upgradePlan,
    getSubscriptionOverview,
    isOverLimit,
    isNearLimit,
    renderSubscriptionPanel
  };
})();
