// اختبار قفل صفوف المخزون — المرحلة 3 (202610250003_inventory_row_locking.sql)
//
// كل ما يُكتب هنا يجري داخل معاملة واحدة ثم ROLLBACK: لا شيء يُحفظ على الإنتاج.
//
// يغطّي:
//   T1 الترحيل يُنشأ داخل معاملة ويلغي كلياً عند ROLLBACK (لا أثر على الإنتاج)
//   T2 دالة القفل wms_inventory_lock تُرجع NULL بلا استثناء عندما لا يوجد صف
//   T3 دالة القفل تجد صف الدفعة وتعيده كما هو، ونصها يحتوي على FOR UPDATE
//   T4 النصوص الحساسة: الدالتان تستدعيان القفل، ومعالج الخطأ ورسالته كما هما،
//      والقراءة القديمة غير المقفلة اختفت
//   T8 (خياري --contention) إثبات الحجب الفعلي: جلسة تمسك القفل وأخرى تحاول
//      القفل نفسه بـ NOWAIT فترفض — مع بيانات اختبار ملتزمة تُحذف ويُتحقق من
//      عدّاد الحالة قبل/بعد. لا يعمل في المسار الافتراضي حتى يبقى كل شيء Rollback-only.
//   T5 الاستلام الجديد يتراكم بشكل صحيح (كمية + متوسط تكلفة موزون) مع بقاء حالة أمر الشراء
//   T6 فشل تسجيل الحركة ما زال يرفع استثناءً واضحاً ولا يترك مستنداً ولا يمس الرصيد
//   T7 المرتجع الجديد (بعد قفل الدفعة) يعيد الكمية للمتاح ويسجّل restock فعلاً
//
// الاستخدام: node supabase/tests/run-inventory-lock-test.mjs
// التطبيق:   node supabase/tests/run-inventory-lock-test.mjs --apply
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const token = readFileSync(join(ROOT, 'secrets/SUPABASE_ACCESS_TOKEN'), 'utf8').trim();
const MIGRATION = join(ROOT, 'supabase/migrations/202610250003_inventory_row_locking.sql');
const API = 'https://api.supabase.com/v1/projects/iksjhjxwphmvthryfeae/database/query';

async function run(query) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(180000),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = [{ raw: text }]; }
  return { ok: res.ok, status: res.status, data };
}

const migrationSql = readFileSync(MIGRATION, 'utf8');

