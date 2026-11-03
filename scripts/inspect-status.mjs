import pg from 'pg';
import config from '../supabase/config.js';
const ref=(config.url||'').replace('https://','').split('.')[0];
const c=new pg.Client({host:'db.'+ref+'.supabase.co',port:5432,user:'postgres',password:process.env.SUPABASE_DB_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});
await c.connect();
const q=async(s,params)=>{try{const r=await c.query(s,params); return r.rows}catch(e){return [{err:e.message}]}}
const collist = async (t) => (await q(`select column_name, data_type, is_nullable, column_default, character_maximum_length from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`,[t]));
const colsJSON = async (t) => JSON.stringify((await collist(t)).map(r=>`${r.column_name}: ${r.data_type}${r.is_nullable==='NO'?' notnull':''}${r.column_default?(' default '+r.column_default):''}${r.character_maximum_length?(' maxlen '+r.character_maximum_length):''}`));

console.log('WAREHOUSES + USER_WAREHOUSES:');
console.log(await colsJSON('warehouses'));
console.log('\n', await colsJSON('user_warehouses'));

// any status-like columns/ets on these?
for(const t of ['warehouses','user_warehouses']){
  const statusCols = await q(`select column_name, data_type from information_schema.columns where table_schema='public' and table_name=$1 and (lower(column_name) in ('status','is_active','is_default','state','lifecycle') or lower(column_name) like '%status%')`,[t]);
  console.log(`\n${t} status-ish cols:`, statusCols.length?statusCols.map(s=>`${s.column_name} ${s.data_type}`).join(', '):'none');
}

// any enum types at all?
const enums = await q(`select t.typname, e.enumlabel from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_class c on c.oid=t.typrelid join pg_namespace n on n.oid=c.relnamespace where t.typtype='e' and n.nspname='public' order by e.enumsortorder, t.typname`);
console.log('\nANY ENUMS:', enums.length? enums.map(e=>`${e.typname}::${e.enumlabel}`).join('\n') : 'none');

// list functions roughly related to registration, teams, memberships
const fns = await q(`select proname, prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('register_warehouse_v2','team_list','team_remove_member','rbac_member_get','get_warehouse_plan','current_tenant_context','get_wh_subscription_status','get_wh_plan_settings','get_wh_plan_limits','set_wh_password','enforce_one_warehouse_per_user','enforce_single_active_warehouse','current_user_warehouse_id','current_user_id','current_tenant_id','warehouse_id_secure')`);
console.log('\nKEY FUNCS:', fns.length? fns.map(f=>`${f.proname}(${f.prosrc?JSON.stringify(f.prosrc).slice(0,120):''})`).join('\n'):'none');

// check if warehouse-related tables even have RLS (any policies for warehouses, user_warehouses, warehouse_employees, warehouse_password_hashes)
const pols = await q(`select tablename, count(*) policies from pg_policies where schemaname='public' and tablename in ('warehouses','user_warehouses','warehouse_employees','warehouse_password_hashes','warehouse_pharmacies','warehouse_zones','warehouse_products_flexible','warehouse_audit_logs','warehouse_invitations','warehouse_roles','warehouse_permissions','warehouse_members','warehouse_settings','warehouse_modules','warehouse_subscriptions') group by tablename order by tablename`);
console.log('\nRLS POLICIES (warehouse tables):', pols.length? pols.map(p=>`${p.tablename}: ${p.policies}`).join('\n') : 'none. note: pg_policies empty?');
await c.end();
