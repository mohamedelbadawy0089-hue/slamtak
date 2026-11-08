# 04 — C4 Architecture Diagrams

> **تحديث قيد التكلفة الصفرية (2026-11-06):** ما يظهر لاحقًا من Redis/BullMQ أو VPS أو تكلفة شهرية مُستبدَل بما في [`27`](27-free-tier-architecture.md) §5. المرجع الحاكم هو `27`.

> استُخدمت مخططات `flowchart` بأسلوب C4 لضمان العرض في GitHub وVS Code وبلا اعتماد على دعم C4 التجريبي.

---

## C4 Level 1 — System Context

```mermaid
flowchart TB
    MGR["مدير المخزن<br/>(Person)<br/>يدير المخزن والموظفين والصلاحيات"]
    EMP["موظف المخزن<br/>(Person)<br/>كاشير · أمين مخزن · محاسب · مندوب"]
    PLT["إدارة المنصة<br/>(Person)<br/>تشغيل الاشتراكات والدعم"]
    SYS["Slamtak WMS<br/>(Software System)<br/>إدارة مخازن الأدوية متعددة المخازن"]

    ETA["الفاتورة الإلكترونية<br/>(External System)"]
    SMS["مزوّد رسائل<br/>(External System)"]
    PAY["بوابة دفع<br/>(External System)"]
    SHIP["شركة شحن<br/>(External System)"]
    BANK["تسوية بنكية<br/>(External System)"]

    MGR -->|"يستخدم كل الوحدات عبر المتصفح/PWA"| SYS
    EMP -->|"ينفذ عمليات يومية حسب صلاحياته"| SYS
    PLT -->|"يدير المخازن والاشتراكات<br/>بلا وصول لبيانات تجارية"| SYS
    SYS -->|"يرسل فواتير ويعتمدها"| ETA
    SYS -->|"إشعارات للعملاء والموظفين"| SMS
    SYS -->|"تحصيل إلكتروني"| PAY
    SYS -->|"إنشاء ومتابعة الشحنات"| SHIP
    SYS -->|"كشوف وتسويات"| BANK
```

| العنصر | النوع | الوصف |
|---|---|---|
| مدير المخزن | شخص | مالك الحساب (Tenant Owner)، أعلى صلاحية داخل مخزنه |
| موظف المخزن | شخص | صلاحيات محدودة بنطاق المخزن |
| إدارة المنصة | شخص | تشغيل الـ SaaS: إنشاء مخازن، خطط، دعم — **بلا** قراءة تجارية |
| Slamtak WMS | نظام | النظام قيد التصميم |
| ETA | خارجي | مصلحة الضرائب المصرية — فاتورة إلكترونية |
| SMS / Payment / Shipping | خارجي | عبر محوّل (Adapter) قابل للاستبدال |

---

## C4 Level 2 — Container

```mermaid
flowchart TB
    subgraph PEOPLE["المستخدمون"]
        BR["متصفح / PWA"]
    end

    subgraph SYS["Slamtak WMS"]
        WEB["Web Application<br/>(Container: Next.js 15 على Cloudflare Pages)<br/>واجهة RTL، بناء ثابت، لا منطق أعمال"]
        API["API Gateway<br/>(Container: Supabase Edge Functions / Deno)<br/>منطق الأعمال + المصادقة + العقد"]
        RT["Live Updates<br/>(Container: Supabase Realtime)<br/>قنوات خاصة · فوري أقل من 300ms"]
        WK["Scheduled Jobs<br/>(Container: pg_cron + pg_net + app.jobs)<br/>تقارير · تكامل · مهام دورية"]
        DB[("Database<br/>(Container: Supabase PostgreSQL 17)<br/>RLS · قيود · فهارس · تقسيم")]
        FILES[("Object Storage<br/>(Container: Cloudflare R2)<br/>مرفقات · PDF · نسخ")]
    end

    subgraph EXT["أنظمة خارجية"]
        ETA2["ETA"]
        MSG["SMS/WhatsApp"]
        PGS["Payment Gateway"]
    end

    BR -->|"HTTPS"| WEB
    WEB -->|"JSON/HTTPS<br/>Bearer JWT + CORS"| API
    WEB -->|"WSS + توكن ES256"| RT
    API -->|"SQL/TCP عبر Supavisor 6543<br/>RLS لكل معاملة"| DB
    API -->|"S3 API"| FILES
    RT -->|"WAL + سياسة realtime.messages"| DB
    WK -->|"SQL/TCP"| DB
    WK -->|"pg_net → HTTPS"| API
    WK -->|"S3 API"| FILES
    WK -->|"HTTPS"| ETA2
    WK -->|"HTTPS"| MSG
    API -->|"HTTPS"| PGS
```

