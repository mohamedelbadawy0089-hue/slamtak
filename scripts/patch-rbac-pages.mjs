// يجعل public/rbac-pages.js مستقلًا عن app.js في الترميز (esc) ليعمل في الاختبارات.
import { readFileSync, writeFileSync } from 'fs';

const file = 'public/rbac-pages.js';
let code = readFileSync(file, 'utf8');

if (!code.includes('function rbacEsc(')) {
  const header = `// --------------------------- ترميز آمن محلي ---------------------------
// مستقل عن app.js حتى تعمل المساعدات النقية في الاختبارات وفي أي ترتيب تحميل.
const rbacEscMap = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function rbacEsc(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/[&<>"']/g, (ch) => rbacEscMap[ch]);
}

`;
  const anchor = '// --------------------------- مساعدات نقية (قابلة للاختبار) ---------------------------';
  code = code.replace(anchor, header + anchor);
}

// استبدال esc( بـ rbacEsc( داخل هذا الملف فقط
code = code.replace(/(?<!rbac)\besc\(/g, 'rbacEsc(');

// تطبيع صلاحيات الدور الممنوحة قبل المقارنة (read ≡ view)
const before = `function rbacRoleHas(perms, perm) {
  const wanted = rbacNormalizePerm(perm);
  const list = (perms || []).map((p) => String(p));
  if (list.indexOf(wanted) !== -1) return true;
  if (list.indexOf(String(perm)) !== -1) return true;
  const mod = wanted.slice(0, wanted.lastIndexOf("."));
  return list.indexOf(mod + ".manage") !== -1;
}`;

const after = `function rbacRoleHas(perms, perm) {
  const wanted = rbacNormalizePerm(perm);
  const list = (perms || []).map((p) => String(p)).map((p) => rbacNormalizePerm(p));
  if (list.indexOf(wanted) !== -1) return true;
  const mod = wanted.slice(0, wanted.lastIndexOf("."));
  if (mod && list.indexOf(mod + ".manage") !== -1) return true;
  return false;
}`;

if (!code.includes(before)) {
  console.error('rbacRoleHas block not found');
  process.exit(1);
}
code = code.replace(before, after);

writeFileSync(file, code);
console.log('rbac-pages.js patched');
