// Environment textures (the village's thatch and mud): Codex raws (raw/thatch.png, raw/mud.png from village.jobs.json) → 64×64 pixel tiles in
// public/assets/tex (the goblin village's hut roofs and walls). Nearest-sampled, lossless WebP, provenance appended.
//   node assets-src/env/village.process.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(HERE, '../../public/assets/tex');
const jobs = JSON.parse(fs.readFileSync(path.join(HERE, 'village.jobs.json'), 'utf8'));
const provFile = path.join(OUT, 'provenance.json');
const prov = JSON.parse(fs.readFileSync(provFile, 'utf8'));
for (const j of jobs) {
  await sharp(path.join(HERE, `raw/${j.id}.png`)).removeAlpha().resize(64, 64, { kernel: 'nearest', fit: 'fill' }).webp({ lossless: true }).toFile(path.join(OUT, `${j.id}.webp`));
  prov.files[`${j.id}.webp`] = { tool: 'Codex CLI image generation (GPT Image 2.5, $0) → village.process.mjs (64×64 nearest, lossless WebP)', prompt: j.prompt, raw: j.out, date: '2026-11-14' };
}
fs.writeFileSync(provFile, JSON.stringify(prov, null, 1));
console.log('ok', jobs.map((j) => `${j.id} ${fs.statSync(path.join(OUT, `${j.id}.webp`)).size}`).join(', '));
