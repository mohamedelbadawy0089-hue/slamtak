// يطبّق تعديلات RBAC على public/app.js بشكل حتمي (كل استبدال يجب أن يطابق مرة واحدة).
import { readFileSync, writeFileSync } from 'fs';

const file = 'public/app.js';
let code = readFileSync(file, 'utf8');
const edits = [];

const add = (find, replace) => edits.push({ find, replace });

// 1) مسارات جديدة
add(
`  "/team": "/team",
  "/team/new": "/team/new",
  "/hr": "/hr",`,
`  "/team": "/team",
  "/team/new": "/team/new",
  "/team/roles": "/team/roles",
  "/team/audit": "/team/audit",
  "/hr": "/hr",`
);

// 2) تسجيلها كمسارات محمية
add(
`"/pricing", "/pricing/price-lists", "/pricing/promotions", "/pricing/discounts", "/pricing/segments", "/pricing/approvals", "/pricing/reports", "/team", "/team/new"];`,
`"/pricing", "/pricing/price-lists", "/pricing/promotions", "/pricing/discounts", "/pricing/segments", "/pricing/approvals", "/pricing/reports", "/team", "/team/new", "/team/roles", "/team/audit"];`
);

// 3) عناوين الصفحات
add(
`    "/team": "إدارة الموظفين والصلاحيات",
    "/team/new": "إضافة موظف باسم مستخدم"
  };`,
`    "/team": "إدارة الموظفين والصلاحيات",
    "/team/new": "إضافة موظف باسم مستخدم",
    "/team/roles": "الأدوار وصلاحيات النظام",
    "/team/audit": "سجل المراجعة"
  };`
);

// 4) توجيه القسم إلى الصفحات الجديدة
add(
`    if (routePath === "/team") {
      await loadTeamSection(body, client);
      return;
    }`,
`    if (routePath === "/team") {
      await loadTeamSection(body, client);
      return;
    }

    if (routePath === "/team/roles") {
      await loadRolesSection(body, client);
      return;
    }

    if (routePath === "/team/audit") {
      await loadAuditSection(body, client);
      return;
    }`
);

// 5) صلاحيات المسارات الجديدة
add(
`  { prefix: "/team", perm: "users.read" },
  { prefix: "/team/new", perm: "users.update" }
];`,
`  { prefix: "/team", perm: "users.read" },
  { prefix: "/team/new", perm: "users.update" },
  { prefix: "/team/roles", perm: "roles.view" },
  { prefix: "/team/audit", perm: "audit.view" }
];`
);

// 6) can(): المرادفات + manage تشمل كل العمليات
add(
`function can(perm) {
  if (!perm) return true;
  const ctx = __permCtx;
  if (!ctx || !ctx.loaded) return true;
  if (ctx.full) return true;
  if (ctx.degraded) return true;
  const flags = ctx.permissions || {};
  if (flags[perm] === true) return true;
  const dot = perm.lastIndexOf(".");
  if (dot > 0) {
    const mod = perm.slice(0, dot);
    const act = perm.slice(dot + 1);
    if ((act === "read" || act === "view") && flags[mod + ".manage"] === true) return true;
  }
  return false;
}`,
`// مرادفات الصلاحيات: read≡view، write/adjust≡update، transfer≡create
const PERM_ALIAS_ACTIONS = { read: "view", write: "update", adjust: "update", transfer: "create" };

function permAliases(perm) {
  const p = String(perm || "");
  const dot = p.lastIndexOf(".");
  if (dot < 0) return [p];
  const mod = p.slice(0, dot);
  const act = p.slice(dot + 1);
  const out = [p];
  const alt = PERM_ALIAS_ACTIONS[act];
  if (alt) out.push(mod + "." + alt);
  if (act === "view") out.push(mod + ".read");
  if (act === "update") out.push(mod + ".write", mod + ".adjust");
  if (act === "create") out.push(mod + ".transfer");
  return out;
}

function can(perm) {
  if (!perm) return true;
  const ctx = __permCtx;
  if (!ctx || !ctx.loaded) return true;
  if (ctx.full) return true;
  if (ctx.degraded) return true;
  const flags = ctx.permissions || {};
  const candidates = permAliases(perm);
  for (let i = 0; i < candidates.length; i++) {
    if (flags[candidates[i]] === true) return true;
  }
  const dot = String(perm).lastIndexOf(".");
  // manage يشمل كل عمليات الوحدة (عرض/إضافة/تعديل/حذف/اعتماد…)
  if (dot > 0 && flags[String(perm).slice(0, dot) + ".manage"] === true) return true;
  return false;
}`
);

