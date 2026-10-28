// =====================================================================================
// module-pages.js — شاشات تشغيلية حقيقية للوحدات التي كانت جداولها مفقودة
//   /pricing/price-lists        قوائم الأسعار وبنودها (price_lists / price_list_items)
//   /pricing/promotions         العروض والحملات (promotions) مع الاعتماد والتفعيل
//   /hr/payroll                 مسيرات الرواتب (payroll_runs) مع الاعتماد والدفع
//   /customer-service/tickets   تذاكر خدمة العملاء (customer_service_tickets)
// كل قراءة/كتابة تمر إلى الجداول مباشرة: RLS + سياسات القراءة + مُشغّلات rbac_enforce
// تفرض الصلاحية على الخادم، والأزرار هنا تُعطّل فقط لتوضيح ما لا يملكه المستخدم.
// =====================================================================================

function mpEsc(v) {
  if (typeof esc === "function") return esc(v);
  return String(v === null || v === undefined ? "" : v).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

const MP_STATUS = {
  draft: "مسودة", pending_approval: "بانتظار الاعتماد", approved: "معتمد", rejected: "مرفوض",
  active: "نشط", paused: "موقوف", expired: "منتهي", paid: "مدفوع", cancelled: "ملغي",
  archived: "مؤرشف", open: "مفتوحة", in_progress: "قيد المعالجة", resolved: "تم الحل", closed: "مغلقة"
};
const MP_KIND = { percent: "نسبة %", amount: "مبلغ ثابت", buy_x_get_y: "اشترِ واحصل على", bundle: "حزمة أصناف" };
const MP_PRIORITY = { low: "منخفضة", normal: "عادية", high: "عالية", urgent: "عاجلة" };
const MP_APPLIES = { all: "كل الأصناف", products: "أصناف محددة", categories: "فئات محددة" };

function mpBadge(status) {
  const colors = {
    approved: "#16a34a", active: "#16a34a", paid: "#16a34a", resolved: "#16a34a",
    draft: "#64748b", closed: "#64748b", archived: "#64748b",
    pending_approval: "#f59e0b", paused: "#f59e0b",
    in_progress: "#2563eb", open: "#2563eb",
    rejected: "#dc2626", cancelled: "#dc2626", expired: "#dc2626"
  };
  const c = colors[status] || "#64748b";
  return `<span style="padding:0.15rem 0.5rem;border-radius:6px;background:${c}1a;color:${c};font-size:0.8rem;white-space:nowrap;">${mpEsc(MP_STATUS[status] || status || "—")}</span>`;
}

function mpNum(v) {
  const n = Number(v || 0);
  return n.toLocaleString("ar-EG", { maximumFractionDigits: 2 });
}

function mpDate(v) {
  if (!v) return "—";
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function mpToday() {
  return new Date().toISOString().slice(0, 10);
}

function mpNowLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

// نطاق المخزن + المؤسسة (tenant إلزامي في الجداول الأربعة)
async function mpScope(client) {
  const ctx = await assertWarehouseScope(client);
  const warehouseId = (ctx && ctx.warehouse_id) || "";
  let tenantId = (ctx && ctx.tenant_id) || "";
  if (!tenantId && warehouseId) {
    const w = await client.from("warehouses").select("tenant_id").eq("id", warehouseId).limit(1);
    if (w && !w.error && w.data && w.data[0]) tenantId = w.data[0].tenant_id || "";
  }
  return { warehouse_id: warehouseId, tenant_id: tenantId, user_id: (ctx && ctx.user_id) || "" };
}

async function mpInsert(client, table, row) {
  const res = await client.from(table).insert([row]).select().single();
  if (res && res.error) throw new Error(res.error.message);
  return res.data;
}

async function mpPatch(client, table, id, patch) {
  const res = await client.from(table).update(patch).eq("id", id).select();
  if (res && res.error) throw new Error(res.error.message);
  if (!res.data || !res.data.length) throw new Error("لم يتم تعديل أي صف — تحقق من صلاحيتك على هذا المخزن");
  return res.data[0];
}

function mpError(e) {
  return `<div class="card" style="border-right:4px solid #dc2626;"><p style="color:#b91c1c;margin:0;">⚠️ ${mpEsc((e && e.message) || e)}</p></div>`;
}

function mpField(label, inner, hint) {
  return `<div><label>${label}</label>${inner}${hint ? `<span class="muted" style="font-size:0.75rem;">${hint}</span>` : ""}</div>`;
}

function mpEmpty(msg) {
  return `<div class="card"><p class="muted" style="margin:0;text-align:center;padding:1rem;">${mpEsc(msg)}</p></div>`;
}

// رفض واضح بدل جدول فارغ مضلّل عندما لا يملك المستخدم صلاحية عرض الوحدة
function mpNoView(perm, label) {
  return `<div class="card" style="border-right:4px solid #f59e0b;">
    <p style="margin:0;">🔒 لا تملك صلاحية عرض ${mpEsc(label)}.</p>
    <p class="muted" style="margin:0.35rem 0 0;font-size:0.85rem;">الصلاحية المطلوبة: <code>${mpEsc(perm)}</code> — وسياسة القراءة في قاعدة البيانات ستحجب الصفوف حتى لو طُلبت عبر API مباشرة.</p>
  </div>`;
}

// =====================================================================================
// 1) قوائم الأسعار
// =====================================================================================
async function mpPriceLists(body, client) {
  const scope = await mpScope(client);
  if (!can("pricing.view")) { body.innerHTML = mpNoView("pricing.view", "قوائم الأسعار"); return; }
  const canCreate = can("pricing.create");
  const canUpdate = can("pricing.update");
  const canDelete = can("pricing.delete");

  const [listsRes, itemsRes, prodRes] = await Promise.all([
    client.from("price_lists")
      .select("id,name,name_ar,currency,valid_from,valid_to,status,is_default,created_at")
      .order("created_at", { ascending: false }).limit(100),
    client.from("price_list_items").select("price_list_id,product_id,price,min_qty").limit(2000),
    client.from("products").select("id,name,name_ar,barcode").order("name").limit(200)
  ]);
  if (listsRes && listsRes.error) throw new Error(listsRes.error.message);

  const lists = listsRes.data || [];
  const items = (itemsRes && !itemsRes.error) ? (itemsRes.data || []) : [];
  const products = (prodRes && !prodRes.error) ? (prodRes.data || []) : [];
  const productLabel = {};
  products.forEach((p) => { productLabel[p.id] = p.name_ar || p.name || p.barcode || String(p.id).slice(0, 8); });

  const byList = {};
  items.forEach((it) => {
    if (!byList[it.price_list_id]) byList[it.price_list_id] = [];
    byList[it.price_list_id].push(it);
  });

  const productOptions = products.length
    ? products.map((p) => `<option value="${mpEsc(p.id)}">${mpEsc(p.name_ar || p.name)}${p.barcode ? " — " + mpEsc(p.barcode) : ""}</option>`).join("")
    : "";

  const cards = lists.map((l) => {
    const rows = (byList[l.id] || []).sort((a, b) => Number(a.min_qty) - Number(b.min_qty)).map((it) => `
      <tr>
        <td style="padding:0.35rem;">${mpEsc(productLabel[it.product_id] || String(it.product_id).slice(0, 8))}</td>
        <td style="padding:0.35rem;">${mpNum(it.min_qty)}</td>
        <td style="padding:0.35rem;font-weight:600;">${mpNum(it.price)}</td>
        <td style="padding:0.35rem;">
          ${canDelete ? `<button class="btn secondary" type="button" data-mp-del-item="${mpEsc(it.product_id)}" data-mp-list="${mpEsc(l.id)}" data-mp-qty="${mpEsc(it.min_qty)}" style="color:#b91c1c;">حذف</button>` : ""}
        </td>
      </tr>`).join("");

    const itemsBlock = `
      <details style="margin-top:0.5rem;">
        <summary style="cursor:pointer;font-weight:600;">بنود السعر (${(byList[l.id] || []).length})</summary>
        ${(byList[l.id] || []).length ? `
          <div style="overflow-x:auto;margin-top:0.5rem;">
            <table style="width:100%;border-collapse:collapse;min-width:420px;">
              <thead><tr style="border-bottom:2px solid #e5e7eb;text-align:right;">
                <th style="padding:0.35rem;">الصنف</th><th style="padding:0.35rem;">أدنى كمية</th><th style="padding:0.35rem;">السعر</th><th></th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>` : `<p class="muted" style="font-size:0.85rem;">لا توجد بنود بعد.</p>`}
        ${canCreate && products.length ? `
          <form data-mp-add-item="${mpEsc(l.id)}" style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:flex-end;margin-top:0.5rem;">
            <div style="flex:1 1 180px;min-width:160px;"><label style="font-size:0.8rem;">الصنف</label>
              <select name="product_id" class="input" required style="width:100%;"><option value="">اختر الصنف</option>${productOptions}</select></div>
            <div><label style="font-size:0.8rem;">أدنى كمية</label><input name="min_qty" type="number" min="0.001" step="0.001" value="1" class="input" style="width:100px;" required /></div>
            <div><label style="font-size:0.8rem;">السعر</label><input name="price" type="number" min="0" step="0.01" class="input" style="width:110px;" required /></div>
            <button class="btn" type="submit" style="background:#7c3aed;color:#fff;">➕ إضافة بند</button>
          </form>` : ""}
      </details>`;

    return `
      <div class="card" style="margin-bottom:0.75rem;">
        <div style="display:flex;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;align-items:center;">
          <div>
            <strong>${mpEsc(l.name_ar || l.name)}</strong>
            ${l.is_default ? `<span class="rbac-badge" style="margin-inline-start:0.35rem;">افتراضية</span>` : ""}
            <div class="muted" style="font-size:0.8rem;">
              ${mpEsc(l.currency || "EGP")} · سارية من ${mpDate(l.valid_from)}${l.valid_to ? " حتى " + mpDate(l.valid_to) : ""}
            </div>
          </div>
          <div style="display:flex;gap:0.35rem;flex-wrap:wrap;align-items:center;">
            ${mpBadge(l.status)}
            ${canUpdate && l.status !== "active" ? `<button class="btn secondary" type="button" data-mp-list-status="${mpEsc(l.id)}" data-mp-status="active">تفعيل</button>` : ""}
            ${canUpdate && l.status !== "archived" ? `<button class="btn secondary" type="button" data-mp-list-status="${mpEsc(l.id)}" data-mp-status="archived">أرشفة</button>` : ""}
          </div>
        </div>
        ${itemsBlock}
      </div>`;
  }).join("");

  body.innerHTML = `
    <div class="card" style="margin-bottom:1rem;">
      <h3 style="margin-top:0;">📋 قوائم الأسعار</h3>
      <p class="muted" style="font-size:0.85rem;margin:0;">
        القائمة تربط الأصناف بأسعار بيع حسب الكمية. تفعيل قائمة أو أرشفتها يتطلب صلاحية <code>pricing.update</code> —
        والفرض الفعلي في قاعدة البيانات وليس في هذه الصفحة.
      </p>
    </div>

    ${canCreate ? `
    <form id="mp-pricelist-form" class="card" style="display:grid;gap:0.75rem;margin-bottom:1rem;">
      <h4 style="margin:0;">➕ قائمة أسعار جديدة</h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0.75rem;">
        ${mpField("الاسم *", `<input name="name" class="input" required maxlength="80" />`)}
        ${mpField("الاسم المعروض (عربي)", `<input name="name_ar" class="input" maxlength="120" />`)}
        ${mpField("العملة", `<input name="currency" class="input" value="EGP" maxlength="3" dir="ltr" />`)}
        ${mpField("سارية من *", `<input name="valid_from" type="date" class="input" value="${mpToday()}" required />`)}
        ${mpField("سارية حتى", `<input name="valid_to" type="date" class="input" />`)}
      </div>
      <div><button class="btn" type="submit" style="background:#7c3aed;color:#fff;">💾 حفظ القائمة</button></div>
      <p class="rbac-error-line" id="mp-pricelist-error" style="margin:0;"></p>
    </form>` : `<div class="card"><p class="muted" style="margin:0;">لا تملك صلاحية إنشاء قوائم أسعار (<code>pricing.create</code>) — العرض فقط.</p></div>`}

    ${lists.length ? cards : mpEmpty("لا توجد قوائم أسعار بعد.")}
  `;

  const form = document.getElementById("mp-pricelist-form");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("mp-pricelist-error");
      const fd = new FormData(form);
      const name = String(fd.get("name") || "").trim();
      const validFrom = String(fd.get("valid_from") || "");
      const validTo = String(fd.get("valid_to") || "");
      if (!name) return errEl && (errEl.textContent = "الاسم مطلوب");
      if (!validFrom) return errEl && (errEl.textContent = "تاريخ بداية السريان مطلوب");
      if (validTo && validTo < validFrom) return errEl && (errEl.textContent = "تاريخ النهاية يجب أن يكون بعد البداية");
      try {
        await mpInsert(client, "price_lists", {
          tenant_id: scope.tenant_id,
          warehouse_id: scope.warehouse_id,
          name,
          name_ar: String(fd.get("name_ar") || "").trim() || name,
          currency: String(fd.get("currency") || "EGP").trim().toUpperCase() || "EGP",
          valid_from: validFrom,
          valid_to: validTo || null,
          status: "draft",
          created_by: scope.user_id || null
        });
        await mpPriceLists(body, client);
      } catch (err) {
        if (errEl) errEl.textContent = "تعذر الحفظ: " + ((err && err.message) || err);
      }
    });
  }

  body.querySelectorAll("[data-mp-list-status]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await mpPatch(client, "price_lists", btn.getAttribute("data-mp-list-status"), {
          status: btn.getAttribute("data-mp-status")
        });
        await mpPriceLists(body, client);
      } catch (err) {
        alert("تعذر تغيير حالة القائمة: " + ((err && err.message) || err));
      }
    });
  });

  body.querySelectorAll("[data-mp-add-item]").forEach((f) => {
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const productId = String(fd.get("product_id") || "");
      const price = Number(fd.get("price"));
      const minQty = Number(fd.get("min_qty") || 1);
      if (!productId) return alert("اختر الصنف");
      if (!Number.isFinite(price) || price < 0) return alert("السعر غير صحيح");
      if (!Number.isFinite(minQty) || minQty <= 0) return alert("أدنى كمية يجب أن تكون أكبر من صفر");
      try {
        await mpInsert(client, "price_list_items", {
          price_list_id: f.getAttribute("data-mp-add-item"),
          product_id: productId,
          price,
          min_qty: minQty
        });
        await mpPriceLists(body, client);
      } catch (err) {
        alert("تعذر إضافة البند: " + ((err && err.message) || err));
      }
    });
  });

  body.querySelectorAll("[data-mp-del-item]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("حذف بند السعر لهذا الصنف؟")) return;
      try {
        const res = await client.from("price_list_items").delete()
          .eq("price_list_id", btn.getAttribute("data-mp-list"))
          .eq("product_id", btn.getAttribute("data-mp-del-item"))
          .eq("min_qty", Number(btn.getAttribute("data-mp-qty")));
        if (res && res.error) throw new Error(res.error.message);
        await mpPriceLists(body, client);
      } catch (err) {
        alert("تعذر حذف البند: " + ((err && err.message) || err));
      }
    });
  });
}

