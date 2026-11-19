// VALLEYWARD · actors · the sprite atlas: loads public/assets/sprites/actors.{png,json} (made by
// assets-src/sprites/pipeline/build.mjs) or, when they are missing, draws a stand-in atlas of coloured cards on a canvas
// with the same layout schema, so the module always works. Also builds the frame table texture the sprite shader reads
// (texelFetch: row 0 = uv rect, row 1 = size and pivot in metres).
//
// Atlas JSON schema (docs/ACTORS.md §Atlas):
//   { version, image, width, height,
//     frames: [{ n, x, y, w, h, ax, ay, ppm }]   pixel rect (top-left origin), pivot (ax from the left, ay from the
//                                               bottom, px), pixels per metre
//     kinds: { grunt|imp|spear|brute: { walk[4], attack[2], burn[2], death[3] },
//              troll: { walk[4], smash[2], throw[2], stomp[2], death[3], glow: { frameIdx: glowFrameIdx } },
//              items: { gem, coin, heart, spear, boulder, firebomb } },
//     fps: { walk, attack, burn, death } }
import * as THREE from 'three';
import { BODY } from '../shared/arena.js';
import { ENEMY_KINDS } from '../shared/events.js';

/** @typedef {{ n: string, x: number, y: number, w: number, h: number, ax: number, ay: number, ppm: number }} Frame */

/**
 * @param {string} assetsBase  e.g. import.meta.env.BASE_URL + 'assets/'
 * @returns {Promise<{ json: any, texture: THREE.Texture, frameTex: THREE.DataTexture, stand: boolean }>}
 */
/** The atlas table, always revalidated (a force-cached old table paired with a re-packed
 *  image once drew every frame across two sprites). null when missing. */
export async function fetchAtlasJson(assetsBase) {
  try {
    const r = await fetch(`${assetsBase}sprites/actors.json`, { cache: 'no-cache' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
/** `file?v=<hash>`: a content-versioned URL (the pipeline writes the hashes into actors.json). */
export const versioned = (url, hash) => (hash ? `${url}?v=${hash}` : url);

export async function loadAtlas(assetsBase, preJson) {
  let json = null, image = null;
  try {
    json = preJson !== undefined ? preJson : await fetchAtlasJson(assetsBase);
    if (json) {
      // the lossless WebP first; if it cannot be decoded, the pixel-identical PNG (each with its own hash)
      try { image = await loadImage(versioned(`${assetsBase}sprites/${json.image}`, json.hash)); }
      catch (e) {
        if (!json.fallback) throw e;
        console.warn('[actors] atlas', json.image, 'failed; loading', json.fallback.image);
        image = await loadImage(versioned(`${assetsBase}sprites/${json.fallback.image}`, json.fallback.hash));
      }
    }
  } catch { json = null; image = null; }
  let stand = false;
  if (!json || !image) { ({ json, image } = standInAtlas()); stand = true; }
  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapNearestFilter; // the shader picks the level from the pixel footprint
  texture.generateMipmaps = true;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 1;
  texture.needsUpdate = true;
  return { json, texture, frameTex: frameTable(json), stand };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`atlas image failed: ${url}`));
    img.src = url;
  });
}

