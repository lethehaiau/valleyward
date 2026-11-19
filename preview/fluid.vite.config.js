// Fluid bench production build (perf numbers come from this, served by `vite preview`):
//   npx vite build --config preview/fluid.vite.config.js --outDir <scratch> --emptyOutDir
//   npx vite preview --config preview/fluid.vite.config.js --outDir <scratch> --port 5353 --strictPort
import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export default defineConfig({
  root: app,
  base: './',
  css: { postcss: { plugins: [] } },
  resolve: { dedupe: ['three'] },
  server: { host: '127.0.0.1', port: 5353, strictPort: true },
  preview: { host: '127.0.0.1', port: 5353, strictPort: true },
  build: { target: 'es2022', rollupOptions: { input: { fluid: path.join(app, 'preview/fluid.html') } }, assetsInlineLimit: 0 },
});
