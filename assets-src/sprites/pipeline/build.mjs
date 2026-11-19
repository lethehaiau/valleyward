#!/usr/bin/env node
// VALLEYWARD · ACTORS · sprite pipeline: raw Codex sheets (assets-src/sprites/raw/*.png, flat magenta background) →
// one power-of-two atlas + JSON in public/assets/sprites/, plus the viewmodel textures in public/assets/models/viewmodel/.
//
//   node assets-src/sprites/pipeline/build.mjs [--troll fine|base] [--contact <png>] [--vm-only]
//
// Steps per sheet: key out the magenta → split rows / frames by projection (expected counts per row; the closest gaps
// merge when the generator split a figure, e.g. a dropped club) → a palette per sheet (k-means on the figure pixels) →
// downscale each frame to the sprite's real resolution by MAJORITY VOTE of palette indices per target pixel (keeps hard
// pixel edges and the 1-px outline; no blur) → add a 1-px dark outline wherever the silhouette edge is not already dark
// → pivot at the feet (bottom row) and the torso's centroid → the troll's red-hot glow layer (its dark seams + eyes) →
// shelf-pack into a POT atlas with 8-px aligned cells and 8-px gutters (clean mip levels down to 1/8) → PNG + JSON.
// Node + sharp (a dev dependency). Deterministic (seeded k-means).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import crypto from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '../../..');
const RAW = path.join(APP, 'assets-src/sprites/raw');
const OUT_SPR = path.join(APP, 'public/assets/sprites');
const OUT_VM = path.join(APP, 'public/assets/models/viewmodel');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const TROLL = arg('troll', fs.existsSync(path.join(RAW, 'trollA_fine.png')) ? 'fine' : 'base');

// Body heights (m), mirrored from src/shared/arena.js BODY (kept here so the pipeline has no browser imports).
const BODY_H = { grunt: 1.1, imp: 0.85, spear: 1.2, brute: 1.9, troll: 7.0 };
const GOBLIN_PX = 44;                // the grunt's walk frame height in sprite pixels: sets the goblin art grid
const TROLL_PX = TROLL === 'fine' ? 160 : 56;
const GOBLIN_ROWS = [4, 4, 3];
const GOBLIN_NAMES = ['walk.0', 'walk.1', 'walk.2', 'walk.3', 'attack.0', 'attack.1', 'burn.0', 'burn.1', 'death.0', 'death.1', 'death.2'];
// visual height of the walk frame in metres relative to BODY (the spear-chucker's bundle sticks up above its head)
const VIS = { grunt: 1.08, imp: 1.0, spear: 1.22, brute: 1.0 };

// ------------------------------------------------------------------------------------------------ image helpers
async function loadRGBA(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}
// background = magenta, including the pinkish anti-aliased fringe the generator leaves at edges
const isBg = (r, g, b) => (Math.min(r, b) - g > 34 && r > 96 && b > 96 && Math.abs(r - b) < 120);

function fgMask(img) {
  const { data, w, h } = img;
  const m = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) m[i] = isBg(data[p], data[p + 1], data[p + 2]) ? 0 : 1;
  // drop isolated specks (≤ 2 neighbours)
  const out = new Uint8Array(m);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (!m[i]) continue;
    const n = m[i - 1] + m[i + 1] + m[i - w] + m[i + w] + m[i - w - 1] + m[i - w + 1] + m[i + w - 1] + m[i + w + 1];
    if (n <= 2) out[i] = 0;
  }
  return out;
}

/** Runs of indices where prof[i] > thr; merge gaps < minGap; then merge the smallest gaps until `want` runs remain. */
function runs(prof, thr, minGap, want) {
  let rs = [];
  let s = -1;
  for (let i = 0; i <= prof.length; i++) {
    const on = i < prof.length && prof[i] > thr;
    if (on && s < 0) s = i;
    if (!on && s >= 0) { rs.push([s, i - 1]); s = -1; }
  }
  // drop tiny runs that carry almost nothing (noise), unless needed
  const mass = (r) => { let m = 0; for (let i = r[0]; i <= r[1]; i++) m += prof[i]; return m; };
  const merged = [];
  for (const r of rs) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] < minGap) last[1] = r[1]; else merged.push([...r]);
  }
  rs = merged;
  while (want && rs.length > want) {
    // merge the pair with the smallest gap, but first absorb a tiny run (a detached flame, dust, a dropped weapon)
    let bi = -1, best = Infinity;
    const total = rs.reduce((a, r) => a + mass(r), 0);
    for (let i = 0; i < rs.length - 1; i++) {
      const gap = rs[i + 1][0] - rs[i][1];
      const small = Math.min(mass(rs[i]), mass(rs[i + 1])) / total;
      const score = gap * (small < 0.04 ? 0.2 : 1);
      if (score < best) { best = score; bi = i; }
    }
    rs.splice(bi, 2, [rs[bi][0], rs[bi + 1][1]]);
  }
  if (want && rs.length !== want) throw new Error(`expected ${want} runs, found ${rs.length}`);
  return rs;
}

/** Connected components (8-connected); the N largest are the frames, smaller parts (a detached flame, dust, a dropped
 *  weapon) join the nearest frame by bbox distance; frames are ordered into rows by centre y, then by centre x. */
