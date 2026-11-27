// اختبار عزل المخزنين وFEFO والصلاحيات والتزامن — على قاعدة حقيقية لا على نصّ الملفات.
//
// يشغّل السيناريوهات بدور التطبيق الفعلي `slamtak_app` (NOBYPASSRLS) داخل معاملة
// (ومنها استدعاء دالة التخصيص الحقيقية app.allocate_fefo، لا استعلام FEFO مكتوبًا
// في الاختبار) يُضبط فيها سياق الطلب بـset_config، ثم يتراجع عنها، فلا يترك أثرًا. والبذور
// (ثلاثة مخازن، مخزنان منفصلان، أصناف، تشغيلات) تُنشأ بدور المالك لأن سياسات RLS
// موجّهة إلى slamtak_app وحده.
//
// استثناءان مقصودان في قسم التزامن: اختبار تخصيص متواز واختبار مفتاح تكرار
// متوازٍ يفتح كل منهما جلستين ويُثبّت إحداهما بـCOMMIT، لأن القفل لا يُختبر إلا
// بمعاملة تُرى للطرف الآخر. لكل منهما مخزن معزول (T_C وT_D) كي لا يغيّرا أرصدة
// بقية الاختبارات، وحركاتهما تُزال في `after`.
//
// المتطلب: مخطط 20261108 مبني على القاعدة:
//   node scripts/apply-migrations.mjs supabase/migrations/20261108000001_init_schema.sql \
//                                      supabase/migrations/20261108000002_seed_and_harden.sql
// التشغيل: npm run test:isolation
//
// محليًا بلا قاعدة: تُتخطّى الاختبارات برسالة. وفي CI يُضبط ISOLATION_DB_REQUIRED=1
// فيصبح غياب القاعدة فشلًا صريحًا لا تخطيًا صامتًا.
//
// هدف الكتابة محروس: الملف يزرع صفوفًا ويُثبّت حركات (COMMIT)، فلا يعمل على قاعدة
// غير محلية ولا داخل CI إلا بتفعيل صريح عبر ISOLATION_DB_ALLOW_NONLOCAL=1.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import { dbTarget } from './db-target.mjs';

const REQUIRED = process.env.ISOLATION_DB_REQUIRED === '1';
const { options } = dbTarget();

// حارس هدف الاختبار: بلا هذا الحارس يكفي أن يُضبط PGHOST (أو SUPABASE_DB_PASSWORD
// وحده) بالخطأ ليجد الاختبار نفسه على قاعدة الإنتاج، فيزرع فيها مخازن تجريبية
// ويُثبّت خصوماتها. الفحص قبل أي اتصال، والفشل صريح لا تخطٍّ.
//   ISOLATION_DB_ALLOW_NONLOCAL=1 — تفعيل صريح لهدف غير محلي أو لتشغيل CI.
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
      `هدف test:isolation غير محلي (${options.host}): الاختبار يزرع صفوفًا ويُثبّت حركات، ` +
        'فأوقفه الحارس قبل أي اتصال. للتشغيل على هذا الهدف عن قصد اضبط ISOLATION_DB_ALLOW_NONLOCAL=1.',
    );
  }
  if (IS_CI) {
    throw new Error(
      'test:isolation داخل CI يكتب ويُثبّت حركات، فيتطلب تفعيلًا صريحًا: ' +
        'اضبط ISOLATION_DB_ALLOW_NONLOCAL=1 في خطوة تشغيل الاختبار.',
    );
  }
}

// معرّفات ثابتة: تسهّل الإشارة إلى الصفوف في التأكيدات، وتُحذف في النهاية.
const T_A = '11111111-1111-4111-8111-111111111111';
const T_B = '22222222-2222-4222-8222-222222222222';
// مخزن ثالث لاختبار التزامن وحده: يُثبّت حركاته (COMMIT) ليختبر القفل فعليًا،
// فيُعزل عن أرصدة أ/ب التي تفترضها بقية الاختبارات.
const T_C = '33333333-3333-4333-8333-333333333333';
const W_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const W_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const L_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const L_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const M_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const M_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
const B_A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'; // +60 يومًا، متاح
const B_A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'; // +300 يوم، متاح
const B_A3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7'; // منتهٍ
const B_A4 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8'; // الأقرب انتهاءً لكنه محجوب
const B_A5 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9'; // رصيد صفر
const B_A6 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11'; // الأقرب انتهاءً لكن التشغيلة محجورة
const B_B1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7';
const W_C = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const L_C = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const M_C = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
const B_C1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4'; // +90 يومًا، 5 وحدات
const B_C2 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc5'; // +200 يوم، 6 وحدات
const U_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10';
const U_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb12';
// أطراف البيع: الفاتورة تشترط عميلًا ووحدة. ومخزن رابع معزول (T_D) لاختبار
// التكرار المتزامن وحده، كي لا يغيّر أرصدة أ/ب/ج التي تفترضها بقية الاختبارات.
const UN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa20';
const CU_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa21';
const UN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb20';
const CU_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb21';
const T_D = '44444444-4444-4444-8444-444444444444';
const W_D = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const L_D = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
const M_D = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3';
const B_D1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4'; // +30 يومًا، 4 وحدات
const B_D2 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd5'; // +120 يومًا، 6 وحدات
const U_D = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd6';
const UN_D = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd7';
const CU_D = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd8';
// مخزن خامس معزول (T_E) بضنين على تشغيلة واحدة لكل منهما، لاختبار الفاتورة
// متعددة الأسطر وفشل السطر الثاني، كي لا تغيّر أرصدة أ/ب/ج/د التي تفترضها
// بقية الاختبارات.
const T_E = '55555555-5555-4555-8555-555555555555';
const W_E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const L_E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
const M_E1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'; // 4 وحدات
const M_E2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4'; // 3 وحدات
const B_E1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'; // +40 يومًا
const B_E2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6'; // +80 يومًا
const UN_E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee7';
const CU_E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee8';
const U_E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9';

let skipReason = null;
let owner = null;

const sql = (text, params) => owner.query(text, params);

// يفتح جلسة مستقلة بدور التطبيق وسياق مخزن، ويترك المعاملة مفتوحة لصاحبها.
// تُستخدم في اختبار التزامن حيث يجب أن تتزامن جلستان فعلًا لا أن تتتابعا.
async function openAppSession(ctx) {
  const client = new pg.Client({ ...options, statement_timeout: 20000 });
  await client.connect();
  await client.query('BEGIN');
  await client.query(
    `SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`,
    [ctx.tenantId ?? '', ctx.userId ?? ''],
  );
  await client.query('SET LOCAL ROLE slamtak_app');
  return client;
}

