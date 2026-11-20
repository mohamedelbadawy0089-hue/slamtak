# 05 — قاعدة البيانات: التجاري · المالي · النظام · التقسيم والهجرات

> **يقابل:** «سادسًا» (الجزء الثاني) + قواعد «المعاملات، منع التكرار، عدم الحذف، Decimal».
> **المرجع المصاحب:** `08-database-architecture.md`, `21-reference-schema.md`, `24-business-flows.md`.

---

## 1. المشتريات والتوريد

### 1.1 `suppliers`
| العمود | النوع | القيود |
|---|---|---|
| `id`, `tenant_id` | uuid | `+ ق`; `UNIQUE (tenant_id, id)` |
| `code` | text | `UNIQUE (tenant_id, code)` |
| `name` | text | `NOT NULL` |
| `contact_person`, `phone`, `email`, `address` | text | `phone` مطلوب |
| `tax_id` | text | `NULL` |
| `payment_terms_days` | smallint | `DEFAULT 0`, `CHECK (>= 0)` |
| `credit_limit` | numeric(14,2) | `DEFAULT 0` |
| `balance` | numeric(14,2) | **مشتق من `supplier_ledger`، لا يُكتب يدويًا** |
| `status` | text | `CHECK IN ('active','inactive','blocked')` |
| `deleted_at` | timestamptz | حذف ناعم مشروط بعدم وجود رصيد/فواتير مفتوحة |

### 1.2 `purchases` (أمر/فاتورة شراء)
| العمود | النوع | القيود |
|---|---|---|
| `id`, `tenant_id` | uuid | `+ ق` |
| `purchase_no` | text | **`UNIQUE (tenant_id, purchase_no)`** |
| `supplier_id` | uuid | FK مركب، `NOT NULL` |
| `status` | text | `CHECK IN ('draft','ordered','partially_received','received','cancelled')` |
| `order_date` | date | `NOT NULL DEFAULT current_date` |
| `expected_date` | date | `NULL` |
| `subtotal`, `discount_total`, `tax_total`, `total` | numeric(14,2) | `NOT NULL DEFAULT 0`, `CHECK (>= 0)` |
| `paid_total`, `balance_due` | numeric(14,2) | `balance_due = total - paid_total` (View/Trigger) |
| `currency` | char(3) | `DEFAULT 'EGP'` |
| `notes` | text | |
| `approved_by`, `approved_at` | uuid/timestamptz | اعتماد قبل الاستلام حسب الصلاحية |

**حالات لا رجعة:** `cancelled` مسموح فقط قبل أي استلام؛ بعد الاستلام يُستخدم مرتجع شراء.
**فهارس:** `(tenant_id, order_date DESC)`, `(tenant_id, supplier_id, status)`, `(tenant_id, status)`.

### 1.3 `purchase_items`
| العمود | النوع | القيود |
|---|---|---|
| `id`, `tenant_id`, `purchase_id` | uuid | FK مركب `(tenant_id, purchase_id)` `ON DELETE RESTRICT` |
| `product_id` | uuid | FK مركب |
| `batch_no` | text | يُنشئ تشغيلة عند الاستلام |
| `expiry_date` | date | `NOT NULL` عند الاستلام |
| `qty_ordered` | numeric(14,3) | `CHECK (> 0)` |
| `qty_received` | numeric(14,3) | `DEFAULT 0`, `CHECK (0 <= qty_received <= qty_ordered)` |
| `unit_cost` | numeric(14,4) | `CHECK (>= 0)` |
| `discount_percent` | numeric(5,2) | `CHECK (BETWEEN 0 AND 100)` |
| `tax_rate` | numeric(5,2) | `DEFAULT 0` |
| `line_total` | numeric(14,2) | `GENERATED` من الكمية × التكلفة − الخصم + الضريبة |

**قيد حاسم:** `UNIQUE (tenant_id, purchase_id, product_id, batch_no)` — يمنع تكرار نفس التشغيلة في نفس الأمر.

