-- ============================================================================
-- 001 — المخطط المرجعي: 39 جدولًا في public + 4 في platform + RLS + البذور
-- المصادر (مصدر الحقيقة، لا تُعدّل هذا الملف يدويًا):
--   docs/architecture/21-reference-schema.md   (البنية والدوال والـTriggers)
--   docs/architecture/22-rls-and-isolation-tests.md §1–§4  (الأدوار والسياسات)
--   docs/architecture/29-reference-seed.md §3–§5  (67 صلاحية، أدوار النظام، خطة free)
--
-- المتطلبات المسبقة:
--   1. public فارغ أو غير موجود. المخطط القديم يُنقل أولًا:
--        ALTER SCHEMA public RENAME TO legacy_old;
--      (النقل غير مدمّر: يمكن الرجوع بـ ALTER SCHEMA legacy_old RENAME TO public;)
--   2. التنفيذ بدور postgres (مالك المخطط)، وليس anon/authenticated.
--   3. bundle واحد داخل معاملة: BEGIN; ... COMMIT;
--
-- لا يحتوي هذا الملف على أي بيانات تجارية ولا حسابات ولا مخازن.
-- ============================================================================

-- ---- [21] ----
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

-- ---- [21] ----
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

-- ---- [21] ----
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

-- ---- [21] ----
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

-- ---- [21] ----
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

