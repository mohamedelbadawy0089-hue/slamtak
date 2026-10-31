/** 
 * المرحلة 1 — اختبارات التزامن واتساق المعاملات (على قاعدة حقيقية)
 * 
 * 1) نداءا استلام متزامنان لنفس المستند → ترحيل واحد فقط، والمخزون يزيد مرة واحدة.
 * 2) فشل الترحيل في منتصفه (بند غير صالح) → تراجع كامل، لا ترحيل جزئي.
 * 
 * تُنشأ بيانات الاختبار داخل مخزن ومؤسسة مخصصة ثم تُحذف بالكامل بعد الاختبار.
 * الاتصال مباشر بـPostgreSQL عبر كلمةمرور المشروع (SUPABASE_DB_PASSWORD)،
 * وتُنفَّذ دوال wms_gr_create / wms_gr_post داخل معاملات حقيقية بنفس ترتيب
 * نداء التطبيق لضمان نتائج حقيقية.
 */

const { readFileSync, existsSync } = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');

function loadEnv() {
  const env = {};
  const file = path.join(ROOT, '.env.local');
  if (!existsSync(file)) return env;
  readFileSync(file, 'utf8').split('\n').forEach((line) => {
    const i = line.indexOf('=');
    if (i > 0 && !line.startsWith('#')) env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^'|'$/g, '');
  });
  return env;
}

const ENV = loadEnv();
const PG_PASSWORD = ENV.SUPABASE_DB_PASSWORD || 'rhuJal9N5B0ziIBV';
const PG_HOST = 'db.iksjhjxwphmvthryfeae.supabase.co';
const PG_PORT = 5432;
const PG_DB = 'postgres';
const PG_USER = 'postgres';

let client;

jest.setTimeout(120000);

afterAll(async () => {
  if (client) await client.end();
});

const uid = () => '00000000-0000-4000-8000-' + String(Math.floor(Math.random() * 1e12)).padStart(12, '0');

const ctx = {};

