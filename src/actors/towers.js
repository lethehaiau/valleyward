// VALLEYWARD · actors · towers (DESIGN §9.6): reads the run's towers from the state and builds the HELLFIRE OBELISK in
// code: a black cube-cut stone needle (pixel-stone texture, like the keep) on a stepped plinth, a molten VIOLET core in
// a chamber under its cap and down its cracks, and glowing rune rings (1 / 2 / 3 by level; the needle grows 3.6 / 4.3 /
// 5.0 m). EV.OBELISK_PULSE flares the core, the cracks and the runes (the nova fire is the fire code's, its flash the FX's). The
// CHAIN IMP is a sprite in the crowd draw (crowd.js), placed from the same list.
//
// State read (from the sim): `state.run.towers` (or `state.towers`), either an array of `{ pad, type, level }` (pad = an
// ARENA.camp.pads id or index; x/z optional) or a map `{ [padId]: { type, level } }`; type 'obelisk' | 'chainimp'.
import * as THREE from 'three';
import { ARENA, groundHeight } from '../shared/arena.js';

const PADS = ARENA.camp.pads;
export const padKey = (pad) => (typeof pad === 'number' ? (PADS[pad]?.id ?? String(pad)) : String(pad));

/** Normalised towers this frame: `[{ key, type, level, x, y, z }]` (pooled objects; no allocation after warm-up). */
export function createTowerReader() {
  const pool = [], out = [];
  const take = (i) => (pool[i] ||= { key: '', type: '', level: 1, x: 0, y: 0, z: 0 });
  function push(padRef, t) {
    if (!t || typeof t !== 'object') return;
    const type = t.type || t.kind;
    if (type !== 'obelisk' && type !== 'chainimp') return;
    const pi = typeof padRef === 'number' ? padRef : PADS.findIndex((p) => p.id === padRef);
    const pad = PADS[pi];
    const x = t.x ?? pad?.x, z = t.z ?? pad?.z;
    if (x == null || z == null) return;
    const o = take(out.length);
    o.key = pad ? pad.id : String(padRef); o.type = type; o.level = Math.max(1, Math.min(5, (t.level | 0) || 1));   // DESIGN §9.6: 5 levels
    o.x = x; o.z = z; o.y = t.y ?? groundHeight(x, z);
    out.push(o);
  }
  return function read(state) {
    out.length = 0;
    const src = state?.run?.towers ?? state?.towers;
    if (!src) return out;
    if (Array.isArray(src)) src.forEach((t, i) => t && push(t.pad ?? t.padId ?? i, t));
    else for (const k of Object.keys(src)) push(k, src[k]);
    return out;
  };
}

// ------------------------------------------------------------------------------------------------ the obelisk
const LEVEL = [
  { h: 4.0, rings: [1.7] },
  { h: 4.8, rings: [1.5, 2.6] },
  { h: 5.6, rings: [1.4, 2.4, 3.4] },
  { h: 6.6, rings: [1.3, 2.2, 3.1, 4.0] },              // DESIGN §9.6: levels 4–5 grander (taller, more rune rings)
  { h: 7.8, rings: [1.2, 2.1, 3.0, 3.9, 4.8] },
];
const VIOLET = new THREE.Color(0.36, 0.05, 1.0);       // linear: the molten core (deep violet; bright only in a pulse)
const RUNE = new THREE.Color(0.5, 0.16, 1.0);          // linear: the rune glyphs
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function stoneTexture() {
  const N = 16, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const R = rng(7);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 34 + R() * 14;                               // basalt black, pixel noise
    if (x === 0 || y === 0) v += 18;                    // the cube-cut bevel catches light on top/left
    if (x === N - 1 || y === N - 1) v -= 14;
    if (R() < 0.05) v += 20;                            // a few glints
    g.fillStyle = `rgb(${v | 0},${(v * 0.97) | 0},${(v * 1.02) | 0})`;
    g.fillRect(x, y, 1, 1);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}

