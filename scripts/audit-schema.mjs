// فحص شامل لمخطط قاعدة البيانات الحية: جداول/أعمدة/RLS/سياسات/دوال RPC
import pg from 'pg';
import fs from 'fs';

const cl = new pg.Client({
  host: 'db.iksjhjxwphmvthryfeae.supabase.co',
  port: 5432,
  user: 'postgres',
  password: process.env.SUPABASE_DB_PASSWORD,
  database: 'postgres',
});
await cl.connect();

// 1) الجداول + أعمدة الملكية + RLS + السياسات
const tables = await cl.query(
  "SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1"
);
const out = [];
for (const { t } of tables.rows) {
  const cols = await cl.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
    [t]
  );
  const names = cols.rows.map((r) => r.column_name);
  const rls = await cl.query(
    "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = ('public.' || $1)::regclass",
    [t]
  );
  const pol = await cl.query(
    "SELECT polname, polcmd FROM pg_policy WHERE polrelid = ('public.' || $1)::regclass",
    [t]
  );
  out.push({
    table: t,
    warehouse_id: names.includes('warehouse_id'),
    tenant_id: names.includes('tenant_id'),
    rls: rls.rows[0]?.relrowsecurity,
    forced: rls.rows[0]?.relforcerowsecurity,
    policies: pol.rows.map((p) => `${p.polname}(${p.polcmd})`),
    cols: names,
  });
}
fs.writeFileSync('artifacts/db-tables-audit.json', JSON.stringify(out, null, 1));

console.log('tables:', out.length);
console.log('warehouse_id:', out.filter((o) => o.warehouse_id).length, '| tenant_id:', out.filter((o) => o.tenant_id).length, '| rls ON:', out.filter((o) => o.rls).length);
console.log('=== NO tenant/warehouse column ===');
out.filter((o) => !o.warehouse_id && !o.tenant_id).forEach((o) => console.log(' ', o.table));
console.log('=== tenant/warehouse but RLS OFF ===');
out.filter((o) => !o.rls && (o.warehouse_id || o.tenant_id)).forEach((o) => console.log(' ', o.table));
console.log('=== tenant/warehouse with NO policy ===');
out.filter((o) => (o.warehouse_id || o.tenant_id) && o.policies.length === 0).forEach((o) => console.log(' ', o.table));

// 2) الدوال RPC في public
const fns = await cl.query(`
  SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef AS secdef
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' ORDER BY 1`);
fs.writeFileSync('artifacts/db-functions-audit.json', JSON.stringify(fns.rows, null, 1));
console.log('rpc_functions:', fns.rows.length);

// 3) مشاهد public
const views = await cl.query("SELECT viewname FROM pg_views WHERE schemaname='public' ORDER BY 1");
console.log('views:', views.rows.length, views.rows.map(v=>v.viewname).join(', '));

// 4) التحقق من user_warehouses و roles
const uw = await cl.query("SELECT count(*) AS n FROM public.user_warehouses");
console.log('user_warehouses rows:', uw.rows[0].n);
const r10 = await cl.query("SELECT count(*) AS n FROM public.tenants");
console.log('tenants rows:', r10.rows[0].n);

await cl.end();
