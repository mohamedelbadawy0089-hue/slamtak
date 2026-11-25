// اختبار دائم لمنطق جلسة الواجهة: علامة الخطوة الثانية، حارس التوجيه، وأسباب فشل verifySession.
// يقرأ الدوال من public/app.js نفسها عبر وسوم #region كي لا يختبر نسخة منفصلة تتقادم.
// التشغيل: npm run test:auth
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const appPath = path.join(dir, '..', 'public', 'app.js');
const APP_SRC = fs.readFileSync(appPath, 'utf8');

function region(name) {
  const start = APP_SRC.indexOf(`// #region ${name}`);
  const end = APP_SRC.indexOf(`// #endregion ${name}`);
  assert.ok(start >= 0 && end > start, `وسم #region ${name} مفقود في public/app.js`);
  return APP_SRC.slice(start, end);
}

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

const blockedStorage = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
  removeItem() { throw new Error('blocked'); },
};

// يبني وحدة اختبار من كود التطبيق الفعلي مع بدائل للشبكة وDOM
function build({ client = null, storage = memoryStorage(), sessionWriteOk = true, user = { id: 'u-1' } } = {}) {
  const calls = { navigate: [], setSession: [], clearSession: 0, errors: [], rendered: [] };
  const errBox = { textContent: '' };

  const setSession = (s) => {
    calls.setSession.push(s);
    if (!sessionWriteOk) return false;
    try { storage.setItem('session', JSON.stringify(s)); return true; } catch { return false; }
  };
  const clearSession = () => {
    calls.clearSession += 1;
    try { storage.removeItem('session'); } catch { /* تخزين محجوب */ }
  };
  const fakeClient = client === null ? null : {
    auth: { getSession: client.getSession },
    rpc: client.rpc || (async () => ({ data: null, error: null })),
  };

  const globals = {
    // تُمرر صراحةً كي لا يقرأ الكود تخزين Node العام (webstorage) بدل التخزين الوهمي
    localStorage: storage,
    sessionStorage: storage,
    getSupabase: () => fakeClient,
    pickRoleName: () => '',
    setSession,
    clearSession,
    document: { getElementById: (id) => (id === 'auth-form-error' ? errBox : null) },
    navigate: (p) => calls.navigate.push(p),
    renderStep2Form: (appEl, info) => calls.rendered.push(info),
    app: {},
    sb: undefined,
  };
  const names = Object.keys(globals);
  const body = [
    region('step2-guard'),
    region('auth-session-core'),
    'return { verifySession, step2Ok, writeStep2Mark, clearStep2Mark, resumePendingStep2, AUTH_FAIL, getTried: () => __step2ResumeTried };',
  ].join('\n');

  const api = new Function(...names, body)(...names.map((n) => globals[n]));
  return { api, calls, errBox, storage, user };
}

test('علامة الخطوة الثانية: تُكتب وتُقرأ وتُمسح', () => {
  const { api, storage } = build();
  assert.equal(api.step2Ok('u-1'), false, 'قبل الكتابة مرفوضة');
  assert.equal(api.writeStep2Mark('u-1'), true, 'الكتابة تنجح');
  assert.equal(api.step2Ok('u-1'), true, 'نفس المستخدم مقبول');
  assert.equal(api.step2Ok('u-2'), false, 'مستخدم آخر مرفوض');
  assert.ok(storage.getItem('step2_ok'), 'العلامة محفوظة في التخزين');
  api.clearStep2Mark();
  assert.equal(api.step2Ok('u-1'), false, 'بعد المسح مرفوضة');
});

test('علامة الخطوة الثانية: صيغة قديمة وقيمة تالفة وتخزين محجوب', () => {
  const { api, storage } = build();
  storage.setItem('step2_ok', JSON.stringify({ uid: 'u-1', at: 1 }));
  assert.equal(api.step2Ok('u-1'), true, 'صيغة {uid,at} القديمة مقبولة');
  storage.setItem('step2_ok', 'not-json');
  assert.equal(api.step2Ok('u-1'), false, 'قيمة تالفة لا ترمي ولا تُقبل');
  assert.equal(api.step2Ok(''), false, 'uid الفارغ مرفوض دائمًا');

  const blocked = build({ storage: blockedStorage });
  assert.equal(blocked.api.writeStep2Mark('u-1'), true, 'الذاكرة تكفي حين يُحجب التخزين');
  assert.equal(blocked.api.step2Ok('u-1'), true, 'الجلسة تُقبل بلا تخزين');
});

test('علامة مستخدم آخر لا تحجب المستخدم الحالي', () => {
  const { api, storage } = build();
  storage.setItem('step2_ok', JSON.stringify({ uid: 'u-2', at: 1 }));
  assert.equal(api.writeStep2Mark('u-1'), true);
  assert.equal(api.step2Ok('u-1'), true);
  assert.equal(api.step2Ok('u-2'), false);
});

test('verifySession: بدون عميل Supabase', async () => {
  const { api } = build({ client: null });
  const res = await api.verifySession();
  assert.deepEqual(res, { ok: false, reason: api.AUTH_FAIL.NO_CLIENT });
});

