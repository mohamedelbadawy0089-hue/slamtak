# 02 — حزمة التقنيات وهيكل المستودع

> **يقابل:** البند «ثالثًا: اختيار التقنيات» + البند 2 و6 من شروط الاعتماد.
> **المرجع المصاحب:** `docs/architecture/05-technology-stack.md`, `27-free-tier-architecture.md`, `28-supabase-edge-runtime.md`, `18-project-folder-structure.md`.

---

## 1. معايير التقييم (الأوزان المعتمدة)

| المعيار | الوزن | معنى عملي |
|---|---|---|
| الأمان وسلامة البيانات | 30% | RLS، معاملات، قيود، نضج أمني |
| الاستقرار والنضج | 20% | إصدارات مستقرة، مجتمع، أعطال معروفة |
| التكلفة | 20% | 0 جنيه الآن، ومسار تكلفة متوقع |
| سهولة الصيانة | 15% | عدد الأنظمة التي نُشغّلها، سهولة التوظيف في مصر |
| قابلية التوسع | 10% | مسار مثبت عند 1000 مخزن |
| سرعة التطوير | 5% | Time-to-market |

**قاعدة إلزامية:** لا تُضاف تقنية إلا إذا كانت تحلّ مشكلة قائمة؛ «الشهرة» ليست سببًا، ونكتب في الجدول البديل الذي رُفض ولماذا.

---

## 2. الواجهة الأمامية

| التقنية | الإصدار | لماذا | البدائل المرفوضة | التكلفة |
|---|---|---|---|---|
| **Next.js (App Router)** | 15.x | SSR للصفحات الثقيلة، تقسيم حزم، PWA، نضج إنتاجي | Vite+React (لا SSR)، SvelteKit (خبرة/توظيف) | 0 |
| **React** | 19.x | أكبر نظام بيئي وتوافر مطورين في مصر | Vue/Angular | 0 |
| **TypeScript** | 5.6+ | عقد واحد بين الواجهة والخادم | JS | 0 |
| **Tailwind CSS 4** | 4.x | خصائص منطقية `ms/me/ps/pe` = RTL بلا ملفات مكرّرة | CSS Modules، styled-components | 0 |
| **shadcn/ui + Radix** | آخر إصدار | كود مملوك لنا، إتاحة ممتازة، لا قفل مكتبة | MUI (ثقيل، LTR أولًا)، AntD | 0 |
| **TanStack Query 5** | 5.x | حالة الخادم، إبطال، حالات تحميل موحدة | SWR، Redux Toolkit Query | 0 |
| **TanStack Table 8** | 8.x | جداول آلاف الصفوف مع Virtualization | AG Grid (مدفوع) | 0 |
| **react-hook-form + Zod** | 7.x / 3.x | تحقق بنفس مخطط الخادم (مصدر واحد) | Formik+Yup (مخطط مزدوج) | 0 |
| **next-intl** | 3.x | RTL + رسائل + أرقام وتواريخ عربية | i18next | 0 |
| **Serwist** | 9.x | PWA/Service Worker حديث | next-pwa (مهمل) | 0 |
| **Recharts** | 2.x | رسوم كافية للتقارير | ECharts (أثقل) | 0 |

**RTL:** خط `IBM Plex Sans Arabic`، أرقام لاتينية في الجداول المالية (منعًا للالتباس ٤/٥)، وتنسيق التواريخ `ar-EG` مع إمكانية `en-GB`.

---

## 3. الخادم (Backend)

| التقنية | الإصدار | لماذا | البديل المرفوض | التكلفة |
|---|---|---|---|---|
| **Runtime: Deno 2** (ملف A) | 2.x | بيئة Edge Functions نفسها؛ TS أصلي، WebCrypto | Node على خادم دائم (يلغي صفر التكلفة) | 0 |
| **Hono** (ملف A) | 4.x | موجّه خفيف (~14KB)، وسيطات، يعمل على Edge وNode **بنفس الكود** | Express (لا Edge)، Fastify (ممتاز لكنه Node فقط) | 0 |
| **NestJS 11 + Fastify** (ملف B) | 11.x | DI، وحدات، هيكل مؤسسي إن انتقلنا لخادم دائم | — | 0 (كود) |
| **Zod 3** | 3.x | عقد التحقق + توليد OpenAPI عبر `zod-to-openapi` | class-validator (مزدوج مع الواجهة) | 0 |
| **jose** | 5.x | JWT ES256 عبر WebCrypto، تحكم كامل، تدوير مفاتيح | JWT بمكتبة غير مدققة | 0 |
| **hash-wasm (Argon2id)** | 3.x | معيار PHC بلا ربط أصلي يعمل على Edge | bcrypt (حد 72 بايت) | 0 |
| **otpauth** | 9.x | MFA TOTP RFC 6238 | SMS OTP (تكلفة) | 0 |
| **pino** | 9.x | سجلات JSON سريعة بلا تسريب أسرار | winston | 0 |
| **Drizzle ORM + drizzle-kit** | 0.3x | SQL-first، `SET LOCAL` صريح، أنواع دقيقة، هجرات SQL قابلة للمراجعة | **Prisma** (محرك إضافي، صعوبة `SET LOCAL` مع RLS، توليد ثقيل على Edge)، TypeORM (إهمال) | 0 |
| **الطوابير** | — | ملف A: `app.jobs` + `pg_cron`/`pg_net` داخل القاعدة. ملف B: BullMQ + Redis | Redis في ملف A (خدمة إضافية بلا حاجة) | A: 0 · B: ~$0–10 |
| **Realtime** | — | Supabase Realtime قنوات خاصة (حمولة حدث فقط) | WebSocket خاص بنا (يحتاج خادمًا دائمًا) | 0 |
| **التخزين** | — | Cloudflare R2 (10GB مجانًا، بلا رسوم خروج) | Supabase Storage (1GB) | 0 |

