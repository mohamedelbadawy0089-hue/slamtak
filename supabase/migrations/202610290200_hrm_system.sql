-- HR Management System
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  employee_number TEXT UNIQUE,
  name TEXT NOT NULL,
  position TEXT,
  department TEXT,
  hire_date DATE
);