// ينتظر حتى تظهر جلسة تنتظر قفلًا في دالة تحمل اسمها في نص الاستعلام
// (لا مجرد تأخير زمني): allocate_fefo أو post_sale.
async function waitForRowLock(client, needle = 'allocate_fefo', timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND query ILIKE '%' || $1 || '%'`,
      [needle],
    );
    if (rows[0].n > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

// يمنع تعليق الاختبار إلى الأبد لو لم يُحرَّر القفل أبدًا.
function withTimeout(promise, ms) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`تجاوز مهلة ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

// ينفّذ العمل داخل معاملة بدور التطبيق وسياق مخزن محدد ثم يتراجع.
async function asApp(ctx, fn) {
  const client = new pg.Client(options);
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`, [
      ctx.tenantId ?? '',
      ctx.userId ?? '',
    ]);
    await client.query('SET LOCAL ROLE slamtak_app');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

// ينفّذ كتابة بدور المالك ثم يتراجع (لبوابة triggers التي لا يصلها دور التطبيق).
async function asOwner(fn) {
  await owner.query('BEGIN');
  try {
    return await fn(owner);
  } finally {
    await owner.query('ROLLBACK').catch(() => {});
  }
}

// يعيد خطأ الاستعلام بدل رميه، لفحص الرمز والرسالة.
async function failure(promise) {
  try {
    await promise;
    return null;
  } catch (e) {
    return e;
  }
}

// يتوقع فشلًا داخل معاملة مفتوحة: نقطة حفظ تمنع إحباط المعاملة كلها،
// فيمكن فحص خطأين متتاليين في نفس السياق.
async function expectFailure(client, text, params) {
  await client.query('SAVEPOINT sp_expect');
  try {
    await client.query(text, params);
    await client.query('RELEASE SAVEPOINT sp_expect');
    return null;
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT sp_expect');
    return e;
  }
}

// ترتيب الحذف يحترم المفاتيح الأجنبية (بلا ON DELETE CASCADE على المخزن).
// سجل الحركات append-only أمام الجميع (trigger يرفض DELETE)، واختبار التزامن
// وحده يُثبّت حركات؛ فنُعطّل الحارس لحظيًا بدور المالك ثم نُعيده في finally.
// هذا تنظيف الاختبار لا مسارًا في المنتج: لا شيء يعطّل الحارس على قاعدة حقيقية.
async function cleanupTenants(client) {
  const ids = [T_A, T_B, T_C, T_D, T_E];
  await client.query('ALTER TABLE public.stock_movements DISABLE TRIGGER trg_movements_append_only');
  try {
    await client.query('DELETE FROM public.stock_movements WHERE tenant_id = ANY($1)', [ids]);
  } finally {
    await client.query('ALTER TABLE public.stock_movements ENABLE TRIGGER trg_movements_append_only');
  }
  for (const statement of [
    `DELETE FROM public.sales_invoice_items WHERE tenant_id = ANY($1)`,
    `DELETE FROM public.sales_invoices WHERE tenant_id = ANY($1)`,
    `DELETE FROM public.customers WHERE tenant_id = ANY($1)`,
    `DELETE FROM public.user_permission_overrides WHERE tenant_id = ANY($1)`,
    `DELETE FROM public.user_roles WHERE tenant_id = ANY($1)`,
    `DELETE FROM public.role_permissions WHERE tenant_id = ANY($1)`,
    `DELETE FROM public.roles WHERE tenant_id = ANY($1)`,
    `DELETE FROM public.stock_batches WHERE tenant_id = ANY($1)`,
    `DELETE FROM public.batches WHERE tenant_id = ANY($1)`,
    `DELETE FROM public.medicines WHERE tenant_id = ANY($1)`,
    `DELETE FROM public.units WHERE tenant_id = ANY($1)`,
    `DELETE FROM public.storage_locations WHERE tenant_id = ANY($1)`,
    `DELETE FROM public.warehouses WHERE tenant_id = ANY($1)`,
    `DELETE FROM public.tenants WHERE id = ANY($1)`,
  ]) {
    await client.query(statement, [ids]);
  }
}

const needsDb = (name, fn) =>
  test(name, async (t) => {
    if (skipReason) return t.skip(skipReason);
    await fn(t);
  });

// الفحص عند تحميل الملف لا داخل before: يظهر الفشل مرة واحدة بدل تكراره على كل اختبار،
// ولا يبلغ الملف أي اتصال أو كتابة.
assertWritableTarget();

before(async () => {
  owner = new pg.Client(options);
  try {
    await owner.connect();
  } catch (e) {
    owner = null;
    if (REQUIRED) throw new Error(`ISOLATION_DB_REQUIRED=1 لكن الاتصال بالقاعدة فشل: ${e.message}`);
    skipReason = `لا قاعدة بيانات متاحة (${e.message})`;
    return;
  }

  const present = await owner.query(`SELECT to_regclass('public.warehouses') AS t`);
  if (!present.rows[0].t) {
    if (REQUIRED) throw new Error('المخطط غير مبني على القاعدة: شغّل هجرتَي 20261108 قبل الاختبار.');
    skipReason = 'المخطط غير مبني: شغّل scripts/apply-migrations.mjs على هجرتَي 20261108';
    return;
  }

  // تنظيف أي بقايا من تشغيل سابق فاشل (بالترتيب الذي تحتمله المفاتيح الأجنبية).
  await cleanupTenants(owner);
  await sql(`DELETE FROM public.users WHERE id = ANY($1)`, [[U_A, U_B, U_D]]);

  await sql(
    `INSERT INTO public.users (id, email, full_name, password_hash) VALUES
       ($1, 'isolation-a@test.local', 'مستخدم أ', 'x'),
       ($2, 'isolation-b@test.local', 'مستخدم ب', 'x')`,
    [U_A, U_B],
  );
  await sql(
    `INSERT INTO public.tenants (id, slug, name) VALUES
       ($1, 'iso-a', 'مخزن أ'), ($2, 'iso-b', 'مخزن ب')`,
    [T_A, T_B],
  );
  await sql(
    `INSERT INTO public.warehouses (tenant_id, id, name) VALUES
       ($1, $3, 'مخزن أ'), ($2, $4, 'مخزن ب')`,
    [T_A, T_B, W_A, W_B],
  );
  await sql(
    `INSERT INTO public.storage_locations (tenant_id, id, warehouse_id, code, name, is_default) VALUES
       ($1, $5, $3, 'DEFAULT', 'الافتراضي', true),
       ($2, $6, $4, 'DEFAULT', 'الافتراضي', true)`,
    [T_A, T_B, W_A, W_B, L_A, L_B],
  );
  await sql(
    `INSERT INTO public.medicines (tenant_id, id, sku, trade_name_ar) VALUES
       ($1, $3, 'ISO-A-1', 'دواء أ'), ($2, $4, 'ISO-B-1', 'دواء ب')`,
    [T_A, T_B, M_A, M_B],
  );

  // تشغيلات المخزن أ: قريبة وبعيدة ومنتهية ومحجوبة ومحجورة وصفرية، وتشغيلة للمخزن ب.
  await sql(
    `INSERT INTO public.batches (tenant_id, id, medicine_id, batch_no, expiry_date, status) VALUES
       ($1, $2, $7,  'A1', CURRENT_DATE + 60,  'active'),
       ($1, $3, $7,  'A2', CURRENT_DATE + 300, 'active'),
       ($1, $4, $7,  'A3', CURRENT_DATE - 30,  'active'),
       ($1, $5, $7,  'A4', CURRENT_DATE + 10,  'active'),
       ($1, $6, $7,  'A5', CURRENT_DATE + 20,  'active'),
       ($1, $11, $7, 'A6', CURRENT_DATE + 5,   'quarantine'),
       ($8, $9, $10, 'B1', CURRENT_DATE + 45,  'active')`,
    [T_A, B_A1, B_A2, B_A3, B_A4, B_A5, M_A, T_B, B_B1, M_B, B_A6],
  );
  // A2 فيها 4 محجوزة: المتاح للتخصيص 6 لا 10.
  await sql(
    `INSERT INTO public.stock_batches
       (tenant_id, warehouse_id, location_id, medicine_id, batch_id, qty_on_hand, qty_reserved, status) VALUES
       ($1, $2, $3, $4, $5, 5,  0, 'available'),
       ($1, $2, $3, $4, $6, 10, 4, 'available'),
       ($1, $2, $3, $4, $7, 7,  0, 'available'),
       ($1, $2, $3, $4, $8, 4,  0, 'blocked'),
       ($1, $2, $3, $4, $9, 0,  0, 'available'),
       ($1, $2, $3, $4, $10, 3, 0, 'available')`,
    [T_A, W_A, L_A, M_A, B_A1, B_A2, B_A3, B_A4, B_A5, B_A6],
  );
  await sql(
    `INSERT INTO public.stock_batches (tenant_id, warehouse_id, location_id, medicine_id, batch_id, qty_on_hand)
     VALUES ($1, $2, $3, $4, $5, 99)`,
    [T_B, W_B, L_B, M_B, B_B1],
  );

  // أطراف البيع: الفاتورة تشترط عميلًا ووحدة صالحة داخل المخزن نفسه.
  await sql(
    `INSERT INTO public.units (tenant_id, id, code, name) VALUES
       ($1, $3, 'box', 'علبة'), ($2, $4, 'box', 'علبة')`,
    [T_A, T_B, UN_A, UN_B],
  );
  await sql(
    `INSERT INTO public.customers (tenant_id, id, name, kind) VALUES
       ($1, $3, 'عميل أ', 'cash'), ($2, $4, 'عميل ب', 'cash')`,
    [T_A, T_B, CU_A, CU_B],
  );

  // مخزن ج: 11 وحدة متاحة على تشغيلتين، لاختبار التزامن (8 + 8 > 11).
  await sql(`INSERT INTO public.tenants (id, slug, name) VALUES ($1, 'iso-c', 'مخزن ج')`, [T_C]);
  await sql(`INSERT INTO public.warehouses (tenant_id, id, name) VALUES ($1, $2, 'مخزن ج')`, [T_C, W_C]);
  await sql(
    `INSERT INTO public.storage_locations (tenant_id, id, warehouse_id, code, name, is_default)
     VALUES ($1, $2, $3, 'DEFAULT', 'الافتراضي', true)`,
    [T_C, L_C, W_C],
  );
  await sql(
    `INSERT INTO public.medicines (tenant_id, id, sku, trade_name_ar) VALUES ($1, $2, 'ISO-C-1', 'دواء ج')`,
    [T_C, M_C],
  );
  await sql(
    `INSERT INTO public.batches (tenant_id, id, medicine_id, batch_no, expiry_date, status) VALUES
       ($1, $2, $4, 'C1', CURRENT_DATE + 90,  'active'),
       ($1, $3, $4, 'C2', CURRENT_DATE + 200, 'active')`,
    [T_C, B_C1, B_C2, M_C],
  );
  await sql(
    `INSERT INTO public.stock_batches
       (tenant_id, warehouse_id, location_id, medicine_id, batch_id, qty_on_hand, status) VALUES
       ($1, $2, $3, $4, $5, 5, 'available'),
       ($1, $2, $3, $4, $6, 6, 'available')`,
    [T_C, W_C, L_C, M_C, B_C1, B_C2],
  );

  // مخزن د: 10 وحدات على تشغيلتين، لاختبار مفتاح التكرار بين جلستين متزامنتين.
  await sql(`INSERT INTO public.tenants (id, slug, name) VALUES ($1, 'iso-d', 'مخزن د')`, [T_D]);
  await sql(`INSERT INTO public.warehouses (tenant_id, id, name) VALUES ($1, $2, 'مخزن د')`, [T_D, W_D]);
  await sql(
    `INSERT INTO public.storage_locations (tenant_id, id, warehouse_id, code, name, is_default)
     VALUES ($1, $2, $3, 'DEFAULT', 'الافتراضي', true)`,
    [T_D, L_D, W_D],
  );
  await sql(
    `INSERT INTO public.medicines (tenant_id, id, sku, trade_name_ar) VALUES ($1, $2, 'ISO-D-1', 'دواء د')`,
    [T_D, M_D],
  );
  await sql(
    `INSERT INTO public.batches (tenant_id, id, medicine_id, batch_no, expiry_date, status) VALUES
       ($1, $2, $4, 'D1', CURRENT_DATE + 30,  'active'),
       ($1, $3, $4, 'D2', CURRENT_DATE + 120, 'active')`,
    [T_D, B_D1, B_D2, M_D],
  );
  await sql(
    `INSERT INTO public.stock_batches
       (tenant_id, warehouse_id, location_id, medicine_id, batch_id, qty_on_hand) VALUES
       ($1, $2, $3, $4, $5, 4),
       ($1, $2, $3, $4, $6, 6)`,
    [T_D, W_D, L_D, M_D, B_D1, B_D2],
  );
  await sql(
    `INSERT INTO public.units (tenant_id, id, code, name) VALUES ($1, $2, 'box', 'علبة')`,
    [T_D, UN_D],
  );
  await sql(
    `INSERT INTO public.customers (tenant_id, id, name, kind) VALUES ($1, $2, 'عميل د', 'cash')`,
    [T_D, CU_D],
  );
  await sql(
    `INSERT INTO public.users (id, email, full_name, password_hash)
     VALUES ($1, 'isolation-d@test.local', 'مستخدم د', 'x')`,
    [U_D],
  );

  // أدوار المخزنين: المالك في أ بلا أدوار في ب (لاختبار رفض الصلاحية).
  await sql(`SELECT app.seed_tenant_roles($1)`, [T_A]);
  await sql(`SELECT app.seed_tenant_roles($1)`, [T_B]);
  await sql(
    `INSERT INTO public.user_roles (tenant_id, user_id, role_id)
     SELECT $1, $2, id FROM public.roles WHERE tenant_id = $1 AND code = 'owner'`,
    [T_A, U_A],
  );
  await sql(`SELECT app.seed_tenant_roles($1)`, [T_D]);
  await sql(
    `INSERT INTO public.user_roles (tenant_id, user_id, role_id)
     SELECT $1, $2, id FROM public.roles WHERE tenant_id = $1 AND code = 'owner'`,
    [T_D, U_D],
  );

  // مخزن هـ: صنفان مستقلان، لاختبار فاتورة بسطرين وفشل السطر الثاني.
  await sql(`INSERT INTO public.tenants (id, slug, name) VALUES ($1, 'iso-e', 'مخزن هـ')`, [T_E]);
  await sql(`INSERT INTO public.warehouses (tenant_id, id, name) VALUES ($1, $2, 'مخزن هـ')`, [T_E, W_E]);
  await sql(
    `INSERT INTO public.storage_locations (tenant_id, id, warehouse_id, code, name, is_default)
     VALUES ($1, $2, $3, 'DEFAULT', 'الافتراضي', true)`,
    [T_E, L_E, W_E],
  );
  await sql(
    `INSERT INTO public.medicines (tenant_id, id, sku, trade_name_ar) VALUES
       ($1, $2, 'ISO-E-1', 'دواء هـ ١'),
       ($1, $3, 'ISO-E-2', 'دواء هـ ٢')`,
    [T_E, M_E1, M_E2],
  );
  await sql(
    `INSERT INTO public.batches (tenant_id, id, medicine_id, batch_no, expiry_date, status) VALUES
       ($1, $2, $4, 'E1', CURRENT_DATE + 40, 'active'),
       ($1, $3, $5, 'E2', CURRENT_DATE + 80, 'active')`,
    [T_E, B_E1, B_E2, M_E1, M_E2],
  );
  await sql(
    `INSERT INTO public.stock_batches
       (tenant_id, warehouse_id, location_id, medicine_id, batch_id, qty_on_hand) VALUES
       ($1, $2, $3, $4, $5, 4),
       ($1, $2, $3, $6, $7, 3)`,
    [T_E, W_E, L_E, M_E1, B_E1, M_E2, B_E2],
  );
  await sql(
    `INSERT INTO public.units (tenant_id, id, code, name) VALUES ($1, $2, 'box', 'علبة')`,
    [T_E, UN_E],
  );
  await sql(
    `INSERT INTO public.customers (tenant_id, id, name, kind) VALUES ($1, $2, 'عميل هـ', 'cash')`,
    [T_E, CU_E],
  );
  await sql(
    `INSERT INTO public.users (id, email, full_name, password_hash)
     VALUES ($1, 'isolation-e@test.local', 'مستخدم هـ', 'x')`,
    [U_E],
  );
  await sql(`SELECT app.seed_tenant_roles($1)`, [T_E]);
  await sql(
    `INSERT INTO public.user_roles (tenant_id, user_id, role_id)
     SELECT $1, $2, id FROM public.roles WHERE tenant_id = $1 AND code = 'owner'`,
    [T_E, U_E],
  );
});

after(async () => {
  if (!owner) return;
  try {
    await cleanupTenants(owner);
    await sql(`DELETE FROM public.users WHERE id = ANY($1)`, [[U_A, U_B, U_D, U_E]]);
  } finally {
    await owner.end();
  }
});

// ---------------------------------------------------------------- العزل

needsDb('العزل: مخزن أ لا يرى صفًا واحدًا من صفوف مخزن ب', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    const rows = await c.query('SELECT tenant_id, batch_id FROM public.stock_batches');
    assert.ok(rows.rowCount > 0, 'يرى صفوفه هو');
    for (const row of rows.rows) assert.equal(row.tenant_id, T_A, 'كل صف مرئي من مخزنه');
    assert.equal(
      rows.rows.some((r) => r.batch_id === B_B1),
      false,
      'تشغيلة المخزن ب غير مرئية',
    );

    const b = await c.query('SELECT count(*)::int AS n FROM public.batches WHERE id = $1', [B_B1]);
    assert.equal(b.rows[0].n, 0, 'التشغيلة الأخرى غير موجودة في نطاق RLS');

    const w = await c.query('SELECT id FROM public.warehouses');
    assert.deepEqual(
      w.rows.map((r) => r.id),
      [W_A],
      'مخزن واحد فقط مرئي',
    );
  });
});

needsDb('العزل: بلا سياق مخزن لا يُقرأ شيء (Fail closed)', async () => {
  await asApp({}, async (c) => {
    for (const table of ['warehouses', 'batches', 'stock_batches', 'medicines']) {
      const r = await c.query(`SELECT count(*)::int AS n FROM public.${table}`);
      assert.equal(r.rows[0].n, 0, `${table} يجب أن تكون فارغة بلا سياق`);
    }
  });
});

needsDb('العزل: لا قراءة ولا كتابة في نطاق مخزن آخر عبر معرّف صريح', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    const read = await c.query('SELECT count(*)::int AS n FROM public.stock_batches WHERE tenant_id = $1', [T_B]);
    assert.equal(read.rows[0].n, 0, 'التصفية بمعرّف الطرف الآخر لا تتجاوز RLS');

    const insertStock = await expectFailure(
      c,
      `INSERT INTO public.stock_batches (tenant_id, warehouse_id, location_id, medicine_id, batch_id, qty_on_hand)
       VALUES ($1, $2, $3, $4, $5, 1)`,
      [T_B, W_B, L_B, M_B, B_B1],
    );
    assert.ok(insertStock, 'الكتابة في مخزن آخر مرفوضة');
    assert.equal(insertStock.code, '42501');
    assert.match(insertStock.message, /row-level security/i);

    const insertBatch = await expectFailure(
      c,
      `INSERT INTO public.batches (tenant_id, medicine_id, batch_no, expiry_date)
       VALUES ($1, $2, 'X1', CURRENT_DATE + 5)`,
      [T_B, M_B],
    );
    assert.ok(insertBatch, 'إدخال تشغيلة في مخزن آخر مرفوض');
    assert.equal(insertBatch.code, '42501');
  });
});

needsDb('العزل: تحديث صف مخزن آخر لا يعدّل شيئًا', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    const res = await c.query('UPDATE public.warehouses SET name = $1 WHERE id = $2', ['اختراق', W_B]);
    assert.equal(res.rowCount, 0, 'الصف غير مرئي فالتحديث لا يطاله');

    // القراءة بدور المالك: دور التطبيق لا يرى الصف أصلًا.
    const real = await owner.query('SELECT name FROM public.warehouses WHERE id = $1', [W_B]);
    assert.equal(real.rows[0].name, 'مخزن ب');
  });
});

needsDb('قيد ADR-025: لا مخزن ثانٍ للحساب نفسه', async () => {
  const err = await failure(
    sql(`INSERT INTO public.warehouses (tenant_id, code, name) VALUES ($1, 'MAIN', 'ثانٍ')`, [T_A]),
  );
  assert.ok(err, 'القيد يمنع المخزن الآخر');
  assert.equal(err.code, '23505', 'انتهاك قيد التفرّد');
  assert.match(err.constraint || '', /uq_one_warehouse_per_tenant/);
});

// ---------------------------------------------------------------- الرصيد والحركات

needsDb('الرصيد: التعديل المباشر على stock_batches ممنوع، والتغيير عبر حركة موثقة فقط', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    const direct = await expectFailure(c, 'UPDATE public.stock_batches SET qty_on_hand = 999 WHERE batch_id = $1', [B_A1]);
    assert.ok(direct, 'التعديل المباشر مرفوض');
    assert.equal(direct.code, '42501');
    assert.match(direct.message, /permission denied/i);

    await c.query(
      `INSERT INTO public.stock_movements
         (tenant_id, warehouse_id, location_id, medicine_id, batch_id, movement_type, qty_delta, created_by)
       VALUES ($1, $2, $3, $4, $5, 'receipt', 10, $6)`,
      [T_A, W_A, L_A, M_A, B_A1, U_A],
    );
    const after = await c.query('SELECT qty_on_hand FROM public.stock_batches WHERE batch_id = $1', [B_A1]);
    assert.equal(Number(after.rows[0].qty_on_hand), 15, 'الحركة الموثقة أضافت 10 إلى 5');
  });
});

needsDb('الرصيد: صرف أكبر من المتاح مرفوض بقيد القاعدة', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    const err = await failure(
      c.query(
        `INSERT INTO public.stock_movements
           (tenant_id, warehouse_id, location_id, medicine_id, batch_id, movement_type, qty_delta, created_by)
         VALUES ($1, $2, $3, $4, $5, 'sale', -999, $6)`,
        [T_A, W_A, L_A, M_A, B_A1, U_A],
      ),
    );
    assert.ok(err, 'الرصيد السالب مرفوض');
    assert.equal(err.code, '23514', 'انتهاك CHECK على qty_on_hand');
  });
});

needsDb('الرصيد: دفتر الحركات append-only، والمخزن لا ينتقل بين حسابين', async () => {
  await asOwner(async (c) => {
    // حركة واحدة على الأقل: DELETE على صفر صفوف لا يوقظ الـtrigger.
    await c.query(
      `INSERT INTO public.stock_movements
         (tenant_id, warehouse_id, location_id, medicine_id, batch_id, movement_type, qty_delta, created_by)
       VALUES ($1, $2, $3, $4, $5, 'receipt', 1, $6)`,
      [T_A, W_A, L_A, M_A, B_A1, U_A],
    );

    const del = await expectFailure(c, 'DELETE FROM public.stock_movements WHERE tenant_id = $1', [T_A]);
    assert.ok(del, 'الحذف مرفوض');
    assert.match(del.message, /APPEND_ONLY/);

    const upd = await expectFailure(c, `UPDATE public.stock_movements SET reason = 'x' WHERE tenant_id = $1`, [T_A]);
    assert.ok(upd, 'تعديل الحركة مرفوض');
    assert.match(upd.message, /APPEND_ONLY/);

    const move = await expectFailure(c, 'UPDATE public.warehouses SET tenant_id = $1 WHERE id = $2', [T_B, W_A]);
    assert.ok(move, 'نقل سجل بين مخزنين مرفوض');
    assert.match(move.message, /TENANT_IMMUTABLE/);
  });
});

// ---------------------------------------------------------------- منع الصرف

needsDb('الصرف: حركة sale على تشغيلة منتهية أو محجوبة أو رصيد محجوب مرفوضة في القاعدة', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    const sell = (batchId) =>
      expectFailure(
        c,
        `INSERT INTO public.stock_movements
           (tenant_id, warehouse_id, location_id, medicine_id, batch_id, movement_type, qty_delta, created_by)
         VALUES ($1, $2, $3, $4, $5, 'sale', -1, $6)`,
        [T_A, W_A, L_A, M_A, batchId, U_A],
      );

    // A3 منتهية (−30) وA4 رصيدها محجوب (+10) وA6 تشغيلتها بحالة quarantine (+5).
    const expired = await sell(B_A3);
    assert.ok(expired, 'الصرف من تشغيلة منتهية مرفوض');
    assert.equal(expired.code, '23514');
    assert.match(expired.message, /DISPENSE_EXPIRED_BATCH/);

    const blockedStock = await sell(B_A4);
    assert.ok(blockedStock, 'الصرف من رصيد محجوب مرفوض');
    assert.equal(blockedStock.code, '23514');
    assert.match(blockedStock.message, /DISPENSE_BLOCKED_STOCK/);

    const blockedBatch = await sell(B_A6);
    assert.ok(blockedBatch, 'الصرف من تشغيلة محجورة مرفوض');
    assert.equal(blockedBatch.code, '23514');
    assert.match(blockedBatch.message, /DISPENSE_BLOCKED_BATCH/);

    // والرفض لم يترك أثرًا: الأرصدة الثلاثة كما كانت.
    const after = await c.query(
      'SELECT batch_id, qty_on_hand FROM public.stock_batches WHERE batch_id = ANY($1)',
      [[B_A3, B_A4, B_A6]],
    );
    const byBatch = Object.fromEntries(after.rows.map((r) => [r.batch_id, Number(r.qty_on_hand)]));
    assert.deepEqual(byBatch, { [B_A3]: 7, [B_A4]: 4, [B_A6]: 3 }, 'لا خصم من حركة مرفوضة');
  });
});

needsDb('الصرف: الحارس لا يغلق إتلاف المنتهي ولا الصرف من تشغيلة صالحة', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    // إتلاف دواء منتهٍ: مسار مشروع يجب أن يبقى مفتوحًا وإلا تعذّر شطب المنتهي.
    await c.query(
      `INSERT INTO public.stock_movements
         (tenant_id, warehouse_id, location_id, medicine_id, batch_id, movement_type, qty_delta, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, 'damage', -2, 'إتلاف تشغيلة منتهية', $6)`,
      [T_A, W_A, L_A, M_A, B_A3, U_A],
    );
    const expired = await c.query('SELECT qty_on_hand FROM public.stock_batches WHERE batch_id = $1', [B_A3]);
    assert.equal(Number(expired.rows[0].qty_on_hand), 5, 'الإتلاف خصم 2 من 7');

    // والصرف من تشغيلة صالحة ما زال يعمل.
    await c.query(
      `INSERT INTO public.stock_movements
         (tenant_id, warehouse_id, location_id, medicine_id, batch_id, movement_type, qty_delta, created_by)
       VALUES ($1, $2, $3, $4, $5, 'sale', -1, $6)`,
      [T_A, W_A, L_A, M_A, B_A1, U_A],
    );
    const ok = await c.query('SELECT qty_on_hand FROM public.stock_batches WHERE batch_id = $1', [B_A1]);
    assert.equal(Number(ok.rows[0].qty_on_hand), 4, 'الصرف من A1 الصالح خصم 1');
  });
});

// ---------------------------------------------------------------- الصلاحيات

needsDb('الصلاحيات: المالك يملك صلاحيات مخزنه ولا يملك صلاحية منصة', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    const own = await c.query(`SELECT app.has_permission('inventory.read') AS ok`);
    assert.equal(own.rows[0].ok, true, 'المالك يقرأ المخزون');

    const platform = await c.query(`SELECT app.has_permission('platform.tenant.manage') AS ok`);
    assert.equal(platform.rows[0].ok, false, 'صلاحية المنصة ليست لدور مخزن');

    const b = await c.query(`SELECT app.has_permission('finance.journal.post') AS ok`);
    assert.equal(b.rows[0].ok, true, 'المالك يملك ما يمنعه المدير فقط');
  });
});

needsDb('الصلاحيات: مستخدم بلا دور لا يملك شيئًا، وdeny يتغلب على الدور', async () => {
  await asApp({ tenantId: T_B, userId: U_B }, async (c) => {
    const none = await c.query(`SELECT app.has_permission('inventory.read') AS ok`);
    assert.equal(none.rows[0].ok, false, 'بلا دور = بلا صلاحية');
  });

  await sql(
    `INSERT INTO public.user_permission_overrides (tenant_id, user_id, permission, effect)
     VALUES ($1, $2, 'inventory.read', 'deny')`,
    [T_A, U_A],
  );
  try {
    await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
      const denied = await c.query(`SELECT app.has_permission('inventory.read') AS ok`);
      assert.equal(denied.rows[0].ok, false, 'deny يتغلب على منح الدور');
      const other = await c.query(`SELECT app.has_permission('sales.read') AS ok`);
      assert.equal(other.rows[0].ok, true, 'بقية الصلاحيات لم تتأثر');
    });
  } finally {
    await sql(
      `DELETE FROM public.user_permission_overrides
       WHERE tenant_id = $1 AND user_id = $2 AND permission = 'inventory.read'`,
      [T_A, U_A],
    );
  }
});

needsDb('الصلاحيات: كتابة سجل التدقيق تحتاج صلاحية صريحة لا مجرد الانتماء للمخزن', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    await c.query(
      `INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type)
       VALUES ($1, $2, 'test.write', 'test')`,
      [T_A, U_A],
    );
    const r = await c.query('SELECT count(*)::int AS n FROM public.audit_logs');
    assert.equal(r.rows[0].n, 1, 'المالك (يملك system.audit.write) يكتب');
  });

  await asApp({ tenantId: T_B, userId: U_B }, async (c) => {
    const denied = await failure(
      c.query(
        `INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type)
         VALUES ($1, $2, 'test.write', 'test')`,
        [T_B, U_B],
      ),
    );
    assert.ok(denied, 'بلا صلاحية التدقيق الكتابة مرفوضة');
    assert.equal(denied.code, '42501');
  });
});

// ---------------------------------------------------------------- FEFO

needsDb('FEFO: الأقرب انتهاءً أولًا، مع استبعاد المنتهي والمحجوب وصفر الرصيد', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    const { rows } = await c.query(`
      SELECT b.id, b.batch_no, b.expiry_date
      FROM public.stock_batches sb
      JOIN public.batches b ON b.tenant_id = sb.tenant_id AND b.id = sb.batch_id
      WHERE sb.status = 'available'
        AND sb.qty_on_hand - sb.qty_reserved > 0
        AND b.status = 'active'
        AND b.expiry_date > CURRENT_DATE
      ORDER BY b.expiry_date, b.created_at
    `);
    assert.deepEqual(
      rows.map((r) => r.batch_no),
      ['A1', 'A2'],
      'المنتهي والمحجوب وصفر الرصيد خارج التخصيص',
    );
    assert.equal(rows[0].id, B_A1, 'أول ما يُصرف هو الأقرب انتهاءً');
    assert.equal(
      rows.some((r) => r.id === B_B1),
      false,
      'FEFO لا يعبر إلى مخزن آخر',
    );
  });
});

// ------------------------------------------- دالة التخصيص الفعلية allocate_fefo

needsDb('FEFO: الدالة تخصّص من الأقرب انتهاءً وتقسّم على تشغيلتين', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    const { rows } = await c.query('SELECT * FROM app.allocate_fefo($1, $2, $3, $4)', [T_A, W_A, M_A, 8]);
    assert.deepEqual(rows.map((r) => r.batch_no), ['A1', 'A2'], 'الترتيب: الأقرب انتهاءً أولًا');
    assert.deepEqual(rows.map((r) => Number(r.qty)), [5, 3], 'استُنفد A1 ثم أُخذ الباقي من A2');
    assert.equal(
      rows.reduce((sum, r) => sum + Number(r.qty), 0),
      8,
      'مجموع التخصيص = الكمية المطلوبة بلا زيادة ولا نقص',
    );
    assert.equal(rows[0].batch_id, B_A1, 'batch_id الفعلي وليس رقم التشغيلة النصي');
    assert.equal(rows[0].location_id, L_A, 'الموقع يُعاد ليبني عليه الـcaller الحركة');
    assert.ok(rows[0].expiry_date < rows[1].expiry_date, 'تواريخ الانتهاء تصاعدية');
  });
});

needsDb('FEFO: الدالة تحترم qty_reserved ولا تخصص المحجوز', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    const { rows } = await c.query('SELECT * FROM app.allocate_fefo($1, $2, $3, $4)', [T_A, W_A, M_A, 6]);
    assert.deepEqual(rows.map((r) => Number(r.qty)), [5, 1], 'من A2 يُخصص المتاح بعد الحجز فقط');
  });
});

needsDb('FEFO: لا يُصرف منتهٍ ولا محجوب ولا محجور ولا صفر رصيد', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    // 11 = كل المتاح فعلًا (5 في A1 + 6 حرة في A2)، والأقرب انتهاءً A6 ثم A4.
    const { rows } = await c.query('SELECT * FROM app.allocate_fefo($1, $2, $3, $4)', [T_A, W_A, M_A, 11]);
    const used = rows.map((r) => r.batch_id);
    assert.deepEqual(used, [B_A1, B_A2], 'التخصيص الكامل يقع على الصالح فقط');
    for (const [id, label] of [
      [B_A3, 'منتهٍ'],
      [B_A4, 'محجوب'],
      [B_A5, 'صفر رصيد'],
      [B_A6, 'تشغيلة بحالة quarantine'],
    ]) {
      assert.equal(used.includes(id), false, `${label} خارج التخصيص حتى لو كان أقرب انتهاءً`);
    }
  });
});

needsDb('FEFO: المتاح أقل من المطلوب يفشل برسالة صريحة ولا يخصص جزئيًا', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    const err = await failure(c.query('SELECT * FROM app.allocate_fefo($1, $2, $3, $4)', [T_A, W_A, M_A, 12]));
    assert.ok(err, 'الطلب فوق المتاح مرفوض');
    assert.equal(err.code, 'P0001');
    assert.match(err.message, /FEFO_INSUFFICIENT_STOCK/);
    assert.match(err.message, /11/, 'الرسالة تحمل المتاح الفعلي لا صفرًا');
  });
});

needsDb('FEFO: كمية غير صالحة أو سياق مخزن آخر مرفوضان', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    const zero = await expectFailure(c, 'SELECT * FROM app.allocate_fefo($1, $2, $3, 0)', [T_A, W_A, M_A]);
    assert.ok(zero, 'الكمية الصفرية مرفوضة');
    assert.equal(zero.code, '22023');
    assert.match(zero.message, /FEFO_INVALID_QTY/);

    const negative = await expectFailure(c, 'SELECT * FROM app.allocate_fefo($1, $2, $3, -5)', [T_A, W_A, M_A]);
    assert.ok(negative, 'الكمية السالبة مرفوضة');
    assert.equal(negative.code, '22023');

    // سياق مخزن أ يطلب التخصيص من مخزن ب: RLS لا تحمي SECURITY DEFINER، فالدالة تمنعه بنفسها.
    const cross = await expectFailure(c, 'SELECT * FROM app.allocate_fefo($1, $2, $3, 1)', [T_B, W_B, M_B]);
    assert.ok(cross, 'التخصيص لحساب آخر من داخل سياق حساب مرفوض');
    assert.equal(cross.code, '42501');
    assert.match(cross.message, /TENANT_CONTEXT_MISMATCH/);
  });
});

needsDb('FEFO: الدالة لا تعبر إلى مخزن آخر ولو بمعرّف الصنف الصحيح', async () => {
  // مخزن ب يملك 99 من صنفه، وصفر من صنف مخزن أ.
  await asApp({ tenantId: T_B, userId: U_B }, async (c) => {
    const own = await c.query('SELECT * FROM app.allocate_fefo($1, $2, $3, $4)', [T_B, W_B, M_B, 99]);
    assert.deepEqual(own.rows.map((r) => r.batch_no), ['B1']);
    assert.equal(Number(own.rows[0].qty), 99);

    const foreign = await expectFailure(
      c,
      'SELECT * FROM app.allocate_fefo($1, $2, $3, 1)',
      [T_B, W_B, M_A],
    );
    assert.ok(foreign, 'صنف مخزن آخر غير موجود في نطاقه');
    assert.match(foreign.message, /FEFO_INSUFFICIENT_STOCK:.*المتاح 0/);
  });
});

needsDb('FEFO: نتيجة التخصيص تُسجَّل كحركات فتنخفض الأرصدة بالمقدار نفسه', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    const { rows } = await c.query('SELECT * FROM app.allocate_fefo($1, $2, $3, $4)', [T_A, W_A, M_A, 8]);
    for (const r of rows) {
      await c.query(
        `INSERT INTO public.stock_movements
           (tenant_id, warehouse_id, location_id, medicine_id, batch_id, movement_type, qty_delta, created_by)
         VALUES ($1, $2, $3, $4, $5, 'sale', $6, $7)`,
        [T_A, W_A, r.location_id, M_A, r.batch_id, -Number(r.qty), U_A],
      );
    }
    const after = await c.query(
      'SELECT batch_id, qty_on_hand FROM public.stock_batches WHERE batch_id = ANY($1)',
      [[B_A1, B_A2]],
    );
    const byBatch = Object.fromEntries(after.rows.map((r) => [r.batch_id, Number(r.qty_on_hand)]));
    assert.equal(byBatch[B_A1], 0, 'A1 استُنفد بالكامل (5 − 5)');
    assert.equal(byBatch[B_A2], 7, 'A2 نقص بمقدار المخصص فقط (10 − 3)');
  });
});

needsDb('FEFO: تنفيذ الدالة مقصور على دور التطبيق لا PUBLIC ولا المنصة ولا التشغيل', async () => {
  const { rows } = await owner.query(
    `SELECT has_function_privilege('slamtak_app', $1, 'EXECUTE')      AS app_ok,
            has_function_privilege('slamtak_platform', $1, 'EXECUTE') AS platform_ok,
            has_function_privilege('slamtak_ops', $1, 'EXECUTE')      AS ops_ok`,
    ['app.allocate_fefo(uuid, uuid, uuid, numeric)'],
  );
  assert.equal(rows[0].app_ok, true, 'دور التطبيق ينفّذ التخصيص');
  assert.equal(rows[0].platform_ok, false, 'لوحة المنصة لا تخصم مخزونًا');
  assert.equal(rows[0].ops_ok, false, 'دور التشغيل للتحقق فقط');

  const pub = await owner.query(
    `SELECT count(*)::int AS n
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, '{}'::aclitem[])) a
      WHERE n.nspname = 'app' AND p.proname = 'allocate_fefo'
        AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'`,
  );
  assert.equal(pub.rows[0].n, 0, 'لا EXECUTE لـPUBLIC على الدالة');
});