function segmentCC(img, mask, rowCounts) {
  const { w, h } = img;
  const N = rowCounts.reduce((a, b) => a + b, 0);
  const lab = new Int32Array(w * h).fill(-1);
  const comps = [];
  const stack = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    const id = comps.length;
    let sp = 0; stack[sp++] = s; lab[s] = id;
    let x0 = w, x1 = -1, y0 = h, y1 = -1, area = 0;
    while (sp) {
      const i = stack[--sp]; const x = i % w, y = (i / w) | 0; area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx; if (mask[j] && lab[j] < 0) { lab[j] = id; stack[sp++] = j; }
      }
    }
    comps.push({ x0, y0, x1, y1, area });
  }
  comps.sort((a, b) => b.area - a.area);
  if (comps.length < N || comps[N - 1].area < comps[0].area * 0.08) return null;
  const frames = comps.slice(0, N).map((c) => ({ ...c }));
  const dist = (a, b) => Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.y0 - b.y1, b.y0 - a.y1));
  for (const c of comps.slice(N)) {
    if (c.area < 40) continue;
    let bi = 0, bd = Infinity;
    frames.forEach((f, i) => { const d = dist(c, f); if (d < bd) { bd = d; bi = i; } });
    if (bd > 160) continue;
    const f = frames[bi];
    f.x0 = Math.min(f.x0, c.x0); f.y0 = Math.min(f.y0, c.y0); f.x1 = Math.max(f.x1, c.x1); f.y1 = Math.max(f.y1, c.y1);
  }
  frames.sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
  const out = [];
  let k = 0;
  for (const n of rowCounts) { out.push(...frames.slice(k, k + n).sort((a, b) => (a.x0 + a.x1) - (b.x0 + b.x1))); k += n; }
  return out;
}

function segment(img, mask, rowCounts) {
  const cc = segmentCC(img, mask, rowCounts);
  if (cc) return cc;
  return segmentProj(img, mask, rowCounts);
}

function segmentProj(img, mask, rowCounts) {
  const { w, h } = img;
  const rowProf = new Float32Array(h);
  for (let y = 0; y < h; y++) { let c = 0; for (let x = 0; x < w; x++) c += mask[y * w + x]; rowProf[y] = c; }
  const rows = runs(rowProf, 2, 10, rowCounts.length);
  const frames = [];
  rows.forEach(([y0, y1], ri) => {
    const colProf = new Float32Array(w);
    for (let x = 0; x < w; x++) { let c = 0; for (let y = y0; y <= y1; y++) c += mask[y * w + x]; colProf[x] = c; }
    const cols = runs(colProf, 1, 6, rowCounts[ri]);
    for (const [x0, x1] of cols) {
      // tight bbox
      let bx0 = w, bx1 = -1, by0 = h, by1 = -1;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (mask[y * w + x]) {
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      }
      frames.push({ x0: bx0, y0: by0, x1: bx1, y1: by1 });
    }
  });
  return frames;
}

// ------------------------------------------------------------------------------------------------ palette
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function kmeans(samples, k, iters = 10) {
  const n = samples.length / 3;
  const R = rng(12345);
  const C = new Float32Array(k * 3);
  for (let j = 0; j < k; j++) { const i = Math.floor(R() * n); C[j * 3] = samples[i * 3]; C[j * 3 + 1] = samples[i * 3 + 1]; C[j * 3 + 2] = samples[i * 3 + 2]; }
  const acc = new Float64Array(k * 4);
  for (let it = 0; it < iters; it++) {
    acc.fill(0);
    for (let i = 0; i < n; i++) {
      const r = samples[i * 3], g = samples[i * 3 + 1], b = samples[i * 3 + 2];
      let bj = 0, bd = Infinity;
      for (let j = 0; j < k; j++) { const dr = r - C[j * 3], dg = g - C[j * 3 + 1], db = b - C[j * 3 + 2]; const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11; if (d < bd) { bd = d; bj = j; } }
      acc[bj * 4] += r; acc[bj * 4 + 1] += g; acc[bj * 4 + 2] += b; acc[bj * 4 + 3]++;
    }
    for (let j = 0; j < k; j++) if (acc[j * 4 + 3] > 0) { C[j * 3] = acc[j * 4] / acc[j * 4 + 3]; C[j * 3 + 1] = acc[j * 4 + 1] / acc[j * 4 + 3]; C[j * 3 + 2] = acc[j * 4 + 2] / acc[j * 4 + 3]; }
      else { const i = Math.floor(R() * n); C[j * 3] = samples[i * 3]; C[j * 3 + 1] = samples[i * 3 + 1]; C[j * 3 + 2] = samples[i * 3 + 2]; }
  }
  return C;
}
function nearest(C, r, g, b) {
  let bj = 0, bd = Infinity;
  for (let j = 0; j < C.length / 3; j++) { const dr = r - C[j * 3], dg = g - C[j * 3 + 1], db = b - C[j * 3 + 2]; const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11; if (d < bd) { bd = d; bj = j; } }
  return bj;
}

function cleanPalette(C) {
  for (let j = 0; j < C.length / 3; j++) {
    const r = C[j * 3], g = C[j * 3 + 1], b = C[j * 3 + 2];
    if (Math.min(r, b) - g > 22 && b > 70) { C[j * 3] = OUTLINE[0]; C[j * 3 + 1] = OUTLINE[1]; C[j * 3 + 2] = OUTLINE[2]; }
  }
  return C;
}

function sheetPalette(img, mask, frames, k) {
  const s = [];
  const { data, w } = img;
  for (const f of frames) for (let y = f.y0; y <= f.y1; y += 2) for (let x = f.x0; x <= f.x1; x += 2) {
    const i = y * w + x; if (!mask[i]) continue;
    s.push(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  }
  return cleanPalette(kmeans(Float32Array.from(s), k));
}

// ------------------------------------------------------------------------------------------------ downscale
/** Majority-vote downscale of a frame's bbox by `scale` → { w, h, px: Uint8ClampedArray RGBA }. */
function downscale(img, mask, f, scale, pal) {
  const sw = f.x1 - f.x0 + 1, sh = f.y1 - f.y0 + 1;
  const W = Math.max(1, Math.round(sw * scale)), H = Math.max(1, Math.round(sh * scale));
  const px = new Uint8ClampedArray(W * H * 4);
  const k = pal.length / 3;
  const votes = new Float32Array(k + 1);
  const { data, w } = img;
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
    votes.fill(0);
    const ax = f.x0 + (tx / W) * sw, bx = f.x0 + ((tx + 1) / W) * sw;
    const ay = f.y0 + (ty / H) * sh, by = f.y0 + ((ty + 1) / H) * sh;
    // sample the inner 80 % of the footprint (avoid straddling the neighbour block's edge)
    const ix0 = Math.floor(ax + (bx - ax) * 0.1), ix1 = Math.ceil(bx - (bx - ax) * 0.1);
    const iy0 = Math.floor(ay + (by - ay) * 0.1), iy1 = Math.ceil(by - (by - ay) * 0.1);
    for (let y = iy0; y < Math.max(iy0 + 1, iy1); y++) for (let x = ix0; x < Math.max(ix0 + 1, ix1); x++) {
      const i = y * w + x;
      if (!mask[i]) { votes[k] += 1; continue; }
      votes[nearest(pal, data[i * 4], data[i * 4 + 1], data[i * 4 + 2])] += 1;
    }
    let bj = k, bv = -1;
    // transparent wins only with a clear majority (keeps thin outlines and spear shafts)
    const tot = votes.reduce((a, b) => a + b, 0);
    for (let j = 0; j < k; j++) if (votes[j] > bv) { bv = votes[j]; bj = j; }
    const o = (ty * W + tx) * 4;
    if (votes[k] > tot * 0.62 || bv <= 0) { px[o + 3] = 0; continue; }
    px[o] = pal[bj * 3]; px[o + 1] = pal[bj * 3 + 1]; px[o + 2] = pal[bj * 3 + 2]; px[o + 3] = 255;
  }
  return { w: W, h: H, px };
}

