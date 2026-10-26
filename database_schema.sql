-- جدول المستخدمين
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- جدول المخازن (Warehouses)
CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    warehouse_name VARCHAR(255) NOT NULL,
    warehouse_code VARCHAR(50) UNIQUE,
    description TEXT,
    language VARCHAR(10) DEFAULT 'ar', -- 'ar' للعربية، 'en' للإنجليزية
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- إضافة الأعمدة المفقودة للجداول الموجودة
DO $$
BEGIN
    -- إضافة warehouse_code
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'warehouses'
        AND column_name = 'warehouse_code'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN warehouse_code VARCHAR(50) UNIQUE;
        RAISE NOTICE 'Added warehouse_code column to warehouses table';
    END IF;

    -- إضافة description
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'warehouses'
        AND column_name = 'description'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN description TEXT;
        RAISE NOTICE 'Added description column to warehouses table';
    END IF;

    -- إضافة language
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'warehouses'
        AND column_name = 'language'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN language VARCHAR(10) DEFAULT 'ar';
        RAISE NOTICE 'Added language column to warehouses table';
    END IF;

    -- إضافة settings
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'warehouses'
        AND column_name = 'settings'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN settings JSONB DEFAULT '{}';
        RAISE NOTICE 'Added settings column to warehouses table';
    END IF;

    -- إضافة created_at
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'warehouses'
        AND column_name = 'created_at'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        RAISE NOTICE 'Added created_at column to warehouses table';
    END IF;

    -- إضافة updated_at
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'warehouses'
        AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        RAISE NOTICE 'Added updated_at column to warehouses table';
    END IF;
END $$;

-- جدول المنتجات المرن (Warehouse Products Flexible)
-- يدعم أي أعمدة أو لغات بصيغة JSONB
CREATE TABLE IF NOT EXISTS warehouse_products_flexible (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    product_data JSONB NOT NULL, -- البيانات المرنة: أي أعمدة، أي لغة
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- فهارس للبحث السريع
CREATE INDEX IF NOT EXISTS idx_warehouses_user_id ON warehouses(user_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_code ON warehouses(warehouse_code);

CREATE INDEX IF NOT EXISTS idx_warehouse_products_warehouse_id ON warehouse_products_flexible(warehouse_id);

-- فهارس تعبيرية على JSONB للبحث السريع
CREATE INDEX IF NOT EXISTS idx_warehouse_products_trade_name ON warehouse_products_flexible((product_data->>'trade_name'));
CREATE INDEX IF NOT EXISTS idx_warehouse_products_batch_number ON warehouse_products_flexible((product_data->>'batch_number'));
CREATE INDEX IF NOT EXISTS idx_warehouse_products_expiry_date ON warehouse_products_flexible((product_data->>'expiry_date'));

-- فهرس GIN للبحث داخل JSONB
CREATE INDEX IF NOT EXISTS idx_warehouse_products_product_data_gin ON warehouse_products_flexible USING GIN (product_data);

-- جدول الإعدادات العامة
CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(255) UNIQUE NOT NULL,
    value TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- دالة لتحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- تفعيل التريجر لتحديث updated_at
CREATE TRIGGER update_warehouses_updated_at BEFORE UPDATE ON warehouses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_warehouse_products_updated_at BEFORE UPDATE ON warehouse_products_flexible
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- سياسات الأمان (Row Level Security - RLS)
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_products_flexible ENABLE ROW LEVEL SECURITY;

-- سياسة: المستخدم يمكنه رؤية مخازنه فقط
CREATE POLICY "Users can view their own warehouses"
    ON warehouses FOR SELECT
    USING (auth.uid() = user_id);

-- سياسة: المستخدم يمكنه إنشاء مخازن جديدة
CREATE POLICY "Users can create warehouses"
    ON warehouses FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- سياسة: المستخدم يمكنه تعديل مخازنه
CREATE POLICY "Users can update their own warehouses"
    ON warehouses FOR UPDATE
    USING (auth.uid() = user_id);

-- سياسة: المستخدم يمكنه حذف مخازنه
CREATE POLICY "Users can delete their own warehouses"
    ON warehouses FOR DELETE
    USING (auth.uid() = user_id);

-- سياسة: المستخدم يمكنه رؤية منتجات مخازنه فقط
CREATE POLICY "Users can view products in their warehouses"
    ON warehouse_products_flexible FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM warehouses
            WHERE warehouses.id = warehouse_products_flexible.warehouse_id
            AND warehouses.user_id = auth.uid()
        )
    );

-- سياسة: المستخدم يمكنه إضافة منتجات لمخازنه
CREATE POLICY "Users can insert products in their warehouses"
    ON warehouse_products_flexible FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM warehouses
            WHERE warehouses.id = warehouse_products_flexible.warehouse_id
            AND warehouses.user_id = auth.uid()
        )
    );

-- سياسة: المستخدم يمكنه تعديل منتجات مخازنه
CREATE POLICY "Users can update products in their warehouses"
    ON warehouse_products_flexible FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM warehouses
            WHERE warehouses.id = warehouse_products_flexible.warehouse_id
            AND warehouses.user_id = auth.uid()
        )
    );

-- سياسة: المستخدم يمكنه حذف منتجات مخازنه
CREATE POLICY "Users can delete products in their warehouses"
    ON warehouse_products_flexible FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM warehouses
            WHERE warehouses.id = warehouse_products_flexible.warehouse_id
            AND warehouses.user_id = auth.uid()
        )
    );
