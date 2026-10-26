-- ============================================
-- Supabase Database Structure for Multi-Warehouse System
-- Supports thousands of accounts (warehouses)
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. Create Users Table (if not using auth.users directly)
-- ============================================
CREATE TABLE IF NOT EXISTS public.warehouses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    warehouse_name VARCHAR(255) NOT NULL,
    warehouse_address TEXT,
    warehouse_phone VARCHAR(20),
    warehouse_email VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true
);

-- Add is_active column if it doesn't exist (for existing tables)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'warehouses' 
        AND column_name = 'is_active'
    ) THEN
        ALTER TABLE public.warehouses ADD COLUMN is_active BOOLEAN DEFAULT true;
    END IF;
END $$;

-- ============================================
-- 2. Create Purchase Invoices Table
-- ============================================

-- Create sequence for invoice numbers
CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS public.purchase_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
    invoice_number VARCHAR(100) NOT NULL UNIQUE,
    supplier_name VARCHAR(255) NOT NULL,
    supplier_invoice_ref VARCHAR(100), -- Optional: Manual supplier invoice number
    invoice_date DATE NOT NULL,
    total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status VARCHAR(50) DEFAULT 'pending' -- pending, completed, cancelled
);

-- Create function to auto-generate invoice number (per warehouse)
CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS TRIGGER AS $$
DECLARE
    warehouse_seq_num INTEGER;
BEGIN
    -- Get next sequence number for this warehouse (simple sequential number)
    SELECT COALESCE(MAX(CAST(invoice_number AS INTEGER)), 0) + 1
    INTO warehouse_seq_num
    FROM public.purchase_invoices
    WHERE warehouse_id = NEW.warehouse_id;
    
    -- Generate invoice number: simple sequential number (e.g., 1, 2, 3, ...)
    NEW.invoice_number := warehouse_seq_num::TEXT;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-generate invoice number on insert
DROP TRIGGER IF EXISTS auto_generate_invoice_number ON public.purchase_invoices;
CREATE TRIGGER auto_generate_invoice_number
    BEFORE INSERT ON public.purchase_invoices
    FOR EACH ROW
    WHEN (NEW.invoice_number IS NULL OR NEW.invoice_number = '')
    EXECUTE FUNCTION public.generate_invoice_number();

-- Create RPC function to get next invoice number for display in UI
CREATE OR REPLACE FUNCTION public.get_next_invoice_number()
RETURNS VARCHAR AS $$
DECLARE
    next_val BIGINT;
    invoice_number VARCHAR(100);
BEGIN
    -- Get next value from sequence without incrementing
    next_val := nextval('public.invoice_number_seq');
    -- Rollback the increment to not affect the sequence
    PERFORM setval('public.invoice_number_seq', next_val - 1);
    -- Format the invoice number
    invoice_number := 'INV-' || LPAD(next_val::TEXT, 6, '0');
    RETURN invoice_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 3. Create Purchase Invoice Items Table
-- ============================================
CREATE TABLE IF NOT EXISTS public.purchase_invoice_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE CASCADE,
    product_name VARCHAR(255) NOT NULL,
    batch_number VARCHAR(100),
    quantity INTEGER NOT NULL DEFAULT 0,
    unit_price DECIMAL(15, 2) NOT NULL DEFAULT 0,
    discount_percent DECIMAL(5, 2) DEFAULT 0,
    price_after_discount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    production_date DATE,
    expiry_date DATE,
    category VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 4. Create Warehouse Custom Products Table