/** Frame table: width = frames, height = 2. Row 0: u0, v0, u1, v1 (flipY texture). Row 1: wM, hM, pivotXM, pivotYM. */
export function frameTable(json) {
  const n = json.frames.length;
  const data = new Float32Array(n * 2 * 4);
  const W = json.width, H = json.height;
  json.frames.forEach((f, i) => {
    const o0 = i * 4, o1 = (n + i) * 4;
    data[o0] = f.x / W; data[o0 + 1] = 1 - (f.y + f.h) / H; data[o0 + 2] = (f.x + f.w) / W; data[o0 + 3] = 1 - f.y / H;
    data[o1] = f.w / f.ppm; data[o1 + 1] = f.h / f.ppm; data[o1 + 2] = f.ax / f.ppm; data[o1 + 3] = f.ay / f.ppm;
  });
  const t = new THREE.DataTexture(data, n, 2, THREE.RGBAFormat, THREE.FloatType);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------------------------------------ stand-in atlas
// Coloured pixel cards in the right sizes and palette, used until the generated art exists (or if it fails to load).
const KIND_LOOK = {
  grunt: { body: '#6f7a3a', cloth: '#5a4a3a', px: 44, w: 34 },
  imp: { body: '#a3352a', cloth: '#3a2420', px: 34, w: 28 },
  spear: { body: '#6f7a3a', cloth: '#6a5a48', px: 46, w: 34 },
  brute: { body: '#5f6a4a', cloth: '#4a3424', px: 60, w: 52 },
  chief: { body: '#6f7a3a', cloth: '#3a2a20', px: 62, w: 44 },
  hexer: { body: '#6f7a3a', cloth: '#3e3830', px: 50, w: 34 },
  douser: { body: '#6f7a3a', cloth: '#5a6470', px: 42, w: 32 },
};

function standInAtlas() {
  const W = 1024, H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  /** @type {Frame[]} */
  const frames = [];
  const kinds = {};
  let x = 8, y = 8, rowH = 0;
  const place = (w, h) => {
    if (x + w + 8 > W) { x = 8; y += rowH + 8; rowH = 0; }
    const at = { x, y };
    x += Math.ceil((w + 8) / 8) * 8; rowH = Math.max(rowH, Math.ceil(h / 8) * 8);
    return at;
  };
  const outline = '#1a1418';
  const fig = (ox, oy, w, h, look, pose, k) => {
    // pose: { legA, legB, armUp, lie, fire }
    const cx = ox + w / 2;
    const headR = Math.round(h * 0.2);
    g.fillStyle = outline;
    if (pose.lie) {
      g.fillRect(ox + 1, oy + h - 12, w - 2, 11);
      g.fillStyle = pose.fire ? '#3a2a24' : look.body; g.fillRect(ox + 2, oy + h - 11, w - 4, 9);
      return;
    }
    const bodyTop = oy + headR * 2 - 2, bodyH = Math.round(h * 0.42);
    g.fillRect(cx - w * 0.3 - 1, bodyTop - 1, w * 0.6 + 2, bodyH + 2);
    g.fillRect(cx - headR - 1, oy - 1 + (pose.drop || 0), headR * 2 + 2, headR * 2 + 2);
    g.fillRect(cx - w / 2, oy + headR * 0.6, w, 5); // ears
    g.fillStyle = look.cloth; g.fillRect(cx - w * 0.3, bodyTop, w * 0.6, bodyH);
    g.fillStyle = look.body; g.fillRect(cx - headR, oy + (pose.drop || 0), headR * 2, headR * 2);
    g.fillRect(cx - w / 2 + 1, oy + headR * 0.6 + 1, w - 2, 3);
    g.fillStyle = '#e8e0a0'; g.fillRect(cx - headR * 0.6, oy + headR * 0.7, 3, 3); g.fillRect(cx + headR * 0.6 - 3, oy + headR * 0.7, 3, 3);
    const legY = bodyTop + bodyH, legH = oy + h - legY;
    g.fillStyle = outline;
    g.fillRect(cx - w * 0.25 + pose.legA - 1, legY, 7, legH); g.fillRect(cx + w * 0.25 - 6 + pose.legB, legY, 7, legH);
    g.fillStyle = look.body;
    g.fillRect(cx - w * 0.25 + pose.legA, legY, 5, legH - 1); g.fillRect(cx + w * 0.25 - 5 + pose.legB, legY, 5, legH - 1);
    const armY = pose.armUp ? oy - 2 : bodyTop + 2;
    g.fillStyle = outline; g.fillRect(cx + w * 0.3, armY, 6, bodyH * 0.8);
    g.fillStyle = look.body; g.fillRect(cx + w * 0.3 + 1, armY + 1, 4, bodyH * 0.8 - 2);
    if (pose.fire) {
      g.fillStyle = '#ff9a2e'; g.fillRect(cx - w * 0.3, bodyTop - 4, w * 0.6, 8);
      g.fillStyle = '#ffd24a'; g.fillRect(cx - 4, oy - 6, 8, 8);
      g.fillStyle = '#e85a1c'; g.fillRect(cx - w * 0.2, bodyTop + 6, w * 0.4, 5);
    }
    if (k === 'brute') { g.fillStyle = outline; g.fillRect(ox + 2, bodyTop - 3, w - 4, bodyH + 8); g.fillStyle = '#5a3a24'; g.fillRect(ox + 4, bodyTop - 1, w - 8, bodyH + 4); g.fillStyle = '#3a3a3a'; g.fillRect(ox + 4, bodyTop + 6, w - 8, 3); }
    if (k === 'spear') { g.fillStyle = '#4a3a2a'; g.fillRect(cx + w * 0.3 + 2, oy - 8, 2, h); g.fillStyle = '#9aa0a0'; g.fillRect(cx + w * 0.3 + 1, oy - 12, 4, 6); }
  };
  const addFrame = (n, w, h, draw, ppm, pivot = 'feet') => {
    const at = place(w, h);
    draw(at.x, at.y, w, h);
    frames.push({ n, x: at.x, y: at.y, w, h, ax: w / 2, ay: pivot === 'feet' ? 0 : h / 2, ppm });
    return frames.length - 1;
  };
  for (const k of ENEMY_KINDS) {
    const look = KIND_LOOK[k] || KIND_LOOK.grunt;
    const h = look.px, w = look.w, ppm = h / BODY[k].height;
    const rec = { walk: [], attack: [], burn: [], death: [] };
    const walk = [{ legA: -2, legB: 2 }, { legA: 0, legB: 0, drop: -1 }, { legA: 2, legB: -2 }, { legA: 0, legB: 0, drop: -1 }];
    walk.forEach((p, i) => rec.walk.push(addFrame(`${k}.walk.${i}`, w, h, (ox, oy) => fig(ox, oy, w, h, look, p, k), ppm)));
    rec.attack.push(addFrame(`${k}.attack.0`, w, h, (ox, oy) => fig(ox, oy, w, h, look, { legA: 0, legB: 0, armUp: true }, k), ppm));
    rec.attack.push(addFrame(`${k}.attack.1`, w, h, (ox, oy) => fig(ox, oy, w, h, look, { legA: -2, legB: 3 }, k), ppm));
    rec.burn.push(addFrame(`${k}.burn.0`, w, h, (ox, oy) => fig(ox, oy, w, h, look, { legA: -3, legB: 2, armUp: true, fire: true }, k), ppm));
    rec.burn.push(addFrame(`${k}.burn.1`, w, h, (ox, oy) => fig(ox, oy, w, h, look, { legA: 3, legB: -2, fire: true }, k), ppm));
    rec.death.push(addFrame(`${k}.death.0`, w, h, (ox, oy) => fig(ox, oy, w, h, look, { legA: 0, legB: 0, drop: 2 }, k), ppm));
    rec.death.push(addFrame(`${k}.death.1`, w, Math.round(h * 0.6), (ox, oy) => fig(ox, oy, w, Math.round(h * 0.6), look, { legA: 0, legB: 0 }, k), ppm));
    rec.death.push(addFrame(`${k}.death.2`, w, 12, (ox, oy) => fig(ox, oy, w, 12, look, { lie: true }, k), ppm));
    kinds[k] = rec;
  }
  // troll: grey-black ash giant with a trunk
  const tw = 110, th = 160, tppm = th / BODY.troll.height;
  const troll = { walk: [], smash: [], throw: [], stomp: [], death: [], glow: {} };
  const tfig = (ox, oy, pose) => {
    g.fillStyle = outline; g.fillRect(ox + 14, oy + 18, tw - 28, th - 50); g.fillRect(ox + 40, oy, 30, 26);
    g.fillStyle = '#3a3c40'; g.fillRect(ox + 16, oy + 20, tw - 32, th - 54); g.fillStyle = '#4a4d52'; g.fillRect(ox + 42, oy + 2, 26, 22);
    g.fillStyle = '#ff9a2e'; g.fillRect(ox + 47, oy + 10, 4, 3); g.fillRect(ox + 59, oy + 10, 4, 3);
    g.fillStyle = outline; g.fillRect(ox + 28 + (pose.l || 0), oy + th - 34, 18, 34); g.fillRect(ox + tw - 46 + (pose.r || 0), oy + th - 34, 18, 34);
    g.fillStyle = '#5a4030'; g.fillRect(ox + (pose.trunkX ?? 4), oy + (pose.trunkY ?? 40), 12, 90);
  };
  const tframe = (n, pose) => {
    const i = addFrame(n, tw, th, (ox, oy) => tfig(ox, oy, pose), tppm);
    const gi = addFrame(`${n}.glow`, tw, th, (ox, oy) => {
      g.fillStyle = '#ff7a20';
      for (let j = 0; j < 40; j++) g.fillRect(ox + 18 + ((j * 37) % (tw - 40)), oy + 24 + ((j * 53) % (th - 70)), 2 + (j % 3), 2);
    }, tppm);
    troll.glow[i] = gi;
    return i;
  };
  [0, 1, 2, 3].forEach((i) => troll.walk.push(tframe(`troll.walk.${i}`, { l: i === 0 ? -4 : i === 2 ? 4 : 0, r: i === 0 ? 4 : i === 2 ? -4 : 0 })));
  troll.smash.push(tframe('troll.smash.0', { trunkY: 0 })); troll.smash.push(tframe('troll.smash.1', { trunkY: 60 }));
  troll.throw.push(tframe('troll.throw.0', { trunkY: 50 })); troll.throw.push(tframe('troll.throw.1', { trunkY: 50 }));
  troll.stomp.push(tframe('troll.stomp.0', { l: -10 })); troll.stomp.push(tframe('troll.stomp.1', { l: 6 }));
  [0, 1, 2].forEach((i) => troll.death.push(tframe(`troll.death.${i}`, { trunkY: 60 + i * 10 })));
  kinds.troll = troll;
  // items
  const items = {};
  const item = (n, w, h, color, ppm, pivot = 'center') => addFrame(`item.${n}`, w, h, (ox, oy) => {
    g.fillStyle = outline; g.fillRect(ox, oy, w, h); g.fillStyle = color; g.fillRect(ox + 1, oy + 1, w - 2, h - 2);
  }, ppm, pivot);
  items.gem = item('gem', 8, 12, '#bff4ff', 32); items.coin = item('coin', 10, 10, '#e8d27a', 32); items.heart = item('heart', 12, 11, '#c8343a', 32);
  items.spear = item('spear', 48, 4, '#7a5a3a', 30); items.boulder = item('boulder', 28, 26, '#6a6a66', 24); items.firebomb = item('firebomb', 14, 16, '#8a5a3a', 40);
  // stand-ins for the later items, Brother Cinder (a dark hooded card), the Chain Imp (a post + a black imp card)
  items.charm = item('charm', 10, 12, '#d8d0c0', 32); items.ember = item('ember', 8, 12, '#e8602a', 36);
  items.bucket = item('bucket', 14, 14, '#5a4030', 20); items.hex = item('hex', 12, 12, '#7ce070', 22);
  items.hook = item('hook', 16, 8, '#2a2a2e', 30); items.chain = item('chain', 22, 4, '#3a3a40', 32);
  const card = (n, w, h, color, ppm) => addFrame(n, w, h, (ox, oy) => {
    g.fillStyle = outline; g.fillRect(ox, oy, w, h); g.fillStyle = color; g.fillRect(ox + 1, oy + 1, w - 2, h - 2);
    g.fillStyle = '#ff8a2a'; g.fillRect(ox + (w >> 1) - 4, oy + 8, 2, 2); g.fillRect(ox + (w >> 1) + 2, oy + 8, 2, 2);
  }, ppm);
  kinds.cinder = { idle: [0, 1, 2, 3].map((i) => card(`cinder.idle.${i}`, 30, 48, '#2c2a2e', 34)), talk: [0, 1].map((i) => card(`cinder.talk.${i}`, 34, 48, '#2c2a2e', 34)) };
  kinds.chainimp = { idle: [0, 1].map((i) => card(`chainimp.idle.${i}`, 24, 24, '#222024', 38)), throw: [0, 1, 2].map((i) => card(`chainimp.throw.${i}`, 26, 28, '#222024', 38)),
    perch: [0, 1, 2].map((i) => item(`perch.${i}`, 10, 40 + i * 10, '#2e2c30', 38, 'feet')), perchTop: [1.05, 1.32, 1.58] };
  kinds.items = items;
  return { json: { version: 1, image: null, width: W, height: H, frames, kinds, fps: { walk: 8, attack: 5, burn: 10, death: 12 }, standIn: true }, image: cv };
}
