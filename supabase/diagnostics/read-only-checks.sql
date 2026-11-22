-- ============================================================================
-- تشخيص القراءة فقط لمشكلة PostgREST / PGRST002 ("Could not query the database
-- for the schema cache") — يُنفَّذ من Supabase → SQL Editor، لا من التطبيق.
--
-- SQL Editor يتصل بقاعدة البيانات مباشرة (لا يمرّ على PostgREST)، فيعمل حتى
-- عندما يرجع REST ‏503. كل الاستعلامات هنا SELECT فقط: لا INSERT/UPDATE/DELETE،
-- ولا CREATE/ALTER/DROP، ولا تغيير إعدادات. الآمن الوحيد غير الاستعلامي هو
-- NOTIFY pgrst في نهاية الملف، وهو مُعلَّق (commented) كي لا يُنفَّذ بغير قصد:
-- NOTIFY لا يغيّر بيانات ولا مخططًا، لكنه يطلب من PostgREST إعادة قراءة الكاش.
--
-- طريقة العمل: نفّذ الملف قسمًا قسمًا من الأعلى للأسفل. أول قسم يعطي نتيجة
-- غير متوقعة هو السبب المرشّح. سجّل النواتج ثم قرّر الفرع المناسب.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) هل القاعدة نفسها حيّة، أم في استعادة؟
--    المتوقع: reachable = 1     و     in_recovery = false
--    in_recovery = true ⇒ المشروع في استعادة/تحديث، انتظر ثم أعد الفحص.
-- ---------------------------------------------------------------------------
select '1) حياة القاعدة' as section,
       1 as reachable,
       pg_is_in_recovery() as in_recovery,
       current_database() as db,
       now() as server_time,
       version() as server_version;


-- ---------------------------------------------------------------------------
-- 2) جلسات PostgREST: هل استُنفدت الاتصالات أو توجد جلسات عالقة؟
--    المتوقع: idle_in_tx = 0   و   total أقل بكثير من الحد.
--    idle_in_tx كبيرة/قديمة ⇒ احتكار اتصالات يمنع PostgREST من بناء الكاش.
-- ---------------------------------------------------------------------------
select '2) جلسات واتصالات' as section,
       count(*) as total_sessions,
       count(*) filter (where state = 'idle in transaction') as idle_in_tx,
       count(*) filter (where state = 'active') as active,
       count(*) filter (where wait_event_type = 'Lock') as waiting_on_lock,
       max(extract(epoch from now() - state_change)) filter (where state = 'idle in transaction') as oldest_idle_in_tx_seconds
from pg_stat_activity
where backend_type = 'client backend';

-- أطول خمس جلسات غير خاملة — راجع عمود query قبل أي إجراء.
select '2b) أطول الجلسات' as section,
       pid, usename, application_name, state,
       wait_event_type, wait_event,
       round(extract(epoch from now() - query_start)) as running_seconds,
       left(regexp_replace(query, '\s+', ' ', 'g'), 120) as query_head
from pg_stat_activity
where backend_type = 'client backend'
  and state <> 'idle'
order by query_start asc
limit 5;


-- ---------------------------------------------------------------------------
-- 3) الأدوار والصلاحيات التي يعتمد عليها PostgREST
--    المتوقع: authenticator موجود وrolcanlogin = true،
--             hasschema = true لـ authenticator وanon وauthenticated.
-- ---------------------------------------------------------------------------
select '3) الأدوار' as section,
       r.rolname,
       r.rolcanlogin,
       r.rolsuper,
       has_schema_privilege(r.rolname, 'public', 'usage') as hasschema
from pg_roles r
where r.rolname in ('authenticator', 'anon', 'authenticated', 'service_role')
order by r.rolname;


-- ---------------------------------------------------------------------------
-- 4) ما الذي يقرأه PostgREST فعلًا عند بناء الكاش؟
--    المتوقع: عدد كبير من الجداول/الـviews في public ونجاح الاستعلام.
--    فشل هذا الاستعلام هنا ⇒ المشكلة في القاعدة لا في PostgREST.
-- ---------------------------------------------------------------------------
select '4) كتالوج public' as section,
       count(*) filter (where c.relkind = 'r') as tables,
       count(*) filter (where c.relkind = 'v') as views,
       count(*) filter (where c.relkind = 'm') as matviews,
       count(*) filter (where c.relkind = 'S') as sequences
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public';


-- ---------------------------------------------------------------------------
-- 5) أجسام غير صالحة تُفشل تحميل الكاش
--    المتوقع: صفر صفوف في الاستعلامين.
--    أي صف هنا = view/matview أو قيد لم يكتمل (هجرة نُفّذت نصفها) ويجب إصلاحه
--    عبر هجرة جديدة — لا بأمر يدوي على القاعدة.
-- ---------------------------------------------------------------------------
select '5a) views غير صالحة' as section,
       c.oid::regclass as object,
       c.relkind
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('v', 'm')
  and not c.relisvalid;

select '5b) قيود غير مُتحقَّقة' as section,
       conname,
       conrelid::regclass as table_name
from pg_constraint
where not convalidated
  and connamespace = 'public'::regnamespace;


-- ---------------------------------------------------------------------------
-- 6) أقفال معلّقة (LOCK) — تفسّر تعليق بناء الكاش أيضًا.
--    المتوقع: صفر صفوف.
-- ---------------------------------------------------------------------------
select '6) أقفال غير ممنوحة' as section,
       l.pid,
       l.locktype,
       l.mode,
       l.relation::regclass as relation,
       a.state,
       round(extract(epoch from now() - a.query_start)) as waiting_seconds
from pg_locks l
join pg_stat_activity a on a.pid = l.pid
where not l.granted
order by waiting_seconds desc nulls last
limit 10;


-- ---------------------------------------------------------------------------
-- 7) هل الهجرات متتبَّعة أم طُبّقت يدويًا؟
--    null = لا جدول تتبّع ⇒ الترحيل كان يدويًا، وهو ما يفسّر هجرات نصف مطبّقة.
--    للقراءة فقط. (لا نستعلم داخل الجدول مباشرة لأنه يُفشل الاستعلام إن غاب.)
-- ---------------------------------------------------------------------------
select '7) تتبّع الهجرات' as section,
       to_regclass('supabase_migrations.schema_migrations') as migrations_table;


-- ---------------------------------------------------------------------------
-- 8) اختياري — إعادة تحميل الكاش (ليس قراءة، لكنه لا يغيّر بيانات ولا مخططًا)
--    لا تفكّ التعليق إلا بعد مراجعة الأقسام 1–6. عند الحاجة فقط:
--
-- NOTIFY pgrst, 'reload schema';
-- NOTIFY pgrst, 'reload config';
--
-- بعد ذلك أعد الفحص من الطرفية:  npm run check:supabase
-- ‏200/401/403 = عاد سليمًا · 503 PGRST002 = ما زال الاتصال/الكاش معطوبًا
-- ⇒ الفرع التالي: Restart project من Settings → General (توقف دقائق، بلا تغيير بيانات).
-- ---------------------------------------------------------------------------
