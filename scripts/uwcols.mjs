import pg from 'pg';
import config from './supabase/config.js';
const ref=(config.url||'').replace('https://','').split('.')[0];
const c=new pg.Client({host:'db.'+ref+'.supabase.co',port:5432,user:'postgres',password:process.env.SUPABASE_DB_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});
await c.connect();
const cols=await c.query("select column_name from information_schema.columns where table_schema='public' and table_name='user_warehouses' order by ordinal_position");
console.log(cols.rows.map(r=>r.column_name).join('\n'));
await c.end();
