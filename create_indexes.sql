-- إنشاء فهارس محسنة لجدول warehouses
-- لتحسين أداء البحث في الأعمدة المستخدمة بكثرة

-- إنشاء فهرس للبحث بالبريد الإلكتروني
CREATE INDEX IF NOT EXISTS idx_warehouses_email ON warehouses(email);

-- إنشاء فهرس للبحث برقم التليفون
CREATE INDEX IF NOT EXISTS idx_warehouses_phone ON warehouses(phone);

-- إنشاء فهرس مركب للبحث السريع
CREATE INDEX IF NOT EXISTS idx_warehouses_email_phone ON warehouses(email, phone);

-- إنشاء فهرس للمحافظة للتصفية السريعة
CREATE INDEX IF NOT EXISTS idx_warehouses_governorate ON warehouses(governorate);

-- إنشاء فهرس لاسم المخزن للبحث بالاسم
CREATE INDEX IF NOT EXISTS idx_warehouses_store_name ON warehouses(store_name);

-- إنشاء فهرس للتاريخ إذا كان موجود
CREATE INDEX IF NOT EXISTS idx_warehouses_created_at ON warehouses(created_at);

-- تحديث إحصائيات الجدول لتحسين الأداء
ANALYZE warehouses;

-- عرض الفهارس الموجودة
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'warehouses'
ORDER BY indexname;
