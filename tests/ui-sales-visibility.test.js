// اختبار مرئية زر/قسم "المبيعات" في الواجهة — يعمل بدون متصفح عبر DOM stub.
// يشغّل public/app.js فعلياً ويتحقق من أن الداشبورد يعرض الزر والبطاقة لجميع الأدوار.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeSandbox(role) {
  const elements = new Map();

  function makeEl(id) {
    return {
      id,
      _html: '',
      get innerHTML() { return this._html; },
      set innerHTML(v) { this._html = v; },
      textContent: '',
      value: '',
      style: {},
      classList: { add() {}, remove() {}, contains() { return false; } },
      addEventListener() {},
      appendChild() {},
      remove() {},
      setAttribute() {},
      getAttribute() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      closest() { return null; },
      insertAdjacentHTML() {},
      disabled: false,
    };
  }

  const appEl = makeEl('app');

  const store = {
    session: JSON.stringify({
      access_token: 'stub-token',
      role,
      email: role + '@example.org',
      name: 'مستخدم ' + role,
    }),
    // علامة "الخطوة الثانية" المطلوبة قبل فتح لوحة التحكم
    step2_ok: JSON.stringify({ uid: 'u-1', at: Date.now() }),
  };

  // عميل Supabase مُزيَّف: جلسة صالحة بنفس معرف step2_ok
  const supabaseClient = {
    auth: {
      getSession: async () => ({
        data: {
          session: {
            access_token: 'stub-token',
            user: {
              id: 'u-1',
              email: role + '@example.org',
              user_metadata: { role, warehouse_name: 'مخزن الاختبار', warehouse_id: 'wh-1' },
            },
          },
        },
        error: null,
      }),
      onAuthStateChange: () => ({ data: null, error: null }),
      signOut: async () => ({ error: null }),
    },
    rpc: async () => ({ data: null, error: null }),
    from: () => {
      const chain = { select: () => chain, order: () => chain, limit: () => chain, eq: () => chain, insert: () => chain, update: () => chain, upsert: () => chain };
      return chain;
    },
  };

  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams, TextEncoder, TextDecoder,
    Date, JSON, Math, Promise, Array, Object, String, Number, Boolean, RegExp, Error, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    crypto: { subtle: { digest: async () => new ArrayBuffer(32) } },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    history: { pushState() {}, replaceState() {} },
    location: { pathname: '/dashboard', search: '', hostname: 'erp.example.org' },
    addEventListener() {},
    fetch: async (url) => {
      // /api/auth/me يعيد بيانات الدور الحالية
      if (String(url).includes('/api/auth/me')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'u-1', email: store.session ? JSON.parse(store.session).email : '', name: 'مستخدم ' + role, role, warehouse_id: null }),
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
    },
    document: {
      getElementById: (id) => {
        if (id === 'app') return appEl;
        if (!elements.has(id)) elements.set(id, makeEl(id));
        return elements.get(id);
      },
      createElement: (tag) => makeEl(tag),
      querySelector() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {},
      body: makeEl('body'),
      head: makeEl('head'),
    },
    scrollTo() {},
    alert() {},
    confirm: () => true,
    SUPABASE_CONFIG: { url: 'https://test.supabase.co', anonKey: 'anon-test' },
    supabase: { createClient: () => supabaseClient },
  };
  // window هو الـ sandbox نفسه (كما في المتصفح) حتى تعمل window.location و window.document
  sandbox.window = sandbox;
  sandbox.window.document = sandbox.document;
  // pushState يحدّث pathname فعلياً وإلا يعود render() إلى المسار نفسه في حلقة مفرغة
  sandbox.history.pushState = (state, title, url) => {
    if (url) sandbox.location.pathname = String(url);
  };
  sandbox.history.replaceState = sandbox.history.pushState;
  sandbox.globalThis = sandbox;
  return { sandbox, appEl };
}

// انتظار dinamico: يقرأ innerHTML كل فترة قصيرة حتى يظهر العنصر المطلوب،
// بدلاً من انتظار ثابت (60ms) كان يفشل على الأجهزة البطيئة.
function waitForHtml(appEl, marker, timeout = 2000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const poll = () => {
      const html = appEl.innerHTML || '';
      if (html.includes(marker) || Date.now() - start > timeout) return resolve(html);
      setTimeout(poll, 25);
    };
    poll();
  });
}

function loadApp(sandbox) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'public/app.js' });
}

async function runForRole(role) {
  const { sandbox, appEl } = makeSandbox(role);
  loadApp(sandbox);
  // boot مؤجَّل داخل app.js ثم render() غير المتزامن — انتظر حتى تظهر الشاشة
  return waitForHtml(appEl, 'sales-cta');
}

describe('Sales button/section visibility', () => {
  const roles = ['super-admin', 'manager', 'employee', 'viewer'];

  for (const role of roles) {
    test(`dashboard for "${role}" shows the main Sales button, nav item and card`, async () => {
      const html = await runForRole(role);
      expect(html).toContain('app-nav');

      // زر المبيعات الرئيسي في الهيرو
      expect(html).toContain('btn sales-cta');
      expect(html).toContain('data-link href="/sales"');

      // عنصر المبيعات في شريط التنقل (مميز)
      expect(html).toMatch(/href="\/sales"[^>]*class="nav-link accent/);
      expect(html).toContain('🛍️ المبيعات');

      // بطاقة قسم المبيعات المميزة
      expect(html).toContain('card link-card sales-featured');
      expect(html).toContain('فتح قسم المبيعات');
    });
  }

  test('sales landing page renders its four sub-sections', async () => {
    const { sandbox, appEl } = makeSandbox('manager');
    sandbox.location.pathname = '/sales';
    loadApp(sandbox);
    const html = await waitForHtml(appEl, '/sales/quotes');
    expect(html).toContain('/sales/quotes');
    expect(html).toContain('/sales/invoices');
    expect(html).toContain('/sales/returns');
    expect(html).toContain('/sales/payments');
  });
});
