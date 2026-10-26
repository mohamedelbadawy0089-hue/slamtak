-- Add production_date to inventory tables
ALTER TABLE warehouse_inventory ADD COLUMN IF NOT EXISTS production_date DATE;
ALTER TABLE warehouse_custom_products ADD COLUMN IF NOT EXISTS production_date DATE;

-- Ensure expiry_date and batch_number exist (they should, but just in case)
ALTER TABLE warehouse_custom_products ADD COLUMN IF NOT EXISTS expiry_date DATE;
ALTER TABLE warehouse_custom_products ADD COLUMN IF NOT EXISTS batch_number TEXT;
ALTER TABLE warehouse_custom_products ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE warehouse_custom_products ADD COLUMN IF NOT EXISTS discount NUMERIC(5, 2) DEFAULT 0;
ALTER TABLE warehouse_custom_products ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 0;
