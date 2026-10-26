// اختبار ترحيل المرحلة 2 داخل معاملة ثم ROLLBACK (بدون أي حفظ على الإنتاج)
// الاستخدام: node supabase/tests/run-phase2-migration-test.mjs [--apply]
//
// بدون --apply : يشغّل الترحيل داخل BEGIN ثم يُجري اختبارات التحقق ثم ROLLBACK
//               ويعيد التحقق من أن أي كائن لم يُحفظ.
// مع --apply   : يشغّل الترحيل تطبيقاً دائماً (بدون ROLLBACK).
//
// يغطي:
//   P1 قسم افتراضي (DEFAULT) + أقسام شهرية 2026+ لجدول inventory_movements
//   P2 معالج أخطاء p_proc_receive_goods: تسجيل الحدث ثم RAISE EXCEPTION
//      (باستثمار مُحفّز يفرض فشل تسجيل الحركة فعلياً، والتحقق أن الأمر لم يُحدَّث)
//   P3 سياسات القراءة لـ profiles / inventory_movements / audit_logs
//      (بما فيها قراءة فعلية بدور authenticated عبر JWT مُزيَّف داخل المعاملة)
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const token = readFileSync(join(ROOT, 'secrets/SUPABASE_ACCESS_TOKEN'), 'utf8').trim();
const MIGRATION = join(ROOT, 'supabase/migrations/202610250002_partition_logging_rls.sql');
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