const ASSERTIONS = `
do $locktest$
declare
  v_tenant   uuid := gen_random_uuid();
  v_wh       uuid := gen_random_uuid();
  v_supplier uuid := gen_random_uuid();
  v_product  uuid := gen_random_uuid();
  v_user     uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_invoice  uuid := gen_random_uuid();
  v_po       uuid := gen_random_uuid();
  v_po2      uuid := gen_random_uuid();
  v_msg      text := null;
  v_src      text := null;
  v_locked   uuid := null;
  v_row      public.inventory%rowtype;
  v_qty      numeric := null;
  v_avail    numeric := null;
  v_ret      jsonb := null;
  v_cost     numeric := null;
  v_status   text := null;
  n          int  := 0;
begin
  ------------------------------------------------ T2 دالة القفل موجودة وآمنة
  if to_regprocedure('public.wms_inventory_lock(uuid,uuid,text)') is null then
    raise exception 'T2 فشل: دالة القفل wms_inventory_lock لم تُنشأ';
  end if;

  begin
    select (public.wms_inventory_lock('11111111-1111-4111-8111-111111111111'::uuid,
                                       '22222222-2222-4222-8222-222222222222'::uuid,
                                       'NO-SUCH-BATCH')).id
      into v_locked;
  exception when others then
    raise exception 'T2 فشل: دالة القفل رمت استثناءً بدل NULL عند عدم وجود الصف (%)', SQLERRM;
  end;
  if v_locked is not null then
    raise exception 'T2 فشل: دالة القفل أعادت صفّاً لدفعة غير موجودة';
  end if;

  -- نفس نمط الدالتين: تعيين نتيجة NULL في متغير صفوف (%rowtype) يجب أن يبقى آمناً
  begin
    v_row := public.wms_inventory_lock('11111111-1111-4111-8111-111111111111'::uuid,
                                       '22222222-2222-4222-8222-222222222222'::uuid,
                                       'NO-SUCH-BATCH');
    if v_row.id is not null then
      raise exception 'T2 فشل: تعيين NULL أعطى صفّاً غير قابل للتحديث';
    end if;
  exception when others then
    if sqlerrm like 'T2 فشل:%' then raise; end if;
    raise exception 'T2 فشل: تعيين نتيجة NULL في متغير صفوف تعطّل (%)', SQLERRM;
  end;

  ------------------------------------------------ T4 النصوص الحساسة للدوالتين
  select prosrc into v_src from pg_proc where proname = 'p_proc_receive_goods';
  if v_src is null then raise exception 'T4 فشل: p_proc_receive_goods غير موجودة'; end if;
  if v_src not like '%wms_inventory_lock%' then
    raise exception 'T4 فشل: الاستلام لا يستدعي دالة القفل';
  end if;
  if v_src not like '%inventory_movement_failed%' then
    raise exception 'T4 فشل: معالج الخطأ في الاستلام اختفى';
  end if;
  if v_src not like '%raise exception ''فشل ترحيل حركة الاستلام%' then
    raise exception 'T4 فشل: رفع الاستثناء بعد فشل تسجيل الحركة اختفى';
  end if;
  if v_src like '%select id, coalesce(cost_price,0), coalesce(available_quantity,0) into v_inv_id%' then
    raise exception 'T4 فشل: القراءة القديمة غير المقفلة ما زالت في الاستلام';
  end if;

  select prosrc into v_src from pg_proc where proname = 'p_sale_create_return';
  if v_src is null then raise exception 'T4 فشل: p_sale_create_return غير موجودة'; end if;
  if v_src not like '%wms_inventory_lock%' then
    raise exception 'T4 فشل: المرتجعات لا تستدعي دالة القفل';
  end if;
  if v_src like '%as quarantined%' then
    raise exception 'T4 فشل: القراءة القديمة غير المقفلة ما زالت في المرتجعات';
  end if;

  ------------------------------------------------ تجهيز بيانات الاختبار (تُلغى مع ROLLBACK)
  insert into public.tenants (id, name, name_ar, code, email, country, is_active)
    values (v_tenant, 'LOCK TEST', 'اختبار قفل المخزون', 'LKPTST', 'locktest@example.com', 'EG', true);
  insert into public.warehouses (id, tenant_id, name, code, is_main, is_active)
    values (v_wh, v_tenant, 'مخزن اختبار القفل', 'LKPW', true, true);
  insert into public.users (id, tenant_id, email, password_hash, first_name, last_name)
    values (v_user, v_tenant, 'locktest-' || v_user || '@example.org', 'not-a-real-hash', 'Lock', 'Tester');
  insert into public.profiles (id, full_name, role) values (v_user, 'مستخدم اختبار القفل', 'manager');
  insert into public.suppliers (id, tenant_id, warehouse_id, name, code)
    values (v_supplier, v_tenant, v_wh, 'مورد اختبار القفل', 'LKPS');
  insert into public.products (id, tenant_id, warehouse_id, name, name_ar, sku, unit_of_measure, barcode)
    values (v_product, v_tenant, v_wh, 'Lock Test Product', 'منتج اختبار القفل', 'SKU-LOCK-1', 'box', '6221000000077');
  insert into public.purchase_orders (id, tenant_id, supplier_id, warehouse_id, order_number, order_date, status, total_amount)
    values (v_po, v_tenant, v_supplier, v_wh, 'PO-LOCK-TEST', current_date, 'approved', 100);
  insert into public.purchase_order_items (purchase_order_id, product_id, quantity, unit_price)
    values (v_po, v_product, 50, 2);
  -- أمر شراء ثانٍ برقم يحمل إبرة المُحفّز: ملاحظة حركة الاستلام = «استلام أمر شراء <الرقم>»
  insert into public.purchase_orders (id, tenant_id, supplier_id, warehouse_id, order_number, order_date, status, total_amount)
    values (v_po2, v_tenant, v_supplier, v_wh, 'PO-FORCE-LOCK', current_date, 'approved', 100);
  insert into public.purchase_order_items (purchase_order_id, product_id, quantity, unit_price)
    values (v_po2, v_product, 50, 2);

  ------------------------------------------------ T3 دالة القفل تجد الصف وتقفله
  -- (الإثبات القاطع للحجب الفعلي بين جلستين يأتي في وضع --contention أدناه؛
  --  هنا نتحقق أن النص يحمل FOR UPDATE وأن الدالة تُرجع الصف المطابق حرفياً)
  select prosrc into v_src from pg_proc where proname = 'wms_inventory_lock';
  if v_src is null or position('for update' in lower(v_src)) = 0 then
    raise exception 'T3 فشل: نص دالة القفل لا يحتوي على FOR UPDATE';
  end if;

  insert into public.inventory (tenant_id, warehouse_id, product_id, batch_number, expiry_date,
                                quantity, available_quantity, unit_cost, cost_price, created_by)
    values (v_tenant, v_wh, v_product, 'LOCKB', current_date + 30, 7, 7, 3, 3, v_user);

  select (public.wms_inventory_lock(v_wh, v_product, 'LOCKB')).id into v_locked;
  if v_locked is null then
    raise exception 'T3 فشل: دالة القفل لم تجد صف الدفعة الموجود';
  end if;
  if v_locked is distinct from (
       select id from public.inventory
        where warehouse_id = v_wh and product_id = v_product and batch_number = 'LOCKB') then
    raise exception 'T3 فشل: دالة القفل أعادت صفّاً غير صف الدفعة المطابق';
  end if;

  ------------------------------------------------ T5 سلوك الاستلام الجديد
  perform public.p_proc_receive_goods(
    v_po,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product, 'batch_number', 'RCV1',
      'expiry_date', (current_date + 30)::text, 'quantity_received', 10, 'unit_cost', 2)),
    'اختبار قفل المخزون — استلام أول', v_user, 'GR-LOCK-1');

  select quantity, available_quantity, unit_cost into v_qty, v_avail, v_cost
    from public.inventory
   where warehouse_id = v_wh and product_id = v_product and batch_number = 'RCV1';
  if v_qty is distinct from 10 or v_avail is distinct from 10 then
    raise exception 'T5 فشل: الاستلام الأول لم يثبت الكمية (quantity=% available=%)', v_qty, v_avail;
  end if;
  if v_cost is distinct from 2 then
    raise exception 'T5 فشل: تكلفة الاستلام الأول (%)', v_cost;
  end if;

  perform public.p_proc_receive_goods(
    v_po,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product, 'batch_number', 'RCV1',
      'expiry_date', (current_date + 30)::text, 'quantity_received', 5, 'unit_cost', 4)),
    'اختبار قفل المخزون — استلام ثانٍ', v_user, 'GR-LOCK-2');

  select quantity, available_quantity, unit_cost into v_qty, v_avail, v_cost
    from public.inventory
   where warehouse_id = v_wh and product_id = v_product and batch_number = 'RCV1';
  if v_qty is distinct from 15 or v_avail is distinct from 15 then
    raise exception 'T5 فشل: التراكم تحت القفل خاطئ (quantity=% available=% والمتوقع 15)', v_qty, v_avail;
  end if;
  -- عمود unit_cost يحمل دقة منزلتين (2.67 لـ 40/15) — نتسامح بفارق التقريب فقط
  if abs(v_cost - (40.0 / 15)) > 0.01 then
    raise exception 'T5 فشل: متوسط التكلفة الموزون % (المتوقع %)', v_cost, 40.0 / 15;
  end if;

  select status into v_status from public.purchase_orders where id = v_po;
  if v_status <> 'partially_received' then
    raise exception 'T5 فشل: حالة أمر الشراء % (المتوقع partially_received بعد 15 من 50)', v_status;
  end if;

  select count(*) into n from public.goods_receipts where purchase_order_id = v_po;
  if n <> 2 then raise exception 'T5 فشل: عدد مستندات الاستلام % (المتوقع 2)', n; end if;

  select count(*) into n
    from public.inventory_movements
   where warehouse_id = v_wh and product_id = v_product and movement_type = 'in';
  if n <> 2 then raise exception 'T5 فشل: عدد حركات الوارد % (المتوقع 2)', n; end if;

  ------------------------------------------------ T6 فشل تسجيل الحركة: لا نجاح زائف
  create or replace function public._locktest_raise() returns trigger
  language plpgsql as $trig$
  begin
    raise exception 'فرض فشل تسجيل الحركة (اختبار قفل المخزون)';
  end;
  $trig$;

  create trigger _locktest_fail before insert on public.inventory_movements
    for each row when (new.notes like '%FORCE-LOCK%')
    execute function public._locktest_raise();

  begin
    perform public.p_proc_receive_goods(
      v_po2,
      jsonb_build_array(jsonb_build_object(
        'product_id', v_product, 'batch_number', 'RCV1',
        'expiry_date', (current_date + 30)::text, 'quantity_received', 5, 'unit_cost', 1)),
      'اختبار قفل المخزون — فشل مفروض', v_user, 'GR-LOCK-FAIL');
    raise exception 'T6 فشل: قبل فشل تسجيل الحركة ولم يرفع استثناءً';
  exception
    when raise_exception then
      if sqlerrm like 'T6 فشل:%' then raise; end if;
      v_msg := sqlerrm;
  end;

  if v_msg is null or v_msg not like '%فشل ترحيل حركة الاستلام%' then
    raise exception 'T6 فشل: رسالة الخطأ غير واضحة (%)', coalesce(v_msg, 'null');
  end if;
  if v_msg not like '%PO-FORCE-LOCK%' then
    raise exception 'T6 فشل: رسالة الخطأ لا تذكر أمر الشراء (%)', v_msg;
  end if;
  if exists (select 1 from public.goods_receipts where receipt_number = 'GR-LOCK-FAIL') then
    raise exception 'T6 فشل: أُنشئ مستند استلام رغم فشل التسجيل';
  end if;
  select status into v_status from public.purchase_orders where id = v_po2;
  if v_status <> 'approved' then
    raise exception 'T6 فشل: تغيّرت حالة أمر الشراء الثاني إلى % رغم فشل الترحيل', v_status;
  end if;
  if exists (select 1 from public.purchase_order_items where purchase_order_id = v_po2 and received_quantity <> 0) then
    raise exception 'T6 فشل: بند أمر الشراء الثاني تغيّر رغم فشل الترحيل';
  end if;

  select quantity into v_qty
    from public.inventory
   where warehouse_id = v_wh and product_id = v_product and batch_number = 'RCV1';
  if v_qty is distinct from 15 then
    raise exception 'T6 فشل: الرصيد تغيّر رغم فشل الترحيل (quantity=% والمتوقع 15)', v_qty;
  end if;

  ------------------------------------------------ T7 المرتجع: قفل الدفعة ثم إرجاع للمتاح
  insert into public.customers (id, tenant_id, warehouse_id, name, name_ar, code, payment_terms, is_active, created_by)
    values (v_customer, v_tenant, v_wh, 'Lock Test Customer', 'عميل اختبار القفل', 'LKPC01', 'cash', true, v_user);
  insert into public.sales_invoices (id, tenant_id, customer_id, warehouse_id, invoice_number,
                                     invoice_date, status, subtotal, tax_amount, discount_amount,
                                     total_amount, paid_amount, created_by)
    values (v_invoice, v_tenant, v_customer, v_wh, 'INV-LOCK-TEST', current_date, 'issued',
            0, 0, 0, 0, 0, v_user);
  insert into public.sales_invoice_items (sales_invoice_id, product_id, quantity, unit_price,
                                          discount_percent, tax_percent, subtotal, line_total, batch_number)
    values (v_invoice, v_product, 4, 10, 0, 0, 40, 40, 'RCV1');

  v_ret := public.p_sale_create_return(
    v_invoice,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product, 'quantity', 4, 'batch_number', 'RCV1', 'check_passed', true)),
    'مرتجع اختبار قفل المخزون', v_user);

  if coalesce((v_ret->>'restocked_qty')::numeric, 0) <> 4 then
    raise exception 'T7 فشل: المرتجع لم يُرجع الكمية للمتاح (restocked_qty=%) — النتيجة %',
      v_ret->>'restocked_qty', v_ret;
  end if;
  if coalesce((v_ret->>'quarantined_qty')::numeric, 0) <> 0 then
    raise exception 'T7 فشل: دفعة سليمة داخل الصلاحية حُجرت خطأً (quarantined_qty=%)',
      v_ret->>'quarantined_qty';
  end if;

  select quantity, available_quantity into v_qty, v_avail
    from public.inventory
   where warehouse_id = v_wh and product_id = v_product and batch_number = 'RCV1';
  if v_qty is distinct from 19 or v_avail is distinct from 19 then
    raise exception 'T7 فشل: الرصيد بعد المرتجع %/% (المتوقع 19/19)', v_qty, v_avail;
  end if;

  if not exists (
       select 1 from public.return_items ri
        where ri.return_id = (v_ret->>'return_id')::uuid
          and ri.product_id = v_product and ri.action = 'restock' and ri.quantity = 4) then
    raise exception 'T7 فشل: لم يُسجَّل إجراء restock على بند المرتجع';
  end if;

  raise notice '✅ جميع اختبارات قفل صفوف المخزون نجحت (T1-T7)';
end $locktest$;`;