needsDb('FEFO: الفهرس الذي يخدم الاستعلام موجود بالتعريف المتوقع', async () => {
  const { rows } = await owner.query(
    `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_stock_fefo'`,
  );
  assert.equal(rows.length, 1, 'فهرس idx_stock_fefo مفقود');
  assert.match(rows[0].indexdef, /WHERE .*qty_on_hand/);
  assert.match(rows[0].indexdef, /qty_on_hand > \(0\)/);
  assert.match(rows[0].indexdef, /status = 'available'/);
});

// ---------------------------------------------------------------- البيع (post_sale)

// توقيع السطر الواحد (غلاف فوق الدالة متعددة الأسطر).
const postSale = (client, args) =>
  client.query('SELECT app.post_sale($1, $2, $3, $4, $5, $6, $7) AS sale', args);

// نداء الفاتورة: [العميل، المخزن، مصفوفة البنود، مفتاح التكرار].
const postSaleItems = (client, args) =>
  client.query('SELECT app.post_sale($1, $2, $3, $4) AS sale', args);

needsDb('البيع: post_sale ينشئ فاتورة مؤكدة ويخصم الأقرب انتهاءً عبر حركات sale', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    const sale = (await postSale(c, [CU_A, W_A, M_A, UN_A, 6, 12.5, 'sale-key-fefo'])).rows[0].sale;

    assert.equal(sale.replayed, false, 'أول نداء ليس إعادة');
    assert.deepEqual(
      sale.allocations.map((a) => a.batch_no),
      ['A1', 'A2'],
      'التخصيص من الأقرب انتهاءً لا من الأكبر رصيدًا',
    );
    assert.deepEqual(sale.allocations.map((a) => Number(a.qty)), [5, 1]);
    assert.equal(Number(sale.total), 75, '6 × 12.50');

    const inv = await c.query(
      'SELECT status, total, idempotency_key, warehouse_id FROM public.sales_invoices WHERE id = $1',
      [sale.invoice_id],
    );
    assert.equal(inv.rowCount, 1);
    assert.equal(inv.rows[0].status, 'confirmed');
    assert.equal(Number(inv.rows[0].total), 75);
    assert.equal(inv.rows[0].idempotency_key, 'sale-key-fefo');

    const item = await c.query(
      'SELECT medicine_id, qty, unit_price, line_total FROM public.sales_invoice_items WHERE invoice_id = $1',
      [sale.invoice_id],
    );
    assert.equal(item.rowCount, 1);
    assert.equal(item.rows[0].medicine_id, M_A);
    assert.equal(Number(item.rows[0].qty), 6);
    assert.equal(Number(item.rows[0].line_total), 75);

    const moves = await c.query(
      `SELECT batch_id, qty_delta, ref_type, ref_id
         FROM public.stock_movements
        WHERE tenant_id = $1 AND ref_type = 'sales_invoice' AND ref_id = $2`,
      [T_A, sale.invoice_id],
    );
    assert.equal(moves.rowCount, 2, 'حركة sale لكل تشغيلة مخصّصة');
    assert.equal(moves.rows.reduce((s, m) => s + Number(m.qty_delta), 0), -6);
    for (const m of moves.rows) {
      assert.equal(m.ref_type, 'sales_invoice');
      assert.equal(m.ref_id, sale.invoice_id);
    }

    const bal = await c.query(
      'SELECT batch_id, qty_on_hand FROM public.stock_batches WHERE batch_id = ANY($1)',
      [[B_A1, B_A2]],
    );
    const byBatch = Object.fromEntries(bal.rows.map((r) => [r.batch_id, Number(r.qty_on_hand)]));
    assert.deepEqual(byBatch, { [B_A1]: 0, [B_A2]: 9 }, 'الخصم مر عبر الحركات فقط');
  });
});