const OUTLINE = [26, 20, 24];
const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;

/** Pad by 1 px and add a dark outline where the silhouette edge is not already dark; trim to the opaque bbox. */
function outline(fr) {
  const W = fr.w + 2, H = fr.h + 2;
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < fr.h; y++) for (let x = 0; x < fr.w; x++) {
    const s = (y * fr.w + x) * 4, d = ((y + 1) * W + x + 1) * 4;
    px[d] = fr.px[s]; px[d + 1] = fr.px[s + 1]; px[d + 2] = fr.px[s + 2]; px[d + 3] = fr.px[s + 3];
  }
  const add = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4; if (px[o + 3]) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = (ny * W + nx) * 4;
      if (px[n + 3] && lum(px[n], px[n + 1], px[n + 2]) > 58) { add.push(o); break; }
    }
  }
  for (const o of add) { px[o] = OUTLINE[0]; px[o + 1] = OUTLINE[1]; px[o + 2] = OUTLINE[2]; px[o + 3] = 255; }
  return trim({ w: W, h: H, px });
}

function trim(fr) {
  let x0 = fr.w, x1 = -1, y0 = fr.h, y1 = -1;
  for (let y = 0; y < fr.h; y++) for (let x = 0; x < fr.w; x++) if (fr.px[(y * fr.w + x) * 4 + 3]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return fr;
  const W = x1 - x0 + 1, H = y1 - y0 + 1;
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) px.set(fr.px.subarray(((y + y0) * fr.w + x0) * 4, ((y + y0) * fr.w + x0 + W) * 4), y * W * 4);
  return { w: W, h: H, px };
}

/** Pivot: x = centroid of the torso band (35–75 % of the height from the top), y = 0 (the feet, bottom row). */
function pivot(fr, mode = 'feet') {
  if (mode === 'center') return { ax: fr.w / 2, ay: fr.h / 2 };
  let sx = 0, n = 0;
  const ya = Math.floor(fr.h * 0.35), yb = Math.ceil(fr.h * 0.75);
  for (let y = ya; y < yb; y++) for (let x = 0; x < fr.w; x++) if (fr.px[(y * fr.w + x) * 4 + 3]) { sx += x + 0.5; n++; }
  return { ax: n ? Math.round(sx / n) : fr.w / 2, ay: 0 };
}

/** The troll's red-hot layer: its darkest interior seams + its eyes, as hot pixels (alpha = mask). */
function glowLayer(fr) {
  const { w, h, px } = fr;
  const L = [];
  const interior = (x, y) => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) return false;
      if (!px[(ny * w + nx) * 4 + 3]) return false;
    }
    return true;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4; if (!px[o + 3] || !interior(x, y)) continue;
    L.push(lum(px[o], px[o + 1], px[o + 2]));
  }
  L.sort((a, b) => a - b);
  const thr = L[Math.floor(L.length * 0.16)] ?? 0;
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4; if (!px[o + 3]) continue;
    const r = px[o], g = px[o + 1], b = px[o + 2];
    const eye = r > 150 && r > g * 1.4 && b < 90;
    const brown = r > b * 1.35 && r > 60; // the loincloth and the trunk do not glow
    if (eye || (interior(x, y) && lum(r, g, b) <= thr && !brown)) m[y * w + x] = eye ? 2 : 1;
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!m[i]) continue;
    let nb = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h && m[ny * w + nx]) nb++; }
    const c = m[i] === 2 ? [255, 242, 184] : nb >= 4 ? [255, 210, 74] : nb >= 3 ? [255, 154, 46] : [232, 90, 28];
    out.set([...c, 255], i * 4);
  }
  return { w, h, px: out };
}

// ------------------------------------------------------------------------------------------------ sheets
const frames = [];   // { n, fr: {w,h,px}, ax, ay, ppm }
const kinds = {};
const log = [];

async function goblinSheets() {
  const sheets = {};
  for (const k of ['grunt', 'imp', 'spear', 'brute']) {
    const img = await loadRGBA(path.join(RAW, `${k}.png`));
    const mask = fgMask(img);
    const segs = segment(img, mask, GOBLIN_ROWS);
    sheets[k] = { img, mask, segs };
  }
  // one art grid for every goblin sheet: the grunt's walk height sets the scale
  const gh = sheets.grunt.segs.slice(0, 4).map((f) => f.y1 - f.y0 + 1).sort((a, b) => a - b);
  const scale = GOBLIN_PX / ((gh[1] + gh[2]) / 2);
  for (const k of Object.keys(sheets)) {
    const { img, mask, segs } = sheets[k];
    const pal = sheetPalette(img, mask, segs, 22);
    const outs = segs.map((f) => outline(downscale(img, mask, f, scale, pal)));
    const walkH = outs.slice(0, 4).map((o) => o.h).sort((a, b) => a - b)[2];
    const ppm = walkH / (BODY_H[k] * VIS[k]);
    const rec = { walk: [], attack: [], burn: [], death: [] };
    outs.forEach((fr, i) => {
      const name = GOBLIN_NAMES[i];
      const pv = pivot(fr);
      frames.push({ n: `${k}.${name}`, fr, ...pv, ppm });
      rec[name.split('.')[0]].push(frames.length - 1);
    });
    kinds[k] = rec;
    log.push(`${k}: ${segs.length} frames, walk ${walkH}px, ppm ${ppm.toFixed(1)}, scale ${scale.toFixed(4)}`);
  }
}

