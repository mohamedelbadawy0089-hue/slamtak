-- إعادة إنشاء الـ policies على جدول drugs
-- هذه الـ policies تسمح للمستخدمين بالوصول إلى بيانات مخزنهم فقط

-- تفعيل Row Level Security على جدول drugs
ALTER TABLE drugs ENABLE ROW LEVEL SECURITY;

-- حذف الـ policies القديمة إذا وجدت
DROP POLICY IF EXISTS "Users can view their own warehouse products" ON drugs;
DROP POLICY IF EXISTS "Users can insert their own warehouse products" ON drugs;
DROP POLICY IF EXISTS "Users can update their own warehouse products" ON drugs;
DROP POLICY IF EXISTS "Users can delete their own warehouse products" ON drugs;

-- Policy للقراءة: يمكن للمستخدمين رؤية الأدوية الخاصة بمخزنهم فقط
CREATE POLICY "Users can view their own warehouse products"
ON drugs FOR SELECT
USING (
    warehouse_id IN (
        SELECT id FROM warehouses
        WHERE email = auth.email()
    )
);

-- Policy للإدراج: يمكن للمستخدمين إضافة أدوية لمخزنهم فقط
CREATE POLICY "Users can insert their own warehouse products"
ON drugs FOR INSERT
WITH CHECK (
    warehouse_id IN (
        SELECT id FROM warehouses
        WHERE email = auth.email()
    )
);

-- Policy للتحديث: يمكن للمستخدمين تحديث أدوية مخزنهم فقط
CREATE POLICY "Users can update their own warehouse products"
ON drugs FOR UPDATE
USING (
    warehouse_id IN (
        SELECT id FROM warehouses
        WHERE email = auth.email()
    )
);

-- Policy للحذف: يمكن للمستخدمين حذف أدوية مخزنهم فقط
CREATE POLICY "Users can delete their own warehouse products"
ON drugs FOR DELETE
USING (
    warehouse_id IN (
        SELECT id FROM warehouses
        WHERE email = auth.email()
    )
);

-- Grant permissions
GRANT ALL ON drugs TO authenticated;
GRANT ALL ON drugs TO anon;
GRANT ALL ON drugs TO service_role;