| Container | التقنية | المسؤولية | لماذا منفصل |
|---|---|---|---|
| Web | Next.js على Pages | عرض وPWA | نشر مستقل عن الـ API، كاش حافة أفضل |
| API | Edge Functions | كل القواعد والعقود | حد الثقة الوحيد للبيانات ([`28`](28-supabase-edge-runtime.md)) |
| Live Updates | Supabase Realtime | حدث «تغيّر» داخل Tenant (بلا بيانات) | WebSocket حقيقي بلا خدمة إضافية؛ SSE احتياطي ([`28`](28-supabase-edge-runtime.md) §7.1) |
| Scheduled Jobs | pg_cron + pg_net | مهام مجدولة ومعزولة الفشل | منع المهام الثقيلة من تعطيل الطلبات |
| Database | PostgreSQL | الحقيقة الواحدة | — |
| ~~Cache/Queue~~ | ~~Redis~~ | لا وجود له | كل الحالة في القاعدة |
| Object Storage | S3/R2 | ملفات | لا نضع ملفات في القاعدة |

---

## C4 Level 3 — Component (API Application)

```mermaid
flowchart TB
    subgraph APIAPP["API Application"]
        direction TB
        HTTP["HTTP Layer<br/>Controllers · Filters · Interceptors"]
        GUARD["Security Layer<br/>AuthGuard · TenantGuard · PermissionGuard · Throttler"]
        IDEM["Idempotency<br/>Interceptor + Store"]
        AUD["Audit<br/>Interceptor"]
        subgraph CONTEXTS["Application Contexts"]
            IDS["Identity & Access"]
            TEN["Tenancy & Settings"]
            CAT["Catalog"]
            INV["Inventory"]
            PRO["Procurement"]
            SAL["Sales & Distribution"]
            FIN["Finance"]
            HR["Workforce"]
            INT["Analytics & Automation"]
        end
        subgraph SHARED["Shared Kernel"]
            UOW["UnitOfWork / TenantTx"]
            OUT["Outbox Writer"]
            BUS["Event Bus (in-process)"]
            VAL["Zod Validation"]
            ERR["Error Mapper"]
        end
        DBX[("PostgreSQL")]
    end

    HTTP --> GUARD --> IDEM --> VAL
    HTTP --> AUD
    HTTP --> CONTEXTS
    CONTEXTS --> UOW --> DBX
    CONTEXTS --> OUT
    OUT --> BUS
    CONTEXTS --> ERR
```

| المكوّن | المسؤولية | الاعتماديات المسموحة |
|---|---|---|
| HTTP Layer | تحويل الطلبات، تنسيق الاستجابات | Security، Contexts |
| Security Layer | هوية، Tenant، صلاحية، حدود معدل | Identity (قراءة)، Cache |
| Idempotency | منع التكرار | Redis/DB |
| Audit | تسجيل الأثر | DB (append-only) |
| Identity & Access | مستخدمون، جلسات، أدوار | Shared Kernel |
| Tenancy & Settings | Tenant، مخزن واحد، إعدادات، اشتراك | Identity |
| Catalog | أصناف، باركود، وحدات، تصنيفات، أسعار | Tenancy |
| Inventory | أرصدة، تشغيلات، حركات، جرد، تحويلات | Catalog |
| Procurement | موردون، أوامر شراء، استلام، مرتجعات مورد | Inventory |
| Sales & Distribution | عملاء، عروض، فواتير، مرتجعات، مندوبون، توصيل | Inventory، Finance |
| Finance | حسابات، قيود، خزائن، بنوك، ضرائب | Sales/Procurement (أحداث) |
| Workforce | موظفون، حضور، رواتب | Identity |
| Analytics & Automation | تقارير، إشعارات، قواعد أتمتة، AI | قراءة إسقاطات |
| Shared Kernel | معاملات، Outbox، تحقق، أخطاء | لا شيء |

---

## C4 Level 3 — Component (Web Application)

