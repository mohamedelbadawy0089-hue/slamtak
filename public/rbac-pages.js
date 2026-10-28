// =====================================================================================
// rbac-pages.js — شاشات نظام الصلاحيات المؤسسي (تُحمَّل قبل app.js)
//   /team/roles : إدارة الأدوار + مصفوفة الصلاحيات + مراجعة التغييرات قبل الحفظ
//   /team/audit : سجل المراجعة
//   مساعدات مشتركة لصفحة الفريق (الصلاحيات الفعلية ومصدرها)
// كل العمليات الحقيقية تمر عبر دوال قاعدة البيانات (RPC) التي تفرض الصلاحيات على الخادم.
// =====================================================================================

// --------------------------- ترميز آمن محلي ---------------------------
// مستقل عن app.js حتى تعمل المساعدات النقية في الاختبارات وفي أي ترتيب تحميل.
const rbacEscMap = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function rbacEsc(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/[&<>"']/g, (ch) => rbacEscMap[ch]);
}

// --------------------------- مساعدات نقية (قابلة للاختبار) ---------------------------

// تطبيع اسم الصلاحية: read→view، write/adjust→update، transfer→create
function rbacNormalizePerm(perm) {
  if (!perm) return "";
  const p = String(perm).trim();
  const dot = p.indexOf(".");
  if (dot < 0) return p;
  const mod = p.slice(0, dot);
  const act = p.slice(dot + 1);
  const map = { read: "view", write: "update", adjust: "update", transfer: "create" };
  return mod + "." + (map[act] || act);
}

// هل يحقق الدور الصلاحية المطلوبة؟ (manage تشمل كل عمليات الوحدة)
function rbacRoleHas(perms, perm) {
  const wanted = rbacNormalizePerm(perm);
  const list = (perms || []).map((p) => String(p)).map((p) => rbacNormalizePerm(p));
  if (list.indexOf(wanted) !== -1) return true;
  const mod = wanted.slice(0, wanted.lastIndexOf("."));
  if (mod && list.indexOf(mod + ".manage") !== -1) return true;
  return false;
}

// فرق الصلاحيات بين الحالة الأصلية والجديدة (لمراجعة التغييرات قبل الحفظ)
function rbacDiffPermissions(before, after) {
  const b = {};
  const a = {};
  (before || []).forEach((p) => { b[rbacNormalizePerm(p)] = true; });
  (after || []).forEach((p) => { a[rbacNormalizePerm(p)] = true; });
  const added = Object.keys(a).filter((k) => !b[k]).sort();
  const removed = Object.keys(b).filter((k) => !a[k]).sort();
  return { added, removed, changed: added.length + removed.length > 0 };
}

// تجميع الكتالوج (من الخادم) حسب الوحدة مع الحفاظ على الترتيب
function rbacGroupCatalog(catalog) {
  const groups = [];
  const index = {};
  (catalog || []).forEach((g) => {
    if (!g || !g.module) return;
    const key = g.module;
    if (!index[key]) {
      index[key] = { module: key, module_ar: g.module_ar || g.module, actions: [] };
      groups.push(index[key]);
    }
    (g.actions || []).forEach((a) => index[key].actions.push(a));
  });
  return groups;
}

// كل أسماء الصلاحيات في الكتالوج
function rbacAllPermissions(groups) {
  const out = [];
  (groups || []).forEach((g) => (g.actions || []).forEach((a) => out.push(a.name)));
  return out;
}

// ----------------------------- حالة الصفحة -----------------------------------------
const rbacState = {
  roles: [],
  catalog: [],
  editingId: null,
  selected: {},
  baseline: {},
  flash: "",
  error: "",
  search: "",
  panel: "",      // "" | "matrix" | "review"
  busy: false,
};

function rbacRoleById(id) {
  return (rbacState.roles || []).find((r) => r.id === id) || null;
}

function rbacSelectedArray() {
  return Object.keys(rbacState.selected).filter((k) => rbacState.selected[k]).sort();
}

function rbacMatrixHtml(groups, selected, disabled, attr) {
  const attrName = attr || "data-rbac-perm";
  return groups.map((g) => {
    const allOn = g.actions.every((a) => selected[a.name]);
    const anyOn = g.actions.some((a) => selected[a.name]);
    const stateCls = allOn ? "on" : (anyOn ? "partial" : "off");
    return `
    <section class="rbac-module" data-module="${rbacEsc(g.module)}">
      <header class="rbac-module-head">
        <label class="rbac-module-title">
          <input type="checkbox" data-rbac-module="${rbacEsc(g.module)}"${allOn ? " checked" : ""}${disabled ? " disabled" : ""} />
          <strong>${rbacEsc(g.module_ar)}</strong>
          <span class="rbac-count" data-state="${stateCls}">${g.actions.filter((a) => selected[a.name]).length}/${g.actions.length}</span>
        </label>
      </header>
      <div class="rbac-actions">
        ${g.actions.map((a) => `
          <label class="rbac-action${selected[a.name] ? " checked" : ""}">
            <input type="checkbox" ${attrName}="${rbacEsc(a.name)}"${selected[a.name] ? " checked" : ""}${disabled ? " disabled" : ""} />
            <span>${rbacEsc(a.label || a.action)}</span>
          </label>`).join("")}
      </div>
    </section>`;
  }).join("");
}

function rbacSelectedFromDom(root) {
  const perms = {};
  if (!root || typeof root.querySelectorAll !== "function") return perms;
  let nodes = [];
  try { nodes = root.querySelectorAll("[data-rbac-perm]") || []; } catch (_) { nodes = []; }
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].checked) perms[nodes[i].getAttribute("data-rbac-perm")] = true;
  }
  return perms;
}

