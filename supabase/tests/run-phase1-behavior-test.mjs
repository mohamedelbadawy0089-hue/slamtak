// اختبارات سلوك المرحلة 1 (الاستلام والمخزون) — كلها داخل معاملة واحدة ثم ROLLBACK
// الاستخدام: node supabase/tests/run-phase1-behavior-test.mjs
//
// تغطّي: إنشاء مستند الاستلام، تحقّق البنود، الترحيل الذري، منع التكرار،
//        منع الصلاحية المنتهية والكميات غير الصالحة، تحديث أمر الشراء،
//        السجل غير القابل للتعديل، قيود المخزون، عزل بيانات المخازن.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const token = readFileSync(join(ROOT, 'secrets/SUPABASE_ACCESS_TOKEN'), 'utf8').trim();
const API = 'https://api.supabase.com/v1/projects/iksjhjxwphmvthryfeae/database/query';

async function run(query) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = [{ raw: text }]; }
  return { ok: res.ok, status: res.status, data };
}

const EXPECTED = [
  'T01 إنشاء مستند استلام مفتوح من أمر الشراء',
  'T02 لا تكرار: إعادة الإنشاء تعيد نفس المستند المفتوح',
  'T03 رفض كمية تتجاوز المتبقي في أمر الشراء',
  'T04 رفض تجميع كميات يتجاوز الصالحية لصنف واحد',
  'T05 رفض استلام دفعة منتهية الصلاحية',
  'T06 رفض كمية غير صحيحة',
  'T07 رفض صنف غير موجود في أمر الشراء',
  'T08 بنود صحيحة: صنف واحد بتشغيلتين 40 + 60',
  'T09 الترحيل الذري: مخزون + سجل مربوط بالمستند',
  'T10 منع الترحيل المزدوج',
  'T11 منع إلغاء مستند مرحّل',
  'T12 منع الاستلام على أمر شراء منتهٍ',
  'T13 السجل يرفض التعديل',
  'T14 السجل يرفض الحذف',
  'T15 قيد المخزون يرفض السالب وخرق التوازن',
  'T16 عزل المخازن: قراءة المخزون محصورة في مخزن المستخدم',
  'T17 عزل المخازن: مستخدم آخر لا يترحيل على مستند المخزن الأول',
  'T18 قراءة RPC مفلترة حسب مخزن المستخدم',
  'T19 استلام جزئي يبقي أمر الشراء partially_received',
  'T20 إنشاء صنف يُنسب لمخزن ومؤسسة المستخدم',
  'T21 رفض باركود مستخدم لصنف آخر',
  'T22 قراءة قائمة الأصناف مفلترة بمخزن المستخدم',
];

