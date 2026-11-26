// بوابة الأسرار المتتبَّعة: تفشل إذا دخل ملف بيئة إلى تتبّع Git، أو إذا حمَل ملف
// متتبَّع مفتاحًا سرّيًا داخل محتواه، أو إذا اختفت قاعدة التجاهل التي تمنع دخوله.
//
// السبب: `.dev.vars` كان متتبَّعًا على `main` من 2026-11-02 إلى 2026-11-26 ومعه مفتاح
// `service_role`، ولم يكشفه أي فحص في CI. وفحص الأسماء وحده لا يكفي: المفتاح نفسه قد
// يُلصق في ملف JS أو JSON أو وثيقة. `.gitignore` أيضًا لا يحمي، لأن `git add -f`
// يتجاوزه، والملف يبقى متتبَّعًا حتى بعد إضافته إلى التجاهل.
//
// ثلاثة فحوص، بلا شبكة وبلا تبعيات:
//   1) `git ls-files`: لا ملف متتبَّع اسمه `.dev.vars` أو `.dev.vars.*` أو `.env` أو
//      `.env.*` أو `*.env` — باستثناء القوالب `.env.example` و`.env.sample`
//      و`.env.template` و`.env.dist` التي تُلتزم عمدًا بلا أسرار.
//   2) محتوى كل ملف متتبَّع نصيّ: لا JWT دوره `service_role`، ولا مفتاح `sb_secret_…`.
//      يُقرأ JWT ويُفكّ ترميز حمولته (base64url) لتأكيد الدور، فلا يُكتفى بمطابقة نصية.
//      ولا تُطبع قيمة أي مفتاح في أي رسالة — الملف والسطر والنوع فقط.
//   3) `git check-ignore`: القواعد ما زالت تتجاهل `.dev.vars` و`.env` و`.env.local`،
//      كي لا يعود الملف بالتزام عادي بعد حذف سطر من `.gitignore`.
//
// ما لا يفعله: لا يفحص تاريخ Git (مهمة `gitleaks-new-commits` في السير نفسه تفحص
// الالتزامات الجديدة فقط — مدى الحدث — بأنماط مزوّدين عامة)، ولا يبحث هنا عن أنماط
// أسرار عامة بلا اسم معروف (مفاتيح مزوّدين آخرين، كلمات مرور عشوائية)، ولا يقرأ
// ملفات أكبر من حدّ الحجم أدناه.
//
// التشغيل: npm run check:secrets   (رمز الخروج 1 عند أي مخالفة)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(SELF), '..');

// القوالب المسموح التزامها: أسماء بلا قيم سرّية، ومقصودة للتوزيع.
export const TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template', '.env.dist']);

// ملف أكبر من هذا لا يُمسح محتواه (يُذكر في التقرير، ولا يُسكَت عنه).
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

export const isSecretPath = (file) => {
  const base = path.posix.basename(file);
  if (TEMPLATES.has(base)) return false;
  if (base === '.dev.vars' || base.startsWith('.dev.vars.')) return true;
  if (base === '.env' || base.startsWith('.env.') || base.endsWith('.env')) return true;
  return false;
};

// JWT: ثلاثة مقاطع base64url. الحمولة تُفكّ ويُقرأ منها `role` فعليًا.
const JWT_RE = /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g;
// المفتاح السرّي الجديد في Supabase: بادئة معروفة وطول كبير. `sb_publishable_…` عام ولا يُمنع.
const SB_SECRET_RE = /sb_secret_[A-Za-z0-9_-]{16,}/g;

const jwtRole = (token) => {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload?.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
};

const lineOf = (content, index) => content.slice(0, index).split('\n').length;

// يعيد أنواع المخالفات في محتوى ملف واحد. لا تعود أي قيمة سرّية ضمن النتيجة.
export const findSecretContent = (content) => {
  const kinds = [];
  for (const match of content.matchAll(JWT_RE)) {
    if (jwtRole(match[0]) === 'service_role') {
      kinds.push({ kind: 'JWT بدور service_role', line: lineOf(content, match.index) });
    }
  }
  for (const match of content.matchAll(SB_SECRET_RE)) {
    kinds.push({ kind: 'مفتاح sb_secret_', line: lineOf(content, match.index) });
  }
  return kinds.sort((a, b) => a.line - b.line);
};