// التحقق من أن ROLLBACK لم يترك أي أثر على الإنتاج
const STATE_SQL = `select
  (to_regprocedure('public.wms_inventory_lock(uuid,uuid,text)') is not null) as helper_persisted,
  (select prosrc like '%wms_inventory_lock%' from pg_proc where proname = 'p_proc_receive_goods') as fn_changed,
  (select count(*) from public.tenants where code = 'LKPTST') as test_tenants,
  (select count(*) from public.goods_receipts where receipt_number like 'GR-LOCK-%') as test_receipts`;

const ALLOWED = process.argv.includes('--apply');

if (ALLOWED) {
  console.log('▶ تطبيق ترحيل قفل المخزون على الإنتاج...');
  const res = await run(migrationSql);
  if (!res.ok) {
    console.error('❌ فشل التطبيق:', res.status);
    console.error(typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 1).slice(0, 4000));
    process.exit(1);
  }
  console.log('✅ طُبّق ترحيل قفل صفوف المخزون على قاعدة الإنتاج');
  process.exit(0);
}

const pre = await run(STATE_SQL);
const preRow = Array.isArray(pre.data) ? pre.data[0] : null;

console.log('▶ تشغيل الترحيل واختبارات القفل داخل معاملة ثم ROLLBACK...');
const res = await run('begin;\n' + migrationSql + '\n' + ASSERTIONS + '\nrollback;');

