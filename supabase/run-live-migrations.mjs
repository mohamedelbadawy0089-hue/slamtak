// تنفيذ الهجرات مباشرة على مشروع Supabase الحيّ عبر Management API
// الاستخدام: node supabase/run-live-migrations.mjs [--dry-run]
// المطلوب: ملف secrets/SUPABASE_ACCESS_TOKEN يحتوي Personal Access Token (يُفضَّل بصلاحية المشروع/المنظمة فقط)

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF = process.env.SUPABASE_PROJECT_REF || 'iksjhjxwphmvthryfeae';
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;

function loadToken() {
  try { return readFileSync(join(ROOT, 'secrets/SUPABASE_ACCESS_TOKEN'), 'utf8').trim(); } catch (_) {}
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  throw new Error(' secrets/SUPABASE_ACCESS_TOKEN غير موجود');
}

const FILES = [
  '202610200001_create_chart_of_accounts.sql',
  '202610200002_create_gl_trigger_sales.sql',
  '202610200003_create_gl_trigger_purchases.sql',
  '202610200004_create_ar_ap_opening_balances.sql',
  '202610200005_cash_bank_management.sql',
  '202610200006_egyptian_tax_engine.sql',
  '202610200007_production_complete.sql',
  '202610200008_seed_coa_for_existing_tenants.sql',
  '202610200009_warehouse_login_password.sql',
];

// فصل SQL إلى عبارات، مع مراعاة $body$ و'نصوص' وتعليقات -- و/* */
export function splitStatements(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const two = sql.substr(i, 2);
    if (two === '--') { while (i < n && sql[i] !== '\n') i++; continue; }
    if (two === '/*') { const e = sql.indexOf('*/', i + 2); i = e === -1 ? n : e + 2; continue; }
    if (ch === "'") { buf += ch; i++; while (i < n) { buf += sql[i]; if (sql[i] === "'") { if (sql[i + 1] === "'") { buf += sql[++i]; i++; break; } i++; break; } i++; } continue; }
    if (ch === '$') {
      const m = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        buf += sql.slice(i, end === -1 ? n : end + tag.length);
        i = end === -1 ? n : end + tag.length;
        continue;
      }
    }
    if (ch === ';') { if (buf.trim()) out.push(buf.trim()); buf = ''; i++; continue; }
    buf += ch; i++;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const token = loadToken();
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

async function runSql(query, { label = '' } = {}) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(API, { method: 'POST', headers: H, body: JSON.stringify({ query }) });
    const text = await r.text();
    if (r.status === 429 && attempt < 4) { await new Promise(s => setTimeout(s, 1500 * (attempt + 1))); continue; }
    if (!r.ok) {
      let msg = text.slice(0, 500);
      try { msg = JSON.parse(text).message || msg; } catch (_) {}
      return { ok: false, status: r.status, message: msg };
    }
    let rows = [];
    try { rows = JSON.parse(text); } catch (_) {}
    return { ok: true, rows, label };
  }
}

function show(title, rows, keys) {
  console.log('\n### ' + title);
  for (const r of rows) {
    console.log('  ' + keys.map(k => `${k}=${r[k]}`).join('  '));
  }
}

// ---------------------------------------------------------------- main
const dry = process.argv.includes('--dry-run');
console.log(`== Supabase live migration runner ==\nproject: ${REF}\nmode: ${dry ? 'DRY-RUN (فحص فقط)' : 'LIVE EXECUTION'}\n`);

const pre = await runSql(`
  select table_name from information_schema.tables
   where table_schema='public' and table_name in ('warehouses','customers','suppliers','products',
     'sales_invoices','sales_invoice_items','inventory_movements','purchase_orders','goods_receipts',
     'user_warehouses','chart_of_accounts','general_ledger')
   order by table_name`);
console.log('المتطلبات السابقة الموجودة:');
console.log('  ' + (pre.rows || []).map(r => r.table_name).join(', '));

const required = ['warehouses', 'customers', 'suppliers', 'sales_invoices', 'sales_invoice_items'];
const have = new Set((pre.rows || []).map(r => r.table_name));
const missing = required.filter(t => !have.has(t));
if (missing.length) {
  console.error('\n  جداول أساسية مفقودة يجب تطبيق الهجرات السابقة عليها أولاً: ' + missing.join(', '));
  process.exit(3);
}

