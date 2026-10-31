// بوابة قاعدة البيانات لاختبارات QA — اتصال مباشر بـPostgreSQL بدلاً من
// واجهة إدارة Supabase (التي تتطلب رمز JWT للمشاريع التي لا تتوفر أسرارها هنا).
// يقرأ SUPABASE_DB_PASSWORD من البيئة أو ملف .env.local، ولا يطبع السر أبداً.
//
// تُنفَّذ النص على دفعات (كل عبارة SQL على حدة) لأن node-postgres لا يعيد
// سوى نتيجة العبارة الأخيرة عند إرسال نص متعدد العبارات دفعة واحدة، بينما
// واجهة الإدارة كانت تعيد نتائج جميع العبارات. الشطر ترتيباً محفوظ، والمعاملات
// (begin/commit/rollback) تعمل على الاتصال نفسه إنّ حالها دائماً.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pg = require('pg');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || '';
if (!DB_PASSWORD) {
  try {
    for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) {
      const i = line.indexOf('=');
      if (i > 0 && line.slice(0, i).trim() === 'SUPABASE_DB_PASSWORD') {
        let v = line.slice(i + 1).trim();
        if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
        if (v) { DB_PASSWORD = v; break; }
      }
    }
  } catch { /* .env.local غير موجودة */ }
}

if (!DB_PASSWORD) throw new Error('SUPABASE_DB_PASSWORD غير متوفر — أضفه إلى .env.local');

// تقسيم نص SQL إلى عبارات مع مراعاة: علامات التنصيص، الوسوم دولار-الاقتباس $tag$...$tag$، التعليقات
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let mode = 'normal'; // normal | single | double | line | block
  let dollarTag = null;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (mode === 'single') {
      current += ch;
      if (ch === "'") {
        if (next === "'") { current += sql[++i]; } // '' تنصيص مهرب
        else mode = 'normal';
      }
      continue;
    }
    if (mode === 'double') {
      current += ch;
      if (ch === '"' && next !== '"') mode = 'normal';
      else if (ch === '"') current += sql[++i];
      continue;
    }
    if (mode === 'line') {
      current += ch;
      if (ch === '\n') mode = 'normal';
      continue;
    }
    if (mode === 'block') {
      current += ch;
      if (ch === '*' && next === '/') { current += sql[++i]; mode = 'normal'; }
      continue;
    }
    // normal
    if (ch === "'") { mode = 'single'; current += ch; continue; }
    if (ch === '"') { mode = 'double'; current += ch; continue; }
    if (ch === '-' && next === '-') { mode = 'line'; current += ch; continue; }
    if (ch === '/' && next === '*') { mode = 'block'; current += ch; continue; }
    if (ch === '$') {
      // اكتشاف وسم دولار-الاقتباس $tag$ أو $$ أو $n$
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
      const k = j + 1;
      if (j < sql.length && sql[j] === '$') {
        const tag = sql.slice(i, j + 1); // يشمل كلا علامتي $
        // وسم $1$ (وسم موضعي) لا يُستخدم للاقتباس، وسوم مثل $n تُتصرف كعادي
        const isPositional = /^\$\d+\$$/.test(tag);
        if (!isPositional) {
          dollarTag = tag;
          current += tag;
          // نسخ حتى وسم الإغلاق
          const closeIdx = sql.indexOf(dollarTag, j + 1);
          if (closeIdx !== -1) {
            current += sql.slice(j + 1, closeIdx + dollarTag.length);
            i = closeIdx + dollarTag.length - 1;
            dollarTag = null;
            continue;
          }
          dollarTag = null; // وسم غير مفتوح — نص عادي
          continue;
        }
      }
      current += ch;
      continue;
    }
    if (ch === ';') {
      statements.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current);
  return statements.map((s) => s.trim()).filter(Boolean);
}

export async function run(query) {
  const client = new pg.Client({
    host: 'db.iksjhjxwphmvthryfeae.supabase.co',
    port: 5432,
    user: 'postgres',
    password: DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const notices = [];
  const noticeListener = (m) => notices.push(m && (m.message || m.W) || '');
  client.on('notice', noticeListener);
  try {
    const rows = [];
    const stmts = splitStatements(query);
    for (const stmt of stmts) {
      if (!stmt) continue;
      const res = await client.query(stmt);
      if (res.rows && res.rows.length) rows.push(...res.rows);
    }
    const noticeRows = notices.filter(Boolean).map((n) => ({ notice: n }));
    const data = rows.length ? rows : noticeRows.length ? noticeRows : [];
    return { ok: true, status: 200, data };
  } catch (err) {
    return { ok: false, status: 500, data: err.message };
  } finally {
    client.off('notice', noticeListener);
    try { await client.end(); } catch { /* تجاهل */ }
  }
}
