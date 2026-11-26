// بوابة الأسرار المتتبَّعة: تفشل إذا دخل ملف بيئة إلى تتبّع Git، أو إذا اختفت قاعدة
// التجاهل التي تمنع دخوله من الأصل.
//
// السبب: `.dev.vars` كان متتبَّعًا على `main` من 2026-11-02 إلى 2026-11-26 ومعه مفتاح
// `service_role`، ولم يكشفه أي فحص في CI. `.gitignore` وحده لا يحمي: `git add -f`
// يتجاوزه، والملف يبقى متتبَّعًا حتى بعد إضافته إلى التجاهل.
//
// يفحص شيئين فقط، بلا شبكة وبلا تبعيات:
//   1) `git ls-files`: لا ملف متتبَّع اسمه `.dev.vars` أو `.dev.vars.*` أو `.env` أو
//      `.env.*` أو `*.env` — باستثناء القوالب `.env.example` و`.env.sample`
//      و`.env.template` و`.env.dist` التي تُلتزم عمدًا بلا أسرار.
//   2) `git check-ignore`: القواعد ما زالت تتجاهل `.dev.vars` و`.env` و`.env.local`،
//      كي لا يعود الملف بالتزام عادي بعد حذف سطر من `.gitignore`.
//
// التشغيل: npm run check:secrets   (رمز الخروج 1 عند أي مخالفة)
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];
const pass = (m) => console.log(`PASS  ${m}`);
const fail = (m) => (failures.push(m), console.log(`FAIL  ${m}`));

const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// القوالب المسموح التزامها: أسماء بلا قيم سرّية، ومقصودة للتوزيع.
const TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template', '.env.dist']);

const isSecretPath = (file) => {
  const base = path.posix.basename(file);
  if (TEMPLATES.has(base)) return false;
  if (base === '.dev.vars' || base.startsWith('.dev.vars.')) return true;
  if (base === '.env' || base.startsWith('.env.') || base.endsWith('.env')) return true;
  return false;
};

// 1) ملفات الأسرار في شجرة Git نفسها — لا في مجلد العمل.
const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
const offenders = tracked.filter(isSecretPath);

offenders.length
  ? offenders.forEach((file) =>
      fail(`ملف بيئة متتبَّع: ${file} — أخرجه بـ \`git rm --cached ${file}\` واحذف قيمه`),
    )
  : pass(`لا ملف .dev.vars أو .env متتبَّع (${tracked.length} ملفًا في الشجرة)`);

// 2) قواعد التجاهل ما زالت قائمة، فلا يعود الملف بالتزام عادي.
const mustBeIgnored = ['.dev.vars', '.env', '.env.local'];
const unignored = mustBeIgnored.filter((file) => {
  try {
    git('check-ignore', '-q', '--no-index', '--', file);
    return false;
  } catch {
    return true;
  }
});

unignored.length
  ? unignored.forEach((file) => fail(`\`${file}\` غير متجاهل في .gitignore`))
  : pass(`.gitignore يتجاهل: ${mustBeIgnored.join(' · ')}`);

console.log(
  `\n${failures.length ? '❌' : '✅'} ${failures.length} فشل · ${tracked.length} ملفًا متتبَّعًا · ${mustBeIgnored.length} قاعدة تجاهل`,
);
if (failures.length) {
  console.error(
    '\nالأسرار لا تُلتزم: أخرج الملف بـ `git rm --cached`، أضف قواعده إلى `.gitignore`، وأبطِل أي مفتاح ظهر في التاريخ.',
  );
  process.exit(1);
}
