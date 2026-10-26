
      -- إنشاء جدول المخازن المستقل
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
    