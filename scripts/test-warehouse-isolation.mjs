// اختبار عزل المخزنين وFEFO والصلاحيات — على قاعدة حقيقية لا على نصّ الملفات.
//
// يشغّل السيناريوهات بدور التطبيق الفعلي `slamtak_app` (NOBYPASSRLS) داخل معاملة
// يُضبط فيها سياق الطلب بـset_config، ثم يتراجع عنها، فلا يترك أثرًا. والبذور
// (مخزنان، مخزنان منفصلان، أصناف، تشغيلات) تُنشأ بدور المالك لأن سياسات RLS
// موجّهة إلى slamtak_app وحده.
//
// المتطلب: مخطط 20261108 مبني على القاعدة:
//   node scripts/apply-migrations.mjs supabase/migrations/20261108000001_init_schema.sql \
//                                      supabase/migrations/20261108000002_seed_and_harden.sql
// التشغيل: npm run test:isolation
//
// محليًا بلا قاعدة: تُتخطّى الاختبارات برسالة. وفي CI يُضبط ISOLATION_DB_REQUIRED=1
// فيصبح غياب القاعدة فشلًا صريحًا لا تخطيًا صامتًا.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import { dbTarget } from './db-target.mjs';

const REQUIRED = process.env.ISOLATION_DB_REQUIRED === '1';
const { options } = dbTarget();

// معرّفات ثابتة: تسهّل الإشارة إلى الصفوف في التأكيدات، وتُحذف في النهاية.
const T_A = '11111111-1111-4111-8111-111111111111';
const T_B = '22222222-2222-4222-8222-222222222222';
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
const B_B1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7';
const U_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10';
const U_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb12';

let skipReason = null;
let owner = null;

const sql = (text, params) => owner.query(text, params);

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
async function cleanupTenants(client) {
  const ids = [T_A, T_B];
  for (const statement of [
    `DELETE FROM public.user_permission_overrides WHERE tenant_id = ANY($1)`,
    `DELETE FROM public.user_roles WHERE tenant_id = ANY($1)`,
    `DELETE FROM public.role_permissions WHERE tenant_id = ANY($1)`,
    `DELETE FROM public.roles WHERE tenant_id = ANY($1)`,
    `DELETE FROM public.stock_batches WHERE tenant_id = ANY($1)`,
    `DELETE FROM public.batches WHERE tenant_id = ANY($1)`,
    `DELETE FROM public.medicines WHERE tenant_id = ANY($1)`,
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
  await sql(`DELETE FROM public.users WHERE id = ANY($1)`, [[U_A, U_B]]);

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

  // تشغيلات المخزن أ: قريبة وبعيدة ومنتهية ومحجوبة وصفرية، وتشغيلة واحدة للمخزن ب.
  await sql(
    `INSERT INTO public.batches (tenant_id, id, medicine_id, batch_no, expiry_date) VALUES
       ($1, $2, $7,  'A1', CURRENT_DATE + 60),
       ($1, $3, $7,  'A2', CURRENT_DATE + 300),
       ($1, $4, $7,  'A3', CURRENT_DATE - 30),
       ($1, $5, $7,  'A4', CURRENT_DATE + 10),
       ($1, $6, $7,  'A5', CURRENT_DATE + 20),
       ($8, $9, $10, 'B1', CURRENT_DATE + 45)`,
    [T_A, B_A1, B_A2, B_A3, B_A4, B_A5, M_A, T_B, B_B1, M_B],
  );
  await sql(
    `INSERT INTO public.stock_batches (tenant_id, warehouse_id, location_id, medicine_id, batch_id, qty_on_hand, status) VALUES
       ($1, $2, $3, $4, $5, 5,  'available'),
       ($1, $2, $3, $4, $6, 10, 'available'),
       ($1, $2, $3, $4, $7, 7,  'available'),
       ($1, $2, $3, $4, $8, 4,  'blocked'),
       ($1, $2, $3, $4, $9, 0,  'available')`,
    [T_A, W_A, L_A, M_A, B_A1, B_A2, B_A3, B_A4, B_A5],
  );
  await sql(
    `INSERT INTO public.stock_batches (tenant_id, warehouse_id, location_id, medicine_id, batch_id, qty_on_hand)
     VALUES ($1, $2, $3, $4, $5, 99)`,
    [T_B, W_B, L_B, M_B, B_B1],
  );

  // أدوار المخزنين: المالك في أ بلا أدوار في ب (لاختبار رفض الصلاحية).
  await sql(`SELECT app.seed_tenant_roles($1)`, [T_A]);
  await sql(`SELECT app.seed_tenant_roles($1)`, [T_B]);
  await sql(
    `INSERT INTO public.user_roles (tenant_id, user_id, role_id)
     SELECT $1, $2, id FROM public.roles WHERE tenant_id = $1 AND code = 'owner'`,
    [T_A, U_A],
  );
});

after(async () => {
  if (!owner) return;
  try {
    await cleanupTenants(owner);
    await sql(`DELETE FROM public.users WHERE id = ANY($1)`, [[U_A, U_B]]);
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

needsDb('FEFO: الفهرس الذي يخدم الاستعلام موجود بالتعريف المتوقع', async () => {
  const { rows } = await owner.query(
    `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_stock_fefo'`,
  );
  assert.equal(rows.length, 1, 'فهرس idx_stock_fefo مفقود');
  assert.match(rows[0].indexdef, /WHERE .*qty_on_hand/);
  assert.match(rows[0].indexdef, /qty_on_hand > \(0\)/);
  assert.match(rows[0].indexdef, /status = 'available'/);
});