const ASSERTIONS = `
do $phase2$
declare
  v_tenant uuid := gen_random_uuid();
  v_wh uuid := gen_random_uuid();
  v_wh2 uuid := gen_random_uuid();
  v_supplier uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_user2 uuid := gen_random_uuid();
  v_po uuid := gen_random_uuid();
  v_msg text := null;
  v_status text := null;
  n int := 0;
  v_src text := null;
  v_claims text;
begin
  ---------------------------------------------------------------- 1) الأقسام
  if not exists (
    select 1 from pg_inherits ih join pg_class c on c.oid = ih.inhrelid
     where ih.inhparent = 'public.inventory_movements'::regclass
       and pg_get_expr(c.relpartbound, c.oid) like '%DEFAULT%'
  ) then
    raise exception 'P1 فشل: القسم الافتراضي (DEFAULT) غير موجود';
  end if;

  if not exists (
    select 1 from pg_inherits ih join pg_class c on c.oid = ih.inhrelid
     where ih.inhparent = 'public.inventory_movements'::regclass
       and c.relname = 'inventory_movements_' || to_char(now(), 'YYYY_MM')
  ) then
    raise exception 'P1 فشل: لا يوجد قسم للشهر الحالي';
  end if;

  -- حركة بتاريخ مستقبلي (2027) وحركة قديمة (2025-08) تقبلان دون توقف
  begin
    insert into public.inventory_movements (tenant_id, warehouse_id, product_id, movement_type, quantity, created_at, notes)
    values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'receipt', 1, '2027-03-10 10:00:00+00', 'phase2-future-dry-run');
    insert into public.inventory_movements (tenant_id, warehouse_id, product_id, movement_type, quantity, created_at, notes)
    values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'receipt', 1, '2025-08-15 10:00:00+00', 'phase2-past-dry-run');
  exception when others then
    raise exception 'P1 فشل: رفض السجل حركة خارج الأقسام (%)', SQLERRM;
  end;

  ---------------------------------------------------------------- 2) الدالة
  select prosrc into v_src from pg_proc where proname = 'p_proc_receive_goods';
  if v_src is null then raise exception 'P2 فشل: الدالة p_proc_receive_goods غير موجودة'; end if;
  if v_src not like '%inventory_movement_failed%' then
    raise exception 'P2 فشل: الدالة لا تسجّل الحدث في audit_logs';
  end if;
  if v_src not like '%raise exception ''فشل ترحيل حركة الاستلام%' then
    raise exception 'P2 فشل: الدالة لا ترفع استثناءً بعد فشل التسجيل';
  end if;
  if v_src like '%values (v_tenant, p_user_id, v_wh, ''inventory_movement'', ''inventory_movements'', v_product%' then
    raise exception 'P2 فشل: المعالج القديم الصامت (تسجيل كحركة ناجحة) ما زال موجوداً';
  end if;

  ---------------------------------------------------------------- 3) السياسات
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_read_warehouse_scope'
  ) then
    raise exception 'P3 فشل: سياسة قراءة profiles غير موجودة';
  end if;

  if exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'Super admins can view all profiles'
  ) then
    raise exception 'P3 فشل: السياسة المعطوبة على auth.users ما زالت موجودة';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_logs'
      and policyname = 'app_warehouse_scope' and qual not like '%current_setting%'
  ) then
    raise exception 'P3 فشل: سياسة audit_logs ما زالت تعتمد على GUC مباشرة';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'inventory_movements'
      and policyname = 'app_warehouse_scope' and qual like '%wms_ctx_warehouse_id%'
  ) then
    raise exception 'P3 فشل: سياسة inventory_movements لا تستخدم سياق المستخدم';
  end if;

  if to_regprocedure('public.wms_context()') is null then
    raise exception 'P3 فشل: دالة wms_context غير موجودة';
  end if;

  if (select public.wms_context()->>'authenticated') <> 'false' then
    raise exception 'P3 فشل: wms_context ترجع authenticated=true بدون جلسة';
  end if;

  ---------------------------------------------------------------- 4) سلوك المعالج (فشل فعلي)
  create or replace function public._phase2_raise() returns trigger
  language plpgsql as $trig$
  begin
    raise exception 'فرض فشل تسجيل الحركة (اختبار المرحلة 2)';
  end;
  $trig$;

  insert into public.tenants (id, name, name_ar, code, email, country, is_active)
    values (v_tenant, 'PHASE2 TEST', 'اختبار المرحلة 2', 'PH2T', 'phase2@example.com', 'EG', true);
  insert into public.warehouses (id, tenant_id, name, code, is_main, is_active)
    values (v_wh, v_tenant, 'مخزن المرحلة 2', 'P2W', true, true);
  insert into public.warehouses (id, tenant_id, name, code, is_main, is_active)
    values (v_wh2, v_tenant, 'مخزن المرحلة 2 (ب)', 'P2X', false, true);
  insert into public.users (id, tenant_id, email, password_hash, first_name, last_name)
    values (v_user, v_tenant, 'phase2-a-' || v_user || '@example.org', 'not-a-real-hash', 'Phase2', 'UserA');
  insert into public.users (id, tenant_id, email, password_hash, first_name, last_name)
    values (v_user2, v_tenant, 'phase2-b-' || v_user2 || '@example.org', 'not-a-real-hash', 'Phase2', 'UserB');
  insert into public.profiles (id, full_name, role) values (v_user, 'مدير اختبار المرحلة 2', 'manager');
  insert into public.profiles (id, full_name, role) values (v_user2, 'مستخدم آخر المخزن', 'viewer');
  insert into public.user_warehouses (user_id, warehouse_id, tenant_id, is_default)
    values (v_user, v_wh, v_tenant, true);
  insert into public.user_warehouses (user_id, warehouse_id, tenant_id, is_default)
    values (v_user2, v_wh2, v_tenant, true);
  insert into public.suppliers (id, tenant_id, warehouse_id, name, code)
    values (v_supplier, v_tenant, v_wh, 'مورد المرحلة 2', 'P2S');
  insert into public.products (id, tenant_id, warehouse_id, name, name_ar, sku, unit_of_measure, barcode)
    values (v_product, v_tenant, v_wh, 'Phase2 Product', 'منتج المرحلة 2', 'SKU-PH2-1', 'box', '6221000000099');
  insert into public.purchase_orders (id, tenant_id, supplier_id, warehouse_id, order_number, order_date, status, total_amount)
    values (v_po, v_tenant, v_supplier, v_wh, 'PO-FORCE-HANDLER-PH2', current_date, 'approved', 100);
  insert into public.purchase_order_items (purchase_order_id, product_id, quantity, unit_price)
    values (v_po, v_product, 50, 2);

  -- مُحفّز يفرض فشل تسجيل الحركة (يدخل المسار نفسه الذي كان يبتلع الخطأ)
  create trigger phase2_force_fail before insert on public.inventory_movements
    for each row when (new.notes like '%FORCE-HANDLER%')
    execute function public._phase2_raise();

  begin
    perform public.p_proc_receive_goods(
      v_po,
      jsonb_build_array(jsonb_build_object(
        'product_id', v_product,
        'batch_number', 'PH2B1',
        'expiry_date', (current_date + 30)::text,
        'quantity_received', 10,
        'unit_cost', 2
      )),
      'اختبار المرحلة 2',
      v_user,
      'GR-PH2-TEST'
    );
    raise exception 'P2 فشل: تم قبول الترحيل رغم فشل تسجيل الحركة (لا يزال يبتلع الخطأ)';
  exception
    when raise_exception then
      if sqlerrm like 'P2 فشل:%' then raise; end if;
      v_msg := sqlerrm;
  end;

  if v_msg is null or v_msg not like '%فشل ترحيل حركة الاستلام%' then
    raise exception 'P2 فشل: رسالة الخطأ غير واضحة (%)', coalesce(v_msg, 'null');
  end if;
  if v_msg not like '%PO-FORCE-HANDLER-PH2%' then
    raise exception 'P2 فشل: رسالة الخطأ لا تذكر أمر الشراء (%)', v_msg;
  end if;

  select status into v_status from public.purchase_orders where id = v_po;
  if v_status <> 'approved' then
    raise exception 'P2 فشل: تغيّرت حالة أمر الشراء إلى % رغم فشل الترحيل', v_status;
  end if;
  if exists (select 1 from public.goods_receipts where purchase_order_id = v_po) then
    raise exception 'P2 فشل: أُنشئ مستند استلام رغم فشل الترحيل';
  end if;
  if exists (select 1 from public.inventory_movements where warehouse_id = v_wh and notes like '%FORCE-HANDLER%') then
    raise exception 'P2 فشل: حركة مسجّلة رغم فشل التسجيل';
  end if;

  ---------------------------------------------------------------- 5) قراءة فعلية بدور authenticated
  insert into public.inventory_movements (tenant_id, warehouse_id, product_id, movement_type, quantity, notes)
    values (v_tenant, v_wh, v_product, 'receipt', 5, 'phase2-row-wh-a');
  insert into public.inventory_movements (tenant_id, warehouse_id, product_id, movement_type, quantity, notes)
    values (v_tenant, v_wh2, v_product, 'receipt', 7, 'phase2-row-wh-b');

  begin
    execute 'set local role authenticated';
    v_claims := json_build_object('sub', v_user, 'role', 'authenticated', 'email', 'phase2@example.org')::text;
    execute format('set local request.jwt.claims = %L', v_claims);

    select count(*) into n from public.profiles where id = v_user;
    if n <> 1 then
      raise exception 'P3 فشل: المستخدم لا يقرأ ملفه الشخصي (قرأ %)', n;
    end if;

    select count(*) into n from public.profiles where id = v_user2;
    if n <> 0 then
      raise exception 'P3 فشل: تسريب ملفات مستخدمي مخزن آخر (% صفوف)', n;
    end if;

    select count(*) into n from public.inventory_movements where warehouse_id = v_wh;
    if n < 1 then
      raise exception 'P3 فشل: قراءة صفرية لحركات مخزني (0 صف) — المشكلة التي كانت مستهدفة';
    end if;

    select count(*) into n from public.inventory_movements where warehouse_id = v_wh2;
    if n <> 0 then
      raise exception 'P3 فشل: تسريب حركات مخزن آخر (% صفوف)', n;
    end if;
  end;

  execute 'reset role';
  execute 'reset request.jwt.claims';

  raise notice '✅ جميع اختبارات المرحلة 2 نجحت';
end $phase2$;
`;

