import pg from 'pg';
import config from '../supabase/config.js';
const ref=(config.url||'').replace('https://','').split('.')[0];
const c=new pg.Client({host:'db.'+ref+'.supabase.co',port:5432,user:'postgres',password:process.env.SUPABASE_DB_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});
await c.connect();
const q=async(s,params)=>{try{const r=await c.query(s,params); return r.rows}catch(e){return [{err:e.message}]}}
const tbls = await q("select tablename from pg_tables where schemaname='public' order by tablename");
const wants = ['warehouses','warehouse_settings','warehouse_modules','warehouse_members','warehouse_roles','warehouse_permissions','warehouse_invitations','warehouse_audit_logs','warehouse_subscriptions','warehouse_password_hashes','warehouse_employees','warehouse_pharmacies','warehouse_zones','warehouse_products_flexible','user_warehouses','warehouse_codes','tenants','tenant_modules','tenant_permissions','tenant_members','tenant_roles','tenant_audit_logs','tenant_invitations','tenant_subscriptions','tenant_settings'];
const present = tbls.map(t=>t.tablename);
console.log('EXISTING TABLES (warehouse/tenant-ish names):');
for(const w of wants){ console.log((present.includes(w)?'YES':'no'),w); }
const colsOf = async (t) => (await q(`select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`,[t])).map(c=>`${c.column_name} ${c.data_type}${c.is_nullable==='NO'?' NOTNULL':''}${c.column_default?(' default '+c.column_default):''}`);
const showCols = ['warehouses','user_warehouses','warehouse_password_hashes','warehouse_employees','warehouse_pharmacies','warehouse_zones','warehouse_products_flexible','warehouse_codes'];
for(const w of showCols){ if(present.includes(w)){ console.log('\n', w.toUpperCase(), ':', await colsOf(w).join(', ')); } }
await c.end();
