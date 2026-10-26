-- إنشاء جداول منتجاتي مخزني الخاص
-- Created: 2026-05-11

-- جدول المنتجات المخصصة (الجدول الرئيسي للمنتجات)
CREATE TABLE IF NOT EXISTS warehouse_custom_products (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    warehouse_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- بيانات المنتج الأساسية
    name_en TEXT NOT NULL,
    name_ar TEXT,
    batch_number TEXT,
    quantity INTEGER DEFAULT 0,
    price DECIMAL(10,2) DEFAULT 0.00,
    discount DECIMAL(5,2) DEFAULT 0.00,
    
    -- التواريخ الهامة
    production_date DATE,
    expiry_date DATE,
    purchase_date DATE,
    
    -- التصنيف
    category TEXT DEFAULT 'مخصص',
    
    -- بيانات المورد
    supplier_name TEXT,
    supplier_phone TEXT,
    supplier_address TEXT,
    invoice_number TEXT,
    
    -- التحكم والصلاحيات
    is_permanent BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    
    -- التتبع الزمني
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- جدول فئات المنتجات (لتحسين تنظيم المنتجات)
CREATE TABLE IF NOT EXISTS product_categories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    warehouse_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#6366f1',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- جدول المخزون (لتتبع حركة المخزون)
CREATE TABLE IF NOT EXISTS inventory_movements (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    warehouse_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES warehouse_custom_products(id) ON DELETE CASCADE,
    
    -- نوع الحركة
    movement_type TEXT NOT NULL CHECK (movement_type IN ('purchase', 'sale', 'adjustment', 'return')),
    
    -- البيانات
    quantity_before INTEGER NOT NULL,
    quantity_change INTEGER NOT NULL,
    quantity_after INTEGER NOT NULL,
    unit_price DECIMAL(10,2),
    total_amount DECIMAL(10,2),
    
    -- المراجع
    reference_type TEXT, -- 'purchase_invoice', 'sale', 'manual_adjustment'
    reference_id TEXT,
    
    -- الملاحظات
    notes TEXT,
    
    -- التوقيت
    movement_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- جدول تنبيهات انتهاء الصلاحية
CREATE TABLE IF NOT EXISTS expiry_alerts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    warehouse_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES warehouse_custom_products(id) ON DELETE CASCADE,
    
    -- بيانات التنبيه
    days_until_expiry INTEGER NOT NULL,
    alert_type TEXT NOT NULL CHECK (alert_type IN ('expired', 'expiring_soon', 'warning')),
    
    -- الحالة
    is_read BOOLEAN DEFAULT false,
    is_dismissed BOOLEAN DEFAULT false,
    
    -- التوقيت
    alert_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expiry_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- جدول إعدادات المخزن (لإعدادات المستخدم)
CREATE TABLE IF NOT EXISTS warehouse_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    warehouse_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- إعدادات التنبيهات
    expiry_warning_days INTEGER DEFAULT 30,
    low_stock_threshold INTEGER DEFAULT 10,
    
    -- إعدادات العرض
    default_currency TEXT DEFAULT 'ج.م',
    date_format TEXT DEFAULT 'DD/MM/YYYY',
    
    -- إعدادات التقارير
    include_expired_in_reports BOOLEAN DEFAULT false,
    show_zero_quantity BOOLEAN DEFAULT true,
    
    -- التوقيت
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- إنشاء فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_warehouse_custom_products_warehouse_id ON warehouse_custom_products(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_custom_products_name_en ON warehouse_custom_products(name_en);
CREATE INDEX IF NOT EXISTS idx_warehouse_custom_products_batch_number ON warehouse_custom_products(batch_number);
CREATE INDEX IF NOT EXISTS idx_warehouse_custom_products_category ON warehouse_custom_products(category);
CREATE INDEX IF NOT EXISTS idx_warehouse_custom_products_is_permanent ON warehouse_custom_products(is_permanent);
CREATE INDEX IF NOT EXISTS idx_warehouse_custom_products_is_active ON warehouse_custom_products(is_active);
CREATE INDEX IF NOT EXISTS idx_warehouse_custom_products_expiry_date ON warehouse_custom_products(expiry_date);

CREATE INDEX IF NOT EXISTS idx_product_categories_warehouse_id ON product_categories(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_name ON product_categories(name);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_warehouse_id ON inventory_movements(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_id ON inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_movement_type ON inventory_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_movement_date ON inventory_movements(movement_date);

CREATE INDEX IF NOT EXISTS idx_expiry_alerts_warehouse_id ON expiry_alerts(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_expiry_alerts_product_id ON expiry_alerts(product_id);
CREATE INDEX IF NOT EXISTS idx_expiry_alerts_alert_type ON expiry_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_expiry_alerts_is_read ON expiry_alerts(is_read);
CREATE INDEX IF NOT EXISTS idx_expiry_alerts_expiry_date ON expiry_alerts(expiry_date);

CREATE INDEX IF NOT EXISTS idx_warehouse_settings_warehouse_id ON warehouse_settings(warehouse_id);

-- تفعيل Row Level Security
ALTER TABLE warehouse_custom_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE expiry_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_settings ENABLE ROW LEVEL SECURITY;

-- سياسات الأمان للمنتجات المخصصة
CREATE POLICY "Users can view their own products" ON warehouse_custom_products
    FOR SELECT USING (auth.uid() = warehouse_id);

CREATE POLICY "Users can insert their own products" ON warehouse_custom_products
    FOR INSERT WITH CHECK (auth.uid() = warehouse_id);

CREATE POLICY "Users can update their own products" ON warehouse_custom_products
    FOR UPDATE USING (auth.uid() = warehouse_id);

CREATE POLICY "Users can delete their own products" ON warehouse_custom_products
    FOR DELETE USING (auth.uid() = warehouse_id);

-- سياسات الأمان لفئات المنتجات
CREATE POLICY "Users can view their own categories" ON product_categories
    FOR SELECT USING (auth.uid() = warehouse_id);

CREATE POLICY "Users can insert their own categories" ON product_categories
    FOR INSERT WITH CHECK (auth.uid() = warehouse_id);

CREATE POLICY "Users can update their own categories" ON product_categories
    FOR UPDATE USING (auth.uid() = warehouse_id);

CREATE POLICY "Users can delete their own categories" ON product_categories
    FOR DELETE USING (auth.uid() = warehouse_id);

-- سياسات الأمان لحركة المخزون
CREATE POLICY "Users can view their own inventory movements" ON inventory_movements
    FOR SELECT USING (auth.uid() = warehouse_id);

CREATE POLICY "Users can insert their own inventory movements" ON inventory_movements
    FOR INSERT WITH CHECK (auth.uid() = warehouse_id);

CREATE POLICY "Users can update their own inventory movements" ON inventory_movements
    FOR UPDATE USING (auth.uid() = warehouse_id);

CREATE POLICY "Users can delete their own inventory movements" ON inventory_movements
    FOR DELETE USING (auth.uid() = warehouse_id);

-- سياسات الأمان لتنبيهات انتهاء الصلاحية
CREATE POLICY "Users can view their own expiry alerts" ON expiry_alerts
    FOR SELECT USING (auth.uid() = warehouse_id);

CREATE POLICY "Users can insert their own expiry alerts" ON expiry_alerts
    FOR INSERT WITH CHECK (auth.uid() = warehouse_id);

CREATE POLICY "Users can update their own expiry alerts" ON expiry_alerts
    FOR UPDATE USING (auth.uid() = warehouse_id);

CREATE POLICY "Users can delete their own expiry alerts" ON expiry_alerts
    FOR DELETE USING (auth.uid() = warehouse_id);

-- سياسات الأمان لإعدادات المخزن
CREATE POLICY "Users can view their own settings" ON warehouse_settings
    FOR SELECT USING (auth.uid() = warehouse_id);

CREATE POLICY "Users can insert their own settings" ON warehouse_settings
    FOR INSERT WITH CHECK (auth.uid() = warehouse_id);

CREATE POLICY "Users can update their own settings" ON warehouse_settings
    FOR UPDATE USING (auth.uid() = warehouse_id);

CREATE POLICY "Users can delete their own settings" ON warehouse_settings
    FOR DELETE USING (auth.uid() = warehouse_id);

-- إنشاء دوال مساعدة
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- إنشاء دوال لحركة المخزون
CREATE OR REPLACE FUNCTION record_inventory_movement(
    p_warehouse_id UUID,
    p_product_id UUID,
    p_movement_type TEXT,
    p_quantity_change INTEGER,
    p_unit_price DECIMAL(10,2) DEFAULT NULL,
    p_reference_type TEXT DEFAULT NULL,
    p_reference_id TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    v_current_quantity INTEGER;
    v_new_quantity INTEGER;
BEGIN
    -- الحصول على الكمية الحالية
    SELECT quantity INTO v_current_quantity
    FROM warehouse_custom_products
    WHERE id = p_product_id AND warehouse_id = p_warehouse_id;
    
    IF v_current_quantity IS NULL THEN
        RAISE EXCEPTION 'Product not found or access denied';
    END IF;
    
    -- حساب الكمية الجديدة
    v_new_quantity := v_current_quantity + p_quantity_change;
    
    -- التحقق من الكمية الجديدة
    IF v_new_quantity < 0 THEN
        RAISE EXCEPTION 'Insufficient stock';
    END IF;
    
    -- تحديث كمية المنتج
    UPDATE warehouse_custom_products
    SET quantity = v_new_quantity,
        updated_at = NOW()
    WHERE id = p_product_id AND warehouse_id = p_warehouse_id;
    
    -- تسجيل الحركة
    INSERT INTO inventory_movements (
        warehouse_id,
        product_id,
        movement_type,
        quantity_before,
        quantity_change,
        quantity_after,
        unit_price,
        total_amount,
        reference_type,
        reference_id,
        notes
    ) VALUES (
        p_warehouse_id,
        p_product_id,
        p_movement_type,
        v_current_quantity,
        p_quantity_change,
        v_new_quantity,
        p_unit_price,
        CASE 
            WHEN p_unit_price IS NOT NULL THEN p_unit_price * ABS(p_quantity_change)
            ELSE NULL
        END,
        p_reference_type,
        p_reference_id,
        p_notes
    );
END;
$$ LANGUAGE plpgsql;

-- إنشاء دوال للتنبيهات
CREATE OR REPLACE FUNCTION check_expiry_alerts()
RETURNS VOID AS $$
DECLARE
    v_products RECORD;
    v_days_until_expiry INTEGER;
    v_alert_type TEXT;
BEGIN
    -- التحقق من جميع المنتجات القريبة من الانتهاء
    FOR v_products IN 
        SELECT 
            id,
            warehouse_id,
            expiry_date
        FROM warehouse_custom_products
        WHERE expiry_date IS NOT NULL 
        AND is_active = true
    LOOP
        -- حساب الأيام المتبقية
        v_days_until_expiry := EXTRACT(DAYS FROM (v_products.expiry_date - CURRENT_DATE));
        
        -- تحديد نوع التنبيه
        IF v_days_until_expiry < 0 THEN
            v_alert_type := 'expired';
        ELSIF v_days_until_expiry <= 30 THEN
            v_alert_type := 'expiring_soon';
        ELSIF v_days_until_expiry <= 60 THEN
            v_alert_type := 'warning';
        ELSE
            CONTINUE;
        END IF;
        
        -- إضافة تنبيه جديد إذا لم يكن موجوداً
        INSERT INTO expiry_alerts (
            warehouse_id,
            product_id,
            days_until_expiry,
            alert_type,
            expiry_date
        ) VALUES (
            v_products.warehouse_id,
            v_products.id,
            v_days_until_expiry,
            v_alert_type,
            v_products.expiry_date
        )
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- إنشاء triggers
CREATE TRIGGER update_warehouse_custom_products_updated_at
    BEFORE UPDATE ON warehouse_custom_products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_warehouse_settings_updated_at
    BEFORE UPDATE ON warehouse_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- إضافة قيود للتحقق من البيانات
ALTER TABLE warehouse_custom_products 
    ADD CONSTRAINT check_quantity_positive CHECK (quantity >= 0),
    ADD CONSTRAINT check_price_positive CHECK (price >= 0),
    ADD CONSTRAINT check_discount_range CHECK (discount >= 0 AND discount <= 100);

ALTER TABLE inventory_movements 
    ADD CONSTRAINT check_movement_date_valid CHECK (movement_date <= NOW()),
    ADD CONSTRAINT check_quantity_after_positive CHECK (quantity_after >= 0);

ALTER TABLE expiry_alerts 
    ADD CONSTRAINT check_days_until_expiry_valid CHECK (days_until_expiry <= 365),
    ADD CONSTRAINT check_alert_date_valid CHECK (alert_date <= NOW());

ALTER TABLE warehouse_settings 
    ADD CONSTRAINT check_warning_days_positive CHECK (expiry_warning_days > 0),
    ADD CONSTRAINT check_low_stock_threshold_positive CHECK (low_stock_threshold >= 0);

-- إضافة تعليقات توضيحية
COMMENT ON TABLE warehouse_custom_products IS 'جدول المنتجات المخصصة للمخزن الخاص';
COMMENT ON TABLE product_categories IS 'جدول فئات المنتجات';
COMMENT ON TABLE inventory_movements IS 'جدول حركة المخزون';
COMMENT ON TABLE expiry_alerts IS 'جدول تنبيهات انتهاء الصلاحية';
COMMENT ON TABLE warehouse_settings IS 'جدول إعدادات المخزن';

COMMENT ON FUNCTION record_inventory_movement IS 'دالة لتسجيل حركة المخزون';
COMMENT ON FUNCTION check_expiry_alerts IS 'دالة للتحقق من تنبيهات انتهاء الصلاحية';

-- إنشاء فئات افتراضية
INSERT INTO product_categories (warehouse_id, name, description, color) VALUES
('00000000-0000-0000-0000-000000000000', 'مخصص', 'منتجات مخصصة', '#6366f1'),
('00000000-0000-0000-0000-000000000000', 'دواء', 'أدوية ومستحضرات طبية', '#ef4444'),
('00000000-0000-0000-0000-000000000000', 'مكمل غذائي', 'مكملات غذائية وفيتامينات', '#10b981'),
('00000000-0000-0000-0000-000000000000', 'مستلزمات طبية', 'مستلزمات طبية وتجهيزات', '#f59e0b'),
('00000000-0000-0000-0000-000000000000', 'أخرى', 'منتجات أخرى', '#6b7280')
ON CONFLICT DO NOTHING;

-- إنشاء إعدادات افتراضية
INSERT INTO warehouse_settings (warehouse_id, expiry_warning_days, low_stock_threshold) VALUES
('00000000-0000-0000-0000-000000000000', 30, 10)
ON CONFLICT DO NOTHING;
