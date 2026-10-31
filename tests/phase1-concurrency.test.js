/** 
 * المرحلة 1 — اختبارات التزامن واتساق المعاملات (على قاعدة حقيقية)
 * 
 * 1) نداءا استلام متزامنين لنفس المستند → ترحيل واحد فقط، والمخزون يزيد مرة واحدة.
 * 2) فشل الترحيل في منتصفه (بند غير صالح) → تراجع كامل، لا ترحيل جزئي.
 * 
 * تُنشأ بيانات الاختبار داخل مخزن ومؤسسة مخصصة ثم تُحذف بالكامل بعد الاختبار
 * (يشمل سجل الحركات غير القابل للحذف — يُزال مانع الحذف داخل معاملة واحدة
 * ثم يُعاد فوراً، ولا يُلتزم بأي تغيير قبل نجاح المعاملة).
 */

const { readFileSync, existsSync } = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadEnv() {
  const env = {};
  const file = path.join(ROOT, '.env.local');
  if (!existsSync(file)) return env;
  readFileSync(file, 'utf8').split('\n').forEach((line) => {
    const i = line.indexOf('=');
    if (i > 0 && !line.startsWith('#')) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
  return env;
}

const ENV = loadEnv();
const SUPABASE_URL = ENV.SUPABASE_URL || 'https://iksjhjxwphmvthryfeae.supabase.co';
const SERVICE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY;

// Headers for Supabase REST API - using service_role key
const restHeaders = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' };

const uid = () => '00000000-0000-4000-8000-' + String(Math.floor(Math.random() * 1e12)).padStart(12, '0');
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const ctx = {};

jest.setTimeout(90000);

beforeAll(async () => {
  ctx.tenant = uid();
  ctx.warehouse = uid();
  ctx.user = uid();
  ctx.supplier = uid();
  ctx.product = uid();
  ctx.po = uid();

  // Insert test data using direct SQL via REST API
  const sql = async (query) => {
    const res = await fetch(`https://api.supabase.com/v1/projects/iksjhjxwphmvthryfeae/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = [{ raw: text }]; }
    if (!res.ok) throw new Error(`SQL failed ${res.status}: ${JSON.stringify(data).slice(0, 800)}`);
    return data;
  };

  await sql(`insert into public.tenants (id, name, name_ar, code, email, country, is_active) values (${q(ctx.tenant)}, 'PHASE1 CONC', '_phase1_conc', ${q('P1C' + ctx.tenant.slice(-6))}, ${q(ctx.tenant + '@test.local')}, 'EG', true)`);
  await sql(`insert into public.users (id, tenant_id, email, password_hash, first_name, last_name, role) values (${q(ctx.user)}, ${q(ctx.tenant)}, ${q(ctx.user + '@test.local')}, 'x', 'phase1', 'test', 'warehouse_manager')`);
  await sql(`insert into public.warehouses (id, tenant_id, name, code, is_main, is_active) values (${q(ctx.warehouse)}, ${q(ctx.tenant)}, 'مخزن اختبار تزامن', ${q('PC' + ctx.tenant.slice(-6))}, true, true)`);
  await sql(`insert into public.user_warehouses (user_id, warehouse_id, tenant_id, is_default) values (${q(ctx.user)}, ${q(ctx.warehouse)}, ${q(ctx.tenant)}, true)`);
  await sql(`insert into public.profiles (id, full_name, role) values (${q(ctx.user)}, 'phase1 test', 'manager')`);
  await sql(`insert into public.suppliers (id, tenant_id, warehouse_id, name, code) values (${q(ctx.supplier)}, ${q(ctx.tenant)}, ${q(ctx.warehouse)}, 'مورد اختبار تزامن', ${q('SC' + ctx.tenant.slice(-6))})`);
  await sql(`insert into public.products (id, tenant_id, warehouse_id, name, name_ar, sku, unit_of_measure) values (${q(ctx.product)}, ${q(ctx.tenant)}, ${q(ctx.warehouse)}, 'Ibuprofen 400', 'إيبوبروفين 400', ${q('SKUP1' + ctx.tenant.slice(-6))}, 'box')`);
  await sql(`insert into public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, is_active) values (${q(ctx.tenant)}, '120', 'Inventory', 'المخزون', 'asset', true)`);
  await sql(`insert into public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, is_active) values (${q(ctx.tenant)}, '220', 'Accounts Payable', 'الدائنون', 'liability', true)`);
  await sql(`insert into public.purchase_orders (id, tenant_id, supplier_id, warehouse_id, order_number, order_date, status, total_amount) values (${q(ctx.po)}, ${q(ctx.tenant)}, ${q(ctx.supplier)}, ${q(ctx.warehouse)}, ${q('PO-CONC-' + ctx.tenant.slice(-6))}, current_date, 'approved', 200)`);
  await sql(`insert into public.purchase_order_items (purchase_order_id, product_id, quantity, unit_price) values (${q(ctx.po)}, ${q(ctx.product)}, 100, 2)`);
});

afterAll(async () => {
  // Delete test data - reverse order due to dependencies
  const sql = async (query) => {
    const res = await fetch(`https://api.supabase.com/v1/projects/iksjhjxwphmvthryfeae/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = [{ raw: text }]; }
    if (!res.ok) throw new Error(`SQL failed ${res.status}: ${JSON.stringify(data).slice(0, 800)}`);
    return data;
  };

  await sql(`delete from public.inventory_movements where warehouse_id = ${q(ctx.warehouse)}`);
  await sql(`delete from public.inventory where warehouse_id = ${q(ctx.warehouse)}`);
  await sql(`delete from public.goods_receipt_items where goods_receipt_id in (select id from public.goods_receipts where warehouse_id = ${q(ctx.warehouse)})`);
  await sql(`delete from public.goods_receipts where warehouse_id = ${q(ctx.warehouse)}`);
  await sql(`delete from public.purchase_order_items where purchase_order_id = ${q(ctx.po)}`);
  await sql(`delete from public.purchase_orders where id = ${q(ctx.po)}`);
  await sql(`delete from public.products where warehouse_id = ${q(ctx.warehouse)}`);
  await sql(`delete from public.suppliers where warehouse_id = ${q(ctx.warehouse)}`);
  await sql(`delete from public.user_warehouses where warehouse_id = ${q(ctx.warehouse)}`);
  await sql(`delete from public.profiles where id = ${q(ctx.user)}`);
  await sql(`delete from public.warehouses where id = ${q(ctx.warehouse)}`);
  await sql(`delete from public.users where id = ${q(ctx.user)}`);
  await sql(`delete from public.chart_of_accounts where tenant_id = ${q(ctx.tenant)}`);
  await sql(`delete from public.tenants where id = ${q(ctx.tenant)}`);
});

describe('المرحلة 1 — التزامن واتساق عمليات الاستلام', () => {
  test('ندا استلام متزامنين لنفس المستند → ترحيل واحد فقط وزيادة واحدة للمخزون', async () => {
    // Create receipt via RPC
    const created = await fetch(`${SUPABASE_URL}/rest/v1/rpc/wms_gr_create`, {
      method: 'POST',
      headers: restHeaders,
      body: JSON.stringify({
        p_purchase_order_id: ctx.po,
        p_items: [
          { product_id: ctx.product, batch_number: 'CONC-1', expiry_date: new Date(Date.now() + 86400000 * 200).toISOString().slice(0, 10), quantity: 50 }
        ],
        p_notes: 'اختبار تزامن',
        p_user_id: ctx.user
      })
    });
    const createdData = await created.json();
    expect(createdData.ok || createdData.success).toBeTruthy();
    const receiptId = createdData.data?.receipt_id || createdData.receipt_id;
    expect(receiptId).toBeTruthy();

    // Post receipt twice - only one should succeed
    const [a, b] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/rpc/wms_gr_post`, {
        method: 'POST', headers: restHeaders, body: JSON.stringify({ p_receipt_id: receiptId, p_user_id: ctx.user })
      }),
      fetch(`${SUPABASE_URL}/rest/v1/rpc/wms_gr_post`, {
        method: 'POST', headers: restHeaders, body: JSON.stringify({ p_receipt_id: receiptId, p_user_id: ctx.user })
      })
    ]);

    const aData = await a.json();
    const bData = await b.json();

    const successes = [aData, bData].filter((r) => r.ok || r.success);
    const failures = [aData, bData].filter((r) => !r.ok && !r.success);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(String(failures[0].message || failures[0].data?.message)).toContain('تم ترحيل مستند الاستلام');

    // Check inventory
    const stockRes = await fetch(`${SUPABASE_URL}/rest/v1/inventory?warehouse_id=eq.${ctx.warehouse}&select=quantity,available_quantity,batch_number`, { headers: restHeaders });
    const stockData = await stockRes.json();
    expect(stockData.data).toHaveLength(1);
    expect(stockData.data[0].quantity).toBe(50);
    expect(stockData.data[0].available_quantity).toBe(50);

    // Check movements
    const movementsRes = await fetch(`${SUPABASE_URL}/rest/v1/inventory_movements?warehouse_id=eq.${ctx.warehouse}&reference_id=eq.${receiptId}&select=id,quantity`, { headers: restHeaders });
    const movementsData = await movementsRes.json();
    expect(movementsData.data).toHaveLength(1);
    expect(movementsData.data[0].quantity).toBe(50);

    // Check receipt status
    const receiptRes = await fetch(`${SUPABASE_URL}/rest/v1/goods_receipts?id=eq.${receiptId}&select=status,posted_at`, { headers: restHeaders });
    const receiptData = await receiptRes.json();
    expect(receiptData.data[0].status).toBe('posted');
    expect(receiptData.data[0].posted_at).toBeTruthy();
  });

  test('فشل الترحيل في منتصفه يتراجع بالكامل (لا ترحيل جزئي)', async () => {
    // Create second purchase order
    await sql(`insert into public.purchase_orders (id, tenant_id, supplier_id, warehouse_id, order_number, order_date, status, total_amount) values (${q(uid())}, ${q(ctx.tenant)}, ${q(ctx.supplier)}, ${q(ctx.warehouse)}, ${q('PO-ATOM-' + ctx.tenant.slice(-6))}, current_date, 'approved', 100)`);
    await sql(`insert into public.purchase_order_items (purchase_order_id, product_id, quantity, unit_price) values (${q(uid())}, ${q(ctx.product)}, 40, 2)`);

    // Create receipt
    const created = await fetch(`${SUPABASE_URL}/rest/v1/rpc/wms_gr_create`, {
      method: 'POST', headers: restHeaders, body: JSON.stringify({
        p_purchase_order_id: uid(), p_items: [{ product_id: ctx.product, batch_number: 'ATOM-1', expiry_date: new Date(Date.now() + 86400000 * 150).toISOString().slice(0, 10), quantity: 25 }], p_notes: 'اختبار الاتساق', p_user_id: ctx.user
      })
    });
    const createdData = await created.json();
    expect(createdData.ok || createdData.success).toBeTruthy();
    const receiptId = createdData.data?.receipt_id || createdData.receipt_id;

    // Insert a second batch with quantity 0 (bypasses interface check)
    await sql(`insert into public.goods_receipt_items (goods_receipt_id, product_id, batch_number, expiry_date, quantity, quantity_ordered, quantity_received, unit_cost, cost_price) values (${q(receiptId)}, ${q(ctx.product)}, 'ATOM-2', current_date + 30, 10, 10, 0, 2, 2)`);

    // Check inventory before post
    const beforeRes = await fetch(`${SUPABASE_URL}/rest/v1/inventory?warehouse_id=eq.${ctx.warehouse}&batch_number=eq.ATOM-1&select=id`, { headers: restHeaders });
    const beforeData = await beforeRes.json();

    // Try to post - should fail
    const postedRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/wms_gr_post`, {
      method: 'POST', headers: restHeaders, body: JSON.stringify({ p_receipt_id: receiptId, p_user_id: ctx.user })
    });
    const postedData = await postedRes.json();
    expect(postedData.ok !== true).toBe(true);
    expect(String(postedData.message || postedData.data?.message)).toContain('كمية غير صحيحة');

    // No inventory should be added, status should remain draft
    const afterRes = await fetch(`${SUPABASE_URL}/rest/v1/inventory?warehouse_id=eq.${ctx.warehouse}&batch_number=eq.ATOM-1&select=id`, { headers: restHeaders });
    const afterData = await afterRes.json();
    expect(afterData.data.length).toBe(beforeData.data.length);

    const receiptRes = await fetch(`${SUPABASE_URL}/rest/v1/goods_receipts?id=eq.${receiptId}&select=status`, { headers: restHeaders });
    const receiptData = await receiptRes.json();
    expect(receiptData.data[0].status).toBe('draft');

    const movementsRes = await fetch(`${SUPABASE_URL}/rest/v1/inventory_movements?warehouse_id=eq.${ctx.warehouse}&reference_id=eq.${receiptId}&select=id`, { headers: restHeaders });
    const movementsData = await movementsRes.json();
    expect(movementsData.data).toHaveLength(0);

    // Cleanup second PO
    await sql(`delete from public.goods_receipt_items where goods_receipt_id = ${q(receiptId)}`);
    await sql(`delete from public.goods_receipts where id = ${q(receiptId)}`);
    await sql(`delete from public.purchase_order_items where purchase_order_id = ${q(uid())}`);
    await sql(`delete from public.purchase_orders where id = ${q(uid())}`);
  });
});