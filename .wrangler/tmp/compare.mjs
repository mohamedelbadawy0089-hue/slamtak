// مقارنة أعمدة الجداول المتوقعة (من الملفات الثلاثة) مع القاعدة الحالية.
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const want = JSON.parse(readFileSync(new URL('./expected.json', import.meta.url), 'utf8'));
const tables = Object.keys(want);
const inList = tables.map(t => `'${t}'`).join(',');

let out = '';
try {
  out = execFileSync('node', ['.wrangler/tmp/pgcli/run.mjs', '--probe',
    `select table_name, column_name from information_schema.columns where table_schema='public' and table_name in (${inList}) order by table_name, ordinal_position`],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
} catch (e) {
  console.error('probe failed: ' + (e.stderr || e.message));
  process.exit(1);
}

const have = {};
const lines = out.split('\n').slice(1).filter(l => l.includes('|'));
for (const l of lines) {
  const [t, c] = l.split('|').map(s => s.trim());
  (have[t] = have[t] || []).push(c);
}

let missingTables = [], partial = [], aligned = [];
for (const t of tables) {
  if (!have[t]) { missingTables.push(t); continue; }
  const miss = want[t].filter(c => !have[t].includes(c));
  const extra = have[t].filter(c => !want[t].includes(c));
  if (miss.length || extra.length) partial.push({ t, miss, extra, have: have[t].length });
  else aligned.push(t);
}

console.log(`المطلوب: ${tables.length} جدولاً`);
console.log(`  ✅ متطابقة تماماً (${aligned.length}): ${aligned.join(', ') || '—'}`);
console.log(`  ⚠️  موجودة لكن ناقصة/مختلفة (${partial.length}):`);
for (const p of partial) {
  console.log(`     ${p.t}: أعمدتها الآن ${p.have} | ناقص ${p.miss.length}${p.miss.length ? ' → ' + p.miss.join(',') : ''}${p.extra.length ? ' | زائد → ' + p.extra.join(',') : ''}`);
}
console.log(`  ❌ مفقودة تماماً (${missingTables.length}): ${missingTables.join(', ') || '—'}`);

// ما تتوقعه الواجهة فعلياً من الجداول الموجودة والمختلفة
const app = readFileSync('public/app.js', 'utf8');
console.log('\nاستدعاءات الواجهة على الجداول المختلفة:');
for (const p of partial) {
  const re = new RegExp(`from\\("${p.t}"\\)\\.select\\("([^"]{0,400})`, 'g');
  let m, seen = new Set();
  while ((m = re.exec(app))) { if (!seen.has(m[1])) { seen.add(m[1]); console.log(`  ${p.t}: select("${m[1].slice(0, 300)}")`); } }
  if (!seen.size) console.log(`  ${p.t}: (لا select مباشر مطابق)`);
}
