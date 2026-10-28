// تجميع Worker في ملف ESM واحد قبل النشر
// -----------------------------------------
// Cloudflare Workers لا يدعم require() وقت التشغيل، لذلك ندمج:
//   worker.js (الجذر) + api/stock-balance-api.js + oracle-stock-balance.js
// في ملف واحد: dist/worker.js
//
// الاستخدام: node scripts/bundle-worker.mjs
// ثم يُنشر dist/worker.js عبر sites-manifest.json

import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

const result = await build({
  entryPoints: ['worker.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/worker.js',
  conditions: ['workerd', 'worker', 'browser'],
  mainFields: ['browser', 'module', 'main'],
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
  define: {
    'process.env.NODE_ENV': '"production"'
  }
});

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(`\n✅ bundle OK -> dist/worker.js (${(bytes / 1024).toFixed(1)} KB)`);
