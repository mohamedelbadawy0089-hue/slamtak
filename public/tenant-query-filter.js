/**
 * tenant-query-filter.js
 * =====================
 * وحدة center لفلترة جميع الاستعلامات بـ tenant_id تلقائياً.
 * ترفق على كل من .from() و .select() و .insert() و .update() و .delete()
 * لتضيف tenant_id تلقائياً.
 *
 * الاستخدام:
 *   import { filterQuery } from './tenant-query-filter.js';
 *   أو استخدام global.filterQuery
 */

(function () {
  'use strict';

  // ============================================================
  // جلب tenant_id الحالي
  // ============================================================
  function getTenantId() {
    // 1. من localStorage
    try {
      const stored = localStorage.getItem('slamtak:tenant_id');
      if (stored) return stored;
    } catch (_) {}

    // 2. من session
    const session = getSession();
    if (session && session.tenant_id) return session.tenant_id;

    // 3. من __permCtx
    if (window.__permCtx && window.__permCtx.tenant_id) {
      return window.__permCtx.tenant_id;
    }

    // 4. من current_tenant_id() RPC
    try {
      const client = getSupabase();
      if (client) {
        const { data, error } = client.rpc('current_tenant_id');
        if (!error && data) {
          try {
            localStorage.setItem('slamtak:tenant_id', data);
          } catch (_) {}
          return data;
        }
      }
    } catch (_) {}

    return null;
  }

  // ============================================================
  // فلترة استعلام SELECT بإضافة tenant_id
  // ============================================================
  function addTenantFilter(queryBuilder, tableName) {
    const tenantId = getTenantId();
    if (!tenantId) return queryBuilder;

    const tablesNeedingTenant = new Set([
      'products', 'inventory', 'customers', 'employees',
      'purchase_orders', 'sales_orders', 'sales_invoices', 'purchase_invoices',
      'suppliers', 'goods_receipts', 'returns', 'general_ledger',
      'journal_entries', 'journal_entry_lines', 'chart_of_accounts',
      'bank_accounts', 'bank_transactions', 'bank_reconciliations',
      'cash_wallets', 'tax_rates', 'tax_transactions',
      'assets', 'depreciation_schedules', 'asset_disposals',
      'departments', 'job_titles', 'attendance_records',
      'leave_requests', 'payroll_runs', 'payroll_items',
      'pricing_rules', 'price_lists', 'promotions', 'discounts', 'segments',
      'automation_rules', 'reorder_rules', 'alert_rules',
      'automation_executions', 'recruitment_candidates',
      'performance_reviews'
    ]);

    // بعض الجداول لا تحتاج tenant_id (أنظمة عامة)
    const excludedTables = new Set([
      'roles', 'user_roles', 'role_permissions', 'permissions',
      'tenants', 'user_warehouses', 'audit_log', 'tenant_usage_stats',
      'daily_usage', 'subscriptions', 'subscription_invoices',
      'warehouse_employees', 'plans', 'employee_permissions'
    ]);

    if (excludedTables.has(tableName)) return queryBuilder;

    // إضافة tenant_id filter
    // تأكد من عدم إضافة filter مكرر
    try {
      return queryBuilder.eq('tenant_id', tenantId);
    } catch (_) {
      return queryBuilder;
    }
  }

  // ============================================================
  // تغليف Supabase client - Interceptor لـ tenant_id
  // ============================================================
  function createTenantAwareClient(originalClient) {
    if (!originalClient) return null;

    // إنشاء نسخة جديدة من العميل مع interceptor
    const proxied = {
      from: function (tableName) {
        const query = originalClient.from(tableName);
        return {
          select: function (...args) {
            const result = query.select(...args);
            return addTenantFilterToQuery(result, tableName);
          },
          insert: function (data) {
            // إضافة tenant_id تلقائياً لـ INSERT
            const tenantId = getTenantId();
            if (tenantId && data && typeof data === 'object' && !Array.isArray(data)) {
              data.tenant_id = tenantId;
            }
            return query.insert(data);
          },
          update: function (data) {
            const tenantId = getTenantId();
            if (tenantId && data && typeof data === 'object') {
              data.tenant_id = tenantId;
            }
            return query.update(data);
          },
          delete: function () {
            return addTenantFilterToQuery(query.delete(), tableName);
          },
          eq: function (col, val) {
            if (col === 'tenant_id') return query.eq(col, val);
            return query.eq(col, val);
          },
          // توجيه استدعاءات أخرى
          then: function (resolve, reject) {
            return query.then(resolve, reject);
          }
        };
      }
    };

    return proxied;
  }

  // ============================================================
  // إضافة tenant_id filter لـ Query (بعد أن يعود من PostgREST)
  // ============================================================
  function addTenantFilterToQuery(query, tableName) {
    const tenantId = getTenantId();
    if (!tenantId) return query;

    // الجداول التي يجب فلترتها
    const tablesNeedingFilter = new Set([
      'products', 'inventory', 'customers', 'employees',
      'purchase_orders', 'sales_orders', 'sales_invoices', 'purchase_invoices',
      'suppliers', 'goods_receipts', 'returns', 'general_ledger',
      'journal_entries', 'journal_entry_lines', 'chart_of_accounts',
      'bank_accounts', 'bank_transactions', 'bank_reconciliations',
      'cash_wallets', 'tax_rates', 'tax_transactions',
      'assets', 'depreciation_schedules', 'asset_disposals',
      'departments', 'job_titles', 'attendance_records',
      'leave_requests', 'payroll_runs', 'payroll_items',
      'pricing_rules', 'price_lists', 'promotions', 'discounts', 'segments',
      'automation_rules', 'reorder_rules', 'alert_rules',
      'automation_executions', 'recruitment_candidates',
      'performance_reviews'
    ]);

    // بعض الجداول لا تحتاج filter
    const excludedTables = new Set([
      'roles', 'user_roles', 'role_permissions', 'permissions',
      'tenants', 'user_warehouses', 'audit_log', 'tenant_usage_stats',
      'daily_usage', 'subscriptions', 'subscription_invoices',
      'warehouse_employees', 'plans', 'employee_permissions'
    ]);

    if (excludedTables.has(tableName)) return query;

    // إذا كان الجدول لا يحتاج filter - لا نضيفه
    if (!tablesNeedingFilter.has(tableName)) return query;

    // إضافة filter
    try {
      return query.eq('tenant_id', tenantId);
    } catch (_) {
      return query;
    }
  }

  // ============================================================
  // Exports
  // ============================================================
  window.TenantQueryFilter = {
    getTenantId,
    addTenantFilter,
    addTenantFilterToQuery,
    createTenantAwareClient
  };

})();