-- ============================================
CREATE TABLE IF NOT EXISTS public.warehouse_custom_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
    name_en VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    batch_number VARCHAR(100),
    quantity INTEGER NOT NULL DEFAULT 0,
    price DECIMAL(15, 2) NOT NULL DEFAULT 0,
    discount DECIMAL(5, 2) DEFAULT 0,
    production_date DATE,
    expiry_date DATE,
    category VARCHAR(100) DEFAULT 'مخصص',
    supplier_name VARCHAR(255),
    invoice_number VARCHAR(100),
    purchase_date DATE,
    is_permanent BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 5. Enable Row Level Security (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_custom_products ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 6. Create RLS Policies for Warehouses Table
-- ============================================

-- Users can only see their own warehouse
CREATE POLICY "Users can view own warehouse"
ON public.warehouses
FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own warehouse
CREATE POLICY "Users can insert own warehouse"
ON public.warehouses
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own warehouse
CREATE POLICY "Users can update own warehouse"
ON public.warehouses
FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own warehouse
CREATE POLICY "Users can delete own warehouse"
ON public.warehouses
FOR DELETE
USING (auth.uid() = user_id);

-- ============================================
-- 7. Create RLS Policies for Purchase Invoices Table
-- ============================================

-- Users can only view their own purchase invoices
CREATE POLICY "Users can view own purchase invoices"
ON public.purchase_invoices
FOR SELECT
USING (
    warehouse_id IN (
        SELECT id FROM public.warehouses WHERE user_id = auth.uid()
    )
);

-- Users can insert their own purchase invoices
CREATE POLICY "Users can insert own purchase invoices"
ON public.purchase_invoices
FOR INSERT
WITH CHECK (
    warehouse_id IN (
        SELECT id FROM public.warehouses WHERE user_id = auth.uid()
    )
);

-- Users can update their own purchase invoices
CREATE POLICY "Users can update own purchase invoices"
ON public.purchase_invoices
FOR UPDATE
USING (
    warehouse_id IN (
        SELECT id FROM public.warehouses WHERE user_id = auth.uid()
    )
);

-- Users can delete their own purchase invoices
CREATE POLICY "Users can delete own purchase invoices"
ON public.purchase_invoices
FOR DELETE
USING (
    warehouse_id IN (
        SELECT id FROM public.warehouses WHERE user_id = auth.uid()
    )
);

-- ============================================
-- 8. Create RLS Policies for Purchase Invoice Items Table
-- ============================================

-- Users can only view items from their own invoices
CREATE POLICY "Users can view own invoice items"
ON public.purchase_invoice_items
FOR SELECT
USING (
    invoice_id IN (
        SELECT id FROM public.purchase_invoices
        WHERE warehouse_id IN (
            SELECT id FROM public.warehouses WHERE user_id = auth.uid()
        )
    )
);

-- Users can insert items to their own invoices
CREATE POLICY "Users can insert own invoice items"
ON public.purchase_invoice_items
FOR INSERT
WITH CHECK (
    invoice_id IN (
        SELECT id FROM public.purchase_invoices
        WHERE warehouse_id IN (
            SELECT id FROM public.warehouses WHERE user_id = auth.uid()
        )
    )
);

-- Users can update items from their own invoices
CREATE POLICY "Users can update own invoice items"
ON public.purchase_invoice_items
FOR UPDATE
USING (
    invoice_id IN (
        SELECT id FROM public.purchase_invoices
        WHERE warehouse_id IN (
            SELECT id FROM public.warehouses WHERE user_id = auth.uid()
        )
    )
);

-- Users can delete items from their own invoices
CREATE POLICY "Users can delete own invoice items"
ON public.purchase_invoice_items
FOR DELETE
USING (
    invoice_id IN (
        SELECT id FROM public.purchase_invoices
        WHERE warehouse_id IN (
            SELECT id FROM public.warehouses WHERE user_id = auth.uid()
        )
    )
);

-- ============================================
-- 9. Create RLS Policies for Warehouse Custom Products Table
-- ============================================

-- Users can only view their own products
CREATE POLICY "Users can view own products"
ON public.warehouse_custom_products
FOR SELECT
USING (
    warehouse_id IN (
        SELECT id FROM public.warehouses WHERE user_id = auth.uid()
    )
);

-- Users can insert their own products
CREATE POLICY "Users can insert own products"
ON public.warehouse_custom_products
FOR INSERT
WITH CHECK (
    warehouse_id IN (
        SELECT id FROM public.warehouses WHERE user_id = auth.uid()
    )
);

-- Users can update their own products
CREATE POLICY "Users can update own products"
ON public.warehouse_custom_products
FOR UPDATE
USING (
    warehouse_id IN (
        SELECT id FROM public.warehouses WHERE user_id = auth.uid()
    )
);

-- Users can delete their own products
CREATE POLICY "Users can delete own products"
ON public.warehouse_custom_products
FOR DELETE
USING (
    warehouse_id IN (
        SELECT id FROM public.warehouses WHERE user_id = auth.uid()
    )
);

-- ============================================
-- 10. Create Indexes for Performance Optimization
-- ============================================

-- Indexes for warehouses table
CREATE INDEX IF NOT EXISTS idx_warehouses_user_id ON public.warehouses(user_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_is_active ON public.warehouses(is_active);

-- Indexes for purchase_invoices table
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_warehouse_id ON public.purchase_invoices(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_invoice_number ON public.purchase_invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_invoice_date ON public.purchase_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_status ON public.purchase_invoices(status);

-- Indexes for purchase_invoice_items table
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_items_invoice_id ON public.purchase_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_items_product_name ON public.purchase_invoice_items(product_name);
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_items_batch_number ON public.purchase_invoice_items(batch_number);

-- Indexes for warehouse_custom_products table
CREATE INDEX IF NOT EXISTS idx_warehouse_custom_products_warehouse_id ON public.warehouse_custom_products(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_custom_products_name_en ON public.warehouse_custom_products(name_en);
CREATE INDEX IF NOT EXISTS idx_warehouse_custom_products_batch_number ON public.warehouse_custom_products(batch_number);
CREATE INDEX IF NOT EXISTS idx_warehouse_custom_products_category ON public.warehouse_custom_products(category);
CREATE INDEX IF NOT EXISTS idx_warehouse_custom_products_is_permanent ON public.warehouse_custom_products(is_permanent);

-- Composite index for better query performance
CREATE INDEX IF NOT EXISTS idx_warehouse_custom_products_warehouse_permanent ON public.warehouse_custom_products(warehouse_id, is_permanent);

-- Unique constraint for upsert based on warehouse_id and name_en
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'warehouse_custom_products_warehouse_name_key'
    ) THEN
        ALTER TABLE public.warehouse_custom_products 
        ADD CONSTRAINT warehouse_custom_products_warehouse_name_key 
        UNIQUE (warehouse_id, name_en);
    END IF;
END $$;

-- ============================================
-- 11. Create Trigger for Updated At
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers to tables with updated_at
CREATE TRIGGER update_warehouses_updated_at BEFORE UPDATE ON public.warehouses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_purchase_invoices_updated_at BEFORE UPDATE ON public.purchase_invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_warehouse_custom_products_updated_at BEFORE UPDATE ON public.warehouse_custom_products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 12. Create Function for Bulk Insert with Auto-Retry
-- ============================================

-- Function to handle bulk insert with error handling
CREATE OR REPLACE FUNCTION bulk_insert_products(
    p_warehouse_id UUID,
    p_products JSONB
)
RETURNS JSONB AS $$
DECLARE
    v_success_count INTEGER := 0;
    v_failed_count INTEGER := 0;
    v_product JSONB;
    v_error_message TEXT;
BEGIN
    -- Loop through products array
    FOR v_product IN SELECT * FROM jsonb_array_elements(p_products) LOOP
        BEGIN
            -- Insert single product
            INSERT INTO public.warehouse_custom_products (
                warehouse_id,
                name_en,
                name_ar,
                batch_number,
                quantity,
                price,
                discount,
                production_date,
                expiry_date,
                category,
                supplier_name,
                invoice_number,
                purchase_date,
                is_permanent
            ) VALUES (
                p_warehouse_id,
                v_product->>'name_en',
                v_product->>'name_ar',
                v_product->>'batch_number',
                (v_product->>'quantity')::INTEGER,
                (v_product->>'price')::DECIMAL,
                (v_product->>'discount')::DECIMAL,
                v_product->>'production_date'::DATE,
                v_product->>'expiry_date'::DATE,
                COALESCE(v_product->>'category', 'مخصص'),
                v_product->>'supplier_name',
                v_product->>'invoice_number',
                v_product->>'purchase_date'::DATE,
                COALESCE((v_product->>'is_permanent')::BOOLEAN, false)
            );
            
            v_success_count := v_success_count + 1;
            
        EXCEPTION WHEN OTHERS THEN
            v_failed_count := v_failed_count + 1;
            v_error_message := v_error_message || 'Error: ' || SQLERRM || E'\n';
        END;
    END LOOP;
    
    -- Return result
    RETURN jsonb_build_object(
        'success', true,
        'success_count', v_success_count,
        'failed_count', v_failed_count,
        'error_message', v_error_message
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 13. Create Function for Bulk Insert Invoice Items
-- ============================================

-- Function to handle bulk insert of invoice items
CREATE OR REPLACE FUNCTION bulk_insert_invoice_items(
    p_invoice_id UUID,
    p_items JSONB
)
RETURNS JSONB AS $$
DECLARE
    v_success_count INTEGER := 0;
    v_failed_count INTEGER := 0;
    v_item JSONB;
    v_error_message TEXT;
BEGIN
    -- Loop through items array
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        BEGIN
            -- Insert single item
            INSERT INTO public.purchase_invoice_items (
                invoice_id,
                product_name,
                batch_number,
                quantity,
                unit_price,
                discount_percent,
                price_after_discount,
                total_amount,
                production_date,
                expiry_date,
                category
            ) VALUES (
                p_invoice_id,
                v_item->>'product_name',
                v_item->>'batch_number',
                (v_item->>'quantity')::INTEGER,
                (v_item->>'unit_price')::DECIMAL,
                (v_item->>'discount_percent')::DECIMAL,
                (v_item->>'price_after_discount')::DECIMAL,
                (v_item->>'total_amount')::DECIMAL,
                v_item->>'production_date'::DATE,
                v_item->>'expiry_date'::DATE,
                v_item->>'category'
            );
            
            v_success_count := v_success_count + 1;
            
        EXCEPTION WHEN OTHERS THEN
            v_failed_count := v_failed_count + 1;
            v_error_message := v_error_message || 'Error: ' || SQLERRM || E'\n';
        END;
    END LOOP;
    
    -- Return result
    RETURN jsonb_build_object(
        'success', true,
        'success_count', v_success_count,
        'failed_count', v_failed_count,
        'error_message', v_error_message
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 14. Grant Permissions
-- ============================================

-- Grant usage on schemas
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- ============================================
-- 15. Create Storage Bucket for File Uploads (Optional)
-- ============================================

-- Insert storage bucket (if needed)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false);

-- ============================================
-- 16. Performance Optimization Settings
-- ============================================

-- Set work_mem for better bulk insert performance
-- SET work_mem = '256MB';

-- Set maintenance_work_mem for index creation
-- SET maintenance_work_mem = '512MB';

-- ============================================
-- 17. Sample Data (Optional - for testing)
-- ============================================

-- Uncomment to insert sample data
/*
-- Sample warehouse
INSERT INTO public.warehouses (user_id, warehouse_name, warehouse_address, warehouse_phone, warehouse_email)
VALUES (
    (SELECT id FROM auth.users LIMIT 1),
    'مخزن السلامة الرئيسي',
    'القاهرة، شارع السودان',
    '+201234567890',
    'info@slamtak.com'
);

-- Sample products
INSERT INTO public.warehouse_custom_products (
    warehouse_id, name_en, name_ar, batch_number, quantity, price, discount, category, is_permanent
)
SELECT 
    (SELECT id FROM public.warehouses LIMIT 1),
    'Product ' || generate_series,
    'منتج ' || generate_series,
    'BATCH-' || LPAD(generate_series::TEXT, 5, '0'),
    (random() * 100)::INTEGER,
    (random() * 1000)::DECIMAL(15, 2),
    (random() * 20)::DECIMAL(5, 2),
    CASE WHEN generate_series % 3 = 0 THEN 'أدوية' WHEN generate_series % 3 = 1 THEN 'مستحضرات' ELSE 'معدات' END,
    true
FROM generate_series(1, 100);
*/

-- ============================================
-- 18. Verification Queries
-- ============================================

-- Check RLS is enabled
SELECT 
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('warehouses', 'purchase_invoices', 'purchase_invoice_items', 'warehouse_custom_products');

-- Check policies
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public';

-- Check indexes
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename IN ('warehouses', 'purchase_invoices', 'purchase_invoice_items', 'warehouse_custom_products');

-- ============================================
-- End of Database Setup
-- ============================================
