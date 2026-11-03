import pg from 'pg';
import config from '../supabase/config.js';
const ref=(config.url||'').replace('https://','').split('.')[0];
const c=new pg.Client({host:'db.'+ref+'.supabase.co',port:5432,user:'postgres',password:process.env.SUPABASE_DB_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});
await c.connect();
const q=async(s,params)=>{try{const r=await c.query(s,params); return r.rows}catch(e){return [{err:e.message}]}}
const colsOf = async (t) => (await q(`select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`,[t]));
const showCols = ['warehouses','user_warehouses','warehouse_password_hashes','warehouse_employees','warehouse_pharmacies','warehouse_zones','warehouse_products_flexible','warehouses','warehouses'];
const out = [];
for(const w of showCols){ const rows=await colsOf(w); out.push(`${w.toUpperCase()}:\n` + rows.map(r=>`  ${r.column_name} ${r.data_type}${r.is_nullable==='NO'?' NOTNULL':''}${r.column_default?(' default '+r.column_default):''}`).join('\n')); }
console.log(out.join('\n'));
await c.end();
