-- Create chart of accounts
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id SERIAL PRIMARY KEY,
  account_code TEXT UNIQUE,
  account_name TEXT,
  account_type TEXT
);