import { defineConfig, searchForWorkspaceRoot } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { MODULES } from 'firewraith/modules';
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
// path). The bench pages live in preview/ (docs/DEVELOPING.md "Ports").
// Firewraith (the fire modules) is a package; with a local checkout linked in (`npm install --no-save ../firewraith`)
// its real folder is outside this one, so the dev server must be allowed to serve it, and `three` is deduped so a module
// and the game share one three.js.
// The audio files are not in the repo: tools/vite-audio.mjs adds them when present locally, else the game is silent.
const firewraith = (() => { try { return fs.realpathSync(path.resolve('node_modules/firewraith')); } catch { return null; } })();
function readDevFireCatalog() {
  const dir = firewraith && path.join(firewraith, 'dev');
  const manifest = dir && path.join(dir, 'catalog.json');
  const entries = manifest && fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8')) : [];
  if (!Array.isArray(entries)) throw new Error('Firewraith dev/catalog.json must contain an array of modules');
  const ids = new Set();
  const modules = entries.map(({ id, name, backend, slots, entry }) => {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id) || ids.has(id) ||
        Object.hasOwn(MODULES, id) || typeof name !== 'string' || !name.trim() ||
        !['webgl2', 'webgpu'].includes(backend) || !Array.isArray(slots) || !slots.length ||
        slots.some((slot) => !['lance', 'ground'].includes(slot))) {
      throw new Error(`Invalid or duplicate Firewraith dev module in ${manifest}: ${id}`);
    }
    if (typeof entry !== 'string' || !entry.endsWith('.js') ||
        entry.split('/').some((p) => !p || p === '.' || p === '..' || p.includes('\\'))) {
      throw new Error(`Invalid entry for Firewraith dev module ${id}: ${entry}`);
    }
    const file = path.join(dir, entry);
    if (!fs.existsSync(file) || !fs.realpathSync(file).startsWith(dir + path.sep) || !fs.statSync(file).isFile()) {
      throw new Error(`Missing Firewraith dev entry inside ${dir}: ${entry}`);
    }
    ids.add(id);
    return { id, name, backend, slots, url: '/node_modules/firewraith/dev/' + entry.split('/').map(encodeURIComponent).join('/') };
  });
  const lance = process.env.VALLEYWARD_DEV_LANCE || '';
  if (lance && !modules.some((m) => m.id === lance && m.slots.includes('lance'))) {
    throw new Error(`VALLEYWARD_DEV_LANCE=${lance} does not name a Lance in Firewraith's dev/catalog.json`);
  }
  return { modules, lance };
}

export default defineConfig(({ command, isPreview }) => ({
  base: './',
  plugins: [audioAssets(), licenseNotices],
  define: {
    __EW_LOCAL_FIRE__: JSON.stringify(command === 'serve' && !isPreview ? readDevFireCatalog() : { modules: [], lance: '' }),
  },
  css: { postcss: { plugins: [] } },
  resolve: { dedupe: ['three'] },
  server: { host: '127.0.0.1', port: 5350, strictPort: true, fs: { allow: [searchForWorkspaceRoot(process.cwd()), ...(firewraith ? [firewraith] : [])] } },
  preview: { host: '127.0.0.1', port: 5351, strictPort: true },
  optimizeDeps: { entries: ['index.html'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500, assetsInlineLimit: 0 },
}));
