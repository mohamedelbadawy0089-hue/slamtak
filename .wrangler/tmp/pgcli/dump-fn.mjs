// يطبع نص الدالة كاملًا (لا قيَماً حسّاسة) — لاستخدامه في بناء ملف الترحيل.
import pg from 'pg';
const c = new pg.Client({ host: process.env.SUPABASE_DB_HOST || 'db.iksjhjxwphmvthryfeae.supabase.co',
  port: Number(process.env.SUPABASE_DB_PORT || 6543), user: 'postgres', password: process.env.SUPABASE_DB_PASSWORD,
  database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
await c.connect();
const r = await c.query(`SELECT pg_get_functiondef(oid) d FROM pg_proc WHERE proname = $1`, [process.argv[2] || 'wms_register_workspace']);
process.stdout.write(r.rows[0].d);
await c.end();
