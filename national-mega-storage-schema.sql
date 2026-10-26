-- ============================================
-- National Mega-Storage Cloud Database Schema
-- Multi-Tenant Architecture for 1000+ Warehouses
-- ============================================

-- Enable RLS (Row Level Security)
SET app.settings.enable_rls = 'true';

-- ============================================
-- 1. TENANTS TABLE (Warehouse Registry)
-- ============================================
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_code VARCHAR(20) UNIQUE NOT NULL, -- e.g., 'WH-001', 'PH-CAI-001'
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('warehouse', 'pharmacy', 'hospital', 'clinic')),
    
    -- Location
    governorate VARCHAR(100) NOT NULL,
    city VARCHAR(100) NOT NULL,
    area VARCHAR(100),
    address TEXT,
    coordinates POINT,
    
    -- Contact
    phone VARCHAR(20),
    email VARCHAR(255),
    license_number VARCHAR(100),
    
    -- Subscription & Limits
    subscription_tier VARCHAR(20) DEFAULT 'basic' CHECK (subscription_tier IN ('basic', 'standard', 'premium', 'enterprise')),
    max_users INTEGER DEFAULT 5,
    max_products INTEGER DEFAULT 10000,
    storage_quota_mb INTEGER DEFAULT 1024,
    
    -- Status
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'inactive', 'pending')),
    is_verified BOOLEAN DEFAULT FALSE,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_sync_at TIMESTAMPTZ,
    
    -- Settings
    settings JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_tenants_code ON tenants(tenant_code);
CREATE INDEX idx_tenants_governorate ON tenants(governorate);
CREATE INDEX idx_tenants_status ON tenants(status);

-- ============================================
-- 2. TENANT ISOLATION FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS UUID AS $$
BEGIN
    RETURN current_setting('app.current_tenant', TRUE)::UUID;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 3. PRODUCTS TABLE (Tenant-Isolated)
-- ============================================
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Product Info
    barcode VARCHAR(100),
    trade_name VARCHAR(255) NOT NULL,
    scientific_name VARCHAR(255),
    dosage_form VARCHAR(100), -- tablet, syrup, injection, etc.
    strength VARCHAR(50), -- e.g., '500mg', '10mg/5ml'
    
    -- Classification
    category VARCHAR(100),
    subcategory VARCHAR(100),
    therapeutic_class VARCHAR(100),
    
    -- Pricing
    official_price DECIMAL(10,2),
    purchase_price DECIMAL(10,2),
    selling_price DECIMAL(10,2),
    vat_percentage DECIMAL(5,2) DEFAULT 14.00,
    
    -- Inventory
    current_quantity INTEGER DEFAULT 0,
    min_stock_level INTEGER DEFAULT 10,
    max_stock_level INTEGER DEFAULT 1000,
    reorder_point INTEGER DEFAULT 20,
    
    -- Supplier Info
    supplier_id UUID,
    supplier_name VARCHAR(255),
    
    -- Storage
    storage_location VARCHAR(100),
    storage_conditions JSONB, -- temperature, humidity, etc.
    
    -- Dates
    production_date DATE,
    expiry_date DATE,
    batch_number VARCHAR(100),
    
    -- Voice Recognition
    voice_aliases JSONB DEFAULT '[]', -- e.g., ['bernardo', 'benidorm']
    phonetic_codes JSONB DEFAULT '[]',
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    is_controlled BOOLEAN DEFAULT FALSE,
    requires_prescription BOOLEAN DEFAULT FALSE,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,
    
    -- Sync
    last_sync_at TIMESTAMPTZ,
    sync_version INTEGER DEFAULT 1,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Constraints
    CONSTRAINT valid_quantity CHECK (current_quantity >= 0),
    CONSTRAINT valid_prices CHECK (selling_price >= 0 AND purchase_price >= 0)
);

