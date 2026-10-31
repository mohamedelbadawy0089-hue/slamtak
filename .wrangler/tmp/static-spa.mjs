// معاينة محلية لملفات public/ فقط (بلا تغيير في المشروع — ملف مؤقت خارج git).
// يعيد index.html لأي مسار غير ملف، كما يفعل start.js/wrangler (SPA fallback).
// السبب: start.js يحتاج SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY (سرّ خادم غير متوفر هنا)،
// بينما الواجهة تتحدث إلى Supabase مباشرة من المتصفح بمفتاح anon العام.
import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { join, normalize, extname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../public'));
const PORT = Number(process.env.PORT || 3002);
const HOST = '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const send = async (res, file, status = 200) => {
  const body = await readFile(file);
  res.writeHead(status, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache' });
  res.end(body);
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (rel === '/' || rel === '\\') rel = '/index.html';
    let file = join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

    let ok = false;
    try { ok = (await stat(file)).isFile(); } catch (_) { ok = false; }
    if (!ok) { await send(res, join(ROOT, 'index.html')); return; }   // SPA fallback
    await send(res, file);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal server error');
  }
}).listen(PORT, HOST, () => console.log(`static-spa preview on http://${HOST}:${PORT} (root: ${ROOT})`));