-- تخصيص FEFO الفعلي: يُعيد خطة صرف تغطي الكمية المطلوبة من الأقرب انتهاءً،
-- ويرفض المنتهي والمحجوب والمحجور وما حُجز بالكامل. الدالة تقرأ وتقفل فقط:
-- الخصم يبقى حصرًا عبر stock_movements → trg_apply_stock_movement، فلا توجد
-- طريق ثانية لتغيير رصيد. القفل (FOR UPDATE) يجعل القراءة والخصم ذرّيين،
-- فيمنع بيع العلبة نفسها مرتين تحت التزامن.
--
-- تُستدعى داخل معاملة البيع بعد ضبط app.tenant_id، ويُسجَّل كل صف عائد كحركة
-- «sale» بنفس الكمية. إن كان المتاح أقل من المطلوب فشلت المعاملة كلها ولم
-- يُخصم شيء (لا تخصيص جزئي صامت).
CREATE OR REPLACE FUNCTION app.allocate_fefo(
  p_tenant uuid, p_warehouse uuid, p_medicine uuid, p_qty numeric
) RETURNS TABLE (
  stock_batch_id uuid,
  batch_id       uuid,
  batch_no       text,
  expiry_date    date,
  location_id    uuid,
  qty            numeric,
  unit_cost      numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ctx  uuid := app.current_tenant_id();
  v_left numeric := p_qty;
  v_free numeric := 0;
  v_take numeric;
  r      record;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'FEFO_INVALID_QTY: الكمية المطلوبة يجب أن تكون أكبر من صفر'
      USING ERRCODE = '22023';
  END IF;

  IF p_tenant IS NULL OR p_warehouse IS NULL OR p_medicine IS NULL THEN
    RAISE EXCEPTION 'FEFO_INVALID_SCOPE: المخزن والصنف والحساب إلزامية'
      USING ERRCODE = '22004';
  END IF;

  -- الحارس الثاني للعزل: RLS لا تحمي SECURITY DEFINER، فتمنع الدالة نفسها
  -- تمرير حساب آخر من داخل سياق حساب ما. بلا سياق (مهمة خادم) يُقبل الوسيط.
  IF v_ctx IS NOT NULL AND v_ctx <> p_tenant THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_MISMATCH: سياق % لا يطابق الحساب المطلوب %', v_ctx, p_tenant
      USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT sb.id, sb.batch_id, sb.location_id, sb.unit_cost,
           sb.qty_on_hand - sb.qty_reserved AS free_qty,
           b.batch_no, b.expiry_date
      FROM stock_batches sb
      JOIN batches b ON b.tenant_id = sb.tenant_id AND b.id = sb.batch_id
     WHERE sb.tenant_id    = p_tenant
       AND sb.warehouse_id = p_warehouse
       AND sb.medicine_id  = p_medicine
       AND b.medicine_id   = p_medicine
       AND sb.status       = 'available'          -- المحجوب والمحجور والتالف والمسحوب خارج التخصيص
       AND b.status        = 'active'             -- تشغيلة محجورة إكلينيكيًا لا تُصرف
       AND b.expiry_date   > CURRENT_DATE         -- المنتهي لا يُصرف ولو كان الأقرب
       AND sb.qty_on_hand - sb.qty_reserved > 0
     ORDER BY b.expiry_date, b.created_at, sb.id
       FOR UPDATE OF sb
  LOOP
    EXIT WHEN v_left <= 0;

    v_free := v_free + r.free_qty;
    v_take := LEAST(r.free_qty, v_left);
    v_left := v_left - v_take;

    stock_batch_id := r.id;
    batch_id       := r.batch_id;
    batch_no       := r.batch_no;
    expiry_date    := r.expiry_date;
    location_id    := r.location_id;
    qty            := v_take;
    unit_cost      := r.unit_cost;
    RETURN NEXT;
  END LOOP;

  IF v_left > 0 THEN
    RAISE EXCEPTION 'FEFO_INSUFFICIENT_STOCK: المطلوب % والمتاح %', p_qty, v_free
      USING ERRCODE = 'P0001';
  END IF;

  RETURN;
END $$;

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

-- ---- [21] ----
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
  -- السعر بعشرتين والكمية بثلاث، فحاصل الضرب قد يحمل خمس منازل عشرية. التقريب
  -- إلى عشرتين قبل المقارنة يمنع رفض بيع صحيح (‎0.5 × 3.75 = 1.875 → 1.88‎).
  CHECK (line_total = round(qty * unit_price - discount + vat_amount, 2))
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

-- ---- [21] ----
-- ترحيل بيع واحد من أوله إلى آخره، بعدة أصناف في فاتورة واحدة: يتحقق من البنود،
-- ثم يحجز مفتاح التكرار (إدراج الفاتورة) قبل أي تخصيص، ثم يخصّص FEFO لكل سطر
-- (فتأخذ الدالة أقفال الصفوف)، ويسجّل حركة «sale» سالبة لكل صف تخصيص (فالخصم لا
-- يقع إلا عبر stock_movements)، ويربط الحركات بالفاتورة بـref_type='sales_invoice'.
-- الواجهة تستدعي هذه الدالة وحدها ولا ترسل batch_id ولا qty_delta، فلا تستطيع
-- تجاوز FEFO ولا تزوير كمية.
--
-- المفتاح واحد للفاتورة كلها لا لكل سطر: يُحجز أولًا بـON CONFLICT DO NOTHING، فلا
-- تصل المحاولة الثانية إلى allocate_fefo قبل أن تنتهي الأولى (تنتظر على رقم
-- المستند أو على الفهرس الفريد)، ثم تعود الفاتورة نفسها بلا تخصيص جديد. وإعادة
-- المفتاح ببنود أو عميل أو مخزن مختلف تُرفض (SALE_IDEMPOTENCY_KEY_REUSED)، فلا
-- يصرف خطأ إدخال كميةً أخرى تحت مفتاح قديم.
--
-- الذرّية: فشل أي سطر (نقص المتاح) يُبطل المعاملة كلها: لا فاتورة، ولا سطر، ولا
-- حركة، ولا استهلاك لرقم مستند — لأن كل الإدراجات في نداء واحد، فلا فاتورة جزئية.
--
-- ترتيب المعالجة ثابت (بالصنف ثم بمحتوى السطر) لا ترتيب إدخال الواجهة، فجلستان
-- تبيعان الصنفين نفسهما بترتيبين مختلفين تأخذان الأقفال بالترتيب نفسه.
--
-- السعر لا يُقبل من العميل بلا مرجع: كل سطر يُقارن بسعر الصنف في قائمة البيع
-- الافتراضية (is_default) للمخزن، فسعر أدنى منها يرتد (SALE_PRICE_BELOW_REFERENCE)
-- وصنف بلا سعر مرجعي يرتد (SALE_PRICE_REFERENCE_MISSING). والفحص لكل سطر قبل
-- تخصيصه في مسار الإنشاء وحده: فشله يُبطل المعاملة كلها (لا فاتورة ولا رقم مستند)،
-- وإعادة المفتاح نفسه لا تمر به فتعيد فاتورتها القديمة ولو تغيّر سعر القائمة.
CREATE OR REPLACE FUNCTION app.post_sale(
  p_customer uuid, p_warehouse uuid, p_items jsonb, p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE
  v_tenant      uuid := app.current_tenant_id();
  v_user        uuid := app.current_user_id();
  v_key         text := btrim(coalesce(p_idempotency_key, ''));
  v_count       int;
  v_idx         int;
  v_entry       jsonb;
  v_line        jsonb;
  v_items       jsonb := '[]'::jsonb;
  v_med         uuid;
  v_unit        uuid;
  v_qty         numeric(14,3);
  v_price       numeric(14,2);
  v_ref_price   numeric(14,2);
  v_line_total  numeric(14,2);
  v_subtotal    numeric(14,2) := 0;
  v_invoice     uuid;
  v_item        uuid;
  v_doc         text;
  v_status      text;
  v_total       numeric(14,2);
  v_prev_cust   uuid;
  v_prev_wh     uuid;
  v_prev_items  jsonb;
  v_alloc       record;
  v_allocations jsonb := '[]'::jsonb;
  v_out_items   jsonb := '[]'::jsonb;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'SALE_ITEMS_REQUIRED: بنود الفاتورة مصفوفة JSON إلزامية'
      USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_items);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'SALE_ITEMS_REQUIRED: الفاتورة بلا أي بند'
      USING ERRCODE = '22023';
  END IF;

  -- حلقة واحدة تتحقق وتبني المصفوفة المعيّرة وتحسب الإجمالي، قبل حجز المفتاح:
  -- مدخلات خاطئة لا تستهلك رقم مستند ولا مفتاحًا.
  BEGIN
    FOR v_idx IN 0 .. v_count - 1 LOOP
      v_entry := p_items -> v_idx;
      IF jsonb_typeof(v_entry) <> 'object' THEN
        RAISE EXCEPTION 'SALE_INVALID_ITEM: البند % ليس كائنًا', v_idx + 1
          USING ERRCODE = '22023';
      END IF;

      v_med  := (v_entry->>'medicine_id')::uuid;
      v_unit := (v_entry->>'unit_id')::uuid;
      IF v_med IS NULL OR v_unit IS NULL THEN
        RAISE EXCEPTION 'SALE_INVALID_ITEM: البند % بلا medicine_id أو unit_id', v_idx + 1
          USING ERRCODE = '22023';
      END IF;

      IF coalesce(jsonb_typeof(v_entry->'qty'), 'missing') <> 'number' THEN
        RAISE EXCEPTION 'SALE_INVALID_QTY: البند % بلا كمية رقمية', v_idx + 1
          USING ERRCODE = '22023';
      END IF;
      v_qty := (v_entry->>'qty')::numeric;
      IF v_qty <= 0 OR v_qty <> round(v_qty, 3) THEN
        RAISE EXCEPTION 'SALE_INVALID_QTY: كمية البند % يجب أن تكون أكبر من صفر وبثلاث منازل على الأكثر (%)',
          v_idx + 1, v_qty
          USING ERRCODE = '22023';
      END IF;

      IF coalesce(jsonb_typeof(v_entry->'unit_price'), 'missing') <> 'number' THEN
        RAISE EXCEPTION 'SALE_INVALID_PRICE: البند % بلا سعر رقمي', v_idx + 1
          USING ERRCODE = '22023';
      END IF;
      v_price := (v_entry->>'unit_price')::numeric;
      IF v_price < 0 OR v_price <> round(v_price, 2) THEN
        RAISE EXCEPTION 'SALE_INVALID_PRICE: سعر البند % يجب أن يكون غير سالب بعشرتين على الأكثر (%)',
          v_idx + 1, v_price
          USING ERRCODE = '22023';
      END IF;

      v_line_total := round(v_qty * v_price, 2);
      v_subtotal   := v_subtotal + v_line_total;
      v_items := v_items || jsonb_build_object(
        'medicine_id', v_med,
        'unit_id',     v_unit,
        'qty',         v_qty,
        'unit_price',  v_price);
    END LOOP;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'SALE_INVALID_ITEM: معرّف صنف أو وحدة غير صالح في بنود الفاتورة'
        USING ERRCODE = '22023';
  END;

  IF v_key = '' THEN
    RAISE EXCEPTION 'SALE_IDEMPOTENCY_KEY_REQUIRED: مفتاح التكرار إلزامي ومنع الصرف المزدوج يتوقف عليه'
      USING ERRCODE = '22023';
  END IF;

  -- RLS لا تحمي SECURITY DEFINER، فالدالة تمنع نفسها من العمل بلا سياق مخزن.
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'SALE_TENANT_CONTEXT_REQUIRED: لا سياق مخزن في الجلسة'
      USING ERRCODE = '42501';
  END IF;
  IF NOT app.has_permission('sales.invoice.create') THEN
    RAISE EXCEPTION 'SALE_PERMISSION_DENIED: إنشاء فاتورة بيع يحتاج sales.invoice.create'
      USING ERRCODE = '42501';
  END IF;

  -- ترتيب ثابت لأخذ الأقفال: بالصنف ثم بمحتوى السطر، لا بترتيب إدخال الواجهة.
  SELECT coalesce(jsonb_agg(e ORDER BY e->>'medicine_id', e::text), '[]'::jsonb)
    INTO v_items
    FROM jsonb_array_elements(v_items) AS e;

  SELECT i.id, i.status INTO v_invoice, v_status
    FROM sales_invoices i
   WHERE i.tenant_id = v_tenant AND i.idempotency_key = v_key;

  IF NOT FOUND THEN
    -- الحجز الأول: إدراج الفاتورة بمفتاحها الفريد قبل أي تخصيص. المحاولة الثانية
    -- لنفس المفتاح تنتظر (على رقم المستند أو على الفهرس الفريد) ولا تصل إلى
    -- allocate_fefo أبدًا.
    v_doc := app.next_document_number(v_tenant, 'sale', extract(year FROM CURRENT_DATE)::int);
    INSERT INTO sales_invoices
      (tenant_id, doc_number, customer_id, warehouse_id, status,
       subtotal, total, idempotency_key, issued_at, created_by)
    VALUES
      (v_tenant, v_doc, p_customer, p_warehouse, 'confirmed',
       v_subtotal, v_subtotal, v_key, now(), v_user)
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
    RETURNING id INTO v_invoice;

    IF v_invoice IS NOT NULL THEN
      FOR v_line IN SELECT e FROM jsonb_array_elements(v_items) AS e
      LOOP
        v_med   := (v_line->>'medicine_id')::uuid;
        v_unit  := (v_line->>'unit_id')::uuid;
        v_qty   := (v_line->>'qty')::numeric;
        v_price := (v_line->>'unit_price')::numeric;
        v_line_total := round(v_qty * v_price, 2);

        -- السعر المرجعي: سعر الصنف في قائمة البيع الافتراضية للمخزن (وأدناها إن
        -- تعددت). التحقق قبل التخصيص، وفشله يُبطل المعاملة كلها.
        SELECT min(pli.price) INTO v_ref_price
          FROM public.price_list_items pli
          JOIN public.price_lists pl
            ON pl.tenant_id = pli.tenant_id
           AND pl.id = pli.price_list_id
         WHERE pli.tenant_id   = v_tenant
           AND pl.is_default
           AND pli.medicine_id = v_med
           AND pli.unit_id     = v_unit;

        IF v_ref_price IS NULL THEN
          RAISE EXCEPTION 'SALE_PRICE_REFERENCE_MISSING: الصنف % بلا سعر في قائمة بيع افتراضية', v_med
            USING ERRCODE = '22023';
        END IF;
        IF v_price < v_ref_price THEN
          RAISE EXCEPTION 'SALE_PRICE_BELOW_REFERENCE: سعر الصنف % (%) أدنى من السعر المرجعي (%)',
            v_med, v_price, v_ref_price
            USING ERRCODE = '22023';
        END IF;

        -- التخصيص يرفع FEFO_INSUFFICIENT_STOCK فيُرجع المعاملة كلها بلا أثر، ولو
        -- كان سطر سابق قد خُصّص وسُجّلت حركته بالفعل.
        FOR v_alloc IN SELECT * FROM app.allocate_fefo(v_tenant, p_warehouse, v_med, v_qty)
        LOOP
          INSERT INTO stock_movements
            (tenant_id, warehouse_id, location_id, medicine_id, batch_id,
             movement_type, qty_delta, unit_cost, ref_type, ref_id, created_by)
          VALUES
            (v_tenant, p_warehouse, v_alloc.location_id, v_med, v_alloc.batch_id,
             'sale', -v_alloc.qty, v_alloc.unit_cost, 'sales_invoice', v_invoice, v_user);

          v_allocations := v_allocations || jsonb_build_object(
            'medicine_id',    v_med,
            'stock_batch_id', v_alloc.stock_batch_id,
            'batch_id',       v_alloc.batch_id,
            'batch_no',       v_alloc.batch_no,
            'expiry_date',    v_alloc.expiry_date,
            'location_id',    v_alloc.location_id,
            'qty',            v_alloc.qty,
            'unit_cost',      v_alloc.unit_cost);
        END LOOP;

        INSERT INTO sales_invoice_items
          (tenant_id, invoice_id, medicine_id, unit_id, qty, unit_price, line_total)
        VALUES
          (v_tenant, v_invoice, v_med, v_unit, v_qty, v_price, v_line_total)
        RETURNING id INTO v_item;

        v_out_items := v_out_items || jsonb_build_object(
          'item_id',     v_item,
          'medicine_id', v_med,
          'unit_id',     v_unit,
          'qty',         v_qty,
          'unit_price',  v_price,
          'line_total',  v_line_total);
      END LOOP;

      RETURN jsonb_build_object(
        'invoice_id',  v_invoice,
        'doc_number',  v_doc,
        'total',       v_subtotal,
        'replayed',    false,
        'items',       v_out_items,
        'allocations', v_allocations);
    END IF;

    -- سباق نادر: خسرنا حجز المفتاح لمعاملة متزامنة بدأت قبلا. نقرأ فاتورتها
    -- ونعيدها بلا أي تخصيص إضافي (رقم المستند المستهلك هنا هو ثمن السباق وحده).
    SELECT i.id, i.status INTO v_invoice, v_status
      FROM sales_invoices i
     WHERE i.tenant_id = v_tenant AND i.idempotency_key = v_key;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SALE_IDEMPOTENCY_STATE: مفتاح % محجوز بلا فاتورة', v_key
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- مسار الإعادة: نفس المفتاح يعود بنفس الفاتورة، بشرطها وبنودها نفسها.
  IF v_status <> 'confirmed' THEN
    RAISE EXCEPTION 'SALE_IDEMPOTENCY_CONFLICT: الفاتورة % ليست مؤكدة (حالتها %)', v_invoice, v_status
      USING ERRCODE = '23505';
  END IF;

  SELECT i.doc_number, i.total, i.customer_id, i.warehouse_id
    INTO v_doc, v_total, v_prev_cust, v_prev_wh
    FROM sales_invoices i
   WHERE i.tenant_id = v_tenant AND i.id = v_invoice;

  -- المقارنة كمجموعة لا كترتيب: إعادة الإرسال قد تعيد ترتيب الأسطر نفسه.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'medicine_id', it.medicine_id,
           'unit_id',     it.unit_id,
           'qty',         it.qty,
           'unit_price',  it.unit_price)
         ORDER BY it.medicine_id, it.unit_id, it.qty, it.unit_price), '[]'::jsonb)
    INTO v_prev_items
    FROM sales_invoice_items it
   WHERE it.tenant_id = v_tenant AND it.invoice_id = v_invoice;

  IF v_prev_cust <> p_customer
     OR v_prev_wh <> p_warehouse
     OR v_prev_items <> (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'medicine_id', (e->>'medicine_id')::uuid,
                   'unit_id',     (e->>'unit_id')::uuid,
                   'qty',         (e->>'qty')::numeric,
                   'unit_price',  (e->>'unit_price')::numeric)
                 ORDER BY (e->>'medicine_id')::uuid, (e->>'unit_id')::uuid,
                          (e->>'qty')::numeric, (e->>'unit_price')::numeric), '[]'::jsonb)
            FROM jsonb_array_elements(v_items) AS e) THEN
    RAISE EXCEPTION 'SALE_IDEMPOTENCY_KEY_REUSED: المفتاح % أُستخدم لبيع آخر ببيانات مختلفة', v_key
      USING ERRCODE = '23505';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'item_id',     it.id,
           'medicine_id', it.medicine_id,
           'unit_id',     it.unit_id,
           'qty',         it.qty,
           'unit_price',  it.unit_price,
           'line_total',  it.line_total)
         ORDER BY it.medicine_id, it.unit_id, it.qty, it.unit_price, it.id), '[]'::jsonb)
    INTO v_out_items
    FROM sales_invoice_items it
   WHERE it.tenant_id = v_tenant AND it.invoice_id = v_invoice;

  -- لا رابط بين الحركة وسطرها، فتُعاد التخصيصات مسطّحة بترتيب (صنف، انتهاء) نفسه
  -- الذي تُنتج به في الإنشاء الأول.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'medicine_id',    m.medicine_id,
           'stock_batch_id', sb.id,
           'batch_id',       m.batch_id,
           'batch_no',       b.batch_no,
           'expiry_date',    b.expiry_date,
           'location_id',    m.location_id,
           'qty',            -m.qty_delta,
           'unit_cost',      m.unit_cost)
         ORDER BY m.medicine_id, b.expiry_date, b.batch_no, sb.id), '[]'::jsonb)
    INTO v_allocations
    FROM stock_movements m
    JOIN batches b ON b.tenant_id = m.tenant_id AND b.id = m.batch_id
    JOIN stock_batches sb
      ON sb.tenant_id    = m.tenant_id
     AND sb.warehouse_id = m.warehouse_id
     AND sb.location_id  = m.location_id
     AND sb.batch_id     = m.batch_id
   WHERE m.tenant_id     = v_tenant
     AND m.ref_type      = 'sales_invoice'
     AND m.ref_id        = v_invoice
     AND m.movement_type = 'sale';

  RETURN jsonb_build_object(
    'invoice_id',  v_invoice,
    'doc_number',  v_doc,
    'total',       v_total,
    'replayed',    true,
    'items',       v_out_items,
    'allocations', v_allocations);