function rbacApplyModuleToggle(root, moduleName, checked) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  const boxes = root.querySelectorAll('[data-rbac-perm]') || [];
  for (let i = 0; i < boxes.length; i++) {
    const name = boxes[i].getAttribute("data-rbac-perm") || "";
    if (name.indexOf(moduleName + ".") === 0) boxes[i].checked = !!checked;
  }
}

// ------------------------------ شاشة الأدوار ---------------------------------------
async function loadRolesSection(body, client) {
  const ctx = await assertWarehouseScope(client);
  const warehouseId = (ctx && ctx.warehouse_id) || "";
  if (!warehouseId) {
    body.innerHTML = sectionErrorHtml("حسابك غير مرتبط بمخزن، ولا يمكن إدارة الأدوار بدون مخزن.");
    return;
  }

  const canEdit = can("roles.update") || can("roles.create") || can("users.manage") || !!(__permCtx && __permCtx.full);

  if (!rbacState.catalog.length) {
    try {
      const res = await client.rpc("rbac_catalog");
      if (res && res.error) throw res.error;
      rbacState.catalog = Array.isArray(res && res.data) ? res.data : [];
    } catch (_) { rbacState.catalog = []; }
  }

  try {
    const res = await client.rpc("rbac_roles_list");
    if (res && res.error) throw res.error;
    rbacState.roles = Array.isArray(res && res.data) ? res.data : [];
  } catch (e) {
    body.innerHTML = sectionErrorHtml("تعذر تحميل الأدوار: " + ((e && e.message) || e));
    return;
  }

  const groups = rbacGroupCatalog(rbacState.catalog);
  const editing = rbacState.editingId ? rbacRoleById(rbacState.editingId) : null;

  const rows = rbacState.roles.filter((r) => {
    if (!rbacState.search) return true;
    const q = rbacState.search.toLowerCase();
    return String(r.name).toLowerCase().indexOf(q) !== -1 || String(r.name_ar || "").indexOf(rbacState.search) !== -1;
  }).map((r) => {
    const permsCount = (r.permissions || []).length;
    const isEditing = rbacState.editingId === r.id;
    return `
      <tr class="${isEditing ? "rbac-row-editing" : ""}">
        <td>${rbacEsc(r.name_ar || r.name)}${r.is_system ? ' <span class="rbac-badge">نظامي</span>' : ""}</td>
        <td dir="ltr" style="font-family:monospace;font-size:0.8rem;">${rbacEsc(r.name)}</td>
        <td>${permsCount}</td>
        <td>${r.members || 0}</td>
        <td style="white-space:nowrap;">
          <button class="btn secondary" type="button" data-rbac-edit="${rbacEsc(r.id)}">تعديل</button>
          <button class="btn secondary" type="button" data-rbac-copy="${rbacEsc(r.id)}">نسخ</button>
          <button class="btn secondary" type="button" data-rbac-delete="${rbacEsc(r.id)}" style="color:#b91c1c;">حذف</button>
        </td>
      </tr>`;
  }).join("");

  body.innerHTML = `
    ${rbacState.flash ? `<div class="card rbac-flash">${rbacEsc(rbacState.flash)}</div>` : ""}
    ${rbacState.error ? `<div class="card rbac-error">${rbacEsc(rbacState.error)}</div>` : ""}

    <div class="card" style="margin-bottom:1rem;">
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;justify-content:space-between;">
        <h3 style="margin:0;">🎭 الأدوار والصلاحيات</h3>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          <input class="input" id="rbac-search" type="search" placeholder="بحث عن دور…" value="${rbacEsc(rbacState.search)}" style="min-width:180px;" />
          <button class="btn" type="button" id="rbac-new" style="background:#2563eb;color:#fff;"${canEdit ? "" : " disabled"}>➕ دور جديد</button>
          <a class="btn secondary" data-link href="/team">👥 الموظفون</a>
          <a class="btn secondary" data-link href="/team/audit">🧾 سجل المراجعة</a>
        </div>
      </div>
      <p class="muted" style="font-size:0.85rem;margin:0.5rem 0 0;">
        أدوار النظام محمية من الحذف وإعادة التسمية. لا يمكنك منح صلاحية لا تملكها، ولا تعديل دور يمنح صلاحيات أعلى من صلاحياتك.
      </p>
    </div>

    <div class="card" style="overflow-x:auto;margin-bottom:1rem;">
      <table class="rbac-table">
        <thead><tr><th>الدور</th><th>المعرّف</th><th>عدد الصلاحيات</th><th>الموظفون</th><th>إجراءات</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="muted" style="padding:1rem;">لا توجد أدوار مطابقة.</td></tr>`}</tbody>
      </table>
    </div>

    <div id="rbac-editor">${editing || rbacState.editingId === "new" ? rbacEditorHtml(groups, editing, canEdit) : ""}</div>`;

  const searchEl = document.getElementById("rbac-search");
  if (searchEl) {
    searchEl.addEventListener("input", () => {
      rbacState.search = searchEl.value;
      rbacState.flash = "";
      loadRolesSection(body, client);
    });
  }

  const newBtn = document.getElementById("rbac-new");
  if (newBtn) newBtn.addEventListener("click", () => rbacStartNew());

  if (typeof body.querySelectorAll !== "function") return;

  body.querySelectorAll("[data-rbac-edit]").forEach((btn) => {
    btn.addEventListener("click", () => rbacStartEdit(btn.getAttribute("data-rbac-edit"), body, client));
  });
  body.querySelectorAll("[data-rbac-copy]").forEach((btn) => {
    btn.addEventListener("click", () => rbacCopyRole(btn.getAttribute("data-rbac-copy"), body, client));
  });
  body.querySelectorAll("[data-rbac-delete]").forEach((btn) => {
    btn.addEventListener("click", () => rbacDeleteRole(btn.getAttribute("data-rbac-delete"), body, client));
  });

  rbacBindEditor(body, client, groups, editing);
}

function rbacEditorHtml(groups, editing, canEdit) {
  const isNew = !editing;
  const selected = rbacState.selected || {};
  const all = rbacAllPermissions(groups);
  const selectedArr = rbacSelectedArray();
  const diff = rbacDiffPermissions(Object.keys(rbacState.baseline || {}), selectedArr);
  const name = editing ? editing.name : "";
  const nameAr = editing ? (editing.name_ar || "") : "";
  const desc = editing ? (editing.description || "") : "";
  const systemLocked = !!(editing && editing.is_system);
  const labelOf = {};
  groups.forEach((g) => (g.actions || []).forEach((a) => { labelOf[a.name] = (g.module_ar || g.module) + " — " + (a.label || a.action); }));

  return `
    <form class="card" id="rbac-form">
      <h3 style="margin-top:0;">${isNew ? "➕ دور جديد" : "✏️ تعديل الدور: " + rbacEsc(editing.name_ar || editing.name)}</h3>
      ${systemLocked ? `<p class="rbac-warn">هذا دور نظامي: يمكن تعديل صلاحياته بواسطة مالك المخزن فقط، ولا يمكن تغيير اسمه أو حذفه.</p>` : ""}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0.75rem;">
        <div>
          <label>الاسم (إنجليزي) *</label>
          <input class="input" id="rbac-name" type="text" dir="ltr" value="${rbacEsc(name)}" placeholder="Sales Rep"
                 ${systemLocked ? "readonly" : ""}${canEdit ? "" : " disabled"} />
        </div>
        <div>
          <label>الاسم المعروض (عربي)</label>
          <input class="input" id="rbac-name-ar" type="text" value="${rbacEsc(nameAr)}" placeholder="مندوب مبيعات"${canEdit ? "" : " disabled"} />
        </div>
        <div>
          <label>الوصف</label>
          <input class="input" id="rbac-desc" type="text" value="${rbacEsc(desc)}" placeholder="وصف مختصر"${canEdit ? "" : " disabled"} />
        </div>
      </div>

      <div class="rbac-toolbar">
        <button class="btn secondary" type="button" id="rbac-all">تحديد الكل (${all.length})</button>
        <button class="btn secondary" type="button" id="rbac-none">إلغاء التحديد</button>
        <span class="rbac-summary" id="rbac-summary">${selectedArr.length} صلاحية محددة${diff.changed ? " — " + diff.added.length + " إضافة / " + diff.removed.length + " سحب" : ""}</span>
      </div>

      <p class="muted" style="margin:0.25rem 0 0.5rem;font-size:0.8rem;">تُعرض هنا الصلاحيات المطبقة فعليًا على الخادم فقط.</p>

      <div class="rbac-matrix">${rbacMatrixHtml(groups, selected, !canEdit)}</div>

      <div id="rbac-review"></div>

      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.75rem;">
        <button class="btn" id="rbac-review-btn" type="button" style="background:#0f766e;color:#fff;"${canEdit ? "" : " disabled"}>🔍 مراجعة التغييرات</button>
        <button class="btn" id="rbac-save" type="submit" style="background:#16a34a;color:#fff;"${canEdit ? "" : " disabled"}>💾 حفظ</button>
        <button class="btn secondary" id="rbac-cancel" type="button">إلغاء</button>
      </div>
      <p id="rbac-form-error" class="rbac-error-line"></p>
    </form>`;
}

function rbacSyncSelection(body) {
  rbacState.selected = rbacSelectedFromDom(body);
  const summary = document.getElementById("rbac-summary");
  if (summary) {
    const diff = rbacDiffPermissions(Object.keys(rbacState.baseline || {}), rbacSelectedArray());
    summary.textContent = rbacSelectedArray().length + " صلاحية محددة" +
      (diff.changed ? " — " + diff.added.length + " إضافة / " + diff.removed.length + " سحب" : "");
  }
}

function rbacBindEditor(body, client, groups, editing) {
  const form = document.getElementById("rbac-form");
  if (!form) return;

  if (typeof body.querySelectorAll === "function") {
    body.querySelectorAll("[data-rbac-perm]").forEach((cb) => {
      cb.addEventListener("change", () => rbacSyncSelection(body));
    });
    body.querySelectorAll("[data-rbac-module]").forEach((cb) => {
      cb.addEventListener("change", () => {
        rbacApplyModuleToggle(body, cb.getAttribute("data-rbac-module"), cb.checked);
        rbacSyncSelection(body);
      });
    });
  }

  const allBtn = document.getElementById("rbac-all");
  if (allBtn) allBtn.addEventListener("click", () => {
    const all = rbacAllPermissions(groups);
    const sel = {};
    all.forEach((n) => { sel[n] = true; });
    rbacState.selected = sel;
    rbacState.panel = "";
    rbacState.editingId = editing ? editing.id : "new";
    loadRolesSection(body, client);
  });

  const noneBtn = document.getElementById("rbac-none");
  if (noneBtn) noneBtn.addEventListener("click", () => {
    rbacState.selected = {};
    rbacState.panel = "";
    rbacState.editingId = editing ? editing.id : "new";
    loadRolesSection(body, client);
  });

  const reviewBtn = document.getElementById("rbac-review-btn");
  if (reviewBtn) reviewBtn.addEventListener("click", () => {
    rbacSyncSelection(body);
    rbacRenderReview(groups);
  });

  const cancelBtn = document.getElementById("rbac-cancel");
  if (cancelBtn) cancelBtn.addEventListener("click", () => {
    rbacState.editingId = null;
    rbacState.selected = {};
    rbacState.baseline = {};
    rbacState.panel = "";
    loadRolesSection(body, client);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    rbacSyncSelection(body);
    const errEl = document.getElementById("rbac-form-error");
    const setErr = (m) => { if (errEl) errEl.textContent = m; };

    const nameEl = document.getElementById("rbac-name");
    const nameArEl = document.getElementById("rbac-name-ar");
    const descEl = document.getElementById("rbac-desc");
    const name = (nameEl ? nameEl.value : "").trim();
    const nameAr = (nameArEl ? nameArEl.value : "").trim();
    const desc = (descEl ? descEl.value : "").trim();

    if (!name) return setErr("اسم الدور مطلوب");
    if (!/^[A-Za-z][A-Za-z0-9 ._-]{1,40}$/.test(name)) {
      return setErr("اسم الدور: يبدأ بحرف إنجليزي ويحتوي حروفًا/أرقامًا/ . _ - فقط (2-41 حرفًا)");
    }

    const ctx = await assertWarehouseScope(client);
    const warehouseId = (ctx && ctx.warehouse_id) || "";
    if (!warehouseId) return setErr("لا يوجد مخزن مرتبط بالحساب");

    const saveBtn = document.getElementById("rbac-save");
    if (saveBtn) saveBtn.disabled = true;

    // الكتالوج يعرض الصلاحيات المطبقة فقط؛ نحتفظ بأي صلاحية قديمة غير معروضة
    // حتى لا يؤدي الحفظ إلى سحبها بصمت من الدور.
    const displayed = {};
    (groups || []).forEach((g) => (g.actions || []).forEach((a) => { displayed[a.name] = true; }));
    const hiddenKept = (editing && Array.isArray(editing.permissions) ? editing.permissions : [])
      .filter((p) => p && !displayed[p]);
    const payloadPerms = Array.from(new Set(rbacSelectedArray().concat(hiddenKept))).sort();

    const res = await client.rpc("rbac_role_upsert", {
      p_role_id: editing ? editing.id : null,
      p_name: name,
      p_name_ar: nameAr || name,
      p_description: desc,
      p_permissions: payloadPerms,
      p_warehouse: warehouseId,
    });

    if (saveBtn) saveBtn.disabled = false;

    if (res && res.error) { setErr(res.error.message || "تعذر حفظ الدور"); return; }

    rbacState.flash = "تم حفظ الدور «" + (nameAr || name) + "» بصلاحياته.";
    rbacState.error = "";
    rbacState.editingId = null;
    rbacState.selected = {};
    rbacState.baseline = {};
    loadRolesSection(body, client);
  });
}

function rbacRenderReview(groups) {
  const box = document.getElementById("rbac-review");
  if (!box) return;
  const diff = rbacDiffPermissions(Object.keys(rbacState.baseline || {}), rbacSelectedArray());
  const labelOf = {};
  groups.forEach((g) => (g.actions || []).forEach((a) => { labelOf[a.name] = (g.module_ar || g.module) + " — " + (a.label || a.action); }));

  if (!diff.changed) {
    box.innerHTML = `<div class="rbac-review-box"><p class="muted" style="margin:0;">لا توجد تغييرات مقارنة بالصلاحيات الحالية.</p></div>`;
    return;
  }

  box.innerHTML = `
    <div class="rbac-review-box">
      <p style="margin:0 0 0.4rem;font-weight:600;">مراجعة التغييرات قبل الحفظ (${diff.added.length} إضافة / ${diff.removed.length} سحب)</p>
      ${diff.added.length ? `<div style="margin-bottom:0.4rem;"><strong>ستُمنح:</strong> ${diff.added.map((p) => `<span class="rbac-chip add">${rbacEsc(labelOf[p] || p)}</span>`).join(" ")}</div>` : ""}
      ${diff.removed.length ? `<div><strong>ستُسحب:</strong> ${diff.removed.map((p) => `<span class="rbac-chip remove">${rbacEsc(labelOf[p] || p)}</span>`).join(" ")}</div>` : ""}
    </div>`;
}

function rbacStartNew() {
  rbacState.editingId = "new";
  rbacState.selected = {};
  rbacState.baseline = {};
  rbacState.flash = "";
  rbacState.error = "";
  const body = document.getElementById("section-body");
  if (body) loadRolesSection(body, getSupabase());
}

function rbacStartEdit(roleId, body, client) {
  const role = rbacRoleById(roleId);
  if (!role) return;
  rbacState.editingId = role.id;
  const sel = {};
  (role.permissions || []).forEach((p) => { sel[rbacNormalizePerm(p)] = true; });
  rbacState.selected = sel;
  rbacState.baseline = Object.assign({}, sel);
  rbacState.flash = "";
  rbacState.error = "";
  loadRolesSection(body, client);
}

function rbacCopyRole(roleId, body, client) {
  const role = rbacRoleById(roleId);
  if (!role) return;
  const base = role.name + " Copy";
  const name = prompt("اسم الدور الجديد (إنجليزي):", base);
  if (!name) return;
  const nameAr = prompt("الاسم المعروض (عربي):", (role.name_ar || role.name) + " (نسخة)") || name;
  (async () => {
    const ctx = await assertWarehouseScope(client);
    const res = await client.rpc("rbac_role_duplicate", {
      p_role_id: roleId, p_name: name, p_name_ar: nameAr, p_warehouse: (ctx && ctx.warehouse_id) || "",
    });
    rbacState.flash = (res && res.error) ? "" : "تم نسخ الدور إلى «" + nameAr + "».";
    rbacState.error = (res && res.error) ? ("تعذر النسخ: " + res.error.message) : "";
    loadRolesSection(body, client);
  })();
}

function rbacDeleteRole(roleId, body, client) {
  const role = rbacRoleById(roleId);
  if (!role) return;
  if (!confirm("حذف الدور «" + (role.name_ar || role.name) + "»؟ لا يمكن حذف دور مرتبط بموظفين.")) return;
  (async () => {
    const ctx = await assertWarehouseScope(client);
    const res = await client.rpc("rbac_role_delete", {
      p_role_id: roleId, p_warehouse: (ctx && ctx.warehouse_id) || "",
    });
    rbacState.flash = (res && res.error) ? "" : "تم حذف الدور «" + (role.name_ar || role.name) + "».";
    rbacState.error = (res && res.error) ? ("تعذر الحذف: " + res.error.message) : "";
    if (rbacState.editingId === roleId) rbacState.editingId = null;
    loadRolesSection(body, client);
  })();
}

// ------------------------------ سجل المراجعة ----------------------------------------
const auditState = { rows: [], action: "", flash: "", error: "", loaded: false };

async function loadAuditSection(body, client) {
  const ctx = await assertWarehouseScope(client);
  const warehouseId = (ctx && ctx.warehouse_id) || "";
  if (!warehouseId) {
    body.innerHTML = sectionErrorHtml("حسابك غير مرتبط بمخزن، ولا يمكن عرض سجل المراجعة بدون مخزن.");
    return;
  }

  try {
    const res = await client.rpc("rbac_audit_list", {
      p_warehouse: warehouseId, p_action: auditState.action || null, p_limit: 200, p_offset: 0,
    });
    if (res && res.error) throw res.error;
    auditState.rows = Array.isArray(res && res.data) ? res.data : [];
    auditState.error = "";
    auditState.loaded = true;
  } catch (e) {
    body.innerHTML = sectionErrorHtml("تعذر تحميل سجل المراجعة: " + ((e && e.message) || e));
    return;
  }

  const actionLabels = {
    rbac_role_create: "إنشاء دور", rbac_role_update: "تعديل دور", rbac_role_delete: "حذف دور",
    rbac_member_set: "تعديل عضوية/صلاحيات", rbac_member_deactivate: "إيقاف حساب",
    employee_create: "إنشاء موظف", team_member_upsert: "تعديل عضو", team_member_remove: "إزالة عضو",
  };

  const rows = auditState.rows.map((r) => {
    const nv = r.new_values || {};
    let detail = "";
    if (nv.permissions) detail = "الصلاحيات: " + (Array.isArray(nv.permissions) ? nv.permissions.length : "—");
    else if (nv.username) detail = "اسم المستخدم: " + nv.username;
    else if (nv.roles) detail = "الأدوار: " + (Array.isArray(nv.roles) ? nv.roles.length : "—");
    else if (nv.name) detail = "الدور: " + nv.name;
    return `
      <tr>
        <td style="white-space:nowrap;">${rbacEsc(String(r.created_at || "").slice(0, 19).replace("T", " "))}</td>
        <td>${rbacEsc(actionLabels[r.action] || r.action)}</td>
        <td>${rbacEsc(r.actor_name || "—")}</td>
        <td>${rbacEsc(r.entity_type || "—")}</td>
        <td>${rbacEsc(detail)}</td>
      </tr>`;
  }).join("");

  body.innerHTML = `
    <div class="card" style="margin-bottom:1rem;">
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;justify-content:space-between;">
        <h3 style="margin:0;">🧾 سجل المراجعة</h3>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          <select class="input" id="audit-action">
            <option value="">كل العمليات</option>
            ${Object.keys(actionLabels).map((k) => `<option value="${k}"${auditState.action === k ? " selected" : ""}>${rbacEsc(actionLabels[k])}</option>`).join("")}
          </select>
          <a class="btn secondary" data-link href="/team">👥 الموظفون</a>
          <a class="btn secondary" data-link href="/team/roles">🎭 الأدوار</a>
        </div>
      </div>
      <p class="muted" style="font-size:0.85rem;margin:0.5rem 0 0;">السجل محمي من التعديل والحذف في قاعدة البيانات — يُقرأ فقط بصلاحية مراجعة داخل مخزنك.</p>
    </div>
    <div class="card" style="overflow-x:auto;">
      ${auditState.rows.length ? `
      <table class="rbac-table">
        <thead><tr><th>الوقت</th><th>العملية</th><th>المستخدم</th><th>الكيان</th><th>تفاصيل</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : `<p class="muted" style="padding:1rem;">لا توجد عمليات مسجلة بعد.</p>`}
    </div>`;

  const sel = document.getElementById("audit-action");
  if (sel) sel.addEventListener("change", () => {
    auditState.action = sel.value;
    loadAuditSection(body, client);
  });
}

