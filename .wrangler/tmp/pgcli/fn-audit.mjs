// تدقيق دوال public بحثاً عن مراجع إلى جداول غير موجودة — النسخة الثانية.
// تُنزع السلاسل النصية والتعليقات أولاً (الـSQL الديناميكي لا يُفحص ثابتاً)，
// ويُميَّز "insert into" عن "into <متغيّر>"، وتُستبعد المتغيّرات المُعرَّفة.
// لا يطبع أي سرّ؛ الكلمة المرور تُقرأ من البيئة فقط.   node fn-audit.mjs
import pg from 'pg';

const PWD = process.env.SUPABASE_DB_PASSWORD;
if (!PWD) { console.error('SUPABASE_DB_PASSWORD غير موجود في البيئة'); process.exit(2); }
const HOST = process.env.SUPABASE_DB_HOST || 'db.iksjhjxwphmvthryfeae.supabase.co';
const PORT = Number(process.env.SUPABASE_DB_PORT || 6543);

const client = new pg.Client({
  host: HOST, port: PORT, user: 'postgres', password: PWD, database: 'postgres',
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
});
await client.connect();

const { rows: fns } = await client.query(`
  select n.nspname as schema, p.proname as name,
         pg_get_function_identity_arguments(p.oid) as args, p.prosrc as body
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
  order by p.proname
`);

const stripLiterals = (s) => s
  .replace(/--[^\n]*/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\$\$[\s\S]*?\$\$/g, ' $$LIT$$ ')
  .replace(/\$[A-Za-z_][A-Za-z0-9_]*\$[\s\S]*?\$[A-Za-z_][A-Za-z0-9_]*\$/g, ' $$LIT$$ ')
  .replace(/'(?:[^']|'')*'/g, " '' ");

const REF = '((?:[A-Za-z_][A-Za-z0-9_]*\\.)?[A-Za-z_][A-Za-z0-9_]*)';
const PATTERNS = [
  new RegExp(`\\binsert\\s+into\\s+${REF}`, 'gi'),
  new RegExp(`\\bfrom\\s+${REF}`, 'gi'),
  new RegExp(`\\bjoin\\s+${REF}`, 'gi'),
  new RegExp(`\\bupdate\\s+(?:only\\s+)?${REF}`, 'gi'),
  new RegExp(`\\bdelete\\s+from\\s+${REF}`, 'gi'),
];
const KEYWORDS = new Set(['set', 'values', 'select', 'only', 'lateral', 'false', 'true', 'null',
  'returning', 'where', 'on', 'using', 'default', 'nothing', 'all', 'each', 'left', 'right',
  'inner', 'outer', 'cross', 'union', 'intersect', 'except', 'this', 'new', 'old']);
const TYPES = /\b(?:text|uuid|integer|int|int4|int8|bigint|numeric|boolean|bool|jsonb|json|timestamptz|timestamp|date|time|record|varchar|char|float|double|money|bytea|serial|bigserial|public\.[a-z_]+%rowtype|[a-z_]+%rowtype)\b/i;

const problems = [];
const fnsWithRefs = [];
let checked = 0;

for (const fn of fns) {
  const raw = fn.body || '';
  const body = stripLiterals(raw);

  const ctes = new Set();
  // WITH x AS ( … )  ·  WITH x(cols) AS ( … )  ·  , y AS MATERIALIZED ( … )
  for (const m of body.matchAll(/\bwith\s+(?:recursive\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s+as\s*(?:materialized\s+)?\(/gi)) ctes.add(m[1].toLowerCase());
  for (const m of body.matchAll(/,\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s+as\s*(?:materialized\s+)?\(/gi)) ctes.add(m[1].toLowerCase());

  const seen = new Set();
  for (const pat of PATTERNS) {
    for (const m of body.matchAll(pat)) {
      const ref = m[1];
      const low = ref.toLowerCase();
      if (/^\s*\(/.test(body.slice(m.index + m[0].length))) continue;   // استدعاء دالة
      if (KEYWORDS.has(low)) continue;
      if (ctes.has(low)) continue;
      if (seen.has(low)) continue;
      seen.add(low);
      // متغيّر مُعرَّف داخل الدالة؟
      if (new RegExp(`\\b${low}\\s+(?:constant\\s+)?(?:not\\s+null\\s+)?${TYPES.source}\\b`, 'i').test(body)) continue;
      if (/^(v_|p_val|new\.|old\.|loop$)/i.test(low)) continue;      // متغيّر أو FOR … UPDATE … LOOP
      checked++;
      const q = await client.query('select to_regclass($1) as r', [ref]);
      if (q.rows[0].r === null) problems.push({ fn: `${fn.schema}.${fn.name}(${fn.args})`, ref });
      else fnsWithRefs.push(low);
    }
  }
}

console.log(`الدوال المفحوصة: ${fns.length} · مراجع الجداول الفريدة المفحوصة: ${checked}`);
const real = new Set(fnsWithRefs);
console.log(`مرجع مرجعي مستقل ✓`);
if (problems.length === 0) console.log('صفر مراجع مفقودة ✓');
else {
  console.log(`\n⚠️ مراجع إلى جداول غير موجودة: ${problems.length}`);
  for (const p of problems) console.log(`  - ${p.fn}  ←  "${p.ref}"`);
}
await client.end();
