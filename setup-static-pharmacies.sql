-- ============================================
-- 1. Create Static Pharmacies Table
-- ============================================

CREATE TABLE IF NOT EXISTS public.egypt_pharmacies_static (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    governorate TEXT NOT NULL,
    city TEXT NOT NULL,
    district TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    location_url TEXT,
    district_id TEXT, -- For fast geographic filtering
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 2. Performance Optimization (Indexing)
-- ============================================

-- B-Tree indexes for cascading dropdowns filtering
CREATE INDEX IF NOT EXISTS idx_pharmacies_static_gov ON public.egypt_pharmacies_static(governorate);
CREATE INDEX IF NOT EXISTS idx_pharmacies_static_city ON public.egypt_pharmacies_static(city);
CREATE INDEX IF NOT EXISTS idx_pharmacies_static_district ON public.egypt_pharmacies_static(district);
CREATE INDEX IF NOT EXISTS idx_pharmacies_static_district_id ON public.egypt_pharmacies_static(district_id);

-- Full-Text Search (FTS) Index on name for ultra-fast text search
-- We use to_tsvector with 'simple' configuration for Arabic text if specific Arabic config is missing, 
-- but 'simple' is often safer for names.
CREATE INDEX IF NOT EXISTS idx_pharmacies_static_name_fts ON public.egypt_pharmacies_static USING GIN (to_tsvector('simple', name));

-- ============================================
-- 3. Security (Read-Only for Users)
-- ============================================

ALTER TABLE public.egypt_pharmacies_static ENABLE ROW LEVEL SECURITY;

-- Allow anyone to SELECT (Static database is public information)
DROP POLICY IF EXISTS "Public Read Access" ON public.egypt_pharmacies_static;
CREATE POLICY "Public Read Access" ON public.egypt_pharmacies_static
    FOR SELECT USING (true);

-- Deny all other operations for non-admins (implicitly denied if no policy exists)
-- Only service_role or superuser can INSERT/UPDATE/DELETE

-- ============================================
-- 4. Helper Function for Advanced Search
-- ============================================

CREATE OR REPLACE FUNCTION public.search_static_pharmacies(
    search_term TEXT,
    p_gov TEXT DEFAULT NULL,
    p_city TEXT DEFAULT NULL,
    p_district TEXT DEFAULT NULL
)
RETURNS SETOF public.egypt_pharmacies_static AS $$
BEGIN
    RETURN QUERY
    SELECT *
    FROM public.egypt_pharmacies_static
    WHERE 
        (search_term IS NULL OR search_term = '' OR to_tsvector('simple', name) @@ to_tsquery('simple', search_term || ':*'))
        AND (p_gov IS NULL OR p_gov = '' OR governorate = p_gov)
        AND (p_city IS NULL OR p_city = '' OR city = p_city)
        AND (p_district IS NULL OR p_district = '' OR district = p_district)
    LIMIT 100;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
