# 21 — المخطط المرجعي (Reference Schema DDL)

> **حالة الوثيقة:** مسودة معتمدة تقنيًا بعد تنفيذ فعلي على PostgreSQL 17 (انظر §9 نتائج التحقق).
> **النطاق:** «العمود الفقري» — 39 جدولًا في `public` تُغطي المسارات الحرجة (بيع، استلام، جرد، مرتجع). **لا فروع ولا تحويلات بين مخازن**: حساب المخزن = مخزن واحد بقيد قاعدة بيانات ([ADR-025](20-adr.md#adr-025--حساب-واحد--مخزن-واحد)). باقي جداول `08 §3` (المالية، الرواتب، التوصيل، التسويق) تُبنى بنفس النمط حرفيًا ولا تُضاف قبل مرحلتها في `19`.
> **الملف التنفيذي:** `supabase/migrations/20261108000001_init_schema.sql` — مُولَّد آليًا من هذه الوثيقة + `22` §1–§4 + `29` §3–§5، ومُختبر بتشغيله كاملًا داخل معاملة واحدة. لا يُحرَّر يدويًا؛ التعديل يبدأ من الوثائق. **لمرة واحدة:** إعادة تشغيله تفشل بـ `already exists` وهو سلوك مقصود.
> **ملف الصيانة المتكررة:** `supabase/migrations/20261108000002_seed_and_harden.sql` — يُشغَّل بلا حدود: يمزامن أدوار كل مخزن مع كتالوج الصلاحيات (فالصلاحية الجديدة تصل للأدوار بلا هجرة)، ينظّف أي صلاحية منصة تسلّلت إلى دور مخزن، يفشل بصوت عالٍ إن نقصت تغطية المالك أو لم يكتمل التزويد، ويعيد تشديد `EXECUTE` والامتيازات المسحوبة.
> **الاصطلاح:** كل جدول تجاري يحمل `tenant_id` في مفتاحه الأساسي، وكل مفتاح خارجي إليه مركّب مع `tenant_id`. هذا يجعل ربط سجل بمخزن آخر **مستحيلًا بنيويًا**، وليس مجرد ممنوع بسياسة. و`warehouse_id` يُشتق من العضوية على الخادم، ولا يُقبل من الواجهة.

## المحتويات
1. [المساعدات الأساسية](#1-المساعدات-الأساسية)
2. [الهوية والجلسات](#2-الهوية-والجلسات)
3. [الحساب والتنظيم والصلاحيات](#3-الحساب-والتنظيم-والصلاحيات)
4. [كتالوج الأصناف](#4-كتالوج-الأصناف)
5. [المخزون](#5-المخزون)
6. [المشتريات والمبيعات](#6-المشتريات-والمبيعات)
7. [النظام (تدقيق، idempotency، outbox)](#7-النظام)
8. [مخطط المنصة](#8-مخطط-المنصة)
9. [الـ Triggers ونتائج التحقق](#9-الـ-triggers-ونتائج-التحقق)

---

## 1. المساعدات الأساسية

```sql
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS platform;

-- سياق الطلب: يُضبط بـ set_config(..., true) داخل كل معاملة فقط (ADR-009)
CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- ADR-025: لا يُقرأ warehouse_id من الطلب؛ يُضبط من صف العضوية الذي تحقق منه الخادم
-- في نفس المعاملة، إلى جانب app.tenant_id. لا GUC = لا صف (RLS ترفض).
CREATE OR REPLACE FUNCTION app.current_warehouse_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.warehouse_id', true), '')::uuid
$$;

-- منع نقل أي سجل بين مخزنين (يُربط بكل جدول فيه tenant_id لاحقًا)
CREATE OR REPLACE FUNCTION app.prevent_tenant_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'TENANT_IMMUTABLE: لا يمكن نقل سجل بين مخزنين' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- جداول لا تُعدّل ولا تُحذف إطلاقًا
CREATE OR REPLACE FUNCTION app.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % لا يقبل التعديل أو الحذف', TG_TABLE_NAME USING ERRCODE = '55000';
END $$;
```

---

## 2. الهوية والجلسات

`users` **بلا `tenant_id`** لأن الشخص قد ينتمي لأكثر من مخزن؛ العزل يأتي من `tenant_memberships`، وهو مصدر الحقيقة للتفويض.

```sql
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,
  full_name      text NOT NULL,
  password_hash  text NOT NULL,                        -- Argon2id
  phone          text,
  is_active      boolean NOT NULL DEFAULT true,
  email_verified_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_users_email_lower ON users (lower(email));

CREATE TABLE user_mfa (
  user_id      uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  totp_secret  bytea NOT NULL,                          -- مشفّر بمفتاح تطبيق، لا نص صريح
  enabled_at   timestamptz,
  backup_codes text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tenant_id          uuid,                              -- سياق نشط للجلسة
  refresh_token_hash bytea NOT NULL UNIQUE,
  device_label       text,
  ip                 inet,
  user_agent         text,
  mfa_satisfied      boolean NOT NULL DEFAULT false,
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  rotated_from       uuid REFERENCES sessions (id),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user_active ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE login_attempts (
  id           bigserial PRIMARY KEY,
  email        text NOT NULL,
  tenant_slug  text,
  ip           inet,
  succeeded    boolean NOT NULL,
  reason       text,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_attempts_email_time ON login_attempts (email, attempted_at DESC);
```

---

## 3. الحساب والتنظيم والصلاحيات

```sql
CREATE TABLE tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,30}$'),
  name          text NOT NULL,
  status        text NOT NULL DEFAULT 'trial'
                CHECK (status IN ('trial','active','suspended','closed','deleted')),
  plan_code     text,
  trial_ends_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_settings (
  tenant_id          uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  timezone           text NOT NULL DEFAULT 'Africa/Cairo',
  currency           text NOT NULL DEFAULT 'EGP',
  default_locale     text NOT NULL DEFAULT 'ar-EG',
  allow_negative_stock boolean NOT NULL DEFAULT false,
  settings           jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ADR-025: مخزن واحد لكل حساب. القيد UNIQUE على tenant_id هو ما يمنع
-- إنشاء مخزن ثانٍ، ولو نادت الواجهة أو الـAPI مسارًا غير موجود.
CREATE TABLE warehouses (
  tenant_id     uuid NOT NULL,
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  code          text NOT NULL DEFAULT 'MAIN' CHECK (code = 'MAIN'),
  name          text NOT NULL DEFAULT 'المخزن الرئيسي',
  address       text,
  license_no    text,                       -- ترخيص الصيدلية/المخزن
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT uq_one_warehouse_per_tenant UNIQUE (tenant_id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
);

-- كل مخزن يملك موقعًا افتراضيًا (is_default) حتى لا يكون location_id فارغًا أبدًا،
-- لأن NULL في قيد UNIQUE يسمح بتكرار الأرصدة.
CREATE TABLE storage_locations (
  tenant_id     uuid NOT NULL,
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  warehouse_id  uuid NOT NULL,
  code          text NOT NULL,
  name          text NOT NULL,
  is_default    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, warehouse_id, code),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses (tenant_id, id)
);
CREATE UNIQUE INDEX uq_default_location_per_warehouse
  ON storage_locations (tenant_id, warehouse_id) WHERE is_default;

CREATE TABLE tenant_memberships (
  tenant_id   uuid NOT NULL,
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- يُملأ من المخزن الوحيد للحساب عند الإنشاء (trigger)، والـFK المركّب يمنع
  -- أي قيمة تشير إلى مخزن حساب آخر. هو مصدر warehouse_id للجلسة.
  warehouse_id uuid NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended')),
  invited_by  uuid REFERENCES users (id),
  joined_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, user_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses (tenant_id, id)
);
CREATE INDEX idx_memberships_user ON tenant_memberships (user_id);

-- العضوية لا تختار مخزنًا: derive من المخزن الوحيد للحساب. أي محاولة لتمرير
-- warehouse_id لحساب آخر تفشل في الـFK المركّب أعلاه.
CREATE OR REPLACE FUNCTION app.set_membership_warehouse() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.warehouse_id IS NULL THEN
    SELECT w.id INTO NEW.warehouse_id FROM warehouses w WHERE w.tenant_id = NEW.tenant_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_membership_warehouse BEFORE INSERT ON tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION app.set_membership_warehouse();

CREATE TABLE permissions (
  code        text PRIMARY KEY,          -- 'sales.invoice.create'
  module      text NOT NULL,
  description text NOT NULL,
  is_dangerous boolean NOT NULL DEFAULT false
);

CREATE TABLE roles (
  tenant_id   uuid NOT NULL,
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  code        text NOT NULL,
  name        text NOT NULL,
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
);

CREATE TABLE role_permissions (
  tenant_id  uuid NOT NULL,
  role_id    uuid NOT NULL,
  permission text NOT NULL REFERENCES permissions (code),
  PRIMARY KEY (tenant_id, role_id, permission),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE user_roles (
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id    uuid NOT NULL,
  granted_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, user_id, role_id),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE user_permission_overrides (
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  permission text NOT NULL REFERENCES permissions (code),
  effect     text NOT NULL CHECK (effect IN ('allow','deny')),  -- deny يتغلب دائمًا
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, user_id, permission)
);

CREATE TABLE document_sequences (
  tenant_id  uuid NOT NULL,
  doc_type   text NOT NULL,
  fiscal_year int  NOT NULL,
  last_value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, doc_type, fiscal_year),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
);

-- ترقيم ذرّي بلا فجوات ولا تكرار (يُستدعى داخل معاملة المستند)
CREATE OR REPLACE FUNCTION app.next_document_number(p_tenant uuid, p_doc_type text, p_year int)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_next bigint;
BEGIN
  INSERT INTO document_sequences (tenant_id, doc_type, fiscal_year, last_value)
  VALUES (p_tenant, p_doc_type, p_year, 1)
  ON CONFLICT (tenant_id, doc_type, fiscal_year)
  DO UPDATE SET last_value = document_sequences.last_value + 1
  RETURNING last_value INTO v_next;
  RETURN p_doc_type || '-' || p_year::text || '-' || lpad(v_next::text, 6, '0');
END $$;
```

> **لماذا لا نستخدم `citext`؟** لأنه امتداد اختياري غير متاح على كل مزوّد (فشل فعليًا في بيئة التحقق). البديل المحمول: `text` + فهرس فريد على `lower(email)` — نفس الضمان بلا اعتماد على امتداد.

---

## 4. كتالوج الأصناف

```sql
CREATE TABLE medicine_categories (
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  parent_id  uuid,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES medicine_categories (tenant_id, id)
);

CREATE TABLE medicines (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  sku            text NOT NULL,
  trade_name_ar  text NOT NULL,
  trade_name_en  text,
  scientific_name text,
  form           text,                        -- أقراص، شراب، أمبول…
  strength       text,
  category_id    uuid,
  manufacturer   text,
  eda_registration text,                      -- رقم تسجيل هيئة الدواء
  is_controlled  boolean NOT NULL DEFAULT false,   -- مخدر/جدول
  vat_rate       numeric(5,2) NOT NULL DEFAULT 0 CHECK (vat_rate >= 0 AND vat_rate <= 100),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, sku),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, category_id) REFERENCES medicine_categories (tenant_id, id)
);
CREATE INDEX idx_medicines_search ON medicines (tenant_id, trade_name_ar);

CREATE TABLE units (
  tenant_id   uuid NOT NULL,
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  code        text NOT NULL,                  -- box / strip / tablet
  name        text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
);

CREATE TABLE medicine_units (
  tenant_id     uuid NOT NULL,
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  medicine_id   uuid NOT NULL,
  unit_id       uuid NOT NULL,
  factor        numeric(12,3) NOT NULL CHECK (factor > 0),  -- معامل التحويل للوحدة الأساسية
  barcode       text,
  is_base       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, medicine_id, unit_id),
  FOREIGN KEY (tenant_id, medicine_id) REFERENCES medicines (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units (tenant_id, id)
);

CREATE TABLE price_lists (
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  code       text NOT NULL,                   -- retail / pharmacy / wholesale / contract
  name       text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
);

CREATE TABLE price_list_items (
  tenant_id     uuid NOT NULL,
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  price_list_id uuid NOT NULL,
  medicine_id   uuid NOT NULL,
  unit_id       uuid NOT NULL,
  price         numeric(14,2) NOT NULL CHECK (price >= 0),
  min_price     numeric(14,2) CHECK (min_price >= 0),   -- حد التسعيرة الجبرية
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, price_list_id, medicine_id, unit_id),
  FOREIGN KEY (tenant_id, price_list_id) REFERENCES price_lists (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, medicine_id) REFERENCES medicines (tenant_id, id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units (tenant_id, id),
  CHECK (min_price IS NULL OR price >= min_price)
);

CREATE TABLE prices_history (
  tenant_id   uuid NOT NULL,
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  medicine_id uuid NOT NULL,
  price_list_id uuid,
  old_price   numeric(14,2),
  new_price   numeric(14,2) NOT NULL,
  changed_by  uuid REFERENCES users (id),
  changed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, medicine_id) REFERENCES medicines (tenant_id, id)
);
```

**نطاق الكاتالوج والأسعار في عالم «حساب = مخزن» (ADR-025):** الأصناف وقوائم الأسعار والعملاء والموردون مرتبطون بالحساب (`tenant_id`) لا بعمود `warehouse_id` صريح، لأن الحساب يملك مخزنًا واحدًا فقط فالاثنان متكافئان بنيويًا. أما **الأرصدة والكميات والحركات والجرد** فتحمل `warehouse_id` صريحًا مع FK مركّب `(tenant_id, warehouse_id)`، فلا يمكن أن يوجد رصيد أو حركة في مخزن آخر. أي دعم لمخزن ثانٍ لاحقًا يتطلب ADR جديدًا وترحيلًا يضيف العمود — لا تغييرًا صامتًا.

---

## 5. المخزون

الرصيد **إسقاط** يتحدث من الدفتر فقط. لا يوجد مسار تطبيقي يكتب `qty_on_hand` مباشرة.

```sql
CREATE TABLE batches (
  tenant_id   uuid NOT NULL,
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  medicine_id uuid NOT NULL,
  batch_no    text NOT NULL,
  expiry_date date NOT NULL,
  manufacture_date date,
  supplier_id uuid,
  status      text NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','quarantine','recalled','expired')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, medicine_id, batch_no, expiry_date),
  FOREIGN KEY (tenant_id, medicine_id) REFERENCES medicines (tenant_id, id),
  CHECK (manufacture_date IS NULL OR manufacture_date <= expiry_date)
);

CREATE TABLE stock_batches (
  tenant_id    uuid NOT NULL,
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL,
  location_id  uuid NOT NULL,
  medicine_id  uuid NOT NULL,
  batch_id     uuid NOT NULL,
  qty_on_hand  numeric(14,3) NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
  qty_reserved numeric(14,3) NOT NULL DEFAULT 0 CHECK (qty_reserved >= 0),
  unit_cost    numeric(14,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  status       text NOT NULL DEFAULT 'available'
               CHECK (status IN ('available','quarantine','blocked','recalled','damaged')),
  version      int NOT NULL DEFAULT 1,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, warehouse_id, location_id, batch_id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES batches (tenant_id, id),
  FOREIGN KEY (tenant_id, medicine_id) REFERENCES medicines (tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses (tenant_id, id),
  FOREIGN KEY (tenant_id, location_id) REFERENCES storage_locations (tenant_id, id),
  CHECK (qty_reserved <= qty_on_hand)
);

-- استعلام FEFO (الأكثر حرارة في النظام): الأقدم انتهاءً أولًا، الأرصدة المتاحة فقط
CREATE INDEX idx_stock_fefo
  ON stock_batches (tenant_id, warehouse_id, medicine_id, status)
  INCLUDE (qty_on_hand, qty_reserved, batch_id)
  WHERE qty_on_hand > 0 AND status = 'available';

CREATE TABLE stock_movements (
  tenant_id    uuid NOT NULL,
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL,
  location_id  uuid NOT NULL,
  medicine_id  uuid NOT NULL,
  batch_id     uuid NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN (
      'opening','receipt','return_in','adjustment_in',
      'sale','return_out','adjustment_out','damage','expiry','recall')),
  qty_delta    numeric(14,3) NOT NULL CHECK (qty_delta <> 0),
  unit_cost    numeric(14,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  ref_type     text,                      -- sales_invoice / goods_receipt / transfer …
  ref_id       uuid,
  reason       text,
  created_by   uuid REFERENCES users (id),
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES batches (tenant_id, id),
  FOREIGN KEY (tenant_id, medicine_id) REFERENCES medicines (tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses (tenant_id, id),
  CHECK (
    (movement_type IN ('opening','receipt','return_in','adjustment_in') AND qty_delta > 0)
    OR
    (movement_type IN ('sale','return_out','adjustment_out','damage','expiry','recall') AND qty_delta < 0)
  ),
  CHECK (movement_type NOT IN ('adjustment_in','adjustment_out','damage','expiry','recall') OR reason IS NOT NULL)
);
CREATE INDEX idx_movements_ref ON stock_movements (tenant_id, ref_type, ref_id);
CREATE INDEX idx_movements_time ON stock_movements (tenant_id, occurred_at DESC);

CREATE TABLE stock_reservations (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  stock_batch_id uuid NOT NULL,
  qty            numeric(14,3) NOT NULL CHECK (qty > 0),
  ref_type       text NOT NULL,
  ref_id         uuid NOT NULL,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','consumed','expired')),
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, stock_batch_id) REFERENCES stock_batches (tenant_id, id)
);

CREATE TABLE stock_counts (
  tenant_id    uuid NOT NULL,
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  doc_number   text NOT NULL,
  warehouse_id uuid NOT NULL,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','counting','review','closed','cancelled')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, doc_number),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses (tenant_id, id)
);

CREATE TABLE stock_count_items (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  count_id       uuid NOT NULL,
  stock_batch_id uuid NOT NULL,
  system_qty     numeric(14,3) NOT NULL,
  counted_qty    numeric(14,3) NOT NULL CHECK (counted_qty >= 0),
  variance_reason text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, count_id) REFERENCES stock_counts (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, stock_batch_id) REFERENCES stock_batches (tenant_id, id),
  CHECK (counted_qty = system_qty OR variance_reason IS NOT NULL)   -- لا فرق بلا سبب
);
```

---

## 6. المشتريات والمبيعات

```sql
CREATE TABLE suppliers (
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  phone      text,
  tax_id     text,
  balance    numeric(14,2) NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
);

CREATE TABLE goods_receipts (
  tenant_id    uuid NOT NULL,
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  doc_number   text NOT NULL,
  supplier_id  uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  received_at  timestamptz,
  created_by   uuid REFERENCES users (id),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, doc_number),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers (tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses (tenant_id, id)
);

CREATE TABLE goods_receipt_items (
  tenant_id   uuid NOT NULL,
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  receipt_id  uuid NOT NULL,
  medicine_id uuid NOT NULL,
  batch_id    uuid NOT NULL,
  qty         numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_cost   numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES goods_receipts (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, medicine_id) REFERENCES medicines (tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES batches (tenant_id, id)
);

CREATE TABLE customers (
  tenant_id    uuid NOT NULL,
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  kind         text NOT NULL DEFAULT 'pharmacy' CHECK (kind IN ('pharmacy','hospital','clinic','cash')),
  phone        text,
  license_no   text,
  credit_limit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  balance      numeric(14,2) NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
);

CREATE TABLE sales_invoices (
  tenant_id     uuid NOT NULL,
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  doc_number    text NOT NULL,
  customer_id   uuid NOT NULL,
  warehouse_id  uuid NOT NULL,
  status        text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','confirmed','cancelled')),
  subtotal      numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  vat_total     numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_total >= 0),
  total         numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  idempotency_key text,
  issued_at     timestamptz,
  created_by    uuid REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, doc_number),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses (tenant_id, id),
  CHECK (total = subtotal - discount_total + vat_total)
);

CREATE TABLE sales_invoice_items (
  tenant_id   uuid NOT NULL,
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL,
  medicine_id uuid NOT NULL,
  unit_id     uuid NOT NULL,
  qty         numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_price  numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  discount    numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  vat_amount  numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  line_total  numeric(14,2) NOT NULL CHECK (line_total >= 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES sales_invoices (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, medicine_id) REFERENCES medicines (tenant_id, id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units (tenant_id, id),
  CHECK (line_total = qty * unit_price - discount + vat_amount)
);

CREATE TABLE sales_returns (
  tenant_id   uuid NOT NULL,
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  doc_number  text NOT NULL,
  invoice_id  uuid,
  customer_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  reason      text NOT NULL,
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  total       numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  created_by  uuid REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, doc_number),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES sales_invoices (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses (tenant_id, id)
);

CREATE TABLE sales_return_items (
  tenant_id   uuid NOT NULL,
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  return_id   uuid NOT NULL,
  medicine_id uuid NOT NULL,
  batch_id    uuid NOT NULL,
  qty         numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_price  numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, return_id) REFERENCES sales_returns (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, medicine_id) REFERENCES medicines (tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES batches (tenant_id, id)
);
```

---

## 7. النظام

```sql
CREATE TABLE audit_logs (
  tenant_id     uuid NOT NULL,
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users (id),
  action        text NOT NULL,              -- sales.invoice.confirm
  entity_type   text NOT NULL,
  entity_id     uuid,
  before_state  jsonb,
  after_state   jsonb,
  request_id    text,
  ip            inet,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX idx_audit_entity ON audit_logs (tenant_id, entity_type, entity_id, created_at DESC);

CREATE TABLE idempotency_keys (
  tenant_id    uuid NOT NULL,
  key          text NOT NULL,
  request_hash text NOT NULL,
  response     jsonb,
  status       text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','failed')),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE outbox_events (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  aggregate_id   uuid NOT NULL,
  event_type     text NOT NULL,
  payload        jsonb NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','published','failed')),
  attempts       int NOT NULL DEFAULT 0,
  available_at   timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX idx_outbox_pending ON outbox_events (available_at) WHERE status = 'pending';
```

---

## 8. مخطط المنصة

لا يُمنح دور التطبيق أي صلاحية عليه. الأنسب: مخطط منفصل بدور منفصل تمامًا، واتصال تطبيق مستقل.

```sql
CREATE TABLE platform.plans (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  monthly_price numeric(10,2) NOT NULL DEFAULT 0,
  features    jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE platform.subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  plan_code  text NOT NULL REFERENCES platform.plans (code),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('trialing','active','past_due','cancelled')),
  starts_at  timestamptz NOT NULL DEFAULT now(),
  ends_at    timestamptz
);

CREATE TABLE platform.platform_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX uq_platform_users_email_lower ON platform.platform_users (lower(email));

CREATE TABLE platform.platform_audit_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   uuid REFERENCES platform.platform_users (id),
  action     text NOT NULL,
  tenant_id  uuid,                          -- أثر الميتاداتا فقط، لا بيانات تجارية
  meta       jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

---

## 9. الـ Triggers ونتائج التحقق

### 9.1 حركة مخزون → رصيد (المسار الوحيد المسموح)

```sql
CREATE OR REPLACE FUNCTION app.apply_stock_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- UPDATE أولًا: لأن CHECK على qty_on_hand يُفحص قبل كشف التعارض في ON CONFLICT،
  -- فأي حركة سالبة عبر INSERT..ON CONFLICT تفشل حتى لو كان الرصيد كافيًا.
  UPDATE stock_batches
     SET qty_on_hand = qty_on_hand + NEW.qty_delta,
         unit_cost   = CASE WHEN NEW.unit_cost > 0 THEN NEW.unit_cost ELSE unit_cost END,
         version     = version + 1,
         updated_at  = now()
   WHERE tenant_id    = NEW.tenant_id
     AND warehouse_id = NEW.warehouse_id
     AND location_id  = NEW.location_id
     AND batch_id     = NEW.batch_id;

  IF NOT FOUND THEN
    -- صف رصيد جديد: مقبول فقط إذا كانت الحركة واردة (qty_delta > 0)
    INSERT INTO stock_batches
      (tenant_id, warehouse_id, location_id, medicine_id, batch_id, qty_on_hand, unit_cost)
    VALUES (NEW.tenant_id, NEW.warehouse_id, NEW.location_id, NEW.medicine_id,
            NEW.batch_id, NEW.qty_delta, NEW.unit_cost)
    ON CONFLICT (tenant_id, warehouse_id, location_id, batch_id) DO UPDATE
      SET qty_on_hand = stock_batches.qty_on_hand + EXCLUDED.qty_on_hand,
          version     = stock_batches.version + 1,
          updated_at  = now();
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_apply_stock_movement
  AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION app.apply_stock_movement();
```

> **ملكية الدالة:** دوال `SECURITY DEFINER` يجب أن يملكها دور مخصّص `slamtak_definer` بصفة `BYPASSRLS`، ومهمته الوحيدة تنفيذ هذه الوظائف الضيقة — وإلا فإن `FORCE ROW LEVEL SECURITY` سيمنعها من تحديث `stock_batches`. لا تُمنح `BYPASSRLS` لدور التطبيق أبدًا.

> الرصيد السالب مستحيل: `CHECK (qty_on_hand >= 0)` على `stock_batches` يُفشل الـ UPSERT نفسه، فيُلغى الإدراج في `stock_movements` معه داخل نفس المعاملة.

### 9.2 ربط حماية العزل بكل جدول تجاري تلقائيًا

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
    EXECUTE format(
      'CREATE TRIGGER trg_tenant_immutable BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION app.prevent_tenant_change()', r.relname);
  END LOOP;
END $$;

CREATE TRIGGER trg_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER trg_audit_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER trg_prices_append_only BEFORE UPDATE OR DELETE ON prices_history
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
```

### 9.3 أداة التحقق من اتساق الدفتر (`verify_ledger_consistency`)

هذه الدالة مذكورة في `08` §10 و`13` §5 و`14` §8 و`20` (ADR-008) كأداة تمرين الاستعادة والمهمة الليلية. تُعرِّف هنا مرة واحدة، ولا تُستدعى من مسار طلب عادي.

```sql
-- تعيد صفر صفوف = الدفتر مطابق للأرصدة. أي صف = انحراف يحتاج تسوية موثقة.
CREATE OR REPLACE FUNCTION app.verify_ledger_consistency()
RETURNS TABLE (
  tenant_id     uuid,
  warehouse_id  uuid,
  location_id   uuid,
  batch_id      uuid,
  ledger_qty    numeric,
  balance_qty   numeric,
  delta         numeric,
  issue         text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH ledger AS (
    SELECT m.tenant_id, m.warehouse_id, m.location_id, m.batch_id,
           sum(m.qty_delta) AS qty
      FROM stock_movements m
     GROUP BY 1, 2, 3, 4
  )
  SELECT COALESCE(b.tenant_id,    l.tenant_id),
         COALESCE(b.warehouse_id, l.warehouse_id),
         COALESCE(b.location_id,  l.location_id),
         COALESCE(b.batch_id,     l.batch_id),
         COALESCE(l.qty, 0),
         COALESCE(b.qty_on_hand, 0),
         COALESCE(b.qty_on_hand, 0) - COALESCE(l.qty, 0),
         CASE WHEN b.batch_id IS NULL THEN 'حركات بلا رصيد'
              WHEN l.batch_id IS NULL THEN 'رصيد بلا حركات'
              ELSE 'اختلاف بين الدفتر والرصيد' END
    FROM stock_batches b
    FULL OUTER JOIN ledger l
      ON  l.tenant_id    = b.tenant_id
     AND  l.warehouse_id = b.warehouse_id
     AND  l.location_id  = b.location_id
     AND  l.batch_id     = b.batch_id
   WHERE COALESCE(b.qty_on_hand, 0) <> COALESCE(l.qty, 0);
$$;

-- الدالة تقرأ كل المخازن، فلا يجوز أن ينفّذها دور التطبيق.
REVOKE ALL ON FUNCTION app.verify_ledger_consistency() FROM PUBLIC;
```

> **لماذا `REVOKE ... FROM PUBLIC` إلزامي:** PostgreSQL يمنح `EXECUTE` لكل الدوال لـ `PUBLIC` افتراضيًا. بدون هذا السحب يستطيع `slamtak_app` — عبر أي ثغرة حقن — تشغيل الدالة وقراءة انحرافات **كل** المخازن، أي تجاوز `RLS` بالكامل. الاختبار `T15` يثبت المنع فعليًا.

> **من ينفّذها:** دور تشغيلي مستقل `slamtak_ops` (يُعرَّف ويُمنح في `22` §1) يُمنح `EXECUTE` وحده، ويُستخدم في مهمة ليلية وفي تمرين الاستعادة. لا يُمنح لدور التطبيق ولا لدور المنصة.

### 9.4 ما تم التحقق منه فعليًا

| # | الفحص | النتيجة |
|---|---|---|
| V1 | تنفيذ كل الـ DDL من الصفر على PostgreSQL 17 | ✅ 39 جدولًا في `public` + 4 في `platform` |
| V2 | إدراج حركة استلام ثم بيع وتحديث الرصيد آليًا | ✅ 10 − 4 = 6 |
| V3 | محاولة صرف أكبر من الرصيد | ✅ مرفوضة بقيد `qty_on_hand >= 0` |
| V4 | حركة `adjustment_out` بلا سبب | ✅ مرفوضة بقيد السبب الإلزامي |
| V5 | تحديث `tenant_id` لسجل قائم | ✅ مرفوض `TENANT_IMMUTABLE` |
| V6 | `UPDATE`/`DELETE` على `stock_movements` و`audit_logs` | ✅ مرفوض `APPEND_ONLY` |
| V7 | ترقيم مستندات متوازٍ لنفس النوع | ✅ بلا تكرار (قيد المفتاح الأساسي) |
| V8 | `app.verify_ledger_consistency()` على بيانات متسقة ثم على انحراف مُدخل عمدًا | ✅ صفر صفوف، ثم صف واحد بـ `delta = +1`، ثم صفر بعد التصحيح (`T14`) |
| V9 | إدراج مخزن ثانٍ لنفس `tenant_id` | ✅ مرفوض: `23505` على `uq_one_warehouse_per_tenant` |
| V10 | عضوية بـ`warehouse_id` لمخزن حساب آخر | ✅ مرفوضة بالـFK المركّب `(tenant_id, warehouse_id)` |
| V11 | حذف مخزن الحساب الوحيد | ✅ مرفوض/ممنوع تشغيليًا: لا مسار حذف، والـFK من العضوية يمنع الحذف الصامت |

**بيئة التحقق:** PostgreSQL 17 (WASM/PGlite) — نفس إصدار المزوّد المستهدف. السياسات واختبار العزل في [`22`](22-rls-and-isolation-tests.md).

## معايير قبول هذه الوثيقة
- [x] كل جدول تجاري له `tenant_id` في المفتاح الأساسي وكل FK مركّب.
- [x] لا عمود رصيد قابل للكتابة من التطبيق.
- [x] كل قيد "حرج" مُنفَّذ في القاعدة لا في الكود.
- [x] الوثيقة قابلة للتنفيذ حرفيًا وبالترتيب.
