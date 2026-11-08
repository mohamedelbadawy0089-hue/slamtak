# 22 — سياسات RLS واختبار العزل

> **الغرض:** تحويل عزيم `11` من كتالوج إلى سياسات قابلة للتنفيذ، مع **مجموعة اختبار عزل تُشغَّل حرفيًا** وتفشل بصوت عالٍ عند أي تسريب. هذه الوثيقة هي مُدخل Gate B الأول.
> **يعتمد على:** [`21-reference-schema.md`](21-reference-schema.md) — يجب تنفيذها أولًا.
> **قاعدة حاكمة:** أي جدول بلا سياسة = ممنوع (Fail closed). لا توجد سياسة `USING (true)` على أي جدول تجاري.

## 1. الأدوار

| الدور | الاستخدام | الصفات |
|---|---|---|
| `slamtak_owner` | DDL/هجرات فقط | صلاحيات DDL كاملة، **بلا مِلْكية جداول** — المِلْكية تبقى لمالك القاعدة (`postgres`) لأن نقلها يكسر مسار الهجرات |
| `slamtak_app` | وقت التشغيل من NestJS | `NOBYPASSRLS`، بلا ملكية جداول |
| `slamtak_platform` | لوحة المنصة | صلاحية على `platform` فقط، **صفر** على `public` |
| `slamtak_ops` | مهام تشغيلية (تسوية ليلية، تمرين استعادة) | **صفر** جداول، `EXECUTE` على أدوات التحقق فقط |

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'slamtak_app') THEN
    CREATE ROLE slamtak_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

-- في الإنتاج: GRANT slamtak_app TO <login_role>;  (هنا للاختبار المحلي)
GRANT slamtak_app TO CURRENT_USER;

GRANT USAGE ON SCHEMA public, app TO slamtak_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO slamtak_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO slamtak_app;

-- كتالوج الصلاحيات للقراءة فقط
REVOKE INSERT, UPDATE, DELETE ON permissions FROM slamtak_app;
-- سجلات لا تُحذف أبدًا
REVOKE DELETE ON stock_movements, audit_logs, prices_history FROM slamtak_app;
-- الأرصدة لا تُعدَّل مباشرة: التعديل يتم فقط عبر Trigger الدالة (SECURITY DEFINER).
-- هذا يحوّل "لا تعديل رصيد دون حركة موثقة" من سياسة إلى امتياز مفقود.
REVOKE UPDATE, DELETE ON stock_batches FROM slamtak_app;
REVOKE UPDATE, DELETE ON stock_movements FROM slamtak_app;
-- مخطط المنصة: لا شيء إطلاقًا
REVOKE ALL ON SCHEMA platform FROM slamtak_app;
```

**الدور التشغيلي `slamtak_ops`.** المهمة الليلية وتمرين الاستعادة يحتاجان قراءة **كل** المخازن، وهذا بالضبط ما لا يجوز أن يملكه دور التطبيق. الحل: دور ثالث لا يملك جدولًا واحدًا، ويُمنح `EXECUTE` على أدوات التحقق فقط — فحتى لو سُرِّب اعتماده لا يقرأ صنفًا واحدًا.

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'slamtak_ops') THEN
    CREATE ROLE slamtak_ops NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

GRANT slamtak_ops TO CURRENT_USER;   -- للاختبار المحلي؛ في الإنتاج: GRANT slamtak_ops TO <job_login_role>;

GRANT USAGE ON SCHEMA app TO slamtak_ops;
GRANT EXECUTE ON FUNCTION app.verify_ledger_consistency() TO slamtak_ops;
-- لا GRANT على public إطلاقًا. ولو أُضيف SELECT سهوًا فسيرى صفر صفوف:
-- RLS مفعّلة بـ FORCE ولا سياسة واحدة لهذا الدور (Fail closed).
```

**دور الهجرة `slamtak_owner`.** PostgreSQL لا يمنح صلاحية DDL عبر العضوية، والمِلْكية وحدها هي التي تمنحها. لذلك: المِلْكية تبقى لمالك القاعدة (هو ما يتصل به مسار الهجرات)، والدور يأخذ كل ما يحتاجه للـDDL والتصحيح دون أن يملك. لا عضوية له في `CURRENT_USER`: هو دور بلا `LOGIN`، وتُمنح عضويته لهوية CI عند وجودها.

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'slamtak_owner') THEN
    CREATE ROLE slamtak_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE, CREATE ON SCHEMA public, app, platform TO slamtak_owner;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public TO slamtak_owner;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO slamtak_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO slamtak_owner;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA platform TO slamtak_owner;