**لماذا ليس NestJS افتراضيًا؟** لأن نقطة القرار ليست «أي إطار أفضل» بل «هل نتحمّل خادمًا دائمًا؟». على Edge، NestJS غير قابل للتشغيل. الحل: **النواة مستقلة عن الإطار** (Use Cases + Domain + Repositories بواجهات)، فتُركَّب على Hono اليوم وعلى NestJS/Fastify غدًا بتغيير طبقة ربط واحدة.

---

## 4. قاعدة البيانات والبنية التحتية

| التقنية | الاختيار | لماذا | البديل | التكلفة/شهر |
|---|---|---|---|---|
| قاعدة البيانات | **PostgreSQL 16/17** | RLS، قيود، JSONB، تقسيم، معاملات قوية، نوافذ | MySQL (لا RLS)، Mongo (لا قيود مالية) | 0 (Free) → $25 (Pro) |
| الاستضافة | **Supabase (Postgres مُدار)** | صفر إعداد، نسخ يديرها مزود، تقارير استخدام | Neon (بلا Realtime)، RDS | 0 |
| الواجهة | **Cloudflare Pages** | طلبات ثابتة غير محدودة، TLS، CDN عالمي | Vercel (حدود مجانية أضيق) | 0 |
| الحوسبة | **Supabase Edge Functions** | 500 ألف استدعاء/شهر، بلا نوم ولا بطاقة | Fly.io/Railway (بطاقة مطلوبة) | 0 |
| CDN/WAF | **Cloudflare** | حماية مجانية + Rate Limit أساسي | — | 0 |
| CI/CD | **GitHub Actions** | 2000 دقيقة/شهر، تكامل المستودع | GitLab CI (400 دقيقة) | 0 |
| المراقبة | **Sentry Free + UptimeRobot + سجلات JSONL** | أخطاء + توفّر + سجلات قابلة للبحث | GlitchTip (استضافة ذاتية) | 0 |
| الحاويات | **Docker** | للتطوير المحلي فقط في ملف A؛ وللنشر في ملف B | — | 0 |
| النشر المتقدم | **Docker Compose** (ملف B) ثم K8s عند الحاجة المقاسة | بساطة أولًا | K8s مبكرًا (تعقيد بلا مقابل) | 0–20 |

---

## 5. ملفا التشغيل (Runtime Profiles) — قرار D-1

| البُعد | **A — Serverless صفري (الافتراضي)** | **B — Container (NestJS)** |
|---|---|---|
| الحوسبة | Supabase Edge Functions + Hono | VPS 2vCPU/4GB أو Fly.io + Docker |
| الطوابير | `app.jobs` + `pg_cron` | Redis + BullMQ |
| التحديث اللحظي | Supabase Realtime | WebSocket/Socket.io |
| حدود صلبة | **2 ثانية CPU/طلب**، 500 ألف استدعاء/شهر | لا حد CPU عملي، حد ذاكرة/شبكة |
| التقارير الثقيلة | يجب تقسيمها/جدولتها ليلًا | ممكنة متزامنة |
| التكلفة | 0 | 0–25$ + وقت صيانة |
| المخاطر | قيد المعالجة، إقلاع بارد 100–400ms | تحديثات نظام، نسخ احتياطي مسؤوليتنا، أعطال ذاكرة |
| الترقية | نقل طبقة الربط إلى NestJS (العقود والنواة كما هي) | — |

**التوصية:** البدء بـ A، والانتقال إلى B عند تحقّق أي من: (1) تجاوز 300 ألف استدعاء شهريًا، (2) تقرير متزامن > 2 ثانية مطلوب، (3) عميل يطلب استضافة منفصلة/امتثال خاص، (4) فريق > 3 مطورين يحتاج بيئة تشغيل كاملة.

---

## 6. ما لا نستخدمه ولماذا (قائمة الرفض الموثّقة)

