import EmbeddedPostgres from 'embedded-postgres';
import { readFileSync } from 'fs';

const pg = new EmbeddedPostgres({
  databaseDir: '/tmp/pgdata-erp',
  user: 'postgres',
  password: 'password',
  port: 55433,
  persistent: false,
});

const W = '/workspace/chats/1287c603b8cd7ae5ae3c9cc1';

async function run(client, label, sql) {
  try {
    await client.query(sql);
    console.log('OK   ' + label);
    return true;
  } catch (e) {
    console.log('FAIL ' + label + ' :: ' + e.message);
    return false;
  }
}

try {
  await pg.initialise();
  await pg.start();
  const client = pg.getPgClient();
  await client.connect();

  const sim = readFileSync(W + '/supabase/tests/live-schema-sim.sql', 'utf8');
  await run(client, 'live-schema-sim', sim);

  const combined = readFileSync(W + '/supabase/migrations/202610200000_combined_erp_migration.sql', 'utf8');
  const ok = await run(client, 'combined migration', combined);

  if (ok) {
    const r = await client.query(`
      select table_name from information_schema.tables
      where table_schema='public' and table_name in (
        'general_ledger','financial_periods','journal_entry_lines','opening_balances',
        'cash_wallets','bank_accounts','bank_transactions','bank_reconciliations',
        'tax_rates','tax_transactions','assets','depreciation_schedules','asset_disposals',
        'approval_workflows','approval_logs')
      order by table_name`);
    console.log('\ntables created: ' + r.rows.map(x => x.table_name).join(', '));

    const f = await client.query(`
      select routine_name from information_schema.routines
      where routine_schema='public' and routine_name in (
        'f_create_tax_transactions_sales','f_create_tax_transactions_purchases',
        'fn_income_statement','fn_balance_sheet','fn_period_close','fn_retain_earnings_transfer',
        'p_create_sale_gl_entries','p_create_purchase_gl_entries','f_block_closed_period')
      order by routine_name`);
    console.log('functions created: ' + f.rows.map(x => x.routine_name).join(', '));

    const tr = await client.query(`
      select distinct trigger_name from information_schema.triggers
      where trigger_name in (
        'trg_sales_invoice_tax_automation','trg_purchase_order_tax_automation',
        'trg_sales_invoice_gl_automation','trg_purchase_order_gl_automation',
        'trg_block_closed_period_gl','trg_block_closed_period_je',
        'trg_update_customer_balance','trg_update_supplier_balance',
        'trg_cash_wallet_balance_change','trg_bank_transaction_gl_auto',
        'trg_update_asset_depreciation','trg_insert_asset_depreciation')
      order by trigger_name`);
    console.log('triggers created: ' + tr.rows.map(x => x.trigger_name).join(', '));

    const coa = await client.query(`select count(*) as n from public.chart_of_accounts`);
    console.log('chart_of_accounts rows: ' + coa.rows[0].n);

    // اختبار وظيفي: فاتورة بيع → قيود يومية + ضريبة
    await client.query(`
      insert into public.warehouses (id, tenant_id, name, is_main)
      values ('00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000001','W1', true);
      insert into public.customers (id, tenant_id, warehouse_id, name, code)
      values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-000000000009','C1','C-1');
      insert into public.products (id, tenant_id, name)
      values ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000001','P1');
      insert into public.sales_invoices (id, tenant_id, warehouse_id, customer_id, invoice_number,
        subtotal, tax_amount, total_amount, status, updated_by)
      values ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-00000000000a',
              'INV-1', 100, 14, 114, 'draft', null);
      insert into public.sales_invoice_items (sales_invoice_id, product_id, quantity, unit_price,
        tax_percent, line_total)
      values ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000b',
              1, 100, 14, 114);`);

    await client.query(`update public.sales_invoices set status='issued'
      where id='00000000-0000-0000-0000-00000000000c'`);

    const gl = await client.query(`select count(*) as n from public.general_ledger`);
    const tt = await client.query(`select count(*) as n from public.tax_transactions`);
    console.log('\nGL entries after invoice issue: ' + gl.rows[0].n);
    console.log('tax transactions after invoice issue: ' + tt.rows[0].n);
  }

  await client.end();
} catch (e) {
  console.error('TEST ERROR: ' + e.message);
} finally {
  await pg.stop().catch(() => {});
}
