# 18 — Project Folder Structure
> **تحديث التنفيذ (2026-11-06):** الطبقة الخدمية لم تعد NestJS في حاوية — البوابة هي Supabase Edge Functions. التفاصيل والحدود الحسابية في [`28`](28-supabase-edge-runtime.md)؛ ما يلي يبقى صحيحًا في المنطق والعقد.

> **تحديث قيد التكلفة الصفرية (2026-11-06):** ما يظهر لاحقًا من Redis/BullMQ أو VPS أو تكلفة شهرية مُستبدَل بما في [`27`](27-free-tier-architecture.md) §5. المرجع الحاكم هو `27`.

## 1. الشكل العام (Monorepo)

```
slamtak/
├── apps/
│   ├── web/                     # Next.js 15 (App Router)
│   ├── api/                     # NestJS 11 (المصادقة + منطق الأعمال + OpenAPI)
│   └── worker/                  # معالجات BullMQ + المجدولات + PDF
├── packages/
│   ├── db/                      # Drizzle schema + migrations + UoW + seeds
│   ├── contracts/               # Zod + أنواع API المولدة من OpenAPI
│   ├── permissions/            # كتالوج الصلاحيات + المصفوفات
│   ├── ui/                      # مكونات مشتركة (RTL)
│   ├── config/                  # إعدادات ESLint/TS/Tailwind المشتركة
│   └── testing/                 # factories + أدوات اختبار
├── infra/
│   ├── docker/                  # Dockerfiles لكل تطبيق
│   ├── compose/                 # docker-compose للبيئات
│   ├── caddy/                   # Caddyfile
│   └── grafana/                 # لوحات وDashboards
├── docs/
│   ├── architecture/            # هذه الوثائق
│   ├── runbooks/                # خطط التشغيل
│   └── api/                     # openapi.json المنشور
├── scripts/                     # seed, backup, restore, verify, migrate
├── tests/
│   ├── isolation/               # مصفوفة عزل المخازن (بوابة CI)
│   ├── e2e/                     # Playwright
│   └── load/                    # k6
├── legacy/                      # النظام الحالي أثناء الانتقال (SPA + supabase)
├── .github/workflows/
├── .env.example
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

**لماذا Monorepo؟** عقد واحد بين الواجهة والخادم (أنواع مشتركة)، هجرات قريبة من الكود، وبناء/اختبار موحد. Turborepo يعطي كاش بناء ويشغّل المهام المتأثرة فقط.

---

## 2. تفصيل `apps/api`

```
apps/api/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── common/
│   │   ├── guards/              # auth, tenant, permission, step-up, throttler
│   │   ├── interceptors/        # request-context, idempotency, audit, transform
│   │   ├── filters/             # global-exception.filter.ts
│   │   ├── pipes/               # zod-validation.pipe.ts
│   │   ├── decorators/          # @RequirePermission, @CurrentCtx, @StepUp
│   │   ├── uow/                 # unit-of-work.ts (withTenantTx)
│   │   ├── outbox/              # outbox.writer.ts, outbox.dispatcher.ts
│   │   └── errors/              # error catalog + mapping
│   ├── modules/
│   │   ├── identity/
│   │   │   ├── identity.module.ts
│   │   │   ├── auth/            # controller, service, mfa, sessions
│   │   │   ├── users/
│   │   │   ├── roles/
│   │   │   ├── dto/
│   │   │   └── identity.public.ts
│   │   ├── tenancy/             # tenants, warehouse (1:1), settings
│   │   ├── catalog/
│   │   ├── inventory/
│   │   ├── procurement/
│   │   ├── sales/
│   │   ├── finance/
│   │   ├── workforce/
│   │   ├── analytics/
│   │   ├── automation/
│   │   ├── integration/
│   │   ├── audit/
│   │   └── platform/
│   ├── jobs/                    # معالجات الطوابير
│   └── config/                  # env.schema.ts, configuration.ts
├── test/
│   ├── integration/
│   └── fixtures/
└── openapi.json                 # يُولَّد في CI
```

### شكل الوحدة الواحدة (إلزامي)
```
modules/sales/
├── sales.module.ts
├── sales.controller.ts
├── sales.service.ts
├── sales.repository.ts
├── sales.public.ts              # الواجهة الوحيدة للوحدات الأخرى
├── policy.ts                    # قرارات التفويض الخاصة بالوحدة
├── domain/
│   ├── pricing.ts
│   ├── credit.ts
│   └── invoice-state.ts
├── dto/
│   ├── create-invoice.dto.ts
│   └── invoice-response.dto.ts
├── events/
│   └── invoice-created.event.ts
└── mappers/
    └── invoice.mapper.ts
