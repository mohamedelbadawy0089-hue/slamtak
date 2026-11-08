// هدف الاتصال بقاعدة البيانات: مشروع Supabase افتراضيًا، أو أي خادم عبر متغيّرات libpq.
// الافتراضي يبقى كما هو؛ والمسار البديل يخدم CI وخادمًا محليًا بلا تعديل في بقية السكربتات.
//
//   PGHOST / PGPORT / PGUSER / PGDATABASE  — توجيه الاتصال
//   SUPABASE_DB_PASSWORD أو PGPASSWORD     — كلمة المرور
//   PGSSLMODE=disable                      — خادم بلا TLS (حاوية CI)
import config from '../supabase/config.js';

export function dbTarget() {
  const projectRef = (config.url || '').replace('https://', '').split('.')[0];
  const custom = Boolean(process.env.PGHOST);
  const host = process.env.PGHOST || `db.${projectRef}.supabase.co`;
  const port = Number(process.env.PGPORT || 5432);

  return {
    label: custom ? `${host}:${port}/${process.env.PGDATABASE || 'postgres'}` : projectRef,
    options: {
      host,
      port,
      user: process.env.PGUSER || 'postgres',
      password: process.env.SUPABASE_DB_PASSWORD || process.env.PGPASSWORD,
      database: process.env.PGDATABASE || 'postgres',
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    },
  };
}
