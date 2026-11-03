import pg from 'pg';
import config from '../supabase/config.js';
const ref=(config.url||'').replace('https://','').split('.')[0];
const c=new pg.Client({host:'db.'+ref+'.supabase.co',port:5432,user:'postgres',password:process.env.SUPABASE_DB_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});
await c.connect();
const q=async(s)=>{try{return (await c.query(s)).rows}catch(e){return [{err:e.message}]}}
console.log('TABLES', (await q("select tablename from pg_tables where schemaname='public' order by tablename").map(t=>t.tablename)).join('\n'));
const enums=await q("select t.typname, array_agg(e.enumlabel order by e.enumsortorder) vals from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typname in ('status_manifest','status_purchase','vendor_status','purchase_status_enum') group by t.typname order by t.typname");
console.log('ENUMS', JSON.stringify(enums.map(e=>e.typname+': '+e.vals.join(','))));
const rls=await q(`select tablename, policyname, cmd, permissive, pg_get_expr(aclexpr, aclexpr::text::regclass::oid) as rule from pg_policies where schemaname='public' and tablename like 'purchase%' or tablename in ('suppliers','inventory') order by tablename, policyname`);
console.log('RLS', JSON.stringify(rls.map(r=>`${r.tablename}: ${r.policyname} [${r.cmd} ${r.permissive}] ${r.rule||''}`).join('\n')));
console.log('CTX', (await q(`select proname from pg_proc where proname in ('current_warehouse','warehouse_context','current_user_warehouse','current_tenant','tenant_context','user_tenant_id','open_warehouse_context','with_warehouse')`))[0].map(r=>r.proname).join('\n'));
await c.end();
