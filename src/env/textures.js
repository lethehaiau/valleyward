// @ts-check
// Environment · pixel textures (docs/ART-DIRECTION.md §5): Codex-generated 64×64 / 32×32 tiles (public/assets/tex/*.webp),
// NearestFilter for magnification, mip-mapped minification (no shimmer), repeat. A tile that fails to load falls back to
// a procedural pixel tile in the same palette, so the world never shows a missing texture. Also the small procedural
// sprites the place needs (flames, grass tufts, fog noise).
import * as THREE from 'three';
import { rng } from './util.js';

const NAMES = ['stone', 'blocks', 'flag', 'timber', 'earth', 'road', 'grass', 'roof', 'iron', 'pine', 'cloth', 'banner', 'thatch', 'mud']; // DESIGN §9: cloth, banner; DESIGN §8: thatch, mud
const FALLBACK = {
  stone: ['#3a4652', '#4a5560', '#59646d', '#2e3740'], blocks: ['#3a4652', '#4a5560', '#5b6670', '#2a323a'],
  flag: ['#3d4853', '#4c5762', '#5c6670', '#262d34'], timber: ['#3a2a21', '#4b3626', '#5e4430', '#2a1d16'],
  earth: ['#3b3a34', '#47443c', '#55503f', '#2f2d28'], road: ['#4a3f33', '#574a3a', '#3d342b', '#6a6152'],
  grass: ['#2b4a3a', '#355743', '#22392f', '#41664c'], roof: ['#2f3a44', '#3b4752', '#48545e', '#232b33'],
  iron: ['#2c2b2e', '#3a393c', '#4a4848', '#1d1c1f'], pine: ['#1f3a33', '#27473c', '#30574a', '#18302a'],
  cloth: ['#4a5a68', '#3d4b57', '#5d6250', '#4b5042'],
  thatch: ['#8a7d5a', '#6f6448', '#a39572', '#3e3829'], mud: ['#6e604c', '#5a4f40', '#807158', '#4a3b2c'],
};

/** Fallback for the goblins' banner (DESIGN §9): a bone cloth with a charcoal lamp crossed out by a crimson slash. */
function procBanner() {
  const W = 40, H = 60;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  const r = rng(77);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const tail = y > 44 && Math.abs(x - 20) < (y - 44) * 0.9;           // the swallow-tail cut
    if (x < 4 || x > 35 || y < 3 || tail || (y > 56 && r() < 0.5)) continue;
    g.fillStyle = ['#b9b29a', '#a9a28a', '#8a8470'][Math.floor(r() * r() * 3)];
    g.fillRect(x, y, 1, 1);
  }
  g.fillStyle = '#26282b';
  g.fillRect(14, 22, 12, 2); g.fillRect(15, 24, 2, 10); g.fillRect(23, 24, 2, 10); g.fillRect(19, 24, 2, 10);
  g.fillRect(14, 34, 12, 2); g.fillRect(17, 19, 6, 3); g.fillRect(19, 13, 2, 6); g.fillRect(18, 15, 1, 3); g.fillRect(21, 14, 1, 3);
  g.fillStyle = '#6e1a1a';
  for (let k = 0; k < 30; k++) g.fillRect(8 + k * 0.8, 10 + k * 1.2, 3, 2);
  return new THREE.CanvasTexture(cv);
}

