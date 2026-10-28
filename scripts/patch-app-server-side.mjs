//cbc patch script
import { readFileSync, writeFileSync } from 'fs';

const files = {
  'public/app.js': [
    // 1) logMovementFailure: الكتابة في التدقيق عبر الخادم بهوية مشتقّة
    {
      from: `    const ctx = await loadWmsContext(client);
    if (!ctx || !ctx.tenant_id) return false;
    const { error: insertError } = await client.from("audit_logs").insert({
      tenant_id: ctx.tenant_id,
      user_id: ctx.user_id || null,
      warehouse_id: ctx.warehouse_id || null,
      action: "inventory_movement_failed",
      entity_type: (context && context.entity_type) || "inventory_movements",
      entity_id: (context && context.entity_id) || null,
      new_values: {
        error: String((error && error.message) || error),
        code: (error && error.code) || null,
        source: "web",
        at: new Date().toISOString(),
      },
    });
    return !insertError;`,
      to: `    // التسجيل عبر الخادم: الهوية ونطاق المستأجر/المخزن تُشتقّ من الجلسة في الخادم
    const res = await client.rpc("audit_log_client", {
      p_action: "inventory_movement_failed",
      p_entity_type: (context && context.entity_type) || "inventory_movements",
      p_entity_id: (context && context.entity_id) || null,
      p_details: {
        error: String((error && error.message) || error),
        code: (error && error.code) || null,
        at: new Date().toISOString(),
      },
    });
    return !(res && res.error);`
    },
    // 2) التسجيل: إنشاء المستأجر/المخزن/الملف/البصمة على الخادم فقط
    {
      from: `          try {
            const adminHash = await sha256b64url(adminPassword);
            let tenantId = null;
            const t = await client.from("tenants").select("id").limit(1);
            if (t.data && t.data[0]) tenantId = t.data[0].id;
            if (!tenantId) {
              const created = await client.from("tenants").insert({ name: warehouse }).select("id").single();
              if (created.data) tenantId = created.data.id;
            }
            if (tenantId) {
              // جدول المخازن بكل حقوله المتاحة: بيانات التواصل + hash كلمة مرور
              // المدير + المالك (manager_id)، مع رجوع تدريجي إن رفض المخطط حقل ما
              const whPayload = { tenant_id: tenantId, name: warehouse, phone: phone, governorate: governorate, is_main: true, password_hash: adminHash, manager_id: user.id };
              let wh = await client.from("warehouses").insert(whPayload);
              if (wh.error) {
                delete whPayload.password_hash;
                delete whPayload.manager_id;
                wh = await client.from("warehouses").insert(whPayload);
              }
            }
            // التليفون والمحافظة في profiles (أعمدة مثبتة هناك)
            await client.from("profiles").upsert({ id: user.id, full_name: warehouse, phone: phone, governorate: governorate, role: "manager" }, { onConflict: "id" });
            // كلمة مرور المدير بصيغة worker.js: SHA-256 → base64url
            await client.from("warehouse_password_hashes").insert({ user_id: user.id, hash: adminHash });
          } catch (_) { /* قد ترفض RLS إدراج صفوف لمستخدم جديد */ }`,
      to: `          try {
            const adminHash = await sha256b64url(adminPassword);
            // كل منطق التسجيل (مستأجر/مخزن/ملف/بصمة) يعمل على الخادم —
            // وليس بالواجهة؛ إن لم توجد جلسة بعد التفعيل يبقى فشل إنشاء الربط صامتاً
            if (user && data && data.session) {
              const ws = await client.rpc("wms_register_workspace", {
                p_name: warehouse,
                p_phone: phone,
                p_governorate: governorate,
                p_admin_hash: adminHash
              });
              if (ws && ws.error) console.warn("wms_register_workspace:", ws.error.message);
            }
          } catch (_) { /* الجلسة غير مكتملة أو رفض الخادم — لا سلوك هادئ تفعل الواجهة */ }`
    },
    // 3) الدخول الأول: حفظ بصمة كلمة مرور المدير عبر الخادم
    {
      from: `        // أول دخول: حفظ كلمة مرور المدير في كل الأماكن المتاحة
        let saved = false;
        // 1) جدول المخازن (إذا كان للمستخدم صف مرتبط بـ manager_id)
        try {
          const wu = await client.from("warehouses").update({ password_hash: hash }).eq("manager_id", info.id).select("id");
          if (!wu.error && wu.data && wu.data.length) saved = true;
        } catch (_) { /* ignore */ }
        // 2) جدول warehouse_password_hashes إن وُجد (قد لا يكون منشأاً في بعض المشاريع)
        try {
          const ins = await client.from("warehouse_password_hashes").insert({ user_id: info.id, hash: hash });
          if (!ins.error) saved = true;
        } catch (_) { /* ignore */ }`,
      to: `        // أول دخول: حفظ بصمة كلمة مرور المدير على الخادم فقط (is identity-check server-side)
        let saved = false;
        try {
          const res = await client.rpc("wms_manager_password_set", { p_hash: hash });
          if (res && !res.error && res.data) saved = true;
        } catch (_) { /* ignore */ }
        // fallback للمشاريع القديمة قبل تطبيق الترحيل رقم 202610290336
        if (!saved) {
          try {
            const wu = await client.from("warehouses").update({ password_hash: hash }).eq("manager_id", info.id).select("id");
            if (!wu.error && wu.data && wu.data.length) saved = true;
          } catch (_) { /* ignore */ }
          try {
            const ins = await client.from("warehouse_password_hashes").insert({ user_id: info.id, hash: hash });
            if (!ins.error) saved = true;
          } catch (_) { /* ignore */ }
        }`
    }
  ]
};

for (const [p, patches] of Object.entries(files)) {
  let s = readFileSync(p, 'utf8');
  for (const { from, to } of patches) {
    if (!s.includes(from)) {
      console.error('NOT FOUND in ' + p + ': ' + from.slice(0, 60).replace(/\n/g, '\\n'));
      process.exit(1);
    }
    s = s.replace(from, to);
  }
  writeFileSync(p, s);
  console.log('patched ' + p);
}