```

---

## 3. تفصيل `apps/web`

```
apps/web/
├── src/
│   ├── app/
│   │   ├── (auth)/login, mfa, forgot/page.tsx
│   │   ├── (app)/
│   │   │   ├── layout.tsx           # shell + tenant context
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── catalog/...
│   │   │   ├── inventory/...
│   │   │   ├── purchasing/...
│   │   │   ├── sales/...
│   │   │   ├── finance/...
│   │   │   ├── reports/page.tsx
│   │   │   └── settings/...
│   │   ├── (platform)/platform/...
│   │   ├── api/                     # BFF محدود (بلا منطق أعمال)
│   │   ├── layout.tsx               # lang=ar dir=rtl
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                      # primitives
│   │   ├── data-table/
│   │   └── shared/                  # MoneyInput, QtyInput, BatchPicker
│   ├── features/
│   │   ├── sales/                   # hooks, components, schemas
│   │   ├── inventory/
│   │   └── ...
│   ├── lib/
│   │   ├── api-client.ts
│   │   ├── query-client.ts
│   │   ├── query-keys.ts
│   │   └── csrf.ts
│   ├── i18n/                        # ar.json, en.json
│   └── styles/                      # tokens
├── public/                          # manifest, icons, fonts
└── next.config.ts
```

**قاعدة:** لا يوجد مجلد `utils/` عام يجمع كل شيء. كل دالة في مكانها: `lib/` للبنية، `features/*/lib` للخاص.

---

## 4. تفصيل `packages/db`

```
packages/db/
├── src/
│   ├── schema/
│   │   ├── identity.ts
│   │   ├── tenancy.ts
│   │   ├── catalog.ts
│   │   ├── inventory.ts
│   │   ├── procurement.ts
│   │   ├── sales.ts
│   │   ├── finance.ts
│   │   ├── workforce.ts
│   │   ├── system.ts
│   │   └── platform.ts
│   ├── client.ts                 # Pool + drizzle
│   ├── uow.ts                    # withTenantTx
│   ├── policies.sql              # RLS + roles + grants
│   └── seeds/
├── migrations/                   # 0001_baseline.sql …
├── drizzle.config.ts
└── tests/                        # pgTAP
```

---

## 5. قواعد الحدود (تُفرض آليًا)

```jsonc
// .dependency-cruiser.json (مقتطف)
{
  "forbidden": [
    { "name": "no-cross-module-internals",
      "from": { "path": "^apps/api/src/modules/([^/]+)/" },
      "to":   { "path": "^apps/api/src/modules/(?!$1)([^/]+)/(?!.*\\.public\\.ts)" } },
    { "name": "no-db-in-modules",
      "from": { "path": "^apps/api/src/modules/" },
      "to":   { "path": "^packages/db/src/schema" } },
    { "name": "no-api-logic-in-web",
      "from": { "path": "^apps/web/src/" },
      "to":   { "path": "^apps/api/" } },
    { "name": "no-http-in-domain",
      "from": { "path": "/domain/" },
      "to":   { "path": "(nestjs|fastify|http|fetch)" } }
  ]
}
```

| القاعدة | الغرض |
|---|---|
| لا استيراد داخلي بين الوحدات | يمنع التشابك |
| لا مخططات قاعدة في الوحدات مباشرة | كل الوصول عبر repositories |
| لا منطق خادم في الواجهة | حد الثقة |
| لا HTTP في النطاق | قابلية الاختبار |
| لا `platform` في الوحدات التجارية | فصل إدارة المنصة |

---

## 6. اصطلاحات الملفات

| النوع | الاصطلاح | مثال |
|---|---|---|
| ملف | `kebab-case` | `create-invoice.dto.ts` |
| كلاس | `PascalCase` | `CreateInvoiceDto` |
| صلاحية | `module.action` | `sales.invoice.create` |
| حدث | `domain.entity.past-tense` | `sales.invoice.created` |
| جدول | `snake_case` جمع | `sales_invoices` |
| مفتاح | `<singular>_id` | `invoice_id` |
| اختبار | `*.spec.ts` / `*.e2e.ts` | `pricing.spec.ts` |
| هجرة | `NNNN_description.sql` | `0007_add_batch_status.sql` |

---

## 7. الانتقال من المستودع الحالي

| المسار الحالي | المصير |
|---|---|
| `public/*.js` (39 ملفًا) | يبقى في `legacy/public/` أثناء الانتقال، ثم يُحذف |
| `supabase/migrations/*` | يُؤرشف في `legacy/migrations/` ويُجمَّع في `0001_baseline.sql` |
| `src/*.tsx` | يُقيَّم: الصالح يُنقل إلى `apps/web/src/features/…` وغير الصالح يُحذف |
| `supabase/*.js` (سكربتات) | تُحوَّل إلى `scripts/` بمهام واضحة |
| `tests/*` | يُنقل المفيد إلى `tests/` الجديدة (خصوصًا اختبار العزل) |
| `worker.js`, `wrangler.jsonc` | يُبقى فقط إن استمر نشر Cloudflare كطبقة حافة |
| `.dev.vars`, `.wrangler/` | لا تُنقل (بيانات محلية/أسرار) |

---

## 8. معايير قبول هذه الوثيقة
- [ ] كل كود له مكان واحد واضح.
- [ ] الحدود بين الوحدات مفروضة آليًا لا بالاتفاق.
- [ ] لا مجلد "متفرقات" يجمع كل شيء.
- [ ] الانتقال من المستودع الحالي لا يفقد أصلًا قيمًا.
- [ ] أي مطور جديد يستطيع تحديد مكان أي ملف خلال دقيقتين.
