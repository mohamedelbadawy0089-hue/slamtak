-- ============================================================
-- 202610200009: كلمة مرور المخزن للمرحلة الثانية من تسجيل الدخول
-- المرحلة الأولى: إيميل + كلمة مرور المستخدم (Supabase Auth)
-- المرحلة الثانية: كلمة مرور المخزن (يضعها المدير أو موظف المخزن)
-- لا يحذف ولا يعدّل أي بيانات سابقة — إضافة عمود فقط + نسخ أرشيفي
-- ============================================================

alter table public.warehouses add column if not exists password_hash text;

-- النسخ الأرشيفي 1: المدير (warehouses.manager_id)
-- تُنسخ فقط القيم بصيغة SHA-256 (كلمة المرور الإدارية المسجّلة عند التسجيل
-- عبر هذه الواجهة). القيم القديمة بصيغة bcrypt أو نص صريح تُتجاهل لأنها
-- لا يمكن التحقق منها هنا — وأصحابها يدخلون مباشرة بلا حجب.
update public.warehouses w
   set password_hash = u.password_hash
  from public.users u
 where u.id = w.manager_id
   and w.password_hash is null
   and u.password_hash ~ '^[0-9a-fA-F]{64}$';

-- النسخ الأرشيفي 2: الربط الفعلي في قاعدتك يتم عبر users.warehouse_id
-- وuser_warehouses (warehouses.manager_id فارغ في البيانات الحالية).
update public.warehouses w
   set password_hash = u.password_hash
  from public.users u
 where w.password_hash is null
   and u.password_hash ~ '^[0-9a-fA-F]{64}$'
   and (w.id = u.warehouse_id
        or exists (select 1 from public.user_warehouses uw
                    where uw.warehouse_id = w.id and uw.user_id = u.id));

-- تحقق
select 'warehouse password coverage:' AS check_step;
select count(*) as warehouses_total,
       count(*) filter (where password_hash is not null) as with_password
  from public.warehouses;