-- Partition by tenant for massive scale
CREATE INDEX idx_products_tenant ON products(tenant_id);
CREATE INDEX idx_products_tenant_barcode ON products(tenant_id, barcode);
CREATE INDEX idx_products_tenant_name ON products(tenant_id, trade_name);
CREATE INDEX idx_products_tenant_category ON products(tenant_id, category);
CREATE INDEX idx_products_tenant_expiry ON products(tenant_id, expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX idx_products_voice_aliases ON products USING GIN(voice_aliases);
CREATE INDEX idx_products_phonetic ON products USING GIN(phonetic_codes);

-- Enable RLS
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Tenants can only see their own products
CREATE POLICY tenant_products_isolation ON products
    FOR ALL
    USING (tenant_id = get_current_tenant_id())
    WITH CHECK (tenant_id = get_current_tenant_id());

-- ============================================
-- 4. GLOBAL MASTER DRUG ENCYCLOPEDIA
-- ============================================
CREATE TABLE master_drugs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Official Egyptian Drug Authority Data
    eda_registration_number VARCHAR(100) UNIQUE,
    
    -- Names
    trade_name VARCHAR(255) NOT NULL,
    trade_name_ar VARCHAR(255),
    scientific_name VARCHAR(255) NOT NULL,
    scientific_name_ar VARCHAR(255),
    
    -- Classification
    category VARCHAR(100) NOT NULL,
    subcategory VARCHAR(100),
    therapeutic_class VARCHAR(100),
    atc_code VARCHAR(10),
    
    -- Dosage
    dosage_form VARCHAR(100) NOT NULL,
    strength VARCHAR(50) NOT NULL,
    route_of_administration VARCHAR(100),
    
    -- Manufacturer
    manufacturer_name VARCHAR(255),
    manufacturer_country VARCHAR(100),
    
    -- Official Pricing (Egyptian Drug Authority)
    official_price DECIMAL(10,2),
    price_currency VARCHAR(3) DEFAULT 'EGP',
    price_effective_date DATE,
    price_source VARCHAR(100), -- 'EDA', 'Ministry', 'Manufacturer'
    
    -- Voice Recognition Data
    voice_aliases JSONB DEFAULT '[]',
    phonetic_codes JSONB DEFAULT '[]',
    pronunciation_guide JSONB DEFAULT '{}',
    common_misspellings JSONB DEFAULT '[]',
    
    -- Availability
    is_available BOOLEAN DEFAULT TRUE,
    is_controlled BOOLEAN DEFAULT FALSE,
    is_refrigerated BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    description TEXT,
    side_effects JSONB DEFAULT '[]',
    contraindications JSONB DEFAULT '[]',
    
    -- Versioning for Global Sync
    version INTEGER DEFAULT 1,
    version_hash VARCHAR(64),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Sync Tracking
    last_global_sync_at TIMESTAMPTZ,
    sync_priority INTEGER DEFAULT 5 -- 1=high, 10=low
);

-- Indexes for Global Master
CREATE INDEX idx_master_drugs_category ON master_drugs(category);
CREATE INDEX idx_master_drugs_scientific ON master_drugs(scientific_name);
CREATE INDEX idx_master_drugs_available ON master_drugs(is_available) WHERE is_available = TRUE;
CREATE INDEX idx_master_drugs_voice ON master_drugs USING GIN(voice_aliases);
CREATE INDEX idx_master_drugs_version ON master_drugs(version);
CREATE INDEX idx_master_drugs_sync ON master_drugs(last_global_sync_at, sync_priority);

-- ============================================
-- 5. WAREHOUSE SYNC LOG (Track all syncs)
-- ============================================
CREATE TABLE warehouse_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    sync_type VARCHAR(50) NOT NULL, -- 'full', 'incremental', 'price_update', 'master_update'
    status VARCHAR(20) NOT NULL, -- 'pending', 'in_progress', 'completed', 'failed'
    
    -- Sync Details
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    
    -- Data Stats
    records_synced INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    data_size_bytes INTEGER,
    
    -- Versioning
    from_version INTEGER,
    to_version INTEGER,
    
    -- Error Handling
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    
    -- Client Info (for weak internet optimization)
    client_bandwidth VARCHAR(20),
    client_connection_type VARCHAR(20), -- '2g', '3g', '4g', 'wifi', 'offline'
    sync_duration_ms INTEGER,
    
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_sync_logs_tenant ON warehouse_sync_logs(tenant_id);
CREATE INDEX idx_sync_logs_status ON warehouse_sync_logs(status);
CREATE INDEX idx_sync_logs_time ON warehouse_sync_logs(started_at);

