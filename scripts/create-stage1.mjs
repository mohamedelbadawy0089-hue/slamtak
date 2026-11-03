import pg from 'pg';
import config from '../supabase/config.js';
const ref=(config.url||'').replace('https://','').split('.')[0];
const c=new pg.Client({host:'db.'+ref+'.supabase.co',port:5432,user:'postgres',password:process.env.SUPABASE_DB_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});
await c.connect();
const q=async(s)=>{try{const r=await c.query(s); return r.rows}catch(e){return [{err:e.message}]}}

// 1. Add warehouse_code column to warehouses if not exists/ensure unique
// The code column already exists per schema, but let's ensure uniqueness constraint + index
console.log('Checking warehouse code column...');
const hasCode = (await q(`select count(*) as c from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='code'`))[0].c;
console.log('warehouses.code exists:', hasCode>0);

// 2. Ensure warehouse_codes table exists (from migration 202610310001)
console.log('\nwarehouse_codes table:');
const wc = await q(`select count(*) as c from information_schema.tables where table_schema='public' and table_name='warehouse_codes'`);
console.log('exists:', wc[0].c>0);

// 3. Check RLS policies on warehouses
console.log('\nRLS on warehouses:');
const pols = await q(`select policyname, cmd, permissive from pg_policies where schemaname='public' and tablename='warehouses'`);
console.log('policies:', pols.length ? pols.map(p=>`${p.policyname} [${p.cmd} ${p.permissive}]`).join(', ') : 'none');

// 4. Check user_warehouses RLS
console.log('\nRLS on user_warehouses:');
const pols2 = await q(`select policyname, cmd, permissive from pg_policies where schemaname='public' and tablename='user_warehouses'`);
console.log('policies:', pols2.length ? pols2.map(p=>`${p.policyname} [${p.cmd} ${p.permissive}]`).join(', ') : 'none');

// 5. Check enforce_single_active_warehouse trigger
console.log('\nenforce_single_active_warehouse trigger:');
const trig = await q(`select trigger_name, event_manipulation from information_schema.triggers where trigger_schema='public' and event_object_table='user_warehouses'`);
// look for our trigger
const trig2 = await q(`select trigger_name from information_schema.triggers where trigger_schema='public' and action_statement like '%enforce_single_active_warehouse%'`);
// actually look in pg_event
const trig3 = await q(`select tgname, tgrelid::regclass::text from pg_trigger where tgrelid = 'public.user_warehouses'::regclass`);
console.log('pg_trigger names:', trig3.map(t=>t.tgname).join(', '));

// 6. Check if there's a unique index on user_warehouses(user_id, warehouse_id) or similar
console.log('\nuser_warehouses unique constraints:');
const uq = await q(`select conname, contype, pg_get_constraintdef(oid) from pg_constraint where conname like any(array['%user_warehouse%','%warehouse_user%']) or contype='u' and pg_get_constraintdef(oid) like '%user_warehouses%'`);
// just list all unique constraints on user_warehouses
const allUQ = await q(`select conname, contype, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.user_warehouses'::regclass and contype='u'`);
console.log('unique constraints:', allUQ.map(u=>`${u.conname}: ${u.def}`).join(', '));

await c.end();