const SQL = `
begin;
drop table if exists public._wms_test_results;
create table public._wms_test_results (label text not null);

-- مفاتيح أجنبية تشير إلى auth.users — نزيلها مؤقتاً داخل المعاملة فقط
-- (تُستعاد تلقائياً عند ROLLBACK) لأن اختبارات الوحدة تستخدم معرّفات مستخدمين وهميين
do $fk$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass::text as tbl
      from pg_constraint c
     where c.contype = 'f'
       and (c.confrelid = 'auth.users'::regclass or c.confrelid = 'users'::regclass)
       and c.connamespace = 'public'::regnamespace
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $fk$;

create or replace function public._ok(cond boolean, label text)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if cond then
    insert into public._wms_test_results values (label);
  else
    raise exception 'فشل الاختبار: %', label;
  end if;
end $fn$;

create or replace function public._expect_error(p_sql text, p_needle text, label text)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  execute p_sql;
  raise exception 'فشل الاختبار [%]: لم يُرفض التنفيذ وهو متوقع أن يُرفض', label;
exception
  when others then
    if sqlerrm like 'فشل الاختبار%' then raise; end if;
    if position(p_needle in sqlerrm) = 0 then
      raise exception 'فشل الاختبار [%]: رسالة الخطأ «%» لا تحتوي على «%»', label, sqlerrm, p_needle;
    end if;
    insert into public._wms_test_results values (label);
end $fn$;

-- (لا تُستخدم دوال مساعدة هنا: تبديل الدور يتم داخل كتلة DO مباشرة لأن
--  PostgreSQL يمنع SET ROLE داخل دالة SECURITY DEFINER)

do $body$
declare
  v_tenant   uuid := gen_random_uuid();
  v_tenant2  uuid := gen_random_uuid();
  v_wh_a     uuid := gen_random_uuid();
  v_wh_b     uuid := gen_random_uuid();
  v_user_a   uuid := gen_random_uuid();
  v_user_b   uuid := gen_random_uuid();
  v_supplier uuid := gen_random_uuid();
  v_product  uuid := gen_random_uuid();
  v_product2 uuid := gen_random_uuid();
  v_po       uuid := gen_random_uuid();
  v_po2      uuid := gen_random_uuid();
  v_gr       uuid;
  v_gr2      uuid;
  v_res      jsonb;
  v_val      text;
begin
  ------------------------------------------------------------------ بيانات الاختبار
  insert into public.tenants (id, name, name_ar, code, email, country, is_active)
  values (v_tenant, 'WMS TEST A', 'WMS اختبار أ', 'WMSTA', 'wmstest-a@example.com', 'EG', true);
  insert into public.tenants (id, name, name_ar, code, email, country, is_active)
  values (v_tenant2, 'WMS TEST B', 'WMS اختبار ب', 'WMSTB', 'wmstest-b@example.com', 'EG', true);

  insert into public.warehouses (id, tenant_id, name, code, is_main, is_active)
  values (v_wh_a, v_tenant, 'مخزن اختبار أ', 'TWA', true, true);
  insert into public.warehouses (id, tenant_id, name, code, is_main, is_active)
  values (v_wh_b, v_tenant, 'مخزن اختبار ب', 'TWB', false, true);

  insert into public.profiles (id, full_name, role) values (v_user_a, 'مستخدم أ', 'manager');
  insert into public.profiles (id, full_name, role) values (v_user_b, 'مستخدم ب', 'viewer');

  insert into public.user_warehouses (user_id, warehouse_id, tenant_id, is_default)
  values (v_user_a, v_wh_a, v_tenant, true);
  insert into public.user_warehouses (user_id, warehouse_id, tenant_id, is_default)
  values (v_user_b, v_wh_b, v_tenant, true);

  insert into public.suppliers (id, tenant_id, warehouse_id, name, code)
  values (v_supplier, v_tenant, v_wh_a, 'مورد الاختبار', 'SUPT');

  insert into public.products (id, tenant_id, warehouse_id, name, name_ar, sku, unit_of_measure, barcode)
  values (v_product, v_tenant, v_wh_a, 'Paracetamol 500mg', 'باراسيتامول 500 مجم', 'SKU-TEST-1', 'box', '6221000000001');
  insert into public.products (id, tenant_id, warehouse_id, name, name_ar, sku, unit_of_measure, barcode)
  values (v_product2, v_tenant, v_wh_a, 'Amoxicillin 500mg', 'أموكسيسيلين 500 مجم', 'SKU-TEST-2', 'box', '6221000000002');

  -- شجرة حسابات للمؤسسة التجريبية (لاختبار قيد المحاسبة عند الاستلام الكامل)
  insert into public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, is_active)
  values (v_tenant, '120', 'Inventory', 'المخزون', 'asset', true);
  insert into public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, is_active)
  values (v_tenant, '220', 'Accounts Payable', 'الدائنون', 'liability', true);

  insert into public.purchase_orders (id, tenant_id, supplier_id, warehouse_id, order_number, order_date, status, total_amount)
  values (v_po, v_tenant, v_supplier, v_wh_a, 'PO-TEST-1', current_date, 'approved', 1050);
  insert into public.purchase_order_items (purchase_order_id, product_id, quantity, unit_price)
  values (v_po, v_product, 100, 10.5);

  insert into public.purchase_orders (id, tenant_id, supplier_id, warehouse_id, order_number, order_date, status, total_amount)
  values (v_po2, v_tenant, v_supplier, v_wh_a, 'PO-TEST-2', current_date, 'approved', 500);
  insert into public.purchase_order_items (purchase_order_id, product_id, quantity, unit_price)
  values (v_po2, v_product2, 100, 5);

  ------------------------------------------------------------------ T01/T02
  select public.wms_gr_create(v_po, null, 'استلام تجريبي', v_user_a) into v_res;
  v_gr := (v_res->>'receipt_id')::uuid;
  perform public._ok(v_gr is not null and (v_res->>'status') = 'draft' and (v_res->>'receipt_number') is not null,
    'T01 إنشاء مستند استلام مفتوح من أمر الشراء');

  select public.wms_gr_create(v_po, null, null, v_user_a) into v_res;
  perform public._ok((v_res->>'receipt_id')::uuid = v_gr,
    'T02 لا تكرار: إعادة الإنشاء تعيد نفس المستند المفتوح');

  ------------------------------------------------------------------ T03..T07 تحقق البنود
  perform public._expect_error(
    format('select public.wms_gr_set_items(%L, %L::jsonb, %L)', v_gr,
      jsonb_build_array(jsonb_build_object('product_id', v_product, 'batch_number', 'B1',
        'expiry_date', (current_date + 30)::text, 'quantity', 150))::text, v_user_a),
    'تتجاوز المتبقي',
    'T03 رفض كمية تتجاوز المتبقي في أمر الشراء');

  perform public._expect_error(
    format('select public.wms_gr_set_items(%L, %L::jsonb, %L)', v_gr,
      jsonb_build_array(
        jsonb_build_object('product_id', v_product, 'batch_number', 'B1', 'expiry_date', (current_date + 30)::text, 'quantity', 40),
        jsonb_build_object('product_id', v_product, 'batch_number', 'B2', 'expiry_date', (current_date + 60)::text, 'quantity', 70)
      )::text, v_user_a),
    'تتجاوز المتبقي',
    'T04 رفض تجميع كميات يتجاوز الصالحية لصنف واحد');

  perform public._expect_error(
    format('select public.wms_gr_set_items(%L, %L::jsonb, %L)', v_gr,
      jsonb_build_array(jsonb_build_object('product_id', v_product, 'batch_number', 'BEX',
        'expiry_date', (current_date - 1)::text, 'quantity', 10))::text, v_user_a),
    'منتهية الصلاحية',
    'T05 رفض استلام دفعة منتهية الصلاحية');

  perform public._expect_error(
    format('select public.wms_gr_set_items(%L, %L::jsonb, %L)', v_gr,
      jsonb_build_array(jsonb_build_object('product_id', v_product, 'batch_number', 'B1',
        'expiry_date', (current_date + 30)::text, 'quantity', 0))::text, v_user_a),
    'أكبر من صفر',
    'T06 رفض كمية غير صحيحة');

  perform public._expect_error(
    format('select public.wms_gr_set_items(%L, %L::jsonb, %L)', v_gr,
      jsonb_build_array(jsonb_build_object('product_id', gen_random_uuid(), 'batch_number', 'B9',
        'expiry_date', (current_date + 30)::text, 'quantity', 5))::text, v_user_a),
    'غير موجود في أمر الشراء',
    'T07 رفض صنف غير موجود في أمر الشراء');

  ------------------------------------------------------------------ T08
  select public.wms_gr_set_items(v_gr, jsonb_build_array(
      jsonb_build_object('product_id', v_product, 'batch_number', 'B1', 'expiry_date', (current_date + 30)::text, 'quantity', 40),
      jsonb_build_object('product_id', v_product, 'batch_number', 'B2', 'expiry_date', (current_date + 60)::text, 'quantity', 60)
    ), v_user_a) into v_res;
  perform public._ok((v_res->>'items')::int = 2,
    'T08 بنود صحيحة: صنف واحد بتشغيلتين 40 + 60');

  ------------------------------------------------------------------ T09 الترحيل الذري
  select public.wms_gr_post(v_gr, v_user_a) into v_res;
  perform public._ok(
    (v_res->>'status') = 'posted'
    and (v_res->>'total_quantity')::int = 100
    and exists (select 1 from public.inventory i
                 where i.warehouse_id = v_wh_a and i.product_id = v_product
                   and i.batch_number = 'B1' and i.available_quantity = 40 and i.quantity = 40)
    and exists (select 1 from public.inventory i
                 where i.warehouse_id = v_wh_a and i.product_id = v_product
                   and i.batch_number = 'B2' and i.available_quantity = 60 and i.quantity = 60)
    and (select count(*) from public.inventory_movements m
          where m.reference_type = 'goods_receipt' and m.reference_id = v_gr) = 2
    and not exists (select 1 from public.inventory_movements m
                     where m.reference_id = v_gr
                       and (m.created_by is distinct from v_user_a
                            or m.warehouse_id is distinct from v_wh_a
                            or m.movement_type is distinct from 'receipt'))
    and (select status from public.goods_receipts where id = v_gr) = 'posted'
    and (select posted_at from public.goods_receipts where id = v_gr) is not null
    and (select received_quantity from public.purchase_order_items
          where purchase_order_id = v_po and product_id = v_product) = 100
    and (select status from public.purchase_orders where id = v_po) = 'received',
    'T09 الترحيل الذري: مخزون + سجل مربوط بالمستند');

  ------------------------------------------------------------------ T10..T12
  perform public._expect_error(
    format('select public.wms_gr_post(%L, %L)', v_gr, v_user_a),
    'تم ترحيل مستند الاستلام',
    'T10 منع الترحيل المزدوج');

  perform public._expect_error(
    format('select public.wms_gr_cancel(%L, %L)', v_gr, v_user_a),
    'لا يمكن إلغاء مستند مرحّل',
    'T11 منع إلغاء مستند مرحّل');

  perform public._expect_error(
    format('select public.wms_gr_create(%L, null, null, %L)', v_po, v_user_a),
    'لا يمكن الاستلام على أمر بحالة',
    'T12 منع الاستلام على أمر شراء منتهٍ');

  ------------------------------------------------------------------ T13/T14
  perform public._expect_error(
    'update public.inventory_movements set quantity = 999 where reference_id = ' || quote_literal(v_gr::text),
    'غير قابل للتعديل',
    'T13 السجل يرفض التعديل');

  perform public._expect_error(
    'delete from public.inventory_movements where reference_id = ' || quote_literal(v_gr::text),
    'غير قابل للتعديل',
    'T14 السجل يرفض الحذف');

  ------------------------------------------------------------------ T15 قيود المخزون
  perform public._expect_error(
    'insert into public.inventory (tenant_id, warehouse_id, product_id, batch_number, expiry_date, quantity, available_quantity) values ('
      || quote_literal(v_tenant::text) || '::uuid, ' || quote_literal(v_wh_a::text) || '::uuid, '
      || quote_literal(v_product::text) || '::uuid, ''BNEG'', current_date + 10, -5, -5)',
    'ck_inventory_bucket_balance',
    'T15 قيد المخزون يرفض السالب وخرق التوازن');

  perform public._expect_error(
    'update public.inventory set available_quantity = quantity + 1 where warehouse_id = '
      || quote_literal(v_wh_a::text) || '::uuid and batch_number = ''B1''',
    'ck_inventory_bucket_balance',
    'T15 قيد المخزون يرفض السالب وخرق التوازن');

  ------------------------------------------------------------------ T16/T17/T18 العزل
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_b::text)::text, true);
  set local role authenticated;
  execute 'select count(*)::text from public.inventory' into v_val;
  reset role;
  if v_val <> '0' then
    raise exception 'فشل الاختبار: T16 — المستخدم ب رأى % صفوف من مخزن آخر', v_val;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user_a::text)::text, true);
  set local role authenticated;
  execute 'select count(*)::text from public.inventory' into v_val;
  reset role;
  if v_val <> '2' then
    raise exception 'فشل الاختبار: T16 — المستخدم أ رأى % صفوف بدلاً من 2', v_val;
  end if;
  insert into public._wms_test_results
  values ('T16 عزل المخازن: قراءة المخزون محصورة في مخزن المستخدم');

  perform set_config('request.jwt.claims', json_build_object('sub', v_user_b::text)::text, true);
  set local role authenticated;
  begin
    execute format('select public.wms_gr_post(%L)', v_gr);
    reset role;
    raise exception 'فشل الاختبار: T17 — تم السماح بالترحيل لمستخدم غير مخول';
  exception
    when others then
      reset role;
      if sqlerrm like 'فشل الاختبار%' then raise; end if;
      if position('ليس لديك صلاحية لهذا المخزن' in sqlerrm) = 0 then
        raise exception 'فشل الاختبار: T17 — رسالة خطأ غير متوقعة: %', sqlerrm;
      end if;
  end;
  insert into public._wms_test_results
  values ('T17 عزل المخازن: مستخدم آخر لا يترحيل على مستند المخزن الأول');

  perform set_config('request.jwt.claims', json_build_object('sub', v_user_a::text)::text, true);
  set local role authenticated;
  execute 'select coalesce((public.wms_stock_list(null, null, 100, 0, null)) ->> ''total'', ''0'')' into v_val;
  reset role;
  if v_val <> '2' then
    raise exception 'فشل الاختبار: T18 — إجمالي المخزون المعروض % بدلاً من 2', v_val;
  end if;
  insert into public._wms_test_results
  values ('T18 قراءة RPC مفلترة حسب مخزن المستخدم');

  ------------------------------------------------------------------ T19 استلام جزئي
  select (public.wms_gr_create(v_po2, null, null, v_user_a) ->> 'receipt_id')::uuid into v_gr2;
  select public.wms_gr_set_items(v_gr2, jsonb_build_array(
      jsonb_build_object('product_id', v_product2, 'batch_number', 'BP1',
        'expiry_date', (current_date + 90)::text, 'quantity', 30)
    ), v_user_a) into v_res;
  select public.wms_gr_post(v_gr2, v_user_a) into v_res;
  perform public._ok(
    (select status from public.purchase_orders where id = v_po2) = 'partially_received'
    and (select received_quantity from public.purchase_order_items
          where purchase_order_id = v_po2 and product_id = v_product2) = 30,
    'T19 استلام جزئي يبقي أمر الشراء partially_received');

  ------------------------------------------------------------------ T20/T21 الأصناف
  select public.wms_product_create('صنف جديد تجريبي', 'صنف تجريبي', '6221000009999', 'box', 24, 5, 50, v_user_a)
    into v_res;
  perform public._ok(
    (v_res->>'id') is not null
    and (select warehouse_id from public.products where id = (v_res->>'id')::uuid) = v_wh_a
    and (select tenant_id from public.products where id = (v_res->>'id')::uuid) = v_tenant,
    'T20 إنشاء صنف يُنسب لمخزن ومؤسسة المستخدم');

  perform public._expect_error(
    format('select public.wms_product_create(''صنف آخر'', null, ''6221000000001'', null, null, null, null, %L)', v_user_a),
    'مستخدم لصنف آخر',
    'T21 رفض باركود مستخدم لصنف آخر');

  ------------------------------------------------------------------ T22 قراءة الأصناف
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_a::text)::text, true);
  set local role authenticated;
  execute 'select jsonb_array_length(public.wms_product_list(null, 100, null))::text' into v_val;
  reset role;
  if v_val <> '3' then
    raise exception 'فشل الاختبار: T22 — عدد الأصناف المعروضة % بدلاً من 3', v_val;
  end if;
  insert into public._wms_test_results
  values ('T22 قراءة قائمة الأصناف مفلترة بمخزن المستخدم');

exception
  when others then
    -- إعادة كل ما جرى داخل الكتلة ثم نسجّل سبب الفشل
    reset role;
    insert into public._wms_test_results values ('FAILED: ' || SQLERRM);
end $body$;

select label from public._wms_test_results order by label;

rollback;

drop table if exists public._wms_test_results;
drop function if exists public._ok(boolean, text);
drop function if exists public._expect_error(text, text, text);
`;