needsDb('البيع: نفس مفتاح التكرار يعيد الفاتورة نفسها بلا صرف ثانٍ', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    const args = [CU_A, W_A, M_A, UN_A, 2, 10, 'sale-key-replay'];
    const first = (await postSale(c, args)).rows[0].sale;

    const ledger = () =>
      c.query(
        `SELECT count(*)::int AS n, coalesce(sum(qty_delta), 0)::numeric AS total
           FROM public.stock_movements
          WHERE tenant_id = $1 AND ref_id = $2`,
        [T_A, first.invoice_id],
      );
    const balances = () =>
      c.query(
        'SELECT batch_id, qty_on_hand FROM public.stock_batches WHERE batch_id = ANY($1) ORDER BY batch_id',
        [[B_A1, B_A2]],
      );

    const before = { ledger: (await ledger()).rows, balances: (await balances()).rows };
    const second = (await postSale(c, args)).rows[0].sale;

    assert.equal(second.replayed, true, 'الإعادة تُعلَن صراحةً');
    assert.equal(second.invoice_id, first.invoice_id, 'نفس الفاتورة لا فاتورة ثانية');
    assert.equal(second.item_id, first.item_id);
    assert.deepEqual(second.allocations, first.allocations, 'التخصيص المعاد هو نفسه');

    assert.deepEqual((await ledger()).rows, before.ledger, 'لا حركة جديدة ولا خصم إضافي');
    assert.deepEqual((await balances()).rows, before.balances, 'الأرصدة لم تتغير');
  });
});