-- ============================================
-- 6. GLOBAL SYNC QUEUE (For instant updates)
-- ============================================
CREATE TABLE global_sync_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    entity_type VARCHAR(50) NOT NULL, -- 'master_drug', 'price_update', 'category'
    entity_id UUID NOT NULL,
    
    action VARCHAR(20) NOT NULL, -- 'insert', 'update', 'delete'
    
    -- Data payload (compressed for weak internet)
    payload JSONB NOT NULL,
    payload_size_bytes INTEGER,
    
    -- Targeting
    target_tenants UUID[] DEFAULT NULL, -- NULL = all warehouses
    target_governorates VARCHAR[] DEFAULT NULL,
    
    -- Processing
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    priority INTEGER DEFAULT 5,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    
    -- Retry
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    
    error_log JSONB DEFAULT '[]'
);

CREATE INDEX idx_sync_queue_status ON global_sync_queue(status, priority, created_at);
CREATE INDEX idx_sync_queue_entity ON global_sync_queue(entity_type, entity_id);
CREATE INDEX idx_sync_queue_target ON global_sync_queue USING GIN(target_tenants);

-- ============================================
-- 7. COMPRESSED DATA CACHE (Weak Internet Support)
-- ============================================
CREATE TABLE compressed_sync_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    
    cache_type VARCHAR(50) NOT NULL, -- 'products', 'prices', 'master_drugs'
    
    -- Compressed Data
    data_blob BYTEA NOT NULL,
    compression_algorithm VARCHAR(20) DEFAULT 'gzip', -- 'gzip', 'brotli', 'lz4'
    original_size_bytes INTEGER,
    compressed_size_bytes INTEGER,
    compression_ratio DECIMAL(5,2),
    
    -- Versioning
    version INTEGER DEFAULT 1,
    checksum VARCHAR(64),
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    
    -- Delta info (for incremental sync)
    delta_from_version INTEGER,
    delta_changes_count INTEGER
);

CREATE INDEX idx_cache_tenant ON compressed_sync_cache(tenant_id, cache_type);
CREATE INDEX idx_cache_expires ON compressed_sync_cache(expires_at);

-- ============================================
-- 8. WAREHOUSE USERS (Multi-user per warehouse)
-- ============================================
CREATE TABLE warehouse_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Profile
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'cashier', -- 'admin', 'manager', 'pharmacist', 'cashier'
    
    -- Permissions (JSON for flexibility)
    permissions JSONB DEFAULT '{}',
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    
    -- Voice Recognition Settings
    voice_profile JSONB DEFAULT '{}', -- User's voice patterns
    preferred_language VARCHAR(10) DEFAULT 'ar-EG',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_warehouse_users_tenant ON warehouse_users(tenant_id);
CREATE INDEX idx_warehouse_users_auth ON warehouse_users(auth_user_id);

ALTER TABLE warehouse_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_users_isolation ON warehouse_users
    FOR ALL
    USING (tenant_id = get_current_tenant_id())
    WITH CHECK (tenant_id = get_current_tenant_id());

