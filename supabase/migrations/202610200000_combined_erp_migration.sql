-- Combined ERP migration
-- This migration combines all ERP modules
CREATE TABLE IF NOT EXISTS erp_config (
  id SERIAL PRIMARY KEY,
  setting_name TEXT UNIQUE,
  setting_value TEXT
);