function runeTexture() {
  const W = 64, H = 8, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#fff';
  const R = rng(31);
  for (let gx = 1; gx < W - 4; gx += 6) {                // 3×5-pixel glyphs: a stroke, a bar and a dot or two
    const ox = gx, oy = 1;
    g.fillRect(ox + ((R() * 3) | 0), oy, 1, 6);
    g.fillRect(ox, oy + ((R() * 5) | 0), 3, 1);
    if (R() < 0.7) g.fillRect(ox + ((R() * 3) | 0), oy + ((R() * 6) | 0), 1, 1);
    if (R() < 0.5) g.fillRect(ox + 2, oy + ((R() * 3) | 0), 1, 2);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function merge(list) {
  // a tiny merge (positions, normals, uvs; all indexed BoxGeometry/PlaneGeometry/ConeGeometry parts)
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3); uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo;
    else for (let i = 0; i < n; i++) idx[io++] = i + vo;
    vo += n; g.dispose();
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); m.setIndex(new THREE.BufferAttribute(idx, 1));
  m.computeBoundingSphere();
  return m;
}

/** Geometries of one level: { stone, core, runes } (the needle stands at the origin, y up). */
function buildLevel(L) {
  const { h, rings } = LEVEL[L - 1];
  const R = rng(101 + L);
  const stone = [], core = [], runes = [];
  const at = (g, x, y, z, ry = 0) => { if (ry) g.rotateY(ry); g.translate(x, y, z); return g; };
  stone.push(at(new THREE.BoxGeometry(1.2, 0.3, 1.2), 0, 0.15, 0));
  stone.push(at(new THREE.BoxGeometry(0.88, 0.3, 0.88), 0, 0.45, 0, 0.02));
  const y0 = 0.6, chamber = 0.46, yTop = h - 0.62 - chamber;   // the shaft from y0 to yTop, the chamber, the cap
  const wAt = (y) => 0.6 + (0.34 - 0.6) * ((y - y0) / (yTop - y0));
  const nB = Math.max(4, Math.round((yTop - y0) / 0.48));
  const bh = (yTop - y0) / nB;
  core.push(at(new THREE.BoxGeometry(0.66, 0.03, 0.66), 0, y0 + 0.005, 0));        // the glowing seam on the plinth
  for (let b = 0; b < nB; b++) {
    const yb = y0 + b * bh, w = wAt(yb + bh / 2);
    const ox = (R() - 0.5) * 0.03, oz = (R() - 0.5) * 0.03, ry = (R() - 0.5) * 0.06;
    stone.push(at(new THREE.BoxGeometry(w, bh - 0.025, w), ox, yb + bh / 2, oz, ry));   // cube-cut blocks, gaps between
    core.push(at(new THREE.BoxGeometry(w * 0.9, 0.03, w * 0.9), ox, yb + 0.012, oz, ry)); // molten light in the joints
    // a crack down two faces of every other block (zig-zag), the core showing through
    if (b % 2 === 0 || L === 3) {
      const face = (b * 3 + L) % 4, a = face * Math.PI / 2, off = (R() - 0.5) * w * 0.4;
      const crack = new THREE.BoxGeometry(0.05, bh * 0.85, 0.02);
      crack.translate(off, 0, w / 2 + 0.004); crack.rotateY(a + ry); crack.translate(ox, yb + bh / 2, oz);
      core.push(crack);
    }
  }
  const wT = wAt(yTop);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {                     // the chamber's corner posts
    stone.push(at(new THREE.BoxGeometry(0.11, chamber, 0.11), sx * (wT / 2 - 0.055), yTop + chamber / 2, sz * (wT / 2 - 0.055)));
  }
  core.push(at(new THREE.BoxGeometry(wT * 0.7, chamber * 0.92, wT * 0.7), 0, yTop + chamber / 2, 0, Math.PI / 4)); // the molten heart
  stone.push(at(new THREE.BoxGeometry(wT + 0.1, 0.12, wT + 0.1), 0, yTop + chamber + 0.06, 0));
  const cap = new THREE.ConeGeometry(wT * 0.72, 0.7, 4, 1); cap.rotateY(Math.PI / 4); cap.translate(0, yTop + chamber + 0.12 + 0.35, 0);
  stone.push(cap);
  if (L >= 2) for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {         // horns on the cap's corners
    const s = new THREE.ConeGeometry(0.05, 0.28 + 0.1 * (L - 2), 4); s.translate(sx * (wT / 2 + 0.02), yTop + chamber + 0.26, sz * (wT / 2 + 0.02));
    stone.push(s);
  }
  for (let r = 0; r < rings.length; r++) {                                          // rune rings: a band on each face
    const yr = rings[r], w = wAt(yr) + 0.02;
    for (let f = 0; f < 4; f++) {
      const q = new THREE.PlaneGeometry(w * 0.86, 0.17);
      const uv = q.attributes.uv; const u0 = (f * 0.25 + r * 0.37) % 1;
      for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * 0.25 * (w / 0.6));
      q.translate(0, yr, w / 2 + 0.012); q.rotateY(f * Math.PI / 2);
      runes.push(q);
    }
  }
  return { stone: merge(stone), core: merge(core), runes: merge(runes), height: h };
}

