-- مصادقة اسم المستخدم
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;