if (!res.ok) {
  console.error('❌ فشل:', res.status);
  console.error(typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 1).slice(0, 6000));
  process.exit(1);
}
const notices = (Array.isArray(res.data) ? res.data : [])
  .map((r) => (r && (r.notice || r.message)) || '')
  .filter(Boolean);
console.log('التنبيهات:', notices.join(' | ').slice(0, 1500) || '(لم تُرسل)');
console.log('✅ اكتمل الترحيل والاختبارات داخل المعاملة');

const post = await run(STATE_SQL);
const postRow = Array.isArray(post.data) ? post.data[0] : null;
if (!postRow || !preRow) {
  console.error('❌ تعذر التحقق من حالة القاعدة بعد ROLLBACK:', JSON.stringify(post.data).slice(0, 1000));
  process.exit(1);
}
if (JSON.stringify(postRow) !== JSON.stringify(preRow)) {
  console.error('❌ ROLLBACK لم يُلغي كل التغييرات:', { before: preRow, after: postRow });
  process.exit(1);
}
if (postRow.helper_persisted || postRow.fn_changed) {
  console.error('❌ الترحيل أو دواله بقيا محفوظين بعد ROLLBACK:', postRow);
  process.exit(1);
}
console.log('✅ الحالة بعد ROLLBACK = الحالة قبلها: لا أثر على الإنتاج');
console.log('✅ جميع اختبارات قفل صفوف المخزون نجحت (dry-run)');

