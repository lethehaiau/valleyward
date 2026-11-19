// VALLEYWARD · actors bench: production build of preview/actors.html (for honest frame numbers) into a scratch folder.
//   npx vite build --config preview/actors.vite.config.js        (from the game root)
//   npx vite preview --config preview/actors.vite.config.js      → http://127.0.0.1:5355/preview/actors.html
import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.ACTORS_OUT || path.resolve(APP, '.scratch/actors/dist');

export default defineConfig({
  root: APP,
  base: './',
  css: { postcss: { plugins: [] } },
  resolve: { dedupe: ['three'] },
  build: { outDir: OUT, emptyOutDir: true, target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 2500,
    rollupOptions: { input: { actors: path.join(APP, 'preview/actors.html') } } },
  server: { host: '127.0.0.1', port: 5355, strictPort: true },
  preview: { host: '127.0.0.1', port: 5355, strictPort: true },
});
