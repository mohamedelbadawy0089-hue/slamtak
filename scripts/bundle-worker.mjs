// Bundle worker
import { build } from 'esbuild';

await build({
  entryPoints: ['worker.js'],
  bundle: true,
  outfile: 'dist/worker.js',
  format: 'esm',
  platform: 'neutral'
});

console.log('Worker bundled!');