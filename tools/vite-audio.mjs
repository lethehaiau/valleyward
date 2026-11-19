// The game's audio files are not in this repository: the sound effects, music and voice were generated with ElevenLabs
// under the authors' licence. This Vite plugin adds them to a dev server and to a build when the set is present locally,
// and builds a silent game when it is not.
//
// The set lives in `.private/audio/` (gitignored), or in the folder named by VALLEYWARD_AUDIO_DIR:
//   manifest.json   id → files, loop points, beat grid, content hash (written by assets-src/audio/build.mjs)
//   music/ sfx/ voice/
// - present: the dev server serves it at /assets/audio/, and a build copies it to <outDir>/assets/audio/;
// - absent: `__VW_AUDIO__` is false, so src/audio/index.js never requests a file and the game plays silent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AUDIO_DIR = path.resolve(ROOT, process.env.VALLEYWARD_AUDIO_DIR || '.private/audio');
export const HAS_AUDIO = fs.existsSync(path.join(AUDIO_DIR, 'manifest.json'));

const TYPES = { '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.json': 'application/json' };

export function audioAssets() {
  let outDir = null;
  return {
    name: 'valleyward-audio',
    config: () => ({ define: { __VW_AUDIO__: JSON.stringify(HAS_AUDIO) } }),
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); },
    configureServer(server) {
      if (!HAS_AUDIO) return;
      server.middlewares.use('/assets/audio', (req, res, next) => {
        const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
        const file = path.resolve(AUDIO_DIR, rel);
        if (!file.startsWith(AUDIO_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
        res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      if (!HAS_AUDIO || !outDir || !fs.existsSync(outDir)) return;
      fs.cpSync(AUDIO_DIR, path.join(outDir, 'assets/audio'), { recursive: true, filter: (src) => !path.basename(src).startsWith('.') });
    },
  };
}
