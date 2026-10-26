-- إنشاء جدول drugs في Supabase
-- هذا الجدول سيحتوي على معلومات الأدوية لكل مخزن

CREATE TABLE IF NOT EXISTS drugs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    warehouse_id UUID NOT NULL,
    batch_number VARCHAR(255) NOT NULL,
    trade_name VARCHAR(255) NOT NULL,
    public_price DECIMAL(10, 2),
    net_price DECIMAL(10, 2),
    production_date DATE,
    expiry_date DATE,
    quantity INTEGER DEFAULT 0,
    purchase_discount DECIMAL(5, 2) DEFAULT 0,
    sales_discount DECIMAL(5, 2) DEFAULT 0,
    category VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- إنشاء Indexes لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_drugs_warehouse_id ON drugs(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_drugs_batch_number ON drugs(batch_number);
CREATE INDEX IF NOT EXISTS idx_drugs_trade_name ON drugs(trade_name);
CREATE INDEX IF NOT EXISTS idx_drugs_expiry_date ON drugs(expiry_date);

-- إنشاء Trigger لتحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION update_drugs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_drugs_updated_at_trigger ON drugs;
CREATE TRIGGER update_drugs_updated_at_trigger
BEFORE UPDATE ON drugs
FOR EACH ROW
EXECUTE FUNCTION update_drugs_updated_at();

-- Grant permissions
GRANT ALL ON drugs TO authenticated;
GRANT ALL ON drugs TO anon;
GRANT ALL ON drugs TO service_role;
