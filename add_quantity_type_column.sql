-- SQL to add quantity_type column to products table in Supabase
-- Run this in Supabase SQL Editor

-- Add quantity_type column (if not exists)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS quantity_type VARCHAR(20) DEFAULT 'decreasing';

-- Update existing products to have quantity_type = 'decreasing' (for backward compatibility)
UPDATE products 
SET quantity_type = 'decreasing' 
WHERE quantity_type IS NULL;

-- Verify the column was added
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'products';