// ---------------------------------------------------------------------------
// T8 (خياري): --contention — إثبات أن القفل يحجب جلسة أخرى فعلياً
//
// جلسة A تنشئ دالة القفل داخل معاملتها ثم تمسك قفل صف الدفعة 5 ثوانٍ،
// وجلسة B تحاول قفل نفس الصف بـ NOWAIT أثناء ذلك فيجب أن تُرفض (55P03)،
// ثم تنجح بعد انتهاء A (القفل يُحرَّر مع المعاملة).
//
// لازم للإثبات أن صف الدفعة يكون مقروءاً لجلستين، ولذلك تُنشأ بيانات اختبار
// ملتزمة (عقدة/مخزن/صنف/دفعة برمز LKPTST) وتُحذف في نهاية الاختبار مهما كانت
// نتيجته، مع مقارنة العدّاد بالقيمة قبل البدء. الترحيل نفسه يبقى Rollback-only.
// ---------------------------------------------------------------------------
const CONTENTION = process.argv.includes('--contention');
const FIX = {
  tenant: 'ad000000-0000-4000-8000-000000000001',
  wh: 'ad000000-0000-4000-8000-000000000002',
  product: 'ad000000-0000-4000-8000-000000000003',
};
const COUNTS_SQL = `select
  (select count(*) from public.tenants) as tenants,
  (select count(*) from public.warehouses) as warehouses,
  (select count(*) from public.products) as products,
  (select count(*) from public.inventory) as inventory,
  (select count(*) from public.tenants where code = 'LKPTST') as fixture_tenants`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const firstRow = (d) => (Array.isArray(d) && d.length ? d[0] : null);

