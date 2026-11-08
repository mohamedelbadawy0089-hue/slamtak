# 29 — بذور البيانات المرجعية (Reference Seed)

> **الغرض:** ما يجب أن يوجد في القاعدة **قبل** أول حساب مخزن، بعد قرار المسح الكامل وADR-026 (بدء نظيف بلا ترحيل). لا يحتوي هذا الملف بيانات تجريبية ولا أصنافًا ولا عملاء؛ فقط ما تعتمد عليه القيود والمفاتيح الخارجية وسياسات RBAC.
> **يعتمد على:** [`21-reference-schema.md`](21-reference-schema.md) (البنية) و[`12-auth-and-authorization.md`](12-auth-and-authorization.md) §7–§8 (الكتالوج والمصفوفة).
> **قاعدة حاكمة:** البذور **متكررة التنفيذ (idempotent)** — تشغيلها مرتين لا يُنشئ تكرارًا ولا يمحو تعديلًا لاحقًا بيد المالك.
> **حدود:** كل ما هو بيانات مخزن (أصناف، وحدات، تصنيفات، عملاء، موردون) **لا يُزرع**؛ يُدخله المالك أو يُستورد بموافقة صريحة. لا أسعار ولا حدود خطط تجارية هنا.

## المحتويات
1. [ما يُزرع وما لا يُزرع](#1-ما-يُزرع-وما-لا-يُزرع)
2. [كتالوج الصلاحيات](#2-كتالوج-الصلاحيات)
3. [SQL — كتالوج الصلاحيات](#3-sql--كتالوج-الصلاحيات)
4. [SQL — أدوار النظام لكل حساب](#4-sql--أدوار-النظام-لكل-حساب)
5. [SQL — خطط المنصة](#5-sql--خطط-المنصة)
6. [الاستدعاء الإلزامي عند إنشاء حساب](#6-الاستدعاء-الإلزامي-عند-إنشاء-حساب)
7. [التحقق](#7-التحقق)
8. [ما لا يشمله هذا الملف](#8-ما-لا-يشمله-هذا-الملف)

---

## 1. ما يُزرع وما لا يُزرع

| الكائن | يُزرع؟ | السبب |
|---|---|---|
| `permissions` (67 صفًا) | ✅ مرة واحدة في الهجرة | جدول مرجعي عام؛ مفتاح خارجي لكل `role_permissions` و`user_permission_overrides` |
| `roles` + `role_permissions` (10 أدوار نظام لكل حساب) | ✅ عند إنشاء الحساب | نظام RBAC بلا أدوار = لا يستطيع المالك دعوة أحد |
| `platform.plans` (خطة واحدة `free`) | ✅ | `platform.subscriptions.plan_code` مفتاح خارجي؛ القيمة والسعر قرار مالك لاحقًا |
| `tenants`, `warehouses`, `storage_locations` | ❌ | تُنشأ من مسار إنشاء الحساب، لا من البذور |
| `medicines`, `units`, `medicine_categories`, `customers`, `suppliers` | ❌ | بيانات تشغيلية خاصة بكل مخزن |
| `users`, `tenant_memberships`, `user_roles` | ❌ | هويات؛ تُنشأ بالتسجيل والدعوة |

> **لماذا `permissions` عام وليس لكل حساب؟** لأن رموز الصلاحيات جزء من العقد البرمجي، لا من إعدادات العميل. `roles` وحدها هي المعرَّفة لكل حساب، ما يسمح لكل مخزن بتعديل أدواره دون كسر الكتالوج ([`11`](11-multi-tenant-isolation.md) §4).

---

## 2. كتالوج الصلاحيات

**67 رمزًا** في 13 مجموعة؛ منها **5** لمخطط المنصة لا تُمنح لأي دور داخل مخزن أبدًا.

| المجموعة | العدد | أمثلة |
|---|---|---|
| `catalog` | 7 | `catalog.read`, `catalog.price.update`, `catalog.import` |
| `inventory` | 6 | `inventory.adjust`, `inventory.count.approve`, `inventory.batch.status` |
| `purchasing` | 7 | `purchasing.order.approve`, `purchasing.receipt.create` |
| `sales` | 10 | `sales.invoice.create`, `sales.return.approve`, `sales.credit.override` |
| `finance` | 7 | `finance.journal.post`, `finance.period.close` |
| `hr` | 6 | `hr.payroll.write`, `hr.payroll.approve` |
| `delivery` | 4 | `delivery.task.complete`, `delivery.cod.reconcile` |
| `reports` | 3 | `reports.export`, `reports.financial.read` |
| `settings` | 5 | `settings.tenant.update`, `tenant.owner.transfer` |
| `users` | 5 | `users.role.manage`, `users.permission.grant` |
| `audit` | 1 | `audit.read` |
| `system` | 1 | `system.audit.write` (كتابة سجل التدقيق من البوابة) |
| `platform` | 5 | `platform.tenant.manage` — **لا تُمنح لدور مخزن** |

**تغييران مقصودان على كتالوج `12` §7:**
1. **حُذفت `inventory.transfer.create` و`inventory.transfer.approve`** — لا تحويلات بين مخازن أصلًا ([ADR-025](20-adr.md#adr-025--حساب-واحد--مخزن-واحد))؛ إبقاؤها يخلق صلاحية بلا مسار.
2. **أُضيف `system.audit.write`** لأنه مستخدم فعليًا في اختبار التدقيق `T9` ([`22`](22-rls-and-isolation-tests.md) §6.3) ولم يكن مذكورًا في الكتالوج.

**`is_dangerous = true`** هو ما يستوجب Step-Up أو موافقة ثانية ([`12`](12-auth-and-authorization.md) §6): تعديل الأسعار، تسوية المخزون، إلغاء فاتورة، تجاوزات الخصم/السعر/الائتمان، ترحيل القيد وإغلاق الفترة، اعتماد الرواتب، تصدير البيانات، تعديل الحساب والتكاملات، إدارة الأدوار والصلاحيات، ونقل الملكية.

---

## 3. SQL — كتالوج الصلاحيات

يُنفَّذ بدور الهجرة (`slamtak_owner`)، لأن `slamtak_app` لا يملك `INSERT` على `permissions` ([`22`](22-rls-and-isolation-tests.md) §1).

```sql
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
```

> `ON CONFLICT DO UPDATE` يحدّث **الوصف والخطورة** فقط، ولا يمحو ربطًا قائمًا في `role_permissions`؛ فإعادة تشغيل البذور آمنة على قاعدة عاملة.

---

## 4. SQL — أدوار النظام لكل حساب

الدالة تُنشئ 10 أدوار نظام إن لم تكن موجودة، ثم تربط صلاحياتها. **لا تحذف** ربطًا أضافه المالك لاحقًا، ولا تمسّ الأدوار المخصّصة (`is_system = false`).

```sql
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

REVOKE ALL ON FUNCTION app.seed_tenant_roles(uuid) FROM PUBLIC;
-- لا منح لدور المنصة: لوحة المنصة بلا USAGE على app (22 §1)، ومنحها USAGE يفتح بقية دوال التطبيق.
-- المنفّذ هو دور الهجرة/المالك عند إنشاء الحساب.
```

**لماذا `SECURITY DEFINER`؟** لأن البذور تُكتب في جداول عليها `FORCE RLS`، ولا يوجد سياق مخزن صالح قبل إنشاء الحساب نفسه. الدالة تعمل بصلاحية المالك (بدور هجرة ذي `BYPASSRLS`)، وتُمنح لدور الهجرة/المالك فقط — لا لدور التطبيق ولا للوحة المنصة.

**نتيجة التنفيذ لكل حساب:** 10 أدوار، و**186** ربط صلاحية (المالك 62، المدير 57، والباقي 67 موزعة: صيدلي 10، كاشير 5، أمين مخزن 8، مشتريات 10، محاسب 14، مندوب 6، توصيل 4، مدقق 10).

**مزامنة الكتالوج (ليست إنشاء حساب):** صلاحية تُضاف إلى `permissions` بعد تأسيس المخازن تبقى بلا مالك إن اعتمدنا على الهجرة الأولى — الكتالوج يُحدَّث والأدوار لا. لذلك `supabase/migrations/20261108000002_seed_and_harden.sql` يستدعي `seed_tenant_roles` **لكل** مخزن، لا للناقص فقط؛ والدالة تضيف ما ينقص ولا تمسح تخصيص المشغّل لأن كل إدراجاتها `ON CONFLICT DO NOTHING`. يضاف إلى ذلك: تنظيف أي صلاحية `platform.*` تسلّلت إلى دور مخزن، وفشل صريح إذا نقصت تغطية المالك لصلاحيات المخزن أو لم يكتمل العشرة أدوار، ثم إعادة تشديد `EXECUTE` والامتيازات المسحوبة. آمن بأي عدد من المرات.

---

## 5. SQL — خطط المنصة

```sql
INSERT INTO platform.plans (code, name, monthly_price, features) VALUES
  ('free', 'المجاني', 0, '{}'::jsonb)
ON CONFLICT (code) DO NOTHING;
```

> **قرار مؤجل:** لا تُزرع أسعار ولا حدود (`max_users`, `max_medicines`) ولا خطط مدفوعة. `features` فارغة عمدًا حتى يحددها المالك؛ أي رقم هنا يصبح التزامًا تجاريًا غير مقصود.

---

## 6. الاستدعاء الإلزامي عند إنشاء حساب

مسار إنشاء الحساب ([`11`](11-multi-tenant-isolation.md) §8) يُنفَّذ في **معاملة واحدة**، وبعد إنشاء `tenants` و`warehouses` والمخزن الوحيد والعضوية:

```sql
SELECT app.seed_tenant_roles('<tenant_id>'::uuid);
```

إن فشلت الدالة، تفشل المعاملة كلها — فلا يبقى حساب بلا أدوار. **لا تُستدعى من الواجهة**، ولا تُستدعى لحساب قائم إلا لإصلاح أدوار نظام ناقصة (فهي لا تمسّ الأدوار المخصّصة).

**فحص تشغيل دوري** (يُدرج في `pg_cron` اليومي أو CI): أي حساب بلا دور `owner` = خطأ بيانات.

```sql
SELECT t.id, t.slug
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM roles r WHERE r.tenant_id = t.id AND r.code = 'owner'
);
```

---

## 7. التحقق

نُفِّذت البذور فعليًا على PostgreSQL (PGlite 0.2) فوق DDL الوثيقة `21`، ثم أُنشئ حساب اختبار واستُدعيت الدالة. الأرقام أدناه **ناتج تنفيذ**، لا تقدير:

| الفحص | المتوقع | الناتج |
|---|---|---|
| صفوف `permissions` | 67 | 67 |
| صلاحيات غير المنصة | 62 | 62 |
| أدوار النظام لحساب جديد | 10 | 10 |
| إجمالي `role_permissions` | 186 | 186 |
| صلاحيات المنصة في دور `owner` | 0 | 0 |
| إعادة تشغيل الدالة (تكرار) | لا زيادة | لا زيادة |

**مزامنة على المخزن الحقيقي (PostgreSQL 17):** أُنشئ مخزن مؤقت بلا أدوار، ثم شُغّل `0002` فتولّدت الأدوار العشرة و**186** ربطًا بتوزيع مطابق للجدول (المالك 62، المدير 57، محاسب 14، مدقق 10، صيدلي 10، مشتريات 10، أمين 8، مندوب 6، كاشير 5، توصيل 4). ثم حُذف دور `driver` وأُدخلت `platform.health.read` في دور `auditor` (9 أدوار، 183 ربطًا، تسريب واحد)؛ إعادة التشغيل أعادت 10/186 وحذفت التسريب. حُذف المخزن بعدها بالكامل وبقيت القاعدة كما كانت (0 مخازن، 67 صلاحية).

```sql
-- كتالوج
SELECT count(*) AS total,
       count(*) FILTER (WHERE module = 'platform') AS platform_only
FROM permissions;

-- أدوار حساب واحد
SELECT r.code, count(rp.permission) AS perms
FROM roles r
LEFT JOIN role_permissions rp
       ON rp.tenant_id = r.tenant_id AND rp.role_id = r.id
WHERE r.tenant_id = '<tenant_id>'::uuid
GROUP BY r.code
ORDER BY perms DESC;

-- انتهاك محتمل: صلاحية منصة داخل دور مخزن
SELECT r.code, rp.permission
FROM role_permissions rp
JOIN roles r ON r.tenant_id = rp.tenant_id AND r.id = rp.role_id
JOIN permissions p ON p.code = rp.permission
WHERE p.module = 'platform';
-- المتوقع: 0 صف
```

---

## 8. ما لا يشمله هذا الملف

- **لا بيانات تجريبية** (لا «مخزن تجريبي»، لا أصناف عيّنة) — تُنشأ في بيئة التطوير بسكربت منفصل غير مرفوع للإنتاج.
- **لا مستخدمين ولا كلمات مرور** — الهوية تأتي من التسجيل الحقيقي ([`12`](12-auth-and-authorization.md)).
- **لا شجرة حسابات ولا ضريبة ولا وحدات قياس** — قرارات محاسبية/تجارية يحددها المالك أو محاسبه، وتختلف بين المخازن.
- **لا تعديل على المخطط** — هذه الوثيقة INSERT/دالة فقط، وكل ما تحتاجه من جداول موجود في `21`.
