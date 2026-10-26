const { createClient } = require('@supabase/supabase-js');

// إعدادات الاتصال بـ Supabase
const supabaseUrl = 'https://your-project-id.supabase.co';
const supabaseKey = 'your-anon-key';

// إنشاء عميل Supabase
const supabase = createClient(supabaseUrl, supabaseKey);

// نسخ جدول warehouses بنفس صلاحيات جدول المنتجات
const copyWarehousesTable = async () => {
  try {
    console.log('🚀 بدء نسخ جدول warehouses بنفس صلاحيات جدول المنتجات...');

    // SQL لإنشاء جدول warehouses بنفس صلاحية pharmacy_products
    const copyTableSQL = `
      -- إنشاء جدول المخازن بنفس صلاحية جدول المنتجات
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

      -- سياسة للسماح بالوصول الكامل للمستخدمين المجهولين (مثل جدول pharmacy_products)
      DROP POLICY IF EXISTS "Enable anonymous access" ON warehouses;
      CREATE POLICY "Enable anonymous access" ON warehouses
        FOR ALL USING (true)
        WITH CHECK (true);

      -- سياسة للسماح للمستخدمين المصادق عليهم بالوصول الكامل
      DROP POLICY IF EXISTS "Enable authenticated access" ON warehouses;
      CREATE POLICY "Enable authenticated access" ON warehouses
        FOR ALL USING (auth.role() = 'authenticated')
        WITH CHECK (auth.role() = 'authenticated');

      -- التحقق من إنشاء الجدول والسياسات
      SELECT 
        schemaname,
        tablename,
        tableowner,
        hasindexes,
        hasrules,
        hastriggers
      FROM pg_tables 
      WHERE tablename = 'warehouses';

      -- التحقق من السياسات المفعلة
      SELECT 
        schemaname,
        tablename,
        policyname,
        permissive,
        roles,
        cmd,
        qual
      FROM pg_policies 
      WHERE tablename = 'warehouses';
    `;

    console.log('📝 إنشاء ملف SQL للتنفيذ اليدوي...');
    const fs = require('fs');
    
    fs.writeFileSync('warehouses_copy_final.sql', copyTableSQL);
    console.log('✅ تم إنشاء ملف warehouses_copy_final.sql');

    console.log('📋 هيكل جدول warehouses:');
    console.log('  - store_name: اسم المخزن (VARCHAR(255))');
    console.log('  - phone: رقم الهاتف (VARCHAR(11), UNIQUE, 11 رقم)');
    console.log('  - governorate: المحافظة (VARCHAR(100))');
    console.log('  - email: الإيميل (VARCHAR(255), UNIQUE, صيغة صحيحة)');
    console.log('  - password: كلمة المرور (VARCHAR(255))');
    console.log('  - confirm_password: تأكيد كلمة المرور (VARCHAR(255))');
    console.log('🔐 الصلاحيات: نفس صلاحية جدول pharmacy_products (وصول كامل للمستخدمين المجهولين والمصادق عليهم)');

    return true;

  } catch (error) {
    console.error('❌ خطأ:', error);
    return false;
  }
};

// التنفيذ الرئيسي
const main = async () => {
  console.log('🗄️ نسخ جدول warehouses بنفس صلاحيات جدول المنتجات');
  console.log('====================================================');
  
  await copyWarehousesTable();
  
  console.log('\n📝 تعليمات التنفيذ:');
  console.log('1. اذهب إلى لوحة تحكم Supabase');
  console.log('2. اذهب إلى SQL Editor');
  console.log('3. انسخ والصق محتوى ملف warehouses_copy_final.sql');
  console.log('4. اضغط Run لتنفيذ الكود');
  console.log('\n🔗 رابط Supabase: https://app.supabase.com');
  console.log('✨ انتهت عملية نسخ الجدول!');
};

main().catch(console.error);
