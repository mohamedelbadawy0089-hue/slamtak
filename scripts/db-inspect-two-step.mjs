import pg from 'pg';
import config from '../supabase/config.js';

const password = process.env.SUPABASE_DB_PASSWORD;
const projectRef = (config.url || '').replace('https://', '').split('.')[0];

async function tryConnect() {
  const attempts = [
    { host: `db.${projectRef}.supabase.co`, port: 5432 },
    { host: `aws-0-eu-central-1.pooler.supabase.com`, port: 6543, user: `postgres.${projectRef}` },
    { host: `aws-1-eu-central-1.pooler.supabase.com`, port: 6543, user: `postgres.${projectRef}` },
  ];
  for (const a of attempts) {
    const client = new pg.Client({
      host: a.host,
      port: a.port,
      user: a.user || 'postgres',
      password,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
    try {
      await client.connect();
      console.log('CONNECTED', a.host, a.port);
      return client;
    } catch (e) {
      console.log('FAIL', a.host, a.port, e.message);
      try { await client.end(); } catch {}
    }
  }
  return null;
}

const client = await tryConnect();
if (!client) process.exit(2);

const q = async (label, sql) => {
  try {
    const r = await client.query(sql);
    console.log(`\n### ${label}`);
    console.log(JSON.stringify(r.rows, null, 1));
  } catch (e) {
    console.log(`\n### ${label} ERROR: ${e.message}`);
  }
};

await q('fn exists', `select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='two_step_verify'`);
await q('warehouses cols', `select column_name, data_type from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name in ('id','manager_id','password_hash','tenant_id','name','is_active','created_at') order by column_name`);
await q('users cols', `select column_name from information_schema.columns where table_schema='public' and table_name='users' and column_name in ('id','email','is_active','manager_password_hash','staff_password_hash','full_name','role','username') order by column_name`);
await q('user_warehouses cols', `select column_name from information_schema.columns where table_schema='public' and table_name='user_warehouses' order by column_name`);
await q('audit_logs cols', `select column_name from information_schema.columns where table_schema='public' and table_name='audit_logs' order by column_name`);
await q('warehouse_password_hashes', `select column_name from information_schema.columns where table_schema='public' and table_name='warehouse_password_hashes' order by column_name`);
await q('wms_manager_password_set', `select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='wms_manager_password_set'`);
await q('current_user_role', `select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='current_user_role'`);
await q('resolve_login_role', `select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='resolve_login_role'`);

await client.end();