GRANT ALL ON ALL SEQUENCES IN SCHEMA platform TO slamtak_owner;
```

**دور لوحة المنصة `slamtak_platform`.** يرى بيانات المنصة وحدها. لا `DELETE` لأن سجلات المنصة والاشتراكات append-only، و**لا `USAGE` على `app` عمدًا**: `USAGE` هناك يفتح استدعاء دوال التطبيق ومنها التزويد (`seed_tenant_roles`). لذلك التزويد يبقى لدور الهجرة/المالك، لا للوحة المنصة — وهو انحراف مقصود عن الصياغة الأولى في [`29`](29-reference-seed.md) §4.

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'slamtak_platform') THEN
    CREATE ROLE slamtak_platform NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA platform TO slamtak_platform;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA platform TO slamtak_platform;
-- لا DELETE: الاشتراكات وسجلات المنصة لا تُحذف من اللوحة.
REVOKE ALL ON SCHEMA public, app FROM slamtak_platform;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM slamtak_platform;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM slamtak_platform;
```

**`EXECUTE` الموروث لـ`PUBLIC`.** PostgreSQL يمنح `EXECUTE` لـ`PUBLIC` افتراضيًا على كل دالة جديدة، فتصبح دوال التطبيق — ومنها `apply_stock_movement` (`SECURITY DEFINER`) — قابلة للاستدعاء من أي دور، حتى `anon` عبر PostgREST. يُغلق الافتراضي ثم يُمنح الدور التطبيقي ما ينفّذه فقط. **تحذير:** دوال السياق (`current_tenant_id` وغيرها) مرجعية داخل كل سياسة RLS؛ حجبها عن `slamtak_app` يوقف كل قراءة لا العكس.

```sql
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO slamtak_app;
GRANT EXECUTE ON FUNCTION app.current_user_id() TO slamtak_app;
GRANT EXECUTE ON FUNCTION app.current_warehouse_id() TO slamtak_app;
GRANT EXECUTE ON FUNCTION app.has_permission(text) TO slamtak_app;
GRANT EXECUTE ON FUNCTION app.apply_stock_movement() TO slamtak_app;
GRANT EXECUTE ON FUNCTION app.next_document_number(uuid, text, int) TO slamtak_app;
GRANT EXECUTE ON FUNCTION app.record_login_attempt(text, inet, boolean, text) TO slamtak_app;
```

---

## 2. تفعيل RLS على كل جدول تجاري

```sql
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.relname);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        FOR ALL TO slamtak_app
        USING (tenant_id = app.current_tenant_id())
        WITH CHECK (tenant_id = app.current_tenant_id())
    $f$, r.relname);
  END LOOP;
END $$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenants
  FOR ALL TO slamtak_app
  USING (id = app.current_tenant_id())
  WITH CHECK (id = app.current_tenant_id());
```

**لماذا `FOR ALL` + `WITH CHECK` معًا؟** `USING` وحدها تمنع القراءة فقط؛ بدون `WITH CHECK` يستطيع دور التطبيق **إدراج** صف لمخزن آخر ثم لا يراه — وهو أسوأ من التسريب لأنه يفسد البيانات بصمت.

---

## 3. الجداول الاستثنائية (بلا `tenant_id`)

### 3.1 `users` — عالمي، والعزل عبر العضوية
```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_visible_to_self_and_colleagues ON users
  FOR SELECT TO slamtak_app
  USING (
    id = app.current_user_id()
    OR EXISTS (
      SELECT 1 FROM tenant_memberships m
      WHERE m.user_id = users.id
        AND m.tenant_id = app.current_tenant_id()
    )
  );
CREATE POLICY users_self_update ON users
  FOR UPDATE TO slamtak_app
  USING (id = app.current_user_id())
  WITH CHECK (id = app.current_user_id());
```

### 3.2 `sessions` / `user_mfa` — ملك المستخدم فقط
```sql
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_owner ON sessions
  FOR ALL TO slamtak_app
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());

ALTER TABLE user_mfa ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_mfa FORCE ROW LEVEL SECURITY;
CREATE POLICY mfa_owner ON user_mfa
  FOR ALL TO slamtak_app
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
```

### 3.3 `permissions` — كتالوج ثابت للقراءة فقط
```sql
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY permissions_read_all ON permissions
  FOR SELECT TO slamtak_app USING (true);
```
> الاستثناء الوحيد المسموح لـ `USING (true)`: جدول مرجعي عام لا يحمل أي بيانات عميل (أكواد الصلاحيات فقط)، وممنوع الكتابة عليه من دور التطبيق أصلًا عبر `REVOKE`.

### 3.4 `login_attempts` — يُكتب قبل وجود سياق
```sql
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts FORCE ROW LEVEL SECURITY;
-- بلا سياسة = الدور التطبيقي لا يقرأ ولا يكتب مباشرة

CREATE OR REPLACE FUNCTION app.record_login_attempt(
  p_email text, p_ip inet, p_succeeded boolean, p_reason text
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO login_attempts (email, ip, succeeded, reason)
  VALUES (p_email, p_ip, p_succeeded, p_reason)
$$;
GRANT EXECUTE ON FUNCTION app.record_login_attempt(text, inet, boolean, text) TO slamtak_app;
```

