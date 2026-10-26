-- Add supplier columns to inventory tables
ALTER TABLE warehouse_inventory ADD COLUMN IF NOT EXISTS supplier_name TEXT;
ALTER TABLE warehouse_inventory ADD COLUMN IF NOT EXISTS supplier_phone TEXT;
ALTER TABLE warehouse_inventory ADD COLUMN IF NOT EXISTS supplier_address TEXT;
ALTER TABLE warehouse_inventory ADD COLUMN IF NOT EXISTS invoice_number TEXT;

ALTER TABLE warehouse_custom_products ADD COLUMN IF NOT EXISTS supplier_name TEXT;
ALTER TABLE warehouse_custom_products ADD COLUMN IF NOT EXISTS supplier_phone TEXT;
ALTER TABLE warehouse_custom_products ADD COLUMN IF NOT EXISTS supplier_address TEXT;
ALTER TABLE warehouse_custom_products ADD COLUMN IF NOT EXISTS invoice_number TEXT;
