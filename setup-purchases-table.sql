-- ============================================
-- إنشاء جدول المشتريات مع RLS
-- ============================================

-- إنشاء جدول المشتريات
CREATE TABLE IF NOT EXISTS purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    warehouse_id UUID REFERENCES auth.users(id),
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    price NUMERIC NOT NULL CHECK (price >= 0),
    discount NUMERIC DEFAULT 0 CHECK (discount >= 0 AND discount <= 100),
    total NUMERIC NOT NULL,
    supplier_name TEXT,
    production_date DATE,
    expiry_date DATE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- فهرس للبحث السريع
CREATE INDEX IF NOT EXISTS idx_purchases_warehouse ON purchases(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_purchases_product ON purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(created_at);

-- تفعيل RLS
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases FORCE ROW LEVEL SECURITY;

-- حذف السياسات القديمة
DROP POLICY IF EXISTS "purchases_select_warehouse" ON purchases;
DROP POLICY IF EXISTS "purchases_insert_warehouse" ON purchases;
DROP POLICY IF EXISTS "purchases_update_warehouse" ON purchases;
DROP POLICY IF EXISTS "purchases_delete_warehouse" ON purchases;

-- إنشاء سياسات RLS
CREATE POLICY "purchases_select_warehouse" ON purchases
    FOR SELECT
    USING (warehouse_id = auth.uid());

CREATE POLICY "purchases_insert_warehouse" ON purchases
    FOR INSERT
    WITH CHECK (warehouse_id = auth.uid());

CREATE POLICY "purchases_update_warehouse" ON purchases
    FOR UPDATE
    USING (warehouse_id = auth.uid());

CREATE POLICY "purchases_delete_warehouse" ON purchases
    FOR DELETE
    USING (warehouse_id = auth.uid());

-- تعيين القيمة الافتراضية
ALTER TABLE purchases 
ALTER COLUMN warehouse_id SET DEFAULT auth.uid();

-- إضافة للـ Realtime
BEGIN;
  ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS purchases;
  ALTER PUBLICATION supabase_realtime ADD TABLE purchases;
COMMIT;

-- ✅ نجاح
SELECT 'Purchases table created with RLS!' as result;