needsDb('البيع: إعادة المفتاح بكمية مختلفة مرفوضة ولا تصرف شيئًا', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    const first = (await postSale(c, [CU_A, W_A, M_A, UN_A, 2, 10, 'sale-key-reuse'])).rows[0].sale;

    const reused = await expectFailure(c, 'SELECT app.post_sale($1, $2, $3, $4, $5, $6, $7)', [
      CU_A,
      W_A,
      M_A,
      UN_A,
      3,
      10,
      'sale-key-reuse',
    ]);
    assert.ok(reused, 'المفتاح نفسه بكمية أخرى مرفوض');
    assert.equal(reused.code, '23505');
    assert.match(reused.message, /SALE_IDEMPOTENCY_KEY_REUSED/);

    const bal = await c.query('SELECT qty_on_hand FROM public.stock_batches WHERE batch_id = $1', [B_A1]);
    assert.equal(Number(bal.rows[0].qty_on_hand), 3, 'خصم البيع الأول (2) وحده، لا الثاني');

    const invoices = await c.query(
      `SELECT count(*)::int AS n FROM public.sales_invoices
        WHERE tenant_id = $1 AND idempotency_key = 'sale-key-reuse'`,
      [T_A],
    );
    assert.equal(invoices.rows[0].n, 1);
    assert.equal(first.replayed, false);
  });
});

