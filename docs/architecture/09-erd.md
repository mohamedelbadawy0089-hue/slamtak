# 09 — ERD Diagram

> المخطط مقسّم حسب النطاق ليبقى قابلًا للقراءة. كل جدول أعمال يحمل `tenant_id` (مُخفَّض من الرسوم لتقليل الضجيج، ما عدا الحدّ الأساسي). الأنواع: `uuid` للمفاتيح، `numeric` للمبالغ والكميات، `timestamptz` للوقت.

---

## 1. العمود الفقري (Tenancy & Identity)

```mermaid
erDiagram
    tenants ||--o{ tenant_settings : "has"
    tenants ||--o{ tenant_features : "enables"
    tenants ||--|| warehouses : "owns (ADR-025)"
    tenants ||--o{ tenant_memberships : "employs"
    tenants ||--o{ document_sequences : "numbers"
    warehouses ||--o{ storage_locations : "splits into"
    users ||--o{ tenant_memberships : "joins"
    users ||--o{ sessions : "opens"
    users ||--o{ user_mfa : "protects"
    tenant_memberships ||--o{ user_roles : "granted"
    roles ||--o{ role_permissions : "bundles"
    permissions ||--o{ role_permissions : "included in"
    roles ||--o{ user_roles : "assigned"

    tenants {
        uuid id PK
        text name
        text status
        uuid plan_id
        timestamptz trial_ends_at
    }
    warehouses {
        uuid id PK
        uuid tenant_id FK "UNIQUE"
        text code "MAIN"
        text name
        text license_no
        boolean is_active
    }
    users {
        uuid id PK
        text email UK
        text password_hash
        boolean is_active
    }
    tenant_memberships {
        uuid id PK
        uuid tenant_id FK
        uuid user_id FK
        uuid warehouse_id FK
        text status
    }
    roles {
        uuid id PK
        uuid tenant_id FK
        text code
        boolean is_system
    }
    user_roles {
        uuid id PK
        uuid tenant_id FK
        uuid membership_id FK
        uuid role_id FK
    }
```

**قاعدة:** `users` بلا `tenant_id` (هوية عالمية)، و`tenant_memberships` هي مصدر الحقيقة للتفويض. لا يجوز أن تحمل الجلسة `tenant_id` دون عضوية نشطة مقابلة.

---

## 2. كتالوج الأصناف

```mermaid
erDiagram
    medicine_categories ||--o{ medicine_categories : "parent of"
    medicine_categories ||--o{ medicines : "classifies"
    medicines ||--o{ medicine_units : "sold in"
    units ||--o{ medicine_units : "measures"
    medicines ||--o{ barcodes : "identified by"
    medicines ||--o{ medicine_alternatives : "alternative"
    price_lists ||--o{ price_list_items : "prices"
    medicines ||--o{ price_list_items : "listed in"
    medicines ||--o{ prices_history : "audited"
    promotions ||--o{ promotion_items : "applies to"

    medicines {
        uuid id PK
        uuid tenant_id FK
        text sku UK
        text name_ar
        text name_en
        text eda_registration_no
        uuid base_unit_id FK
        boolean is_controlled
        smallint controlled_schedule
        numeric max_public_price
        numeric vat_rate
    }
    medicine_units {
        uuid id PK
        uuid medicine_id FK
        uuid unit_id FK
        numeric conversion_factor
        boolean is_default_sale
    }
    barcodes {
        uuid id PK
        uuid medicine_id FK
        text code UK
        text symbology
    }
    price_list_items {
        uuid id PK
        uuid price_list_id FK
        uuid medicine_id FK
        numeric price
        timestamptz valid_from
    }
    prices_history {
        uuid id PK
        uuid medicine_id FK
        numeric old_price
        numeric new_price
        uuid changed_by
        text reason
    }
```

---

## 3. المخزون والتشغيلات (القلب)

