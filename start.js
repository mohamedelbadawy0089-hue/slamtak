// يحمل .env.local قبل الاستيرادات الأخرى (يتجاوز المتغيرات الموجودة مسبقًا في البيئة،
// ويدعم القيم المقتبسة؛ لأن المنصة أعادت كتابة الملف بقيم فيه علامات تنصيص)
const fsEnv = require('fs');
const pathEnv = require('path');
try {
  fsEnv.readFileSync(pathEnv.join(__dirname, '.env.local'), 'utf8').split('\n').forEach((line) => {
    const i = line.indexOf('=');
    if (i > 0 && !line.trim().startsWith('#')) {
      const key = line.slice(0, i).trim();
      let value = line.slice(i + 1).trim();
      if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
        value = value.slice(1, -1);
      }
      if (key && !process.env[key]) process.env[key] = value;
    }
  });
} catch { /* .env.local غير موجودة */ }
// الرابط العام للمشروع غير سري — يُستعمل بديلاً إذا أعادت المنصة كتابة الملف وفقده
if (!process.env.SUPABASE_URL) {
  process.env.SUPABASE_URL = 'https://iksjhjxwphmvthryfeae.supabase.co';
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Import auth routes logic
const authRoutes = require('./src/api/auth.js');

const app = express();

// Security middleware
// CSP الافتراضي في helmet يمنع ما تحتاجه الواجهة فعلياً:
//  - script-src 'self' ← يحجب supabase-js وeruda القادمين من cdn.jsdelivr.net
//  - default-src 'self' ← يحجب الاتصال بـ https://*.supabase.co
//  - script-src-attr 'none' ← يحجب معالجات onclick= التي يولّدها app.js
//  - غياب 'unsafe-inline' ← يحجب سكربت index.html الداخلي
// في الإنتاج تُقدّم هذه الملفات نفسها بلا CSP (env.ASSETS عبر Cloudflare)،
// فنضيف هنا الحد الأدنى الذي يجعل المعاينة مطابقة للسلوك الفعلي.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      connectSrc: ["'self'", "https://*.supabase.co"],
    },
  },
}));
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per window
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// API routes - mount auth routes
app.use('/api/auth', authRoutes);

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve the static SPA (index.html + app.js + styles.css) locally;
// on Cloudflare Workers the same files are served via env.ASSETS.
app.use(express.static('public'));

// SPA fallback: أي مسار واجهة (مثل /sales أو /login) يعيد index.html
// بنفس سلوك not_found_handling=single-page-application في wrangler.jsonc.
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});