---

## 4. السجلات الملحقة (Append-only) — قراءة وإدراج فقط

### 4.1 دالة الصلاحيات (تُنشأ قبل السياسات التي تعتمد عليها)
`SECURITY DEFINER` مع `search_path` مقفول، تقرأ داخل نفس المخزن فقط، و`deny` يتغلب دائمًا.

```sql
CREATE OR REPLACE FUNCTION app.has_permission(p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
  WITH ctx AS (SELECT app.current_tenant_id() AS tid, app.current_user_id() AS uid),
  denied AS (
    SELECT 1 FROM user_permission_overrides o, ctx
    WHERE o.tenant_id = ctx.tid AND o.user_id = ctx.uid
      AND o.permission = p_permission AND o.effect = 'deny'
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM denied) THEN false
    ELSE EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.tenant_id = ur.tenant_id AND rp.role_id = ur.role_id
      CROSS JOIN ctx
      WHERE ur.tenant_id = ctx.tid AND ur.user_id = ctx.uid AND rp.permission = p_permission
    )
  END
$$;
GRANT EXECUTE ON FUNCTION app.has_permission(text) TO slamtak_app;
```

### 4.2 استبدال سياسة `FOR ALL` بسياسيتين
```sql
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_movements','prices_history','audit_logs'] LOOP
    EXECUTE format('DROP POLICY tenant_isolation ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_read ON public.%I
        FOR SELECT TO slamtak_app
        USING (tenant_id = app.current_tenant_id())
    $f$, t);
    EXECUTE format($f$
      CREATE POLICY tenant_append ON public.%I
        FOR INSERT TO slamtak_app
        WITH CHECK (tenant_id = app.current_tenant_id())
    $f$, t);
  END LOOP;
END $$;

-- التدقيق يحتاج صلاحية صريحة فوق العزل (لا يكفي أنك داخل المخزن).
-- RESTRICTIVE ضرورية: السياسات المتساهمة تُجمع بـ OR، فبدونها تكفي tenant_append وحدها.
CREATE POLICY audit_write_requires_permission ON audit_logs
  AS RESTRICTIVE FOR INSERT TO slamtak_app
  WITH CHECK (
    tenant_id = app.current_tenant_id()
    AND app.has_permission('system.audit.write')
  );
```

---

## 5. مصفوفة التغطية

| الجدول | السياسة | قراءة | إدراج | تعديل | حذف |
|---|---|---|---|---|---|
| جداول `tenant_id` (34) | `tenant_isolation` | حسب المخزن | حسب المخزن | حسب المخزن | حسب المخزن |
| `tenants` | `tenant_self` | صفّك فقط | — | صفّك | — |
| `users` | `users_visible_to_self_and_colleagues` | الذات + زملاء المخزن | — | الذات | — |
| `sessions`, `user_mfa` | `*_owner` | الذات | الذات | الذات | الذات |
| `permissions` | `permissions_read_all` | الكل | — | — | — |
| `stock_movements`, `audit_logs`, `prices_history` | `tenant_read` + `tenant_append` | حسب المخزن | حسب المخزن | ❌ | ❌ |
| `audit_logs` (إدراج) | `audit_write_requires_permission` | — | بصلاحية | — | — |
| `login_attempts` | بلا سياسة | ❌ | ❌ | ❌ | ❌ |
| `platform.*` | بلا صلاحية على المخطط | ❌ | ❌ | ❌ | ❌ |

---

## 6. مجموعة اختبار العزل (قابلة للتشغيل)

تُنفَّذ بعد `21` و`1`–`4` أعلاه. كل اختبار يُسجّل نتيجته في `app.test_results`، وأي فشل يوقف التنفيذ بخطأ صريح.

