-- ============================================
-- جدول تحليل البيانات والإحصائيات (Analytics)
-- ============================================

-- إنشاء جدول تحليل البيانات
CREATE TABLE IF NOT EXISTS analytics (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- هوية المخزن
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
    user_id TEXT,
    
    -- نوع التحليل
    analytics_type TEXT NOT NULL CHECK (analytics_type IN (
        'daily_sales', 'monthly_sales', 'yearly_sales',
        'top_products', 'least_products',
        'top_pharmacies', 'least_pharmacies',
        'inventory_status', 'orders_summary'
    )),
    
    -- نطاق التاريخ
    report_date DATE,
    report_start_date DATE,
    report_end_date DATE,
    
    -- البيانات المحسوبة (JSON)
    data JSONB NOT NULL DEFAULT '{}',
    
    -- ملخص الإحصائيات
    total_orders INTEGER DEFAULT 0,
    total_revenue DECIMAL(12,2) DEFAULT 0,
    total_items_sold INTEGER DEFAULT 0,
    unique_pharmacies INTEGER DEFAULT 0,
    unique_products INTEGER DEFAULT 0,
    
    -- الميتاداتا
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- فهارس للأداء
CREATE INDEX IF NOT EXISTS idx_analytics_warehouse_id ON analytics(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics(analytics_type);
CREATE INDEX IF NOT EXISTS idx_analytics_report_date ON analytics(report_date);
CREATE INDEX IF NOT EXISTS idx_analytics_report_period ON analytics(report_start_date, report_end_date);
CREATE INDEX IF NOT EXISTS idx_analytics_user_id ON analytics(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics(created_at);

-- RLS Policies
ALTER TABLE analytics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anonymous access" ON analytics;
CREATE POLICY "Allow anonymous access" ON analytics FOR ALL USING (true) WITH CHECK (true);

-- دالة لتحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION update_analytics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- تريجر للتحديث التلقائي
DROP TRIGGER IF EXISTS update_analytics_updated_at ON analytics;
CREATE TRIGGER update_analytics_updated_at BEFORE UPDATE ON analytics
    FOR EACH ROW EXECUTE FUNCTION update_analytics_updated_at();

-- ============================================
-- Views للتحليلات الشائعة (مع التحقق من وجود الجداول)
-- ============================================

-- ملخص يومي للمبيعات
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') THEN
        CREATE OR REPLACE VIEW daily_analytics_summary AS
        SELECT 
            DATE_TRUNC('day', o.order_date) as date,
            o.warehouse_id,
            COUNT(*) as total_orders,
            SUM(COALESCE(o.total_amount, o.total, 0)) as total_revenue,
            COUNT(DISTINCT o.pharmacy_name) as unique_pharmacies,
            AVG(COALESCE(o.total_amount, o.total, 0)) as avg_order_value
        FROM orders o
        WHERE o.status IN ('delivered', 'completed', 'accepted')
        GROUP BY DATE_TRUNC('day', o.order_date), o.warehouse_id
        ORDER BY date DESC;
    END IF;
END $$;

-- أفضل المنتجات مبيعاً
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') 
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products') THEN
        CREATE OR REPLACE VIEW top_selling_products AS
        WITH product_sales AS (
            SELECT 
                p.id,
                COALESCE(p.name, p.product_name) as product_name,
                p.warehouse_id,
                COUNT(*) as times_ordered,
                SUM((item->>'quantity')::INTEGER) as total_quantity_sold,
                SUM((item->>'total')::DECIMAL) as total_revenue
            FROM orders o
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.products, o.items, '[]'::jsonb)) as item
            LEFT JOIN products p ON (item->>'product_id')::UUID = p.id
            WHERE o.status IN ('delivered', 'completed', 'accepted')
            GROUP BY p.id, COALESCE(p.name, p.product_name), p.warehouse_id
        )
        SELECT * FROM product_sales
        WHERE product_name IS NOT NULL
        ORDER BY total_quantity_sold DESC;
    END IF;
END $$;

-- أفضل الصيدليات
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') THEN
        CREATE OR REPLACE VIEW top_pharmacies AS
        SELECT 
            o.pharmacy_name,
            o.warehouse_id,
            COUNT(*) as total_orders,
            SUM(COALESCE(o.total_amount, o.total, 0)) as total_revenue,
            AVG(COALESCE(o.total_amount, o.total, 0)) as avg_order_value,
            MAX(o.order_date) as last_order_date
        FROM orders o
        WHERE o.status IN ('delivered', 'completed', 'accepted')
        GROUP BY o.pharmacy_name, o.warehouse_id
        ORDER BY total_revenue DESC;
    END IF;
END $$;

-- حالة المخزون
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products') THEN
        CREATE OR REPLACE VIEW inventory_analytics AS
        SELECT 
            p.id,
            COALESCE(p.name, p.product_name) as product_name,
            p.warehouse_id,
            p.quantity as current_stock,
            COALESCE(p.min_stock, p.low_stock_alert, 10) as min_stock_level,
            CASE 
                WHEN p.quantity <= 0 THEN 'out_of_stock'
                WHEN p.quantity < COALESCE(p.min_stock, p.low_stock_alert, 10) THEN 'low_stock'
                WHEN p.quantity < COALESCE(p.min_stock, p.low_stock_alert, 10) * 2 THEN 'medium_stock'
                ELSE 'good_stock'
            END as stock_status,
            p.price,
            p.price * p.quantity as inventory_value
        FROM products p
        ORDER BY 
            CASE 
                WHEN p.quantity <= 0 THEN 1
                WHEN p.quantity < COALESCE(p.min_stock, p.low_stock_alert, 10) THEN 2
                WHEN p.quantity < COALESCE(p.min_stock, p.low_stock_alert, 10) * 2 THEN 3
                ELSE 4
            END,
            p.quantity ASC;
    END IF;
END $$;

-- ============================================
-- Functions للتحليلات (مع التحقق من وجود الجداول)
-- ============================================

-- حفظ تحليل يومي
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') THEN
        CREATE OR REPLACE FUNCTION save_daily_analytics(
            p_warehouse_id UUID,
            p_report_date DATE
        ) RETURNS UUID AS $$
        DECLARE
            v_analytics_id UUID;
            v_data JSONB;
            v_total_orders INTEGER;
            v_total_revenue DECIMAL(12,2);
            v_total_items INTEGER;
            v_unique_pharmacies INTEGER;
        BEGIN
            -- حساب الإحصائيات
            SELECT 
                COUNT(*),
                SUM(COALESCE(total_amount, total, 0)),
                SUM(jsonb_array_length(COALESCE(products, items, '[]'::jsonb))),
                COUNT(DISTINCT pharmacy_name)
            INTO v_total_orders, v_total_revenue, v_total_items, v_unique_pharmacies
            FROM orders
            WHERE warehouse_id = p_warehouse_id
            AND DATE(order_date) = p_report_date
            AND status IN ('delivered', 'completed', 'accepted');
            
            -- إنشاء JSON للبيانات
            v_data := jsonb_build_object(
                'orders_by_status', (
                    SELECT jsonb_object_agg(status, cnt)
                    FROM (
                        SELECT status, COUNT(*) as cnt
                        FROM orders
                        WHERE warehouse_id = p_warehouse_id
                        AND DATE(order_date) = p_report_date
                        GROUP BY status
                    ) s
                ),
                'top_products', (
                    SELECT jsonb_agg(jsonb_build_object(
                        'name', COALESCE(p.name, p.product_name, item->>'name'),
                        'quantity', SUM((item->>'quantity')::INTEGER),
                        'revenue', SUM((item->>'total')::DECIMAL)
                    ))
                    FROM orders o
                    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.products, o.items, '[]'::jsonb)) as item
                    LEFT JOIN products p ON (item->>'product_id')::UUID = p.id
                    WHERE o.warehouse_id = p_warehouse_id
                    AND DATE(o.order_date) = p_report_date
                    GROUP BY COALESCE(p.name, p.product_name, item->>'name')
                    ORDER BY SUM((item->>'quantity')::INTEGER) DESC
                    LIMIT 5
                )
            );
            
            -- حفظ أو تحديث
            INSERT INTO analytics (
                warehouse_id, analytics_type, report_date, report_start_date, report_end_date,
                data, total_orders, total_revenue, total_items_sold, unique_pharmacies
            ) VALUES (
                p_warehouse_id, 'daily_sales', p_report_date, p_report_date, p_report_date,
                v_data, v_total_orders, v_total_revenue, v_total_items, v_unique_pharmacies
            )
            ON CONFLICT (warehouse_id, analytics_type, report_date) DO UPDATE SET
                data = EXCLUDED.data,
                total_orders = EXCLUDED.total_orders,
                total_revenue = EXCLUDED.total_revenue,
                total_items_sold = EXCLUDED.total_items_sold,
                unique_pharmacies = EXCLUDED.unique_pharmacies,
                updated_at = NOW()
            RETURNING id INTO v_analytics_id;
            
            RETURN v_analytics_id;
        END;
        $$ LANGUAGE plpgsql;
    END IF;
END $$;

-- ============================================
-- Data Insertion (Optional sample data)
-- ============================================

-- مثال: إدخال تحليل تجريبي
INSERT INTO analytics (
    warehouse_id, analytics_type, report_date, report_start_date, report_end_date,
    data, total_orders, total_revenue, total_items_sold, unique_pharmacies
) VALUES (
    '550e8400-e29b-41d4-a716-446655440000',
    'daily_sales',
    CURRENT_DATE,
    CURRENT_DATE,
    CURRENT_DATE,
    '{"note": "Sample analytics data"}'::jsonb,
    0, 0, 0, 0
) ON CONFLICT DO NOTHING;

SELECT 'تم إنشاء جدول تحليل البيانات بنجاح!' as result;