END $$;

-- التوقيع القديم لسطر واحد يبقى ويعود أثرًا رقيقًا فوق الدالة أعلاه، فلا يبقى
-- مساران لخصم المخزون ولا ينكسر أي نداء قائم.
CREATE OR REPLACE FUNCTION app.post_sale(
  p_customer uuid, p_warehouse uuid, p_medicine uuid, p_unit uuid,
  p_qty numeric, p_unit_price numeric, p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE
  v_sale jsonb;
BEGIN
  v_sale := app.post_sale(
    p_customer, p_warehouse,
    jsonb_build_array(jsonb_build_object(
      'medicine_id', p_medicine,
      'unit_id',     p_unit,
      'qty',         p_qty,
      'unit_price',  p_unit_price)),
    p_idempotency_key);

  RETURN jsonb_build_object(
    'invoice_id',  v_sale->'invoice_id',
    'item_id',     v_sale->'items'->0->'item_id',
    'doc_number',  v_sale->'doc_number',
    'total',       v_sale->'total',
    'replayed',    v_sale->'replayed',
    'allocations', v_sale->'allocations');
END $$;
-- ---- [21] ----
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

-- ---- [21] ----
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

-- ---- [21] ----
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

-- حارس الصرف على مسار الحركة نفسه.
-- allocate_fefo تختار من الصالح فقط، لكن stock_movements جدول يقبل الإدراج
-- مباشرة من دور التطبيق: بلا هذا الحارس تُقبل حركة «sale» على تشغيلة منتهية
-- أو محجوبة وتُخصم من الرصيد، فتتجاوز FEFO بكتابة صف واحد. الفحص هنا لا
-- يمكن تجاوزه لأن كل تغيير رصيد يمر بجدول الحركات (UPDATE على stock_batches
-- مسحوب من slamtak_app).
-- مقصور على «sale» عمدًا: إتلاف/شطب المنتهي (damage/expiry) ومرتجع المورد
-- مسارات مشروعة على التشغيلة نفسها، فلا يغلقها الحارس ويترك الكاتب بلا طريق
-- للتخلص من دواء منتهٍ مسجل.
CREATE OR REPLACE FUNCTION app.guard_dispense_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_expiry       date;
  v_batch_status text;
  v_stock_status text;
BEGIN
  SELECT b.expiry_date, b.status, sb.status
    INTO v_expiry, v_batch_status, v_stock_status
    FROM stock_batches sb
    JOIN batches b ON b.tenant_id = sb.tenant_id AND b.id = sb.batch_id
   WHERE sb.tenant_id    = NEW.tenant_id
     AND sb.warehouse_id = NEW.warehouse_id
     AND sb.location_id  = NEW.location_id
     AND sb.batch_id     = NEW.batch_id;

  -- صف رصيد مفقود: الحكم يبقى لقيد qty_on_hand (23514) كما كان، فلا نغيّر السلوك.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_expiry <= CURRENT_DATE THEN
    RAISE EXCEPTION 'DISPENSE_EXPIRED_BATCH: التشغيلة تنتهي في % ولا تُصرف', v_expiry
      USING ERRCODE = '23514';
  END IF;

  IF v_batch_status <> 'active' THEN
    RAISE EXCEPTION 'DISPENSE_BLOCKED_BATCH: حالة التشغيلة «%» تمنع الصرف', v_batch_status
      USING ERRCODE = '23514';
  END IF;

  IF v_stock_status <> 'available' THEN
    RAISE EXCEPTION 'DISPENSE_BLOCKED_STOCK: حالة الرصيد «%» تمنع الصرف', v_stock_status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

-- دالة مشغّل لا ينفّذها أحد مباشرة؛ EXECUTE لـPUBLIC ممنوع كبقية دوال app.
REVOKE ALL ON FUNCTION app.guard_dispense_movement() FROM PUBLIC;

CREATE TRIGGER trg_dispense_requires_usable_batch
  BEFORE INSERT ON stock_movements
  FOR EACH ROW WHEN (NEW.movement_type = 'sale')
  EXECUTE FUNCTION app.guard_dispense_movement();

-- ---- [21] ----
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

-- ---- [21] ----
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
-- ---- [22] ----
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

-- ---- [22] ----
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

-- ---- [22] ----
-- دور الهجرة/الـDDL. المِلْكية الفعلية للجداول تبقى لمالك القاعدة (postgres) لأن
-- منح المِلْكية لدور آخر يكسر مسار الهجرات؛ فيملك هذا الدور ما يحتاجه للـDDL والتصحيح.
-- لا عضوية لـCURRENT_USER: الدور بلا LOGIN، وتُمنح عضويته لهوية CI عند وجودها.
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

-- ---- [22] ----
-- دور لوحة المنصة: platform فقط، وصفر على بيانات الأعمال.
-- بلا USAGE على app عمدًا: USAGE هناك يفتح استدعاء دوال التطبيق (ومعها تزويد المخازن).
-- التزويد يبقى لدور الهجرة/المالك، لا للوحة المنصة.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'slamtak_platform') THEN
    CREATE ROLE slamtak_platform NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA platform TO slamtak_platform;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA platform TO slamtak_platform;
