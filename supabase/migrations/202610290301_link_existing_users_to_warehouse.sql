-- Link existing users to warehouse
UPDATE users SET warehouse_id = (SELECT id FROM warehouses LIMIT 1) WHERE warehouse_id IS NULL;