if (dry) {
  for (const f of FILES) {
    const sql = readFileSync(join(ROOT, 'supabase/migrations', f), 'utf8');
    console.log(`\n${f}: ${splitStatements(sql).length} عبارة جاهزة`);
  }
  process.exit(0);
}

const onlyArg = process.argv.find(a => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length) : null;
for (const f of (process.argv.includes('--verify-only') ? [] : FILES.filter(f => !only || f.includes(only)))) {
  const sql = readFileSync(join(ROOT, 'supabase/migrations', f), 'utf8');
  process.stdout.write(`\n▶ تنفيذ ${f} ... `);
  const t0 = Date.now();
  const res = await runSql('begin;\n' + sql + '\ncommit;');
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.ok) { console.log(`تم (${secs}s)`); continue; }

  // فشل: حدد العبارة المخالفة داخل معاملة تُلغى (begin/rollback) حتى لا يُطبَّق شيء
  console.log(`فشل (${secs}s)\n  السبب: ${res.message}`);
  const stmts = splitStatements(sql);

  const probe = async (a, b) => {
    const body = 'begin;\n' + stmts.slice(a, b).join(';\n') + ';\nrollback;';
    return runSql(body);
  };
  const whole = await probe(0, stmts.length);
  if (whole.ok) {
    console.error('\n✖ تعذّر تحديد العبارة المخالفة (المحاولة داخل معاملة مُلغاة نجحت).');
    process.exit(1);
  }
  let a = 0, b = stmts.length;
  while (b - a > 1) {
    const mid = Math.floor((a + b) / 2);
    const r = await probe(a, mid);
    if (!r.ok) b = mid; else a = mid;
  }
  console.error(`\n✖ العبارة المخالفة رقم ${a + 1}/${stmts.length} في ${f}:`);
  console.error('  ' + (await probe(a, a + 1)).message);
  console.error('--- محتوى العبارة (أو بدايتها) ---');
  console.error(stmts[a].split('\n').slice(0, 15).join('\n'));
  console.error('\nتم إيقاف التنفيذ قبل أي تعديل — لم يُطبَّق أي ملف بعد هذا الفشل (كل المحاولات كانت داخل begin/rollback).');
  process.exit(1);
}

// ---------------------------------------------------------------- الفحص النهائي
console.log('\n================ الفحص النهائي ================');

const t1 = await runSql(`
  select table_name from information_schema.tables
   where table_schema='public' and table_name in (
     'chart_of_accounts','general_ledger','journal_entries','journal_entry_lines','financial_periods',
     'cash_wallets','bank_accounts','bank_transactions','bank_reconciliations',
     'tax_rates','tax_transactions','assets','depreciation_schedules','asset_disposals',
     'approval_workflows','approval_logs')
   order by table_name`);
show('الجداول المتوقعة بعد الهجرة', t1.rows || [], ['table_name']);

const t2 = await runSql(`
  select routine_name from information_schema.routines
   where routine_schema='public' and routine_name in (
     'f_block_closed_period','f_create_tax_transactions_sales','f_create_tax_transactions_purchases',
     'fn_income_statement','fn_balance_sheet','fn_period_close','fn_retain_earnings_transfer',
     'p_create_sale_gl_entries','p_create_purchase_gl_entries')
   order by routine_name`);
show('الدوال المتوقعة', t2.rows || [], ['routine_name']);

const t3 = await runSql(`
  select distinct trigger_name from information_schema.triggers
   where trigger_name in (
     'trg_block_closed_period_gl','trg_block_closed_period_je',
     'trg_sales_invoice_gl_automation','trg_purchase_order_gl_automation',
     'trg_sales_invoice_tax_automation','trg_purchase_order_tax_automation',
     'trg_update_customer_balance','trg_update_supplier_balance',
     'trg_cash_wallet_balance_change','trg_bank_transaction_gl_auto',
     'trg_insert_asset_depreciation','trg_update_asset_depreciation')
   order by trigger_name`);
show('المُشغّلات المتوقعة', t3.rows || [], ['trigger_name']);

