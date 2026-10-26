-- إزالة Unique Constraint القديم على (batchNumber, warehouse_id)
-- لاستبداله بـ Unique Constraint الجديد على (batchNumber, warehouse_id, tradeName)

ALTER TABLE drugs DROP CONSTRAINT IF EXISTS drugs_batchnumber_warehouse_id_key;
