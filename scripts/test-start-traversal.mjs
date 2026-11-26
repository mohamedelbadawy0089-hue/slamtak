// اختبار حارس المسار في start.js: يطلب الخادم فعليًا بمسارات «..» مشفّرة (تُرسل
// على السلك كما هي، بلا تطبيع) ويثبت أنها تعيد 404، وأن المسارات المشروعة تعيد 200.
// التشغيل: npm run test:start
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let server;
let port;

// منفذ حرّ: نطلبه من النظام ثم نحرّره قبل تشغيل الخادم.
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port: p } = probe.address();
      probe.close(() => resolve(p));
    });
  });
}

// طلب HTTP خام: نكتب سطر الطلب حرفيًا فلا يطبّع العميل «..» قبل الإرسال.
function rawGet(rawPath) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    let buf = '';
    socket.setEncoding('utf8');
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error(`مهلة الطلب: ${rawPath}`));
    });
    socket.on('connect', () => {
      socket.write(`GET ${rawPath} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    });
    socket.on('data', (chunk) => {
      buf += chunk;
    });
    socket.on('end', () => {
      const match = /^HTTP\/1\.[01] (\d{3})/.exec(buf);
      resolve({ status: match ? Number(match[1]) : NaN, body: buf });
    });
    socket.on('error', reject);
  });
}

const status = async (rawPath) => (await rawGet(rawPath)).status;

before(async () => {
  port = await freePort();
  server = spawn(process.execPath, [path.join(ROOT, 'start.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      if ((await status('/')) === 200) return;
    } catch (e) {
      /* الخادم لم يستمع بعد */
    }
    if (server.exitCode !== null) throw new Error(`خادم التطوير توقف بكود ${server.exitCode}`);
    if (Date.now() > deadline) throw new Error('لم يستجب خادم التطوير خلال 10 ثوانٍ');
    await new Promise((r) => setTimeout(r, 100));
  }
});

after(() => {
  if (server && server.exitCode === null) server.kill();
});

test('مسارات «..» المشفّرة تعيد 404 ولا تصل ملفًا خارج public/ أو devtools/', async () => {
  const attempts = [
    '/devtools/../.dev.vars',
    '/%2e%2e/.dev.vars',
    '/devtools/%2e%2e/.dev.vars',
    '/devtools/../../.dev.vars',
    '/devtools/%2e%2e/%2e%2e/.dev.vars',
    '/..%2f.dev.vars',
    '/..%2F..%2Fetc%2Fpasswd',
    '/devtools/..%2fpackage.json',
    '/.dev.vars',
  ];
  for (const rawPath of attempts) {
    const res = await rawGet(rawPath);
    assert.equal(res.status, 404, `يجب 404 لـ${rawPath}`);
    assert.equal(/^\s*(SECRET|SUPABASE)/m.test(res.body.split('\r\n\r\n')[1] || ''), false, `لا يتسرّب محتوى لـ${rawPath}`);
  }
});

test('ترميز % غير صالح يعيد 404 بلا انهيار', async () => {
  assert.equal(await status('/%E0%A4%A'), 404);
  assert.equal(await status('/devtools/%ZZ'), 404);
});

test('المسارات المشروعة ما زالت تعمل', async () => {
  assert.equal(await status('/'), 200);
  assert.equal(await status('/index.html'), 200);
  assert.equal(await status('/?debug=true'), 200);
  assert.equal(await status('/app.js'), 200);
  assert.equal(await status('/devtools/audit-check.js'), 200);
});

test('المسار المفقود داخل الجذر يعيد 404 لا 200 فارغًا', async () => {
  assert.equal(await status('/no-such-file.js'), 404);
  assert.equal(await status('/devtools/no-such-file.js'), 404);
});