// =====================================================================================
// 2) العروض والحملات
// =====================================================================================
async function mpPromotions(body, client) {
  const scope = await mpScope(client);
  if (!can("pricing.view")) { body.innerHTML = mpNoView("pricing.view", "العروض والحملات"); return; }
  const canCreate = can("pricing.create");
  const canUpdate = can("pricing.update");
  const canApprove = can("pricing.approve");
  const canReject = can("pricing.reject");

  const res = await client.from("promotions")
    .select("id,name,name_ar,kind,value,min_order_amount,max_discount,budget,usage_limit,used_count,applies_to,starts_at,ends_at,status,created_at")
    .order("created_at", { ascending: false }).limit(100);
  if (res && res.error) throw new Error(res.error.message);
  const promos = res.data || [];

  const cards = promos.map((p) => {
    const now = Date.now();
    const start = p.starts_at ? new Date(p.starts_at).getTime() : 0;
    const end = p.ends_at ? new Date(p.ends_at).getTime() : 0;
    const windowState = (start && now < start) ? "لم يبدأ" : (end && now > end) ? "انتهت مدته" : "داخل المدة";
    const usage = p.usage_limit ? `${p.used_count || 0}/${p.usage_limit}` : `${p.used_count || 0}/∞`;
    const actions = [];
    if (canUpdate && p.status === "draft") actions.push(`<button class="btn secondary" type="button" data-mp-promo="${mpEsc(p.id)}" data-mp-status="pending_approval">إرسال للاعتماد</button>`);
    if (canApprove && (p.status === "pending_approval" || p.status === "draft")) actions.push(`<button class="btn" type="button" data-mp-promo="${mpEsc(p.id)}" data-mp-status="approved" style="background:#16a34a;color:#fff;">اعتماد</button>`);
    if (canReject && p.status === "pending_approval") actions.push(`<button class="btn secondary" type="button" data-mp-promo="${mpEsc(p.id)}" data-mp-status="rejected" style="color:#b91c1c;">رفض</button>`);
    if (canApprove && p.status === "approved") actions.push(`<button class="btn" type="button" data-mp-promo="${mpEsc(p.id)}" data-mp-status="active" style="background:#2563eb;color:#fff;">تفعيل</button>`);
    if (canUpdate && p.status === "active") actions.push(`<button class="btn secondary" type="button" data-mp-promo="${mpEsc(p.id)}" data-mp-status="paused">إيقاف مؤقت</button>`);
    if (canUpdate && p.status === "paused") actions.push(`<button class="btn secondary" type="button" data-mp-promo="${mpEsc(p.id)}" data-mp-status="active">استئناف</button>`);

    return `
      <div class="card" style="margin-bottom:0.75rem;">
        <div style="display:flex;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;align-items:flex-start;">
          <div>
            <strong>${mpEsc(p.name_ar || p.name)}</strong> ${mpBadge(p.status)}
            <div class="muted" style="font-size:0.8rem;margin-top:0.25rem;">
              ${mpEsc(MP_KIND[p.kind] || p.kind)} · القيمة ${mpNum(p.value)}${p.kind === "percent" ? "%" : ""} ·
              أدنى طلب ${mpNum(p.min_order_amount)}${p.max_discount ? " · أقصى خصم " + mpNum(p.max_discount) : ""}
            </div>
            <div class="muted" style="font-size:0.8rem;">
              ${mpEsc(MP_APPLIES[p.applies_to] || p.applies_to)} · الاستخدام ${mpEsc(usage)}
              ${p.budget ? " · الميزانية " + mpNum(p.budget) : ""}
            </div>
            <div class="muted" style="font-size:0.8rem;">
              من ${mpDate(p.starts_at)}${p.ends_at ? " إلى " + mpDate(p.ends_at) : " (بدون نهاية)"} — ${windowState}
            </div>
          </div>
          <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">${actions.join("") || `<span class="muted" style="font-size:0.8rem;">لا توجد إجراءات متاحة لحالتك</span>`}</div>
        </div>
      </div>`;
  }).join("");

  body.innerHTML = `
    <div class="card" style="margin-bottom:1rem;">
      <h3 style="margin-top:0;">🎉 العروض والحملات</h3>
      <p class="muted" style="font-size:0.85rem;margin:0;">
        العرض يمر بمسودة ← اعتماد ← تفعيل. التفعيل والاعتماد يتطلبان <code>pricing.approve</code>، والرفض يتطلب
        <code>pricing.reject</code>، وكل ذلك مفروض بمُشغّل على جدول العروض.
      </p>
    </div>

    ${canCreate ? `
    <form id="mp-promo-form" class="card" style="display:grid;gap:0.75rem;margin-bottom:1rem;">
      <h4 style="margin:0;">➕ عرض جديد</h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:0.75rem;">
        ${mpField("الاسم *", `<input name="name" class="input" required maxlength="80" />`)}
        ${mpField("الاسم المعروض (عربي)", `<input name="name_ar" class="input" maxlength="120" />`)}
        ${mpField("النوع *", `<select name="kind" class="input" required>
            <option value="percent">نسبة %</option>
            <option value="amount">مبلغ ثابت</option>
            <option value="buy_x_get_y">اشترِ واحصل</option>
            <option value="bundle">حزمة أصناف</option>
          </select>`)}
        ${mpField("القيمة *", `<input name="value" type="number" min="0" step="0.01" class="input" value="0" required />`)}
        ${mpField("أدنى مبلغ للطلب", `<input name="min_order_amount" type="number" min="0" step="0.01" class="input" value="0" />`)}
        ${mpField("أقصى خصم", `<input name="max_discount" type="number" min="0" step="0.01" class="input" />`)}
        ${mpField("ميزانية الحملة", `<input name="budget" type="number" min="0" step="0.01" class="input" />`)}
        ${mpField("حد الاستخدام", `<input name="usage_limit" type="number" min="0" step="1" class="input" />`)}
        ${mpField("يبدأ *", `<input name="starts_at" type="datetime-local" class="input" value="${mpNowLocal()}" required />`)}
        ${mpField("ينتهي", `<input name="ends_at" type="datetime-local" class="input" />`)}
        ${mpField("ينطبق على", `<select name="applies_to" class="input">
            <option value="all">كل الأصناف</option>
            <option value="products">أصناف محددة</option>
            <option value="categories">فئات محددة</option>
          </select>`)}
      </div>
      <div><button class="btn" type="submit" style="background:#7c3aed;color:#fff;">💾 حفظ كمسودة</button></div>
      <p class="rbac-error-line" id="mp-promo-error" style="margin:0;"></p>
    </form>` : `<div class="card"><p class="muted" style="margin:0;">لا تملك صلاحية إنشاء العروض (<code>pricing.create</code>).</p></div>`}

    ${promos.length ? cards : mpEmpty("لا توجد عروض بعد.")}
  `;

  const form = document.getElementById("mp-promo-form");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("mp-promo-error");
      const fd = new FormData(form);
      const name = String(fd.get("name") || "").trim();
      const startsAt = String(fd.get("starts_at") || "");
      const endsAt = String(fd.get("ends_at") || "");
      if (!name) return errEl && (errEl.textContent = "الاسم مطلوب");
      if (!startsAt) return errEl && (errEl.textContent = "وقت البداية مطلوب");
      if (endsAt && new Date(endsAt) <= new Date(startsAt)) return errEl && (errEl.textContent = "وقت النهاية يجب أن يكون بعد البداية");
      const value = Number(fd.get("value") || 0);
      if (!Number.isFinite(value) || value < 0) return errEl && (errEl.textContent = "القيمة يجب أن تكون صفرًا أو أكثر");
      const usageLimit = String(fd.get("usage_limit") || "").trim();
      try {
        await mpInsert(client, "promotions", {
          tenant_id: scope.tenant_id,
          warehouse_id: scope.warehouse_id,
          name,
          name_ar: String(fd.get("name_ar") || "").trim() || name,
          kind: String(fd.get("kind") || "percent"),
          value,
          min_order_amount: Number(fd.get("min_order_amount") || 0),
          max_discount: String(fd.get("max_discount") || "").trim() ? Number(fd.get("max_discount")) : null,
          budget: String(fd.get("budget") || "").trim() ? Number(fd.get("budget")) : null,
          usage_limit: usageLimit ? Math.max(0, Math.trunc(Number(usageLimit))) : null,
          applies_to: String(fd.get("applies_to") || "all"),
          starts_at: new Date(startsAt).toISOString(),
          ends_at: endsAt ? new Date(endsAt).toISOString() : null,
          status: "draft",
          created_by: scope.user_id || null
        });
        await mpPromotions(body, client);
      } catch (err) {
        if (errEl) errEl.textContent = "تعذر الحفظ: " + ((err && err.message) || err);
      }
    });
  }

  body.querySelectorAll("[data-mp-promo]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const status = btn.getAttribute("data-mp-status");
      if (status === "active" && !confirm("تفعيل العرض يعني تطبيقه على المبيعات. متابعة؟")) return;
      const patch = { status };
      if (status === "approved") { patch.approved_at = new Date().toISOString(); }
      try {
        await mpPatch(client, "promotions", btn.getAttribute("data-mp-promo"), patch);
        await mpPromotions(body, client);
      } catch (err) {
        alert("تعذر تغيير حالة العرض: " + ((err && err.message) || err));
      }
    });
  });
}

