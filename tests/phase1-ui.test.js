/**
 * المرحلة 1 — اختبارات واجهة الاستلام والمخزون
 *
 * 1) فحص ساكن: تسجيل المسار والحماية وكل استدعاءات RPC في الواجهة.
 * 2) فحص تنفيذي: تشغيل app.js داخل بيئة محاكاة (vm) والتنقل إلى
 *    /receiving و /inventory والتحقق من تركيب الشاشة الناتجة وبياناتها.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');
const migrationSrc = fs.readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '202610250001_phase1_receiving_inventory.sql'),
  'utf8'
);

const RPC_CALLS = [
  'wms_po_list',
  'wms_gr_list',
  'wms_gr_create',
  'wms_gr_post',
  'wms_gr_cancel',
  'wms_stock_list',
  'wms_product_list',
  'wms_product_create',
  'wms_movements_list',
];

describe('المرحلة 1 — ربط الواجهة (فحص ساكن)', () => {
  test('المسار مسجل ومحمي ببوابة المصادقة', () => {
    expect(appSrc).toContain('"/receiving": "/receiving"');
    expect(appSrc).toMatch(/const MODULE_ROUTES = \["\/inventory", "\/receiving",/);
  });

  test.each(RPC_CALLS)('الواجهة تستدعي RPC: %s', (fn) => {
    expect(appSrc).toContain(`wmsRpc(client, "${fn}"`);
    expect(migrationSrc).toContain(`public.${fn}(`);
    expect(migrationSrc).toMatch(new RegExp(`'${fn}\\([^']*'`));
  });

  test('لا توجد كتابة مباشرة للمنتجات بأعمدة غير موجودة (المسار القديم المعطّل)', () => {
    expect(appSrc).not.toContain('current_stock');
    expect(appSrc).not.toMatch(/from\("products"\)\s*\.insert/);
  });

  test('الواجهة تتحقق من البنود قبل الحفظ (تشغيلة/صلاحية/كمية)', () => {
    expect(appSrc).toContain('data-rcv-batch');
    expect(appSrc).toContain('data-rcv-expiry');
    expect(appSrc).toContain('data-rcv-qty');
    expect(appSrc).toContain('الكمية يجب أن تكون أكبر من صفر');
    expect(appSrc).toContain('كمية تتجاوز المتبقي في أمر الشراء');
  });

  test('شاشة المخزون تعرض كل حالات المخزون وتستخدم FEFO', () => {
    expect(appSrc).toContain('wms_stock_list');
    expect(appSrc).toContain('stockBadge(r.stock_status)');
    expect(appSrc).toContain('staging_quantity');
    expect(appSrc).toContain('quarantine_quantity');
    expect(migrationSrc).toMatch(/order by inv\.expiry_date/);
  });

  test('index.html يحمّل RTL ويحدّث رقم النسخة لتجاوز الكاش', () => {
    expect(htmlSrc).toContain('dir="rtl"');
    const m = htmlSrc.match(/app\.js\?v=(\d+)/);
    expect(m).toBeTruthy();
    expect(Number(m[1])).toBeGreaterThan(202610240300);
  });

  test('الأنماط تدعم الشاشات الصغيرة (جدول متجاوب بتسميات خلايا)', () => {
    expect(cssSrc).toContain('.wms-badge-ok');
    expect(cssSrc).toContain('@media (max-width: 640px)');
    expect(cssSrc).toContain('content: attr(data-label)');
  });
});

// ---------------------------------------------------------------------------
// محاكاة متصفح خفيفة لتشغيل app.js فعلياً والتنقل بين الشاشات
// ---------------------------------------------------------------------------
const CANNED = {
  wms_po_list: [
    {
      id: 'po-1',
      order_number: 'PO-1001',
      order_date: '2026-10-20',
      status: 'approved',
      supplier_name: 'مورد النور',
      total_amount: 1050,
      items: [
        { product_id: 'p-1', product_name: 'باراسيتامول 500 مجم', quantity: 100, received_quantity: 0, remaining: 100, unit_price: 10.5 },
      ],
    },
  ],
  wms_gr_list: [
    {
      id: 'gr-1',
      receipt_number: 'GR-TWA-0000001',
      receipt_date: '2026-10-25',
      status: 'draft',
      purchase_order_number: 'PO-1001',
      supplier_name: 'مورد النور',
      created_at: '2026-10-25T10:00:00Z',
      items: [{ product_id: 'p-1', product_name: 'باراسيتامول 500 مجم', batch_number: 'B100', expiry_date: '2028-01-01', quantity_received: 40, quantity_damaged: 0, unit_cost: 10.5 }],
    },
  ],
  wms_stock_list: {
    total: 1,
    rows: [
      {
        id: 'inv-1', product_id: 'p-1', product_name: 'باراسيتامول 500 مجم', barcode: '6221000000001',
        unit_of_measure: 'box', batch_number: 'B100', expiry_date: '2028-01-01',
        quantity: 40, available_quantity: 40, reserved_quantity: 0, staging_quantity: 0,
        quarantine_quantity: 0, damaged_quantity: 0, expired_quantity: 0,
        unit_cost: 10.5, location: null, is_quarantined: false, stock_status: 'available',
      },
    ],
  },
  wms_product_list: [
    { id: 'p-1', name: 'Paracetamol', name_ar: 'باراسيتامول 500 مجم', barcode: '6221000000001', unit_of_measure: 'box', shelf_life_months: 24, min_stock_level: 10, max_stock_level: 1000 },
  ],
  wms_movements_list: [
    { id: 'm-1', created_at: '2026-10-25T10:05:00Z', movement_type: 'receipt', movement_subtype: 'purchase', quantity: 40, cost_price: 10.5, batch_number: 'B100', expiry_date: '2028-01-01', reference_type: 'goods_receipt', reference_id: 'gr-1', reference_number: 'GR-TWA-0000001', product_name: 'باراسيتامول 500 مجم', notes: '' },
  ],
};

function makeElement(id, registry) {
  const el = {
    id,
    style: {},
    value: '',
    textContent: '',
    innerHTML: '',
    handlers: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, on) { if (on === undefined) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); } else if (on) this._set.add(c); else this._set.delete(c); },
    },
    addEventListener(type, fn) { this.handlers[type] = fn; },
    focus() {},
    trigger(type, event) { if (this.handlers[type]) return this.handlers[type](event || { key: '', target: { value: '' } }); },
    getAttribute() { return null; },
    setAttribute() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    reset() {},
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html || ''; },
    set(html) {
      el._html = String(html);
      const re = /id="([^"]+)"/g;
      let m;
      while ((m = re.exec(el._html))) if (!registry.has(m[1])) registry.set(m[1], makeElement(m[1], registry));
    },
  });
  return el;
}

function makeSandbox(pathname) {
  const elements = new Map();
  const registry = elements;
  const appEl = makeElement('app', registry);
  elements.set('app', appEl);

  const tabEls = ['stock', 'products', 'movements'].map((t) => {
    const el = makeElement('tab-' + t, registry);
    el.getAttribute = (name) => (name === 'data-tab' ? t : null);
    return el;
  });

  const client = {
    auth: {
      getSession: async () => ({
        data: {
          session: {
            access_token: 'token',
            user: { id: 'u-1', email: 'w@test.local', user_metadata: { role: 'manager', warehouse_name: 'مخزن الاختبار' } },
          },
        },
        error: null,
      }),
      onAuthStateChange: () => ({ data: null, error: null }),
      signOut: async () => ({ error: null }),
    },
    rpc: async (name) => ({ data: CANNED[name] !== undefined ? CANNED[name] : null, error: null }),
    from: () => {
      const chain = { select: () => chain, order: () => chain, limit: () => chain, eq: () => chain, insert: () => chain, update: () => chain, upsert: () => chain };
      return { ...chain };
    },
  };

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Date,
    JSON,
    Math,
    Number,
    String,
    Promise,
    FormData: function FormData() { return { get: () => '' }; },
    confirm: () => true,
    alert: () => {},
    fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    localStorage: {
      _s: { step2_ok: JSON.stringify({ uid: 'u-1', at: Date.now() }) },
      getItem(k) { return this._s[k] || null; },
      setItem(k, v) { this._s[k] = String(v); },
      removeItem(k) { delete this._s[k]; },
      clear() { this._s = {}; },
    },
    location: { pathname, search: '', href: 'http://test.local' + pathname, hostname: 'test.local' },
    history: { pushState() {} },
    document: {
      getElementById: (id) => {
        if (id === 'app') return appEl;
        if (!registry.has(id)) registry.set(id, makeElement(id, registry));
        return registry.get(id);
      },
      createElement: (tag) => makeElement(tag, registry),
      querySelector: () => null,
      querySelectorAll: (sel) => (sel === '.wms-tab' ? tabEls : []),
      addEventListener: () => {},
      body: makeElement('body', registry),
      head: makeElement('head', registry),
    },
    SUPABASE_CONFIG: { url: 'https://test.supabase.co', anonKey: 'anon-test' },
    supabase: { createClient: () => client },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = () => {};
  sandbox.window.scrollTo = () => {};
  return { sandbox, appEl, elements, tabEls };
}

async function renderRoute(pathname) {
  const { sandbox, appEl, elements, tabEls } = makeSandbox(pathname);
  vm.createContext(sandbox);
  vm.runInContext(appSrc, sandbox, { filename: 'public/app.js' });
  await new Promise((r) => setTimeout(r, 150)); // انتظار boot + render
  const get = (id) => (elements.get(id) ? elements.get(id).innerHTML : '');
  return {
    sectionHtml: get('section-body'),
    appHtml: appEl.innerHTML,
    poList: get('rcv-po-list'),
    grList: get('rcv-gr-list'),
    stockResult: get('stock-result'),
    productList: get('product-list'),
    movList: get('mov-list'),
    panel: get('inv-panel'),
    elements,
    tabEls,
  };
}

describe('المرحلة 1 — تنفيذ الواجهة داخل متصفح محاكى', () => {
  test('شاشة الاستلام تعرض أوامر الشراء ومستندات الاستلام', async () => {
    const { appHtml, poList, grList } = await renderRoute('/receiving');
    expect(appHtml).toContain('الاستلام');
    expect(poList).toContain('PO-1001');
    expect(poList).toContain('مورد النور');
    expect(poList).toContain('📥 استلام');
    expect(grList).toContain('GR-TWA-0000001');
    expect(grList).toContain('✔ ترحيل');
    expect(grList).toContain('مسودة');
  });

  test('شاشة المخزون تعرض الرصيد بترتيب FEFO وحالات المخزون', async () => {
    const { stockResult } = await renderRoute('/inventory');
    expect(stockResult).toContain('FEFO');
    expect(stockResult).toContain('باراسيتامول 500 مجم');
    expect(stockResult).toContain('B100');
    expect(stockResult).toContain('2028-01-01');
    expect(stockResult).toContain('متاح');
  });

  test('تبويب الأصناف يعرض قائمة الأصناف ونموذج الإضافة', async () => {
    const { elements, tabEls } = await renderRoute('/inventory');
    const productsTab = tabEls.find((t) => t.getAttribute('data-tab') === 'products');
    productsTab.trigger('click');
    await new Promise((r) => setTimeout(r, 80));
    const read = (id) => (elements.get(id) ? elements.get(id).innerHTML : '');
    expect(read('inv-panel')).toContain('إضافة صنف');
    expect(read('product-list')).toContain('باراسيتامول 500 مجم');
    expect(read('product-list')).toContain('6221000000001');
  });

  test('تبويب الحركات يعرض سجل الحركة مربوطاً برقمه', async () => {
    const { elements, tabEls } = await renderRoute('/inventory');
    const movTab = tabEls.find((t) => t.getAttribute('data-tab') === 'movements');
    movTab.trigger('click');
    await new Promise((r) => setTimeout(r, 80));
    const read = (id) => (elements.get(id) ? elements.get(id).innerHTML : '');
    expect(read('mov-list')).toContain('GR-TWA-0000001');
    expect(read('mov-list')).toContain('استلام');
    expect(read('mov-list')).toContain('B100');
  });
});
