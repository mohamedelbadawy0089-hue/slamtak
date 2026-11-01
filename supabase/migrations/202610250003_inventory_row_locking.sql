-- Inventory row locking
ALTER TABLE inventory ADD COLUMN locked_by UUID;
ALTER TABLE inventory ADD COLUMN locked_at TIMESTAMP;