const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function scan() {
  const failures = [];
  const notes = [];

  // 1) ملفات الأسرار في شجرة Git نفسها — لا في مجلد العمل.
  const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
  for (const file of tracked.filter(isSecretPath)) {
    failures.push(`ملف بيئة متتبَّع: ${file} — أخرجه بـ \`git rm --cached ${file}\` واحذف قيمه`);
  }

  // 2) مفتاح ملصوق داخل ملف متتبَّع — الملفات النصية فقط، وبلا طباعة أي قيمة.
  let scanned = 0;
  let skipped = 0;
  for (const file of tracked) {
    const absolute = path.resolve(root, file);
    if (absolute === SELF) continue; // ملف البوابة نفسه يحمل الأنماط لا المفاتيح
    let stat;
    try {
      stat = fs.statSync(absolute);
    } catch {
      continue; // مسار في الشجرة بلا ملف في مجلد العمل (نادر، ولا يخصّ الفحص)
    }
    if (!stat.isFile() || stat.size > MAX_SCAN_BYTES) {
      skipped += 1;
      continue;
    }
    let content;
    try {
      content = fs.readFileSync(absolute, 'utf8');
    } catch {
      skipped += 1;
      continue;
    }
    if (content.includes('\u0000')) {
      skipped += 1; // ملف ثنائي
      continue;
    }
    scanned += 1;
    for (const { kind, line } of findSecretContent(content)) {
      failures.push(`مفتاح داخل ملف متتبَّع: ${file}:${line} — ${kind}`);
    }
  }
  if (skipped) notes.push(`تُخطّي محتوى ${skipped} ملفًا (ثنائي أو أكبر من ${MAX_SCAN_BYTES} بايت)`);

  // 3) قواعد التجاهل ما زالت قائمة، فلا يعود الملف بالتزام عادي.
  const mustBeIgnored = ['.dev.vars', '.env', '.env.local'];
  const unignored = mustBeIgnored.filter((file) => {
    try {
      git('check-ignore', '-q', '--no-index', '--', file);
      return false;
    } catch {
      return true;
    }
  });

  return { tracked, scanned, skipped, notes, unignored, mustBeIgnored, failures };
}

function main() {
  const { tracked, scanned, skipped, notes, unignored, mustBeIgnored, failures } = scan();
  const pass = (m) => console.log(`PASS  ${m}`);
  const fail = (m) => console.log(`FAIL  ${m}`);

  failures.filter((f) => f.startsWith('ملف بيئة')).forEach(fail);
  if (!failures.some((f) => f.startsWith('ملف بيئة'))) {
    pass(`لا ملف .dev.vars أو .env متتبَّع (${tracked.length} ملفًا في الشجرة)`);
  }

  failures.filter((f) => f.startsWith('مفتاح داخل')).forEach(fail);
  if (!failures.some((f) => f.startsWith('مفتاح داخل'))) {
    pass(`لا مفتاح service_role ولا sb_secret_ داخل ${scanned} ملفًا متتبَّعًا`);
  }

  unignored.forEach((file) => fail(`\`${file}\` غير متجاهل في .gitignore`));
  if (!unignored.length) pass(`.gitignore يتجاهل: ${mustBeIgnored.join(' · ')}`);

  notes.forEach((n) => console.log(`NOTE  ${n}`));

  console.log(
    `\n${failures.length ? '❌' : '✅'} ${failures.length} فشل · ${tracked.length} ملفًا متتبَّعًا · ${scanned} ممسوحًا · ${skipped} متخطّى`,
  );
  if (failures.length) {
    console.error(
      '\nالأسرار لا تُلتزم: أخرج الملف بـ `git rm --cached`، أو أزل المفتاح من الكود وضعه في .dev.vars المحلي، وأبطِل أي مفتاح ظهر في التاريخ.',
    );
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === SELF;
if (invokedDirectly) main();