// 7) دمج سياق الخادم (أدوار متعددة + مصادر) في سياق الواجهة
add(
`  ctx.role = roleName;
  ctx.full = FULL_ACCESS_ROLES.indexOf(String(roleName).toLowerCase().trim()) !== -1;
  ctx.loaded = rows.length > 0;`,
`  // 3) سياق الخادم: أدوار متعددة + ملكية المخزن (إن توفرت الدالة)
  try {
    const mc = await client.rpc("rbac_my_context");
    if (mc && !mc.error && mc.data && mc.data.authenticated) {
      const perms = mc.data.permissions || {};
      Object.keys(perms).forEach((k) => { ctx.permissions[k] = true; });
      if (mc.data.is_owner) ctx.owner = true;
      if (mc.data.warehouse_id) ctx.warehouse_id = mc.data.warehouse_id;
      if (mc.data.role) roleName = mc.data.role;
      const roles = Array.isArray(mc.data.roles) ? mc.data.roles : [];
      if (roles.length) ctx.roleNames = roles.map((r) => r.name);
    }
  } catch (_) { /* القراءة المباشرة أعلاه كافية */ }

  ctx.role = roleName;
  ctx.full = FULL_ACCESS_ROLES.indexOf(String(roleName).toLowerCase().trim()) !== -1 || ctx.owner === true;
  ctx.loaded = rows.length > 0 || (!!ctx.role && Object.keys(ctx.permissions || {}).length > 0);`
);

// 8) روابط لوحة التحكم
add(
`          <a href="/team" data-link class="nav-link" data-perm="users.read">👥 الموظفون والصلاحيات</a>`,
`          <a href="/team" data-link class="nav-link" data-perm="users.read">👥 الموظفون والصلاحيات</a>
          <a href="/team/roles" data-link class="nav-link" data-perm="roles.view">🎭 الأدوار والصلاحيات</a>
          <a href="/team/audit" data-link class="nav-link" data-perm="audit.view">🧾 سجل المراجعة</a>`
);

// 9) حالة صفحة الفريق: بحث
add(
`let teamState = { members: [], roles: [], catalog: [], editingId: null, flash: "" };`,
`let teamState = { members: [], roles: [], catalog: [], editingId: null, flash: "", search: "", filterRole: "" };`
);

// 10) صفوف الفريق: الحالة + الصلاحيات الفعلية + إيقاف/تفعيل
add(
`  const rows = members.map((m) => {
    const extra = Object.keys(teamFlags(m.permissions)).length;
    const isSelf = !!(__permCtx && __permCtx.user_id === m.user_id);
    const actions = (canEdit && !isSelf)
      ? \`<button class="btn" type="button" data-team-edit="\${esc(m.user_id)}">تعديل</button>
         <button class="btn" type="button" data-team-remove="\${esc(m.user_id)}" style="background:#dc2626;color:#fff;">إزالة</button>\`
      : \`<span class="muted">—</span>\`;
    return \`
      <tr style="border-bottom:1px solid #eee;">
        <td style="padding:0.5rem;">\${esc(m.full_name || "—")}</td>
        <td style="padding:0.5rem;">\${esc(m.email || "—")}</td>
        <td style="padding:0.5rem;">\${esc(m.role_name || "بدون دور")}</td>
        <td style="padding:0.5rem;">\${extra}</td>
        <td style="padding:0.5rem;white-space:nowrap;">\${actions}</td>
      </tr>\`;
  }).join("");`,
`  const q = String(teamState.search || "").toLowerCase();
  const roleFilter = String(teamState.filterRole || "");
  const visible = members.filter((m) => {
    if (roleFilter && String(m.role_name || "") !== roleFilter) return false;
    if (!q) return true;
    const hay = [m.full_name, m.username, m.email, m.role_name].map((x) => String(x || "").toLowerCase()).join(" ");
    return hay.indexOf(q) !== -1;
  });

  const rows = visible.map((m) => {
    const extra = Object.keys(teamFlags(m.permissions)).length;
    const isSelf = !!(__permCtx && __permCtx.user_id === m.user_id);
    const active = m.is_active !== false;
    const login = m.username ? ("@" + m.username) : (m.email || "—");
    const effectiveBtn = \`<button class="btn secondary" type="button" onclick="rbacShowEffective('\${esc(m.user_id)}')">🔐 الصلاحيات</button>\`;
    const actions = (canEdit && !isSelf)
      ? \`<button class="btn" type="button" data-team-edit="\${esc(m.user_id)}">تعديل</button>
         \${effectiveBtn}
         <button class="btn secondary" type="button" onclick="rbacToggleMember('\${esc(m.user_id)}', \${active ? "false" : "true"})" style="color:\${active ? "#b91c1c" : "#065f46"};">\${active ? "إيقاف" : "تفعيل"}</button>
         <button class="btn" type="button" data-team-remove="\${esc(m.user_id)}" style="background:#dc2626;color:#fff;">إزالة</button>\`
      : effectiveBtn;
    return \`
      <tr style="border-bottom:1px solid #eee;\${active ? "" : "opacity:0.6;"}">
        <td style="padding:0.5rem;">\${esc(m.full_name || "—")}</td>
        <td style="padding:0.5rem;" dir="ltr">\${esc(login)}</td>
        <td style="padding:0.5rem;">\${esc(m.role_name || "بدون دور")}</td>
        <td style="padding:0.5rem;">\${extra}</td>
        <td style="padding:0.5rem;white-space:nowrap;">\${active ? "✅ نشط" : "⛔ موقوف"}</td>
        <td style="padding:0.5rem;white-space:nowrap;">\${actions}</td>
      </tr>\`;
  }).join("");`
);

