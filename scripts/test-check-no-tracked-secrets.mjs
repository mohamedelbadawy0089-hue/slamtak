// اختبار بوابة الأسرار: يثبت أن `scripts/check-no-tracked-secrets.mjs` تفشل فعلًا عند
// وجود مفتاح service_role ملصوق في ملف متتبَّع أو مفتاح sb_secret_، ولا تفشل على
// مفتاح anon العام ولا على مفتاح publishable.
//
// لا يحمل هذا الملف أي مفتاح حقيقي: كل الرموز تُبنى وقت التشغيل من أجزائها، حتى لا
// تصبح البوابة نفسها ملفًا تلتقطه.
//
// التشغيل: npm run test:secrets   (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isSecretPath, findSecretContent } from './check-no-tracked-secrets.mjs';

const SELF = fileURLToPath(import.meta.url);
const GATE = path.join(path.dirname(SELF), 'check-no-tracked-secrets.mjs');

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
// JWT بشكل Supabase القديم: ترويسته وفيمته و"توقيعه" بلا أي قيمة سرّية.
const jwtWithRole = (role) =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', ref: 'demo', role })}.${'sig'.padEnd(24, 'x')}`;
const fakeSecretKey = 'sb_' + 'secret_' + 'Ab3'.repeat(8);
const fakePublishableKey = 'sb_' + 'publishable_' + 'Ab3'.repeat(8);

const makeRepo = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-gate-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(GATE, path.join(dir, 'scripts', 'check-no-tracked-secrets.mjs'));
  fs.writeFileSync(path.join(dir, '.gitignore'), '.dev.vars\n.env\n.env.local\n');
  return dir;
};

const runGate = (cwd) =>
  spawnSync(process.execPath, [path.join('scripts', 'check-no-tracked-secrets.mjs')], {
    cwd,
    encoding: 'utf8',
  });

test('أسماء ملفات البيئة: تُرفض، والقوالب تُقبل', () => {
  for (const name of ['.dev.vars', '.dev.vars.prod', '.env', '.env.local', 'config/prod.env']) {
    assert.equal(isSecretPath(name), true, name);
  }
  for (const name of ['.env.example', '.env.sample', '.env.template', '.env.dist', 'env.js']) {
    assert.equal(isSecretPath(name), false, name);
  }
});

test('يكشف JWT بدور service_role ولا يكشف anon', () => {
  const admin = findSecretContent(`const key = "${jwtWithRole('service_role')}";`);
  assert.equal(admin.length, 1);
  assert.equal(admin[0].line, 1);
  assert.match(admin[0].kind, /service_role/);

  assert.equal(findSecretContent(`const key = "${jwtWithRole('anon')}";`).length, 0);
});

test('يكشف sb_secret_ ولا يكشف sb_publishable_', () => {
  assert.equal(findSecretContent(`const k = '${fakeSecretKey}';`).length, 1);
  assert.equal(findSecretContent(`const k = '${fakePublishableKey}';`).length, 0);
});

test('رسالة المخالفة لا تحمل قيمة المفتاح', () => {
  const findings = findSecretContent(`const k = '${fakeSecretKey}';\nconst j = '${jwtWithRole('service_role')}';`);
  const text = JSON.stringify(findings);
  assert.ok(!text.includes(fakeSecretKey));
  assert.ok(!text.includes(jwtWithRole('service_role')));
  assert.equal(findings.length, 2);
  assert.deepEqual(
    findings.map((f) => f.line),
    [1, 2],
  );
});

test('تكامل: تفشل البوابة فعلًا عند مفتاح داخل ملف متتبَّع', () => {
  const dir = makeRepo();
  try {
    const key = jwtWithRole('service_role');
    fs.writeFileSync(path.join(dir, 'app.js'), `const SERVICE = "${key}";\n`);
    execFileSync('git', ['add', '-A'], { cwd: dir });

    const result = runGate(dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /app\.js:1/);
    assert.ok(!result.stdout.includes(key), 'قيمة المفتاح لا تُطبع');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('تكامل: تنجح عند Anon فقط، وتفشل عند ملف .dev.vars متتبَّع', () => {
  const dir = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'app.js'), `const PUB = "${jwtWithRole('anon')}";\n`);
    execFileSync('git', ['add', '-A'], { cwd: dir });
    assert.equal(runGate(dir).status, 0);

    fs.writeFileSync(path.join(dir, '.dev.vars'), 'SUPABASE_SERVICE_ROLE_KEY=x\n');
    execFileSync('git', ['add', '-f', '.dev.vars'], { cwd: dir });
    const result = runGate(dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /\.dev\.vars/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
