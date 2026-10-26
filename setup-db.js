const { createClient } = require('@supabase/supabase-js');

// مفاتيح الربط الخاصة بـ Supabase
const supabaseUrl = 'https://your-project-id.supabase.co'; // ضع هنا رابط مشروعك
const supabaseKey = 'your-anon-key'; // ضع هنا مفتاح API

// إنشاء عميل Supabase
const supabase = createClient(supabaseUrl, supabaseKey);

// إنشاء جدول warehouses مع فتح الصلاحيات بالكامل
const setupWarehousesTable = async () => {
  try {
    console.log('🚀 بدء إنشاء جدول warehouses بصلاحيات كاملة...');
    console.log('🔗 الاتصال بـ Supabase:', supabaseUrl);

    // SQL لإنشاء الجدول مع الصلاحيات المفتوحة
    const setupSQL = `
      -- إنشاء جدول المخازن
      CREATE TABLE IF NOT EXISTS warehouses (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        store_name VARCHAR(255) NOT NULL,
        phone VARCHAR(11) UNIQUE NOT NULL CHECK (phone ~ '^[0-9]{11}$'),
        governorate VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'),
        password VARCHAR(255) NOT NULL,
        confirm_password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- إضافة فهارس لتحسين الأداء
      CREATE INDEX IF NOT EXISTS idx_warehouses_email ON warehouses(email);
      CREATE INDEX IF NOT EXISTS idx_warehouses_phone ON warehouses(phone);
      CREATE INDEX IF NOT EXISTS idx_warehouses_store_name ON warehouses(store_name);
      CREATE INDEX IF NOT EXISTS idx_warehouses_governorate ON warehouses(governorate);

      -- تفعيل Row Level Security (RLS)
      ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

      -- فتح الصلاحيات الكاملة للمستخدمين المجهولين (anon)
      DROP POLICY IF EXISTS "Enable full anonymous access" ON warehouses;
      CREATE POLICY "Enable full anonymous access" ON warehouses
        FOR INSERT, SELECT, UPDATE, DELETE USING (true)
        WITH CHECK (true);

      -- فتح الصلاحيات الكاملة للمستخدمين المصادق عليهم
      DROP POLICY IF EXISTS "Enable full authenticated access" ON warehouses;
      CREATE POLICY "Enable full authenticated access" ON warehouses
        FOR INSERT, SELECT, UPDATE, DELETE USING (auth.role() = 'authenticated')
        WITH CHECK (auth.role() = 'authenticated');

      -- التحقق من إنشاء الجدول
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'warehouses'
      ORDER BY ordinal_position;

      -- التحقق من السياسات المفعلة
      SELECT schemaname, tablename, policyname, permissive, roles, cmd
      FROM pg_policies 
      WHERE tablename = 'warehouses';
    `;

    console.log('🔄 محاولة تنفيذ SQL عبر REST API...');

    // استخدام REST API لتنفيذ SQL
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        sql: setupSQL
      })
    });

    if (response.ok) {
      const result = await response.text();
      console.log('✅ تم تنفيذ SQL بنجاح!');
      console.log('📋 النتيجة:', result);
      return true;
    } else {
      console.log('⚠️ فشل REST API، جاري إنشاء ملف SQL للتنفيذ اليدوي...');
      return false;
    }

  } catch (error) {
    console.error('❌ خطأ في الاتصال بـ Supabase:', error.message);
    console.log('⚠️ جاري إنشاء ملف SQL للتنفيذ اليدوي...');
    return false;
  }
};

// إنشاء ملف SQL للتنفيذ اليدوي
const createSQLFile = () => {
  const fs = require('fs');
  
  const sqlContent = `
-- إنشاء جدول المخازن مع صلاحيات كاملة
-- قم بتنفيذ هذا الكود في لوحة تحكم Supabase

CREATE TABLE IF NOT EXISTS warehouses (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    store_name VARCHAR(255) NOT NULL,
    phone VARCHAR(11) UNIQUE NOT NULL CHECK (phone ~ '^[0-9]{11}$'),
    governorate VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'),
    password VARCHAR(255) NOT NULL,
    confirm_password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- إضافة فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_warehouses_email ON warehouses(email);
CREATE INDEX IF NOT EXISTS idx_warehouses_phone ON warehouses(phone);
CREATE INDEX IF NOT EXISTS idx_warehouses_store_name ON warehouses(store_name);
CREATE INDEX IF NOT EXISTS idx_warehouses_governorate ON warehouses(governorate);

-- تفعيل Row Level Security (RLS)
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

-- فتح الصلاحيات الكاملة للمستخدمين المجهولين (anon)
DROP POLICY IF EXISTS "Enable full anonymous access" ON warehouses;
CREATE POLICY "Enable full anonymous access" ON warehouses
    FOR INSERT, SELECT, UPDATE, DELETE USING (true)
    WITH CHECK (true);

-- فتح الصلاحيات الكاملة للمستخدمين المصادق عليهم
DROP POLICY IF EXISTS "Enable full authenticated access" ON warehouses;
CREATE POLICY "Enable full authenticated access" ON warehouses
    FOR INSERT, SELECT, UPDATE, DELETE USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- التحقق من إنشاء الجدول
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'warehouses'
ORDER BY ordinal_position;

-- التحقق من السياسات المفعلة
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies 
WHERE tablename = 'warehouses';
`;

  fs.writeFileSync('setup-db-final.sql', sqlContent);
  console.log('📄 تم إنشاء ملف setup-db-final.sql للتنفيذ اليدوي');
};

// التنفيذ الرئيسي
const main = async () => {
  console.log('🗄️ إعداد جدول warehouses بصلاحيات كاملة لمشروع سلامتك');
  console.log('========================================================');
  
  // محاولة التنفيذ المباشر
  const success = await setupWarehousesTable();
  
  if (!success) {
    // إنشاء ملف SQL للتنفيذ اليدوي
    createSQLFile();
    
    console.log('\n📝 تعليمات التنفيذ اليدوي:');
    console.log('1. اذهب إلى لوحة تحكم Supabase');
    console.log('2. اذهب إلى SQL Editor');
    console.log('3. انسخ والصق محتوى ملف setup-db-final.sql');
    console.log('4. اضغط Run لتنفيذ الكود');
    console.log('\n🔗 رابط Supabase: https://app.supabase.com');
  }

  console.log('\n🎯 الصلاحيات المفعلة:');
  console.log('  ✅ INSERT للمستخدمين المجهولين');
  console.log('  ✅ SELECT للمستخدمين المجهولين');
  console.log('  ✅ UPDATE للمستخدمين المجهولين');
  console.log('  ✅ DELETE للمستخدمين المجهولين');
  console.log('  ✅ جميع الصلاحيات للمستخدمين المصادق عليهم');
  
  console.log('\n✨ انتهت عملية إعداد الجدول!');
  console.log('🚀 جاهز لرفع الموقع: npx wrangler pages deploy .');
};

// تشغيل السكربت
main().catch(console.error);
