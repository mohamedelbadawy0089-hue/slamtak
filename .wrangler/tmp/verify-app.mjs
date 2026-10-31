// فحص شامل ومُصحّح: كل ما تستدعيه الواجهة (جداول + دوال RPC + أعمدة SELECT) هل موجود فعلاً؟
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

const probe = (sql) => execFileSync('node', ['.wrangler/tmp/pgcli/run.mjs', '--probe', sql],
  { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });

// يعيد صفوف الناتج (يتجاهل سطر العناوين والصف الفارغ)
const rows = (out) => out.split('\n').map(l => l.trim())
  .filter(l => l && l !== '(لا صفوف)').slice(1)
  .map(l => l.split('|').map(s => s.trim()));

const uniq = (a) => [...new Set(a)];
const inList = (xs) => xs.map(x => `'${x}'`).join(',');

const app = readFileSync('public/app.js', 'utf8');
const rpcs = uniq([...app.matchAll(/\.rpc\(\s*["']([a-z_0-9]+)["']/g)].map(m => m[1]));
const tables = uniq([...app.matchAll(/\.from\(\s*["']([a-z_0-9]+)["']/g)].map(m => m[1]));

console.log(`الواجهة تستدعي: ${rpcs.length} دالة RPC و ${tables.length} جدولاً`);

let fails = 0;

// 1) الدوال
const rOut = probe(`select routine_name from information_schema.routines where routine_schema='public' and routine_name in (${inList(rpcs)})`);
const haveRpc = new Set(rows(rOut).map(r => r[0]));
const missRpc = rpcs.filter(r => !haveRpc.has(r));
console.log(`  الدوال: ${rpcs.length - missRpc.length}/${rpcs.length} موجودة${missRpc.length ? ' — ناقصة: ' + missRpc.join(', ') : ' ✅'}`);
fails += missRpc.length;

// 2) الجداول
const tOut = probe(`select relname from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v','p','f') and relname in (${inList(tables)})`);
const haveTab = new Set(rows(tOut).map(r => r[0]));
const missTab = tables.filter(t => !haveTab.has(t));
console.log(`  الجداول: ${tables.length - missTab.length}/${tables.length} موجودة${missTab.length ? ' — ناقصة: ' + missTab.join(', ') : ' ✅'}`);
fails += missTab.length;

// 3) أعمدة نصوص select المعقدة على الجداول الموجودة
const pairs = [];
const re = /\.from\(\s*["']([a-z_0-9]+)["']\s*\)\s*\.select\(\s*["']([^"']{1,300})["']/g;
let m;
while ((m = re.exec(app))) {
  const [_, t, sel] = m;
  if (sel.trim() === '*') continue;
  if (!haveTab.has(t)) continue;
  for (let f of sel.split(',')) {
    f = f.trim();
    if (!f || f === '*') continue;
    const field = f.split(':')[0].trim();          // alias embed: department:departments(...)
    if (!/^[a-z_][a-z0-9_]*$/i.test(field)) continue;
    pairs.push([t, field]);
  }
}
const uniqPairs = uniq(pairs.map(p => p.join('.'))).map(s => s.split('.'));
const bad = [];
for (const [t, c] of uniqPairs) {
  const o = probe(`select 1 from information_schema.columns where table_schema='public' and table_name='${t}' and column_name='${c}'`);
  if (!rows(o).length) bad.push(`${t}.${c}`);
}
console.log(`  أعمدة مُختارة في select: ${uniqPairs.length} فحصاً — ناقصة: ${bad.length ? bad.join(', ') : 'لا شيء ✅'}`);
fails += bad.length;

console.log(fails ? `\n✖ المتبقي: ${fails} فجوة` : '\n✅ كل ما تستدعيه الواجهة موجود في القاعدة');
process.exit(fails ? 1 : 0);
