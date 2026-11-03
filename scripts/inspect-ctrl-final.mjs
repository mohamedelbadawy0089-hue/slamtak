import pg from 'pg';
import config from '../supabase/config.js';
const ref=(config.url||'').replace('https://','').split('.')[0];
const c=new pg.Client({host:'db.'+ref+'.supabase.co',port:5432,user:'postgres',password:process.env.SUPABASE_DB_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});
await c.connect();
const q=async(s,params)=>{try{const r=await c.query(s,params); return r.rows}catch(e){return [{err:e.message}]}}
console.log('CONTEXT_FUNCS:',
  (await q(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('current_warehouse_id','warehouse_id','current_tenant_id','tenant_id','current_user_warehouse_id','enforce_single_active_warehouse','set_active_warehouse_id','set_tenant_context','setup_user_after_signup','current_user_id')`)).map(r=>r.proname).join('\n'));
console.log('\nuser_warehouses_owners:',
  JSON.stringify((await q(`select count(*) as cnt, count(case when role_id is not null then 1 end) as with_role, count(case when is_active then 1 end) as active from user_warehouses`))[0]));
console.log('\nwarehouses_summary:',
  JSON.stringify((await q(`select count(*) as cnt, count(case when owner_user_id is not null then 1 end) as with_owner, count(case when manager_id is not null then 1 end) as with_manager, count(case when tenant_id is not null then 1 end) as with_tenant from warehouses`))[0]));
console.log('\nduplicate_owners? users with >1 warehouse in user_warehouses:',
  JSON.stringify((await q(`select u.id, u.email, uw.count wh_count from users u join (select user_id, count(*) count from user_warehouses group by user_id having count(*)>1) uw on uw.user_id=u.id limit 10`))[0]));
await c.end();
