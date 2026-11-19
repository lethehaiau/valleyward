// Environment textures: Codex pixel-art swatches (raw/*.png) → exact pixel tiles (public/assets/tex/*.webp, lossless).
// Downsample (cubic) to the tile size, make organic tiles seamless (half-offset copy picked per pixel by a hashed weight,
// so pixels stay crisp), cut the palette (libimagequant via sharp), write lossless WebP + provenance.json.
//   node assets-src/env/tex.process.mjs        (from the repo root or anywhere)
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(HERE, '../../public/assets/tex');
const jobs = JSON.parse(fs.readFileSync(path.join(HERE, 'tex.jobs.json'), 'utf8'));
// size: texels per tile; seam: blend a half-offset copy (organic textures only); colours: palette size
const TILES = {
  stone: { size: 64, seam: true, colours: 14 }, blocks: { size: 64, seam: false, colours: 12 },
  flag: { size: 64, seam: false, colours: 12 }, timber: { size: 64, seam: false, colours: 12, sat: 0.62, bright: 0.92 },
  earth: { size: 64, seam: true, colours: 12 }, road: { size: 64, seam: true, colours: 12 },
  grass: { size: 64, seam: true, colours: 12 }, roof: { size: 64, seam: false, colours: 10 },
  iron: { size: 32, seam: true, colours: 10 }, pine: { size: 32, seam: true, colours: 10 },
};
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
fs.mkdirSync(OUT, { recursive: true });
const prov = { tool: 'Codex CLI image generation (GPT Image 2.5, $0) → assets-src/env/tex.process.mjs', date: '2026-11-13', files: {} };
for (const j of jobs) {
  const s = TILES[j.id]; const src = path.resolve(HERE, '../..', j.out);
  if (!s || !fs.existsSync(src)) { console.log('skip', j.id); continue; }
  const N = s.size;
  let side = {}; try { side = JSON.parse(fs.readFileSync(`${src}.json`, 'utf8')); } catch { /* no sidecar */ }
  let img = sharp(src).removeAlpha();
  if (s.sat || s.bright) img = img.modulate({ saturation: s.sat ?? 1, brightness: s.bright ?? 1 });
  const { data } = await sharp(await img.png().toBuffer()).resize(N, N, { kernel: 'cubic', fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let px = Buffer.from(data);
  if (s.seam) {
    const out = Buffer.alloc(px.length);
    const f = (t) => Math.min(1, Math.sin(Math.PI * t) * 1.6); // 0 at the edges, 1 over the middle
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const w = f((x + 0.5) / N) * f((y + 0.5) / N);
      const useOrig = hash(x, y) < w;
      const sx = useOrig ? x : (x + N / 2) % N, sy = useOrig ? y : (y + N / 2) % N;
      for (let c = 0; c < 3; c++) out[(y * N + x) * 3 + c] = px[(sy * N + sx) * 3 + c];
    }
    px = out;
  }
  const pal = await sharp(px, { raw: { width: N, height: N, channels: 3 } }).png({ palette: true, colours: s.colours, dither: 0 }).toBuffer();
  const file = path.join(OUT, `${j.id}.webp`);
  await sharp(pal).webp({ lossless: true }).toFile(file);
  prov.files[`${j.id}.webp`] = { tool: `Codex CLI image generation (GPT Image 2.5) → ${s.sat ? `saturation ×${s.sat}, brightness ×${s.bright}, ` : ''}cubic downsample to ${N}×${N}, ${s.seam ? 'seam pick, ' : ''}${s.colours}-colour palette, lossless WebP`, prompt: j.prompt, refs: j.refs, raw: j.out, script: 'assets-src/env/tex.process.mjs', date: String(side.date || '2026-11-13').slice(0, 10), ...(side.date ? { generated: side.date } : {}) };
  console.log(j.id, N, fs.statSync(file).size, 'B');
}
// keep entries of files written by other scripts (sky etc.)
const pf = path.join(OUT, 'provenance.json');
if (fs.existsSync(pf)) {
  const old = JSON.parse(fs.readFileSync(pf, 'utf8'));
  for (const [k, v] of Object.entries(prov.files)) if (old.files[k]?.note && !v.note) v.note = old.files[k].note;   // keep hand-written notes
  prov.files = { ...old.files, ...prov.files };
}
prov.date = Object.values(prov.files).map((f) => f.date || '').sort().pop() || prov.date;   // the newest entry
fs.writeFileSync(pf, JSON.stringify(prov, null, 1));