```mermaid
erDiagram
    medicines ||--o{ batches : "produced in"
    suppliers ||--o{ batches : "supplied"
    batches ||--o{ stock_batches : "stocked as"
    warehouses ||--o{ stock_batches : "holds"
    storage_locations ||--o{ stock_batches : "located at"
    stock_batches ||--o{ stock_movements : "moved by"
    stock_movements }o--|| movement_types : "typed"
    stock_counts ||--o{ stock_count_items : "counts"
    batches ||--o{ batch_status_history : "status changes"

    batches {
        uuid id PK
        uuid tenant_id FK
        uuid medicine_id FK
        text batch_no
        date expiry_date
        date production_date
        uuid supplier_id FK
        numeric landed_cost
        text status
    }
    stock_batches {
        uuid id PK
        uuid tenant_id FK
        uuid warehouse_id FK
        uuid location_id FK
        uuid medicine_id FK
        uuid batch_id FK
        numeric qty_on_hand
        numeric qty_reserved
        text status
    }
    stock_movements {
        uuid id PK
        uuid tenant_id FK
        uuid stock_batch_id FK
        text type
        numeric qty_delta
        text ref_type
        uuid ref_id
        uuid created_by
        timestamptz created_at
    }
    stock_counts {
        uuid id PK
        uuid tenant_id FK
        uuid warehouse_id FK
        text status
        timestamptz approved_at
    }
```

**قواعد سلامة:**
- `UNIQUE (tenant_id, medicine_id, batch_no, expiry_date)` على `batches`.
- `CHECK (qty_reserved <= qty_on_hand)` و`CHECK (qty_on_hand >= 0)`.
- `stock_movements` لا تُحدَّث ولا تُحذف (append-only).
- `ref_type/ref_id` يربط الحركة بمصدرها (فاتورة/استلام/تحويل/جرد/مرتجع) بلا FK صارم متعدد الجداول — يُتحقَّق في الخدمة ويُدقَّق بمهمة تحقق دورية.

---

## 4. المشتريات والتوريد

```mermaid
erDiagram
    suppliers ||--o{ purchase_orders : "receives"
    purchase_orders ||--o{ purchase_order_items : "contains"
    purchase_orders ||--o{ goods_receipts : "fulfilled by"
    goods_receipts ||--o{ goods_receipt_items : "contains"
    goods_receipt_items }o--|| batches : "creates"
    suppliers ||--o{ supplier_invoices : "bills"
    supplier_invoices ||--o{ supplier_invoice_items : "contains"
    supplier_invoices ||--o{ supplier_payments : "settled by"
    goods_receipts ||--o{ supplier_invoices : "matched to"
    suppliers ||--o{ supplier_returns : "returns"
    suppliers ||--o{ supplier_ledger : "posted to"

    purchase_orders {
        uuid id PK
        uuid tenant_id FK
        uuid supplier_id FK
        text doc_number UK
        text status
        numeric total
    }
    goods_receipts {
        uuid id PK
        uuid tenant_id FK
        uuid purchase_order_id FK
        uuid warehouse_id FK
        text doc_number UK
        text status
        timestamptz received_at
    }
    goods_receipt_items {
        uuid id PK
        uuid receipt_id FK
        uuid medicine_id FK
        uuid batch_id FK
        numeric qty
        numeric free_qty
        numeric unit_cost
    }
    supplier_invoices {
        uuid id PK
        uuid tenant_id FK
        uuid supplier_id FK
        uuid receipt_id FK
        text doc_number
        numeric subtotal
        numeric vat_amount
        numeric total
        text match_status
    }
```

**قاعدة المطابقة الثلاثية:** فاتورة المورد تُعتمد فقط عند مطابقة (أمر شراء ↔ مستند استلام ↔ فاتورة) داخل حدود تفاوت مضبوطة؛ الفرق يُسجَّل كـ `match_variance`.

---

## 5. المبيعات والتوزيع