// =====================================================================================
// 3) مسيرات الرواتب
// =====================================================================================
async function mpPayroll(body, client) {
  const scope = await mpScope(client);
  if (!can("payroll.view")) { body.innerHTML = mpNoView("payroll.view", "مسيرات الرواتب"); return; }
  const canCreate = can("payroll.create");
  const canUpdate = can("payroll.update");
  const canApprove = can("payroll.approve");

  const res = await client.from("payroll_runs")
    .select("id,period_start,period_end,status,total_gross,total_deductions,total_net,notes,approved_at,created_at")
    .order("period_start", { ascending: false }).limit(100);
  if (res && res.error) throw new Error(res.error.message);
  const runs = res.data || [];
  const runIds = runs.map((r) => r.id);

  let items = [];
  if (runIds.length) {
    const it = await client.from("payroll_items")
      .select("id,payroll_run_id,employee_id,base_salary,allowances,deductions,net_salary")
      .in("payroll_run_id", runIds).limit(2000);
    if (it && !it.error) items = it.data || [];
  }

  let settlements = [];
  if (runIds.length) {
    const st = await client.from("payroll_settlements")
      .select("id,payroll_run_id,employee_id,kind,amount,reason,created_at")
      .in("payroll_run_id", runIds).limit(2000);
    if (st && !st.error) settlements = st.data || [];
  }
  const settlesByRun = {};
  settlements.forEach((s) => {
    if (!settlesByRun[s.payroll_run_id]) settlesByRun[s.payroll_run_id] = [];
    settlesByRun[s.payroll_run_id].push(s);
  });
  const settleKindLabel = { bonus: "مكافأة", deduction: "خصم", correction: "تصحيح" };

  const staffRes = await client.from("warehouse_employees")
    .select("id,full_name,is_active").eq("warehouse_id", scope.warehouse_id).limit(300);
  const staff = (staffRes && !staffRes.error) ? (staffRes.data || []) : [];
  const staffName = {};
  staff.forEach((s) => { staffName[s.id] = s.full_name || String(s.id).slice(0, 8); });

  const byRun = {};
  items.forEach((it) => {
    if (!byRun[it.payroll_run_id]) byRun[it.payroll_run_id] = [];
    byRun[it.payroll_run_id].push(it);
  });

  const cards = runs.map((r) => {
    const runItems = byRun[r.id] || [];
    const used = {};
    runItems.forEach((it) => { used[it.employee_id] = true; });
    const available = staff.filter((s) => !used[s.id] && s.is_active !== false);
    const editable = r.status === "draft" && canCreate;

    // المسير المعتمد/المدفوع يُصحّح بتسوية موثقة لا بتعديله
    const runSettles = settlesByRun[r.id] || [];
    const adjTotal = runSettles.reduce((sum, s) => sum + Number(s.amount || 0), 0);
    const baseNet = Number(r.total_net || 0) - adjTotal;
    const canSettle = canApprove && (r.status === "approved" || r.status === "paid");

    const itemRows = runItems.map((it) => `
      <tr>
        <td style="padding:0.35rem;">${mpEsc(staffName[it.employee_id] || String(it.employee_id).slice(0, 8))}</td>
        <td style="padding:0.35rem;">${mpNum(it.base_salary)}</td>
        <td style="padding:0.35rem;">${mpNum(it.allowances)}</td>
        <td style="padding:0.35rem;">${mpNum(it.deductions)}</td>
        <td style="padding:0.35rem;font-weight:600;">${mpNum(it.net_salary)}</td>
        <td style="padding:0.35rem;">${editable && canUpdate ? `<button class="btn secondary" type="button" data-mp-item-del="${mpEsc(it.id)}" style="color:#b91c1c;">حذف</button>` : "—"}</td>
      </tr>`).join("");

    const settleRows = runSettles.map((s) => `
      <tr>
        <td style="padding:0.35rem;">${settleKindLabel[s.kind] || mpEsc(s.kind)}</td>
        <td style="padding:0.35rem;">${mpEsc(s.employee_id ? (staffName[s.employee_id] || String(s.employee_id).slice(0, 8)) : "عام (كل المسير)")}</td>
        <td style="padding:0.35rem;font-weight:600;color:${Number(s.amount) < 0 ? "#b91c1c" : "#15803d"};">${mpNum(s.amount)}</td>
        <td style="padding:0.35rem;">${mpEsc(s.reason || "")}</td>
        <td style="padding:0.35rem;">${mpDate(s.created_at)}</td>
      </tr>`).join("");

    const settleBlock = (runSettles.length || canSettle) ? `
      <details style="margin-top:0.5rem;">
        <summary style="cursor:pointer;font-weight:600;">تسويات موثقة (${runSettles.length})</summary>
        ${runSettles.length ? `
          <div style="overflow-x:auto;margin-top:0.5rem;">
            <table style="width:100%;border-collapse:collapse;min-width:600px;">
              <thead><tr style="border-bottom:2px solid #e5e7eb;text-align:right;">
                <th style="padding:0.35rem;">النوع</th><th style="padding:0.35rem;">الموظف</th>
                <th style="padding:0.35rem;">المبلغ</th><th style="padding:0.35rem;">السبب</th>
                <th style="padding:0.35rem;">التاريخ</th>
              </tr></thead>
              <tbody>${settleRows}</tbody>
            </table>
          </div>` : `<p class="muted" style="font-size:0.85rem;">لا توجد تسويات. المسير المعتمد لا يُعدّل مباشرة؛ أي تصحيح يُسجّل هنا كمستند موثق (مبلغ + سبب).</p>`}
        ${canSettle ? `
          <form data-mp-settle="${mpEsc(r.id)}" style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:flex-end;margin-top:0.5rem;">
            <div style="flex:0 1 190px;"><label style="font-size:0.8rem;">الموظف (اختياري)</label>
              <select name="employee_id" class="input" style="width:100%;"><option value="">عام — كل المسير</option>
                ${staff.map((s) => `<option value="${mpEsc(s.id)}">${mpEsc(staffName[s.id])}</option>`).join("")}
              </select></div>
            <div><label style="font-size:0.8rem;">المبلغ *</label><input name="amount" type="number" step="0.01" class="input" style="width:130px;" required placeholder="+ مكافأة / − خصم" /></div>
            <div style="flex:1 1 220px;min-width:180px;"><label style="font-size:0.8rem;">السبب * (5 أحرف على الأقل)</label><input name="reason" class="input" maxlength="200" minlength="5" required style="width:100%;" /></div>
            <button class="btn" type="submit" style="background:#7c3aed;color:#fff;">➕ تسجيل تسوية</button>
          </form>` : ""}
      </details>` : "";

    const itemsBlock = `
      <details style="margin-top:0.5rem;">
        <summary style="cursor:pointer;font-weight:600;">بنود الموظفين (${runItems.length})</summary>
        ${runItems.length ? `
          <div style="overflow-x:auto;margin-top:0.5rem;">
            <table style="width:100%;border-collapse:collapse;min-width:560px;">
              <thead><tr style="border-bottom:2px solid #e5e7eb;text-align:right;">
                <th style="padding:0.35rem;">الموظف</th><th style="padding:0.35rem;">الأساسي</th>
                <th style="padding:0.35rem;">بدلات</th><th style="padding:0.35rem;">خصومات</th>
                <th style="padding:0.35rem;">الصافي</th><th></th>
              </tr></thead>
              <tbody>${itemRows}</tbody>
            </table>
          </div>` : `<p class="muted" style="font-size:0.85rem;">لا توجد بنود بعد — الإجماليات تبقى صفرًا حتى تُضاف.</p>`}
        ${editable && available.length ? `
          <form data-mp-item-add="${mpEsc(r.id)}" style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:flex-end;margin-top:0.5rem;">
            <div style="flex:1 1 200px;min-width:180px;"><label style="font-size:0.8rem;">الموظف</label>
              <select name="employee_id" class="input" required style="width:100%;"><option value="">اختر الموظف</option>
                ${available.map((s) => `<option value="${mpEsc(s.id)}">${mpEsc(staffName[s.id])}</option>`).join("")}
              </select></div>
            <div><label style="font-size:0.8rem;">الأساسي</label><input name="base_salary" type="number" min="0" step="0.01" class="input" style="width:110px;" value="0" required /></div>
            <div><label style="font-size:0.8rem;">بدلات</label><input name="allowances" type="number" min="0" step="0.01" class="input" style="width:100px;" value="0" /></div>
            <div><label style="font-size:0.8rem;">خصومات</label><input name="deductions" type="number" min="0" step="0.01" class="input" style="width:100px;" value="0" /></div>
            <button class="btn" type="submit" style="background:#0f766e;color:#fff;">➕ إضافة بند</button>
          </form>` : (editable ? `<p class="muted" style="font-size:0.8rem;margin-top:0.5rem;">لا يوجد موظفون متاحون — أضفهم من صفحة الموظفين أولًا (كل موظف مرة واحدة لكل مسير).</p>` : "")}
      </details>`;

    const actions = [];
    if (canApprove && r.status === "draft") actions.push(`<button class="btn" type="button" data-mp-run="${mpEsc(r.id)}" data-mp-status="approved" style="background:#16a34a;color:#fff;">اعتماد المسير</button>`);
    if (canApprove && r.status === "approved") actions.push(`<button class="btn" type="button" data-mp-run="${mpEsc(r.id)}" data-mp-status="paid" style="background:#2563eb;color:#fff;">تسجيل الدفع</button>`);
    if (canUpdate && r.status === "draft") actions.push(`<button class="btn secondary" type="button" data-mp-run="${mpEsc(r.id)}" data-mp-status="pending_approval">إرسال للاعتماد</button>`);
    if (canApprove && r.status !== "cancelled" && r.status !== "paid") actions.push(`<button class="btn secondary" type="button" data-mp-run="${mpEsc(r.id)}" data-mp-status="cancelled" style="color:#b91c1c;">إلغاء</button>`);

    return `
      <div class="card" style="margin-bottom:0.75rem;">
        <div style="display:flex;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;align-items:flex-start;">
          <div>
            <strong>${mpDate(r.period_start)} → ${mpDate(r.period_end)}</strong> ${mpBadge(r.status)}
            <div class="muted" style="font-size:0.8rem;margin-top:0.25rem;">
              إجمالي ${mpNum(r.total_gross)} · خصومات ${mpNum(r.total_deductions)} · صافي ${mpNum(r.total_net)}
              ${runSettles.length ? ` · منها تسويات ${mpNum(adjTotal)} (صافي البنود ${mpNum(baseNet)})` : ""}
              ${r.approved_at ? " · اعتُمد " + mpDate(r.approved_at) : ""}
            </div>
            ${r.notes ? `<div class="muted" style="font-size:0.8rem;">${mpEsc(r.notes)}</div>` : ""}
          </div>
          <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">${actions.join("") || `<span class="muted" style="font-size:0.8rem;">لا توجد إجراءات متاحة</span>`}</div>
        </div>
        ${itemsBlock}
        ${settleBlock}
      </div>`;
  }).join("");

  body.innerHTML = `
    <div class="card" style="margin-bottom:1rem;">
      <h3 style="margin-top:0;">💰 مسيرات الرواتب</h3>
      <p class="muted" style="font-size:0.85rem;margin:0;">
        المسير يُنشأ كمسودة وتُضاف بنوده لكل موظف؛ صافي البند (الأساسي + البدلات − الخصومات) والإجماليات
        تُحسب في قاعدة البيانات، والمسير يُقفل بعد الاعتماد. لا يُسمح بمسيرين لنفس الفترة في المخزن نفسه.
      </p>
    </div>

    ${canCreate ? `
    <form id="mp-payroll-form" class="card" style="display:grid;gap:0.75rem;margin-bottom:1rem;">
      <h4 style="margin:0;">➕ مسير رواتب جديد</h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:0.75rem;">
        ${mpField("من تاريخ *", `<input name="period_start" type="date" class="input" required value="${mpToday().slice(0, 8)}01" />`)}
        ${mpField("إلى تاريخ *", `<input name="period_end" type="date" class="input" required value="${mpToday()}" />`)}
        ${mpField("ملاحظات", `<input name="notes" class="input" maxlength="200" />`)}
      </div>
      <div><button class="btn" type="submit" style="background:#16a34a;color:#fff;">💾 إنشاء مسودة</button></div>
      <p class="rbac-error-line" id="mp-payroll-error" style="margin:0;"></p>
    </form>` : `<div class="card"><p class="muted" style="margin:0;">لا تملك صلاحية إنشاء مسيرات الرواتب (<code>payroll.create</code>).</p></div>`}

    ${runs.length ? cards : mpEmpty("لا توجد مسيرات رواتب بعد.")}
  `;

  const form = document.getElementById("mp-payroll-form");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("mp-payroll-error");
      const fd = new FormData(form);
      const from = String(fd.get("period_start") || "");
      const to = String(fd.get("period_end") || "");
      if (!from || !to) return errEl && (errEl.textContent = "تاريخا البداية والنهاية مطلوبان");
      if (to < from) return errEl && (errEl.textContent = "تاريخ النهاية يجب أن يكون بعد البداية");
      try {
        await mpInsert(client, "payroll_runs", {
          tenant_id: scope.tenant_id,
          warehouse_id: scope.warehouse_id,
          period_start: from,
          period_end: to,
          notes: String(fd.get("notes") || "").trim() || null,
          status: "draft",
          created_by: scope.user_id || null
        });
        await mpPayroll(body, client);
      } catch (err) {
        const msg = (err && err.message) || String(err);
        if (errEl) errEl.textContent = /duplicate|23505|unique/i.test(msg)
          ? "يوجد مسير لنفس الفترة بالفعل لهذا المخزن — لا يُسمح بالتكرار."
          : "تعذر الإنشاء: " + msg;
      }
    });
  }

  body.querySelectorAll("[data-mp-item-add]").forEach((f) => {
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const employeeId = String(fd.get("employee_id") || "");
      if (!employeeId) return alert("اختر الموظف");
      const base = Number(fd.get("base_salary") || 0);
      const allow = Number(fd.get("allowances") || 0);
      const ded = Number(fd.get("deductions") || 0);
      if (![base, allow, ded].every((n) => Number.isFinite(n) && n >= 0)) return alert("المبالغ يجب أن تكون أرقامًا غير سالبة");
      if (ded > base + allow) return alert("الخصومات أكبر من الأساسي + البدلات — صافي البند لا يكون سالبًا");
      try {
        await mpInsert(client, "payroll_items", {
          payroll_run_id: f.getAttribute("data-mp-item-add"),
          employee_id: employeeId,
          base_salary: base,
          allowances: allow,
          deductions: ded
        });
        await mpPayroll(body, client);
      } catch (err) {
        alert("تعذر إضافة البند: " + ((err && err.message) || err));
      }
    });
  });

  body.querySelectorAll("[data-mp-item-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("حذف بند هذا الموظف من المسير؟")) return;
      try {
        const del = await client.from("payroll_items").delete().eq("id", btn.getAttribute("data-mp-item-del"));
        if (del && del.error) throw new Error(del.error.message);
        await mpPayroll(body, client);
      } catch (err) {
        alert("تعذر حذف البند: " + ((err && err.message) || err));
      }
    });
  });

  body.querySelectorAll("[data-mp-settle]").forEach((f) => {
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const amount = Number(fd.get("amount") || 0);
      const reason = String(fd.get("reason") || "").trim();
      if (!Number.isFinite(amount) || amount === 0) return alert("أدخل مبلغًا غير صفري (+ مكافأة أو − خصم)");
      if (reason.length < 5) return alert("سبب التسوية إلزامي (5 أحرف على الأقل)");
      if (!confirm("تسجيل تسوية بمبلغ " + amount + "؟ التسوية مستند موثق لا يمكن تعديله أو حذفه بعد الحفظ.")) return;
      try {
        const res = await client.rpc("payroll_run_settle", {
          p_run: f.getAttribute("data-mp-settle"),
          p_amount: amount,
          p_reason: reason,
          p_employee: String(fd.get("employee_id") || "") || null
        });
        if (res && res.error) throw new Error(res.error.message);
        await mpPayroll(body, client);
      } catch (err) {
        alert("تعذر تسجيل التسوية: " + ((err && err.message) || err));
      }
    });
  });

  body.querySelectorAll("[data-mp-run]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const status = btn.getAttribute("data-mp-status");
      if (status === "cancelled" && !confirm("إلغاء المسير؟ القيود المعتمدة لا تُحذف، بل تُعالج بتسوية موثقة.")) return;
      const patch = { status };
      if (status === "approved") { patch.approved_at = new Date().toISOString(); }
      try {
        await mpPatch(client, "payroll_runs", btn.getAttribute("data-mp-run"), patch);
        await mpPayroll(body, client);
      } catch (err) {
        alert("تعذر تغيير حالة المسير: " + ((err && err.message) || err));
      }
    });
  });
}

