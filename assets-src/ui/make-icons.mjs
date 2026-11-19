#!/usr/bin/env node
// UI · slice the Codex icon sheet (card-icons-sheet.png, 4 × 4 on flat magenta) into the shipped pixel atlas
// public/assets/ui/card-icons.png: magenta keyed out, each cell trimmed to its icon, fitted into a 48 px cell, alpha
// thresholded (hard pixel edges). Run from the repo root: node assets-src/ui/make-icons.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
// `make-icons.mjs <sheet.png> <out.png> [cells=4] [cell=48]` slices any 4 × 4 sheet (v2-icons-a/-b); cells=1
// keys a single picture (the Brother Cinder portrait) into one cell of `cell` px.
const SRC = process.argv[2] ? path.resolve(process.argv[2]) : path.join(here, 'card-icons-sheet.png');
const OUT = process.argv[3] ? path.resolve(process.argv[3]) : path.join(here, '../../public/assets/ui/card-icons.png');
const N = Number(process.argv[4]) || 4, CELL = Number(process.argv[5]) || 48, PAD = 2;

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
// key: distance from magenta → alpha
for (let i = 0; i < W * H; i++) {
  const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
  const mag = Math.min(r, b) - g; // high for magenta
  const isKey = r > 150 && b > 150 && g < 110 && mag > 90;
  if (isKey) { data[i * 4 + 3] = 0; }
}
const tiles = [];
for (let row = 0; row < N; row++) for (let col = 0; col < N; col++) {
  const x0 = Math.round(col * W / N), x1 = Math.round((col + 1) * W / N), y0 = Math.round(row * H / N), y1 = Math.round((row + 1) * H / N);
  // trim to the opaque bounds
  let bx0 = x1, by0 = y1, bx1 = x0, by1 = y0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (data[(y * W + x) * 4 + 3] > 0) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  }
  const w = bx1 - bx0 + 1, h = by1 - by0 + 1, side = Math.max(w, h);
  const cell = Buffer.alloc(side * side * 4, 0);
  const ox = Math.floor((side - w) / 2), oy = Math.floor((side - h) / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((by0 + y) * W + (bx0 + x)) * 4, d = ((oy + y) * side + (ox + x)) * 4;
    data.copy(cell, d, s, s + 4);
  }
  const inner = CELL - PAD * 2;
  const small = await sharp(cell, { raw: { width: side, height: side, channels: 4 } }).resize(inner, inner, { kernel: 'cubic' }).raw().toBuffer();
  for (let i = 0; i < inner * inner; i++) {
    const a = small[i * 4 + 3];
    if (a < 110) { small[i * 4 + 3] = 0; } else {
      // un-premultiply drift: pull edge colours away from magenta, then make opaque
      small[i * 4 + 3] = 255;
      const r = small[i * 4], g = small[i * 4 + 1], b = small[i * 4 + 2];
      if (r > 140 && b > 140 && g < 120) { small[i * 4] = 20; small[i * 4 + 1] = 24; small[i * 4 + 2] = 28; }
    }
  }
  tiles.push({ input: await sharp(small, { raw: { width: inner, height: inner, channels: 4 } }).png().toBuffer(), left: col * CELL + PAD, top: row * CELL + PAD });
}
await sharp({ create: { width: N * CELL, height: N * CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(tiles).png({ compressionLevel: 9 }).toFile(OUT);
console.log('wrote', OUT, `${N * CELL}×${N * CELL}`);
