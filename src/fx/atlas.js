// @ts-check
// The FX pixel atlas, drawn once on a canvas: 8 × 8 tiles of 16 px, nearest-filtered so every particle reads as
// chunky pixels (pixel puffs, squares and rings). Tiles are white shapes (the shader tints them) with
// black outlines where a tile needs one (digits), so additive particles lose the outline and alpha ones keep it.
import * as THREE from 'three';

export const TILE = Object.freeze({
  square: 0, disc: 1, flash: 2, star: 3, ring: 4, thinRing: 5, puff: 6, streak: 7, plus: 8, shard: 9,
  digit0: 10, // 10..19 = digits 0..9
  diamond: 20, chunk: 21, ember: 22, bigStar: 23, bang: 24,
});
export const TILES_PER_ROW = 8;
const T = 16;

// 5 × 7 digits (our own bitmap), '1' = pixel
const DIGITS = [
  ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
];
const BANG = ['00100', '00100', '00100', '00100', '00100', '00000', '00100'];

/** @returns {THREE.CanvasTexture | null} */
export function makeAtlas() {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = T * TILES_PER_ROW;
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  g.imageSmoothingEnabled = false;
  const at = (i) => [(i % TILES_PER_ROW) * T, Math.floor(i / TILES_PER_ROW) * T];
  const px = (i, x, y, c, a = 1) => { const [ox, oy] = at(i); g.globalAlpha = a; g.fillStyle = c; g.fillRect(ox + x, oy + y, 1, 1); g.globalAlpha = 1; };
  const each = (i, fn) => { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const r = fn(x - 7.5, y - 7.5, x, y); if (r) px(i, x, y, r[0], r[1]); } };
  const W = '#ffffff';
  // 0 square (14 × 14, a 1 px margin so nearest sampling never bleeds)
  each(TILE.square, (dx, dy) => (Math.abs(dx) < 7 && Math.abs(dy) < 7 ? [W, 1] : null));
  // 1 disc (hard pixel circle)
  each(TILE.disc, (dx, dy) => (dx * dx + dy * dy < 6.6 * 6.6 ? [W, 1] : null));
  // 2 flash: bright core, a stepped outer band at 55 %, a dithered rim at 25 %
  each(TILE.flash, (dx, dy, x, y) => {
    const d = Math.hypot(dx, dy);
    if (d < 4.2) return [W, 1];
    if (d < 6.6) return [W, 0.55];
    return null;
  });
  // 3 star: a 4-point sparkle
  each(TILE.star, (dx, dy) => {
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < 1 && ay < 7) return [W, ay < 3 ? 1 : 0.7];
    if (ay < 1 && ax < 7) return [W, ax < 3 ? 1 : 0.7];
    if (ax < 2 && ay < 2) return [W, 1];
    return null;
  });
  // 4 ring (2 px thick), 5 thin ring (1 px)
  each(TILE.ring, (dx, dy) => { const d = Math.hypot(dx, dy); return d > 5 && d < 7.3 ? [W, 1] : null; });
  each(TILE.thinRing, (dx, dy) => { const d = Math.hypot(dx, dy); return d > 6.1 && d < 7.3 ? [W, 1] : null; });
  // 6 puff: three overlapping discs, dithered edge
  each(TILE.puff, (dx, dy, x, y) => {
    const a = Math.hypot(dx + 2, dy - 1.2), b = Math.hypot(dx - 2.4, dy - 1.6), c = Math.hypot(dx - 0.2, dy + 2.4);
    const m = Math.min(a - 4.2, b - 4.0, c - 4.4);
    if (m < -0.8) return [W, 1];
    if (m < 0.6 && (x + y) % 2 === 0) return [W, 0.65];
    return null;
  });
  // 7 streak: vertical bar with a bright core (stretched along velocity)
  each(TILE.streak, (dx, dy) => { const ax = Math.abs(dx); return ax < 1 ? [W, 1] : ax < 2 ? [W, 0.45] : null; });
  // 8 plus
  each(TILE.plus, (dx, dy) => { const ax = Math.abs(dx), ay = Math.abs(dy); return (ax < 2 && ay < 6) || (ay < 2 && ax < 6) ? [W, 1] : null; });
  // 9 shard: a chunky triangle
  each(TILE.shard, (dx, dy) => (dy > -6 && dy < 5 && Math.abs(dx) < (dy + 6) * 0.5 ? [W, 1] : null));
  // 10..19 digits: 5 × 7 at 2 px per pixel (10 × 14), a black 1 px outline
  for (let d = 0; d < 10; d++) drawGlyph(TILE.digit0 + d, DIGITS[d]);
  drawGlyph(TILE.bang, BANG);
  function drawGlyph(tile, rows) {
    const on = (gx, gy) => gy >= 0 && gy < 7 && gx >= 0 && gx < 5 && rows[gy][gx] === '1';
    const x0 = 3, y0 = 1;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const gx = Math.floor((x - x0) / 2), gy = Math.floor((y - y0) / 2);
      const inside = x >= x0 && y >= y0 && x < x0 + 10 && y < y0 + 14 && on(gx, gy);
      if (inside) { px(tile, x, y, W); continue; }
      let near = false;
      for (let oy = -1; oy <= 1 && !near; oy++) for (let ox = -1; ox <= 1 && !near; ox++) {
        const xx = x + ox, yy = y + oy;
        const gx2 = Math.floor((xx - x0) / 2), gy2 = Math.floor((yy - y0) / 2);
        if (xx >= x0 && yy >= y0 && xx < x0 + 10 && yy < y0 + 14 && on(gx2, gy2)) near = true;
      }
      if (near) px(tile, x, y, '#000000');
    }
  }
  // 20 diamond (gem twinkle)
  each(TILE.diamond, (dx, dy) => (Math.abs(dx) + Math.abs(dy) < 6.5 ? [W, Math.abs(dx) + Math.abs(dy) < 3 ? 1 : 0.75] : null));
  // 21 chunk: a lumpy debris block
  each(TILE.chunk, (dx, dy) => (Math.abs(dx) < 5.5 && Math.abs(dy) < 4.5 && !(Math.abs(dx) > 4 && Math.abs(dy) > 3) ? [W, 1] : null));
  // 22 ember: a 4 × 4 square with a 1 px halo
  each(TILE.ember, (dx, dy) => { const m = Math.max(Math.abs(dx), Math.abs(dy)); return m < 2 ? [W, 1] : m < 3 ? [W, 0.4] : null; });
  // 23 big star: 8-point burst
  each(TILE.bigStar, (dx, dy) => {
    const ax = Math.abs(dx), ay = Math.abs(dy), d = Math.hypot(dx, dy);
    if (d < 2.2) return [W, 1];
    if ((ax < 1 || ay < 1) && d < 7.4) return [W, 1];
    if (Math.abs(ax - ay) < 1 && d < 5.6) return [W, 0.8];
    return null;
  });

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