---

## 2. المبيعات والمرتجعات

### 2.1 `customers`
| العمود | النوع | القيود |
|---|---|---|
| `id`, `tenant_id` | uuid | `+ ق` |
| `code` | text | `UNIQUE (tenant_id, code)` |
| `name` | text | `NOT NULL` |
| `customer_type` | text | `CHECK IN ('pharmacy','hospital','clinic','distributor','walk_in')` |
| `phone` | text | `UNIQUE (tenant_id, phone)` جزئي عند وجوده |
| `address`, `governorate` | text | |
| `credit_limit`, `balance` | numeric(14,2) | `balance` مشتق من `customer_ledger` |
| `tax_id` | text | `NULL` |
| `status` | text | `CHECK IN ('active','inactive','blocked')` |
| `deleted_at` | timestamptz | حذف ناعم |

### 2.2 `sales`
| العمود | النوع | القيود |
|---|---|---|
| `id`, `tenant_id` | uuid | `+ ق` |
| `invoice_no` | text | **`UNIQUE (tenant_id, invoice_no)`** |
| `customer_id` | uuid | `NULL` (بيع نقدي) / FK مركب |
| `status` | text | `CHECK IN ('draft','confirmed','partially_returned','returned','voided')` |
| `sale_date` | timestamptz | `NOT NULL DEFAULT now()` |
| `subtotal`, `discount_total`, `tax_total`, `total` | numeric(14,2) | `CHECK (>= 0)` |
| `paid_total`, `balance_due` | numeric(14,2) | |
| `payment_method` | text | `CHECK IN ('cash','card','credit','wallet','bank_transfer')` |
| `prescription_no` | text | إلزامي إذا كان أي صنف `prescription_required` |
| `pharmacist_id` | uuid | الصارف المسؤول |
| `voided_by`, `void_reason`, `voided_at` | — | **لا حذف**: الإلغاء حدث موثّق يعكس الحركات |

**قاعدة:** `confirmed` فقط هي التي تُنشئ حركات مخزون؛ `draft` لا تمسّ الرصيد.

### 2.3 `sales_items`
| العمود | النوع | القيود |
|---|---|---|
| `id`, `tenant_id`, `sale_id` | uuid | FK مركب `ON DELETE RESTRICT` |
| `product_id` | uuid | FK مركب |
| `qty` | numeric(14,3) | `CHECK (> 0)` |
| `unit_price` | numeric(14,2) | `CHECK (>= 0)` — لقطة وقت البيع |
| `discount_percent` | numeric(5,2) | `CHECK (BETWEEN 0 AND 100)` |
| `tax_rate` | numeric(5,2) | |
| `line_total` | numeric(14,2) | `GENERATED` |
| `cost_snapshot` | numeric(14,4) | تكلفة FEFO الفعلية لحساب هامش دقيق |

### 2.4 `sale_item_allocations` (تفصيل FEFO — القرار D-2)
`id, tenant_id, sale_item_id, batch_id, qty numeric(14,3) CHECK (>0), unit_cost numeric(14,4), movement_id uuid` · `UNIQUE (tenant_id, movement_id)`.
**الفائدة:** معرفة أي تشغيلة صُرفت بالضبط، وتكلفة البيع الحقيقية، وإمكانية المرتجع لنفس التشغيلة.

### 2.5 `returns` + `return_items`
| العمود | النوع | القيود |
|---|---|---|
| `id`, `tenant_id` | uuid | `+ ق` |
| `return_no` | text | `UNIQUE (tenant_id, return_no)` |
| `return_type` | text | `CHECK IN ('sales_return','purchase_return')` |
| `sale_id` / `purchase_id` | uuid | FK مركب، أحدهما فقط (CHECK) |
| `status` | text | `CHECK IN ('draft','approved','completed','rejected')` |
| `reason` | text | **`NOT NULL`** |
| `total` | numeric(14,2) | `CHECK (>= 0)` |
| `approved_by`, `approved_at` | — | اعتماد إلزامي |

