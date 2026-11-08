# 24 — مخططات التدفقات التشغيلية الأربعة

> **الحالة:** مكتمل — بند Gate B الثالث (جزء التدفقات).
> **الغرض:** تحويل قرارات `21` (المخطط) و`10` (الواجهة) إلى **تسلسل تنفيذي** يمكن اختباره خطوة بخطوة.
> **القاعدة:** كل خطوة في هذه المخططات تقابلها حركة مخزنية موثقة أو قيد محاسبي؛ لا خطوة «صامتة».

---

## 1. البيع (Sales) — تخصيص FEFO وترحيل الحركات

هذا التدفق هو **قلب النظام**: أي خطأ فيه يعني دواءً منتهيًا يُصرف، أو رصيدًا لا يطابق الواقع.

```mermaid
sequenceDiagram
    autonumber
    participant U as "أمين المخزن"
    participant UI as "شاشة البيع"
    participant API as "API"
    participant DB as "PostgreSQL"
    participant Q as "Outbox"

    U->>UI: يمسح الباركود ويُدخل الكمية
    UI->>API: GET /medicines?search=...
    API->>DB: بحث trigram مع RLS
    DB-->>API: الأدوية المتاحة
    API-->>UI: قائمة مع المتاح لكل دواء

    U->>UI: تأكيد الفاتورة
    UI->>API: POST /sales/invoices + Idempotency-Key
    API->>API: فحص sales.invoice.create والمخزن
    API->>DB: BEGIN + SET LOCAL app.tenant_id
    API->>DB: SELECT تشغيلات FOR UPDATE بترتيب FEFO
    DB-->>API: تشغيلات صالحة مرتبة بالانتهاء

    alt الرصيد الصالح أقل من المطلوب
        API->>DB: ROLLBACK
        API-->>UI: 409 INSUFFICIENT_STOCK مع المتاح الفعلي
        UI-->>U: رسالة عربية بالمتاح والمطلوب
    else الرصيد كافٍ
        API->>DB: تخصيص FEFO على التشغيلات
        API->>DB: INSERT stock_movements لكل تخصيص
        Note over DB: Trigger apply_stock_movement<br/>يخصم من stock_batches
        API->>DB: INSERT sales_invoice + lines + allocations
        API->>DB: قيد محاسبي + audit_log + outbox_event
        API->>DB: COMMIT
        API->>Q: إشعار غير متزامن بعد الالتزام
        API-->>UI: 201 مع allocations وETag
        UI-->>U: إذن صرف يظهر التشغيلة وتاريخ الانتهاء
    end
```

| الخطوة الحرجة | القاعدة المُلزمة | الاختبار المقابل |
|---|---|---|
| ترتيب التشغيلات | `ORDER BY expiry_date, created_at` (FEFO) | `T11` + اختبار وحدة `FEFO-1` |
| استبعاد المنتهي | `expiry_date > CURRENT_DATE` إلزامي | `FEFO-2` (منتهي لا يُخصص) |
| استبعاد المحجوب | `status = 'available'` فقط | `FEFO-3` |
| الرصيد السالب | `CHECK qty_on_hand >= 0` | `T6` |
| التزامن | `SELECT ... FOR UPDATE` على صفوف التشغيلات | `CONC-1` (فاتورتان متوازيتان) |
| التكرار | `Idempotency-Key` 24 ساعة | `IDEM-1` |

**لماذا `FOR UPDATE` وليس `ON CONFLICT`؟** لأن التخصيص يقرأ رصيدًا ثم يقرر؛ القراءة والكتابة يجب أن تكونا ذرّية. القفل على صف التشغيلة يمنع بيع نفس العلبة مرتين تحت التزامن. هذا بالضبط الخطأ الذي كشفه التشغيل الفعلي في `21` §9.1.

---

## 2. الاستلام من المورد (Goods Receipt)

```mermaid
sequenceDiagram
    autonumber
    participant S as "المورد"
    participant U as "أمين الاستلام"
    participant API as "API"
    participant DB as "PostgreSQL"

    S->>U: شحنة + فاتورة ورقية
    U->>API: GET /purchase-orders/{id}
    API-->>U: البنود والمتبقي
    U->>API: POST /goods-receipts + X-Step-Up
    API->>API: فحص purchasing.receipt.create + التصعيد
    API->>DB: BEGIN
    API->>DB: التحقق أن التشغيلة غير مكررة لنفس الدواء
    alt تشغيلة مكررة برقم مختلف
        API->>DB: إنشاء تشغيلة جديدة وربطها
    end
    API->>DB: INSERT stock_movements نوع purchase
    Note over DB: Trigger يزيد stock_batches
    API->>DB: تحديث receivedQty في أمر الشراء
    API->>DB: audit + outbox
    API->>DB: COMMIT
    API-->>U: 201 + أرقام التشغيلات
    U-->>S: توقيع الاستلام
```

| قاعدة | التفصيل |
|---|---|
| تاريخ الانتهاء إلزامي | لا استلام دواء بلا انتهاء — يمنع تلويث FEFO |
| رفض المنتهي عند الاستلام | `expiry_date > CURRENT_DATE + 30` افتراضيًا (قابل للضبط) |
| التكلفة تُحدَّث | `unit_cost` الجديدة تُستخدم في تقييم المخزون لاحقًا |
| المطابقة الثلاثية | فاتورة المورد تُقارن بأمر الشراء والاستلام → `varianceFlags` |

