import pg from 'pg';
import config from './supabase/config.js';
const ref=(config.url||'').replace('https://','').split('.')[0];
const c=new pg.Client({host:'db.'+ref+'.supabase.co',port:5432,user:'postgres',password:process.env.SUPABASE_DB_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});
await c.connect();
await c.query('BEGIN');

const m = (await c.query(`select u.id, u.manager_password_hash hash, u.tenant_id from public.users u where coalesce(u.manager_password_hash,'')<>'' limit 1`)).rows[0];
if(m){
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:m.id,role:'authenticated'})]);
  const r = await c.query('select public.two_step_verify($1)o',[m.hash]);
  console.log('MGR_META', JSON.stringify(r.rows[0].o), r.rows[0].o.tenant_id===m.tenant_id);
}

const e = (await c.query(`select u.id, u.staff_password_hash hash, u.tenant_id, uw.warehouse_id from public.users u join public.user_warehouses uw on uw.user_id=u.id where coalesce(u.staff_password_hash,'')<>'' and coalesce(uw.is_active,true) limit 1`)).rows[0];
if(e){
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:e.id,role:'authenticated'})]);
  const r = await c.query('select public.two_step_verify($1)o',[e.hash]);
  console.log('EMP_SAME_WH', JSON.stringify(r.rows[0].o), r.rows[0].o.tenant_id===e.tenant_id);
}

if(m){
  await c.query("create function pg_temp.boom2() returns trigger language plpgsql as $b$ begin raise exception 'x'; end $b$");
  await c.query('create trigger t_boom2 before insert on public.audit_logs for each row execute function pg_temp.boom2()');
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:m.id,role:'authenticated'})]);
  const r = await c.query('select public.two_step_verify($1)o',[m.hash]);
  console.log('AUDIT_DOWN', JSON.stringify(r.rows[0].o));
}
await c.query('ROLLBACK');
await c.end();