```mermaid
flowchart LR
    subgraph WEBAPP["Web Application"]
        ROUTER["App Router<br/>Route Groups: (auth) (app) (platform)"]
        SHELL["App Shell<br/>Layout · Sidebar · Tenant Switcher"]
        FEAT["Feature Modules<br/>inventory · sales · purchasing · finance · reports"]
        DATA["Data Layer<br/>TanStack Query · API Client · Zod"]
        UI["Design System<br/>shadcn/ui · Tailwind · RTL tokens"]
        AUTH["Client Session<br/>/me query · route guards"]
        RT["Realtime Client<br/>WS + polling fallback"]
        PWA["PWA<br/>Manifest · Service Worker · Offline shell"]
    end
    ROUTER --> SHELL --> FEAT
    FEAT --> DATA --> UI
    FEAT --> AUTH
    FEAT --> RT
    ROUTER --> PWA
```

| المكوّن | المسؤولية | ممنوع |
|---|---|---|
| App Router | تقسيم المسارات حسب الدور | منطق أعمال |
| App Shell | تنقّل، هوية بصرية، RTL | قرارات صلاحية نهائية |
| Feature Modules | شاشات كل وحدة | استدعاء قاعدة البيانات |
| Data Layer | جلب، كاش، إبطال، تحقق | تخزين أسرار |
| Design System | مكونات موحدة | أنماط مبعثرة |
| Realtime Client | تحديث حي | الاعتماد الكلي على WS (يوجد fallback) |

---

## C4 Level 3 — Dynamic: إنشاء فاتورة بيع

```mermaid
sequenceDiagram
    autonumber
    participant U as مدير/كاشير
    participant W as Web
    participant G as API Guards
    participant S as SalesService
    participant P as PricingService
    participant I as InventoryFacade
    participant DB as PostgreSQL
    participant Q as Outbox/Queue

    U->>W: إضافة أصناف وكميات
    W->>W: تحقق شكلي (Zod)
    W->>G: POST /sales/invoices + Idempotency-Key
    G->>G: Auth → Tenant → Permission(sales.invoice.create)
    G->>S: createInvoice(cmd)
    S->>P: تسعير حسب فئة العميل + سقف السعر
    P-->>S: سعر نهائي + خصومات
    S->>I: allocateFefo(warehouse, lines)
    I->>DB: BEGIN + SET LOCAL tenant + قفل صفوف التشغيلات
    I->>DB: تحقق صلاحية كل تشغيلة (غير منتهية/غير محجوزة)
    I->>DB: خصم + إدراج stock_movements
    I-->>S: تخصيصات
    S->>DB: إدراج فاتورة + أسطر + قيد محاسبي
    S->>Q: كتابة outbox_events (نفس المعاملة)
    S->>S: COMMIT
    S-->>G: نتيجة
    G-->>W: 201 + ETag + Location + requestId
    W-->>U: عرض الفاتورة + إشعار نجاح
```

---

## C4 Level 4 — Code (نموذج توضيحي)

```mermaid
classDiagram
    class CreateSalesInvoiceDto {
        +customerId: uuid
        +warehouseId: uuid
        +lines LineDto
        +paymentTermId?: uuid
        +notes?: string
    }
    class LineDto {
        +medicineId: uuid
        +qty: Decimal
        +unitId: uuid
        +discountPercent?: Decimal
        +batchId?: uuid
    }
    class SalesInvoice {
        +id: uuid
        +tenantId: uuid
        +number: string
        +status: InvoiceStatus
        +subtotal: Money
        +vatAmount: Money
        +total: Money
        +version: int
    }
    class SalesInvoiceLine {
        +id: uuid
        +invoiceId: uuid
        +medicineId: uuid
        +batchId: uuid
        +qty: Decimal
        +unitPrice: Money
        +lineTotal: Money
    }
    class StockMovement {
        +id: uuid
        +type: MovementType
        +qtyDelta: Decimal
        +batchId: uuid
        +refType: string
        +refId: uuid
    }
    CreateSalesInvoiceDto --> LineDto
    SalesInvoice --> SalesInvoiceLine
    SalesInvoiceLine --> StockMovement
```

---

## معايير قبول هذه الوثيقة
- [ ] كل مستوى C4 موجود ويجيب على سؤال مختلف (من، ماذا، كيف، بأي كود).
- [ ] كل حاوية لها تقنية ومسؤولية وسبب فصل.
- [ ] سيناريو ديناميكي واحد على الأقل يوضح المسار الكامل للبيانات.
- [ ] لا يوجد مكوّن بلا مالك واضح في خريطة الوحدات.