// =====================================================================================
// 4) تذاكر خدمة العملاء
// =====================================================================================
const mpTicketFilter = { status: "" };

async function mpTickets(body, client) {
  const scope = await mpScope(client);
  if (!can("customer_service.view")) { body.innerHTML = mpNoView("customer_service.view", "تذاكر خدمة العملاء"); return; }
  const canCreate = can("customer_service.create");
  const canUpdate = can("customer_service.update");

  let q = client.from("customer_service_tickets")
    .select("id,ticket_number,subject,description,category,priority,status,customer_id,resolution,created_at,resolved_at")
    .order("created_at", { ascending: false }).limit(100);
  if (mpTicketFilter.status) q = q.eq("status", mpTicketFilter.status);

  const [res, custRes] = await Promise.all([
    q,
    client.from("customers").select("id,name,name_ar,phone").order("name").limit(200)
  ]);
  if (res && res.error) throw new Error(res.error.message);
  const tickets = res.data || [];
  const customers = (custRes && !custRes.error) ? (custRes.data || []) : [];
  const custLabel = {};
  customers.forEach((c) => { custLabel[c.id] = (c.name_ar || c.name || "") + (c.phone ? " — " + c.phone : ""); });

  const rows = tickets.map((t) => {
    const actions = [];
    if (canUpdate && (t.status === "open" || t.status === "rejected")) actions.push(`<button class="btn secondary" type="button" data-mp-ticket="${mpEsc(t.id)}" data-mp-status="in_progress">بدء المعالجة</button>`);
    if (canUpdate && t.status === "in_progress") actions.push(`<button class="btn" type="button" data-mp-ticket="${mpEsc(t.id)}" data-mp-status="resolved" style="background:#16a34a;color:#fff;">حل التذكرة</button>`);
    if (canUpdate && t.status !== "closed") actions.push(`<button class="btn secondary" type="button" data-mp-ticket="${mpEsc(t.id)}" data-mp-status="closed">إغلاق</button>`);
    return `
      <tr style="border-bottom:1px solid #eee;vertical-align:top;">
        <td style="padding:0.5rem;font-family:monospace;font-size:0.8rem;" dir="ltr">${mpEsc(t.ticket_number)}</td>
        <td style="padding:0.5rem;">
          <strong>${mpEsc(t.subject)}</strong>
          ${t.description ? `<div class="muted" style="font-size:0.8rem;">${mpEsc(String(t.description).slice(0, 140))}</div>` : ""}
          <div class="muted" style="font-size:0.75rem;">${mpEsc(custLabel[t.customer_id] || "بدون عميل مرتبط")}${t.category ? " · " + mpEsc(t.category) : ""}</div>
          ${t.resolution ? `<div style="font-size:0.8rem;color:#166534;">الحل: ${mpEsc(t.resolution)}</div>` : ""}
        </td>
        <td style="padding:0.5rem;">${mpEsc(MP_PRIORITY[t.priority] || t.priority)}</td>
        <td style="padding:0.5rem;">${mpBadge(t.status)}</td>
        <td style="padding:0.5rem;white-space:nowrap;">${mpDate(t.created_at)}</td>
        <td style="padding:0.5rem;"><div style="display:flex;gap:0.25rem;flex-wrap:wrap;">${actions.join("") || "—"}</div></td>
      </tr>`;
  }).join("");

  body.innerHTML = `
    <div class="card" style="margin-bottom:1rem;">
      <div style="display:flex;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;align-items:center;">
        <h3 style="margin:0;">🎫 تذاكر خدمة العملاء</h3>
        <select class="input" id="mp-ticket-filter" style="max-width:220px;">
          <option value="">كل الحالات</option>
          ${Object.keys(MP_STATUS).filter((s) => ["open", "in_progress", "resolved", "closed", "rejected"].includes(s))
            .map((s) => `<option value="${s}"${mpTicketFilter.status === s ? " selected" : ""}>${mpEsc(MP_STATUS[s])}</option>`).join("")}
        </select>
      </div>
      <p class="muted" style="font-size:0.85rem;margin:0.5rem 0 0;">
        التذاكر مرتبطة بالمخزن والعميل. الإنشاء يتطلب <code>customer_service.create</code> وتغيير الحالة يتطلب
        <code>customer_service.update</code> — مفروض على الخادم.
      </p>
    </div>

    ${canCreate ? `
    <form id="mp-ticket-form" class="card" style="display:grid;gap:0.75rem;margin-bottom:1rem;">
      <h4 style="margin:0;">➕ تذكرة جديدة</h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0.75rem;">
        ${mpField("الموضوع *", `<input name="subject" class="input" required maxlength="120" />`)}
        ${mpField("العميل", `<select name="customer_id" class="input"><option value="">بدون عميل</option>${customers.map((c) => `<option value="${mpEsc(c.id)}">${mpEsc(c.name_ar || c.name)}${c.phone ? " — " + mpEsc(c.phone) : ""}</option>`).join("")}</select>`)}
        ${mpField("التصنيف", `<input name="category" class="input" maxlength="60" placeholder="شكوى تأخير / صنف ناقص…" />`)}
        ${mpField("الأولوية", `<select name="priority" class="input">
            <option value="normal">عادية</option>
            <option value="low">منخفضة</option>
            <option value="high">عالية</option>
            <option value="urgent">عاجلة</option>
          </select>`)}
      </div>
      ${mpField("الوصف", `<textarea name="description" class="input" rows="3" maxlength="1000"></textarea>`)}
      <div><button class="btn" type="submit" style="background:#2563eb;color:#fff;">💾 حفظ التذكرة</button></div>
      <p class="rbac-error-line" id="mp-ticket-error" style="margin:0;"></p>
    </form>` : `<div class="card"><p class="muted" style="margin:0;">لا تملك صلاحية إنشاء تذاكر (<code>customer_service.create</code>).</p></div>`}

    <div class="card" style="overflow-x:auto;">
      ${tickets.length ? `
        <table style="width:100%;border-collapse:collapse;min-width:760px;">
          <thead><tr style="border-bottom:2px solid #e5e7eb;text-align:right;">
            <th style="padding:0.5rem;">الرقم</th><th style="padding:0.5rem;">الموضوع</th>
            <th style="padding:0.5rem;">الأولوية</th><th style="padding:0.5rem;">الحالة</th>
            <th style="padding:0.5rem;">التاريخ</th><th style="padding:0.5rem;">إجراءات</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>` : mpEmpty("لا توجد تذاكر مطابقة.")}
    </div>
  `;

  const filter = document.getElementById("mp-ticket-filter");
  if (filter) filter.addEventListener("change", () => {
    mpTicketFilter.status = filter.value;
    mpTickets(body, client);
  });

  const form = document.getElementById("mp-ticket-form");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("mp-ticket-error");
      const fd = new FormData(form);
      const subject = String(fd.get("subject") || "").trim();
      if (!subject) return errEl && (errEl.textContent = "الموضوع مطلوب");
      const number = "T-" + Date.now().toString().slice(-9);
      try {
        await mpInsert(client, "customer_service_tickets", {
          tenant_id: scope.tenant_id,
          warehouse_id: scope.warehouse_id,
          ticket_number: number,
          subject,
          description: String(fd.get("description") || "").trim() || null,
          category: String(fd.get("category") || "").trim() || null,
          priority: String(fd.get("priority") || "normal"),
          customer_id: String(fd.get("customer_id") || "") || null,
          status: "open",
          created_by: scope.user_id || null
        });
        await mpTickets(body, client);
      } catch (err) {
        if (errEl) errEl.textContent = "تعذر الحفظ: " + ((err && err.message) || err);
      }
    });
  }

  body.querySelectorAll("[data-mp-ticket]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const status = btn.getAttribute("data-mp-status");
      const patch = { status };
      if (status === "resolved") {
        const resolution = prompt("اكتب حل التذكرة (يُحفظ في السجل):");
        if (resolution === null) return;
        if (!String(resolution).trim()) return alert("حل التذكرة مطلوب قبل إغلاقها كمحلولة");
        patch.resolution = String(resolution).trim();
        patch.resolved_at = new Date().toISOString();
      }
      try {
        await mpPatch(client, "customer_service_tickets", btn.getAttribute("data-mp-ticket"), patch);
        await mpTickets(body, client);
      } catch (err) {
        alert("تعذر تحديث التذكرة: " + ((err && err.message) || err));
      }
    });
  });
}

// =====================================================================================
// الموجّه: يعيد true إذا تولّى الصفحة، وfalse ليُكمل app.js مساره المعتاد
// =====================================================================================
async function modulePageLoader(routePath, body, client) {
  try {
    if (routePath === "/pricing/price-lists") { await mpPriceLists(body, client); return true; }
    if (routePath === "/pricing/promotions") { await mpPromotions(body, client); return true; }
    if (routePath === "/hr/payroll") { await mpPayroll(body, client); return true; }
    if (routePath === "/customer-service/tickets") { await mpTickets(body, client); return true; }
    return false;
  } catch (e) {
    body.innerHTML = mpError(e);
    return true;
  }
}