`return_items`: `return_id, product_id, batch_id, qty (>0), unit_price, reason, restock boolean` — `restock=false` يعني إتلافًا (حركة `damage_out` وليس رجوعًا للمخزون)، وهو ما يمنع إعادة دواء مبرد/تالف إلى الرف.

---

## 3. حركات المخزون المُصحِّحة والتحويلات

### 3.1 `stock_adjustments` + `stock_adjustment_items`
| العمود | النوع | القيود |
|---|---|---|
| `id`, `tenant_id` | uuid | `+ ق` |
| `adjustment_no` | text | `UNIQUE (tenant_id, adjustment_no)` |
| `reason_code` | text | `CHECK IN ('damage','expiry','loss','count_correction','data_fix','sample','other')` |
| `status` | text | `CHECK IN ('draft','pending_approval','approved','rejected')` |
| `requested_by` | uuid | `NOT NULL` |
| `approved_by` | uuid | **`NOT NULL` عند `approved`** + `CHECK (approved_by <> requested_by)` |
| `total_cost_impact` | numeric(14,2) | أثر مالي للتوثيق |

`stock_adjustment_items`: `adjustment_id, product_id, batch_id, qty_delta numeric(14,3) CHECK (qty_delta <> 0), unit_cost, reason`.

**قاعدة فصل المهام:** من ينشئ التسوية لا يعتمدها. الصلاحية `inventory.adjustment.approve` منفصلة عن `inventory.adjustment.create`.

### 3.2 `stock_counts` + `stock_count_items`
`stock_counts`: `id, tenant_id, count_no UNIQUE(tenant_id,count_no), status ('draft','counting','review','posted','cancelled'), scope jsonb, started_at, posted_at, posted_by`.
`stock_count_items`: `count_id, product_id, batch_id, system_qty, counted_qty, variance GENERATED (counted - system), counted_by, counted_at, notes` · `UNIQUE (tenant_id, count_id, batch_id)`.
**الترحيل:** عند `posted` تُنشأ حركات `count_gain/count_loss` بقيمة الفرق فقط، وتُقفل الجرد.

### 3.3 `transfers` + `transfer_items`
`transfers`: `id, tenant_id, transfer_no, from_location, to_location, status ('draft','in_transit','received','cancelled'), requested_by, approved_by`.
`transfer_items`: `transfer_id, product_id, batch_id, qty, unit_cost`.
> بما أن `tenant ↔ warehouse` بنسبة 1:1، فالتحويلات تُستخدم للمناطق/الرفوف داخل المخزن (`warehouse_zones`) أو لاحقًا بين فروع عند تغيير القرار — التصميم يدعم الاثنين بلا تغيير.

---

## 4. الفواتير والمالية

### 4.1 `invoices` (سجل موحّد للفاتورة الضريبية/المستند)
| العمود | النوع | القيود |
|---|---|---|
| `id`, `tenant_id` | uuid | `+ ق` |
| `invoice_no` | text | `UNIQUE (tenant_id, invoice_no)` |
| `invoice_type` | text | `CHECK IN ('sales','purchase','sales_return','purchase_return')` |
| `source_id` | uuid | معرّف `sales/purchases/returns` |
| `issued_at` | timestamptz | `NOT NULL` |
| `subtotal`, `tax_total`, `total` | numeric(14,2) | `CHECK (>= 0)` |
| `tax_breakdown` | jsonb | تفصيل ضريبة القيمة المضافة المصرية |
| `e_invoice_uuid`, `e_invoice_status` | text | `NULL` — جاهز للربط بالمنظومة المصرية لاحقًا |
| `pdf_file_id` | uuid | FK إلى `files` |

**قاعدة عدم التكرار:** فاتورة واحدة لكل `(source_type, source_id)` — `UNIQUE (tenant_id, invoice_type, source_id)`.

