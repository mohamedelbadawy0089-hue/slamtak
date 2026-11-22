// فحص صحة Supabase من الطرفية — قراءة فقط ولا يطبع أي مفتاح.
//
// كل الطلبات GET/OPTIONS: لا كتابة، ولا استدعاء أي RPC (قد يكون لها أثر جانبي).
// الغرض: التمييز بين ثلاثة أعطال تبدو متشابهة في المتصفح:
//   1) المشروع متوقف/مُعلَّق  → المصادقة وPostgREST يسقطان معًا
//   2) PostgREST يعطي 503 PGRST002 والمصادقة تعمل → القاعدة حيّة والكاش لا يُبنى
//   3) المفتاح خاطئ → 401 على كل شيء
//
// التشغيل: npm run check:supabase
// الإعداد: SUPABASE_URL + SUPABASE_ANON_KEY، وإلا يُقرآن نصيًا من
//         public/supabase-config.js (المفتاح anon عام، ولا يُطبع هنا).
// رموز الخروج: 0 سليم · 1 إعداد مفقود · 2 PGRST002/انقطاع PostgREST · 3 فشل المصادقة · 4 فشل شبكة
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadConfig() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    return {
      url: process.env.SUPABASE_URL.replace(/\/+$/, ''),
      key: process.env.SUPABASE_ANON_KEY,
      source: 'env',
    };
  }
  const file = path.join(root, 'public', 'supabase-config.js');
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const pick = (name) => (text.match(new RegExp(name + "\\s*:\\s*['\"]([^'\"]+)")) || [])[1] || '';
  const url = pick('url');
  const key = pick('anonKey');
  return url && key ? { url: url.replace(/\/+$/, ''), key, source: 'public/supabase-config.js' } : null;
}

const cfg = loadConfig();
if (!cfg) {
  console.error('❌ لا إعداد: عيّن SUPABASE_URL وSUPABASE_ANON_KEY أو املأهما في public/supabase-config.js');
  process.exit(1);
}

// لا يُطبع المفتاح أبدًا، ولا حتى داخل رسالة خطأ قادمة من الخادم.
const redact = (value) =>
  String(value ?? '')
    .split(cfg.key)
    .join('<redacted-key>')
    .replace(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '<redacted-jwt>');

const ref = new URL(cfg.url).hostname.split('.')[0];

async function probe(url, method = 'GET') {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: { apikey: cfg.key, authorization: 'Bearer ' + cfg.key },
      signal: AbortSignal.timeout(10000),
    });
    const body = await res.text();
    let code = '';
    try {
      code = (JSON.parse(body) || {}).code || '';
    } catch {
      /* ليست JSON */
    }
    return { status: res.status, code, body, ms: Date.now() - started };
  } catch (e) {
    return { status: 0, code: '', body: '', error: e.name + ': ' + e.message };
  }
}

const line = (ok, label, detail) => console.log(`${ok ? '✅' : '❌'} ${label} — ${detail}`);

console.log(`🔎 فحص صحة Supabase — المشروع ${ref} (الإعداد من ${cfg.source})`);
console.log('   كل الطلبات قراءة فقط (GET/OPTIONS) والمفاتيح محجوبة في هذا الخرج.\n');

const auth = await probe(cfg.url + '/auth/v1/health');
const rest = await probe(cfg.url + '/rest/v1/warehouses?select=id&limit=1');
const gateway = await probe(cfg.url + '/rest/v1/rpc/two_step_verify', 'OPTIONS');
const storage = await probe(cfg.url + '/storage/v1/object/public/');

const authOk = auth.status === 200;
// 200/206 = يعمل · 401/403 = يعمل لكن RLS يمنع anon · 404 = الكاش سليم والجدول غائب
const restOk = [200, 206, 401, 403, 404].includes(rest.status) && rest.code !== 'PGRST002';

line(authOk, 'المصادقة (GoTrue)', auth.status ? `${auth.status} · ${auth.ms}ms` : redact(auth.error));
line(
  restOk,
  'PostgREST / schema cache',
  rest.status ? `${rest.status}${rest.code ? ' · ' + rest.code : ''} · ${rest.ms}ms` : redact(rest.error),
);
line(gateway.status === 200 || gateway.status === 204, 'بوابة PostgREST (OPTIONS)', gateway.status ? String(gateway.status) : redact(gateway.error));
line(storage.status > 0 && storage.status < 500, 'التخزين (Storage)', storage.status ? String(storage.status) : redact(storage.error));

console.log('');
if ([auth, rest, gateway, storage].some((r) => r.status === 0)) {
  console.error('❌ فشل شبكة: لا وصول إلى المشروع من هذه البيئة (تحقق من الاتصال أو من صحة المشروع).');
  process.exit(4);
}
if (!authOk) {
  console.error(
    restOk
      ? '❌ المصادقة وحدها ساقطة (PostgREST يعمل). راجع مزوّد المصادقة وإعداداته في اللوحة.'
      : '❌ المشروع على الأرجح متوقف/مُعلَّق: المصادقة وPostgREST ساقطان معًا. Restart أو Restore من لوحة Supabase.',
  );
  process.exit(3);
}
if (!restOk) {
  console.error(
    rest.code === 'PGRST002'
      ? '❌ PGRST002: المصادقة تعمل لكن PostgREST لا يبني schema cache — القاعدة حيّة والكاش معطوب، وليس التطبيق.\n   نفّذ supabase/diagnostics/read-only-checks.sql في SQL Editor ثم اتبع مخرجه.'
      : `❌ PostgREST لا يخدم القراءة (${rest.status}${rest.code ? ' · ' + rest.code : ''}).`,
  );
  process.exit(2);
}

console.log('✅ كل الخدمات تستجيب. جرّب بعدها تسجيل الدخول ثم /purchases/invoices.');
process.exit(0);