async function trollSheets() {
  const sfx = TROLL === 'fine' ? '_fine' : '';
  const A = await loadRGBA(path.join(RAW, `trollA${sfx}.png`)); const mA = fgMask(A);
  const B = await loadRGBA(path.join(RAW, `trollB${sfx}.png`)); const mB = fgMask(B);
  const sA = segment(A, mA, [4, 3]);
  const sB = segment(B, mB, [3, 3]);
  const hA = sA.slice(0, 4).map((f) => f.y1 - f.y0 + 1).sort((a, b) => a - b);
  const walkSrc = (hA[1] + hA[2]) / 2;
  const scale = TROLL_PX / walkSrc;
  // sheet B was drawn at its own size: match its standing height to sheet A's (the strike/stomp frames stand tallest)
  const hB = [sB[2], sB[3], sB[5]].map((f) => f.y1 - f.y0 + 1).sort((a, b) => a - b)[1];
  const scaleB = scale * (walkSrc * 0.98) / hB;
  const pal = cleanPalette(kmeans(Float32Array.from([...samplePix(A, mA, sA), ...samplePix(B, mB, sB)]), 24));
  const ppm = TROLL_PX / BODY_H.troll;
  const troll = { walk: [], smash: [], throw: [], stomp: [], death: [], glow: {} };
  const add = (name, fr, list) => {
    const pv = pivot(fr);
    frames.push({ n: `troll.${name}`, fr, ...pv, ppm });
    const i = frames.length - 1; list.push(i);
    frames.push({ n: `troll.${name}.glow`, fr: glowLayer(fr), ...pv, ppm });
    troll.glow[i] = frames.length - 1;
  };
  const oA = sA.map((f) => outline(downscale(A, mA, f, scale, pal)));
  const oB = sB.map((f) => outline(downscale(B, mB, f, scaleB, pal)));
  oA.slice(0, 4).forEach((fr, i) => add(`walk.${i}`, fr, troll.walk));
  add('smash.0', oB[0], troll.smash); add('smash.1', oB[1], troll.smash);
  add('throw.0', oB[2], troll.throw); add('throw.1', oB[3], troll.throw);
  add('stomp.0', oB[4], troll.stomp); add('stomp.1', oB[5], troll.stomp);
  oA.slice(4).forEach((fr, i) => add(`death.${i}`, fr, troll.death));
  kinds.troll = troll;
  log.push(`troll (${TROLL}): walk ${TROLL_PX}px, ppm ${ppm.toFixed(1)}, scale A ${scale.toFixed(4)} B ${scaleB.toFixed(4)}`);
}
function samplePix(img, mask, segs) {
  const s = [];
  for (const f of segs) for (let y = f.y0; y <= f.y1; y += 3) for (let x = f.x0; x <= f.x1; x += 3) {
    const i = y * img.w + x; if (mask[i]) s.push(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]);
  }
  return s;
}

async function itemSheet() {
  const img = await loadRGBA(path.join(RAW, 'items.png'));
  const mask = fgMask(img);
  const segs = segment(img, mask, [3, 3]);
  const pal = sheetPalette(img, mask, segs, 20);
  // [name, target size in px along the longest side, size in metres along that side]
  const spec = [['gem', 13, 0.32], ['coin', 11, 0.28], ['heart', 12, 0.32], ['spear', 52, 1.7], ['boulder', 24, 1.3], ['firebomb', 16, 0.5]];
  const items = {};
  segs.forEach((f, i) => {
    const [n, px, m] = spec[i];
    const long = Math.max(f.x1 - f.x0 + 1, f.y1 - f.y0 + 1);
    const fr = outline(downscale(img, mask, f, px / long, pal));
    frames.push({ n: `item.${n}`, fr, ...pivot(fr, 'center'), ppm: Math.max(fr.w, fr.h) / m });
    items[n] = frames.length - 1;
  });
  kinds.items = items;
  log.push(`items: ${segs.length}`);
}

