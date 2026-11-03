import pg from 'pg';
import config from '../supabase/config.js';
const ref = (config.url || '').replace('https://','').split('.')[0];
const c = new pg.Client({host:'db.'+ref+'.supabase.co',port:5432,user:'postgres',password:process.env.SUPABASE_DB_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});
await c.connect();
const q = async(s)=>{try{return (await c.query(s)).rows}catch(e){return [{err:e.message}]}}
console.log('profiles tenant_id idx', JSON.stringify(await q("select indexname, indexdef from pg_indexes where schemaname='public' and tablename='profiles' and indexdef ilike '%tenant_id%'")));
console.log('users with warehouse_id', JSON.stringify(await q('select count(*)::int n from public.users where warehouse_id is not null')));
console.log('uw active per user >1', JSON.stringify(await q("select count(*)::int offenders from (select user_id from public.user_warehouses where coalesce(is_active,true) group by user_id having count(*)>1) x")));
console.log('uw sample multi', JSON.stringify(await q("select user_id, count(*) c from public.user_warehouses where coalesce(is_active,true) group by user_id having count(*)>1 limit 5")));
console.log('profiles missing tenant', JSON.stringify(await q('select count(*)::int n from public.profiles where tenant_id is null')));
await c.end();