### 4.2 `payments`
| العمود | النوع | القيود |
|---|---|---|
| `id`, `tenant_id` | uuid | `+ ق` |
| `payment_no` | text | `UNIQUE (tenant_id, payment_no)` |
| `direction` | text | `CHECK IN ('in','out')` |
| `party_type` | text | `CHECK IN ('customer','supplier','other')` |
| `party_id` | uuid | `NULL` مسموح لمصروف نقدي |
| `invoice_id` | uuid | `NULL` (دفعة على الحساب) |
| `amount` | numeric(14,2) | **`CHECK (amount > 0)`** |
| `method` | text | `CHECK IN ('cash','card','bank_transfer','wallet','cheque')` |
| `reference` | text | رقم الحوالة/الشيك |
| `paid_at` | timestamptz | `NOT NULL DEFAULT now()` |
| `status` | text | `CHECK IN ('posted','reversed')` |
| `reversal_of` | uuid | `NULL` — العكس لا الحذف |

**قيود:** مجموع الدفعات على فاتورة ≤ إجماليها (`CHECK` عبر Trigger)؛ الدفعة لا تُحذف، تُعكس.

### 4.3 `expenses`
`id, tenant_id, expense_no, category_code ('rent','salaries','utilities','transport','maintenance','marketing','other'), amount numeric(14,2) CHECK(>0), expense_date, payment_method, supplier_id NULL, description NOT NULL, receipt_file_id, approved_by, status ('draft','approved','paid')`.

### 4.4 دفاتر الأطراف (Append-only)
| الجدول | الغرض |
|---|---|
| `customer_ledger` | `tenant_id, customer_id, entry_type, debit, credit, balance_after, ref_type, ref_id, created_at` |
| `supplier_ledger` | نفس البنية للموردين |
| `cash_ledger` | `tenant_id, shift_id, opening, cash_in, cash_out, closing, variance` |

**قاعدة:** `balance` في `customers/suppliers` قيمة مُشتقة تُحدَّث بـ Trigger من الدفتر، وليست حقلًا يُكتب من الواجهة.

---

## 5. النظام والتشغيل

### 5.1 `notifications`
| العمود | النوع | القيود |
|---|---|---|
| `id`, `tenant_id` | uuid | `+ ق` |
| `user_id` | uuid | `NULL` = لكل المستخدمين المخوّلين |
| `type` | text | `CHECK IN ('low_stock','expiry_soon','expired','invoice_due','approval_request','security_alert','system')` |
| `title`, `body` | text | `NOT NULL` |
| `severity` | text | `CHECK IN ('info','warning','critical')` |
| `entity_type`, `entity_id` | text/uuid | للانتقال المباشر |
| `read_at` | timestamptz | `NULL` |
| `dedupe_key` | text | `UNIQUE (tenant_id, dedupe_key)` — يمنع تكرار نفس التنبيه |

### 5.2 `audit_logs` (Append-only، مُقسَّم)
| العمود | النوع | القيود |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | `NOT NULL` |
| `actor_id` | uuid | `NULL` للنظام |
| `actor_role` | text | لقطة الدور وقت الحدث |
| `action` | text | `'product.update'`, `'sale.void'`, `'login.failed'` … |
| `entity_type`, `entity_id` | text/uuid | |
| `before`, `after` | jsonb | **مع تنقية الأسرار وكلمات المرور** |
| `ip`, `user_agent` | inet/text | |
| `correlation_id` | text | |
| `created_at` | timestamptz | مفتاح التقسيم |

`REVOKE UPDATE, DELETE` + Trigger رافض + تقسيم شهري + احتفاظ 5 سنوات (قابل للتمديد).

