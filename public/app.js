// Worker.js for Freebuff ERP Application
// Features: SPA routing, AES-GCM ticket verification, error protection

// مساعد esbuild `keepNames` الذي كان يُستدعى 43 مرة دون تعريفه، فيفشل تحميل
// الوحدة عند الرفع (Cloudflare 10021 / 400) — التعريف هنا يعيد التقييم بنجاح.