### 6.1 التهيئة
```sql
CREATE TABLE IF NOT EXISTS app.test_results (
  id serial PRIMARY KEY, test text NOT NULL, status text NOT NULL, detail text
);
TRUNCATE app.test_results;
GRANT SELECT, INSERT ON app.test_results TO slamtak_app;    -- جدول اختبار فقط، لا وجود له في الإنتاج
GRANT USAGE ON SEQUENCE app.test_results_id_seq TO slamtak_app;

INSERT INTO tenants (id, slug, name, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'alpha', 'مخزن ألفا', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'beta',  'مخزن بيتا', 'active');

-- ADR-025: مخزن واحد لكل حساب — لا فروع ولا مخزنين لكل حساب.
INSERT INTO warehouses (tenant_id, id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'مخزن ألفا الرئيسي'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000002', 'مخزن بيتا الرئيسي');

INSERT INTO storage_locations (tenant_id, id, warehouse_id, code, name, is_default) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000002', 'DEF', 'افتراضي', true),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000002', 'DEF', 'افتراضي', true);

INSERT INTO users (id, email, full_name, password_hash) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'owner@alpha.test', 'مالك ألفا', 'x'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1', 'owner@beta.test',  'مالك بيتا', 'x');

INSERT INTO tenant_memberships (tenant_id, user_id, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-0000000000b1', 'active');

INSERT INTO permissions (code, module, description, is_dangerous) VALUES
  ('system.audit.write', 'system', 'كتابة سجل التدقيق', true),
  ('inventory.adjust',   'inventory', 'تسوية مخزون', true);

INSERT INTO roles (tenant_id, id, code, name, is_system) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-0000000000d1', 'auditor', 'مدقق', true);

INSERT INTO role_permissions (tenant_id, role_id, permission) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-0000000000d1', 'system.audit.write');

INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES
  ('11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000d1');

INSERT INTO medicines (tenant_id, id, sku, trade_name_ar) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-0000000000c1', 'PAN-500', 'بانادول'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-0000000000c1', 'PAN-500', 'بانادول');

INSERT INTO batches (tenant_id, id, medicine_id, batch_no, expiry_date) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-0000000000b9',
   'aaaaaaaa-0000-0000-0000-0000000000c1', 'L1', '2028-01-01'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-0000000000b9',
   'bbbbbbbb-0000-0000-0000-0000000000c1', 'L1', '2028-01-01');
```

### 6.2 الاختبارات
```sql
SET ROLE slamtak_app;
SET app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET app.user_id   = 'aaaaaaaa-0000-0000-0000-0000000000a1';
```

**T1 — قراءة معزولة:** يرى صفّ مخزنه فقط.
```sql
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM medicines;
  IF n <> 1 THEN RAISE EXCEPTION 'T1 FAILED: رأى % صفوفًا بدل 1', n; END IF;
  INSERT INTO app.test_results (test, status) VALUES ('T1 قراءة معزولة', 'PASS');
END $$;
```

**T2 — إدراج بمخزن آخر:** مرفوض.
```sql
DO $$
BEGIN
  BEGIN
    INSERT INTO medicines (tenant_id, sku, trade_name_ar)
    VALUES ('22222222-2222-2222-2222-222222222222', 'EVIL', 'تسريب');
    RAISE EXCEPTION 'T2 FAILED: قُبل الإدراج في مخزن آخر';
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO app.test_results (test, status) VALUES ('T2 إدراج عبر المخازن', 'PASS');
  END;
END $$;
```

**T3 — تعديل `tenant_id`:** مرفوض بـ `TENANT_IMMUTABLE`.
```sql
DO $$
BEGIN
  BEGIN
    UPDATE medicines SET tenant_id = '22222222-2222-2222-2222-222222222222'
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111';
    RAISE EXCEPTION 'T3 FAILED: تغيّر tenant_id';
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO app.test_results (test, status) VALUES ('T3 ثبات المالك', 'PASS');
  END;
END $$;
```

**T4 — بلا سياق:** صفر صفوف (Fail closed).
```sql
SET app.tenant_id = '';
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM medicines;
  IF n <> 0 THEN RAISE EXCEPTION 'T4 FAILED: % صفوفًا بلا سياق', n; END IF;
  INSERT INTO app.test_results (test, status) VALUES ('T4 بلا سياق', 'PASS');
END $$;
SET app.tenant_id = '11111111-1111-1111-1111-111111111111';
```

**T5 — مخطط المنصة:** ممنوع تمامًا.
```sql
DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM platform.plans;
    RAISE EXCEPTION 'T5 FAILED: قرأ مخطط المنصة';
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO app.test_results (test, status) VALUES ('T5 مخطط المنصة', 'PASS');
  END;
END $$;
```

**T6 — صرف أكبر من الرصيد:** مرفوض.
```sql
DO $$
BEGIN
  BEGIN
    INSERT INTO stock_movements (tenant_id, warehouse_id, location_id, medicine_id, batch_id,
      movement_type, qty_delta)
    VALUES ('11111111-1111-1111-1111-111111111111',
            'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003',
            'aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000b9',
            'sale', -5);
    RAISE EXCEPTION 'T6 FAILED: قُبل رصيد سالب';
  EXCEPTION WHEN check_violation THEN
    INSERT INTO app.test_results (test, status) VALUES ('T6 منع الرصيد السالب', 'PASS');
  END;
END $$;
```

**T7 — حركة بلا سبب:** مرفوضة.
```sql
DO $$
BEGIN
  BEGIN
    INSERT INTO stock_movements (tenant_id, warehouse_id, location_id, medicine_id, batch_id,
      movement_type, qty_delta)
    VALUES ('11111111-1111-1111-1111-111111111111',
            'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003',
            'aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000b9',
            'damage', -1);
    RAISE EXCEPTION 'T7 FAILED: تسوية بلا سبب';
  EXCEPTION WHEN check_violation THEN
    INSERT INTO app.test_results (test, status) VALUES ('T7 سبب التسوية إلزامي', 'PASS');
  END;
END $$;
```