// ------------------------------------------------------------------------------------------------ DESIGN §9
// New goblins (chief, hexer, douser), Brother Cinder, the Chain Imp (imp frames + 3 perches) and the v2 items. Each new
// sheet gets its own scale so the figure lands on the goblin pixel density: `px` is the median walk/idle frame height in
// sprite pixels and `m` its visual height in metres (the banner, the staff and the perch included). Elites (chief, hexer)
// get a 1-px GOLD RIM outside the dark outline, marked by alpha 204 so the shader can light it (elites read as elites).
const V2 = {
  chief: { rows: GOBLIN_ROWS, names: GOBLIN_NAMES, px: 76, m: 2.35, elite: true },
  hexer: { rows: GOBLIN_ROWS, names: GOBLIN_NAMES, px: 58, m: 1.7, elite: true },
  douser: { rows: GOBLIN_ROWS, names: GOBLIN_NAMES, px: 42, m: 1.15 },
  cinder: { rows: [4, 2], names: ['idle.0', 'idle.1', 'idle.2', 'idle.3', 'talk.0', 'talk.1'], px: 50, m: 1.4 },
  // DESIGN §5.5: the Bat Gremlin (a goblin under a stitched bat-wing glider); pivot at its centre (state.air y = the body)
  batgremlin: { rows: GOBLIN_ROWS, names: ['fly.0', 'fly.1', 'fly.2', 'fly.3', 'dive.0', 'dive.1', 'burn.0', 'burn.1', 'death.0', 'death.1', 'death.2'], px: 36, m: 1.0, pivot: 'center' },
  // DESIGN §8: the Siege Ram crew, the demon (large and crisp for the reveal), the host, the hunt's villagers and animals
  ram: { rows: GOBLIN_ROWS, names: ['walk.0', 'walk.1', 'walk.2', 'walk.3', 'swing.0', 'swing.1', 'burn.0', 'burn.1', 'broken.0', 'broken.1', 'broken.2'], px: 52, m: 2.6 },   // the crew's goblins ≈ a grunt's 1.1 m
  demon: { rows: [2, 2], names: ['idle.0', 'idle.1', 'lift.0', 'roar.0'], px: 300, m: 5.4 },
  host: { rows: [4, 4], names: ['march.0', 'march.1', 'march.2', 'march.3', 'run.0', 'run.1', 'run.2', 'run.3'], px: 46, m: 1.9 },
  villagers: { rows: [3, 3, 3], names: ['mother.0', 'mother.1', 'mother.2', 'elder.0', 'elder.1', 'elder.2', 'child.0', 'child.1', 'child.2'], px: 40, m: 1.15 },
  animals: { rows: [3, 3, 2], names: ['deer.0', 'deer.1', 'deer.2', 'boar.0', 'boar.1', 'boar.2', 'bird.0', 'bird.1'], px: 48, m: 1.6 },
  cinderk: { rows: [2], names: ['kneel.0', 'kneel.1'], px: 38, m: 1.05 },
};
// DESIGN §6.3: the Rainmother (two sheets on one scale, 14 m ≈ 210 px) with a crack-glow layer per frame like the troll's
const RAIN_PX = 210, RAIN_M = 14;
async function rainSheets() {
  if (!has('rainA') || !has('rainB')) { log.push('rainmother: no raw sheets'); return; }
  const A = await loadRGBA(path.join(RAW, 'rainA.png')); const mA = fgMask(A);
  const B = await loadRGBA(path.join(RAW, 'rainB.png')); const mB = fgMask(B);
  const sA = segment(A, mA, [4, 4, 3]);
  const sB = segment(B, mB, [2, 2]);
  const walkSrc = medianH(sA, 4);
  const scale = RAIN_PX / walkSrc;
  const hB = sB.map((f) => f.y1 - f.y0 + 1).sort((a, b) => a - b)[1];
  const scaleB = scale * walkSrc / hB;
  const pal = cleanPalette(kmeans(Float32Array.from([...samplePix(A, mA, sA), ...samplePix(B, mB, sB)]), 26));
  const ppm = RAIN_PX / RAIN_M;
  const rec = { walk: [], rise: [], climb: [], collapse: [], tide: [], whirl: [], glow: {} };
  const add = (name, fr) => {
    const pv = pivot(fr);
    frames.push({ n: `rainmother.${name}`, fr, ...pv, ppm });
    const i = frames.length - 1; rec[name.split('.')[0]].push(i);
    frames.push({ n: `rainmother.${name}.glow`, fr: glowLayer(fr), ...pv, ppm });
    rec.glow[i] = frames.length - 1;
  };
  const namesA = ['walk.0', 'walk.1', 'walk.2', 'walk.3', 'rise.0', 'rise.1', 'climb.0', 'climb.1', 'collapse.0', 'collapse.1', 'collapse.2'];
  sA.forEach((f, i) => add(namesA[i], outline(downscale(A, mA, f, scale, pal))));
  ['tide.0', 'tide.1', 'whirl.0', 'whirl.1'].forEach((n, i) => add(n, outline(downscale(B, mB, sB[i], scaleB, pal))));
  kinds.rainmother = rec;
  log.push(`rainmother: ${sA.length + sB.length} frames + glow, ${RAIN_PX}px = ${RAIN_M} m (ppm ${ppm.toFixed(1)})`);
}
const RIM = [236, 190, 72];
function goldRim(fr) {
  const W = fr.w + 2, H = fr.h + 2;
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < fr.h; y++) px.set(fr.px.subarray(y * fr.w * 4, (y + 1) * fr.w * 4), ((y + 1) * W + 1) * 4);
  const add = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4; if (px[o + 3]) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (px[(ny * W + nx) * 4 + 3] === 255) { add.push(o); break; }
    }
  }
  for (const o of add) { px[o] = RIM[0]; px[o + 1] = RIM[1]; px[o + 2] = RIM[2]; px[o + 3] = 204; }
  return { w: W, h: H, px };
}
const has = (id) => fs.existsSync(path.join(RAW, `${id}.png`));
const medianH = (segs, n) => segs.slice(0, n).map((f) => f.y1 - f.y0 + 1).sort((a, b) => a - b)[Math.floor(n / 2)];

