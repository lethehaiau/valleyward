// Side-by-side sheets (DESIGN §17.4): each key-art mockup next to the game's capture from the same view, 2 × 2 per sheet.
//   node tools/qa/sbs.mjs [--prefix p_]   (after tools/qa/shots.mjs) → <prefix>sbs_m1.jpg, …_m2.jpg beside the shots
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), APP = path.resolve(here, '../..'), ROOT = APP;
const { FFMPEG } = await import(path.join(ROOT, 'tools/platform.mjs'));
const argv = process.argv.slice(2), prefix = argv.includes('--prefix') ? argv[argv.indexOf('--prefix') + 1] : '';
const SH = path.join(ROOT, '.scratch/core/shots');
for (const m of ['m1', 'm2']) {
  const M = m.toUpperCase();
  const ins = [path.join(APP, `docs/mockups/${M}_smooth.jpg`), path.join(SH, `${prefix}${m}_full.jpg`), path.join(APP, `docs/mockups/${M}_hybrid.jpg`), path.join(SH, `${prefix}${m}_hybrid.jpg`)];
  if (!ins.every((f) => fs.existsSync(f))) { console.warn('missing', ins.filter((f) => !fs.existsSync(f))); continue; }
  const out = path.join(SH, `${prefix}sbs_${m}.jpg`);
  const f = '[0]scale=960:540[a];[1]scale=960:540[b];[2]scale=960:540[c];[3]scale=960:540[d];[a][b]hstack[t];[c][d]hstack[u];[t][u]vstack';
  const r = spawnSync(FFMPEG || 'ffmpeg', ['-y', '-loglevel', 'error', ...ins.flatMap((i) => ['-i', i]), '-filter_complex', f, '-q:v', '3', out]);
  console.log(r.status === 0 ? `sheet ${path.relative(ROOT, out)} (mockup left, game right; smooth top, hybrid bottom)` : String(r.stderr));
}
