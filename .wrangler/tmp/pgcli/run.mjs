// مُطبِّق SQL مباشر على Supabase عبر اتصال Postgres (مؤقت — خارج git).
// كلمة المرور تُقرأ من البيئة فقط ولا تُطبع أبداً.
//   node run.mjs --probe "<sql>"
//   node run.mjs --apply <file.sql>
//   node run.mjs --inventory
import pg from 'pg';
import { readFileSync } from 'fs';

const PWD = process.env.SUPABASE_DB_PASSWORD;
if (!PWD) { console.error('SUPABASE_DB_PASSWORD غير موجود في البيئة'); process.exit(2); }

const HOST = process.env.SUPABASE_DB_HOST || 'db.iksjhjxwphmvthryfeae.supabase.co';
const PORT = Number(process.env.SUPABASE_DB_PORT || 6543);

async function connect(verifyTls) {
  const c = new pg.Client({
    host: HOST, port: PORT, user: 'postgres', password: PWD, database: 'postgres',
    ssl: verifyTls ? { rejectUnauthorized: true } : { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await c.connect();
  return c;
}

let client;
try { client = await connect(true); }
catch (e) {
  if (/self.signed|unable to verify|certificate/i.test(e.message || '')) {
    client = await connect(false);
  } else { console.error('فشل الاتصال: ' + e.message); process.exit(3); }
}

const one = async (sql) => (await client.query(sql));

function splitStatements(sql) {
  const out = []; let buf = ''; let i = 0; const n = sql.length;
  while (i < n) {
    const ch = sql[i]; const two = sql.substr(i, 2);
    if (two === '--') { while (i < n && sql[i] !== '\n') i++; continue; }
    if (two === '/*') { const e = sql.indexOf('*/', i + 2); i = e === -1 ? n : e + 2; continue; }
    if (ch === "'") { buf += ch; i++; while (i < n) { buf += sql[i]; if (sql[i] === "'") { if (sql[i + 1] === "'") { buf += sql[++i]; i++; break; } i++; break; } i++; } continue; }
    if (ch === '$') { const m = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i)); if (m) { const tag = m[0]; const end = sql.indexOf(tag, i + tag.length); buf += sql.slice(i, end === -1 ? n : end + tag.length); i = end === -1 ? n : end + tag.length; continue; } }
    if (ch === ';') { if (buf.trim()) out.push(buf.trim()); buf = ''; i++; continue; }
    buf += ch; i++;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const printRows = (rows) => {
  if (!rows.length) { console.log('(لا صفوف)'); return; }
  const keys = Object.keys(rows[0]);
  console.log(keys.join(' | '));
  for (const r of rows) console.log(keys.map(k => String(r[k] ?? '')).join(' | '));
};

const mode = process.argv[2];

if (mode === '--probe') {
  try { printRows((await one(process.argv[3])).rows); }
  catch (e) { console.error('خطأ: ' + e.message); process.exit(1); }
  await client.end(); process.exit(0);
}

if (mode === '--inventory') {
  const q = async (label, sql) => { console.log('\n### ' + label); try { printRows((await one(sql)).rows); } catch (e) { console.error('  ' + e.message); } };
  await q('متغيّرات تشغيلية', `select current_database() db, current_user usr, version() v`);
  await q('الجداول المستهدفة الموجودة (40 جدولاً من الملفات الثلاثة)', `
    select table_name from information_schema.tables
     where table_schema='public' and table_name in (
       'reorder_settings','automation_alerts','automation_rules','automation_schedules','automation_executions',
       'automation_status_transitions','auto_purchase_drafts',
       'price_lists','price_list_items','price_list_segments','customer_segments','customer_segment_members',
       'promotions','promotion_items','promotion_customers','promotion_usage','discount_approvals','pricing_audit_log',
       'companies','departments','employees','attendance','leave_requests','leave_balances','employee_contracts',
       'employee_documents','employee_assets','employee_loans','employee_movements','candidates','hr_notifications',
       'job_titles','payroll_runs','payslips','performance_reviews','employee_probations','employee_exit',
       'exit_checklists','onboarding_tasks','training_sessions','employee_trainings')
     order by 1`);
  await q('الوظائف والمشغّلات المرتبطة', `
    select routine_name from information_schema.routines
     where routine_schema='public' and routine_name in
       ('calculate_reorder_quantity','get_product_price','generate_employee_number')
     order by 1`);
  await q('سياسات RLS على جداول الأتمتة/التسعير/الموارد البشرية', `
    select count(*) as policies, count(distinct tablename) as tables
      from pg_policies where schemaname='public' and tablename in (
       'reorder_settings','automation_alerts','automation_rules','price_lists','promotions','discount_approvals',
       'employees','departments','leave_requests','attendance')`);
  await client.end(); process.exit(0);
}

if (mode === '--apply') {
  const file = process.argv[3];
  const stmts = splitStatements(readFileSync(file, 'utf8'));
  console.log(`${file} — ${stmts.length} عبارة`);

  try { await one('BEGIN'); } catch (e) { console.error('تعذّر فتح معاملة: ' + e.message); process.exit(3); }

  for (let i = 0; i < stmts.length; i++) {
    try { await one(stmts[i]); }
    catch (e) {
      console.error(`\n✖ فشلت العبارة ${i + 1}/${stmts.length}: ${e.message}`);
      if (e.position) console.error('  الموضع: ' + e.position);
      console.error('--- نص العبارة (أوامره الأولى) ---');
      console.error(stmts[i].split('\n').slice(0, 25).join('\n'));
      try { await one('ROLLBACK'); } catch (_) {}
      console.error('\n(رُجعت المعاملة بالكامل — لم يُطبَّق أي جزء من هذا الملف)');
      await client.end(); process.exit(1);
    }
  }

  try { await one('COMMIT'); } catch (e) { console.error('فشل الـCOMMIT: ' + e.message); await one('ROLLBACK').catch(() => {}); await client.end(); process.exit(1); }
  console.log('  ✅ نُفّذ الملف ورُجعت المعاملة بالكامل — COMMIT تم');
  await client.end(); process.exit(0);
}

console.error('usage: --probe "<sql>" | --inventory | --apply <file.sql>');
await client.end();
process.exit(64);
