-- ============================================
-- 1. Create Profiles Table (Essential for Roles)
-- ============================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT,
    warehouse_id UUID, -- We remove strict reference temporarily if warehouses table is missing
    role TEXT DEFAULT 'employee' CHECK (role IN ('owner', 'employee')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
DROP POLICY IF EXISTS "Profiles are viewable by owner" ON public.profiles;
CREATE POLICY "Profiles are viewable by owner" ON public.profiles
    FOR SELECT USING (
        auth.uid() = id OR 
        warehouse_id IN (SELECT warehouse_id FROM public.profiles WHERE id = auth.uid() AND role = 'owner')
    );

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

-- ============================================
-- 2. Helper Functions for RLS
-- ============================================

-- Function to get the current user's warehouse_id
CREATE OR REPLACE FUNCTION public.get_user_warehouse_id()
RETURNS UUID AS $$
BEGIN
    RETURN (SELECT warehouse_id FROM public.profiles WHERE id = auth.uid() LIMIT 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user is warehouse owner
CREATE OR REPLACE FUNCTION public.is_warehouse_owner()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role = 'owner'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 3. Refactor RLS Policies for All Tables (Safe Mode)
-- ============================================

DO $$ 
BEGIN
    -- A. Warehouses Table
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'warehouses') THEN
        ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "owner_isolation_warehouses" ON public.warehouses;
        CREATE POLICY "owner_isolation_warehouses" ON public.warehouses
            FOR ALL USING (id = public.get_user_warehouse_id());
        
        -- Add foreign key to profiles if it's missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'profiles_warehouse_id_fkey') THEN
            ALTER TABLE public.profiles ADD CONSTRAINT profiles_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE CASCADE;
        END IF;
    END IF;

    -- B. Products Table
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'products') THEN
        ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "warehouse_isolation_products" ON public.products;
        CREATE POLICY "warehouse_isolation_products" ON public.products
            FOR ALL USING (warehouse_id::text = public.get_user_warehouse_id()::text OR warehouse_id IS NULL);
    END IF;

    -- C. Orders Table
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders') THEN
        ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "warehouse_isolation_orders" ON public.orders;
        CREATE POLICY "warehouse_isolation_orders" ON public.orders
            FOR ALL USING (warehouse_id::text = public.get_user_warehouse_id()::text OR warehouse_id IS NULL);
    END IF;

    -- D. Delivery Personnel Table
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'delivery_personnel') THEN
        ALTER TABLE public.delivery_personnel ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "warehouse_isolation_delivery" ON public.delivery_personnel;
        CREATE POLICY "warehouse_isolation_delivery" ON public.delivery_personnel
            FOR ALL USING (warehouse_id::text = public.get_user_warehouse_id()::text OR warehouse_id IS NULL);
    END IF;

    -- E. Sales Table
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sales') THEN
        ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "warehouse_isolation_sales" ON public.sales;
        CREATE POLICY "warehouse_isolation_sales" ON public.sales
            FOR ALL USING (warehouse_id::text = public.get_user_warehouse_id()::text OR warehouse_id IS NULL);
    END IF;

END $$;

-- ============================================
-- 4. Triggers for Auto-Profile Creation
-- ============================================

-- Function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, warehouse_id, role)
    VALUES (
        NEW.id, 
        NEW.email, 
        (NEW.raw_user_meta_data->>'warehouse_id')::UUID, 
        COALESCE(NEW.raw_user_meta_data->>'role', 'employee')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 5. Migrate Existing Warehouses to Profiles
-- ============================================
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'warehouses') THEN
        INSERT INTO public.profiles (id, email, warehouse_id, role)
        SELECT 
            user_id::UUID, 
            email, 
            id, 
            'owner'
        FROM public.warehouses
        WHERE user_id IS NOT NULL AND user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        ON CONFLICT (id) DO NOTHING;
    END IF;
END $$;
