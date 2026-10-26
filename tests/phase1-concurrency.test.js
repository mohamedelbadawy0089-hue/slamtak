/**
 * المرحلة 1 — اختبارات التزامن واتساق المعاملات (على قاعدة حقيقية)
 *
 * 1) نداءا استلام متزامنان لنفس المستند → ترحيل واحد فقط، والمخزون يزيد مرة واحدة.
 * 2) فشل الترحيل في منتصفه (بند غير صالح) → تراجع كامل، لا ترحيل جزئي.
 *
 * تُنشأ بيانات الاختبار داخل مخزن ومؤسسة مخصصة ثم تُحذف بالكامل بعد الاختبار
 * (يشمل سجل الحركات غير القابل للحذف — يُزال مانع الحذف داخل معاملة واحدة
 *  ثم يُعاد فوراً، ولا يُلتزم بأي تغيير قبل نجاح المعاملة).
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
const MGMT_TOKEN = existsSync(path.join(ROOT, 'secrets/SUPABASE_ACCESS_TOKEN'))
  ? readFileSync(path.join(ROOT, 'secrets/SUPABASE_ACCESS_TOKEN'), 'utf8').trim()
  : null;

const restHeaders = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' };

async function sql(query) {
  const res = await fetch('https://api.supabase.com/v1/projects/iksjhjxwphmvthryfeae/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = [{ raw: text }]; }
  if (!res.ok) throw new Error(`SQL failed ${res.status}: ${JSON.stringify(data).slice(0, 800)}`);
  return data;
}

async function rpc(name, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: restHeaders,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

async function select(pathname) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, { headers: restHeaders });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : [] };
}

const uid = () => '00000000-0000-4000-8000-' + String(Math.floor(Math.random() * 1e12)).padStart(12, '0');
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const ctx = {};

jest.setTimeout(90000);

beforeAll(async () => {
  if (!MGMT_TOKEN) throw new Error('secrets/SUPABASE_ACCESS_TOKEN مفقود');

  ctx.tenant = uid();
  ctx.warehouse = uid();
  ctx.user = uid();
  ctx.supplier = uid();
  ctx.product = uid();
  ctx.po = uid();

  await sql(`
    insert into public.tenants (id, name, name_ar, code, email, country, is_active)
    values (${q(ctx.tenant)}, 'PHASE1 CONC', '_phase1_conc', ${q('P1C' + ctx.tenant.slice(-6))},
            ${q(ctx.tenant + '@test.local')}, 'EG', true);

    insert into public.users (id, tenant_id, email, password_hash, first_name, last_name, role)
    values (${q(ctx.user)}, ${q(ctx.tenant)}, ${q(ctx.user + '@test.local')}, 'x',
            'phase1', 'test', 'warehouse_manager');

    insert into public.warehouses (id, tenant_id, name, code, is_main, is_active)
    values (${q(ctx.warehouse)}, ${q(ctx.tenant)}, 'مخزن اختبار تزامن', ${q('PC' + ctx.tenant.slice(-6))}, true, true);

    insert into public.user_warehouses (user_id, warehouse_id, tenant_id, is_default)
    values (${q(ctx.user)}, ${q(ctx.warehouse)}, ${q(ctx.tenant)}, true);

    insert into public.profiles (id, full_name, role) values (${q(ctx.user)}, 'phase1 test', 'manager');

    insert into public.suppliers (id, tenant_id, warehouse_id, name, code)
    values (${q(ctx.supplier)}, ${q(ctx.tenant)}, ${q(ctx.warehouse)}, 'مورد اختبار تزامن', ${q('SC' + ctx.tenant.slice(-6))});

    insert into public.products (id, tenant_id, warehouse_id, name, name_ar, sku, unit_of_measure)
    values (${q(ctx.product)}, ${q(ctx.tenant)}, ${q(ctx.warehouse)}, 'Ibuprofen 400',
            'إيبوبروفين 400', ${q('SKUP1' + ctx.tenant.slice(-6))}, 'box');

    insert into public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, is_active)
    values (${q(ctx.tenant)}, '120', 'Inventory', 'المخزون', 'asset', true);
    insert into public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, is_active)
    values (${q(ctx.tenant)}, '220', 'Accounts Payable', 'الدائنون', 'liability', true);

    insert into public.purchase_orders (id, tenant_id, supplier_id, warehouse_id, order_number, order_date, status, total_amount)
    values (${q(ctx.po)}, ${q(ctx.tenant)}, ${q(ctx.supplier)}, ${q(ctx.warehouse)},
            ${q('PO-CONC-' + ctx.tenant.slice(-6))}, current_date, 'approved', 200);

    insert into public.purchase_order_items (purchase_order_id, product_id, quantity, unit_price)
    values (${q(ctx.po)}, ${q(ctx.product)}, 100, 2);
  `);
});

afterAll(async () => {
  // حذف بيانات الاختبار + إعادة مانعي السجل في معاملة واحدة
  const triggerSql = `
    drop trigger if exists inventory_movements_no_mutation on public.inventory_movements;
    drop trigger if exists inventory_movements_no_truncate on public.inventory_movements;
  `;
  const recreateTrigger = `
    create trigger inventory_movements_no_mutation
      before update or delete on public.inventory_movements
      for each row execute function public.wms_ledger_immutable();
    create trigger inventory_movements_no_truncate
      before truncate on public.inventory_movements
      for each statement execute function public.wms_ledger_immutable();
  `;
  const cleanup = `
    begin;
    ${triggerSql}
    delete from public.inventory_movements where warehouse_id = ${q(ctx.warehouse)};
    delete from public.inventory where warehouse_id = ${q(ctx.warehouse)};
    delete from public.goods_receipt_items
     where goods_receipt_id in (select id from public.goods_receipts where warehouse_id = ${q(ctx.warehouse)});
    delete from public.goods_receipts where warehouse_id = ${q(ctx.warehouse)};
    delete from public.purchase_order_items where purchase_order_id = ${q(ctx.po)};
    delete from public.purchase_orders where id = ${q(ctx.po)};
    delete from public.products where warehouse_id = ${q(ctx.warehouse)};
    delete from public.suppliers where warehouse_id = ${q(ctx.warehouse)};
    delete from public.user_warehouses where warehouse_id = ${q(ctx.warehouse)};
    delete from public.profiles where id = ${q(ctx.user)};
    delete from public.warehouses where id = ${q(ctx.warehouse)};
    delete from public.users where id = ${q(ctx.user)};
    delete from public.chart_of_accounts where tenant_id = ${q(ctx.tenant)};
    delete from public.tenants where id = ${q(ctx.tenant)};
    ${recreateTrigger}
    commit;
  `;
  await sql(cleanup);

  const check = await sql(
    `select count(*) as trg from pg_trigger
      where tgrelid = 'public.inventory_movements'::regclass and not tgisinternal
        and tgname in ('inventory_movements_no_mutation', 'inventory_movements_no_truncate')`
  );
  expect(Number(check[0].trg)).toBe(2);
});

describe('المرحلة 1 — التزامن واتساق عمليات الاستلام', () => {
  test('ندا استلام متزامنان لنفس المستند → ترحيل واحد فقط وزيادة واحدة للمخزون', async () => {
    const created = await rpc('wms_gr_create', {
      p_purchase_order_id: ctx.po,
      p_items: [
        {
          product_id: ctx.product,
          batch_number: 'CONC-1',
          expiry_date: new Date(Date.now() + 86400000 * 200).toISOString().slice(0, 10),
          quantity: 50,
        },
      ],
      p_notes: 'اختبار تزامن',
      p_user_id: ctx.user,
    });
    expect(created.ok).toBe(true);
    const receiptId = created.data.receipt_id;
    expect(receiptId).toBeTruthy();

    const [a, b] = await Promise.all([
      rpc('wms_gr_post', { p_receipt_id: receiptId, p_user_id: ctx.user }),
      rpc('wms_gr_post', { p_receipt_id: receiptId, p_user_id: ctx.user }),
    ]);

    const successes = [a, b].filter((r) => r.ok);
    const failures = [a, b].filter((r) => !r.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(String(failures[0].data && failures[0].data.message)).toContain('تم ترحيل مستند الاستلام');

    const stock = await select(
      `inventory?warehouse_id=eq.${ctx.warehouse}&select=quantity,available_quantity,batch_number`
    );
    expect(stock.data).toHaveLength(1);
    expect(stock.data[0].quantity).toBe(50);
    expect(stock.data[0].available_quantity).toBe(50);

    const movements = await select(
      `inventory_movements?warehouse_id=eq.${ctx.warehouse}&reference_id=eq.${receiptId}&select=id,quantity`
    );
    expect(movements.data).toHaveLength(1);
    expect(movements.data[0].quantity).toBe(50);

    const receipt = await select(`goods_receipts?id=eq.${receiptId}&select=status,posted_at`);
    expect(receipt.data[0].status).toBe('posted');
    expect(receipt.data[0].posted_at).toBeTruthy();
  });

  test('فشل الترحيل في منتصفه يتراجع بالكامل (لا ترحيل جزئي)', async () => {
    // أمر شراء ثانٍ
    const po2 = uid();
    await sql(`
      insert into public.purchase_orders (id, tenant_id, supplier_id, warehouse_id, order_number, order_date, status, total_amount)
      values (${q(po2)}, ${q(ctx.tenant)}, ${q(ctx.supplier)}, ${q(ctx.warehouse)},
              ${q('PO-ATOM-' + ctx.tenant.slice(-6))}, current_date, 'approved', 100);
      insert into public.purchase_order_items (purchase_order_id, product_id, quantity, unit_price)
      values (${q(po2)}, ${q(ctx.product)}, 40, 2);
    `);

    const created = await rpc('wms_gr_create', {
      p_purchase_order_id: po2,
      p_items: [
        {
          product_id: ctx.product,
          batch_number: 'ATOM-1',
          expiry_date: new Date(Date.now() + 86400000 * 150).toISOString().slice(0, 10),
          quantity: 25,
        },
      ],
      p_notes: 'اختبار الاتساق',
      p_user_id: ctx.user,
    });
    expect(created.ok).toBe(true);
    const receiptId = created.data.receipt_id;

    // بند ثانٍ بكمية صفر (يتجاوز تحقق الواجهة عمداً) → يفشل الترحيل بعد معالجة البند الأول
    await sql(`
      insert into public.goods_receipt_items
        (goods_receipt_id, product_id, batch_number, expiry_date, quantity, quantity_ordered, quantity_received, unit_cost, cost_price)
      values (${q(receiptId)}, ${q(ctx.product)}, 'ATOM-2', current_date + 30, 10, 10, 0, 2, 2);
    `);

    const before = await select(
      `inventory?warehouse_id=eq.${ctx.warehouse}&batch_number=eq.ATOM-1&select=id`
    );

    const posted = await rpc('wms_gr_post', { p_receipt_id: receiptId, p_user_id: ctx.user });
    expect(posted.ok).toBe(false);
    expect(String(posted.data && posted.data.message)).toContain('كمية غير صحيحة');

    // لا مخزون مضاف، والمستند ما زال draft — أي لا ترحيل جزئي
    const after = await select(
      `inventory?warehouse_id=eq.${ctx.warehouse}&batch_number=eq.ATOM-1&select=id`
    );
    expect(after.data).toHaveLength(before.data.length);

    const receipt = await select(`goods_receipts?id=eq.${receiptId}&select=status`);
    expect(receipt.data[0].status).toBe('draft');

    const movements = await select(
      `inventory_movements?warehouse_id=eq.${ctx.warehouse}&reference_id=eq.${receiptId}&select=id`
    );
    expect(movements.data).toHaveLength(0);

    // تنظيف أمر الشراء الثاني
    await sql(`
      delete from public.goods_receipt_items where goods_receipt_id = ${q(receiptId)};
      delete from public.goods_receipts where id = ${q(receiptId)};
      delete from public.purchase_order_items where purchase_order_id = ${q(po2)};
      delete from public.purchase_orders where id = ${q(po2)};
    `);
  });
});