### 5.3 `system_settings`
| العمود | النوع | القيود |
|---|---|---|
| `id`, `tenant_id` | uuid | **`UNIQUE (tenant_id)`** |
| `currency` | char(3) | `DEFAULT 'EGP'` |
| `vat_rate` | numeric(5,2) | `DEFAULT 14` |
| `fefo_enforced` | boolean | `DEFAULT true` (لا يُسمح بتعطيله) |
| `allow_negative_stock` | boolean | **`DEFAULT false` + `CHECK (allow_negative_stock = false)`** — ممنوع في المرحلة 1 |
| `expiry_alert_days` | smallint | `DEFAULT 90` |
| `low_stock_alert` | boolean | `DEFAULT true` |
| `invoice_prefix`, `next_invoice_no` | text/int | تُدار عبر `document_sequences` لا يدويًا |
| `print_template` | jsonb | |
| `updated_at` | timestamptz | |

### 5.4 جداول المنصة المساندة
| الجدول | الغرض | أعمدة مفتاحية |
|---|---|---|
| `document_sequences` | تسلسل مستقل لكل مستأجر/نوع/سنة | `PK (tenant_id, doc_type, year)`, `next_value bigint` — **يمنع تكرار الأرقام بين المخازن وبين السنوات** |
| `idempotency_keys` | منع تكرار الطلبات | `PK (tenant_id, key)`, `request_hash`, `response_snapshot jsonb`, `expires_at` |
| `app.jobs` | طابور المهام (Outbox) | `id, tenant_id, type, payload jsonb, status, attempts, run_after, locked_by, last_error` |
| `sessions` | جلسات قابلة للإبطال | `id, tenant_id, user_id, token_version, ip, user_agent, expires_at, revoked_at` |
| `login_attempts` | حماية من التخمين | `tenant_id, identifier, ip, success, created_at` |
| `feature_flags` | إطلاق تدريجي | `key, tenant_id NULL, enabled, rollout_percent` |
| `files` | بيانات وصفية للملفات | `id, tenant_id, entity_type, entity_id, storage_key, mime, size, checksum, uploaded_by` |

---

## 6. الفهرسة والأداء (ملخص تنفيذي)

| النمط | مثال | السبب |
|---|---|---|
| فهرس مركّب يبدأ بـ `tenant_id` | `(tenant_id, created_at DESC)` | كل استعلام مقيّد بالمستأجر |
| فهرس جزئي | `... WHERE status='active'` | تقليل الحجم |
| فهرس تغطية | `(tenant_id, product_id) INCLUDE (qty_on_hand, qty_reserved)` | تجنّب الرجوع للجدول |
| GIN نصي | `to_tsvector('simple', trade_name_ar || ' ' || scientific_name)` | بحث عربي |
| `pg_trgm` | `gin_trgm_ops` على الاسم | بحث تقريبي/أخطاء إملائية |
| فهرس FEFO | `(tenant_id, product_id, expiry_date) WHERE qty_on_hand > 0` | الصرف بأقرب انتهاء |
| فهرس المهام | `(status, run_after) WHERE status='pending'` | عامل الطابور |
| ممنوع | فهارس على أعمدة منخفضة الانتقائية منفردة | تكلفة كتابة بلا فائدة |

**قاعدة صارمة:** كل استعلام جديد يُرفق بـ `EXPLAIN (ANALYZE, BUFFERS)` في وصف الـ PR إذا مسّ جدولًا > مليون صف.

---

## 7. التقسيم والاحتفاظ والأرشفة

| الجدول | الاستراتيجية | الاحتفاظ | الأرشفة |
|---|---|---|---|
| `stock_movements` | RANGE شهري على `created_at` | 7 سنوات على الساخن | تصدير شهري إلى R2 (Parquet/CSV) بعد 7 سنوات، ويبقى ملخص |
| `audit_logs` | RANGE شهري | 5 سنوات | أرشيف مشفّر 10 سنوات |
| `notifications` | RANGE شهري | 12 شهرًا | حذف أقسام كاملة بعد التصدير |
| `login_attempts` | RANGE شهري | 6 أشهر | حذف أقسام |
| `sales/purchases` | بلا تقسيم حتى 10M صف | دائم | — |
| `inventory_balances` | بلا تقسيم | دائم | صف واحد لكل تشغيلة نشطة |