-- لا DELETE: الاشتراكات وسجلات المنصة لا تُحذف من اللوحة (append-only عبر trigger).
REVOKE ALL ON SCHEMA public, app FROM slamtak_platform;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM slamtak_platform;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM slamtak_platform;

-- ---- [22] ----
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

-- ---- [22] ----
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

-- ---- [22] ----
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

-- ---- [22] ----
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY permissions_read_all ON permissions
  FOR SELECT TO slamtak_app USING (true);

-- ---- [22] ----
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

-- ---- [22] ----
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

-- ---- [22] ----
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
-- ---- [29] ----
INSERT INTO permissions (code, module, description, is_dangerous) VALUES
  -- catalog
  ('catalog.read',             'catalog',    'قراءة كتالوج الأصناف والأسعار',              false),
  ('catalog.create',           'catalog',    'إضافة صنف جديد',                              false),
  ('catalog.update',           'catalog',    'تعديل بيانات صنف',                            false),
  ('catalog.delete',           'catalog',    'حذف أو تعطيل صنف',                            true),
  ('catalog.price.read',       'catalog',    'قراءة أسعار البيع والتكلفة',                  false),
  ('catalog.price.update',     'catalog',    'تعديل سعر بيع أو تكلفة (يتطلب Step-Up)',      true),
  ('catalog.import',           'catalog',    'استيراد كتالوج من ملف',                       false),
  -- inventory (بلا transfer: ADR-025)
  ('inventory.read',           'inventory',  'قراءة الأرصدة والتشغيلات',                    false),
  ('inventory.movement.read',  'inventory',  'قراءة دفتر الحركات',                          false),
  ('inventory.adjust',         'inventory',  'تسوية رصيد بسبب موثق',                        true),
  ('inventory.count.create',   'inventory',  'بدء جرد فعلي',                                false),
  ('inventory.count.approve',  'inventory',  'اعتماد جرد وتسوية فرقه',                      true),
  ('inventory.batch.status',   'inventory',  'تغيير حالة تشغيلة (حجز/إتلاف)',               true),
  -- purchasing
  ('purchasing.read',          'purchasing', 'قراءة أوامر الشراء والموردين',                false),
  ('purchasing.order.create',  'purchasing', 'إنشاء أمر شراء',                              false),
  ('purchasing.order.approve', 'purchasing', 'اعتماد أمر شراء',                             true),
  ('purchasing.receipt.create','purchasing', 'تسجيل استلام بضاعة',                          false),
  ('purchasing.invoice.match', 'purchasing', 'مطابقة فاتورة المورد بالاستلام',              false),
  ('purchasing.return.create', 'purchasing', 'مرتجع إلى المورد',                            false),
  ('purchasing.supplier.manage','purchasing','إدارة بيانات الموردين',                       false),
  -- sales
  ('sales.read',               'sales',      'قراءة الفواتير والعملاء',                     false),
  ('sales.invoice.create',     'sales',      'إنشاء فاتورة بيع',                            false),
  ('sales.invoice.cancel',     'sales',      'إلغاء فاتورة (يتطلب Step-Up)',                true),
  ('sales.discount.apply',     'sales',      'تطبيق خصم داخل الحد المسموح',                 false),
  ('sales.discount.override',  'sales',      'تجاوز حد الخصم',                              true),
  ('sales.price.override',     'sales',      'تجاوز سعر القائمة',                           true),
  ('sales.credit.override',    'sales',      'تجاوز حد الائتمان',                           true),
  ('sales.return.create',      'sales',      'إنشاء مرتجع بيع',                             false),
  ('sales.return.approve',     'sales',      'اعتماد مرتجع بيع',                            true),
  ('sales.customer.manage',    'sales',      'إدارة بيانات العملاء',                        false),
  -- finance
  ('finance.read',             'finance',    'قراءة القيود والأرصدة المالية',               false),
  ('finance.journal.create',   'finance',    'إنشاء قيد يومية',                             false),
  ('finance.journal.post',     'finance',    'ترحيل قيد إلى الأستاذ',                       true),
  ('finance.period.close',     'finance',    'إغلاق فترة مالية',                            true),
  ('finance.cash.manage',      'finance',    'إدارة الخزائن والبنوك',                       true),
  ('finance.payment.record',   'finance',    'تسجيل دفعة',                                  false),
  ('finance.tax.report',       'finance',    'إعداد إقرار الضريبة',                         false),
  -- hr
  ('hr.employee.read',         'hr',         'قراءة ملفات الموظفين',                        false),
  ('hr.employee.manage',       'hr',         'إدارة الموظفين والعقود',                      false),
  ('hr.attendance.manage',     'hr',         'إدارة الحضور والانصراف',                      false),
  ('hr.payroll.read',          'hr',         'قراءة الرواتب',                               false),
  ('hr.payroll.write',         'hr',         'إعداد مسير الرواتب',                          false),
  ('hr.payroll.approve',       'hr',         'اعتماد وصرف الرواتب',                         true),
  -- delivery
  ('delivery.route.manage',    'delivery',   'إدارة خطوط التوصيل',                          false),
  ('delivery.task.assign',     'delivery',   'إسناد مهام التوصيل',                          false),
  ('delivery.task.complete',   'delivery',   'إتمام التوصيل وإثبات التسليم',                false),
  ('delivery.cod.reconcile',   'delivery',   'تسوية التحصيل عند التسليم',                   true),
  -- reports
  ('reports.read',             'reports',    'قراءة التقارير التشغيلية',                    false),
  ('reports.export',           'reports',    'تصدير البيانات والتقارير (يتطلب Step-Up)',    true),
  ('reports.financial.read',   'reports',    'قراءة التقارير المالية',                      false),
  -- settings
  ('settings.tenant.update',   'settings',   'تعديل بيانات الحساب وإعداداته',               true),
  ('settings.warehouse.update','settings',   'تعديل بيانات المخزن وترخيصه',                 false),
  ('settings.integration.manage','settings',  'إدارة التكاملات والمفاتيح',                   true),
  ('settings.document.sequence','settings',  'إدارة ترقيم المستندات',                       false),
  ('tenant.owner.transfer',    'settings',   'نقل ملكية الحساب (المالك وحده)',               true),
  -- users
  ('users.user.read',          'users',      'قراءة المستخدمين والعضويات',                  false),
  ('users.user.invite',        'users',      'دعوة مستخدم إلى الحساب',                      false),
  ('users.user.suspend',       'users',      'تعليق أو تفعيل مستخدم',                       true),
  ('users.role.manage',        'users',      'إنشاء وتعديل الأدوار',                        true),
  ('users.permission.grant',   'users',      'منح أو سحب صلاحية لمستخدم',                   true),
  -- audit / system
  ('audit.read',               'audit',      'قراءة سجل التدقيق',                           false),
  ('system.audit.write',       'system',     'كتابة سجل التدقيق من طبقة الخادم',            false),
  -- platform (لا تُمنح لأي دور مخزن)
  ('platform.tenant.manage',   'platform',   'إنشاء أو تعليق حسابات المخازن',               true),
  ('platform.plan.manage',     'platform',   'إدارة خطط الاشتراك',                          true),
  ('platform.subscription.manage','platform','إدارة الاشتراكات',                            true),
  ('platform.support.access',  'platform',   'وصول دعم بموافقة (Break-glass)',               true),
  ('platform.health.read',     'platform',   'قراءة صحة المنصة',                            false)
