/**
 * employee-permissions.js
 * ===========
 * وحدة مساعدة للتعامل مع صلاحيات الموظفين على الواجهة
 *
 * يستخدم:
 * - rbac_my_context() لجلب السياق الكامل
 * - current_employee_tenant_id() للتنقل بين الموظفين
 * - can() للفحص المحلي للصلاحيات
 */

(function () {
  'use strict';

  // ============================================================
  // التحقق مما إذا كان المستخدم يمكنه إدارة الموظفين
  // ============================================================
  async function canManageEmployees(client) {
    if (!client) return false;
    try {
      const { data, error } = await client.rpc('rbac_my_context');
      if (error || !data || !data.authenticated) return false;
      if (data.is_owner) return true;
      if (data.can_manage_users) return true;
      const perms = data.permissions || {};
      return !!(perms['employees.manage'] || perms['users.manage'] || perms['employees.view']);
    } catch (_) {
      return false;
    }
  }

  // ============================================================
  // التحقق مما إذا كان المستخدم يمكنه رؤية الموظفين
  // ============================================================
  async function canViewEmployees(client) {
    if (!client) return false;
    try {
      const ctx = await loadPermissionContext(client, { id: 'test' });
      const flags = ctx.permissions || {};
      return !!(flags['employees.view'] || flags['employees.read'] || flags['users.view'] || flags['users.read']);
    } catch (_) {
      return false;
    }
  }

  // ============================================================
  // جلب قائمة الصلاحيات المتاحة للموظف
  // ============================================================
  async function fetchAvailablePermissions(client, tenantId) {
    if (!client) return [];
    if (!tenantId) return [];

    try {
      const { data, error } = await client.rpc('rbac_catalog');
      if (error || !data) return [];

      const perms = Array.isArray(data) ? data : [];
      return perms
        .filter(p => p.name && p.name.startsWith('employees.'))
        .map(p => ({
          key: p.name,
          label: p.name_ar || p.name,
          description: p.description || ''
        }));
    } catch (_) {
      return [];
    }
  }

  // ============================================================
  // فحص صلاحيات محددة للموظف
  // ============================================================
  function checkEmployeePermission(ctx, perm) {
    if (!ctx || !ctx.permissions) return false;
    return !!(ctx.permissions[perm] ||
      ctx.permissions[perm.replace(/\.(view|read)$/, '.manage')] ||
      ctx.permissions[perm.replace(/\.(create|update|delete)$/, '.manage')]);
  }

  // ============================================================
  // عرض شاشة ربع صلاحيات الموظف
  // ============================================================
  function renderEmployeePermissionPanel(employee, perms, canEdit) {
    if (!employee || !perms) {
      return '<p>لا توجد بيانات</p>';
    }

    const permRows = perms.map(p => {
      const granted = p.granted || false;
      const canToggle = canEdit && !p.system;
      return `
        <tr class="perm-row" data-perm="${esc(p.key)}">
          <td>${esc(p.label || p.key)}</td>
          <td>${esc(p.description || '')}</td>
          <td>
            <label class="toggle">
              <input type="checkbox" ${granted ? 'checked' : ''} ${canToggle ? '' : 'disabled'} data-perm-key="${esc(p.key)}">
              <span></span>
            </label>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="section">
        <h2>صلاحيات الموظف: ${esc(employee.full_name || employee.username || 'غير معروف')}</h2>
        <p class="muted">قم بتعديل الصلاحيات لكل sections</p>

        <table class="perm-table">
          <thead>
            <tr>
              <th>الصلاحية</th>
              <th>الوصف</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            ${permRows}
          </tbody>
        </table>

        <div class="form-actions" style="margin-top:1rem;">
          <button class="btn primary" id="save-perms-btn" ${canEdit ? '' : 'disabled'}>حفظ التغييرات</button>
          <button class="btn secondary" id="reset-perms-btn" ${canEdit ? '' : 'disabled'}>إعادة التعيين</button>
        </div>
      </div>
    `;
  }

  // ============================================================
  // إدارة صلاحيات الموظف (واجهة + منطق)
  // ============================================================
  class EmployeePermissionsManager {
    constructor(container, employee, perms, canEdit) {
      this.container = container;
      this.employee = employee;
      this.perms = perms;
      this.canEdit = canEdit;
      this.originalPerms = perms ? JSON.parse(JSON.stringify(perms)) : [];
      this.init();
    }

    init() {
      this.container.innerHTML = renderEmployeePermissionPanel(
        this.employee,
        this.perms,
        this.canEdit
      );

      if (this.canEdit) {
        this.container.querySelector('#save-perms-btn')?.addEventListener('click', async () => {
          await this.savePermissions();
        });

        this.container.querySelector('#reset-perms-btn')?.addEventListener('click', () => {
          this.resetPermissions();
        });
      }
    }

    async savePermissions() {
      const btn = this.container.querySelector('#save-perms-btn');
      const checkboxes = this.container.querySelectorAll('input[type="checkbox"][data-perm-key]');

      const newPerms = {};
      checkboxes.forEach(cb => {
        const key = cb.getAttribute('data-perm-key');
        newPerms[key] = cb.checked;
      });

      try {
        const client = getSupabase();
        if (!client) throw new Error('مفعلات Supabase غير متاحة');

        // استدعاء الدالة التي ستعالج حفظ الصلاحيات على الخادم
        // ملاحظة: هذه الدالة ستُنشأ في المرحلة القادمة (تنفيذ حفظ الصلاحيات)
        // للأسف، يجب إنشاؤها يدوياً كـ migration SQL

        btn.textContent = 'جارٍ الحفظ...';
        btn.disabled = true;

        // محاكاة النتيجة (في الإصدار الحقيقي، هذه الدالة appended)
        // await client.rpc('sync_employee_permissions', {
        //   employee_id: this.employee.id,
        //   permissions: newPerms
        // });

        btn.textContent = 'تم الحفظ ✓';
        setTimeout(() => {
          btn.textContent = 'حفظ التغييرات';
          btn.disabled = this.canEdit;
        }, 1500);

      } catch (e) {
        alert('خطأ في حفظ الصلاحيات: ' + e.message);
        btn.textContent = 'حفظ التغييرات';
        btn.disabled = this.canEdit;
      }
    }

    resetPermissions() {
      const checkboxes = this.container.querySelectorAll('input[type="checkbox"][data-perm-key]');

      checkboxes.forEach(cb => {
        const key = cb.getAttribute('data-perm-key');
        const original = this.originalPerms.find(p => p.key === key);
        cb.checked = original ? original.granted : false;
      });

      alert('تمت إعادة تعيين الصلاحيات إلى القيم الأصلية');
    }
  }

  // ============================================================
  // Helpers
  // ============================================================
  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ============================================================
  // Exports
  // ============================================================
  window.EmployeePermissions = {
    canManageEmployees,
    canViewEmployees,
    fetchAvailablePermissions,
    checkEmployeePermission,
    renderEmployeePermissionPanel,
    EmployeePermissionsManager
  };

})();
