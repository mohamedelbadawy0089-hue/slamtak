// اختبار هجرة تزويد قائمة البيع الافتراضية وأسعار الأصناف القائمة — على قاعدة
// حقيقية لا على نصّ الملف.
//
// السيناريو كله داخل معاملة واحدة تُلغى في النهاية، فلا يبقى أثر على القاعدة:
//   * يُزال فهرس «افتراضية واحدة» مؤقتًا، ويُنشأ مخزن بقائمتين افتراضيتين،
//     ليُختبر أن الهجرة تُبقي واحدة بقرار حتمي.
//   * صنف له بيعان مؤكدان بسعرين ⇒ السعر = الأحدث لا الأدنى ولا التكلفة.
//   * صنف بلا بيع لكن بمخزون ⇒ متوسط التكلفة المرجّح.
//   * صنف بلا بيع ولا تكلفة، وصنف بوحدتين بلا أساسية، وصنف غير نشط ⇒ بلا سعر.
//   * تشغيل الهجرة مرتين ⇒ النتيجة نفسها، بلا تكرار ولا استبدال.
//   * بعد الإنشاء: إدراج قائمة افتراضية ثانية يُرفض بالفهرس الفريد.
//
// المتطلب: مخطط 20261108 مبني على القاعدة (بما فيه الهجرة 0003):
//   node scripts/apply-migrations.mjs
// التشغيل: npm run test:prices
//
// محليًا بلا قاعدة: يُتخطّى برسالة. وغياب القاعدة في CI فشل صريح عبر
// ISOLATION_DB_REQUIRED=1 (المتغيّرات نفسها التي يضبطها خطوة test:isolation).
// الحارس يمنع هدفًا غير محلي بلا ISOLATION_DB_ALLOW_NONLOCAL=1، والتعديل هنا
// محصور في معاملة تُلغى، لكن الحارس يبقى: الفهرس مؤقتًا يُزال أثناء الاختبار.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import { dbTarget } from './db-target.mjs';

const REQUIRED = process.env.ISOLATION_DB_REQUIRED === '1';
const { options } = dbTarget();

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const IS_CI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const ALLOW_NONLOCAL = process.env.ISOLATION_DB_ALLOW_NONLOCAL === '1';

