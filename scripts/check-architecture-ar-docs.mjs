// فحص دوسيه المعمارية العربي (بلا شبكة وبلا تبعيات، للقراءة فقط).
// يتحقق من: وجود الوثائق 01–13 وفهرس README، أسوار الكود، إحالات «§قسم»
// (عربية بالرمز `NN` أو إنجليزية باسم ملف)، تكرار معرّفات عقد mermaid، اسم
// العقد العام للوحدة، ووجود كل ملف مشار إليه في المستودع.
// التشغيل: npm run check:docs-ar   (رمز الخروج 1 عند أي FAIL)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'docs/architecture-ar');
const searchDirs = [
  root,
  path.join(root, 'docs/architecture'),
  path.join(root, 'docs/architecture/api'),
  path.join(root, 'supabase/tests'),
];

const failures = [];
const advisories = [];
const pass = (m) => console.log(`PASS  ${m}`);
const fail = (m) => (failures.push(m), console.log(`FAIL  ${m}`));
const warn = (m) => (advisories.push(m), console.log(`WARN  ${m}`));

const resolveRef = (name) => searchDirs.map((p) => path.join(p, name)).find((f) => fs.existsSync(f)) ?? null;
const headingsOf = (src) =>
  new Set(src.split('\n').map((l) => l.match(/^#{2,4}\s+(\d+(?:\.\d+)*)[.\s]/)?.[1]).filter(Boolean));
const inHeadings = (set, sec) => set.has(sec) || [...set].some((h) => h.startsWith(sec + '.'));

const headingsCache = new Map();
const headingsAt = (file) => {
  if (!headingsCache.has(file)) headingsCache.set(file, headingsOf(fs.readFileSync(file, 'utf8')));
  return headingsCache.get(file);
};

// نموذج الوثيقة: المصدر، الأسطر (لفحص الأسوار والعقد)، أسطر النثر مع أرقامها،
// كتل mermaid، وفهرس العناوين.
const readDoc = (file) => {
  const src = fs.readFileSync(path.join(dir, file), 'utf8');
  const lines = src.split('\n');
  const body = [];
  const blocks = [];
  let inFence = false;
  let block = null;

  lines.forEach((line, i) => {
    const t = line.trim();
    if (block) {
      if (t.startsWith('```')) {
        blocks.push(block);
        block = null;
      } else block.body.push(line);
      return;
    }
    if (t.startsWith('```mermaid')) return void (block = { at: i + 1, body: [] });
    if (t.startsWith('```')) return void (inFence = !inFence);
    if (!inFence) body.push({ n: i + 1, line });
  });

  const code = file === 'README.md' ? 'README' : file.slice(0, 2);
  return { file, src, code, lines, body, blocks, headings: headingsOf(src) };
};

const docs = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.md'))
  .sort()
  .map(readDoc);
const byCode = new Map(docs.map((d) => [d.code, d]));

// 1) الوثائق 01–13 وفهرس README
const missing = Array.from({ length: 13 }, (_, i) => String(i + 1).padStart(2, '0')).filter((c) => !byCode.has(c));
missing.length ? fail(`وثائق ناقصة: ${missing.join(', ')}`) : pass('الوثائق 01–13 موجودة كلها');

const readmeText = byCode.get('README')?.src ?? '';
const indexGaps = [...byCode.keys()].filter((c) => c !== 'README' && !readmeText.includes('`' + c + '`'));
indexGaps.length
  ? fail(`فهرس README لا يذكر: ${indexGaps.join(', ')}`)
  : pass('فهرس README يذكر كل وثيقة');

// 2) أسوار الكود المتوازنة (أساس كل فحص يعتمد على تتبّع الكتل)
for (const d of docs) {
  const fences = d.lines.filter((l) => l.trim().startsWith('```'));
  fences.length % 2 ? fail(`${d.file}: أسوار كود غير متوازنة (${fences.length})`) : pass(`${d.file}: أسوار الكود متوازنة`);
}

// 3) كل «§قسم» تُنسب إلى وثيقة: بعدها «في `NN`»، أو آخر اسم ملف/رمز قبلها، وإلا
//    فهي إحالة داخل الوثيقة نفسها. الإحالة باسم ملف تُفحص في عناوين الملف نفسه.
const secRe = /§\s*(\d+(?:\.\d+)*)(?:\s*[–—-]\s*§?\s*(\d+(?:\.\d+)*))?/g;
const afterDoc = /^\s*في\s+`(README|\d{2})`/;
const codeToken = /^(README|\d{2})$/;
const fileToken = /\.(?:md|ya?ml|sql)$/;
const bareDoc = /(?<![\w.`\d])(\d{2})\s*$/;

const refIssues = new Set();
let arRefs = 0;
let enRefs = 0;

for (const d of docs) {
  for (const { n, line } of d.body) {
    for (const m of line.matchAll(secRe)) {
      const secs = [m[1], m[2]].filter(Boolean);
      const before = line.slice(0, m.index);
      let dest = line.slice(m.index + m[0].length).match(afterDoc)?.[1];
      let enFile = null;

      if (!dest) {
        const last = [...before.matchAll(/`([^`]+)`/g)].at(-1);
        const token = last && !before.slice(last.index + last[0].length).includes('§') ? last[1] : null;
        if (token && codeToken.test(token)) dest = token;
        else if (token && fileToken.test(token)) enFile = token;
        else dest = before.match(bareDoc)?.[1];
      }

      if (enFile) {
        const file = resolveRef(enFile);
        if (!file) continue; // الملف المفقود يبلغ عنه فحص المراجع
        enRefs++;
        for (const s of secs) {
          if (!inHeadings(headingsAt(file), s)) refIssues.add(`${d.file}:${n} → \`${enFile}\` §${s} غير موجود فيه`);
        }
        continue;
      }

      arRefs++;
      const target = byCode.get(dest ?? d.code);
      if (!target) refIssues.add(`${d.file}:${n} → \`${dest}\` غير موجود`);
      else for (const s of secs) {
        if (!inHeadings(target.headings, s)) refIssues.add(`${d.file}:${n} → \`${target.code}\` §${s} غير موجود`);
      }
    }
  }
}
refIssues.size
  ? [...refIssues].forEach(fail)
  : pass(`كل إحالات الأقسام صحيحة (${arRefs} عربية + ${enRefs} إنجليزية)`);

// 4) mermaid: تكرار تعريف عقدة (لا ذكرها في الأسهم) يدمج عقدتين أو يُفسد التخطيط
//    بلا رفض من Mermaid؛ نفحص تعليمات flow/graph فقط ونتجاهل نصوص التسميات.
const mermaidIssues = [];
let flowBlocks = 0;
for (const d of docs) {
  for (const { at, body } of d.blocks) {
    const code = body.join('\n').replace(/"[^"]*"/g, '""');
    if (!/^(flowchart|graph)\b/.test(code.trim())) continue;
    flowBlocks++;
    const defs = new Map();
    for (const m of code.matchAll(/(?<![\w-])([A-Za-z_][\w-]*)\s*[\[({]/g)) defs.set(m[1], (defs.get(m[1]) ?? 0) + 1);
    const dups = [...defs].filter(([, n]) => n > 1).map(([id]) => id);
    if (dups.length) mermaidIssues.push(`${d.file}:${at} → معرّفات عقد مكرّرة: ${dups.join(', ')}`);
  }
}
mermaidIssues.length
  ? mermaidIssues.forEach(fail)
  : pass(`لا معرّفات عقد mermaid مكرّرة (فُحصت ${flowBlocks} من كتل flow)`);

// 5) العقد العام للوحدة: public.ts، ولا يُعتمد index.ts (النهي الصريح مسموح)
const contractViolations = [];
let prohibitions = 0;
for (const d of docs) {
  d.lines.forEach((line, i) => {
    for (const m of line.matchAll(/(?<![\w.])`?index\.ts`?/g)) {
      if (/(^|\s)لا\s*`?$/.test(line.slice(Math.max(0, m.index - 14), m.index))) prohibitions++;
      else contractViolations.push(`${d.file}:${i + 1} → ${line.trim().slice(0, 90)}`);
    }
  });
}
contractViolations.length
  ? contractViolations.forEach((v) => fail(`عقد مخالف (index.ts): ${v}`))
  : pass(`لا يُعتمد index.ts كعقد (${prohibitions} ذكر نهي مسموح)`);

const lacksPublic = ['01', '02', '13'].filter((c) => byCode.has(c) && !byCode.get(c).src.includes('public.ts'));
lacksPublic.length ? fail(`public.ts غير مذكور في: ${lacksPublic.join(', ')}`) : pass('public.ts مذكور في 01 و02 و13');

const treeLine = byCode.get('02')?.lines.find((l) => /[├└]─\s*public\.ts/.test(l));
treeLine ? pass(`شجرة 02 تُظهر العقد: ${treeLine.trim()}`) : fail('شجرة 02 §7 لا تُظهر سطر public.ts');

// 6) كل ملف مشار إليه موجود فعلًا. تُستثنى أسماء القوالب (<date>، YYYYMM…)، ويُنبَّه
//    على ملف مخطّط له في الوثائق ولم يُنشأ بعد بدل إفشال البوابة.
const planned = new Set(['0000_baseline.sql']);
const fileIssues = new Set();
let fileRefs = 0;

for (const d of docs) {
  for (const { n, line } of d.body) {
    for (const m of line.matchAll(/`([^`]+?\.(?:md|ya?ml|sql))`/g)) {
      const name = m[1];
      if (/[<>{}]|^YYYY/.test(name)) continue; // اسم قالب لا ملف
      if (planned.has(name)) {
        warn(`${d.file}:${n} → \`${name}\` ملف مخطّط له ولم يُنشأ بعد`);
        continue;
      }
      fileRefs++;
      if (!resolveRef(name)) fileIssues.add(`${d.file}:${n} → \`${name}\` غير موجود في المستودع`);
    }
  }
}
fileIssues.size
  ? [...fileIssues].forEach(fail)
  : pass(`كل الملفات المشار إليها موجودة (${fileRefs} مرجعًا)`);

console.log(`\n${failures.length ? '❌' : '✅'} ${failures.length} فشل · ${advisories.length} تنبيه · ${docs.length} ملفًا مفحوصًا`);
if (failures.length) {
  console.error('\nأصلح ما سبق ثم أعد التشغيل.');
  process.exit(1);
}