**T8 — تعديل/حذف سجل ملحق:** مرفوض.
```sql
DO $$
DECLARE n int := 0;
BEGIN
  BEGIN
    UPDATE stock_movements SET reason = 'تلاعب'
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111';
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN n := 0;  -- REVOKE UPDATE يعمل
  END;
  IF n <> 0 THEN RAISE EXCEPTION 'T8 FAILED: عُدّل % صفًا', n; END IF;
  BEGIN
    DELETE FROM stock_movements WHERE tenant_id = '11111111-1111-1111-1111-111111111111';
    RAISE EXCEPTION 'T8b FAILED: قُبل الحذف';
  EXCEPTION WHEN insufficient_privilege THEN NULL;   -- REVOKE DELETE يعمل
  END;
  INSERT INTO app.test_results (test, status) VALUES ('T8 السجلات الملحقة', 'PASS');
END $$;
```
> **ثلاث طبقات دفاع:** (1) `REVOKE UPDATE, DELETE` من `slamtak_app` — أقواها، تُفشل الجملة بـ `42501`؛ (2) غياب سياسة `UPDATE` — يجعل التحديث لا يرى صفًا (نجاح صامت بصفر صفوف)؛ (3) الـ Trigger `forbid_mutation`. الاختبار يقبل المنع بأي طبقة ويفشل فقط إذا تغيّر صف واحد.

**T9 — تدقيق بصلاحية:** يمرّ لأن الدور يملك `system.audit.write` (بعد T8 نتحقق أيضًا من المنع عند سحبها).
```sql
DO $$
BEGIN
  INSERT INTO audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id)
  VALUES ('11111111-1111-1111-1111-111111111111',
          'aaaaaaaa-0000-0000-0000-0000000000a1', 'medicine.update', 'medicine',
          'aaaaaaaa-0000-0000-0000-0000000000c1');
  INSERT INTO app.test_results (test, status) VALUES ('T9 تدقيق بصلاحية', 'PASS');
END $$;
```

**T10 — الرؤية عبر المستخدمين:** مالك ألفا لا يرى مستخدمي بيتا.
```sql
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM users;
  IF n <> 1 THEN RAISE EXCEPTION 'T10 FAILED: رأى % مستخدمين', n; END IF;
  INSERT INTO app.test_results (test, status) VALUES ('T10 عزل المستخدمين', 'PASS');
END $$;
```

**T11 — المسار الصحيح للرصيد:** استلام 10 ثم بيع 4 ⇒ 6.
```sql
DO $$
DECLARE q numeric;
BEGIN
  INSERT INTO stock_movements (tenant_id, warehouse_id, location_id, medicine_id, batch_id, movement_type, qty_delta)
  VALUES ('11111111-1111-1111-1111-111111111111',
          'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003',
          'aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000b9', 'opening', 10);

  INSERT INTO stock_movements (tenant_id, warehouse_id, location_id, medicine_id, batch_id, movement_type, qty_delta)
  VALUES ('11111111-1111-1111-1111-111111111111',
          'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003',
          'aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000b9', 'sale', -4);

  SELECT qty_on_hand INTO q FROM stock_batches
   WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
     AND batch_id  = 'aaaaaaaa-0000-0000-0000-0000000000b9';
  IF q <> 6 THEN RAISE EXCEPTION 'T11 FAILED: الرصيد % بدل 6', q; END IF;
  INSERT INTO app.test_results (test, status) VALUES ('T11 ترحيل الرصيد 10-4', 'PASS');
END $$;
```

**T13 — منع تعديل الرصيد مباشرة:** `UPDATE stock_batches` مرفوض بالامتياز نفسه.
```sql
DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    UPDATE stock_batches SET qty_on_hand = 999
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111';
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'T13 FAILED: الرصيد عُدّل مباشرة بلا حركة'; END IF;
  INSERT INTO app.test_results (test, status) VALUES ('T13 لا تعديل رصيد مباشر', 'PASS');
END $$;
```

**T12 — ترقيم المستندات:** متسلسل بلا تكرار.
```sql
DO $$
DECLARE a text; b text;
BEGIN
  a := app.next_document_number('11111111-1111-1111-1111-111111111111', 'INV', 2026);
  b := app.next_document_number('11111111-1111-1111-1111-111111111111', 'INV', 2026);
  IF a = b OR a NOT LIKE 'INV-2026-%' THEN RAISE EXCEPTION 'T12 FAILED: % / %', a, b; END IF;
  INSERT INTO app.test_results (test, status) VALUES ('T12 ترقيم المستندات', 'PASS');
END $$;
```