const t4 = await runSql(`
  select (select count(*) from public.chart_of_accounts) as coa,
         (select count(*) from public.general_ledger) as gl,
         (select count(*) from public.journal_entries) as je,
         (select count(*) from public.tax_rates) as tax_rates,
         (select coalesce(sum(debit),0) from public.general_ledger) as gl_debit,
         (select coalesce(sum(credit),0) from public.general_ledger) as gl_credit`);
show('البيانات الحالية', t4.rows || [], ['coa', 'gl', 'je', 'tax_rates', 'gl_debit', 'gl_credit']);

const t5 = await runSql(`
  select
    (select count(*) from public.chart_of_accounts c
       join public.chart_of_accounts p on p.id = c.parent_id
      where c.tenant_id = p.tenant_id and (c.lft < p.lft or c.rgt > p.rgt)) as nested_set_bad,
    (select count(*) from (
       select tenant_id, lft from public.chart_of_accounts
        group by tenant_id, lft having count(*) > 1) d) as duplicate_lft,
    (select count(*) from (
       select tenant_id, rgt from public.chart_of_accounts
        group by tenant_id, rgt having count(*) > 1) d) as duplicate_rgt`);
show('سلامة شجرة الحسابات (nested set)', t5.rows || [], ['nested_set_bad', 'duplicate_lft', 'duplicate_rgt']);

// اختبار وظيفي داخل معاملة تُلغى بعدها — لا يترك أي بيانات
const fn = await runSql(`
begin;
create temporary table mig_tenant on commit drop as
  select id as tenant_id from public.tenants where deleted_at is null order by created_at limit 1;
insert into public.warehouses (id, tenant_id, name, code, is_main)
select '00000000-0000-0000-0000-0000000000f1', tenant_id, '__migtest_wh__', 'MIG-TEST-WH', true
  from mig_tenant;
insert into public.customers (id, tenant_id, warehouse_id, name, name_ar, code, payment_terms)
select '00000000-0000-0000-0000-0000000000f2', tenant_id,
       '00000000-0000-0000-0000-0000000000f1', '__migtest_customer__', 'عميل اختبار الهجرة', 'MIG-TEST', '0'
  from mig_tenant;
insert into public.products (id, tenant_id, name, name_ar, sku)
select '00000000-0000-0000-0000-0000000000f3', tenant_id, '__migtest_product__', 'منتج اختبار الهجرة', 'MIG-SKU'
  from mig_tenant;
insert into public.sales_invoices (id, tenant_id, warehouse_id, customer_id, invoice_number, invoice_date,
  subtotal, tax_amount, total_amount, status, updated_by)
select '00000000-0000-0000-0000-0000000000f4', tenant_id,
       '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2',
       'MIG-TEST-INV', current_date, 100, 14, 114, 'draft', null
  from mig_tenant;
insert into public.sales_invoice_items (sales_invoice_id, product_id, quantity, unit_price,
  tax_percent, line_total)
values ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000f3',
        1, 100, 14, 114);
update public.sales_invoices set status = 'issued'
 where id = '00000000-0000-0000-0000-0000000000f4';
select (select count(*) from mig_tenant) as using_real_tenant,
       (select count(*) from public.general_ledger
         where reference_type='sales_invoice'
           and reference_id='00000000-0000-0000-0000-0000000000f4') as gl_entries,
       (select count(*) from public.tax_transactions
         where reference_type='sales_invoice'
           and reference_id='00000000-0000-0000-0000-0000000000f4') as tax_rows,
       (select coalesce(sum(debit),0) from public.general_ledger
         where reference_type='sales_invoice'
           and reference_id='00000000-0000-0000-0000-0000000000f4') as total_debit,
       (select coalesce(sum(credit),0) from public.general_ledger
         where reference_type='sales_invoice'
           and reference_id='00000000-0000-0000-0000-0000000000f4') as total_credit;
rollback;`);
if (fn.ok) {
  show('اختبار وظيفي (فاتورة بيع تُلغى بعدها — بلا أثر على بياناتك)', fn.rows || [], ['using_real_tenant', 'gl_entries', 'tax_rows', 'total_debit', 'total_credit']);
} else {
  console.log('\n⚠️ الاختبار الوظيفي فشل: ' + fn.message);
}

console.log('\n✅ انتهى التنفيذ.');