async function v2Sheets() {
  for (const [k, c] of Object.entries(V2)) {
    if (!has(k)) { log.push(`${k}: no raw sheet (stand-in frames in the runtime)`); continue; }
    const img = await loadRGBA(path.join(RAW, `${k}.png`));
    const mask = fgMask(img);
    const segs = segment(img, mask, c.rows);
    const scale = c.px / medianH(segs, c.rows[0]);
    const pal = sheetPalette(img, mask, segs, 24);
    const ppm = c.px / c.m;
    const rec = {};
    segs.forEach((f, i) => {
      let fr = outline(downscale(img, mask, f, scale, pal));
      const pv0 = pivot(fr, c.pivot === 'center' && !c.names[i].startsWith('death.2') ? 'center' : 'feet');
      if (c.elite) { fr = goldRim(fr); pv0.ax += 1; pv0.ay = 1; }
      const name = c.names[i];
      frames.push({ n: `${k}.${name}`, fr, ...pv0, ppm });
      (rec[name.split('.')[0]] ||= []).push(frames.length - 1);
    });
    if (rec.attack) { rec.cast = rec.attack; rec.throw = rec.attack; }
    if (c.elite) rec.elite = true;
    kinds[k] = rec;
    log.push(`${k}: ${segs.length} frames, ${c.px}px for ${c.m} m (ppm ${ppm.toFixed(1)}, scale ${scale.toFixed(4)})${c.elite ? ', gold rim' : ''}`);
  }
  // the Chain Imp: row 1 = the imp (idle 2, throw windup, release, pull), row 2 = the perch at levels 1..3
  if (has('chainimp')) {
    const img = await loadRGBA(path.join(RAW, 'chainimp.png'));
    const mask = fgMask(img);
    const segs = segment(img, mask, [5, 3]);
    const pal = sheetPalette(img, mask, segs, 24);
    const impPx = 30, impM = 0.78;
    const scale = impPx / medianH(segs, 2);
    const ppm = impPx / impM;
    const rec = { idle: [], throw: [], perch: [], perchTop: [] };
    const names = ['idle.0', 'idle.1', 'throw.0', 'throw.1', 'throw.2'];
    segs.forEach((f, i) => {
      const fr = outline(downscale(img, mask, f, scale, pal));
      if (i < 5) { frames.push({ n: `chainimp.${names[i]}`, fr, ...pivot(fr), ppm }); rec[i < 2 ? 'idle' : 'throw'].push(frames.length - 1); }
      else {
        frames.push({ n: `chainimp.perch.${i - 5}`, fr, ...pivot(fr), ppm });
        rec.perch.push(frames.length - 1);
        rec.perchTop.push(+(fr.h / ppm).toFixed(3));   // metres: where the imp's feet go (the perch's top)
      }
    });
    kinds.chainimp = rec;
    log.push(`chainimp: ${segs.length} frames, imp ${impPx}px = ${impM} m, perch tops ${rec.perchTop.join(' / ')} m`);
  } else log.push('chainimp: no raw sheet');
  if (has('items2')) {
    const img = await loadRGBA(path.join(RAW, 'items2.png'));
    const mask = fgMask(img);
    const segs = segment(img, mask, [3, 3]);
    const pal = sheetPalette(img, mask, segs, 22);
    const spec = [['charm', 12, 0.34], ['ember', 12, 0.3], ['bucket', 18, 0.7], ['hex', 14, 0.55], ['hook', 20, 0.55], ['chain', 24, 0.7]];
    segs.forEach((f, i) => {
      const [n, px, m] = spec[i];
      const long = Math.max(f.x1 - f.x0 + 1, f.y1 - f.y0 + 1);
      const fr = outline(downscale(img, mask, f, px / long, pal));
      frames.push({ n: `item.${n}`, fr, ...pivot(fr, 'center'), ppm: Math.max(fr.w, fr.h) / m });
      kinds.items[n] = frames.length - 1;
    });
    log.push(`items2: ${segs.length}`);
  } else log.push('items2: no raw sheet');
}

// ------------------------------------------------------------------------------------------------ pack + write
/** The atlas ships as LOSSLESS WebP (`exact`: the RGB under alpha 0 is kept, it carries the outline colour for
 *  clean mips) with an unfiltered PNG fallback (pixel art compresses better without PNG row filters); both are decoded
 *  back and compared with the source pixels byte for byte, or the build fails. Returns { webp, png } file names. */
async function writeAtlasImages(raw, W, H) {
  const webpF = path.join(OUT_SPR, 'actors.webp'), pngF = path.join(OUT_SPR, 'actors.png');
  const src = () => sharp(raw, { raw: { width: W, height: H, channels: 4 } });
  await src().webp({ lossless: true, exact: true, effort: 6 }).toFile(webpF);
  await src().png({ compressionLevel: 9, adaptiveFiltering: false }).toFile(pngF);
  for (const f of [webpF, pngF]) {
    const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== W || info.height !== H || data.length !== raw.length) throw new Error(`${f}: size mismatch`);
    for (let i = 0; i < raw.length; i++) if (data[i] !== raw[i]) throw new Error(`${f}: not pixel-identical at byte ${i}`);
  }
  log.push(`atlas images: actors.webp ${fs.statSync(webpF).size} B (lossless), actors.png ${fs.statSync(pngF).size} B (fallback), both pixel-identical`);
  return { webp: 'actors.webp', png: 'actors.png' };
}
/** The table's image fields: the WebP first, the PNG as the fallback, each with its own content hash. */
function imageFields() {
  return { image: 'actors.webp', hash: fileHash(path.join(OUT_SPR, 'actors.webp')),
    fallback: { image: 'actors.png', hash: fileHash(path.join(OUT_SPR, 'actors.png')) } };
}
/** First 10 hex digits of a file's SHA-1 (the cache-busting version of a shipped file). */
export function fileHash(file) { return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10); }
const VM_NAMES = ['leather', 'brass', 'iron', 'wood', 'cloth', 'strap'];
function vmHashes() { return Object.fromEntries(VM_NAMES.filter((n) => fs.existsSync(path.join(OUT_VM, `${n}.png`))).map((n) => [n, fileHash(path.join(OUT_VM, `${n}.png`))])); }

function pack() {
  const order = frames.map((f, i) => i).sort((a, b) => frames[b].fr.h - frames[a].fr.h || frames[b].fr.w - frames[a].fr.w);
  const al = (v) => Math.ceil(v / 8) * 8;
  for (const W of [512, 1024, 2048]) for (const H of [W / 2, W]) {
    let x = 8, y = 8, rowH = 0; let ok = true;
    const at = new Array(frames.length);
    for (const i of order) {
      const { w, h } = frames[i].fr;
      if (x + al(w) + 8 > W) { x = 8; y += rowH + 8; rowH = 0; }
      if (y + al(h) + 8 > H) { ok = false; break; }
      at[i] = { x, y }; x += al(w) + 8; rowH = Math.max(rowH, al(h));
    }
    if (ok) return { W, H, at };
  }
  throw new Error('atlas does not fit 2048²');
}

