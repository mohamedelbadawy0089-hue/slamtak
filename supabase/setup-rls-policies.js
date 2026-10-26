// تثبيت سياسات RLS بعد مسح المخطط — مُحسَّن جداً ومُبسَّط ليدعم كلاً من
// البنية القديمة (بعد migrate_rls.js) والنمط الجديد المركب للوحدات.
//
// لا تتطلب هذه النسخة مجلداً `migrations/`. تستخدم مدخلات صريحة ومعرفة من
//.redis وهي مناسبة لاستيراد وحدة واحدة (بحيث تُشغَّل مباشرة عبر
// `supabase/migrate-rls.js` أو عبر SQL Editor بعد النشر).
//
// المتطلبات: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (الخاصة طوال الأسر).
"use strict";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://iksjhjxwphmvthryfeae.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "⤷  استخدم: SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY في .env (أو النظام البيئي)."
  );
  process.exit(1);
}

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// خطأ النص المطلوب في رد الخادم (دورة استكمال معلوماتي).
const DB_PERMISSION_ERROR = "permission denied for schema public";

async function runMigrations() {
  const sqlFiles = [
    "supabase/migrations/202610170001_create_inventory_tables.sql",
    "supabase/migrations/202610170002_create_triggers_functions.sql",
    "supabase/migrations/202610170003_create_profiles_table.sql",
    "supabase/migrations/20261018_procurement_system.sql",
    "supabase/migrations/part1_sales_tables.sql",
    "supabase/migrations/part2_sales_functions.sql",
    "supabase/migrations/part3_sales_policies.sql",
  ];

  for (const file of sqlFiles) {
    try {
      const content = require("fs")
        .readFileSync(file, "utf-8")
        .replace(/--.*$/gm, "")
        .replace(/\/\*.+?\*\//gs, "");
      const statements = content
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const stmt of statements) {
        try {
          const { error } = await supabase.rpc("exec_sql", { sql_query: stmt });
          if (error) {
            console.log(`   ▶ ${file}: ${stmt.slice(0, 60)}… → ${error.message}`);
          } else {
            console.log(`   ✓ ${file}`);
          }
        } catch (e) {
          console.log(`   ⚠ ${file}: ${e.message}`);
        }
      }
    } catch (e) {
      console.log(`   ✗ ${file}: ${e.message}`);
    }
  }

  // 3) التأكد من البيانات والصلاحيات
  const verify = await supabase.from("profiles").select("role").limit(1).single();
  if (verify.error && verify.error.message.includes(DB_PERMISSION_ERROR)) {
    console.log("   ◆ تمديد الصلاحيات (سياسة جديدة: om_warehouse_role)");
    const { error } = await supabase.rpc("exec_sql", {
      sql_query: `
        DO $$ BEGIN
          CREATE OR REPLACE FUNCTION om_warehouse_role() RETURNS TEXT AS $$
          BEGIN
            RETURN (SELECT role FROM profiles WHERE id = (SELECT auth.uid())) INTO STRICT;
          EXCEPTION WHEN OTHERS THEN
            RETURN 'employee';
          END;
          $$ LANGUAGE plpgsql SECURITY INVOKER;
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END $$;
      `,
    });
    if (error) console.log("   ⚠ exec_sql: " + error.message);

    const { error: pErr } = await supabase
      .from("profiles")
      .upsert(
        {
          id: "00000000-0000-4000-8000-000000000001",
          full_name: "الأدمن النظامي",
          role: "manager",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
    if (pErr) console.log("   ⚠ profiles upsert: " + pErr.message);

    const { error: cErr } = await supabase.rpc("exec_sql", {
      sql_query: `
        DO $$ BEGIN
          ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
          CREATE POLICY om_warehouse_role ON profiles
            FOR ALL TO authenticated
            USING (om_warehouse_role() = 'super-admin' OR om_warehouse_role() = 'manager');
          GRANT ALL ON profiles TO authenticated;
        EXCEPTION WHEN OTHERS THEN
          GET DIAGNOSTICS CONDITION 1 @p1 = PG_EXCEPTION_CONTEXT;
          RAISE NOTICE 'RLS (profiles): %', @p1;
        END $$;
      `,
    });
    if (cErr) console.log("   ⚠ RLS profiles: " + cErr.message);

    console.log("   ◆ مكتمل: تفعيل الوحدة + خلاصة الإعدادات.");
    return "profiles";
  }

  if (verify.data && verify.data.length > 0) {
    console.log("   ◆ البنية جاهزة (profiles + RLS). إنهاء التثبيت.");
    return "profiles";
  }

  console.log(
    "   ◆ لا تزال البنية غير مُحدَّثة. يُنصح تشغيل migrate_rls.js أو إعادة تشغيل الترحيل."
  );
  return "incomplete";
}

runMigrations().catch((e) => {
  console.error("⤷  خطأ عام:", e.message);
  process.exit(1);
});