const STATE_SQL = `select
  (select count(*) from pg_inherits ih join pg_class c on c.oid = ih.inhrelid
    where ih.inhparent = 'public.inventory_movements'::regclass) as partition_count,
  (select count(*) from pg_policies where schemaname = 'public'
    and tablename in ('profiles','inventory_movements','audit_logs')) as policy_count,
  (select count(*) from pg_proc where proname in ('wms_context','wms_is_member_warehouse','wms_same_warehouse_user')) as helper_fn_count,
  (select prosrc like '%inventory_movement_failed%' from pg_proc where proname = 'p_proc_receive_goods') as fn_patched`;

const ALLOWED = process.argv.includes('--apply');

globalThis.__preState = null;
if (!ALLOWED) {
  const pre = await run(STATE_SQL);
  if (!pre.ok) {
    console.error('❌ تعذر قراءة الحالة قبل الاختبار:', JSON.stringify(pre.data).slice(0, 800));
    process.exit(1);
  }
  globalThis.__preState = pre.data && pre.data[0];
}

const migrationSql = readFileSync(MIGRATION, 'utf8');

if (ALLOWED) {
  // 1) تطبيق الترحيل وحده (معاملة واحدة تُعتمد)
  console.log('▶ تطبيق ترحيل المرحلة 2 على الإنتاج...');
  const applied = await run(migrationSql);
  if (!applied.ok) {
    console.error('❌ فشل التطبيق:', applied.status);
    console.error(JSON.stringify(applied.data, null, 1).slice(0, 6000));
    process.exit(1);
  }

  // 2) اختبارات التحقق داخل معاملة ثم ROLLBACK — حتى لا تبقى بيانات اختبار في الإنتاج
  console.log('▶ التحقق من الترحيل المُطبَّق داخل معاملة ثم ROLLBACK...');
  const verified = await run('BEGIN;\n' + ASSERTIONS + '\nROLLBACK;\n');
  if (!verified.ok) {
    console.error('❌ فشل التحقق:', verified.status);
    console.error(JSON.stringify(verified.data, null, 1).slice(0, 6000));
    process.exit(1);
  }
  console.log('الاستجابة:', JSON.stringify(verified.data).slice(0, 1200));
  console.log('✅ طُبّق الترحيل واجتاز اختبارات التحقق — ولا توجد بيانات اختبار محفوظة في الإنتاج');
  process.exit(0);
}

const sql = 'BEGIN;\n' + migrationSql + '\n' + ASSERTIONS + '\nROLLBACK;\n';

console.log('▶ تشغيل ترحيل المرحلة 2 داخل معاملة ثم ROLLBACK...');
const res = await run(sql);

if (!res.ok) {
  console.error('❌ فشل:', res.status);
  console.error(typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 1).slice(0, 6000));
  process.exit(1);
}
console.log('الاستجابة:', JSON.stringify(res.data).slice(0, 1500));

const post = await run(STATE_SQL);
const row = post.data && post.data[0];
const pre = globalThis.__preState;
if (!row || !pre) {
  console.error('❌ تعذر التحقق من حالة القاعدة بعد ROLLBACK:', JSON.stringify(post.data, null, 1).slice(0, 1000));
  process.exit(1);
}
if (JSON.stringify(row) !== JSON.stringify(pre)) {
  console.error('❌ ROLLBACK لم يُلغي كل التغييرات:', { before: pre, after: row });
  process.exit(1);
}
console.log('✅ نجاح: الترحيل يعمل داخل معاملة ويلغي كلياً عند ROLLBACK (لا حفظ على الإنتاج)');
console.log('✅ جميع اختبارات المرحلة 2 نجحت (dry-run)');