// ------------------- إجراءات الفريق: عرض الصلاحيات الفعلية وإيقاف/تفعيل ---------------
async function rbacShowEffective(userId) {
  const client = getSupabase();
  const panel = document.getElementById("team-effective-panel");
  if (!client || !panel) return;
  panel.innerHTML = `<div class="card"><p class="muted">⏳ جارٍ حساب الصلاحيات الفعلية…</p></div>`;
  const ctx = await assertWarehouseScope(client);
  const html = await rbacMemberPanelHtml(client, (ctx && ctx.warehouse_id) || "", userId);
  panel.innerHTML = `<div class="card"><h3 style="margin-top:0;">🔐 الصلاحيات الفعلية ومصدرها</h3>${html}</div>`;
  if (panel.scrollIntoView) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function rbacToggleMember(userId, active) {
  const client = getSupabase();
  const body = document.getElementById("section-body");
  if (!client || !body) return;
  const label = active ? "تفعيل" : "إيقاف";
  if (!confirm(label + " حساب هذا الموظف؟ الإيقاف يمنع الدخول ويسحب كل صلاحياته في هذا المخزن.")) return;
  const ctx = await assertWarehouseScope(client);
  const res = await client.rpc("rbac_member_set_active", {
    p_warehouse: (ctx && ctx.warehouse_id) || "",
    p_user_id: userId,
    p_active: !!active,
  });
  teamState.flash = (res && res.error)
    ? ("تعذر " + label + ": " + res.error.message)
    : ("تم " + label + " الحساب في هذا المخزن.");
  loadTeamSection(body, client);
}

// ------------------- لوحة الصلاحيات الفعلية لعضو (مع المصدر) -----------------------
async function rbacMemberPanelHtml(client, warehouseId, userId) {
  try {
    const res = await client.rpc("rbac_member_get", { p_warehouse: warehouseId, p_user_id: userId });
    if (res && res.error) throw res.error;
    const data = res && res.data ? res.data : {};
    const eff = Array.isArray(data.effective) ? data.effective : [];
    const sourceLabel = (s) => (s === "direct" ? "منح مباشر" : s === "owner" ? "مالك المخزن" : String(s || "").replace("role:", "دور: "));
    if (!eff.length) return `<p class="muted">لا توجد صلاحيات فعلية لهذا العضو.</p>`;
    return `
      <div class="rbac-effective">
        <p style="margin:0 0 0.5rem;"><strong>${eff.length}</strong> صلاحية فعلية</p>
        <table class="rbac-table" style="font-size:0.85rem;">
          <thead><tr><th>الصلاحية</th><th>المصدر</th></tr></thead>
          <tbody>${eff.map((e) => `<tr><td dir="ltr" style="font-family:monospace;">${rbacEsc(e.permission)}</td><td>${rbacEsc(sourceLabel(e.source))}</td></tr>`).join("")}</tbody>
        </table>
      </div>`;
  } catch (e) {
    return `<p class="rbac-error-line">تعذر تحميل الصلاحيات: ${rbacEsc((e && e.message) || e)}</p>`;
  }
}
