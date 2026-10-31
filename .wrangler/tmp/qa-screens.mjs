// اختبار الشاشات بجلسة دخول حقيقية: يسجّل دخولاً بكلمة المرور (نفس مسار signInWithPassword)
// ثم ينفّذ استعلامات app.js الفعلية والدوال RPC تحت دور authenticated، ويصنّف الأخطاء.
import { readFileSync } from 'fs';

const cfg = readFileSync('public/supabase-config.js', 'utf8');
const URL = (cfg.match(/url:\s*"([^"]+)"/) || [])[1];
const ANON = (cfg.match(/anonKey:\s*"([^"]+)"/) || [])[1];
const EMAIL = readFileSync('.wrangler/tmp/qa-email.txt', 'utf8').trim();
const PASS = readFileSync('.wrangler/tmp/qa-pass.txt', 'utf8').trim();
const app = readFileSync('public/app.js', 'utf8');

const H = (extra = {}) => ({ apikey: ANON, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 Chrome/131.0', ...extra });

// 1) دخول فعلي (مسار signInWithPassword)
const login = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: H(),
  body: JSON.stringify({ email: EMAIL, password: PASS }),
});
const lj = await login.json().catch(() => ({}));
console.log(`الدخول: HTTP ${login.status} ${login.ok ? '✅' : '❌ ' + JSON.stringify(lj).slice(0, 120)}`);
if (!login.ok) process.exit(1);
const TOK = lj.access_token;
console.log(`  الدور في الرمز: ${JSON.parse(Buffer.from(TOK.split('.')[1], 'base64').toString()).role}`);

// 2) استعلام app.js المركّبة لكل جدول (مع embeds)
const seen = new Map();
const re = /\.from\(\s*["']([a-z_0-9]+)["']\s*\)\s*\.select\(\s*["']([^"']{1,300})["']/g;
let m;
while ((m = re.exec(app))) if (!seen.has(m[1])) seen.set(m[1], m[2]);

const cls = (st, body) => {
  if (st === 200) return ['✅', '200'];
  const pg = (body.match(/PGRST\d+/) || [])[0];
  if (st === 401 || st === 403) return ['⚠️ ', ` ${st} رفض صلاحيات/RLS`];
  if (pg) return ['❌', ` ${st} ${pg} ${(body.match(/"message":"([^"]{0,70})/) || [])[1] || ''}`];
  return ['❌', ` ${st} ${(body || '').slice(0, 90)}`];
};

const results = [];
for (const [t, sel] of seen) {
  const qs = new URLSearchParams({ select: sel.trim(), limit: '1' });
  const r = await fetch(`${URL}/rest/v1/${t}?${qs}`, { headers: H({ Authorization: `Bearer ${TOK}` }) });
  const body = await r.text();
  results.push([`جدول ${t}`, ...cls(r.status, body)]);
}

// 3) دوال RPC التي تستدعيها الواجهة
const rpcs = [...new Set([...app.matchAll(/\.rpc\(\s*["']([a-z_0-9]+)["']/g)].map(x => x[1]))];
for (const fn of rpcs) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: H({ Authorization: `Bearer ${TOK}` }), body: '{}',
  });
  const body = await r.text();
  // PGRST202 = ناقص وسيطات (سلوك متوقّع وليس عيب مخطط)، 401/403 = حجب
  let out;
  if (r.status === 200 || r.status === 204) out = ['✅', '200 نُفّذت'];
  else if (/PGRST202/.test(body)) out = ['✅', '200? ناقص وسيطات (طبيعي)'];
  else if (r.status === 401 || r.status === 403) out = ['⚠️ ', ` ${r.status} رفض`];
  else out = ['❌', ` ${r.status} ${((body.match(/"message":"([^"]{0,70})/) || [])[1] || body.slice(0, 70))}`];
  results.push([`RPC ${fn}`, ...out]);
}

const w = Math.max(...results.map(r => r[0].length));
let bad = 0, warn = 0;
for (const [n, mark, det] of results) {
  if (mark.includes('❌')) bad++;
  if (mark.includes('⚠️')) warn++;
  console.log(`  ${mark} ${n.padEnd(w)}  ${det}`);
}
console.log(`\nالإجمالي: ${results.length} فحصاً — ناجح ${results.length - bad - warn} | رفض صلاحيات ${warn} | فشل مخطط ${bad}`);
process.exit(bad ? 1 : 0);
