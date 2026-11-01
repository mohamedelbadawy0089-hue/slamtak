-- Update HR permissions
ALTER TABLE hrm_permissions ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();