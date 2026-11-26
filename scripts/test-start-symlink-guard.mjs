// اختبار حارس الروابط الرمزية: يبني جذرًا مؤقتًا فيه رابط رمزي إلى ملف خارج الجذر
// ورابط إلى مجلد أعلى، ويثبت أن containedPath يرفضهما لأن الفحص على المسار الحقيقي
// (fs.realpathSync) لا على النصّ.
// التشغيل: npm run test:start
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { containedPath } = require('../start.js');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-guard-'));
  const publicDir = path.join(dir, 'public');
  fs.mkdirSync(publicDir);
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html>ok');
  fs.writeFileSync(path.join(dir, '.dev.vars'), 'SUPABASE_SERVICE_ROLE_KEY=x\n');
  fs.mkdirSync(path.join(dir, 'devtools'));
  fs.writeFileSync(path.join(dir, 'devtools', 'audit-check.js'), '// devtool');

  // رابط رمزي إلى سرّ خارج الجذر، ورابط إلى الجذر الأب كاملًا.
  fs.symlinkSync(path.join(dir, '.dev.vars'), path.join(publicDir, 'leak.txt'));
  fs.symlinkSync(dir, path.join(publicDir, 'up'));
  fs.symlinkSync(path.join(dir, 'devtools'), path.join(publicDir, 'tools'));
  // رابط داخلي مشروع: يبقى مقبولًا.
  fs.symlinkSync(path.join(publicDir, 'index.html'), path.join(publicDir, 'alias.html'));

  return { dir, publicDir, devtoolsDir: path.join(dir, 'devtools') };
}

test('الرابط الرمزي إلى ملف خارج الجذر يُرفض', (t) => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.dir, { recursive: true, force: true }));

  assert.equal(containedPath(fx.publicDir, '/leak.txt'), null);
  assert.equal(containedPath(fx.publicDir, '/alias.html'), fs.realpathSync(path.join(fx.publicDir, 'index.html')));
});

test('الرابط الرمزي إلى مجلد أعلى يُرفض ولا يفتح مسارًا نسبيًا عبره', (t) => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.dir, { recursive: true, force: true }));

  assert.equal(containedPath(fx.publicDir, '/up/.dev.vars'), null);
  assert.equal(containedPath(fx.publicDir, '/up/package.json'), null);
  assert.equal(containedPath(fx.publicDir, '/tools'), null);
  assert.equal(containedPath(fx.publicDir, '/tools/audit-check.js'), null);
});

test('الملفات الحقيقية داخل الجذر تُقبل، والمفقودة تُرفض', (t) => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.dir, { recursive: true, force: true }));

  assert.equal(containedPath(fx.publicDir, '/index.html'), fs.realpathSync(path.join(fx.publicDir, 'index.html')));
  assert.equal(containedPath(fx.devtoolsDir, '/audit-check.js'), fs.realpathSync(path.join(fx.devtoolsDir, 'audit-check.js')));
  assert.equal(containedPath(fx.publicDir, '/missing.js'), null);
  assert.equal(containedPath(fx.publicDir, '/../.dev.vars'), null);
});

test('الجذر غير الموجود لا يفتح شيئًا', () => {
  assert.equal(containedPath(path.join(os.tmpdir(), 'start-guard-absent'), '/index.html'), null);
});