### 6.3 النتيجة
```sql
RESET ROLE;
SELECT test, status, COALESCE(detail, '') AS detail FROM app.test_results ORDER BY id;
```

---

**T14 — أداة اتساق الدفتر تكشف الانحراف:** صفر صفوف على بيانات سليمة، وصف واحد عند إحداث فرق يدوي.
```sql
RESET ROLE;
DO $$
DECLARE n int; d numeric;
BEGIN
  SELECT count(*) INTO n FROM app.verify_ledger_consistency();
  IF n <> 0 THEN RAISE EXCEPTION 'T14 FAILED: بيانات متسقة لكن الأداة أبلغت % صفًا', n; END IF;

  -- انحراف متعمّد بصلاحية المالك (دور التطبيق لا يستطيع هذا أصلًا — T13)
  UPDATE stock_batches SET qty_on_hand = qty_on_hand + 1
   WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
     AND batch_id  = 'aaaaaaaa-0000-0000-0000-0000000000b9';

  SELECT count(*), max(delta) INTO n, d FROM app.verify_ledger_consistency();
  IF n <> 1 OR d <> 1 THEN RAISE EXCEPTION 'T14 FAILED: لم يُكشف الانحراف (n=%, delta=%)', n, d; END IF;

  UPDATE stock_batches SET qty_on_hand = qty_on_hand - 1
   WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
     AND batch_id  = 'aaaaaaaa-0000-0000-0000-0000000000b9';

  IF (SELECT count(*) FROM app.verify_ledger_consistency()) <> 0 THEN
    RAISE EXCEPTION 'T14 FAILED: الأداة لا تعود لصفر بعد التصحيح';
  END IF;

  INSERT INTO app.test_results (test, status) VALUES ('T14 اتساق الدفتر يكشف الانحراف', 'PASS');
END $$;
```

**T15 — أداة التحقق ليست متاحة لدور التطبيق:** سحب `EXECUTE` من `PUBLIC` يمنع قراءة انحرافات كل المخازن.
```sql
SET ROLE slamtak_app;
DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    PERFORM * FROM app.verify_ledger_consistency();
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'T15 FAILED: دور التطبيق نفّذ أداة تقرأ كل المخازن — تجاوز RLS';
  END IF;
  INSERT INTO app.test_results (test, status) VALUES ('T15 أداة التحقق ليست لدور التطبيق', 'PASS');
END $$;
RESET ROLE;
```

**T16 — الدور التشغيلي ينفّذ أداة التحقق:** `slamtak_ops` يرى نتيجة الاتساق بلا أي امتياز جدولي.
```sql
SET ROLE slamtak_ops;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM app.verify_ledger_consistency();
  IF n <> 0 THEN RAISE EXCEPTION 'T16 FAILED: البيانات غير متسقة (% صف), أو الدور لا يرى ما يجب', n; END IF;
END $$;
RESET ROLE;
INSERT INTO app.test_results (test, status) VALUES ('T16 دور العمليات ينفّذ أداة التحقق', 'PASS');
```

**T17 — الدور التشغيلي لا يقرأ بيانات تجارية:** غياب `SELECT` يحوّل «الاطلاع على الأرصدة» من سياسة إلى امتياز مفقود.
```sql
SET ROLE slamtak_ops;
DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    PERFORM 1 FROM stock_batches LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'T17 FAILED: دور العمليات قرأ الأرصدة مباشرة بلا امتياز مبرر';
  END IF;
END $$;
RESET ROLE;
INSERT INTO app.test_results (test, status) VALUES ('T17 دور العمليات بلا قراءة جداول الأعمال', 'PASS');
```

### 6.4 اختبارات قاعدة «حساب واحد = مخزن واحد» (ADR-025)

```sql
RESET ROLE;   -- الاختباران يقيسان القيد البنيوي نفسه، لا RLS

-- T19: لا يمكن إنشاء مخزن ثانٍ لنفس الحساب — ولو تجاوز الكود الواجهة.
DO $$
BEGIN
  BEGIN
    INSERT INTO warehouses (tenant_id, name)
    VALUES ('11111111-1111-1111-1111-111111111111', 'مخزن ثانٍ محاول');
    RAISE EXCEPTION 'T19 FAILED: قُبل إنشاء مخزن ثانٍ';
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO app.test_results (test, status) VALUES ('T19 منع المخزن الثاني', 'PASS');
  END;
END $$;

-- T20: العضوية لا تستطيع الإشارة إلى مخزن حساب آخر.
DO $$
BEGIN
  INSERT INTO users (id, email, full_name, password_hash)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000a2', 'second@alpha.test', 'مستخدم ثانٍ', 'x');

  BEGIN
    INSERT INTO tenant_memberships (tenant_id, user_id, warehouse_id)
    VALUES ('11111111-1111-1111-1111-111111111111',
            'aaaaaaaa-0000-0000-0000-0000000000a2',
            'bbbbbbbb-0000-0000-0000-000000000002');   -- مخزن بيتا
    RAISE EXCEPTION 'T20 FAILED: قُبلت عضوية تشير إلى مخزن حساب آخر';
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO app.test_results (test, status) VALUES ('T20 العضوية لا تعبر الحسابات', 'PASS');
  END;
END $$;
```