```mermaid
erDiagram
    customers ||--o{ sales_invoices : "buys"
    customers ||--o{ customer_ledger : "posted to"
    customers ||--o{ customer_licenses : "licensed"
    sales_reps ||--o{ customers : "serves"
    sales_invoices ||--o{ sales_invoice_items : "contains"
    sales_invoice_items }o--|| batches : "consumes"
    sales_invoices ||--o{ customer_payments : "settled by"
    sales_invoices ||--o{ sales_returns : "returned"
    sales_returns ||--o{ sales_return_items : "contains"
    sales_orders ||--o{ sales_order_items : "contains"
    sales_orders ||--o{ sales_invoices : "invoiced as"
    sales_invoices ||--o{ delivery_tasks : "delivered by"
    delivery_routes ||--o{ delivery_tasks : "scheduled in"
    delivery_tasks ||--o{ delivery_proofs : "proven by"

    customers {
        uuid id PK
        uuid tenant_id FK
        text code UK
        text name
        text type
        numeric credit_limit
        int payment_terms_days
        uuid price_list_id FK
        uuid rep_id FK
    }
    sales_invoices {
        uuid id PK
        uuid tenant_id FK
        uuid warehouse_id FK
        uuid customer_id FK
        text doc_number UK
        text status
        numeric subtotal
        numeric discount_total
        numeric vat_amount
        numeric total
        numeric paid_amount
        int version
    }
    sales_invoice_items {
        uuid id PK
        uuid invoice_id FK
        uuid medicine_id FK
        uuid batch_id FK
        numeric qty
        numeric unit_price
        numeric discount
        numeric line_total
    }
    sales_returns {
        uuid id PK
        uuid tenant_id FK
        uuid invoice_id FK
        text doc_number UK
        text reason
        numeric total
        text status
    }
    delivery_tasks {
        uuid id PK
        uuid tenant_id FK
        uuid invoice_id FK
        uuid route_id FK
        uuid driver_id FK
        text status
        numeric cod_amount
    }
```

**قواعد:** لا فاتورة بلا `batch_id` في كل سطر (FEFO يحدده الخادم)؛ `paid_amount <= total`؛ المرتجع مرتبط بالفاتورة الأصلية والتشغيلة الأصلية.

---

## 6. المالية والمحاسبة

```mermaid
erDiagram
    accounts ||--o{ accounts : "parent of"
    accounts ||--o{ journal_entry_lines : "posted to"
    journal_entries ||--o{ journal_entry_lines : "balanced by"
    fiscal_periods ||--o{ journal_entries : "contains"
    cash_accounts ||--o{ cash_transactions : "records"
    bank_accounts ||--o{ cash_transactions : "records"
    tax_rates ||--o{ tax_reports : "reported in"
    journal_entries ||--o{ tax_reports : "included in"

    accounts {
        uuid id PK
        uuid tenant_id FK
        text code UK
        text name_ar
        text type
        uuid parent_id FK
        boolean is_postable
    }
    journal_entries {
        uuid id PK
        uuid tenant_id FK
        text doc_number UK
        date entry_date
        uuid period_id FK
        text source_type
        uuid source_id
        text status
        numeric total_debit
        numeric total_credit
    }
    journal_entry_lines {
        uuid id PK
        uuid entry_id FK
        uuid account_id FK
        numeric debit
        numeric credit
        text memo
    }
    fiscal_periods {
        uuid id PK
        uuid tenant_id FK
        date starts_on
        date ends_on
        text status
    }
```

**قيود إلزامية:** `debit = 0 OR credit = 0` لكل سطر؛ التوازن يُفرض بـ Trigger مؤجل (`CONSTRAINT TRIGGER`)؛ لا ترحيل إلى فترة مغلقة؛ القيود الناتجة عن الفواتير لا تُحذف بل تُعكس بقيد عكسي.

---

## 7. القوى العاملة والتوصيل

```mermaid
erDiagram
    employees ||--o{ employee_contracts : "signed"
    employees ||--o{ attendance_records : "attends"
    employees ||--o{ payroll_items : "paid in"
    payroll_runs ||--o{ payroll_items : "contains"
    payroll_runs ||--o{ payroll_settlements : "settles"
    drivers ||--o{ vehicles : "drives"
    drivers ||--o{ delivery_tasks : "assigned"

    employees {
        uuid id PK
        uuid tenant_id FK
        uuid user_id FK
        text employee_no UK
        text full_name
        date hired_on
    }
    payroll_runs {
        uuid id PK
        uuid tenant_id FK
        date period_start
        date period_end
        text status
        numeric total_net
    }
    payroll_items {
        uuid id PK
        uuid run_id FK
        uuid employee_id FK
        numeric gross
        numeric deductions
        numeric net
    }
    attendance_records {
        uuid id PK
        uuid employee_id FK
        date work_date
        timestamptz check_in
        timestamptz check_out
    }
```

---

## 8. النظام وإدارة المنصة

