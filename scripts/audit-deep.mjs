// فحص عميق: جداول الملكية الأساسية + نمط السياسات + الفوترة + دوال الأدوار
import pg from 'pg';
import fs from 'fs';

const cl = new pg.Client({
  host: 'db.iksjhjxwphmvthryfeae.supabase.co',
  port: 5432,
  user: 'postgres',
  password: process.env.SUPABASE_DB_PASSWORD,
  database: 'postgres',
});
await cl.connect();

const out = [];

// 1) أعمدة ومفاتيح الجداول المركزية
const core = ['tenants', 'organizations', 'warehouses', 'user_warehouses', 'roles', 'profiles', 'permissions', 'role_permissions', 'settings', 'subscription_plans', 'master_products', 'audit_logs', 'hrm_audit_logs'];
for (const t of core) {
  const r = await cl.query(
    "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
    [t]
  );
  out.push({ table: t, cols: r.rows });
}

// 2) السياسات على الجداول المركزية (full definitions)
for (const t of core) {
  const r = await cl.query(
    "SELECT polname, polcmd, polroles, pg_get_expr(polqual, polrelid) AS using_q, pg_get_expr(polwithcheck, polrelid) AS check_q FROM pg_policy WHERE polrelid = ('public.' || $1)::regclass",
    [t]
  );
  if (r.rows.length) out.push({ policies_of: t, rows: r.rows });
}

// 3) سياسات ثلاث جداول تفصيلية كعينات (sales_invoice_items, return_items, payroll_items)
for (const t of ['sales_invoice_items', 'return_items', 'payroll_items', 'profiles', 'settings']) {
  const r = await cl.query(
    "SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_q, pg_get_expr(polwithcheck, polrelid) AS check_q FROM pg_policy WHERE polrelid = ('public.' || $1)::regclass",
    [t]
  );
  out.push({ policies_of: t, rows: r.rows });
}

// 4) FK mapping للأقسام التفصيلية: أي جدول بدون ملكية → مَن هو الأب عبر FK؟
const noOwn = ['attendance','automation_status_transitions','candidates','customer_segment_members','employee_assets','employee_contracts','employee_documents','employee_loans','employee_movements','goods_receipt_items','hr_notifications','hrm_audit_logs','interviews','job_openings','journal_entry_lines','leave_balances','leave_requests','leave_types','login_pins','payroll_items','payroll_settlements','payslips','performance_reviews','price_list_items','price_list_segments','promotion_customers','promotion_items','promotion_usage','purchase_invoice_items','purchase_order_items','purchase_request_items','refresh_tokens','return_items','role_permissions','sales_invoice_items','sales_order_items','sales_quote_items','settings','shifts','stock_transfer_items','password_reset_tokens','preparation_phone','warehouse_password_hashes'];
const fkmap = [];
for (const t of noOwn) {
  const fks = await cl.query(`
    SELECT kcu.column_name AS child_col, ccu.table_name AS parent_table, ccu.column_name AS parent_col
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
     WHERE tc.table_schema='public' AND tc.constraint_type='FOREIGN KEY' AND tc.table_name=$1`, [t]);
  fkmap.push({ table: t, fks: fks.rows });
}

// 5) أسماء الدوال المتعلقة بالأدوار/العزل
const helpers = await cl.query(`
  SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND (p.proname ILIKE '%tenant%' OR p.proname ILIKE '%warehouse%' OR p.proname ILIKE '%admin%' OR p.proname ILIKE '%member%' OR p.proname ILIKE '%role%' OR p.proname ILIKE '%context%')
   ORDER BY 1`);
fs.writeFileSync('artifacts/db-deep-audit.json', JSON.stringify(out.concat([{ fkmap }, { helpers: helpers.rows }]), null, 1));

console.log('=== core cols ===');
for (const o of out) if (o.cols) console.log(o.table, ':', o.cols.map(c => c.column_name + ':' + c.data_type).join(' , ').slice(0, 300));
console.log('=== helpers ===', helpers.rows.length);
helpers.rows.slice(0, 40).forEach(h => console.log(' ', h.name, '(', h.args, ')'));
console.log('=== sample policies ===');
for (const o of out) if (o.policies_of === 'tenants' || o.policies_of === 'warehouse') { console.log(o.policies_of); o.rows.slice(0, 4).forEach(p => console.log(' ', p.polname, p.polcmd, 'USING=', (p.using_q || '').slice(0, 200))); }
await cl.end();