async function writeAtlas() {
  const { W, H, at } = pack();
  const buf = Buffer.alloc(W * H * 4);
  // transparent texels carry the outline colour so mip averaging darkens edges instead of fringing magenta/black
  for (let i = 0; i < W * H; i++) { buf[i * 4] = OUTLINE[0]; buf[i * 4 + 1] = OUTLINE[1]; buf[i * 4 + 2] = OUTLINE[2]; buf[i * 4 + 3] = 0; }
  const outFrames = frames.map((f, i) => {
    const { x, y } = at[i];
    for (let r = 0; r < f.fr.h; r++) Buffer.from(f.fr.px.buffer, f.fr.px.byteOffset + r * f.fr.w * 4, f.fr.w * 4).copy(buf, ((y + r) * W + x) * 4);
    return { n: f.n, x, y, w: f.fr.w, h: f.fr.h, ax: f.ax, ay: f.ay, ppm: +f.ppm.toFixed(3) };
  });
  fs.mkdirSync(OUT_SPR, { recursive: true });
  await writeAtlasImages(buf, W, H);
  // cache fix (a cached old atlas once drew a goblin cut between two sprites): the table names the atlas by a content hash so a browser can
  // never pair a cached table with a re-packed image (the runtime loads `actors.png?v=<hash>` and the json with no-cache)
  const json = { version: 3, ...imageFields(), vm: vmHashes(), width: W, height: H, troll: TROLL, frames: outFrames, kinds, fps: { walk: 8, attack: 5, burn: 10, death: 12 } };
  fs.writeFileSync(path.join(OUT_SPR, 'actors.json'), JSON.stringify(json));
  log.push(`atlas ${W}×${H}, ${outFrames.length} frames`);
  // contact sheet for review (×4, on a slate background), outside the repo
  const contact = arg('contact', path.resolve(APP, '.scratch/actors/atlas_contact.png'));
  fs.mkdirSync(path.dirname(contact), { recursive: true });
  const flat = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 58, g: 70, b: 82, alpha: 1 } } })
    .composite([{ input: path.join(OUT_SPR, 'actors.png'), left: 0, top: 0 }]).png().toBuffer(); // sharp resizes before compositing: two steps
  await sharp(flat).resize(W * 2, H * 2, { kernel: 'nearest' }).png().toFile(contact);
}

// The Codex swatches came out saturated warm (red-orange leather veins, orange wood, bright
// yellow brass), which read as lava marbling in the game, a warm colour outside ART-DIRECTION §3.1. Each swatch keeps its
// own luminance pattern but is re-toned to a muted mean colour (sRGB) like M1's Lance: dark brown leather and wood, dull
// brass, grey iron; `k` < 1 flattens the pattern's contrast (the leather veins), `keep` keeps a little of the hue.
const VM_GRADE = {
  leather: { rgb: [80, 62, 52], k: 0.25, keep: 0.0 },   // the glove's creases read as orange veins up close
  brass: { rgb: [126, 102, 62], k: 0.85, keep: 0.15 },
  iron: { rgb: [84, 88, 94], k: 1.0, keep: 0.0 },
  wood: { rgb: [70, 55, 44], k: 0.3, keep: 0.0 },   // plain brown, faint grain
  cloth: { rgb: [74, 76, 62], k: 1.0, keep: 0.3 },
  strap: { rgb: [60, 46, 40], k: 0.35, keep: 0.0 },
};
function gradeSwatch(buf, g) {
  if (!g) return buf;
  const n = buf.length / 3, L = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) { L[i] = 0.2126 * buf[i * 3] + 0.7152 * buf[i * 3 + 1] + 0.0722 * buf[i * 3 + 2]; mean += L[i]; }
  mean = Math.max(1, mean / n);
  const tL = 0.2126 * g.rgb[0] + 0.7152 * g.rgb[1] + 0.0722 * g.rgb[2];
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < n; i++) {
    const d = Math.pow(Math.max(0.02, L[i] / mean), g.k);
    for (let c = 0; c < 3; c++) {
      const mono = g.rgb[c] * d;
      const hue = buf[i * 3 + c] * (tL / mean) * Math.pow(Math.max(0.02, L[i] / mean), g.k - 1);  // original colour at the new level
      out[i * 3 + c] = Math.max(0, Math.min(255, Math.round(mono * (1 - g.keep) + hue * g.keep)));
    }
  }
  return out;
}

