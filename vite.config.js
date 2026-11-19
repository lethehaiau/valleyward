import { defineConfig, searchForWorkspaceRoot } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { audioAssets } from './tools/vite-audio.mjs';

const licenseFiles = {
  'LICENSE': './LICENSE',
  'ASSET-LICENSES.md': './ASSET-LICENSES.md',
  'licenses/three-MIT.txt': './node_modules/three/LICENSE',
  'licenses/Firewraith-MIT.txt': './node_modules/firewraith/LICENSE',
  'licenses/Firewraith-third-party-notices.md': './node_modules/firewraith/THIRD-PARTY-NOTICES.md',
  'licenses/Vite-LICENSE.md': './node_modules/vite/LICENSE.md',
  'licenses/Rolldown-MIT.txt': './node_modules/rolldown/LICENSE',
};

const licenseNotices = {
  name: 'valleyward-license-notices',
  apply: 'build',
  generateBundle() {
    for (const [fileName, sourcePath] of Object.entries(licenseFiles)) {
      this.emitFile({ type: 'asset', fileName, source: fs.readFileSync(new URL(sourcePath, import.meta.url)) });
    }
  },
};

// VALLEYWARD: `npm run dev` (port 5350) or `npm run build` → dist/ (relative base, so the build can be served from any
// path). The bench pages live in preview/ (README.md "Ports").
// Firewraith (the fire modules) is a package; with a local checkout linked in (`npm install --no-save ../firewraith`)
// its real folder is outside this one, so the dev server must be allowed to serve it, and `three` is deduped so a module
// and the game share one three.js.
// The audio files are not in the repo: tools/vite-audio.mjs adds them when present locally, else the game is silent.
const firewraith = (() => { try { return fs.realpathSync(path.resolve('node_modules/firewraith')); } catch { return null; } })();
export default defineConfig({
  base: './',
  plugins: [audioAssets(), licenseNotices],
  css: { postcss: { plugins: [] } },
  resolve: { dedupe: ['three'] },
  server: { host: '127.0.0.1', port: 5350, strictPort: true, fs: { allow: [searchForWorkspaceRoot(process.cwd()), ...(firewraith ? [firewraith] : [])] } },
  preview: { host: '127.0.0.1', port: 5351, strictPort: true },
  optimizeDeps: { entries: ['index.html'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500, assetsInlineLimit: 0 },
});
