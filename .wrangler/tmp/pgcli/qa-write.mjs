// اختبار عمليات الكتابة — يحاكي PostgREST بدورة authenticated/anon حقيقية.
// كل شيء داخل BEGIN واحد وينتهي بـROLLBACK دائم: صفر أثر في القاعدة.
//   node .wrangler/tmp/qa-write.mjs
import pg from 'pg';

const PWD = process.env.SUPABASE_DB_PASSWORD;
if (!PWD) { console.error('SUPABASE_DB_PASSWORD غير موجود في البيئة'); process.exit(2); }
const HOST = process.env.SUPABASE_DB_HOST || 'db.iksjhjxwphmvthryfeae.supabase.co';
const PORT = Number(process.env.SUPABASE_DB_PORT || 6543);

const c = new pg.Client({
  host: HOST, port: PORT, user: 'postgres', password: PWD, database: 'postgres',
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
});
await c.connect();
const q = (sql, params) => c.query(sql, params);

const results = [];
const rec = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`);
};

const countSql = `SELECT
  (SELECT count(*) FROM price_lists)            AS price_lists,
  (SELECT count(*) FROM price_list_items)       AS price_list_items,
  (SELECT count(*) FROM purchase_orders)        AS purchase_orders,
  (SELECT count(*) FROM user_warehouses)        AS user_warehouses,
  (SELECT count(*) FROM warehouses)             AS warehouses,
  (SELECT count(*) FROM tenants)                AS tenants,
  (SELECT count(*) FROM audit_logs)             AS audit_logs,
  (SELECT count(*) FROM auth.users)             AS auth_users`;
const counts = async () => (await q(countSql)).rows[0];

const before = await counts();
console.log('خط الأساس: ' + JSON.stringify(before));

let uid = null, n = 0;
const EMAIL = `qa-write-${Date.now()}@example.com`;

try {
  await q('BEGIN');

  // ---------- تجهيز بيئة مؤقتة (كـpostgres، تُلغى كلها) ----------
  const wh = (await q(`SELECT id, tenant_id FROM warehouses WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`)).rows[0];
  if (!wh) throw new Error('لا يوجد مخزن للاختبار');
  const product = (await q(`SELECT id FROM products ORDER BY created_at LIMIT 1`)).rows[0];
  const supplier = (await q(`SELECT id FROM suppliers ORDER BY 1 LIMIT 1`)).rows[0];
  const supplierCol = supplier ? supplier.id : null;

  let scope = { warehouse_id: wh.id, tenant_id: wh.tenant_id };

  const u = await q(`INSERT INTO auth.users
      (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
       raw_app_meta_data, raw_user_meta_data)
    VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000','authenticated','authenticated',$1,
            'qa-temp-hash-not-used', now(), now(), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb)
    RETURNING id`, [EMAIL]);
  uid = u.rows[0].id;

  // مشغّل handle_new_user_warehouse() ينشئ العضوية تلقائياً — نحدّثها بدل إنشائها
  const auto = (await q(`SELECT warehouse_id, tenant_id FROM user_warehouses WHERE user_id=$1`, [uid])).rows[0];
  if (auto) scope = { warehouse_id: auto.warehouse_id, tenant_id: auto.tenant_id };
  else await q(`INSERT INTO user_warehouses (user_id, warehouse_id, tenant_id, is_default, is_active)
                VALUES ($1,$2,$3,true,true)`, [uid, wh.id, wh.tenant_id]);

  await q(`UPDATE user_warehouses SET is_active=true,
             permissions='{"pricing.create":true,"pricing.update":true,"pricing.delete":true,"pricing.view":true}'::jsonb
           WHERE user_id=$1 AND warehouse_id=$2`, [uid, scope.warehouse_id]);
  console.log(`مستخدم اختبار مؤقت: ${uid} (مخزن ${scope.warehouse_id}, مؤسسة ${scope.tenant_id}, عضوية ${auto ? 'تلقائية' : 'يدوية'})`);

  const claims = JSON.stringify({ sub: uid, role: 'authenticated', email: EMAIL });
  const W = scope.warehouse_id, T = scope.tenant_id;

  // ---------- مشغّل السيناريو ----------
  // expectErr: نمط خطأ يُتوقع حدوثه (اختبارات الرفض/الأمان) — غيابه يعني النجاح المطلوب.
  // pre: يُنفَّذ كـpostgres قبل تبديل الدور (تجهيز الصلاحيات) لأن تعديلها كـauthenticated يحجبه RLS.
  async function scenario(name, role, fn, expectErr, pre) {
    const sp = `sp${++n}`;
    await q(`SAVEPOINT ${sp}`);
    await q(`RESET ROLE`);
    if (pre) await pre();
    await q(`SET LOCAL ROLE ${role}`);
    if (role === 'authenticated') await q(`SET LOCAL request.jwt.claims TO '${claims.replace(/'/g, "''")}'`);
    let err = null, detail = '';
    try { detail = await fn(); } catch (e) { err = e; }
    await q(`ROLLBACK TO SAVEPOINT ${sp}`);   // لا يبقى أي صف من السيناريو
    await q(`RESET ROLE`);
    if (expectErr) {
      if (err && expectErr.test(err.message)) rec(name, true, 'رُفضت كما ينبغي: ' + err.message);
      else rec(name, false, err ? 'خطأ غير المتوقّع: ' + err.message : 'لم تُرْفَض رغم التوقّع — ' + detail);
    } else if (err) {
      rec(name, false, err.message);
    } else {
      rec(name, true, detail);
    }
  }

  const clearPerms = async () => {
    await q(`UPDATE user_warehouses SET role_id=NULL, permissions='{}'::jsonb WHERE user_id=$1`, [uid]);
    await q(`DELETE FROM public.user_roles WHERE user_id=$1`, [uid]);
  };
  const grantPricing = async () => {
    await q(`UPDATE user_warehouses SET is_active=true,
               permissions='{"pricing.create":true,"pricing.update":true,"pricing.delete":true,"pricing.view":true,
                             "payroll.create":true,"payroll.update":true,"payroll.view":true}'::jsonb
             WHERE user_id=$1 AND warehouse_id=$2`, [uid, W]);
  };

  // 1) الرفض بدور anon (سياسة RLS)
  await scenario('rls: رفض الكتابة لدور anon على price_lists', 'anon', async () => {
    await q(`INSERT INTO price_lists (tenant_id, warehouse_id, name, price_type)
             VALUES ($1,$2,'QA anon','base')`, [T, W]);
    return 'أُنشئت';
  }, /row-level security/);

  // 2) بوابة rbac_enforce قبل منح الصلاحية
  await scenario('rbac: رفض إنشاء قائمة سعر لمستخدم بلا صلاحية', 'authenticated', async () => {
    await q(`INSERT INTO price_lists (tenant_id, warehouse_id, name, price_type)
             VALUES ($1,$2,'QA no-perm','base')`, [T, W]);
    return 'أُنشئت رغم غياب الصلاحية';
  }, /صلاحية|غير مصرح/, clearPerms);

  // 3) حمولة إضافة قائمة السعر بعد الإصلاح (price_type مضاف)
  await scenario('واجهة: إنشاء قائمة سعر بعد الإصلاح', 'authenticated', async () => {
    await q(`INSERT INTO price_lists (tenant_id, warehouse_id, name, name_ar, currency, valid_from, valid_to, status, price_type, created_by)
             VALUES ($1,$2,$3,$3,'EGP',CURRENT_DATE,NULL,'draft','base',$4)`,
            [T, W, 'قائمة QA مؤقتة', uid]);
    return 'أُنشئت بنجاح';
  }, null, grantPricing);

  // 4) نفس الحمولة مع price_type ثم تعديل الحالة (مسار mpPatch) ثم حذف
  await scenario('price_lists: إنشاء + تعديل الحالة + حذف', 'authenticated', async () => {
    const ins = await q(`INSERT INTO price_lists (tenant_id, warehouse_id, name, name_ar, currency, valid_from, valid_to, status, created_by, price_type)
             VALUES ($1,$2,$3,$3,'EGP',CURRENT_DATE,NULL,'draft',$4,'base') RETURNING id`,
            [T, W, 'قائمة QA مؤقتة', uid]);
    const id = ins.rows[0].id;
    const upd = await q(`UPDATE price_lists SET status='active' WHERE id=$1 RETURNING status`, [id]);
    const del = await q(`DELETE FROM price_lists WHERE id=$1 RETURNING id`, [id]);
    return `إنشاء ✓، تعديل status=${upd.rows[0]?.status} ✓، حذف ${del.rowCount} صف ✓`;
  }, null, grantPricing);

  // 5) إضافة بند سعر بعد الإصلاح (unit_price مضاف)
  await scenario('واجهة: إضافة بند سعر بعد الإصلاح', 'authenticated', async () => {
    if (!product) return 'لا يوجد صنف للاختبار — تخطّي';
    const pl = await q(`INSERT INTO price_lists (tenant_id, warehouse_id, name, currency, valid_from, status, created_by, price_type)
                        VALUES ($1,$2,'QA items','EGP',CURRENT_DATE,'draft',$3,'base') RETURNING id`,
                       [T, W, uid]);
    await q(`INSERT INTO price_list_items (price_list_id, product_id, price, unit_price, min_qty)
             VALUES ($1,$2,99.5,99.5,1)`, [pl.rows[0].id, product.id]);
    return 'أُنشئت بنجاح';
  }, null, grantPricing);

  // 6) البند مع unit_price ثم الحذف
  await scenario('price_list_items: إنشاء + حذف', 'authenticated', async () => {
    if (!product) return 'لا يوجد صنف للاختبار — تخطّي';
    const pl = await q(`INSERT INTO price_lists (tenant_id, warehouse_id, name, currency, valid_from, status, created_by, price_type)
                        VALUES ($1,$2,'QA items2','EGP',CURRENT_DATE,'draft',$3,'base') RETURNING id`,
                       [T, W, uid]);
    const it = await q(`INSERT INTO price_list_items (price_list_id, product_id, price, unit_price, min_qty)
                        VALUES ($1,$2,99.5,99.5,1) RETURNING id`, [pl.rows[0].id, product.id]);
    const del = await q(`DELETE FROM price_list_items WHERE id=$1 RETURNING id`, [it.rows[0].id]);
    return `إنشاء ✓، حذف ${del.rowCount} صف ✓`;
  }, null, grantPricing);

  // 7) أمر الشراء بعد الإصلاح (tenant_id مضاف)
  await scenario('واجهة: إنشاء أمر شراء بعد الإصلاح', 'authenticated', async () => {
    if (!supplierCol) return 'لا يوجد مورد للاختبار — تخطّي';
    await q(`INSERT INTO purchase_orders (order_number, tenant_id, supplier_id, warehouse_id, order_date, status, subtotal, discount_amount, tax_amount, total_amount, notes)
             VALUES ($1,$2,$3,$4,CURRENT_DATE,'draft',0,0,0,0,NULL)`,
            [`PO-QA-${Date.now().toString().slice(-8)}`, T, supplierCol, W]);
    return 'أُنشئ بنجاح';
  }, null, grantPricing);

  // 7ب) إضافة عرض ترويجي بعد الإصلاح (promotion_type مضاف)
  await scenario('واجهة: إنشاء عرض ترويجي بعد الإصلاح', 'authenticated', async () => {
    await q(`INSERT INTO promotions (tenant_id, warehouse_id, name, name_ar, kind, promotion_type, value, min_order_amount, applies_to, starts_at, status, created_by)
             VALUES ($1,$2,'QA promo','QA promo','percent','percentage_discount',10,0,'all',now(),'draft',$3)`, [T, W, uid]);
    return 'أُنشئ بنجاح';
  }, null, grantPricing);

  // 7ج) إنشاء مسير رواتب بعد الإصلاح (pay_period_start/end مضافان)
  await scenario('واجهة: إنشاء مسير رواتب بعد الإصلاح', 'authenticated', async () => {
    await q(`INSERT INTO payroll_runs (tenant_id, warehouse_id, period_start, period_end, pay_period_start, pay_period_end, status, notes, created_by)
             VALUES ($1,$2,CURRENT_DATE,CURRENT_DATE+14,CURRENT_DATE,CURRENT_DATE+14,'draft',NULL,$3)`, [T, W, uid]);
    return 'أُنشئ بنجاح';
  }, null, grantPricing);

  // 8) رفض الإدراج المباشر في warehouses من الواجهة (لا توجد سياسة INSERT —
  //    لهذا يمر المسار عبر wms_register_workspace) — الحمولة مكتملة ليعزل خطأ RLS وحده.
  await scenario('rls: رفض الإدراج المباشر في warehouses', 'authenticated', async () => {
    await q(`INSERT INTO warehouses (tenant_id, name, code)
             VALUES ($1,'QA مباشر','QA-' || substr(md5(gen_random_uuid()::text),1,8))`, [T]);
    return 'أُنشئ رغم غياب سياسة الإدراج';
  }, /row-level security/);

  // 9) مسار تسجيل مساحة العمل بعد الترحيل (code + manager_id + audit_logs)
  await scenario('واجهة: تسجيل مساحة العمل بعد الإصلاح (RPC)', 'authenticated', async () => {
    const r = await q(`SELECT public.wms_register_workspace('مخزن QA مؤقت') AS out`);
    const out = r.rows[0].out;
    if (!out || !out.warehouse_id || !out.tenant_id)
      throw new Error('ناتج غير مكتمل: ' + JSON.stringify(out));
    const m = await q(`SELECT count(*)::int n FROM user_warehouses
                        WHERE user_id=$1 AND warehouse_id=$2`, [uid, out.warehouse_id]);
    if (m.rows[0].n !== 1) throw new Error('لم تُنشأ عضوية المدير في المخزن الجديد');
    return `مخزن جديد ✓، مستأجر ${out.tenant_id} ✓، عضوية المدير ✓`;
  });

  // 9ب) عزل القراءة: anon لا يرى صفوف price_lists
  await scenario('rls: قراءة price_lists بدور anon', 'anon', async () => {
    const r = await q(`SELECT count(*)::int AS n FROM price_lists`);
    if (r.rows[0].n !== 0) throw new Error(`رأى ${r.rows[0].n} صف بدور anon — تسريب`);
    return '0 صف';
  });

} catch (e) {
  rec('خطأ في سير الاختبار', false, e.message);
} finally {
  try { await q('ROLLBACK'); } catch (_) {}
  console.log('\n(تم ROLLBACK للمعاملة كاملة)');
}

const after = await counts();
console.log('بعد الاختبار: ' + JSON.stringify(after));

const drift = Object.keys(before).filter((k) => String(before[k]) !== String(after[k]));
const baseOk = drift.length === 0;
rec('لا بقايا: العدّادات كما كانت قبل الاختبار', baseOk,
    baseOk ? JSON.stringify(after) : 'اختلاف في: ' + drift.join(', '));

const passed = results.filter((r) => r.ok).length;
console.log(`\nالنتيجة: ${passed}/${results.length}`);
await c.end();
process.exit(baseOk && passed === results.length ? 0 : 1);
