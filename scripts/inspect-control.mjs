import pg from 'pg';
import config from '../supabase/config.js';
const ref=(config.url||'').replace('https://','').split('.')[0];
const c=new pg.Client({host:'db.'+ref+'.supabase.co',port:5432,user:'postgres',password:process.env.SUPABASE_DB_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});
await c.connect();
const q=async(s,params)=>{try{const r=await c.query(s,params); return r.rows}catch(e){return [{err:e.message}]}}
const wcols = async (t)=>(await q(`select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`,[t]));
console.log('WAREHOUSES:', (await wcols('warehouses')).map(r=>`${r.column_name} ${r.data_type}${r.is_nullable==='NO'?' NOTNULL':''}${r.column_default?(' default '+r.column_default):''}`).join('\n'));
console.log('\nUSER_WAREHOUSES:', (await wcols('user_warehouses')).map(r=>`${r.column_name} ${r.data_type}${r.is_nullable==='NO'?' NOTNULL':''}${r.column_default?(' default '+r.column_default):''}`).join('\n'));
console.log('\ncurrent_warehouse_id def:', (await q(`select pg_get_functiondef(p.oid) from pg_proc p where p.proname='current_warehouse_id'`)).map(r=>r.pg_get_functiondef).join('\n'));
console.log('\ncurrent_user_warehouse_id def:', (await q(`select pg_get_functiondef(p.oid) from pg_proc p where p.proname='current_user_warehouse_id'`)).map(r=>r.pg_get_functiondef).join('\n'));
const rp = await q(`select tablename, policyname, cmd, permissive, pg_get_expr(aclexpr, aclexpr::text::regclass::oid) as rule from pg_policies where schemaname='public' and tablename in ('warehouses','user_warehouses')`);
console.log('\npolicies:', JSON.stringify(rp.map(r=>`${r.tablename}: ${r.policyname} [${r.cmd} ${r.permissive}] ${r.rule||''}`)));
await c.end();