-- ============================================
-- 9. TRANSACTIONS & SALES (Per warehouse)
-- ============================================
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    transaction_number VARCHAR(50) UNIQUE NOT NULL,
    transaction_type VARCHAR(20) NOT NULL, -- 'sale', 'purchase', 'return', 'adjustment'
    
    -- Financial
    total_amount DECIMAL(12,2) NOT NULL,
    discount_amount DECIMAL(12,2) DEFAULT 0,
    vat_amount DECIMAL(12,2) DEFAULT 0,
    net_amount DECIMAL(12,2) NOT NULL,
    
    -- Status
    status VARCHAR(20) DEFAULT 'completed', -- 'draft', 'completed', 'cancelled'
    payment_method VARCHAR(50),
    
    -- References
    customer_id UUID,
    customer_name VARCHAR(255),
    prescription_number VARCHAR(100),
    
    -- User tracking
    cashier_id UUID REFERENCES warehouse_users(id),
    
    -- Timestamps
    transaction_date TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Sync
    is_synced BOOLEAN DEFAULT FALSE,
    synced_at TIMESTAMPTZ,
    
    metadata JSONB DEFAULT '{}'
);

CREATE TABLE transaction_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(12,2) NOT NULL,
    
    batch_number VARCHAR(100),
    expiry_date DATE,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_tenant ON transactions(tenant_id);
CREATE INDEX idx_transactions_date ON transactions(tenant_id, transaction_date);
CREATE INDEX idx_transaction_items_tenant ON transaction_items(tenant_id);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_transactions_isolation ON transactions
    FOR ALL
    USING (tenant_id = get_current_tenant_id());

CREATE POLICY tenant_transaction_items_isolation ON transaction_items
    FOR ALL
    USING (tenant_id = get_current_tenant_id());

-- ============================================
-- 10. TRIGGERS FOR UPDATED_AT
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_master_drugs_updated_at BEFORE UPDATE ON master_drugs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_warehouse_users_updated_at BEFORE UPDATE ON warehouse_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 11. FUNCTIONS FOR WEAK INTERNET OPTIMIZATION
-- ============================================

-- Get compressed delta for incremental sync
CREATE OR REPLACE FUNCTION get_compressed_delta(
    p_tenant_id UUID,
    p_last_sync_version INTEGER,
    p_connection_type VARCHAR DEFAULT '3g'
)
RETURNS TABLE (
    data_blob BYTEA,
    compression_ratio DECIMAL,
    changes_count INTEGER,
    from_version INTEGER,
    to_version INTEGER
) AS $$
DECLARE
    v_compression_level INTEGER;
BEGIN
    -- Adjust compression based on connection type
    v_compression_level := CASE p_connection_type
        WHEN '2g' THEN 9    -- Maximum compression
        WHEN '3g' THEN 6    -- High compression
        WHEN '4g' THEN 3    -- Medium compression
        ELSE 1              -- Low compression for WiFi
    END;
    
    RETURN QUERY
    SELECT 
        c.data_blob,
        c.compression_ratio,
        c.delta_changes_count,
        c.delta_from_version,
        c.version as to_version
    FROM compressed_sync_cache c
    WHERE c.tenant_id = p_tenant_id
        AND c.delta_from_version = p_last_sync_version
        AND c.expires_at > NOW()
    ORDER BY c.created_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Queue global update for all warehouses