function assertWritableTarget() {
  if (ALLOW_NONLOCAL) return;
  const host = String(options.host ?? '')
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '');
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `هدف test:prices غير محلي (${options.host}): الاختبار يعدّل فهرسًا مؤقتًا داخل معاملة، ` +
        'فأوقفه الحارس قبل أي اتصال. للتشغيل على هذا الهدف عن قصد اضبط ISOLATION_DB_ALLOW_NONLOCAL=1.',
    );
  }
  if (IS_CI) {
    throw new Error(
      'test:prices داخل CI يتطلب تفعيلًا صريحًا: اضبط ISOLATION_DB_ALLOW_NONLOCAL=1 في خطوة التشغيل.',
    );
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(HERE, '..', 'supabase', 'migrations', '20261108000003_default_price_list_backfill.sql');
const IDX = 'uq_price_lists_one_default';

const T_P = '99999999-9999-4999-8999-999999999991';
const T_Q = '99999999-9999-4999-8999-9999999999b1'; // مخزن بلا أي قائمة
const W_P = '99999999-9999-4999-8999-999999999992';
const L_P = '99999999-9999-4999-8999-999999999993';
const UN_P = '99999999-9999-4999-8999-999999999994';
const CU_P = '99999999-9999-4999-8999-999999999995';
const M_SALE = '99999999-9999-4999-8999-999999999996'; // آخر سعر بيع
const M_COST = '99999999-9999-4999-8999-999999999997'; // التكلفة
const M_NONE = '99999999-9999-4999-8999-999999999998'; // بلا مصدر سعر
const M_AMBIG = '99999999-9999-4999-8999-999999999999'; // وحدتان بلا أساسية
const M_OFF = '99999999-9999-4999-8999-99999999999a'; // غير نشط
const UN_P2 = '99999999-9999-4999-8999-99999999999b';
const B_P = '99999999-9999-4999-8999-99999999999c';
const SB_P = '99999999-9999-4999-8999-99999999999d';
const INV_OLD = '99999999-9999-4999-8999-99999999999e';
const INV_NEW = '99999999-9999-4999-8999-99999999999f';
const PL_WHOLESALE = '99999999-9999-4999-8999-9999999999a1';
const PL_RETAIL = '99999999-9999-4999-8999-9999999999a2';

let skipReason = null;
let client = null;

const sql = (text, params) => client.query(text, params);

assertWritableTarget();

before(async () => {
  client = new pg.Client({ ...options, statement_timeout: 30000 });
  try {
    await client.connect();
  } catch (e) {
    client = null;
    if (REQUIRED) throw new Error(`ISOLATION_DB_REQUIRED=1 لكن الاتصال بالقاعدة فشل: ${e.message}`);
    skipReason = `لا قاعدة بيانات متاحة (${e.message})`;
  }
});

after(async () => {
  if (!client) return;
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
});

const needsDb = (name, fn) =>
  test(name, async (t) => {
    if (skipReason) return t.skip(skipReason);
    await fn(t);
  });

needsDb('هجرة التزويد: قائمة افتراضية واحدة وأسعار من آخر بيع ثم التكلفة، وقابلة لإعادة التشغيل', async (t) => {
  const migration = fs.readFileSync(MIGRATION, 'utf8');

  await sql('BEGIN');
  await sql(`DROP INDEX IF EXISTS public.${IDX}`);

  await sql(
    `INSERT INTO public.tenants (id, slug, name) VALUES ($1, 'price-backfill-test', 'مخزن اختبار التزويد')`,
    [T_P],
  );
  // مخزن جديد لم تُنشأ له قائمة بعد: التزويد يجب أن ينشئها له.
  await sql(
    `INSERT INTO public.tenants (id, slug, name) VALUES ($1, 'price-backfill-empty', 'مخزن بلا قائمة')`,
    [T_Q],
  );
  await sql(`INSERT INTO public.warehouses (tenant_id, id) VALUES ($1, $2)`, [T_P, W_P]);
  await sql(
    `INSERT INTO public.storage_locations (tenant_id, id, warehouse_id, code, name, is_default)
     VALUES ($1, $2, $3, 'MAIN', 'الافتراضي', true)`,
    [T_P, L_P, W_P],
  );
  await sql(`INSERT INTO public.units (tenant_id, id, code, name) VALUES ($1, $2, 'box', 'علبة')`, [T_P, UN_P]);
  await sql(`INSERT INTO public.units (tenant_id, id, code, name) VALUES ($1, $2, 'strip', 'شريط')`, [T_P, UN_P2]);
  await sql(
    `INSERT INTO public.customers (tenant_id, id, name, kind) VALUES ($1, $2, 'عميل اختبار', 'cash')`,
    [T_P, CU_P],
  );

  await sql(
    `INSERT INTO public.medicines (tenant_id, id, sku, trade_name_ar, is_active) VALUES
       ($1, $2, 'P-1', 'صنف له بيع', true),
       ($1, $3, 'P-2', 'صنف له تكلفة', true),
       ($1, $4, 'P-3', 'صنف بلا سعر', true),
       ($1, $5, 'P-4', 'صنف بوحدتين', true),
       ($1, $6, 'P-5', 'صنف موقوف', false)`,
    [T_P, M_SALE, M_COST, M_NONE, M_AMBIG, M_OFF],
  );

  // وحدة أساسية لكل صنف إلا M_AMBIG: وحدتان بلا is_base.
  await sql(
    `INSERT INTO public.medicine_units (tenant_id, medicine_id, unit_id, factor, is_base) VALUES
       ($1, $2, $3, 1, true),
       ($1, $4, $3, 1, true),
       ($1, $5, $3, 1, true),
       ($1, $6, $3, 1, false),
       ($1, $6, $7, 12, false),
       ($1, $8, $3, 1, true)`,
    [T_P, M_SALE, UN_P, M_COST, M_NONE, M_AMBIG, UN_P2, M_OFF],
  );

  await sql(
    `INSERT INTO public.batches (tenant_id, id, medicine_id, batch_no, expiry_date)
     VALUES ($1, $2, $3, 'PB-1', CURRENT_DATE + 200)`,
    [T_P, B_P, M_SALE],
  );
  await sql(
    `INSERT INTO public.batches (tenant_id, id, medicine_id, batch_no, expiry_date)
     VALUES ($1, $2, $3, 'PB-2', CURRENT_DATE + 200)`,
    [T_P, '99999999-9999-4999-8999-9999999999a3', M_COST],
  );
  await sql(
    `INSERT INTO public.batches (tenant_id, id, medicine_id, batch_no, expiry_date)
     VALUES ($1, $2, $3, 'PB-3', CURRENT_DATE + 200)`,
    [T_P, '99999999-9999-4999-8999-9999999999a4', M_OFF],
  );

  // التكلفة: 4.00 للصنف المبيع (وليست المرجع)، و6.50 للصنف الآخر.
  await sql(
    `INSERT INTO public.stock_batches
       (tenant_id, id, warehouse_id, location_id, medicine_id, batch_id, qty_on_hand, unit_cost)
     VALUES
       ($1, $2, $3, $4, $5, $6, 5, 4.0000),
       ($1, '99999999-9999-4999-8999-9999999999a5', $3, $4, $7,
        '99999999-9999-4999-8999-9999999999a3', 10, 6.5000),
       ($1, '99999999-9999-4999-8999-9999999999a6', $3, $4, $8,
        '99999999-9999-4999-8999-9999999999a4', 3, 9.0000)`,
    [T_P, SB_P, W_P, L_P, M_SALE, B_P, M_COST, M_OFF],
  );

  // بيعان مؤكدان: الأقدم 12.50 والأحدث 13.75 ⇒ المرجع 13.75 لا الأدنى ولا 4.00.
  await sql(
    `INSERT INTO public.sales_invoices
       (tenant_id, id, doc_number, customer_id, warehouse_id, status, subtotal, total, issued_at)
     VALUES
       ($1, $2, 'PS-OLD', $4, $5, 'confirmed', 12.50, 12.50, now() - interval '10 days'),
       ($1, $3, 'PS-NEW', $4, $5, 'confirmed', 13.75, 13.75, now() - interval '1 day')`,
    [T_P, INV_OLD, INV_NEW, CU_P, W_P],
  );
  await sql(
    `INSERT INTO public.sales_invoice_items
       (tenant_id, invoice_id, medicine_id, unit_id, qty, unit_price, line_total)
     VALUES ($1, $2, $3, $4, 1, 12.50, 12.50),
            ($1, $5, $3, $4, 1, 13.75, 13.75)`,
    [T_P, INV_OLD, M_SALE, UN_P, INV_NEW],
  );

  // قائمتان افتراضيتان قبل الإصلاح: retail (بلا بنود) وwholesale (ببند واحد).
  await sql(
    `INSERT INTO public.price_lists (tenant_id, id, code, name, is_default) VALUES
       ($1, $2, 'wholesale', 'قائمة الجملة', true),
       ($1, $3, 'retail', 'قائمة التجزئة', true)`,
    [T_P, PL_WHOLESALE, PL_RETAIL],
  );
  await sql(
    `INSERT INTO public.price_list_items (tenant_id, price_list_id, medicine_id, unit_id, price)
     VALUES ($1, $2, $3, $4, 3.00)`,
    [T_P, PL_WHOLESALE, M_COST, UN_P],
  );

  await sql(migration);

  await t.test('الافتراضية واحدة: retail بقيت، wholesale أُزيلت صفتها', async () => {
    const rows = await sql(
      `SELECT code, is_default FROM public.price_lists WHERE tenant_id = $1 ORDER BY code`,
      [T_P],
    );
    assert.deepEqual(
      rows.rows.map((r) => [r.code, r.is_default]),
      [
        ['retail', true],
        ['wholesale', false],
      ],
    );
  });

  await t.test('المخزن الذي لا قائمة له يُزوَّد بقائمة retail افتراضية', async () => {
    const rows = await sql(
      `SELECT code, name, is_default FROM public.price_lists WHERE tenant_id = $1`,
      [T_Q],
    );
    assert.deepEqual(
      rows.rows.map((r) => [r.code, r.is_default]),
      [['retail', true]],
    );
  });

  await t.test('الفهرس الفريد الجزئي موجود ويمنع افتراضية ثانية', async () => {
    const idx = await sql(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'price_lists' AND indexname = $1`,
      [IDX],
    );
    assert.equal(idx.rowCount, 1, 'الفهرس أُنشئ');
    assert.match(idx.rows[0].indexdef, /UNIQUE/);
    assert.match(idx.rows[0].indexdef, /WHERE is_default/);

    // نقطة حفظ: الخطأ المتوقع يُجهِض المعاملة، فنتراجع إليها ونكمل الاختبار.
    await sql('SAVEPOINT sp_dup_default');
    const err = await sql(
      `INSERT INTO public.price_lists (tenant_id, code, name, is_default)
       VALUES ($1, 'vip', 'قائمة ثالثة', true)`,
      [T_P],
    ).then(
      () => null,
      (e) => e,
    );
    await sql('ROLLBACK TO SAVEPOINT sp_dup_default');
    assert.ok(err, 'إدراج افتراضية ثانية يجب أن يفشل');
    assert.equal(err.code, '23505', 'خطأ تفرّد لا خطأ آخر');
  });

  await t.test('الأسعار: آخر بيع ثم التكلفة، وبلا تخمين عند الغموض', async () => {
    const rows = await sql(
      `SELECT m.sku, pli.price
         FROM public.price_lists pl
         JOIN public.price_list_items pli
           ON pli.tenant_id = pl.tenant_id AND pli.price_list_id = pl.id
         JOIN public.medicines m
           ON m.tenant_id = pli.tenant_id AND m.id = pli.medicine_id
        WHERE pl.tenant_id = $1 AND pl.is_default
        ORDER BY m.sku`,
      [T_P],
    );
    assert.deepEqual(
      rows.rows.map((r) => [r.sku, Number(r.price)]),
      [
        ['P-1', 13.75],
        ['P-2', 6.5],
      ],
      'P-1 من آخر بيع، P-2 من متوسط التكلفة، والباقي بلا سعر',
    );
  });

  await t.test('إعادة التشغيل لا تغيّر شيئًا ولا تكرّر الأسعار', async () => {
    await sql(migration);

    const defaults = await sql(
      `SELECT count(*)::int AS n FROM public.price_lists WHERE tenant_id = $1 AND is_default`,
      [T_P],
    );
    assert.equal(defaults.rows[0].n, 1, 'افتراضية واحدة بعد التشغيل الثاني');

    const items = await sql(
      `SELECT count(*)::int AS n, min(price) AS lo, max(price) AS hi
         FROM public.price_lists pl
         JOIN public.price_list_items pli
           ON pli.tenant_id = pl.tenant_id AND pli.price_list_id = pl.id
        WHERE pl.tenant_id = $1 AND pl.is_default`,
      [T_P],
    );
    assert.equal(items.rows[0].n, 2, 'لا صفوف مكرّرة ولا أسعار جديدة');
    assert.equal(Number(items.rows[0].lo), 6.5);
    assert.equal(Number(items.rows[0].hi), 13.75);
  });
});