**ما الذي يثبتانه؟** أن الرفض ليس في الـGuard ولا في إخفاء زر: `T19` يسقط على `uq_one_warehouse_per_tenant`، و`T20` على الـFK المركّب `(tenant_id, warehouse_id)`.

## 7. نتائج التشغيل الفعلي

| # | الاختبار | النتيجة |
|---|---|---|
| T1 | قراءة معزولة (صف واحد فقط) | PASS |
| T2 | إدراج بمخزن آخر | PASS — `42501` |
| T3 | تعديل `tenant_id` | PASS — `TENANT_IMMUTABLE` |
| T4 | بلا سياق → صفر صفوف | PASS |
| T5 | مخطط المنصة | PASS — `42501` |
| T6 | رصيد سالب | PASS — `23514` |
| T7 | تسوية بلا سبب | PASS — `23514` |
| T8 | تعديل سجل ملحق | PASS — `42501` على UPDATE وDELETE (صفر صفوف) |
| T9 | تدقيق بصلاحية | PASS |
| T10 | عزل المستخدمين | PASS |
| T11 | ترحيل الرصيد 10−4 = 6 | PASS |
| T12 | ترقيم المستندات متسلسل | PASS |
| T13 | لا تعديل رصيد مباشر | PASS — `42501` |
| T14 | أداة اتساق الدفتر تكشف الانحراف | PASS — 0 ثم صف واحد (`delta=+1`) ثم 0 |
| T15 | أداة التحقق غير متاحة لدور التطبيق | PASS — `42501` |
| T16 | دور العمليات ينفّذ أداة التحقق | PASS — 0 صف |
| T17 | دور العمليات بلا قراءة جداول الأعمال | PASS — `42501` |
| T19 | منع إنشاء مخزن ثانٍ لنفس الحساب | PASS — `23505` على `uq_one_warehouse_per_tenant` |
| T20 | عضوية تشير إلى مخزن حساب آخر | PASS — `23503` على الـFK المركّب |

**بيئة التشغيل:** PostgreSQL 17 (PGlite/WASM) — نتيجة فعلية بعد ADR-025 (2026-11-08): **39 جدولًا** في `public`، **38** منها بـ `FORCE RLS`، **44 سياسة**، و**19/19 اختبار PASS** (0 كتلة فاشلة من 40). أوامر إعادة الإنتاج في §8.

---

## 8. إعادة إنتاج الاختبار

```bash
mkdir -p /tmp/pgverify && cd /tmp/pgverify
npm init -y >/dev/null && npm i @electric-sql/pglite
# استخراج كتل SQL من 21 ثم 22 وتنفيذها بالترتيب
node run.mjs
```