/** @param {THREE.Texture} t @param {number} aniso */
function pixelate(t, aniso) {
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

function procTile(name, size = 64) {
  const pal = FALLBACK[name] || FALLBACK.stone;
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  const r = rng(name.length * 97 + size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    g.fillStyle = pal[Math.floor(r() * r() * pal.length)];
    g.fillRect(x, y, 1, 1);
  }
  return new THREE.CanvasTexture(cv);
}

/**
 * @param {string} assetsBase @param {THREE.WebGLRenderer} renderer
 * @returns {Promise<Record<string, THREE.Texture>>}
 */
export async function loadTextures(assetsBase, renderer) {
  // (WebGLRenderer: capabilities.getMaxAnisotropy(); WebGPURenderer: getMaxAnisotropy())
  const aniso = Math.min(8, (renderer.capabilities ? renderer.capabilities.getMaxAnisotropy?.() : renderer.getMaxAnisotropy?.()) || 1);
  const loader = new THREE.TextureLoader();
  const out = /** @type {Record<string, THREE.Texture>} */ ({});
  await Promise.all(NAMES.map(async (n) => {
    try { out[n] = pixelate(await loader.loadAsync(`${assetsBase}tex/${n}.webp`), aniso); }
    catch { out[n] = pixelate(n === 'banner' ? procBanner() : procTile(n, n === 'iron' || n === 'pine' ? 32 : 64), aniso); }
  }));
  out.banner.wrapS = out.banner.wrapT = THREE.ClampToEdgeWrapping;   // one sprite, not a tile
  return out;
}

const RAMP = ['#4a1612', '#a3241a', '#e85a1c', '#ff9a2e', '#ffd24a', '#fff2b8']; // ART-DIRECTION §7 hybrid ramp

/** A strip of pixel flame frames (W×H px each), the 6-colour fire ramp, alpha = 0 outside. */
export function makeFlameAtlas(frames = 6, W = 16, H = 24) {
  const cv = document.createElement('canvas'); cv.width = W * frames; cv.height = H;
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  const r = rng(7);
  const noise = [];
  for (let i = 0; i < 64 * 64; i++) noise.push(r());
  const nz = (x, y) => {
    const xi = Math.floor(x) & 63, yi = Math.floor(y) & 63, xf = x - Math.floor(x), yf = y - Math.floor(y);
    const a = noise[yi * 64 + xi], b = noise[yi * 64 + ((xi + 1) & 63)], c = noise[((yi + 1) & 63) * 64 + xi], d = noise[((yi + 1) & 63) * 64 + ((xi + 1) & 63)];
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  for (let f = 0; f < frames; f++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W - 0.5, v = 1 - (y + 0.5) / H; // v: 0 bottom, 1 top
      const width = 0.46 * (1 - v) ** 0.75 + 0.03;
      const sway = 0.08 * Math.sin(f / frames * Math.PI * 2 + v * 5) * v;
      const n = nz(x * 0.55 + f * 0.9, y * 0.45 + f * 2.7) * 0.6 + nz(x * 1.3 - f * 1.7, y * 1.1 + f * 4.1) * 0.4;
      let k = 1 - Math.abs(u - sway) / width;               // 1 on the axis, 0 at the edge
      k = k * (1.05 - v * 0.85) + (n - 0.5) * 0.75;
      if (v < 0.08) k -= 0.25;
      if (k <= 0.05) continue;
      const idx = Math.min(5, Math.floor(k * 6.2));
      g.fillStyle = RAMP[idx];
      g.fillRect(f * W + x, y, 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A 32×32 pixel grass tuft (alpha-tested card). */
export function makeTuftTexture() {
  const S = 32;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  const r = rng(31);
  const pal = ['#1f3431', '#29443d', '#334f45', '#3d5a4b', '#4a6150', '#566a55'];
  for (let b = 0; b < 14; b++) {
    let x = 4 + r() * (S - 8); const h = 10 + r() * 20; const lean = (r() - 0.5) * 0.7;
    const c = pal[Math.floor(r() * pal.length)];
    for (let y = 0; y < h; y++) {
      g.fillStyle = y > h * 0.7 ? pal[Math.min(5, pal.indexOf(c) + 1)] : c;
      g.fillRect(Math.round(x), S - 1 - y, 1, 1);
      x += lean * (y / h);
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft tiling value noise for the fog layers (single channel in all). */
export function makeFogNoise(S = 128) {
  const data = new Uint8Array(S * S * 4);
  const r = rng(5);
  const grid = (n) => { const a = []; for (let i = 0; i < n * n; i++) a.push(r()); return a; };
  const octs = [[4, 0.5], [8, 0.28], [16, 0.14], [32, 0.08]].map(([n, w]) => ({ n, w, g: grid(n) }));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0;
    for (const o of octs) {
      const fx = (x / S) * o.n, fy = (y / S) * o.n;
      const xi = Math.floor(fx), yi = Math.floor(fy), xf = fx - xi, yf = fy - yi;
      const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
      const at = (i, j) => o.g[((j % o.n + o.n) % o.n) * o.n + ((i % o.n + o.n) % o.n)];
      const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
      v += (a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w) * o.w;
    }
    const k = Math.max(0, Math.min(255, Math.round(v * 255)));
    data.set([k, k, k, 255], (y * S + x) * 4);
  }
  const t = new THREE.DataTexture(data, S, S);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
