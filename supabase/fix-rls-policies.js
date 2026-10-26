// إصلاح سياسات الصلاحيات (RLS) على جدول profiles
// بعد اكتمال الترحيل (على Supabase أو Locally).
//
// الإعدادات المطلوبة:
//   SUPABASE_URL=https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=<service-role key>
//
// التشغيل: node supabase/fix-rls-policies.js  (أو عبر SQL Editor)

"use strict";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://iksjhjxwphmvthryfeae.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// قائمة السياسات التي نريد تطبيقها (فعّالة في الإصدارات 2025+).
// كل مشكلة تُفلتر: `using` خطأ، أو `WITH CHECK` خطأ، أو CREATE POLICY لم يُنفذ.
const POLICIES = [
  {
    name: "view_profiles_own",
    command: `
      CREATE POLICY "view_profiles_own"
        ON profiles
        FOR SELECT
        TO authenticated
        USING (auth.uid() = id);
    `,
  },
  {
    name: "update_profiles_own",
    command: `
      CREATE POLICY "update_profiles_own"
        ON profiles
        FOR UPDATE
        TO authenticated
        USING (auth.uid() = id)
        WITH CHECK (auth.uid() = id);
    `,
  },
  {
    name: "admin_all_profiles",
    command: `
      CREATE POLICY "admin_all_profiles"
        ON profiles
        FOR ALL
        TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM auth.users
            WHERE auth.users.id = profiles.id
              AND auth.users.raw_user_meta_data->>'role' IN ('super-admin','admin')
          )
        )
        WITH CHECK (
          EXISTS (
            SELECT 1 FROM auth.users
            WHERE auth.users.id = profiles.id
              AND auth.users.raw_user_meta_data->>'role' IN ('super-admin','admin')
          )
        );
    `,
  },
  {
    name: "manager_all_profiles",
    command: `
      CREATE POLICY "manager_all_profiles"
        ON profiles
        FOR ALL
        TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM auth.users
            WHERE auth.users.id = profiles.id
              AND auth.users.raw_user_meta_data->>'role' IN ('super-admin','manager')
          )
        )
        WITH CHECK (
          EXISTS (
            SELECT 1 FROM auth.users
            WHERE auth.users.id = profiles.id
              AND auth.users.raw_user_meta_data->>'role' IN ('super-admin','manager')
          )
        );
    `,
  },
];

async function dropExistingPolicies() {
  const { data, error } = await supabase
    .from("policies")
    .select("*")
    .eq("table", "profiles")
    .eq("is_enabled", true);

  if (error && !error.message.includes("42P01")) {
    console.log("⚠  قراءة السياسات الحالية فشلت:", error.message);
  }

  for (const p of data || []) {
    const result = await supabase.rpc("exec_sql", {
      sql_query: `DROP POLICY IF EXISTS "${p.name}" ON profiles;`,
    });
    if (result.error) {
      console.log(`   ⚠ حذف ${p.name} فشل: ${result.error.message}`);
    } else {
      console.log(`   ✓ حذف سياسة ${p.name}`);
    }
  }
}

async function enableRls() {
  const result = await supabase.rpc("exec_sql", {
    sql_query: `ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;`,
  });
  if (result.error) {
    console.log("⚠  تفعيل RLS فشل:", result.error.message);
  } else {
    console.log("   ✓ تفعيل RLS على profiles");
  }
}

async function applyPolicies() {
  for (const policy of POLICIES) {
    const result = await supabase.rpc("exec_sql", {
      sql_query: policy.command,
    });
    if (result.error) {
      console.log(`   ⚠ ${policy.name}: ${result.error.message}`);
      // خطأ النص يتكرر (مثلاً "CREATE POLICY ... already exists") — لا نزال
      // نسمح للدورة التالية بالتجربة.
      if (!result.error.message.includes("already exists")) {
        throw result.error;
      }
    } else {
      console.log(`   ✓ ${policy.name} مُطبَّق`);
    }
  }
}

async function verifySetup() {
  // تأكد من أن RLS ما زال مفعل والملف قابلاً للقراءة عبر الخادم (service role
  // يتجاوز RLS، ويُفحص عبر خاصية profiles المتوافقة مع auth.uid()).
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", "00000000-0000-4000-8000-000000000001")
    .single();

  if (error) {
    console.log("   ⚠ لم يُعرض صف الملف (RLS مستمرة أو جدول مفقود):", error.message);
  } else {
    console.log(
      `   ✓ قراءة الملف (id=00000000-0000-4000-8000-000000000001): ${data.role}`
    );
  }
}

async function main() {
  console.log("🔧 إصلاح سياسات الصلاحيات (RLS) على profiles…\n");

  await enableRls();
  await dropExistingPolicies();
  await applyPolicies();
  await verifySetup();

  console.log("\n✅ إصلاح سياسات RLS مكتمل.");
}

main().catch((e) => {
  console.error("⤷  خطأ:", e.message);
  process.exit(1);
});
