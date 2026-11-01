-- Automation engine
CREATE TABLE IF NOT EXISTS automation_rules (
  id SERIAL PRIMARY KEY,
  rule_name TEXT UNIQUE,
  condition_json JSONB,
  action_json JSONB
);