ON CONFLICT (code) DO UPDATE
  SET module       = EXCLUDED.module,
      description  = EXCLUDED.description,
      is_dangerous = EXCLUDED.is_dangerous;

-- ---- [29] ----
CREATE OR REPLACE FUNCTION app.seed_tenant_roles(p_tenant uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role   record;
  v_roles  int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant) THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND: %', p_tenant USING ERRCODE = '23503';
  END IF;

  -- 1) الأدوار العشرة
  FOR v_role IN
    SELECT * FROM (VALUES
      ('owner',      'المالك'),
      ('manager',    'مدير المخزن'),
      ('pharmacist', 'صيدلي'),
      ('cashier',    'كاشير'),
      ('keeper',     'أمين مخزن'),
      ('purchasing', 'مسؤول مشتريات'),
      ('accountant', 'محاسب'),
      ('rep',        'مندوب بيع'),
      ('driver',     'مندوب توصيل'),
      ('auditor',    'مدقق')
    ) AS t(code, name)
  LOOP
    INSERT INTO roles (tenant_id, code, name, is_system)
    VALUES (p_tenant, v_role.code, v_role.name, true)
    ON CONFLICT (tenant_id, code) DO NOTHING;
  END LOOP;

  -- 2) المالك: كل صلاحيات المخزن، وبلا أي صلاحية منصة
  INSERT INTO role_permissions (tenant_id, role_id, permission)
  SELECT p_tenant, r.id, p.code
  FROM roles r
  JOIN permissions p ON p.module <> 'platform'
  WHERE r.tenant_id = p_tenant AND r.code = 'owner'
  ON CONFLICT DO NOTHING;

  -- 3) المدير: التشغيل الكامل ما عدا سلطات المالك والفصل المالي
  INSERT INTO role_permissions (tenant_id, role_id, permission)
  SELECT p_tenant, r.id, p.code
  FROM roles r
  JOIN permissions p ON p.module <> 'platform'
  WHERE r.tenant_id = p_tenant
    AND r.code = 'manager'
    AND p.code <> ALL (ARRAY[
      'tenant.owner.transfer',
      'catalog.price.update',
      'finance.journal.post',
      'finance.period.close',
      'hr.payroll.approve'
    ])
  ON CONFLICT DO NOTHING;

  -- 4) بقية الأدوار: قائمة صريحة لكل دور (مطابقة 12 §8)
  FOR v_role IN
    SELECT * FROM (VALUES
      ('pharmacist', ARRAY[
        'catalog.read', 'inventory.read', 'inventory.movement.read',
        'purchasing.read', 'sales.read', 'sales.invoice.create',
        'sales.discount.apply', 'sales.return.create', 'sales.return.approve',
        'reports.read']),
      ('cashier', ARRAY[
        'catalog.read', 'inventory.read', 'sales.read',
        'sales.invoice.create', 'sales.discount.apply']),
      ('keeper', ARRAY[
        'catalog.read', 'inventory.read', 'inventory.movement.read',
        'inventory.adjust', 'inventory.count.create',
        'purchasing.read', 'purchasing.receipt.create', 'reports.read']),
      ('purchasing', ARRAY[
        'catalog.read', 'inventory.read', 'reports.read',
        'purchasing.read', 'purchasing.order.create', 'purchasing.order.approve',
        'purchasing.receipt.create', 'purchasing.invoice.match',
        'purchasing.return.create', 'purchasing.supplier.manage']),
      ('accountant', ARRAY[
        'catalog.price.read', 'inventory.read', 'purchasing.read', 'sales.read',
        'finance.read', 'finance.journal.create', 'finance.journal.post',
        'finance.period.close', 'finance.cash.manage', 'finance.payment.record',
        'finance.tax.report',
        'reports.read', 'reports.export', 'reports.financial.read']),
      ('rep', ARRAY[
        'catalog.read', 'catalog.price.read', 'sales.read',
        'sales.invoice.create', 'sales.discount.apply', 'sales.customer.manage']),
      ('driver', ARRAY[
        'delivery.route.manage', 'delivery.task.assign',
        'delivery.task.complete', 'delivery.cod.reconcile']),
      ('auditor', ARRAY[
        'catalog.read', 'inventory.read', 'inventory.movement.read',
        'purchasing.read', 'sales.read', 'finance.read', 'audit.read',
        'reports.read', 'reports.export', 'reports.financial.read'])
    ) AS t(code, perms)
  LOOP
    INSERT INTO role_permissions (tenant_id, role_id, permission)
    SELECT p_tenant, r.id, x.permission
    FROM roles r
    CROSS JOIN unnest(v_role.perms) AS x(permission)
    WHERE r.tenant_id = p_tenant AND r.code = v_role.code
    ON CONFLICT DO NOTHING;
  END LOOP;

  SELECT count(*) INTO v_roles
  FROM roles WHERE tenant_id = p_tenant AND is_system;

  RETURN v_roles;