async function viewmodelTextures() {
  const img = await loadRGBA(path.join(RAW, 'vmtex.png'));
  const mask = fgMask(img);
  const segs = segment(img, mask, [3, 3]);
  const names = ['leather', 'brass', 'iron', 'wood', 'cloth', 'strap'];
  fs.mkdirSync(OUT_VM, { recursive: true });
  for (let i = 0; i < segs.length; i++) {
    const f = segs[i];
    const inset = Math.round((f.x1 - f.x0) * 0.015);
    const { data, info } = await sharp(path.join(RAW, 'vmtex.png'))
      .extract({ left: f.x0 + inset, top: f.y0 + inset, width: f.x1 - f.x0 + 1 - 2 * inset, height: f.y1 - f.y0 + 1 - 2 * inset })
      .resize(64, 64, { kernel: 'mitchell', fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const out = gradeSwatch(data, VM_GRADE[names[i]]);
    await sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).png({ compressionLevel: 9 }).toFile(path.join(OUT_VM, `${names[i]}.png`));
  }
  log.push(`viewmodel textures: ${segs.length} × 64², graded (VM_GRADE)`);
}

function generation(id) {
  const f = path.join(RAW, `${id}.png.json`);
  const j = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  return { id, tool: j.tool || 'codex exec (Codex CLI built-in image generation, GPT Image)', prompt: j.prompt || '', refs: j.refs || [], date: j.date || new Date().toISOString(), raw: `assets-src/sprites/raw/${id}.png` };
}

function writeProvenance() {
  const date = new Date().toISOString().slice(0, 10);
  const script = 'assets-src/sprites/pipeline/build.mjs';
  const sfx = TROLL === 'fine' ? '_fine' : '';
  const spr = {
    tool: 'Codex GPT Image sprite sheets (tools/codex-image.mjs, $0) → assets-src/sprites/pipeline/build.mjs (key, majority-vote downscale, palette, outline, pack)',
    date,
    files: {
      'actors.png': { tool: 'codex-image sheets + pipeline', script, date, manifest: 'assets-src/sprites/sprites.manifest.mjs',
        generations: ['grunt', 'imp', 'spear', 'brute', `trollA${sfx}`, `trollB${sfx}`, 'items', ...['chief', 'hexer', 'douser', 'cinder', 'chainimp', 'items2', 'batgremlin', 'ram', 'rainA', 'rainB', 'demon', 'host', 'villagers', 'animals', 'cinderk'].filter(has)].map(generation),
        note: 'Original designs for this game. Every sheet was regenerated on 2026-11-18 with no outside reference: the ' +
          'first-wave sheets (grunt, imp, spear, brute, trollA/B, items) and the Rainmother (rainA/B) from text-only prompts ' +
          'with no reference images; trollA_fine / trollB_fine attach only our own text-only trollA / trollB; the later ' +
          'sheets attach at most ONE of our own 2026-11-18 sheets as a style reference (grunt for chief, hexer, douser, ' +
          'cinder, chainimp, batgremlin, ram, host, villagers and animals; items for items2; trollA_fine for the demon; the ' +
          'new cinder for cinderk). No sheet attaches a key-art mockup. Each generation lists its own prompt and refs.' },
      'actors.webp': { tool: 'codex-image sheets + pipeline; lossless WebP (sharp webp lossless exact effort 6)', script, date, manifest: 'assets-src/sprites/sprites.manifest.mjs',
        postprocess: 'the same pixels as actors.png, verified byte for byte at build; the runtime loads this first' },
      'actors.json': { tool: 'pipeline', script, date, prompt: 'frame rects, pivots, pixels per metre, animation lists for actors.webp / actors.png' },
    },
  };
  fs.writeFileSync(path.join(OUT_SPR, 'provenance.json'), `${JSON.stringify(spr, null, 1)}\n`);
  const vm = {
    tool: 'Codex GPT Image texture swatch sheet (tools/codex-image.mjs, $0) → assets-src/sprites/pipeline/build.mjs (crop + 64×64)',
    date,
    files: Object.fromEntries(['leather', 'brass', 'iron', 'wood', 'cloth', 'strap'].map((n) => [`viewmodel/${n}.png`, { tool: 'codex-image swatch + pipeline', script, date, generations: [generation('vmtex')], postprocess: 'cropped from the swatch sheet, 64×64, then re-toned to a muted mean colour by VM_GRADE in assets-src/sprites/pipeline/build.mjs (since 2026-11-13; --vm-only re-grades without re-packing the atlas)' }])),
    note: 'The viewmodel meshes themselves are built in code (src/actors/viewmodel.js); only these textures are files. The ' +
      'swatch sheet (vmtex) was regenerated on 2026-11-18 from a text-only prompt with no reference image.',
  };
  fs.writeFileSync(path.join(APP, 'public/assets/models/provenance.json'), `${JSON.stringify(vm, null, 1)}\n`);
}

if (argv.includes('--vm-only')) {   // re-grade the viewmodel textures only (the atlas stays byte-identical)
  await viewmodelTextures();
} else if (argv.includes('--hash-only')) {   // re-stamp actors.json with the current file hashes (no re-pack)
  const jf = path.join(OUT_SPR, 'actors.json');
  const j = JSON.parse(fs.readFileSync(jf, 'utf8'));
  Object.assign(j, fs.existsSync(path.join(OUT_SPR, 'actors.webp')) ? imageFields() : { hash: fileHash(path.join(OUT_SPR, j.image)) });
  j.vm = vmHashes();
  fs.writeFileSync(jf, JSON.stringify(j));
  log.push(`hash ${j.hash}${j.fallback ? `, fallback ${j.fallback.hash}` : ''}, vm ${JSON.stringify(j.vm)}`);
} else if (argv.includes('--reencode')) {   // re-encode the current atlas pixels (no re-pack), re-stamp, provenance
  const jf = path.join(OUT_SPR, 'actors.json');
  const j = JSON.parse(fs.readFileSync(jf, 'utf8'));
  const srcF = path.join(OUT_SPR, j.fallback?.image || j.image);
  const { data, info } = await sharp(srcF).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== j.width || info.height !== j.height) throw new Error('atlas size differs from actors.json');
  const before = fs.statSync(srcF).size;
  await writeAtlasImages(Buffer.from(data), info.width, info.height);
  Object.assign(j, { version: 3, ...imageFields() }); j.vm = vmHashes();
  fs.writeFileSync(jf, JSON.stringify(j));
  const pf = path.join(OUT_SPR, 'provenance.json');
  const prov = JSON.parse(fs.readFileSync(pf, 'utf8'));
  prov.files['actors.webp'] = { tool: 'lossless WebP re-encode of actors.png (sharp webp lossless exact effort 6)', sameAs: 'actors.png',
    script: 'assets-src/sprites/pipeline/build.mjs --reencode', date: new Date().toISOString().slice(0, 10),
    postprocess: '2026-11-14: the same pixels as actors.png, verified byte for byte (RGBA, alpha 0 texels included); the runtime loads this first' };
  prov.files['actors.png'] = { ...prov.files['actors.png'],
    postprocess: `2026-11-14: re-encoded losslessly without PNG row filters (${before} → ${fs.statSync(path.join(OUT_SPR, 'actors.png')).size} B), pixel-identical; the fallback when WebP fails to decode` };
  fs.writeFileSync(pf, `${JSON.stringify(prov, null, 1)}\n`);
  log.push(`re-encoded from ${path.basename(srcF)} (${before} B); hash ${j.hash}, fallback ${j.fallback.hash}`);
} else {
  await goblinSheets();
  await trollSheets();
  await itemSheet();
  await v2Sheets();
  await rainSheets();
  await viewmodelTextures();
  await writeAtlas();
  writeProvenance();
}
console.log(log.join('\n'));
