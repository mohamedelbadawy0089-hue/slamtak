// فحص الروابط النسبية والمراسي في وثائق المعمارية (عربي + إنجليزي) — بلا شبكة.
//
// بوابة check:docs-ar تفحص الملفات المشار إليها داخل الوثائق العربية فقط،
// وبوابة check:docs-actions تفحص أكشنات CI. لا شيء كان يفحص روابط
// docs/architecture/ ولا الروابط من نوع `file.md#section` في أي منهما.
//
// ما يفحصه هذا السكربت:
//   1) كل هدف نسبي في [نص](هدف) و![alt](هدف) موجود فعلًا على القرص.
//   2) كل مرساة `#قسم` (سواء داخل الوثيقة أو بعد اسم ملف) تطابق عنوانًا
//      حقيقيًا في الملف الهدف، بقواعد GitHub في توليد المعرّفات (slug).
//   3) لا هدف يحلّ خارج المستودع.
//
// لا تُفحص الروابط الخارجية (http/https/mailto) لأن الفحص يجب أن يبقى بلا شبكة،
// ولا يُقرأ داخل أسوار الكود (قد تحتوي أمثلة وأوامر تحوي أقواسًا).
//
// التشغيل: npm run check:docs-links   (رمز الخروج 1 عند أي رابط أو مرساة مكسورة)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docDirs = ['docs/architecture', 'docs/architecture-ar']
  .map((d) => path.join(root, d))
  .filter((d) => fs.existsSync(d));

if (!docDirs.length) {
  console.error('❌ لا مجلد وثائق للفحص');
  process.exit(1);
}

const failures = [];
let files = 0;
let links = 0;
let anchors = 0;
let external = 0;
let declared = 0;

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.md') ? [full] : [];
  });

// الأسطر خارج أسوار الكود فقط: الأوامر والأمثلة ليست روابط ولا عناوين.
const proseLines = (src) => {
  const out = [];
  let fence = null;
  src.split('\n').forEach((line, i) => {
    const m = line.match(/^\s*(```+|~~~+)/);
    if (m) {
      if (!fence) fence = m[1][0].repeat(3);
      else if (line.trim().startsWith(fence)) fence = null;
      return;
    }
    // نص الشيفرة المضمّنة ليس رابطًا (`code`)؛ تُحذف علاماته ويبقى متنه.
    if (!fence) out.push({ n: i + 1, line: line.replace(/`([^`]*)`/g, '$1') });
  });
  return out;
};

// معرّف GitHub للعنوان: حروف صغيرة، حذف الترقيم، المسافات → شرطات.
// (نفس مجموعة github-slugger: تبقى الحروف العربية والأرقام والشرطة والشرطة السفلية.)
const slugify = (heading) =>
  heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // رابط → نصه
    .replace(/<[^>]+>/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g, '')
    .replace(/\s/g, '-');

const anchorCache = new Map();
const anchorsOf = (file) => {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const seen = new Map();
  for (const { line } of proseLines(fs.readFileSync(file, 'utf8'))) {
    const m = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const base = slugify(m[1]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    seen.set(count ? `${base}-${count}` : base, 0);
  }
  const set = new Set([...seen.keys()]);
  anchorCache.set(file, set);
  return set;
};

const linkRe = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const decode = (s) => {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
};

for (const file of docDirs.flatMap(walk)) {
  files++;
  const rel = path.relative(root, file);
  for (const { n, line } of proseLines(fs.readFileSync(file, 'utf8'))) {
    for (const m of line.matchAll(linkRe)) {
      const raw = m[1].trim();
      if (/^(https?:|mailto:|tel:|data:)/i.test(raw)) {
        external++;
        continue;
      }
      const at = `${rel}:${n}`;
      const hashAt = raw.indexOf('#');
      const target = hashAt === -1 ? raw : raw.slice(0, hashAt);
      const fragment = hashAt === -1 ? '' : decode(raw.slice(hashAt + 1)).trim();

      if (!target) anchors++; // مرساة داخل الوثيقة نفسها

      if (target) {
        links++;
        const resolved = path.resolve(path.dirname(file), decode(target).split('?')[0]);
        if (!resolved.startsWith(root + path.sep)) {
          failures.push(`${at} → \`${raw}\` خارج المستودع`);
          continue;
        }
        if (!fs.existsSync(resolved)) {
          failures.push(`${at} → \`${raw}\` غير موجود`);
          continue;
        }
        if (fragment && resolved.endsWith('.md')) {
          declared++;
          if (!anchorsOf(resolved).has(fragment)) {
            failures.push(`${at} → \`${raw}\` مرساة غير موجودة في \`${path.relative(root, resolved)}\``);
          }
        }
      } else if (fragment) {
        if (!anchorsOf(file).has(fragment)) {
          failures.push(`${at} → \`${raw}\` مرساة غير موجودة في الوثيقة نفسها`);
        }
      }
    }
  }
}

const label = `فُحصت ${files} وثيقة · ${links} رابطًا نسبيًا · ${anchors} مرساة داخلية · ${declared} مرساة عبر ملفات · ${external} رابطًا خارجيًا (متجاوَز)`;
if (failures.length) {
  failures.forEach((f) => console.log(`FAIL  ${f}`));
  console.error(`\n❌ ${failures.length} رابط/مرساة مكسورة · ${label}`);
  process.exit(1);
}
console.log(`✅ كل الروابط والمراسي سليمة · ${label}`);