needsDb('البيع: نقص المتاح لا يترك فاتورة ولا حركة ولا يستهلك رقم مستند', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    const seq = () =>
      c.query(
        `SELECT doc_type, fiscal_year, last_value FROM public.document_sequences
          WHERE tenant_id = $1 AND doc_type = 'sale'`,
        [T_A],
      );
    const before = (await seq()).rows;

    // المتاح الفعلي 11 (A1 خمسة + A2 ستة).
    const err = await expectFailure(c, 'SELECT app.post_sale($1, $2, $3, $4, $5, $6, $7)', [
      CU_A,
      W_A,
      M_A,
      UN_A,
      999,
      10,
      'sale-key-nostock',
    ]);
    assert.ok(err, 'الطلب فوق المتاح مرفوض');
    assert.equal(err.code, 'P0001');
    assert.match(err.message, /FEFO_INSUFFICIENT_STOCK/);

    const inv = await c.query(
      `SELECT count(*)::int AS n FROM public.sales_invoices
        WHERE tenant_id = $1 AND idempotency_key = 'sale-key-nostock'`,
      [T_A],
    );
    assert.equal(inv.rows[0].n, 0, 'لا فاتورة معلقة بلا بضاعة');
    assert.deepEqual((await seq()).rows, before, 'رقم المستند رجع بالمعاملة كلها');
  });
});

