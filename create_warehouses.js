const { createClient } = require('@supabase/supabase-js');

// إعدادات الاتصال بـ Supabase
const supabaseUrl = 'https://your-project-id.supabase.co'; // ضع هنا رابط مشروعك
const supabaseKey = 'your-anon-key'; // ضع هنا مفتاح API

// إنشاء عميل Supabase
const supabase = createClient(supabaseUrl, supabaseKey);

// SQL لإنشاء جدول warehouses مع السياسات
const createWarehousesTable = async () => {
  try {
    console.log('🚀 بدء إنشاء جدول warehouses في Supabase...');

    // SQL لإنشاء الجدول
    const createTableSQL = `
      -- إنشاء جدول المخازن
      CREATE TABLE IF NOT EXISTS warehouses (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        store_name VARCHAR(255) NOT NULL,
        phone VARCHAR(11) UNIQUE NOT NULL CHECK (phone ~ '^[0-9]{11}$'),
        governorate VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
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

      -- سياسة للسماح بالوصول الكامل للمستخدمين المجهولين (anon)
      DROP POLICY IF EXISTS "Enable anonymous access" ON warehouses;
      CREATE POLICY "Enable anonymous access" ON warehouses
        FOR ALL USING (true)
        WITH CHECK (true);

      -- سياسة للسماح للمستخدمين المصادق عليهم بالوصول الكامل
      DROP POLICY IF EXISTS "Enable authenticated access" ON warehouses;
      CREATE POLICY "Enable authenticated access" ON warehouses
        FOR ALL USING (auth.role() = 'authenticated')
        WITH CHECK (auth.role() = 'authenticated');
    `;

    // تنفيذ SQL باستخدام RPC
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: createTableSQL });

    if (error) {
      console.error('❌ خطأ في تنفيذ SQL:', error);
      return false;
    }

    console.log('✅ تم إنشاء جدول warehouses بنجاح!');
    console.log('📋 هيكل الجدول:');
    console.log('  - store_name: اسم المخزن (VARCHAR(255))');
    console.log('  - phone: رقم الهاتف (VARCHAR(11), UNIQUE, 11 رقم)');
    console.log('  - governorate: المحافظة (VARCHAR(100))');
    console.log('  - email: الإيميل (VARCHAR(255), UNIQUE, صيغة صحيحة)');
    console.log('  - password: كلمة المرور (VARCHAR(255))');
    console.log('  - confirm_password: تأكيد كلمة المرور (VARCHAR(255))');
    console.log('🔐 تم تفعيل RLS مع سياسات الوصول الكامل للمستخدمين المجهولين والمصادق عليهم');

    return true;

  } catch (error) {
    console.error('❌ خطأ غير متوقع:', error);
    return false;
  }
};

// دالة بديلة باستخدام SQL مباشر إذا لم يعمل RPC
const createTableDirectly = async () => {
  try {
    console.log('🔄 محاولة إنشاء الجدول باستخدام SQL مباشر...');

    // استخدام SQL مباشر عبر REST API
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey
      },
      body: JSON.stringify({
        sql: `
          CREATE TABLE IF NOT EXISTS warehouses (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            store_name VARCHAR(255) NOT NULL,
            phone VARCHAR(11) UNIQUE NOT NULL CHECK (phone ~ '^[0-9]{11}$'),
            governorate VARCHAR(100) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
            password VARCHAR(255) NOT NULL,
            confirm_password VARCHAR(255) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
          
          ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
          
          DROP POLICY IF EXISTS "Enable anonymous access" ON warehouses;
          CREATE POLICY "Enable anonymous access" ON warehouses FOR ALL USING (true) WITH CHECK (true);
        `
      })
    });

    if (response.ok) {
      console.log('✅ تم إنشاء جدول warehouses بنجاح باستخدام SQL مباشر!');
      return true;
    } else {
      console.log('⚠️ فشل SQL المباشر، جاري إنشاء ملف SQL للتنفيذ اليدوي...');
      return false;
    }

  } catch (error) {
    console.error('❌ خطأ في SQL المباشر:', error);
    return false;
  }
};

// إنشاء ملف SQL للتنفيذ اليدوي
const createSQLFile = () => {
  const fs = require('fs');
  
  const sqlContent = `
-- إنشاء جدول المخازن في Supabase
-- قم بتنفيذ هذا الكود في لوحة تحكم Supabase

CREATE TABLE IF NOT EXISTS warehouses (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    store_name VARCHAR(255) NOT NULL,
    phone VARCHAR(11) UNIQUE NOT NULL CHECK (phone ~ '^[0-9]{11}$'),
    governorate VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
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

-- سياسة للسماح بالوصول الكامل للمستخدمين المجهولين (anon)
DROP POLICY IF EXISTS "Enable anonymous access" ON warehouses;
CREATE POLICY "Enable anonymous access" ON warehouses
    FOR ALL USING (true)
    WITH CHECK (true);

-- سياسة للسماح للمستخدمين المصادق عليهم بالوصول الكامل
DROP POLICY IF EXISTS "Enable authenticated access" ON warehouses;
CREATE POLICY "Enable authenticated access" ON warehouses
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- التحقق من إنشاء الجدول
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'warehouses'
ORDER BY ordinal_position;
`;

  fs.writeFileSync('create_warehouses_table.sql', sqlContent);
  console.log('📄 تم إنشاء ملف create_warehouses_table.sql للتنفيذ اليدوي');
};

// التنفيذ الرئيسي
const main = async () => {
  console.log('🗄️ إنشاء جدول warehouses في Supabase لمشروع سلامتك');
  console.log('=====================================');

  // محاولة الإنشاء المباشر
  const success = await createWarehousesTable();
  
  if (!success) {
    // محاولة SQL مباشر
    const directSuccess = await createTableDirectly();
    
    if (!directSuccess) {
      // إنشاء ملف SQL للتنفيذ اليدوي
      createSQLFile();
      
      console.log('\n📝 تعليمات التنفيذ اليدوي:');
      console.log('1. اذهب إلى لوحة تحكم Supabase');
      console.log('2. اذهب إلى SQL Editor');
      console.log('3. انسخ والصق محتوى ملف create_warehouses_table.sql');
      console.log('4. اضغط Run لتنفيذ الكود');
      console.log('\n🔗 رابط Supabase: https://app.supabase.com');
    }
  }

  console.log('\n✨ انتهت عملية إنشاء الجدول!');
};

// تشغيل السكربت
main().catch(console.error);
