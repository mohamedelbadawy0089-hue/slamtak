"use strict";
const { createServer } = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEVTOOLS_DIR = path.join(__dirname, 'devtools');

// يعيد المسار الحقيقي بعد فكّ الروابط الرمزية، أو null إن كان المسار غير موجود.
function realPath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch (e) {
    return null;
  }
}

// يربط مسار الطلب بجذر مسموح واحد ثم يتحقق أن الناتج داخل ذلك الجذر فعلًا،
// فـ«..» المشفّرة أو لا تُخرج القراءة أبدًا من public/ أو devtools/ (مثل .dev.vars).
// الفحص النصّي وحده لا يكفي: رابط رمزي داخل الجذر قد يشير إلى خارجه، لذا يُعاد
// فكّ الرابط بـrealpathSync ويُقارن المسار الحقيقي بالجذر الحقيقي.
function containedPath(rootDir, requestPath) {
  const withSlash = requestPath.startsWith('/') ? requestPath : '/' + requestPath;
  const target = path.resolve(rootDir, '.' + withSlash);
  if (target !== rootDir && !target.startsWith(rootDir + path.sep)) return null;

  const root = realPath(rootDir);
  if (!root) return null;
  const real = realPath(target);
  if (!real) return null; // غير موجود أو رابط مكسور
  if (real !== root && !real.startsWith(root + path.sep)) return null;
  return real;
}

// devtools/ يقع خارج public/ فلا يُنشر مع الموقع؛ يخدمه خادم التطوير وحده
// حتى يبقى تحميل أداة الفحص (?debug=true) ممكنًا محليًا دون كشفها للزوار.
function resolveFilePath(url) {
  let clean;
  try {
    clean = decodeURIComponent(String(url).split('?')[0]);
  } catch (e) {
    return null; // ترميز % غير صالح
  }
  if (clean === '/devtools' || clean.startsWith('/devtools/')) {
    return containedPath(DEVTOOLS_DIR, clean.slice('/devtools'.length) || '/');
  }
  return containedPath(PUBLIC_DIR, clean === '/' ? 'index.html' : clean);
}

function createStaticServer() {
  return createServer((req, res) => {
    const filePath = resolveFilePath(req.url);
    if (!filePath) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
      } else {
        res.writeHead(200);
        res.end(data);
      }
    });
  });
}

module.exports = { containedPath, resolveFilePath, createStaticServer, PUBLIC_DIR, DEVTOOLS_DIR };

// لا يستمع إلا عند تشغيله مباشرة، حتى تستطيع الاختبارات استيراد الحارس بلا خادم.
if (require.main === module) {
  createStaticServer().listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}