| التقنية | سبب الرفض |
|---|---|
| Kubernetes | لا حاجة قبل 1000 مخزن؛ تكلفة تشغيل > قيمة |
| Kafka / RabbitMQ | حجم الأحداث لا يبرر؛ Outbox + Postgres كافٍ حتى T3 |
| MongoDB | لا قيود علائقية ولا معاملات مناسبة للمخزون والمالية |
| GraphQL | تعقيد حدّي، ولا حاجة له مع REST موثّق |
| Prisma | اقتران بمحرك، صعوبة `SET LOCAL` لكل معاملة، توليد ثقيل على Edge |
| Redis (ملف A) | خدمة إضافية بتكلفة وصيانة مقابل وظيفة يوفرها Postgres |
| microservices / service mesh | بلا فريق مستقل لكل خدمة = تكلفة بلا فائدة |
| مكتبة UI جاهزة كاملة (MUI/AntD) | RTL وثقافة تصميم مختلفة، وقفل مكتبة |
| Supabase Auth / PostgREST كواجهة | سطح هجوم مباشر من المتصفح ومصدر حقيقة ثانٍ (ADR-004/005) |

---

## 7. هيكل المستودع المستهدف (Monorepo)

```text
slamtak/
├─ apps/
│  ├─ web/                        # Next.js 15 (App Router) — RTL/PWA
│  │  ├─ app/
│  │  │  ├─ (auth)/login|mfa|forgot/
│  │  │  ├─ (app)/
│  │  │  │  ├─ dashboard/
│  │  │  │  ├─ catalog/{products,categories,manufacturers,barcodes}/
│  │  │  │  ├─ inventory/{batches,balances,movements,adjustments,counts,transfers}/
│  │  │  │  ├─ purchasing/{suppliers,orders,receipts,invoices}/
│  │  │  │  ├─ sales/{customers,invoices,returns}/
│  │  │  │  ├─ finance/{payments,expenses,reports}/
│  │  │  │  ├─ team/{members,roles,activity}/
│  │  │  │  └─ settings/{warehouse,printing,alerts,security}/
│  │  │  └─ api/                  # ممنوع منطق أعمال؛ صحة/بروكسي فقط
│  │  ├─ components/{ui,forms,tables,charts,layout}/
│  │  ├─ features/<module>/       # hooks + api client + views
│  │  ├─ lib/{api-client,auth,errors,i18n,format}/
│  │  └─ locales/{ar,en}/
│  └─ api/                        # البوابة (Hono اليوم / NestJS غدًا)
│     ├─ src/
│     │  ├─ bootstrap.{ts}        # تركيب الوسيطات والموجّه
│     │  ├─ middleware/{request-id,rate-limit,auth,tenant,permission,error}.ts
│     │  ├─ routes/v1/            # ربط HTTP → Use Cases فقط
│     │  └─ adapters/             # deno | node | serverless
│     └─ tests/{integration,contract,security}/
├─ packages/
│  ├─ domain/                     # كيانات وقواعد نقية (بلا I/O)
│  │  ├─ catalog/ inventory/ sales/ purchasing/ finance/ rbac/ shared/
│  ├─ application/                # Use Cases + واجهات المستودعات
│  ├─ db/                         # مخطط Drizzle + هجرات SQL + seed
│  │  ├─ schema/{tenancy,identity,catalog,inventory,sales,purchasing,finance,platform}/
│  │  ├─ migrations/
│  │  └─ policies/               # ملفات RLS مُدارة بترتيب
│  ├─ contracts/                  # Zod + OpenAPI + أنواع مشتركة
│  ├─ ui/                         # مكونات shadcn المشتركة
│  └─ config/                     # eslint/tsconfig/tailwind
├─ modules/                       # الوحدات الحدودية (انظر 01 §4)
│  └─ inventory/                  # نفس البنية لكل وحدة: catalog, sales, purchasing…
│     ├─ domain/ application/ infrastructure/ api/
│     ├─ public.ts                # العقد العام الوحيد للوحدة — لا يُستورد من غيره
│     └─ tests/
├─ infra/
│  ├─ docker/{Dockerfile.api,compose.dev.yml,compose.prod.yml}   # ملف B
│  ├─ github/workflows/{ci.yml,deploy-preview.yml,deploy-prod.yml,backup.yml}
│  └─ scripts/{backup,restore,seed,smoke}.mjs
├─ docs/architecture/            # الوثائق الإنجليزية القائمة
├─ docs/architecture-ar/         # هذا الدوسيه
└─ tests/{e2e,load,security}/    # Playwright, k6, عزل
```

**قواعد ملزمة:**
1. `packages/domain` و`packages/application` **لا** يعرفان HTTP ولا SQL.
2. كل وحدة تصدّر `public.ts` واحدًا فقط (عقدها العام)؛ لا `index.ts` جذري داخل الوحدة.
3. كل ملف هجرة SQL يُراجَع ويُوقّع؛ لا `db push` في الإنتاج.
4. `apps/web/app/api` ممنوع أن يحتوي منطق أعمال (يفشل بفحص CI).