if (CONTENTION) {
  const before = firstRow((await run(COUNTS_SQL)).data);
  if (!before) {
    console.error('❌ تعذر قراءة العدّادات قبل الاختبار');
    process.exit(1);
  }
  if (before.fixture_tenants) {
    console.log('⚠️ توجد بقايا اختبار سابقة (LKPTST) — تُحذف قبل البدء');
    await run("delete from public.tenants where code = 'LKPTST';");
  }

  let failed = false;
  const fail = (msg, extra) => {
    failed = true;
    console.error('❌ ' + msg, extra === undefined ? '' : extra);
  };

  try {
    console.log('▶ T8: إنشاء بيانات اختبار ملتزمة (تُحذف بعد الاختبار)...');
    const setup = await run(`
begin;
insert into public.tenants (id, name, name_ar, code, email, country, is_active)
  values ('${FIX.tenant}', 'LOCK CONT', 'اختبار حجب القفل', 'LKPTST', 'lockcont@example.com', 'EG', true);
insert into public.warehouses (id, tenant_id, name, code, is_main, is_active)
  values ('${FIX.wh}', '${FIX.tenant}', 'مخزن اختبار الحجب', 'LKPCW', true, true);
insert into public.products (id, tenant_id, warehouse_id, name, name_ar, sku, unit_of_measure, barcode)
  values ('${FIX.product}', '${FIX.tenant}', '${FIX.wh}', 'Lock Cont Product', 'منتج اختبار الحجب', 'SKU-LOCK-CONT', 'box', '6221000000088');
insert into public.inventory (tenant_id, warehouse_id, product_id, batch_number, expiry_date,
                              quantity, available_quantity, unit_cost, cost_price)
  values ('${FIX.tenant}', '${FIX.wh}', '${FIX.product}', 'CONT', current_date + 30, 5, 5, 1, 1);
commit;`);
    if (!setup.ok) {
      fail('فشل إنشاء بيانات الاختبار:', JSON.stringify(setup.data).slice(0, 600));
    } else {
      // دالة القفل تُنشأ داخل معاملة الجلسة A نفسها فلا يُحفظ شيء من الترحيل
      const HELPER_DDL = migrationSql.slice(
        migrationSql.indexOf('create or replace function public.wms_inventory_lock('),
        migrationSql.indexOf('revoke all on function public.wms_inventory_lock')
      );
      if (!HELPER_DDL.includes('$lock$')) {
        fail('تعذر استخراج تعريف دالة القفل من الترحيل');
      }

      const holdSql = `begin;\n${HELPER_DDL}\nselect (public.wms_inventory_lock('${FIX.wh}', '${FIX.product}', 'CONT')).id as locked_id;\nselect pg_sleep(5) as holding;\nselect (public.wms_inventory_lock('${FIX.wh}', '${FIX.product}', 'CONT')).id as locked_id;\nrollback;`;
      const attemptSql = `begin;\nselect id from public.inventory\n where warehouse_id = '${FIX.wh}' and product_id = '${FIX.product}' and batch_number = 'CONT'\n for update nowait;\nrollback;`;

      const tA0 = Date.now();
      // لا ننتظر: نحاول قفل نفس الصف بينما جلسة A نائمة بالقفل
      const hold = run(holdSql);
      let holdDone = false;
      const holdPromise = hold.then((r) => {
        holdDone = true;
        return r;
      });

      // محاولة واحدة بتوقيت ثابت كانت رهينة زمن إنشاء الدالة داخل جلسة A، لذلك
      // نُعيد المحاولة كل 500ms: أول رفض (55P03) أثناء أن A تمسك القفل = إثبات الحجب.
      let blocked = null;
      let unexpected = null;
      let attempts = 0;
      let tBlocked = null;
      while (!holdDone && !blocked && attempts < 30) {
        await sleep(500);
        attempts++;
        const r = await run(attemptSql);
        if (!r.ok) {
          const msg = JSON.stringify(r.data);
          if (/could not obtain lock|55P03|lock not available/i.test(msg)) {
            blocked = r;
            tBlocked = Date.now();
          } else unexpected = msg;
        }
      }
      const holdRes = await holdPromise;
      const tA1 = Date.now();

      if (!holdRes.ok) {
        fail('جلسة A فشلت:', JSON.stringify(holdRes.data).slice(0, 600));
      } else {
        // الاستجابة تجمع نتائج جمل الجلسة — نبحث عن صف مقفلناه في أي نتيجة
        const locked = (Array.isArray(holdRes.data) ? holdRes.data : []).find(
          (r) => r && r.locked_id
        );
        if (!locked) fail('جلسة A لم تُرجع صفّاً مقفلناً (locked_id):', JSON.stringify(holdRes.data).slice(0, 500));
      }

      if (blocked) {
        console.log(`✅ T8a: جلسة B رُفضت بخطأ قفل (NOWAIT) في المحاولة ${attempts} عند ${tBlocked - tA0}ms بينما A تمسك القفل حتى ${tA1 - tA0}ms — القفل يحجب فعلاً`);
      } else if (unexpected) {
        fail('محاولة B فشلت بسبب غير متوقع (ليست خطأ قفل):', unexpected.slice(0, 500));
      } else {
        fail(`لم يُرصد أي رفض خلال ${attempts} محاولة وأن A انتهت بعد ${tA1 - tA0}ms — لا دليل على الحجب`);
      }

      // بعد انتهاء A يجب أن يتحرر القفل وتنجح محاولة B
      const after = await run(attemptSql);
      if (!after.ok) {
        fail('محاولة بعد تحرر القفل ما زالت مرفوضة:', JSON.stringify(after.data).slice(0, 500));
      } else {
        console.log('✅ T8b: بعد انتهاء جلسة A تحرّر القفل ونجحت المحاولة (لا قفل معلّق)');
      }
    }
  } finally {
    console.log('▶ تنظيف بيانات الاختبار...');
    await run("delete from public.tenants where code = 'LKPTST';");
    const afterClean = firstRow((await run(COUNTS_SQL)).data);
    if (!afterClean) {
      console.error('❌ تعذر التحقق من العدّادات بعد التنظيف');
      process.exit(1);
    }
    const same =
      afterClean.tenants === before.tenants &&
      afterClean.warehouses === before.warehouses &&
      afterClean.products === before.products &&
      afterClean.inventory === before.inventory &&
      afterClean.fixture_tenants === 0;
    if (!same) {
      console.error('❌ عدّادات ما زالت مختلفة بعد التنظيف:', { before, after: afterClean });
      process.exit(1);
    }
    console.log('✅ عدّادات القاعدة عادت كما كانت تماماً بعد حذف بيانات الاختبار');
  }

  if (failed) process.exit(1);
  console.log('✅ اختبار الحجب الفعلي (T8) نجح');
}