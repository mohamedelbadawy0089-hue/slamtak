import pg from 'pg'
import config from '../supabase/config.js'
const ref=(config.url||'').replace('https://','').split('.')[0]
const c=new pg.Client({host:'db.'+ref+'.supabase.co',port:5432,user:'postgres',password:process.env.SUPABASE_DB_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}})
await c.connect()
const exec = async (sql,params)=>{try{const r=await c.query(sql,params);return r.rows}catch(e){return [{error:e.message}]}}
const sql = async (sql,params)=> await c.query(sql,params)
// list tables relevant to tenant/module/settings/plans/membership/subscriptions
const tables = await exec(`select tablename from pg_tables where schemaname='public' order by tablename`)
const focus = ['warehouses','user_warehouses','tenants','tenant_modules','tenant_settings','tenant_permissions','tenant_roles','tenant_invitations','tenant_subscriptions','tenant_usage_stats','warehouse_modules','warehouse_settings','warehouse_permissions','warehouse_roles','warehouse_invitations','warehouse_subscriptions','warehouse_usage_stats','plans','subscriptions','roles','role_permissions','permissions','warehouse_employees','warehouse_password_hashes','audit_logs','warehouse_audit_logs','audit_log']
console.log('FOCUS TABLES PRESENT:')
for (const t of focus) console.log(`${tables.some(r=>r.tablename===t)?'YES':'no'}  ${t}`)
const cols = async (t)=> await exec(`select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`,[t])
console.log('\nSUPER_ADMIN / WAREHOUSE MGMT TABLES COLUMNS:\n')
for (const t of ['warehouses','user_warehouses','warehouse_employees','warehouse_password_hashes','plans','subscriptions','tenant_modules','tenant_settings','tenant_permissions','tenant_roles','tenant_invitations','tenant_subscriptions','tenant_usage_stats','warehouse_modules','warehouse_settings','warehouse_permissions','warehouse_roles','warehouse_invitations','warehouse_subscriptions','warehouse_usage_stats','roles','role_permissions','permissions','audit_logs','warehouse_audit_logs']){
  const rows = await cols(t)
  if (rows.length) {
    console.log(`${t}:`)
    for (const r of rows) console.log(`  ${r.column_name} ${r.data_type}${r.is_nullable==='NO'?' NOTNULL':''}${r.column_default?(' default '+r.column_default):''}`)
  }
}
// show register_warehouse_v2 signature + body summary
const regFn = await exec(`select pg_get_functiondef(p.oid) f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='register_warehouse_v2'`)
console.log('\nregister_warehouse_v2:'); if(regFn[0]?.f) console.log(regFn[0].f)
// any function that creates tenant + warehouse + user link in one go?
const creFns = await exec(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like any (array['register_%','create_warehouse','setup_warehouse','onboard_warehouse','init_warehouse','provision_warehouse'])`)
console.log('\nregistration-like functions:', creFns.map(r=>r.proname).join(', ') || 'none listed')
// check presence of trigger on auth.users insert for auto-setup
const triggers = await exec(`select trigger_name, event_manipulation, action_statement from information_schema.triggers where trigger_schema='public' and event_manipulation='INSERT' and object_table='users'`)
console.log('\ntriggers on public.users (INSERT):', triggers.length? triggers.map(t=>`${t.trigger_name}: ${t.event_manipulation} on ${t.object_table} -> ${t.action_statement}`).join('\n') : 'none')
// members / roles present?
console.log('\nroles sample:', (await exec(`select id, name, label, is_system, is_active from roles limit 10`)).map(r=>`${r.id} | ${r.name} | ${r.is_system} | ${r.isActive??r.is_active??''}`).join('\n') || 'none')
console.log('\nplans sample:', (await exec(`select id, name, slug, max_users, max_products from plans limit 10`)).map(r=>`${r.id} | ${r.name} | ${r.slug} | max_users=${r.max_users} max_products=${r.max_products}`).join('\n') || 'none')
await c.end()