const FK_CHECK = `select count(*) as fk_ok from pg_constraint
  where contype = 'f' and (confrelid = 'auth.users'::regclass or confrelid = 'users'::regclass)
    and connamespace = 'public'::regnamespace`;

const preFk = await run(FK_CHECK);
globalThis.__preFks = Number((preFk.data && preFk.data[0] && preFk.data[0].fk_ok) ?? -1);
if (!preFk.ok || globalThis.__preFks < 1) {
  console.error('❌ تعذر قراءة المفاتيح الأجنبية قبل الاختبار:', JSON.stringify(preFk.data).slice(0, 500));
  process.exit(1);
}

const res = await run(SQL);
if (!res.ok) {
  console.error('❌ فشل تنفيذ الاختبارات:', res.status);
  console.error(typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 1).slice(0, 4000));
  process.exit(1);
}

const rows = Array.isArray(res.data) ? res.data : [];
const got = rows.map((r) => r && r.label).filter(Boolean);

const failed = got.filter((g) => g.startsWith('FAILED:'));
if (failed.length) {
  console.error('❌ ' + failed.join('\n'));
  process.exit(1);
}

const missing = EXPECTED.filter((e) => !got.includes(e));
if (missing.length) {
  console.error('❌ اختبارات لم تُنفَّذ:', missing);
  process.exit(1);
}

console.log('✅ نجحت اختبارات السلوك (' + got.length + '/' + EXPECTED.length + '):');
got.forEach((g) => console.log('   ✓ ' + g));

const fk = await run(FK_CHECK);
const fkRow = fk.data && fk.data[0];
if (!fkRow || Number(fkRow.fk_ok) !== (globalThis.__preFks ?? -1)) {
  console.error('❌ مفاتيح المستخدمين الأجنبية لم تستعد بعد ROLLBACK:', { before: globalThis.__preFks, after: fkRow });
  process.exit(1);
}
console.log('✅ استُعيدت قيود المخزن بعد ROLLBACK — لا تغييرات محفوظة على الإنتاج');
console.log('✅ تمت كل الاختبارات داخل معاملة واحدة ثم ROLLBACK — لا بيانات محفوظة على الإنتاج');