`run.mjs` يستخرج كل كتلة ```` ```sql ```` من `21` ثم `22`، ينفّذها بالترتيب في قاعدة فارغة، ويطبع جدول النتائج. أي فشل في أي كتلة يوقف السكربت بكود خروج غير صفري — وهذا هو ما يُربط بـ CI في Gate C.

> **مطلوب عند التنفيذ (ليس جزءًا من T1–T20 أعلاه):** `T18` — اشتراك Realtime بمستأجر B لا يستقبل حدثًا من مستأجر A، ولا يستطيع النشر إلى القناة. يُضاف إلى `22` عند بناء البوابة ([`28`](28-supabase-edge-runtime.md) §7.1 · §12).

## 9. فحص الثوابت الأمنية (آلي، للقراءة فقط)

مجموعة `T1`–`T20` تختبر السلوك على قاعدة بها بيانات. لكن أشهر الانحرافات لا تُكتشف بالسلوك: `EXECUTE` يعود لـ`PUBLIC` بعد `CREATE OR REPLACE FUNCTION`، وسياسة تُعاد بـ`PERMISSIVE`، و`GRANT` زائد على `stock_batches`. هذه كلها تراجع صامت يعمل معه كل شيء حتى أول تسريب. لذلك يوجد فحص كتالوجي مستقل لا يكتب شيئًا:

| الملف | الوظيفة |
|---|---|
| `scripts/check-security-invariants.sql` | استعلام واحد يُرجع جدول `PASS`/`FAIL` — يمكن لصقه في SQL Editor وقراءته بعينك |
| `scripts/check-security-invariants.mjs` | يشغّله على مشروع `pharma1` ويطبع النتيجة، **رمز الخروج 1** عند أي `FAIL` |

```bash
SUPABASE_DB_PASSWORD=... npm run check:security
```

يغطي 33 ثابتًا: الأدوار الأربعة وصفاتها، عدّ الكتالوج (39/4 جدولًا، 44 سياسة، 67 صلاحية، 12 دالة، 34 مشغّلًا)، `RLS`+`FORCE` على 38 جدولًا، صفر سياسة `true` على أي جدول بمخزن، سياسة التدقيق `RESTRICTIVE`، صفر `EXECUTE` لـ`PUBLIC`، صفر وصول لـ`slamtak_platform` على `public`/`app`، صفر جداول لـ`slamtak_ops`، وغياب التعديل/الحذف المباشر عن الأرصدة والسجلات.

**تشغيل من طرف إلى طرف (مُثبت):** نُفِّذ `npm run check:security` فعلًا بمسار `pg` الحقيقي على PostgreSQL 17.11 بعد تطبيق الهجرتين: **33/33، رمز الخروج 0**. ثم فُتحت ثغرتان عمدًا (`GRANT EXECUTE ... TO PUBLIC` و`GRANT UPDATE ON stock_batches`) → رمز الخروج **1** وثلاثة `FAIL` برسائلها. تشغيل `20261108000002_seed_and_harden.sql` أعاد الحالة → **33/33** ورجوع الرمز إلى 0. وغياب `SUPABASE_DB_PASSWORD` يُرجع **2** (تعذّر الفحص)، لا 0.

**البوابة في CI:** `.github/workflows/security-invariants.yml` يشغّل نفس الشيء عند كل `push` إلى `main` وكل `pull_request`: حاوية `postgres:17` جديدة، ثم `scripts/apply-migrations.mjs` يبني المخطط من ملفي المعمارية الجديدة، ثم `npm run check:security`. أي `FAIL` يُفشل المهمة، فتُمتنع البوابة قبل الدمج. وأُضيف `scripts/db-target.mjs` ليقرأ متغيّرات libpq (`PGHOST`/`PGPORT`/`PGUSER`/`PGDATABASE`/`PGPASSWORD`/`PGSSLMODE`)، والافتراضي بلا أي متغيّر يبقى `db.<ref>.supabase.co` عبر TLS — أي أن CI لم يغيّر السلوك الإنتاجي.

**الفحص الإنتاجي المجدول:** `.github/workflows/security-invariants-production.yml` يشغّل نفس الفحص على قاعدة المشروع يوميًا (‎03:00 UTC‎) وعند الطلب يدويًا. إعداده مرة واحدة في المستودع: السرّ `SUPABASE_DB_PASSWORD`، وإن لزم الـPooler فمتغيّرا `SUPABASE_DB_HOST` و`SUPABASE_DB_USER`. وهو يقرأ الكتالوج فقط، لا يكتب شيئًا. الفشل هنا يعني انحرافًا حقيقيًا في القاعدة الحية — لا في الملفات.

> **حدّ الاتصال:** الاتصال المباشر `db.<ref>.supabase.co` صار IPv6 فقط في المشاريع الحديثة، وrunners في GitHub تدعم IPv4 فقط. الحل هو Session Pooler: `SUPABASE_DB_HOST=aws-0-<region>.pooler.supabase.com` و`SUPABASE_DB_USER=postgres.<ref>`، وSSL يبقى مفعّلًا تلقائيًا. رمز الخروج 2 يعني «تعذّر الفحص» لا «القاعدة سليمة»، والـworkflow يفرّق بين الحالتين في رسالته.

> **ما لا يغطيه فحص الملفات:** انحراف ناتج عن تعديل يدوي في اللوحة لا تراه بوابة CI لأنها تبني من الملفات — ولهذا وُجد الفحص المجدول. كما أن ملفات `202610…` المهاجرة لا تُعاد في CI: ملفات تاريخ نظام سابق تفترض `auth.users` ومخططًا قائمين.

> **قاعدة التشغيل:** إذا فشل الفحص بعد تغيير مخطط مقصود، عدّل الرقم المتوقع في الملف **في نفس الالتزام** مع سبب مكتوب. تعديل المتوقع بلا تفسير يحوّل الحماية إلى طقس شكلي.

---

## معايير قبول هذه الوثيقة
- [x] لا جدول تجاري بلا سياسة (Fail closed).
- [x] لا `USING (true)` على جدول يحمل بيانات عميل.
- [x] كل اختبار يفشل بصوت عالٍ عند التسريب.
- [x] السجلات المالية/المخزنية غير قابلة للتعديل بطبقتين (سياسة + Trigger).
- [x] تنفيذ فعلي ناجح موثّق أعلاه.
- [x] فحص آلي للثوابت (§9) يفشل قبل النشر عند أي تراجع في الامتيازات أو السياسات.
