import pg from 'pg';
import config from '../supabase/config.js';

const projectRef = (config.url || '').replace('https://', '').split('.')[0];
const client = new pg.Client({
  host: `db.${projectRef}.supabase.co`,
  port: 5432,
  user: 'postgres',
  password: process.env.SUPABASE_DB_PASSWORD,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
});
await client.connect();

// Everything runs inside a transaction that is rolled back: no audit rows are kept.
await client.query('BEGIN');

async function callAs(userId, hash) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: userId, role: 'authenticated' })]);
  const r = await client.query('SELECT public.two_step_verify($1) AS out', [hash]);
  return r.rows[0].out;
}

async function findUser(kind) {
  if (kind === 'manager') {
    const r = await client.query(`
      SELECT u.id, w.password_hash AS hash
        FROM public.users u
        JOIN public.warehouses w ON w.manager_id = u.id
       WHERE coalesce(w.password_hash, '') <> ''
         AND coalesce(u.is_active, true)
       LIMIT 1`);
    return r.rows[0];
  }
  const r = await client.query(`
    SELECT u.id, u.staff_password_hash AS hash
      FROM public.users u
     WHERE coalesce(u.staff_password_hash, '') <> ''
       AND coalesce(u.is_active, true)
       AND EXISTS (SELECT 1 FROM public.user_warehouses uw
                    WHERE uw.user_id = u.id AND coalesce(uw.is_active, true))
     LIMIT 1`);
  return r.rows[0];
}

const mgr = await findUser('manager');
const emp = await findUser('employee');

const results = {};
if (mgr) {
  results.manager_correct = await callAs(mgr.id, mgr.hash);
  results.manager_wrong = await callAs(mgr.id, 'x'.repeat(43));
}
if (emp) {
  results.employee_correct = await callAs(emp.id, emp.hash);
  results.employee_wrong = await callAs(emp.id, 'y'.repeat(43));
}

console.log(JSON.stringify(results, null, 1));

await client.query('ROLLBACK');
await client.end();