test('verifySession: لا جلسة مصادقة', async () => {
  const { api, calls } = build({
    client: { getSession: async () => ({ data: { session: null }, error: null }) },
  });
  const res = await api.verifySession();
  assert.deepEqual(res, { ok: false, reason: api.AUTH_FAIL.NO_SESSION });
  assert.equal(calls.clearSession, 1, 'تُمسح الجلسة المحلية');
});

test('verifySession: الخطوة الثانية معلّقة', async () => {
  const user = { id: 'u-1', email: 'a@b.c', user_metadata: {} };
  const { api, calls, storage } = build({
    client: { getSession: async () => ({ data: { session: { user, access_token: 't' } }, error: null }) },
    user,
  });
  const res = await api.verifySession();
  assert.deepEqual(res, { ok: false, reason: api.AUTH_FAIL.STEP2_PENDING });
  assert.equal(calls.setSession.length, 0, 'لا تُثبَّت جلسة قبل الخطوة الثانية');
  assert.equal(storage.getItem('session'), null);
});

test('verifySession: تعذّر تثبيت الجلسة في المتصفح', async () => {
  const user = { id: 'u-1', email: 'a@b.c', user_metadata: {} };
  const { api, calls } = build({
    client: { getSession: async () => ({ data: { session: { user, access_token: 't' } }, error: null }) },
    sessionWriteOk: false,
    user,
  });
  api.writeStep2Mark('u-1');
  const res = await api.verifySession();
  assert.deepEqual(res, { ok: false, reason: api.AUTH_FAIL.STORAGE_FAILED });
  assert.equal(calls.setSession.length, 1, 'حاولت التثبيت فعلًا');
});

test('verifySession: نجاح يعيد الجلسة ويصفّر الحارس', async () => {
  const user = { id: 'u-1', email: 'a@b.c', user_metadata: { role: 'manager' } };
  const { api, storage } = build({
    client: { getSession: async () => ({ data: { session: { user, access_token: 'tok' } }, error: null }) },
    user,
  });
  api.writeStep2Mark('u-1');
  const res = await api.verifySession();
  assert.equal(res.ok, true);
  assert.equal(res.session.id, 'u-1');
  assert.equal(res.session.access_token, 'tok');
  assert.equal(api.getTried(), false, 'الحارس يُصفَّر بعد نجاح حقيقي');
  assert.ok(storage.getItem('session'), 'الجلسة مثبّتة');
});

test('verifySession: استثناء غير متوقع يُرجع السبب error', async () => {
  const { api } = build({
    client: { getSession: async () => { throw new Error('boom'); } },
  });
  const res = await api.verifySession();
  assert.deepEqual(res, { ok: false, reason: api.AUTH_FAIL.ERROR });
});

test('الحارس: محاولة تسليم واحدة ثم رسالة بدل الحلقة', async () => {
  const user = { id: 'u-1', email: 'a@b.c', user_metadata: { role: 'manager' } };
  const { api, calls, errBox } = build({
    client: { getSession: async () => ({ data: { session: { user, access_token: 't' } }, error: null }) },
    user,
  });
  api.writeStep2Mark('u-1');

  await api.resumePendingStep2({});
  assert.deepEqual(calls.navigate, ['/'], 'أول محاولة توجّه للرئيسية مرة واحدة');
  assert.equal(api.getTried(), true);

  await api.resumePendingStep2({});
  await api.resumePendingStep2({});
  assert.deepEqual(calls.navigate, ['/'], 'لا توجيه إضافي — لا حلقة');
  assert.match(errBox.textContent, /تعذّر إعادة فتح جلستك/, 'رسالة واضحة للمستخدم');
});

test('الحارس: بلا علامة لا توجيه إلى الرئيسية', async () => {
  const user = { id: 'u-1', email: 'a@b.c', user_metadata: {} };
  const { api, calls, errBox } = build({
    client: { getSession: async () => ({ data: { session: { user, access_token: 't' } }, error: null }) },
    user,
  });
  await api.resumePendingStep2({});
  assert.deepEqual(calls.navigate, []);
  assert.equal(errBox.textContent, '', 'لا رسالة خطأ في المسار الطبيعي');
});

test('الحارس: بلا جلسة Supabase لا شيء يحدث', async () => {
  const { api, calls } = build({
    client: { getSession: async () => ({ data: { session: null }, error: null }) },
  });
  await api.resumePendingStep2({});
  assert.deepEqual(calls.navigate, []);
});

test('ربط الكود: نتائج verifySession تُقرأ بالسبب لا بالصدق/الكذب', () => {
  assert.equal(/if \(\s*!auth\.ok\s*\)/.test(APP_SRC), true, 'render يستخدم auth.ok');
  assert.equal(/if \(!sessionInfo\)/.test(APP_SRC), false, 'لا بقايا لفحص الصدق على نتيجة verifySession');
  assert.equal(/reason === AUTH_FAIL\.STORAGE_FAILED/.test(APP_SRC), true, 'فشل التخزين مميّز عن انتهاء الجلسة');
});
