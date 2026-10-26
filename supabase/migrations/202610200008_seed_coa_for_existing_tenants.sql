-- ============================================================
-- 202610200008: زراعة شجرة الحسابات لكل مستأجر حقيقي
-- سبب الإنشاء: ترحيل 202610200001 يزرع الشجرة لمؤسسة تجريبية
--   واحدة بـ tenant_id ثابت (00000000-0000-0000-0000-000000000001)
--   غير موجودة في جدول tenants، فالمستأجرين الحقيقيين كانوا
--   سيحصلون على خطأ "لا يوجد حساب إيرادات" عند أول قيد يومية.
-- آمن للتشغيل المتكرر: يتجاوز أي مستأجر يملك حسابات أصلاً.
-- يُنفَّذ مرة واحدة من Supabase SQL Editor
-- ============================================================

do $body$
declare
  r record;
  v record;
  v_parent uuid;
  v_count int;
  v_seeded int := 0;
begin
  for r in select id from public.tenants loop
    select count(*) into v_count
      from public.chart_of_accounts where tenant_id = r.id;
    if v_count > 0 then
      continue;
    end if;

    for v in
      select * from (values
        ('1',   null::text, 'الحسابات',                  'الحسابات',                  'equity',            1, 46, 0),
        ('100', '1',        'الأصول',                    'الأصول',                    'asset',             2, 17, 1),
        ('110', '100',      'الأصول المتداولة',          'الأصول المتداولة',          'asset',             3, 10, 2),
        ('111', '110',      'البنوك',                    'البنوك',                    'asset',             4,  5, 3),
        ('112', '110',      'الصندوق',                   'الصندوق',                   'asset',             6,  7, 3),
        ('114', '110',      'الذمم المدينة (العملاء)',   'الذمم المدينة (العملاء)',   'asset',             8,  9, 3),
        ('120', '100',      'المخزون',                   'المخزون',                   'asset',            11, 12, 2),
        ('130', '100',      'الأصول الثابتة',            'الأصول الثابتة',            'asset',            13, 16, 2),
        ('131', '130',      'الأجهزة والمعدات',          'الأجهزة والمعدات',          'asset',            14, 15, 3),
        ('200', '1',        'الخصوم',                    'الخصوم',                    'liability',        18, 25, 1),
        ('210', '200',      'القروض البنكية',            'القروض البنكية',            'liability',        19, 20, 2),
        ('220', '200',      'حسابات الدائنين (الموردون)', 'حسابات الدائنين (الموردون)', 'liability',        21, 22, 2),
        ('230', '200',      'ضريبة المبيعات المستحقة',   'ضريبة المبيعات المستحقة',   'liability',        23, 24, 2),
        ('300', '1',        'حقوق الملكية',              'حقوق الملكية',              'equity',           26, 31, 1),
        ('310', '300',      'رأس المال',                 'رأس المال',                 'equity',           27, 28, 2),
        ('320', '300',      'الأرباح المحتجزة',          'الأرباح المحتجزة',          'equity',           29, 30, 2),
        ('400', '1',        'الإيرادات',                 'الإيرادات',                 'income',           32, 37, 1),
        ('410', '400',      'مبيعات الأدوية',            'مبيعات الأدوية',            'income',           33, 34, 2),
        ('411', '400',      'مبيعات التجزئة',            'مبيعات التجزئة',            'income',           35, 36, 2),
        ('500', '1',        'المصاريف',                  'المصاريف',                  'expense',          38, 45, 1),
        ('510', '500',      'مصروفات البيع والخصومات',   'مصروفات البيع والخصومات',   'expense',          39, 40, 2),
        ('520', '500',      'مصاريف إدارية',             'مصاريف إدارية',             'expense',          41, 42, 2),
        ('530', '500',      'تكلفة البضاعة المباعة',     'تكلفة البضاعة المباعة',     'cost_of_goods_sold', 43, 44, 2)
      ) as t(code, parent, name_en, name_ar, acc_type, lft, rgt, depth)
      order by lft
    loop
      if v.parent is not null then
        select id into v_parent from public.chart_of_accounts
         where tenant_id = r.id and code = v.parent;
      else
        v_parent := null;
      end if;

      insert into public.chart_of_accounts
        (tenant_id, code, name, name_ar, account_type, parent_id, lft, rgt, depth)
      values
        (r.id, v.code, v.name_en, v.name_ar, v.acc_type, v_parent, v.lft, v.rgt, v.depth)
      on conflict (tenant_id, code) do nothing;
    end loop;

    v_seeded := v_seeded + 1;
    raise notice 'تم زراعة شجرة الحسابات للمستأجر %', r.id;
  end loop;

  raise notice 'عدد المستأجرين الذين تمت زرعتهم الآن: %', v_seeded;
end $body$;

-- تحقق
SELECT 'coa per tenant:' AS check_step;
SELECT tenant_id, count(*) AS accounts
  FROM public.chart_of_accounts
 GROUP BY tenant_id
 ORDER BY accounts DESC, tenant_id;
