// Environment bench production build (perf numbers on minified code). From the game root:
//   npx vite build --config preview/env.vite.config.js           → a gitignored scratch folder (outDir below)
//   npx vite preview --config preview/env.vite.config.js         → http://127.0.0.1:5354/preview/env.html
import { defineConfig, mergeConfig } from 'vite';
import base from '../vite.config.js';

const root = new URL('..', import.meta.url).pathname;
export default mergeConfig(base, defineConfig({
  root,
  build: {
    outDir: new URL('../.scratch/env/dist', import.meta.url).pathname, emptyOutDir: true,
    rollupOptions: { input: { env: new URL('./env.html', import.meta.url).pathname } },
  },
  preview: { port: 5354, strictPort: true },
}));
