-- Purge financial selftest
SELECT COUNT(*) FROM financial_records WHERE created_at < NOW() - INTERVAL '1 year';