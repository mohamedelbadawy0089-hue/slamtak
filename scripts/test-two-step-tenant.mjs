import pg from 'pg';
import config from '../supabase/config.js';

const ref = (config.url || '').replace('https://', '').split('.')[0];
const c = new pg.Client({
  host: 'db.' + ref + '.supabase.co', port: 5432, user: 'postgres',
  password: process.env.SUPABASE_DB_PASSWORD, database: 'postgres',
  ssl: { rejectUnauthorized: false },
});
await c.connect();
await c.query('BEGIN');

const mgr = (await c.query(`
  select u.id, u.tenant_id, w.password_hash as hash
    from public.users u
    join public.warehouses w on w.manager_id = u.id
   where coalesce(w.password_hash, '') <> ''
     and u.tenant_id is not null
     and coalesce(u.is_active, true)
   limit 1`)).rows[0];
console.log('manager_user', mgr.id, 'tenant', mgr.tenant_id);

const call = async (hash) => {
  await c.query("select set_config('request.jwt.claims',$1,true)",
    [JSON.stringify({ sub: mgr.id, role: 'authenticated' })]);
  return (await c.query('select public.two_step_verify($1) o', [hash])).rows[0].o;
};

const ok = await call(mgr.hash);
console.log('CORRECT   ', JSON.stringify(ok));
console.log('  granted', ok.granted, '| role', ok.role, '| tenant_matches', ok.tenant_id === mgr.tenant_id);

await c.query("create function pg_temp.boom() returns trigger language plpgsql as $b$ begin raise exception 'audit offline'; end $b$");
await c.query('create trigger t_boom before insert on public.audit_logs for each row execute function pg_temp.boom()');
const broken = await call(mgr.hash);
console.log('AUDIT_DOWN', JSON.stringify(broken));
console.log('  login_ok', broken.granted === true, '| role', broken.role, '| tenant_matches', broken.tenant_id === mgr.tenant_id);

await c.query('ROLLBACK');
await c.end();