---

## 3. الجرد (Stock Count)

```mermaid
sequenceDiagram
    autonumber
    participant M as "مدير المخزن"
    participant C as "فريق الجرد"
    participant API as "API"
    participant DB as "PostgreSQL"

    M->>API: POST /stock/counts نطاق كامل أو جزئي
    API->>DB: قفل الأصناف المدرجة count_lock
    API-->>C: قائمة أصناف للجرد بلا أرصدة نظرية
    Note over C: لا يرى الفريق الرصيد النظري<br/>لمنع المطابقة العمياء
    C->>API: إدخال الكميات الفعلية
    API->>DB: حفظ counted_qty
    M->>API: POST /stock/counts/{id}/approve + سبب + X-Step-Up
    API->>DB: BEGIN
    API->>DB: حساب الفروقات
    loop كل فرق
        API->>DB: movement نوع count_gain أو count_loss
        Note over DB: Trigger يعدّل الرصيد
    end
    API->>DB: قيد محاسبي للفروقات + audit
    API->>DB: COMMIT
    API-->>M: 200 مع ملخص الفروقات
```

| ضابط | السبب |
|---|---|
| إخفاء الرصيد النظري عن الفريق | يمنع «الجرد المطابق» الذي يخفي الفقد |
| سبب إلزامي عند الاعتماد | مسؤولية موثقة |
| `X-Step-Up` | اعتماد الفروقات عملية عالية المخاطر |
| الفرق يُسجَّل كحركة لا كتعديل | يحفظ سلسلة التتبع الكاملة |

---

## 4. مرتجع البيع (Sales Return)

```mermaid
sequenceDiagram
    autonumber
    participant P as "الصيدلية"
    participant U as "أمين المخزن"
    participant API as "API"
    participant DB as "PostgreSQL"

    P->>U: إرجاع أصناف مع الفاتورة
    U->>API: POST /sales/returns مع invoiceId
    API->>DB: التحقق أن الفاتورة مؤكدة وغير ملغاة
    API->>DB: التحقق أن الكمية المرتجعة لا تتجاوز المصروفة
    alt restock = true
        API->>DB: movement نوع sale_return إلى نفس التشغيلة
        Note over DB: إرجاع للرصيد القابل للبيع
    else تالف أو سلسلة تبريد مكسورة
        API->>DB: movement نوع damage_writeoff
        Note over DB: لا يعود للرصيد القابل للبيع
    end
    API->>DB: إشعار دائن credit_note
    API->>DB: COMMIT
    API-->>U: 201
```

**حد أمني:** لا يمكن إرجاع كمية أكبر من المصروفة في نفس السطر؛ يُرفض بـ `422 VALIDATION_FAILED` مع تفصيل السطر. هذا يمنع تضخيم المخزون عبر مرتجعات وهمية — ثغرة شائعة في أنظمة المخازن.

---

## 5. آلة حالات المستندات (Document State Machines)

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> confirmed: confirm
    draft --> cancelled: cancel
    confirmed --> cancelled: cancel<br/>حركات عكسية
    confirmed --> [*]
    cancelled --> [*]
```

| الانتقال | من يملكه | أثر مخزني | أثر محاسبي |
|---|---|---|---|
| `draft → confirmed` | `sales.invoice.confirm` | خصم حركات | قيد إيراد |
| `confirmed → cancelled` | `sales.invoice.cancel` | حركات عكسية | قيد عكسي |

**لا يوجد انتقال `→ deleted`:** الحذف غير موجود في النظام. الإلغاء بحركات عكسية يحفظ التاريخ. هذا قرار معماري (ADR-011) وليس تفصيلًا.

---

## 6. ما يجعل هذه المخططات قابلة للاختبار

| الخاصية | كيف تُختبر |
|---|---|
| كل تدفق له مسار نجاح واحد واضح | اختبار تكامل واحد لكل مخطط |
| كل `alt` له اختبار | `INSUFFICIENT_STOCK`, `restock=false`, `expired rejected` |
| كل خطوة كتابة على `DB` داخل معاملة | فحص `BEGIN/COMMIT` في الكود + `T5` (بلا سياق = صفر صفوف) |
| كل حركة تُنشئ أثرًا يمكن تتبعه | `source_type` + `source_id` في `stock_movements` |
| التزامن مُختبر | فاتورتان متوازيتان على نفس التشغيلة (`CONC-1`) |

---

## 7. معايير قبول هذه الوثيقة

- [x] أربعة تدفقات تشغيلية موثقة بالتفصيل.
- [x] كل تدفق يوضح نقطة الفشل والاستجابة لها.
- [x] كل خطوة مرتبطة بصلاحية أو حركة موثقة.
- [x] آلة حالات للمستندات مع منع الحذف.
- [x] كل `alt` في المخططات له اختبار مسمى.
- [x] **محسوم بقرار المالك:** لا تحويلات بين مخازن — حساب واحد = مخزن واحد (ADR-025)؛ فلا سياسة «خصم عند الإرسال/الاستلام» ولا رصيد في الطريق.
