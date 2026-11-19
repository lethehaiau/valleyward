// Environment textures (the banner and the awning cloth): Codex raws (raw/banner.png, raw/cloth.png from props.jobs.json) → pixel textures in public/assets/tex.
//   banner.webp: 40×60 RGBA, nearest-sampled, the magenta ground keyed to alpha (the goblins' crossed-out-lamp banner)
//   cloth.webp:  64×64 RGB, nearest-sampled awning canvas for Brother Cinder's stall (stripes run along V)
//   node assets-src/env/props.process.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(HERE, '../../public/assets/tex');
const jobs = JSON.parse(fs.readFileSync(path.join(HERE, 'props.jobs.json'), 'utf8'));
const provFile = path.join(OUT, 'provenance.json');
const prov = JSON.parse(fs.readFileSync(provFile, 'utf8'));

async function banner() {
  const src = path.join(HERE, 'raw/banner.png');
  const W = 40, H = 60;
  const { data } = await sharp(src).removeAlpha().resize(W, H, { kernel: 'nearest', fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const magenta = Math.min(r, b) - g;          // the keyed ground: r and b high, g low
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = magenta > 30 ? 0 : 255;
  }
  await sharp(out, { raw: { width: W, height: H, channels: 4 } }).webp({ lossless: true }).toFile(path.join(OUT, 'banner.webp'));
}
async function cloth() {
  const src = path.join(HERE, 'raw/cloth.png');
  await sharp(src).removeAlpha().resize(64, 64, { kernel: 'nearest', fit: 'fill' }).webp({ lossless: true }).toFile(path.join(OUT, 'cloth.webp'));
}
await banner(); await cloth();
for (const j of jobs) {
  prov.files[`${j.id}.webp`] = {
    tool: `Codex CLI image generation (GPT Image 2.5, $0) → props.process.mjs (${j.id === 'banner' ? '40×60 nearest, magenta keyed to alpha' : '64×64 nearest'}, lossless WebP)`,
    prompt: j.prompt, raw: j.out, date: '2026-11-13',
  };
}
fs.writeFileSync(provFile, JSON.stringify(prov, null, 1));
console.log('ok', fs.statSync(path.join(OUT, 'banner.webp')).size, fs.statSync(path.join(OUT, 'cloth.webp')).size);