END $$;

-- التزويد يقتصر على دور الهجرة/المالك (المُنشئ للحساب). لوحة المنصة لا تنفّذ هذه الدالة:
-- بلا USAGE على app لا يمكن استدعاؤها، ومنحها USAGE يفتح بقية دوال التطبيق.
REVOKE ALL ON FUNCTION app.seed_tenant_roles(uuid) FROM PUBLIC;

-- ---- [29] ----
INSERT INTO platform.plans (code, name, monthly_price, features) VALUES
  ('free', 'المجاني', 0, '{}'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- ---- [22] ----
-- PostgreSQL يمنح EXECUTE لـPUBLIC افتراضيًا على كل دالة جديدة. هذا يجعل أي دور
-- (حتى anon عبر PostgREST) قادرًا على استدعاء دوال التطبيق. نغلق الافتراضي ثم نمنح
-- الدور التطبيقي ما ينفّذه فعليًا. دوال السياق مرجعية للـRLS، فحجبها يوقف كل قراءة.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO slamtak_app;
GRANT EXECUTE ON FUNCTION app.current_user_id() TO slamtak_app;
GRANT EXECUTE ON FUNCTION app.current_warehouse_id() TO slamtak_app;
GRANT EXECUTE ON FUNCTION app.has_permission(text) TO slamtak_app;
GRANT EXECUTE ON FUNCTION app.apply_stock_movement() TO slamtak_app;
GRANT EXECUTE ON FUNCTION app.next_document_number(uuid, text, int) TO slamtak_app;
GRANT EXECUTE ON FUNCTION app.record_login_attempt(text, inet, boolean, text) TO slamtak_app;
-- تخصيص FEFO: للتطبيق وحده، وPUBLIC ممنوع صراحةً لأن الدالة SECURITY DEFINER.
REVOKE ALL ON FUNCTION app.allocate_fefo(uuid, uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.allocate_fefo(uuid, uuid, uuid, numeric) TO slamtak_app;
-- ترحيل البيع: المسار الوحيد الذي يخصم مقابل فاتورة، ولا يُنفَّذ إلا للتطبيق.
REVOKE ALL ON FUNCTION app.post_sale(uuid, uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.post_sale(uuid, uuid, jsonb, text) TO slamtak_app;
-- غلاف السطر الواحد فوق الدالة نفسها، فلا يُترك توقيع قائم بلا منح.
REVOKE ALL ON FUNCTION app.post_sale(uuid, uuid, uuid, uuid, numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.post_sale(uuid, uuid, uuid, uuid, numeric, numeric, text) TO slamtak_app;
