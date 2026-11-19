import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { audioAssets } from '../tools/vite-audio.mjs';

// pres bench captures run from a static build: the dev server reloads the page whenever a file is saved,
// so captures run against `vite build` of the game + the pres bench, served by `vite preview` on port 5356.
//   npx vite build --config preview/pres.vite.config.js --outDir <dir>   then   npx vite preview --config preview/pres.vite.config.js --outDir <dir>
const root = resolve(import.meta.dirname, '..');
export default defineConfig({
  root,
  base: './',
  plugins: [audioAssets()],
  css: { postcss: { plugins: [] } },
  resolve: { dedupe: ['three'] },
  preview: { host: '127.0.0.1', port: 5356, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, assetsInlineLimit: 0, emptyOutDir: true,
    rollupOptions: { input: { main: resolve(root, 'index.html'), pres: resolve(root, 'preview/pres.html') } } },
});