needsDb('البيع: مفتاح فارغ أو عميل من مخزن آخر أو مستخدم بلا صلاحية مرفوض', async () => {
  await asApp({ tenantId: T_A, userId: U_A }, async (c) => {
    const empty = await expectFailure(c, 'SELECT app.post_sale($1, $2, $3, $4, $5, $6, $7)', [
      CU_A,
      W_A,
      M_A,
      UN_A,
      1,
      10,
      '   ',
    ]);
    assert.ok(empty, 'المفتاح الفارغ مرفوض');
    assert.equal(empty.code, '22023');
    assert.match(empty.message, /SALE_IDEMPOTENCY_KEY_REQUIRED/);

    const foreign = await expectFailure(c, 'SELECT app.post_sale($1, $2, $3, $4, $5, $6, $7)', [
      CU_B,
      W_A,
      M_A,
      UN_A,
      1,
      10,
      'sale-key-foreign',
    ]);
    assert.ok(foreign, 'عميل مخزن آخر مرفوض');
    assert.equal(foreign.code, '23503', 'قيد المفتاح الأجنبي المركّب');
  });

  // مستخدم ب مخزن ب لكنه بلا أي دور: has_permission false، فلا بيع.
  await asApp({ tenantId: T_B, userId: U_B }, async (c) => {
    const denied = await failure(
      c.query('SELECT app.post_sale($1, $2, $3, $4, $5, $6, $7)', [
        CU_B,
        W_B,
        M_B,
        UN_B,
        1,
        10,
        'sale-key-denied',
      ]),
    );
    assert.ok(denied, 'بلا صلاحية إنشاء فاتورة لا بيع');
    assert.equal(denied.code, '42501');
    assert.match(denied.message, /SALE_PERMISSION_DENIED/);
  });
});

needsDb('البيع: فاتورة بسطرين تُخصم بسطرين وتُحسب بمجموع السطور', async () => {
  await asApp({ tenantId: T_E, userId: U_E }, async (c) => {
    // الثانية أولًا في الإدخال، لإثبات أن الترتيب الداخلي لا يتبع ترتيب الواجهة.
    const items = [
      { medicine_id: M_E2, unit_id: UN_E, qty: 1, unit_price: 7.25 },
      { medicine_id: M_E1, unit_id: UN_E, qty: 2, unit_price: 10.5 },
    ];
    const sale = (await postSaleItems(c, [CU_E, W_E, JSON.stringify(items), 'sale-key-multi']))
      .rows[0].sale;

    assert.equal(sale.replayed, false, 'أول نداء ليس إعادة');
    assert.equal(Number(sale.total), 28.25, '2 × 10.50 + 1 × 7.25');
    assert.deepEqual(
      sale.items.map((i) => i.medicine_id),
      [M_E1, M_E2],
      'الأسطر مرتبة بالصنف لا بترتيب الإدخال',
    );
    assert.deepEqual(
      sale.allocations.map((a) => [a.medicine_id, Number(a.qty)]),
      [
        [M_E1, 2],
        [M_E2, 1],
      ],
      'تخصيص لكل سطر من تشغيلته',
    );

    const inv = await c.query(
      'SELECT status, total FROM public.sales_invoices WHERE id = $1',
      [sale.invoice_id],
    );
    assert.equal(inv.rows[0].status, 'confirmed');
    assert.equal(Number(inv.rows[0].total), 28.25);

    const lines = await c.query(
      `SELECT medicine_id, qty, unit_price, line_total
         FROM public.sales_invoice_items
        WHERE invoice_id = $1
        ORDER BY medicine_id`,
      [sale.invoice_id],
    );
    assert.deepEqual(
      lines.rows.map((r) => [r.medicine_id, Number(r.qty), Number(r.unit_price), Number(r.line_total)]),
      [
        [M_E1, 2, 10.5, 21],
        [M_E2, 1, 7.25, 7.25],
      ],
    );

    const moves = await c.query(
      `SELECT medicine_id, qty_delta, ref_type, ref_id
         FROM public.stock_movements
        WHERE tenant_id = $1 AND ref_type = 'sales_invoice' AND ref_id = $2
        ORDER BY medicine_id`,
      [T_E, sale.invoice_id],
    );
    assert.deepEqual(
      moves.rows.map((m) => [m.medicine_id, Number(m.qty_delta)]),
      [
        [M_E1, -2],
        [M_E2, -1],
      ],
      'حركة sale لكل سطر، على الفاتورة نفسها',
    );

    const balances = () =>
      c.query(
        'SELECT batch_id, qty_on_hand FROM public.stock_batches WHERE batch_id = ANY($1) ORDER BY batch_id',
        [[B_E1, B_E2]],
      );
    const before = (await balances()).rows;
    assert.deepEqual(
      Object.fromEntries(before.map((r) => [r.batch_id, Number(r.qty_on_hand)])),
      { [B_E1]: 2, [B_E2]: 2 },
      'الخصم مر عبر الحركات فقط',
    );

    // إعادة المفتاح نفسه بترتيب أسطر مختلف: الفاتورة نفسها بلا صرف ثانٍ.
    const reordered = [items[1], items[0]];
    const replay = (await postSaleItems(c, [CU_E, W_E, JSON.stringify(reordered), 'sale-key-multi']))
      .rows[0].sale;
    assert.equal(replay.replayed, true, 'الإعادة تُعلَن صراحةً');
    assert.equal(replay.invoice_id, sale.invoice_id, 'نفس الفاتورة لا فاتورة ثانية');
    assert.equal(replay.items.length, 2);
    assert.deepEqual(
      replay.allocations.map((a) => [a.medicine_id, Number(a.qty)]),
      [
        [M_E1, 2],
        [M_E2, 1],
      ],
      'التخصيص المعاد هو نفسه',
    );
    assert.deepEqual((await balances()).rows, before, 'لا خصم إضافي عند الإعادة');

    // إعادة المفتاح ببنود مختلفة (كمية السطر الثاني) ترتد ولا تصرف.
    const changed = [items[0], { ...items[1], qty: 3 }];
    const reused = await expectFailure(c, 'SELECT app.post_sale($1, $2, $3, $4)', [
      CU_E,
      W_E,
      JSON.stringify(changed),
      'sale-key-multi',
    ]);
    assert.ok(reused, 'المفتاح نفسه ببنود أخرى مرفوض');
    assert.equal(reused.code, '23505');
    assert.match(reused.message, /SALE_IDEMPOTENCY_KEY_REUSED/);
    assert.deepEqual((await balances()).rows, before, 'الرفض لا يخصم شيئًا');
  });
});

needsDb('البيع: فشل السطر الثاني لا يترك فاتورة جزئية ولا حركة ولا يستهلك رقم مستند', async () => {
  await asApp({ tenantId: T_E, userId: U_E }, async (c) => {
    const snapshot = async () => ({
      invoices: (await c.query('SELECT count(*)::int AS n FROM public.sales_invoices')).rows[0].n,
      movements: (await c.query('SELECT count(*)::int AS n FROM public.stock_movements')).rows[0].n,
      lines: (await c.query('SELECT count(*)::int AS n FROM public.sales_invoice_items')).rows[0].n,
      seq: (
        await c.query(
          `SELECT doc_type, fiscal_year, last_value FROM public.document_sequences
            WHERE tenant_id = $1 AND doc_type = 'sale'`,
          [T_E],
        )
      ).rows,
      balances: (
        await c.query(
          'SELECT batch_id, qty_on_hand FROM public.stock_batches WHERE batch_id = ANY($1) ORDER BY batch_id',
          [[B_E1, B_E2]],
        )
      ).rows,
    });

    const before = await snapshot();

    // السطر الأول متاح (1 من 4) والثاني فوق المتاح (99 من 3)، والترتيب الداخلي
    // يضع M_E1 أولًا فعلًا: فالخصم يُسجَّل ثم يجب أن يرتد كله.
    const err = await expectFailure(c, 'SELECT app.post_sale($1, $2, $3, $4)', [
      CU_E,
      W_E,
      JSON.stringify([
        { medicine_id: M_E1, unit_id: UN_E, qty: 1, unit_price: 10 },
        { medicine_id: M_E2, unit_id: UN_E, qty: 99, unit_price: 10 },
      ]),
      'sale-key-multi-fail',
    ]);
    assert.ok(err, 'الطلب فوق المتاح مرفوض');
    assert.equal(err.code, 'P0001');
    assert.match(err.message, /FEFO_INSUFFICIENT_STOCK/);

    assert.deepEqual(await snapshot(), before, 'لا فاتورة ولا سطر ولا حركة ولا استهلاك لرقم مستند');

    const invoices = await c.query(
      `SELECT count(*)::int AS n FROM public.sales_invoices
        WHERE tenant_id = $1 AND idempotency_key = 'sale-key-multi-fail'`,
      [T_E],
    );
    assert.equal(invoices.rows[0].n, 0, 'لا فاتورة معلقة بلا بضاعة');
  });
});