```mermaid
erDiagram
    outbox_events ||--o{ processed_events : "consumed as"
    tenants ||--o{ audit_logs : "produces"
    tenants ||--o{ notifications : "receives"
    plans ||--o{ subscriptions : "priced by"
    tenants ||--o{ subscriptions : "subscribes"
    subscriptions ||--o{ subscription_invoices : "billed"
    platform_users ||--o{ support_tickets : "handles"
    tenants ||--o{ support_tickets : "raises"

    outbox_events {
        uuid id PK
        uuid tenant_id FK
        text event_type
        text aggregate_type
        uuid aggregate_id
        jsonb payload
        timestamptz published_at
    }
    audit_logs {
        uuid id PK
        uuid tenant_id FK
        uuid actor_user_id
        text action
        text entity_type
        uuid entity_id
        jsonb before
        jsonb after
        uuid request_id
        timestamptz created_at
    }
    subscriptions {
        uuid id PK
        uuid tenant_id FK
        uuid plan_id FK
        text status
        date current_period_end
    }
    support_tickets {
        uuid id PK
        uuid tenant_id FK
        uuid platform_user_id
        text subject
        text status
    }
```

**قاعدة إدارة المنصة:** جداول `platform` في مخطط منفصل، ودور `slamtak_platform` لا يملك `SELECT` على جداول الأعمال. أي قراءة تجميعية تمر عبر دوال `SECURITY DEFINER` تُرجع مجاميع فقط (مثل عدد الأصناف، حجم البيانات) بلا محتوى تجاري.

---

## 9. العلاقات الحرجة وقواعد التكامل

| العلاقة | التعدد | قاعدة إلزامية |
|---|---|---|
| Tenant → Warehouse | 1:1 | **حساب واحد = مخزن واحد**؛ `UNIQUE (tenant_id)` يمنع الثاني (ADR-025) |
| Membership → Warehouse | N:1 | `warehouse_id` يُشتق من مخزن الحساب؛ FK مركّب يمنع مخزنًا آخر |
| Medicine → Batch | 1:N | تشغيلة لا تُنشأ بلا تاريخ انتهاء |
| Batch → StockBatch | 1:N | رصيد لكل (مخزن، موقع) |
| StockBatch → Movement | 1:N | كل تغيير رصيد له حركة |
| Customer → Invoice | 1:N | لا فاتورة لعميل موقوف |
| Invoice → Payment | 1:N | مجموع المدفوع ≤ الإجمالي |
| Invoice → JournalEntry | 1:1 (مصدر) | كل فاتورة معتمدة لها قيد |
| PurchaseOrder → Receipt | 1:N | لا استلام يتجاوز الكمية المتبقية |
| Receipt → SupplierInvoice | N:1 | مطابقة ثلاثية قبل الاعتماد |
| PayrollRun → Items | 1:N | مسودة → اعتماد → صرف (لا رجوع) |

### قواعد العزل في العلاقات
1. كل FK مركّب مع `tenant_id` — لا استثناء.
2. `ON DELETE RESTRICT` افتراضيًا؛ `CASCADE` مسموح فقط للجداول التابعة غير المالية (مثل `customer_contacts`).
3. حذف Tenant = أرشفة (Soft) لا حذف فيزيائي إلا بإجراء إداري موثق.
4. لا `REFERENCES` إلى جدول بلا `tenant_id` (باستثناء `units`/`permissions` العامة إن اعتمدناها كمرجع نظام).

---

## 10. قرارات مؤجلة (مقصودة)
- جداول **الإعلانات** و**الذكاء الاصطناعي** تُصمَّم في مرحلتها (تحتاج مراجعة نموذج البيانات مع حالات الاستخدام).
- **التكامل مع ETA** قد يحتاج جداول حالات إضافية (`einvoice_documents`, `einvoice_events`) — تُضاف كهجرة مستقلة في Phase 5.
- **الفوترة المتقدمة للاشتراكات** (Usage-based) تُصمَّم عند تحديد نموذج التسعير التجاري.

---

## 11. معايير قبول هذه الوثيقة
- [ ] كل نطاق له مخطط يوضح المفاتيح والعلاقات.
- [ ] كل علاقة حرجة لها قاعدة تكامل مكتوبة.
- [ ] لا علاقة ممكنة بين كيانين من مخزنين مختلفين.
- [ ] الجداول المؤجلة معلنة صراحة لا منسية.
