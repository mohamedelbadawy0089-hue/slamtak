-- Create inventory tables
CREATE TABLE IF NOT EXISTS inventory (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  quantity INTEGER DEFAULT 0,
  price NUMERIC(10,2),
  created_at TIMESTAMP DEFAULT NOW()
);