import pg from 'pg';
import fs from 'fs';
import config from '../supabase/config.js';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/db-apply-sql.mjs <file.sql>'); process.exit(1); }
const sql = fs.readFileSync(file, 'utf8');
const projectRef = (config.url || '').replace('https://', '').split('.')[0];

const client = new pg.Client({
  host: `db.${projectRef}.supabase.co`,
  port: 5432,
  user: 'postgres',
  password: process.env.SUPABASE_DB_PASSWORD,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

await client.connect();
console.log('CONNECTED', projectRef);

try {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log('APPLIED', file);
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('FAILED', e.message, e.position || '');
  await client.end();
  process.exit(1);
}

const chk = await client.query(
  `select p.oid::regprocedure::text as sig,
          pg_get_function_result(p.oid) as ret,
          coalesce(p.proacl::text, '(default)') as acl
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'two_step_verify'`
);
console.log('VERIFY', JSON.stringify(chk.rows, null, 1));

await client.end();
