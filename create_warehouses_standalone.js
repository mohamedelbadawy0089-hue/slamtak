const { createClient } = require('@supabase/supabase-js');

// إعدادات الاتصال بـ Supabase - يجب تعديلها
const supabaseUrl = 'https://your-project-id.supabase.co';
const supabaseKey = 'your-anon-key';

// إنشاء عميل Supabase
const supabase = createClient(supabaseUrl, supabaseKey);

// SQL لإنشاء جدول warehouses مستقل
const createWarehousesTable = async () => {
  try {
    console.log('🚀 بدء إنشاء جدول warehouses مستقل في Supabase...');

    const createTableSQL = `
      -- إنشاء جدول المخازن المستقل
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

      -- تفعيل Row Level Security (RLS)
      ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

      -- سياسة للسماح بالإدخال والقراءة للمستخدمين المجهولين فقط
      DROP POLICY IF EXISTS "Enable warehouse access" ON warehouses;
      CREATE POLICY "Enable warehouse access" ON warehouses
        FOR INSERT, SELECT USING (true)
        WITH CHECK (true);

      -- منع التحديث والحذف
      DROP POLICY IF EXISTS "Prevent updates and deletes" ON warehouses;
      CREATE POLICY "Prevent updates and deletes" ON warehouses
        FOR UPDATE, DELETE USING (false)
        WITH CHECK (false);
    `;

    console.log('📝 إنشاء ملف SQL للتنفيذ اليدوي...');
    const fs = require('fs');
    
    fs.writeFileSync('warehouses_table_final.sql', createTableSQL);
    console.log('✅ تم إنشاء ملف warehouses_table_final.sql');

    console.log('📋 هيكل الجدول:');
    console.log('  - store_name: اسم المخزن (VARCHAR(255))');
    console.log('  - phone: رقم الهاتف (VARCHAR(11), UNIQUE, 11 رقم)');
    console.log('  - governorate: المحافظة (VARCHAR(100))');
    console.log('  - email: الإيميل (VARCHAR(255), UNIQUE, صيغة صحيحة)');
    console.log('  - password: كلمة المرور (VARCHAR(255))');
    console.log('  - confirm_password: تأكيد كلمة المرور (VARCHAR(255))');
    console.log('🔐 الصلاحيات: INSERT و SELECT فقط للمستخدمين المجهولين');

    return true;

  } catch (error) {
    console.error('❌ خطأ:', error);
    return false;
  }
};

// التنفيذ الرئيسي
const main = async () => {
  console.log('🗄️ إنشاء جدول warehouses مستقل لمشروع سلامتك');
  console.log('==========================================');
  
  await createWarehousesTable();
  
  console.log('\n📝 تعليمات التنفيذ:');
  console.log('1. اذهب إلى لوحة تحكم Supabase');
  console.log('2. اذهب إلى SQL Editor');
  console.log('3. انسخ والصق محتوى ملف warehouses_table_final.sql');
  console.log('4. اضغط Run لتنفيذ الكود');
  console.log('\n🔗 رابط Supabase: https://app.supabase.com');
  console.log('✨ انتهت عملية إنشاء الجدول!');
};

main().catch(console.error);
