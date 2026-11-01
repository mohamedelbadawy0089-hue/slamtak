-- RBAC read gating test
SELECT * FROM read_gating_rules WHERE applies_to = 'all';