needsDb('البيع: مدخلات غير صالحة ترتد 22023 ولا تترك فاتورة ولا حركة', async () => {
  await asApp({ tenantId: T_E, userId: U_E }, async (c) => {
    // لقطة واحدة: عدّ الفواتير والأسطر والحركات، وأرصدة تشغيلتي المخزن.
    const state = async () =>
      (
        await c.query(
          `SELECT (SELECT count(*) FROM public.sales_invoices)::int       AS invoices,
                  (SELECT count(*) FROM public.sales_invoice_items)::int AS items,
                  (SELECT count(*) FROM public.stock_movements)::int      AS movements,
                  (SELECT jsonb_object_agg(batch_id::text, qty_on_hand)
                     FROM public.stock_batches
                    WHERE batch_id = ANY($1))                              AS balances`,
          [[B_E1, B_E2]],
        )
      ).rows[0];
    const before = await state();

    const ok = { medicine_id: M_E1, unit_id: UN_E, qty: 1, unit_price: 10 };
    const cases = [
      ['مصفوفة فارغة', [], 'SALE_ITEMS_REQUIRED'],
      ['بند ليس كائنًا', ['x'], 'SALE_INVALID_ITEM'],
      ['معرّف صنف غير صالح', [{ ...ok, medicine_id: 'not-a-uuid' }], 'SALE_INVALID_ITEM'],
      ['بند بلا وحدة', [{ medicine_id: M_E1, qty: 1, unit_price: 10 }], 'SALE_INVALID_ITEM'],
      ['كمية صفر', [{ ...ok, qty: 0 }], 'SALE_INVALID_QTY'],
      ['سعر سالب', [{ ...ok, unit_price: -1 }], 'SALE_INVALID_PRICE'],
    ];

    for (const [i, [label, items, code]] of cases.entries()) {
      const err = await expectFailure(c, 'SELECT app.post_sale($1, $2, $3, $4)', [
        CU_E,
        W_E,
        JSON.stringify(items),
        `sale-key-bad-${i}`,
      ]);
      assert.ok(err, `${label}: مرفوض`);
      assert.equal(err.code, '22023', `${label}: رمز 22023`);
      assert.match(err.message, new RegExp(code), `${label}: ${code}`);
    }

    assert.deepEqual(await state(), before, 'لا فاتورة ولا سطر ولا حركة، والأرصدة كما كانت');
  });
});

// ---------------------------------------------------------------- التزامن
// اختبارا هذا القسم وحدهما يُثبّتان (COMMIT): القفل لا يُختبر بمعاملة تُتراجع.
// لكل منهما مخزن مستقل (T_C وT_D) وحركاته تُزال في التنظيف.

needsDb('التزامن: تخصيصان متوازيان يزيد مجموعهما على المتاح — واحد ينجح والثاني يرتد', async () => {
  const a = await openAppSession({ tenantId: T_C });
  const b = await openAppSession({ tenantId: T_C });
  let bError = null;
  let bRows = null;

  try {
    // أ: يخصّص 8 من 11 (5 من C1 + 3 من C2) ويحتفظ بأقفال الصفوف.
    const aRows = (await a.query('SELECT * FROM app.allocate_fefo($1, $2, $3, $4)', [T_C, W_C, M_C, 8])).rows;
    assert.equal(
      aRows.reduce((sum, r) => sum + Number(r.qty), 0),
      8,
      'العميل أ خصّص 8 واحتفظ بالأقفال',
    );

    // أ يسجّل الخصم كحركات sale حقيقية داخل نفس المعاملة (الأقفال باقية).
    for (const r of aRows) {
      await a.query(
        `INSERT INTO public.stock_movements
           (tenant_id, warehouse_id, location_id, medicine_id, batch_id, movement_type, qty_delta)
         VALUES ($1, $2, $3, $4, $5, 'sale', $6)`,
        [T_C, W_C, r.location_id, M_C, r.batch_id, -Number(r.qty)],
      );
    }

    // ب: يطلب 8 في نفس اللحظة، فيصطدم بقفل صفوف أ بدل أن يقرأ رصيدًا قديمًا.
    const bPromise = b
      .query('SELECT * FROM app.allocate_fefo($1, $2, $3, $4)', [T_C, W_C, M_C, 8])
      .then(
        (res) => {
          bRows = res.rows;
        },
        (err) => {
          bError = err;
        },
      );

    assert.equal(await waitForRowLock(owner), true, 'العميل ب واقف على قفل صف في allocate_fefo');
    assert.equal(bError, null, 'ب لم يصرف شيئًا قبل أن ينهي أ معاملته');
    assert.equal(bRows, null, 'ب لم يحصل على تخصيص قبل تحرير القفل');

    // أ يُثبّت: تصبح خصوماته مرئية ويُحرّر القفل، فيُكمل ب على الواقع الجديد.
    await a.query('COMMIT');
    await withTimeout(bPromise, 20000);
  } finally {
    await a.query('ROLLBACK').catch(() => {});
    await b.query('ROLLBACK').catch(() => {});
    await a.end().catch(() => {});
    await b.end().catch(() => {});
  }

  assert.ok(bError, 'التخصيص الثاني فوق المتاح مرفوض بعد تحرير القفل');
  assert.equal(bError.code, 'P0001');
  assert.match(bError.message, /FEFO_INSUFFICIENT_STOCK/);
  assert.equal(bRows, null, 'لا صفوف تخصيص للعميل الثاني');

  // الرصيد بعد المعاملة الناجحة وحدها: 11 − 8 = 3، ولا سالب في أي تشغيلة.
  const state = await owner.query(
    'SELECT batch_id, qty_on_hand FROM public.stock_batches WHERE tenant_id = $1',
    [T_C],
  );
  const byBatch = Object.fromEntries(state.rows.map((r) => [r.batch_id, Number(r.qty_on_hand)]));
  assert.deepEqual(byBatch, { [B_C1]: 0, [B_C2]: 3 }, 'الخصم وقع مرة واحدة فقط');

  const negative = await owner.query(
    'SELECT count(*)::int AS n FROM public.stock_batches WHERE tenant_id = $1 AND qty_on_hand < 0',
    [T_C],
  );
  assert.equal(negative.rows[0].n, 0, 'لا رصيد سالب بعد تزامن');

  // دفتر الحركات يحمل حركتَي أ فقط، ولا أثر للعميل الذي ارتد.
  const ledger = await owner.query(
    'SELECT count(*)::int AS n, sum(qty_delta)::numeric AS total FROM public.stock_movements WHERE tenant_id = $1',
    [T_C],
  );
  assert.equal(ledger.rows[0].n, 2, 'حركتان فقط: خصم واحد لكل تشغيلة');
  assert.equal(Number(ledger.rows[0].total), -8, 'مجموع الحركات = خصم التخصيص الناجح وحده');
});

needsDb('التزامن: مفتاح تكرار واحد بين جلستين — بيع واحد فقط ولا صرف مزدوج', async () => {
  const args = [CU_D, W_D, M_D, UN_D, 6, 10, 'sale-key-concurrent'];
  const a = await openAppSession({ tenantId: T_D, userId: U_D });
  const b = await openAppSession({ tenantId: T_D, userId: U_D });
  let aSale = null;
  let bSale = null;
  let bError = null;

  try {
    // أ: يبيع 6 من 10 ويحتفظ بقفل مفتاح الفاتورة وبأقفال التخصيص.
    aSale = (await postSale(a, args)).rows[0].sale;
    assert.equal(aSale.replayed, false, 'العميل أ أنشأ الفاتورة');

    const bPromise = postSale(b, args).then(
      (res) => {
        bSale = res.rows[0].sale;
      },
      (err) => {
        bError = err;
      },
    );

    // ب بنفس المفتاح: ينتظر قبل التخصيص، فلا يخصم شيئًا ولم يفشل بعد.
    assert.equal(await waitForRowLock(owner, 'post_sale'), true, 'العميل ب واقف على قفل في post_sale');
    assert.equal(bSale, null, 'ب لم يُرجع بيعًا قبل أن ينهي أ معاملته');
    assert.equal(bError, null, 'ب لم يفشل بعد');

    await a.query('COMMIT');
    await withTimeout(bPromise, 20000);
  } finally {
    await a.query('ROLLBACK').catch(() => {});
    await b.query('ROLLBACK').catch(() => {});
    await a.end().catch(() => {});
    await b.end().catch(() => {});
  }

  assert.equal(bError, null, 'الطلب الثاني لم يفشل: أعاد الفاتورة نفسها');
  assert.equal(bSale.replayed, true, 'الطلب الثاني إعادة لا بيع جديد');
  assert.equal(bSale.invoice_id, aSale.invoice_id, 'فاتورة واحدة للمفتاح الواحد');

  const invoices = await owner.query(
    'SELECT count(*)::int AS n FROM public.sales_invoices WHERE tenant_id = $1',
    [T_D],
  );
  assert.equal(invoices.rows[0].n, 1, 'فاتورة واحدة فقط');

  // 10 − 6 = 4، والخصم وقع مرة واحدة لا مرتين (وإلا لكان 8 أو رصيد سالب).
  const state = await owner.query(
    'SELECT batch_id, qty_on_hand FROM public.stock_batches WHERE tenant_id = $1',
    [T_D],
  );
  const byBatch = Object.fromEntries(state.rows.map((r) => [r.batch_id, Number(r.qty_on_hand)]));
  assert.deepEqual(byBatch, { [B_D1]: 0, [B_D2]: 4 }, 'الخصم وقع مرة واحدة فقط');

  const negative = await owner.query(
    'SELECT count(*)::int AS n FROM public.stock_batches WHERE tenant_id = $1 AND qty_on_hand < 0',
    [T_D],
  );
  assert.equal(negative.rows[0].n, 0, 'لا رصيد سالب');

  const ledger = await owner.query(
    'SELECT count(*)::int AS n, sum(qty_delta)::numeric AS total FROM public.stock_movements WHERE tenant_id = $1',
    [T_D],
  );
  assert.equal(ledger.rows[0].n, 2, 'حركتان: خصم واحد لكل تشغيلة');
  assert.equal(Number(ledger.rows[0].total), -6, 'مجموع الحركات = البيع الناجح وحده');
});
