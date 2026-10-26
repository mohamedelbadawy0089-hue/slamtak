-- ============================================
-- Supabase Migration Script for Orders and Delivery
-- ============================================

-- Run this script in your Supabase SQL Editor
-- This will create all necessary tables and set up RLS policies

-- 1. Orders Table
CREATE TABLE IF NOT EXISTS orders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    order_number TEXT NOT NULL UNIQUE,
    order_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    pharmacy_name TEXT NOT NULL,
    pharmacy_phone TEXT,
    pharmacy_address TEXT,
    pharmacy_gps JSONB, -- {lat: number, lng: number}
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'completed', 'rejected', 'cancelled')),
    total_amount DECIMAL(10,2) NOT NULL,
    items_count INTEGER NOT NULL,
    products JSONB NOT NULL, -- Array of products with details
    delivery_person_id UUID REFERENCES delivery_personnel(id),
    delivery_status TEXT DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'assigned', 'picked_up', 'delivered', 'failed')),
    delivery_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Delivery Personnel Table
CREATE TABLE IF NOT EXISTS delivery_personnel (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    email TEXT,
    address TEXT,
    is_active BOOLEAN DEFAULT true,
    current_orders_count INTEGER DEFAULT 0,
    total_delivered INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Order Status History Table (for tracking)
CREATE TABLE IF NOT EXISTS order_status_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    old_status TEXT,
    new_status TEXT NOT NULL,
    changed_by UUID REFERENCES auth.users(id),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Delivery Tracking Table
CREATE TABLE IF NOT EXISTS delivery_tracking (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    delivery_person_id UUID REFERENCES delivery_personnel(id),
    status TEXT NOT NULL CHECK (status IN ('assigned', 'picked_up', 'in_transit', 'delivered', 'failed')),
    location JSONB, -- {lat: number, lng: number, address: text}
    notes TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_orders_warehouse_id ON orders(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_pharmacy_name ON orders(pharmacy_name);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_person_id ON orders(delivery_person_id);

CREATE INDEX IF NOT EXISTS idx_delivery_personnel_warehouse_id ON delivery_personnel(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_delivery_personnel_phone ON delivery_personnel(phone);
CREATE INDEX IF NOT EXISTS idx_delivery_personnel_is_active ON delivery_personnel(is_active);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id ON order_status_history(order_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_created_at ON order_status_history(created_at);

CREATE INDEX IF NOT EXISTS idx_delivery_tracking_order_id ON delivery_tracking(order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_delivery_person_id ON delivery_tracking(delivery_person_id);
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_timestamp ON delivery_tracking(timestamp);

-- RLS (Row Level Security) Policies
-- Enable RLS on all tables
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_personnel ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_tracking ENABLE ROW LEVEL SECURITY;

-- Orders Table Policies
CREATE POLICY "Users can view orders from their warehouse" ON orders
    FOR SELECT USING (warehouse_id = auth.uid()::text);

CREATE POLICY "Users can insert orders for their warehouse" ON orders
    FOR INSERT WITH CHECK (warehouse_id = auth.uid()::text);

CREATE POLICY "Users can update orders from their warehouse" ON orders
    FOR UPDATE USING (warehouse_id = auth.uid()::text);

CREATE POLICY "Users can delete orders from their warehouse" ON orders
    FOR DELETE USING (warehouse_id = auth.uid()::text);

-- Delivery Personnel Table Policies
CREATE POLICY "Users can view delivery personnel from their warehouse" ON delivery_personnel
    FOR SELECT USING (warehouse_id = auth.uid()::text);

CREATE POLICY "Users can insert delivery personnel for their warehouse" ON delivery_personnel
    FOR INSERT WITH CHECK (warehouse_id = auth.uid()::text);

CREATE POLICY "Users can update delivery personnel from their warehouse" ON delivery_personnel
    FOR UPDATE USING (warehouse_id = auth.uid()::text);

CREATE POLICY "Users can delete delivery personnel from their warehouse" ON delivery_personnel
    FOR DELETE USING (warehouse_id = auth.uid()::text);

-- Order Status History Policies
CREATE POLICY "Users can view status history for their warehouse orders" ON order_status_history
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = order_status_history.order_id 
            AND orders.warehouse_id = auth.uid()::text
        )
    );

CREATE POLICY "Users can insert status history for their warehouse orders" ON order_status_history
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = order_status_history.order_id 
            AND orders.warehouse_id = auth.uid()::text
        )
    );

-- Delivery Tracking Policies
CREATE POLICY "Users can view delivery tracking for their warehouse orders" ON delivery_tracking
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = delivery_tracking.order_id 
            AND orders.warehouse_id = auth.uid()::text
        )
    );

CREATE POLICY "Users can insert delivery tracking for their warehouse orders" ON delivery_tracking
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = delivery_tracking.order_id 
            AND orders.warehouse_id = auth.uid()::text
        )
    );

-- Functions for automatic timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for automatic timestamps
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_delivery_personnel_updated_at BEFORE UPDATE ON delivery_personnel
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to automatically create order status history
CREATE OR REPLACE FUNCTION log_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO order_status_history (order_id, old_status, new_status, changed_by)
        VALUES (NEW.id, OLD.status, NEW.status, auth.uid());
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for order status logging
CREATE TRIGGER order_status_change_log
    AFTER UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION log_order_status_change();

-- Function to generate unique order numbers
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
DECLARE
    order_num TEXT;
    date_part TEXT;
    sequence_num INTEGER;
BEGIN
    -- Get current date in YYYYMMDD format
    date_part := TO_CHAR(NOW(), 'YYYYMMDD');
    
    -- Get next sequence number for today
    SELECT COALESCE(MAX(CAST(SUBSTRING(order_number, -3) AS INTEGER)), 0) + 1
    INTO sequence_num
    FROM orders
    WHERE order_number LIKE date_part || '%';
    
    -- Format: ORD-YYYYMMDD-XXX (3-digit sequence)
    order_num := 'ORD-' || date_part || '-' || LPAD(sequence_num::TEXT, 3, '0');
    
    RETURN order_num;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-generating order numbers
CREATE OR REPLACE FUNCTION set_order_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
        NEW.order_number := generate_order_number();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_order_number_trigger
    BEFORE INSERT ON orders
    FOR EACH ROW EXECUTE FUNCTION set_order_number();

COMMIT;
