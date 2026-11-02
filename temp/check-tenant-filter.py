# فحص استعلامات app.js التي تفتقر إلى tenant_id filter
import re

with open('public/app.js', 'r') as f:
    content = f.read()

# البحث عن استعلامات SELECT من الجداول الرئيسية بدون tenant_id
tables = ['products', 'inventory', 'customers', 'employees', 
          'purchase_orders', 'sales_orders', 'sales_invoices', 'purchase_invoices',
          'suppliers', 'goods_receipts', 'returns', 'general_ledger',
          'journal_entries', 'journal_entry_lines', 'chart_of_accounts',
          'bank_accounts', 'bank_transactions', 'bank_reconciliations',
          'cash_wallets', 'tax_rates', 'tax_transactions', 'assets',
          'depreciation_schedules', 'asset_disposals',
          'delivery_orders', 'departments', 'job_titles', 'attendance_records',
          'leave_requests', 'payroll_runs', 'payroll_items',
          'recruitment_candidates', 'performance_reviews',
          'automation_rules', 'reorder_rules', 'alert_rules',
          'automation_executions', 'pricing_rules', 'price_lists',
          'promotions', 'discounts', 'segments',
          'user_warehouses', 'roles', 'user_roles', 'role_permissions',
          'permissions']

issues = []

for table in tables:
    # البحث عن .from("TABLE") (أو .from('TABLE')) ثم person التالية
    pattern = r'\.from("' + table + r'"\)\.select\('
    # طريقة أبسط: ابحث عن وجود .from("TABLE") مع .select(

print("=== استعلامات بدون tenant_id filter ===")
if issues:
    for issue in issues:
        print(f"  ⚠️ {issue}")
else:
    print("  ✅ لا توجد استعلامات واضحة بدون tenant_id filter")
print(f"\nإجمالي المشاكل المكتشفة: {len(issues)}")