beforeAll(async () => {
  // Connect client first
  client = new Client({
    host: PG_HOST, port: PG_PORT, user: PG_USER, password: PG_PASSWORD,
    database: PG_DB, ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  ctx.tenant = uid();
  ctx.warehouse = uid();
  ctx.warehouse = uid();
  ctx.user = uid();
  ctx.supplier = uid();
  ctx.product = uid();
  ctx.po = uid();

  await client.query(`insert into public.tenants (id, name, name_ar, code, email, country, is_active) values ($1, 'PHASE1 CONC', '_phase1_conc', $2, $3, 'EG', true)`, [ctx.tenant, 'P1C' + ctx.tenant.slice(-6), ctx.tenant + '@test.local']);
  await client.query(`insert into public.users (id, tenant_id, email, password_hash, first_name, last_name, role) values ($1, $2, $3, 'x', 'phase1', 'test', 'warehouse_manager')`, [ctx.user, ctx.tenant, ctx.user + '@test.local']);
  await client.query(`insert into public.warehouses (id, tenant_id, name, code, is_main, is_active) values ($1, $2, 'مخزن اختبار تزامن', $3, true, true)`, [ctx.warehouse, ctx.tenant, 'PC' + ctx.tenant.slice(-6)]);
  await client.query(`insert into public.user_warehouses (user_id, warehouse_id, tenant_id, is_default) values ($1, $2, $3, true)`, [ctx.user, ctx.warehouse, ctx.tenant]);
  await client.query(`insert into public.profiles (id, full_name, role) values ($1, 'phase1 test', 'manager')`, [ctx.user]);
  await client.query(`insert into public.suppliers (id, tenant_id, warehouse_id, name, code) values ($1, $2, $3, 'مورد اختبار تزامن', $4)`, [ctx.supplier, ctx.tenant, ctx.warehouse, 'SC' + ctx.tenant.slice(-6)]);
  await client.query(`insert into public.products (id, tenant_id, warehouse_id, name, name_ar, sku, unit_of_measure) values ($1, $2, $3, 'Ibuprofen 400', 'إيبوبروفين 400', $4, 'box')`, [ctx.product, ctx.tenant, ctx.warehouse, 'SKUP1' + ctx.tenant.slice(-6)]);
  await client.query(`insert into public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, is_active) values ($1, '120', 'Inventory', 'المخزون', 'asset', true)`, [ctx.tenant]);
  await client.query(`insert into public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, is_active) values ($1, '220', 'Accounts Payable', 'الدائنون', 'liability', true)`, [ctx.tenant]);
  await client.query(`insert into public.purchase_orders (id, tenant_id, supplier_id, warehouse_id, order_number, order_date, status, total_amount) values ($1, $2, $3, $4, $5, current_date, 'approved', 200)`, [ctx.po, ctx.tenant, ctx.supplier, ctx.warehouse, 'PO-CONC-' + ctx.tenant.slice(-6)]);
  await client.query(`insert into public.purchase_order_items (purchase_order_id, product_id, quantity, unit_price) values ($1, $2, 100, 2)`, [ctx.po, ctx.product]);
});

afterAll(async () => {
  // Reverse order cleanup (tolerant: each step independent)
  const cleanup = [
    [`delete from public.inventory_movements where warehouse_id = $1`, [ctx.warehouse]],
    [`delete from public.inventory where warehouse_id = $1`, [ctx.warehouse]],
    [`delete from public.goods_receipt_items where goods_receipt_id in (select id from public.goods_receipts where warehouse_id = $1)`, [ctx.warehouse]],
    [`delete from public.goods_receipts where warehouse_id = $1`, [ctx.warehouse]],
    [`delete from public.purchase_order_items where purchase_order_id in (select id from public.purchase_orders where warehouse_id = $1)`, [ctx.warehouse]],
    [`delete from public.purchase_orders where warehouse_id = $1`, [ctx.warehouse]],
    [`delete from public.products where warehouse_id = $1`, [ctx.warehouse]],
    [`delete from public.suppliers where warehouse_id = $1`, [ctx.warehouse]],
    [`delete from public.user_warehouses where warehouse_id = $1`, [ctx.warehouse]],
    [`delete from public.chart_of_accounts where tenant_id = $1`, [ctx.tenant]],
    [`delete from public.warehouses where id = $1`, [ctx.warehouse]],
    [`delete from public.profiles where id = $1`, [ctx.user]],
    [`delete from public.users where id = $1`, [ctx.user]],
    [`delete from public.tenants where id = $1`, [ctx.tenant]],
  ];
  for (const [query, params] of cleanup) {
    try { await client.query(query, params); } catch { /* continue cleanup */ }
  }
  if (client) { try { await client.end(); } catch {} }
});

// RPC wrapper using direct SQL with transactions
async function rpc(pName, params) {
  try {
    let result;
    if (pName === 'wms_gr_create') {
      // Call the actual function
      result = await client.query(`select public.wms_gr_create($1, $2, $3, $4) as data`, [params.p_purchase_order_id, JSON.stringify(params.p_items), params.p_notes, params.p_user_id]);
    } else if (pName === 'wms_gr_post') {
      result = await client.query(`select public.wms_gr_post($1, $2) as data`, [params.p_receipt_id, params.p_user_id]);
    } else {
      return { ok: false, error: { message: 'Unknown RPC: ' + pName } };
    }
    const row = result.rows[0];
    return { ok: true, data: row && row.data, raw: result };
  } catch (err) {
    return { ok: false, error: { message: err.message } };
  }
}

describe('المرحلة 1 — التزامن واتساق عمليات الاستلام', () => {
  test('ندا استلام متزامنان لنفس المستند → ترحيل واحد فقط وزيادة واحدة للمخزون', async () => {
    // Create receipt via RPC
    const created = await rpc('wms_gr_create', {
      p_purchase_order_id: ctx.po,
      p_items: [
        { product_id: ctx.product, batch_number: 'CONC-1', expiry_date: new Date(Date.now() + 86400000 * 200).toISOString().slice(0, 10), quantity: 50 }
      ],
      p_notes: 'اختبار تزامن',
      p_user_id: ctx.user
    });
    expect(created.ok).toBe(true);
    const receiptId = created.data.id || created.data.receipt_id;
    expect(receiptId).toBeTruthy();

    // Post receipt twice concurrently via two separate connections — only one should succeed
    const p = () => new Client({
      host: PG_HOST, port: PG_PORT, user: PG_USER, password: PG_PASSWORD,
      database: PG_DB, ssl: { rejectUnauthorized: false }
    });
    const [a, b] = await Promise.all([
      (async () => { const c = p(); await c.connect(); try { const r = await c.query(`select public.wms_gr_post($1, $2) as data`, [receiptId, ctx.user]); return { ok: true, data: r.rows[0] && r.rows[0].data }; } catch (err) { return { ok: false, error: { message: err.message } }; } finally { try { await c.end(); } catch {} } })(),
      (async () => { const c = p(); await c.connect(); try { const r = await c.query(`select public.wms_gr_post($1, $2) as data`, [receiptId, ctx.user]); return { ok: true, data: r.rows[0] && r.rows[0].data }; } catch (err) { return { ok: false, error: { message: err.message } }; } finally { try { await c.end(); } catch {} } })(),
    ]);

    const successes = [a, b].filter((r) => r.ok);
    const failures = [a, b].filter((r) => !r.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(String(failures[0].error?.message)).toContain('تم ترحيل مستند الاستلام');

    // Check inventory
    const stock = await client.query(`select quantity, available_quantity, batch_number from public.inventory where warehouse_id = $1`, [ctx.warehouse]);
    expect(stock.rows).toHaveLength(1);
    expect(Number(stock.rows[0].quantity)).toBe(50);
    expect(Number(stock.rows[0].available_quantity)).toBe(50);

    // Check movements
    const movements = await client.query(`select id, quantity from public.inventory_movements where warehouse_id = $1 and reference_id = $2`, [ctx.warehouse, receiptId]);
    expect(movements.rows).toHaveLength(1);
    expect(Number(movements.rows[0].quantity)).toBe(50);

    // Check receipt status
    const receipt = await client.query(`select status, posted_at from public.goods_receipts where id = $1`, [receiptId]);
    expect(receipt.rows[0].status).toBe('posted');
    expect(receipt.rows[0].posted_at).toBeTruthy();
  });

  test('فشل الترحيل في منتصفه يتراجع بالكامل (لا ترحيل جزئي)', async () => {
    // Create second purchase order
    const po2 = uid();
    await client.query(`insert into public.purchase_orders (id, tenant_id, supplier_id, warehouse_id, order_number, order_date, status, total_amount) values ($1, $2, $3, $4, $5, current_date, 'approved', 100)`, [po2, ctx.tenant, ctx.supplier, ctx.warehouse, 'PO-ATOM-' + ctx.tenant.slice(-6)]);
    await client.query(`insert into public.purchase_order_items (purchase_order_id, product_id, quantity, unit_price) values ($1, $2, 40, 2)`, [po2, ctx.product]);

    // Create receipt with single valid item
    const created = await rpc('wms_gr_create', {
      p_purchase_order_id: po2,
      p_items: [
        { product_id: ctx.product, batch_number: 'ATOM-1', expiry_date: new Date(Date.now() + 86400000 * 150).toISOString().slice(0, 10), quantity: 25 }
      ],
      p_notes: 'اختبار الاتساق',
      p_user_id: ctx.user
    });
    expect(created.ok).toBe(true);
    const receiptId = created.data.id || created.data.receipt_id;

    // Insert second item with quantity 0 (bypasses interface check, only DB sees it)
    await client.query(`insert into public.goods_receipt_items (goods_receipt_id, product_id, batch_number, expiry_date, quantity, quantity_ordered, quantity_received, unit_cost, cost_price) values ($1, $2, 'ATOM-2', current_date + 30, 10, 10, 0, 2, 2)`, [receiptId, ctx.product]);

    //_inventory before post (ATOM-1 rows)
    const before = await client.query(`select id from public.inventory where warehouse_id = $1 and batch_number = 'ATOM-1'`, [ctx.warehouse]);

    // Try to post - should fail
    const posted = await rpc('wms_gr_post', { p_receipt_id: receiptId, p_user_id: ctx.user });
    expect(posted.ok).toBe(false);
    expect(String(posted.error?.message)).toContain('كمية غير صحيحة');

    // No inventory should be added
    const after = await client.query(`select id from public.inventory where warehouse_id = $1 and batch_number = 'ATOM-1'`, [ctx.warehouse]);
    expect(after.rows.length).toBe(before.rows.length);

    const receipt = await client.query(`select status from public.goods_receipts where id = $1`, [receiptId]);
    expect(receipt.rows[0].status).toBe('draft');

    const movements = await client.query(`select id from public.inventory_movements where warehouse_id = $1 and reference_id = $2`, [ctx.warehouse, receiptId]);
    expect(movements.rows).toHaveLength(0);

    // Cleanup second PO items
    await client.query(`delete from public.goods_receipt_items where goods_receipt_id = $1`, [receiptId]);
    await client.query(`delete from public.goods_receipts where id = $1`, [receiptId]);
    await client.query(`delete from public.purchase_order_items where purchase_order_id = $1`, [po2]);
    await client.query(`delete from public.purchase_orders where id = $1`, [po2]);
  });
});
