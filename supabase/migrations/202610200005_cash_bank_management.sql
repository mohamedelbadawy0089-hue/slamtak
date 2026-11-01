-- Cash and bank management
CREATE TABLE IF NOT EXISTS cash_bank_accounts (
  id SERIAL PRIMARY KEY,
  account_name TEXT,
  account_number TEXT,
  balance NUMERIC(15,2) DEFAULT 0
);