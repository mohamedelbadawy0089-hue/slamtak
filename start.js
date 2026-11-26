"use strict";
const { createServer } = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEVTOOLS_DIR = path.join(__dirname, 'devtools');

// devtools/ يقع خارج public/ فلا يُنشر مع الموقع؛ يخدمه خادم التطوير وحده
// حتى يبقى تحميل أداة الفحص (?debug=true) ممكنًا محليًا دون كشفها للزوار.
function resolveFilePath(url) {
  const clean = decodeURIComponent(String(url).split('?')[0]);
  if (clean === '/devtools' || clean.startsWith('/devtools/')) {
    return path.join(DEVTOOLS_DIR, clean.slice('/devtools'.length) || '/');
  }
  return path.join(PUBLIC_DIR, clean === '/' ? 'index.html' : clean);
}

const server = createServer((req, res) => {
  let filePath = resolveFilePath(req.url);
  
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

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});