/**
 * @param {{ scene: THREE.Scene }} o
 */
export function createObelisks({ scene }) {
  const levels = [null, null, null, null, null];
  const geo = (L) => (levels[L - 1] ||= buildLevel(L));
  const stoneTex = stoneTexture(), runeTex = runeTexture();
  const proto = {
    stone: new THREE.MeshLambertMaterial({ map: stoneTex, flatShading: true, emissive: new THREE.Color(0, 0, 0) }),
    core: new THREE.MeshBasicMaterial({ color: VIOLET.clone() }),
    runes: new THREE.MeshBasicMaterial({ map: runeTex, color: RUNE.clone(), alphaTest: 0.5, side: THREE.DoubleSide }),
  };
  const root = new THREE.Group(); root.name = 'actors.towers'; scene.add(root);
  // a hidden level-1 obelisk so warm()/compile() builds the three programs before the first tower is bought
  const warmGroup = new THREE.Group(); warmGroup.visible = false; root.add(warmGroup);
  { const g = geo(1); warmGroup.add(new THREE.Mesh(g.stone, proto.stone), new THREE.Mesh(g.core, proto.core), new THREE.Mesh(g.runes, proto.runes)); }

  /** key → { group, level, mats, pulse, ph, seen } */
  const live = new Map();
  const pendingPulse = new Map();
  let now = 0;
  const tmpC = new THREE.Color();

  function make(key, level) {
    const g = geo(level);
    const mats = { stone: proto.stone.clone(), core: proto.core.clone(), runes: proto.runes.clone() };
    const group = new THREE.Group(); group.name = `obelisk:${key}`;
    group.add(new THREE.Mesh(g.stone, mats.stone), new THREE.Mesh(g.core, mats.core), new THREE.Mesh(g.runes, mats.runes));
    root.add(group);
    return { group, level, mats, pulse: pendingPulse.get(key) || 0, ph: (key.length * 1.7) % 6.28, seen: true, bornT: now };
  }
  function drop(key, e) { root.remove(e.group); for (const m of Object.values(e.mats)) m.dispose(); live.delete(key); }

  function update(dt, towers) {
    now += dt;
    for (const e of live.values()) e.seen = false;
    for (const t of towers) {
      if (t.type !== 'obelisk') continue;
      let e = live.get(t.key);
      if (e && e.level !== t.level) { drop(t.key, e); e = null; }
      if (!e) { e = make(t.key, t.level); live.set(t.key, e); pendingPulse.delete(t.key); }
      e.seen = true;
      e.group.position.set(t.x, t.y, t.z);
      // rise out of the ground over 0.6 s when built or upgraded
      const born = Math.min(1, (now - e.bornT) / 0.6);
      e.group.scale.set(1, 0.2 + 0.8 * born * born * (3 - 2 * born), 1);
      e.pulse *= Math.exp(-dt * 3.2);
      const p = e.pulse, breath = Math.sin(now * 2.1 + e.ph);
      e.mats.core.color.copy(VIOLET).multiplyScalar(0.9 + 0.2 * breath + 4.5 * p);
      e.mats.runes.color.copy(RUNE).multiplyScalar(0.6 + 0.15 * Math.sin(now * 3.3 + e.ph) + 2.6 * p);
      e.mats.stone.emissive.copy(tmpC.copy(VIOLET).multiplyScalar(0.1 * p));
    }
    for (const [k, e] of live) if (!e.seen) drop(k, e);
  }

  function onEvent(ev) {
    if (ev.type === 'obelisk.pulse') {
      const key = padKey(ev.pad);
      const e = live.get(key);
      if (e) e.pulse = 1; else pendingPulse.set(key, 1);
    } else if (ev.type === 'run.start') {
      pendingPulse.clear();
    }
  }

  return {
    update, onEvent, root,
    get count() { return live.size; },
    dispose() {
      for (const [k, e] of live) drop(k, e);
      scene.remove(root);
      for (const L of levels) if (L) { L.stone.dispose(); L.core.dispose(); L.runes.dispose(); }
      for (const m of Object.values(proto)) m.dispose();
      stoneTex.dispose(); runeTex.dispose();
    },
  };
}
