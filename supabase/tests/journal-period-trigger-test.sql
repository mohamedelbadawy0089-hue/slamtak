-- ===========================================================================
-- اختبار إصلاح مشغّل الفترة المالية على journal_entries
--   (202610270003_fix_journal_entry_period_trigger.sql)
--
-- كل ما في هذا الملف يجري داخل معاملة واحدة ثم ROLLBACK: لا أثر على الإنتاج.
--
-- T1 قيد داخل فترة مُقفلة لنفس المؤسسة يُرفض (بنفس رسالة الخطأ القديمة)
-- T2 قيد خارج أي فترة مُقفلة يُقبل — ما كان مستحيلاً قبل الإصلاح لأن الدالة
--    القديمة كانت تقارن financial_periods.id (uuid) بـ period_id (date)
-- T3 فترة مُقفلة تابعة لمؤسسة أخرى لا تمنع مؤسستنا
-- T4 general_ledger (period_id uuid) ما زالت مرفوضة على فترة مُقفلة
-- T5 سطر أستاذ بلا فترة (period_id null) يُقبل
--
-- الاستخدام: node supabase/tests/run-journal-period-trigger-test.mjs
--   (يُشغَّل أيضاً ضمن npm run test:db)
-- ===========================================================================
begin;

do $trgtest$
declare
  v_t       uuid;
  v_t2      uuid;
  v_acct    uuid;
  v_closed  uuid := gen_random_uuid();
  v_closed2 uuid := gen_random_uuid();
begin
  select id into v_t    from public.tenants limit 1;
  select id into v_t2   from public.tenants where id <> v_t limit 1;
  select id into v_acct from public.chart_of_accounts limit 1;

  if v_t is null or v_acct is null then
    raise exception 'TRGTEST seed missing: tenant=% account=%', v_t, v_acct;
  end if;

  -- فترة مُقفلة للمؤسسة الأولى (يناير 2025) ولمؤسسة أخرى (مايو 2024)
  insert into public.financial_periods
    (id, tenant_id, period_name, period_code, start_date, end_date, is_open, is_closed)
  values
    (v_closed,  v_t,  'فترة اختبار مغلقة', 'TRGTEST-CL1', date '2025-01-01', date '2025-01-31', false, true),
    (v_closed2, v_t2, 'فترة اختبار مغلقة 2', 'TRGTEST-CL2', date '2024-05-01', date '2024-05-31', false, true);

  -- T1: قيد داخل فترة مُقفلة لنفس المؤسسة يجب أن يُرفض
  begin
    insert into public.journal_entries
      (tenant_id, description, reference_type, period_id, account_id, entry_date, status)
    values
      (v_t, 'TRGTEST', 'journal_entry', date '2025-01-15', v_acct, date '2025-01-15', 'draft');
    raise exception 'TRGTEST T1 فشل: أُدخل قيد داخل فترة مُقفلة';
  exception
    when others then
      if sqlerrm like 'TRGTEST T1%' then raise; end if;
      if sqlerrm not like '%مُقفلة%' then
        raise exception 'TRGTEST T1 فشل: رُفض بخطأ غير متوقع: %', sqlerrm;
      end if;
  end;

  -- T2: قيد خارج أي فترة مُقفلة يجب أن يُقبل (هذا هو العطب الذي كان يمنع كل الإدراج)
  insert into public.journal_entries
    (tenant_id, description, reference_type, period_id, account_id, entry_date, status)
  values
    (v_t, 'TRGTEST مفتوح', 'journal_entry', date '2026-10-15', v_acct, date '2026-10-15', 'draft');

  -- T3: فترة مُقفلة تابعة لمؤسسة أخرى لا تمنع مؤسستنا
  if v_t2 is not null then
    insert into public.journal_entries
      (tenant_id, description, reference_type, period_id, account_id, entry_date, status)
    values
      (v_t, 'TRGTEST مؤسسة أخرى', 'journal_entry', date '2024-05-15', v_acct, date '2024-05-15', 'draft');
  end if;

  -- T4: general_ledger (period_id uuid) ما زالت مرفوضة على فترة مُقفلة — السلوك القديم محفوظ
  begin
    insert into public.general_ledger
      (tenant_id, account_id, reference_type, reference_id, description, period_id, debit, credit)
    values
      (v_t, v_acct, 'journal_entry', gen_random_uuid(), 'TRGTEST-GL', v_closed, 1, 0);
    raise exception 'TRGTEST T4 فشل: أُدخل سطر أستاذ داخل فترة مُقفلة';
  exception
    when others then
      if sqlerrm like 'TRGTEST T4%' then raise; end if;
      if sqlerrm not like '%مُقفلة%' then
        raise exception 'TRGTEST T4 فشل: رُفض بخطأ غير متوقع: %', sqlerrm;
      end if;
  end;

  -- T5: سطر أستاذ بلا فترة (period_id null) يُقبل
  insert into public.general_ledger
    (tenant_id, account_id, reference_type, reference_id, description, debit, credit)
  values
    (v_t, v_acct, 'journal_entry', gen_random_uuid(), 'TRGTEST-GL2', 1, 0);
end;
$trgtest$;

rollback;

-- التحقق من أن كل الاختبارات اختفت فعلاً (لا بقاء على الإنتاج)
select
  (select count(*) from public.journal_entries  where description like 'TRGTEST%')  as je_left,
  (select count(*) from public.general_ledger   where description like 'TRGTEST%')  as gl_left,
  (select count(*) from public.financial_periods where period_code like 'TRGTEST%') as fp_left,
  'TRGTEST-ALL-OK' as marker;