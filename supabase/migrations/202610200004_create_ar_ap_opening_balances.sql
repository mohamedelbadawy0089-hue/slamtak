-- AR/AP Opening balances
CREATE TABLE IF NOT EXISTS ar_ap_opening_balances (
  id SERIAL PRIMARY KEY,
  account_type TEXT,
  balance_date DATE,
  opening_balance NUMERIC(15,2)
);