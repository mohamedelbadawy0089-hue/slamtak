// مطابقة إصدارات أكشنات GitHub بين وثائق المستودع وسير العمل الفعلي (بلا شبكة وبلا تبعيات).
// المصدر الحاكم هو .github/workflows/*.yml: كل أكشن مذكور في الوثائق ومستخدم هناك
// يجب أن يطابق إصداره الرئيسي، وأي انحراف يُفشل الفحص.
// أكشن مذكور في الوثائق وغير مستخدم في أي workflow انحراف أيضًا ويُفشل الفحص: وثيقة
// تصف CI لا يجوز أن تنسب إلى المستودع أكشنًا لا يشغّله.
// والعكس بالعكس: كل أكشن يشغّله المستودع يجب أن يكون مذكورًا في الوثائق، وإلا فوثيقة
// النشر تصف خط أنابيب أنقص مما يُنفَّذ فعلاً.
// التشغيل: npm run check:docs-actions   (رمز الخروج 1 عند أي انحراف)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowsDir = path.join(root, '.github/workflows');
const docsDir = path.join(root, 'docs');

const failures = [];
const pass = (m) => console.log(`PASS  ${m}`);
const fail = (m) => (failures.push(m), console.log(`FAIL  ${m}`));

// uses: owner/action@ref — يتجاهل المسارات المحلية (./) وصور docker://
const useRe = /uses:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([^\s#'"]+)/g;
const isComment = (line) => /^\s*#/.test(line);
const actionKey = (action) => action.toLowerCase();
// الإصدار الرئيسي: v5 و v5.1.0 → v5؛ و SHA كامل → يُقارن نصًّا.
const refKey = (ref) => {
  const m = ref.match(/^v?(\d+)(?:\.\d+)*$/);
  return m ? `v${m[1]}` : ref.toLowerCase();
};

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });

// 1) الأكشنات الفعلية في الـ workflows
const used = new Map(); // action → [{file, line, ref}]
for (const file of fs.readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f))) {
  const lines = fs.readFileSync(path.join(workflowsDir, file), 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    for (const m of line.matchAll(useRe)) {
      const key = actionKey(m[1]);
      if (!used.has(key)) used.set(key, []);
      used.get(key).push({ file: `.github/workflows/${file}`, line: i + 1, action: m[1], ref: m[2] });
    }
  });
}

// 2) الأكشنات المذكورة في كل وثائق docs/ (معمارية، runbooks، وغيرها)
const docFiles = walk(docsDir).filter((f) => f.endsWith('.md')).sort();
const mentioned = [];
for (const file of docFiles) {
  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (isComment(line)) return;
      for (const m of line.matchAll(useRe)) {
        mentioned.push({
          file: path.relative(root, file),
          line: i + 1,
          action: m[1],
          ref: m[2],
          key: actionKey(m[1]),
        });
      }
    });
}

// 3) المقارنة: انحراف الإصدار أو أكشن مذكور وغير مستخدم — كلاهما فشل
const drift = [];
for (const doc of mentioned) {
  const actual = used.get(doc.key);
  if (!actual) {
    drift.push(`\`${doc.action}@${doc.ref}\` في ${doc.file}:${doc.line} غير مستخدم في أي workflow`);
    continue;
  }
  const refs = [...new Set(actual.map((a) => a.ref))];
  const expected = [...new Set(refs.map(refKey))];
  if (!expected.includes(refKey(doc.ref))) {
    drift.push(
      `${doc.file}:${doc.line} → \`${doc.action}@${doc.ref}\` والـ workflows تستخدم ${actual
        .map((a) => `\`${a.action}@${a.ref}\` (${a.file}:${a.line})`)
        .join(', ')}`,
    );
  }
}

drift.length
  ? drift.forEach((d) => fail(`انحراف أكشن: ${d}`))
  : pass(`كل أكشنات الوثائق مطابقة ومستخدمة (${mentioned.length} مرجعًا)`);

// 4) الاتجاه المعاكس: لا يجوز أن يشغّل المستودع أكشنًا لم تذكره الوثائق
const documented = new Set(mentioned.map((m) => m.key));
const undocumented = [...used].filter(([key]) => !documented.has(key));
undocumented.length
  ? undocumented.forEach(([, refs]) =>
      fail(
        `أكشن مستخدم وغير مذكور في الوثائق: \`${refs[0].action}@${refs[0].ref}\` (${refs
          .map((r) => `${r.file}:${r.line}`)
          .join(', ')})`,
      ),
    )
  : pass(`كل أكشنات الـ workflows مذكورة في الوثائق (${used.size})`);
const docCount = new Set(mentioned.map((m) => m.file)).size;
const actionCount = used.size;
console.log(
  `\n${failures.length ? '❌' : '✅'} ${failures.length} فشل · ${mentioned.length} مرجعًا في ${docCount} ملفًا · ${actionCount} أكشنًا في ${fs.readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f)).length} workflow`,
);
if (failures.length) {
  console.error(
    '\nوحّد إصدار الوثيقة مع الـ workflow، أو أزل الأكشن غير المستخدم منها، أو وثّق الأكشن الذي يشغّله المستودع، ثم أعد التشغيل.',
  );
  process.exit(1);
}