**إنشاء الأقسام:** `pg_cron` أسبوعيًا ينشئ أقسام +3 أشهر، ويُنبّه إذا فشل (قسم افتراضي ممتلئ = خطر أداء).
**حذف الأقسام:** وظيفة موقّعة تُسجّل في `audit_logs` قبل الحذف، ولا تعمل إلا بموافقة (تشغيل يدوي موثّق).

---

## 8. المعاملات والقواميس

| العملية | المعاملة الإلزامية | مستوى العزل |
|---|---|---|
| إنشاء فاتورة بيع | `sales` + `sales_items` + `allocations` + `stock_movements` + تحديث الأرصدة + `invoices` + job الإشعار | `READ COMMITTED` + `SELECT ... FOR UPDATE` على الأرصدة |
| استلام شراء | `purchases` + `items` + `batches` + `stock_movements` + `supplier_ledger` | `READ COMMITTED` + قفل التشغيلة |
| تسوية/جرد | `adjustments` + `movements` + `audit` + موافقة | `SERIALIZABLE` للجرد الكامل |
| ترحيل دفعات | `payments` + `customer/supplier_ledger` + تحديث `balance` | `READ COMMITTED` + قفل الطرف |
| تحويل | `transfers` + حركتان (`transfer_out`/`transfer_in`) + أرصدة | `SERIALIZABLE` عند تعدد المواقع |

**قواعد:**
1. لا معاملة تتجاوز 3 ثوانٍ؛ ما يزيد يُنقل إلى مهمة خلفية.
2. `statement_timeout = 5s`, `lock_timeout = 2s`, `idle_in_transaction_session_timeout = 10s` لكل جلسة API.
3. أي `serialization_failure` → إعادة محاولة تلقائية 3 مرات بتراجع أسّي (مع Idempotency key).
4. **لا `SELECT *`** في كود الإنتاج.
5. الدوال المخزّنة تُستخدم للقيود والتكامل فقط؛ منطق التسعير والخصم في الخدمات.

---

## 9. سياسة الهجرات (Migrations)

| القاعدة | التفصيل |
|---|---|
| الأدوات | `drizzle-kit generate` → ملف SQL مُراجع يدويًا → `drizzle-kit migrate` |
| التسمية | `YYYYMMDDHHMM_<slug>.sql` بترتيب زمني |
| Baseline | هجرة `0000_baseline.sql` تُولّد المخطط الكامل من الصفر (لأن 100+ هجرة حالية تراكمية) |
| الاتجاه | Expand → Migrate → Contract (إضافة عمود، تعبئة، ثم حذف القديم) |
| التراجع | كل هجرة لها خطة تراجع مكتوبة؛ لا `DROP COLUMN` في نفس الإصدار الذي يوقف استخدامه |
| البيانات | هجرات البيانات منفصلة عن هجرات المخطط، وقابلة للتشغيل مرتين (idempotent) |
| المراجعة | كل هجرة تُراجع من شخصين، وتُختبر على نسخة إنتاج مصغّرة قبل النشر |
| الحظر | ممنوع `ALTER TABLE ... ADD COLUMN NOT NULL` بلا `DEFAULT` على جدول كبير |
| RLS | كل جدول جديد يُنشئ هجرته الخاصة للسياسات، واختبار عزل يفشل إن نسيت |

---

## 10. معايير القبول

- [ ] كل جدول من الـ30 موثّق بأعمدته وقيوده (تم).
- [ ] `document_sequences` معتمد كحل وحيد لترقيم المستندات.
- [ ] لا حذف في `payments/invoices/sales/purchases/stock_movements/audit_logs` (سياسة + Trigger).
- [ ] كل عملية مالية موثّقة بمعاملة واحدة ومستوى عزل محدد.
- [ ] خطة Baseline + سياسة Expand/Contract معتمدة.
- [ ] قرار D-2 (تفصيل FEFO في الفاتورة) محسوم قبل تنفيذ `sale_item_allocations`.