// 11) رأس الجدول: عمود الحالة
add(
`            <th style="padding:0.5rem;">صلاحيات إضافية</th>
            <th style="padding:0.5rem;">إجراءات</th>`,
`            <th style="padding:0.5rem;">صلاحيات إضافية</th>
            <th style="padding:0.5rem;">الحالة</th>
            <th style="padding:0.5rem;">إجراءات</th>`
);

// 12) أدوات الصفحة: بحث + تصفية + روابط الأدوار والسجل
add(
`      <div style="margin-bottom:0.5rem;"><a class="btn" data-link href="/team/new" style="background:#2563eb;color:#fff;">➕ إضافة موظف باسم مستخدم وكلمة مرور</a></div>`,
`      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem;">
        <a class="btn" data-link href="/team/new" style="background:#2563eb;color:#fff;">➕ إضافة موظف باسم مستخدم وكلمة مرور</a>
        <a class="btn secondary" data-link href="/team/roles">🎭 الأدوار والصلاحيات</a>
        <a class="btn secondary" data-link href="/team/audit">🧾 سجل المراجعة</a>
      </div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem;">
        <input class="input" id="team-search" type="search" placeholder="بحث بالاسم أو اسم المستخدم أو الدور…" value="\${esc(teamState.search || "")}" style="min-width:220px;" />
        <select class="input" id="team-role-filter">
          <option value="">كل الأدوار</option>
          \${roles.map((r) => \`<option value="\${esc(r.name)}"\${teamState.filterRole === r.name ? " selected" : ""}>\${esc(r.name_ar || r.name)}</option>\`).join("")}
        </select>
      </div>`
);

// 13) عرض عدد الفريق بعد التصفية + لوحة الصلاحيات الفعلية
add(
`      <h3 style="margin-top:0;">👥 فريق المخزن (\${members.length})</h3>`,
`      <h3 style="margin-top:0;">👥 فريق المخزن (\${visible.length}\${visible.length !== members.length ? " من " + members.length : ""})</h3>`
);

add(
`        </table>\` : sectionEmptyHtml("لا يوجد موظفون مرتبطون بهذا المخزن بعد.")}
    </div>\`;`,
`        </table>\` : sectionEmptyHtml("لا يوجد موظفون مطابقون لهذا البحث.")}
    </div>
    <div id="team-effective-panel" style="margin-top:1rem;"></div>\`;`
);

// 14) مستمعات البحث والتصفية داخل صفحة الفريق
add(
`  const saveBtn = document.getElementById("team-save");
  if (saveBtn) saveBtn.addEventListener("click", () => saveTeamMember(client, warehouseId, editing, body));`,
`  const saveBtn = document.getElementById("team-save");
  if (saveBtn) saveBtn.addEventListener("click", () => saveTeamMember(client, warehouseId, editing, body));

  const searchInput = document.getElementById("team-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      teamState.search = searchInput.value;
      clearTimeout(teamState._searchTimer);
      teamState._searchTimer = setTimeout(() => loadTeamSection(body, client), 250);
    });
  }

  const roleFilterEl = document.getElementById("team-role-filter");
  if (roleFilterEl) {
    roleFilterEl.addEventListener("change", () => {
      teamState.filterRole = roleFilterEl.value;
      loadTeamSection(body, client);
    });
  }`
);

let changed = 0;
for (const { find, replace } of edits) {
  const first = code.indexOf(find);
  if (first === -1) {
    console.error('NOT FOUND:\n' + find.slice(0, 120));
    process.exit(1);
  }
  if (code.indexOf(find, first + 1) !== -1) {
    console.error('NOT UNIQUE:\n' + find.slice(0, 120));
    process.exit(1);
  }
  code = code.slice(0, first) + replace + code.slice(first + find.length);
  changed++;
}

writeFileSync(file, code);
console.log('applied ' + changed + ' edits to ' + file);
