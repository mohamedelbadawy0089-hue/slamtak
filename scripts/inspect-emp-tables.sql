-- Inspect employee tables
SELECT table_name FROM information_schema.tables 
WHERE table_name LIKE '%emp%' OR table_name LIKE '%employee%';