-- ===========================================================================
-- slamtak — إصلاح مشغّل الفترة المالية على journal_entries (2026-10-27)
--
-- العطب: المشغّل trg_block_closed_period_je يستدعي f_block_closed_period()
-- التي تقارن financial_periods.id (uuid) بـ new.period_id، لكن عمود period_id
-- في journal_entries من نوع date — فتصدر:
--     ERROR: operator does not exist: uuid = date
-- وأي إدراج أو تعديل في journal_entries كان يفشل مهما كانت الفترة مفتوحة.
-- (general_ledger.period_id uuid تبقى تعمل بالدالة القديمة كما هي.)
--
-- الحل: دالة مستقلة f_block_closed_period_by_date() تتحقق مما إذا كان تاريخ
-- القيد داخل فترة مالية مُقفلة لنفس المؤسسة (start_date..end_date) فترفض،
-- وإلا تسمح — مع الحفاظ على نفس رسالة الخطأ ومعنى القفل.
-- يستبدل trigger على journal_entries فقط، ولا يمس الدالة القديمة أو general_ledger.
-- ===========================================================================

begin;

create or replace function public.f_block_closed_period_by_date()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $period$
declare
  v_period text;
begin
  if new.period_id is null then
    return new;
  end if;

  select coalesce(fp.period_code || ' — ' || fp.period_name, fp.period_name)
    into v_period
    from public.financial_periods fp
   where fp.tenant_id = new.tenant_id
     and fp.is_closed = true
     and new.period_id between fp.start_date and fp.end_date
   limit 1;

  if found then
    raise exception 'لا يمكن إجراء معاملات على فترة مُقفلة (%)',
      coalesce(v_period, new.period_id::text);
  end if;

  return new;
end;
$period$;

drop trigger if exists trg_block_closed_period_je on public.journal_entries;

create trigger trg_block_closed_period_je
  before insert or update on public.journal_entries
  for each row
  execute function public.f_block_closed_period_by_date();

commit;