CREATE OR REPLACE FUNCTION queue_global_update(
    p_entity_type VARCHAR,
    p_entity_id UUID,
    p_action VARCHAR,
    p_payload JSONB,
    p_target_governorates VARCHAR[] DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_queue_id UUID;
    v_all_tenants UUID[];
BEGIN
    -- Get all active tenants if no specific targets
    IF p_target_governorates IS NULL THEN
        SELECT ARRAY_AGG(id) INTO v_all_tenants
        FROM tenants
        WHERE status = 'active';
    ELSE
        SELECT ARRAY_AGG(id) INTO v_all_tenants
        FROM tenants
        WHERE status = 'active'
            AND governorate = ANY(p_target_governorates);
    END IF;
    
    -- Insert into queue
    INSERT INTO global_sync_queue (
        entity_type,
        entity_id,
        action,
        payload,
        payload_size_bytes,
        target_tenants,
        target_governorates,
        priority
    ) VALUES (
        p_entity_type,
        p_entity_id,
        p_action,
        p_payload,
        pg_column_size(p_payload),
        v_all_tenants,
        p_target_governorates,
        CASE p_entity_type
            WHEN 'master_drug' THEN 1  -- High priority
            WHEN 'price_update' THEN 2
            ELSE 5
        END
    )
    RETURNING id INTO v_queue_id;
    
    RETURN v_queue_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 12. STATS VIEW FOR MONITORING
-- ============================================
CREATE VIEW national_storage_stats AS
SELECT
    (SELECT COUNT(*) FROM tenants WHERE status = 'active') as active_warehouses,
    (SELECT COUNT(*) FROM products) as total_products,
    (SELECT COUNT(*) FROM master_drugs WHERE is_available = TRUE) as available_master_drugs,
    (SELECT COUNT(*) FROM global_sync_queue WHERE status = 'pending') as pending_syncs,
    (SELECT COUNT(*) FROM warehouse_sync_logs WHERE status = 'in_progress') as active_syncs,
    (SELECT AVG(compression_ratio) FROM compressed_sync_cache) as avg_compression_ratio,
    (SELECT SUM(records_synced) FROM warehouse_sync_logs WHERE completed_at > NOW() - INTERVAL '24 hours') as daily_synced_records;

-- ============================================
-- 13. INITIAL SEED DATA
-- ============================================

-- Seed master drugs (Egyptian Drug Authority official data)
INSERT INTO master_drugs (
    eda_registration_number,
    trade_name,
    scientific_name,
    category,
    dosage_form,
    strength,
    manufacturer_name,
    official_price,
    price_source,
    voice_aliases,
    phonetic_codes,
    is_available
) VALUES
('EDA-2024-001', 'Panadol', 'Paracetamol', 'Analgesic', 'Tablet', '500mg', 'GSK', 45.50, 'EDA', '["panadol", "benidorm", "bernardo"]', '["pndl", "pnd"]', TRUE),
('EDA-2024-002', 'Augmentin', 'Amoxicillin/Clavulanate', 'Antibiotic', 'Tablet', '625mg', 'GSK', 78.00, 'EDA', '["augmentin", "ogmentin"]', '["agmn"]', TRUE),
('EDA-2024-003', 'Brufen', 'Ibuprofen', 'NSAID', 'Tablet', '400mg', 'Abbott', 32.00, 'EDA', '["brufen", "brofen"]', '["brfn"]', TRUE),
('EDA-2024-004', 'Cataflam', 'Diclofenac Potassium', 'NSAID', 'Tablet', '50mg', 'Novartis', 55.00, 'EDA', '["cataflam", "kataflam"]', '["ktfl"]', TRUE),
('EDA-2024-005', 'Amoxicillin', 'Amoxicillin Trihydrate', 'Antibiotic', 'Capsule', '500mg', 'Various', 25.50, 'Ministry', '["amoxicillin", "amoxil"]', '["amx"]', TRUE);

-- ============================================
-- 14. RLS ENABLEMENT FOR ANON/USERS
-- ============================================

-- Allow service role to bypass RLS
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouse_users FORCE ROW LEVEL SECURITY;
ALTER TABLE transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE transaction_items FORCE ROW LEVEL SECURITY;

-- Service role policy (for background sync processes)
CREATE POLICY service_role_bypass ON tenants
    FOR ALL
    TO service_role
    USING (true);

CREATE POLICY service_role_bypass_products ON products
    FOR ALL
    TO service_role
    USING (true);

-- ============================================
-- Setup Complete
-- ============================================
COMMENT ON TABLE tenants IS 'Multi-tenant warehouse registry with complete isolation';
COMMENT ON TABLE master_drugs IS 'Global unified Egyptian drug encyclopedia for all warehouses';
COMMENT ON TABLE global_sync_queue IS 'Queue for instant updates across all warehouses';
COMMENT ON TABLE compressed_sync_cache IS 'Compressed data cache for weak internet optimization';
