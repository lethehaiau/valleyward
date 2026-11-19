// @ts-check
// Environment · Valleyward Keep from ARENA.keep (src/shared/arena.js): cube-cut block walls (every visible block is its own
// slightly offset box with a pixel bevel, the M1/M2 look), crenellated parapets, the wall walk, four square towers with
// corbel bands and merlons, the gatehouse (buttresses, a flattened stone arch, a dark passage), the timber stair, the
// stone oil troughs + trench, the courtyard the wall walk can see (a hall, a shed, a house, a well, crates), timber
// palisades on the side walls. Everything static goes into a few Builders (merged by material); the caller makes meshes.
import * as THREE from 'three';
import { ARENA } from '../shared/arena.js';
import { Builder, FACE, rng } from './util.js';

const K = ARENA.keep;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

/** Arch profile of the gate opening (face coordinate s ∈ [-2.5, 2.5] → top of the opening). */
export function gateTop(s) {
  const G = ARENA.gate; const hw = (G.x1 - G.x0) / 2;
  const k = Math.max(0, 1 - (s / hw) ** 2);
  return (G.height - 0.8) + 0.8 * Math.sqrt(k);
}

/**
 * Lay a face of cut blocks. The face spans s ∈ [0, w] along `u` and t ∈ [0, h] along +Y from `o`, outward normal `n`
 * (horizontal). Holes: (s, t) → true where no block may stand.
 * @param {Builder} B @param {() => number} R
 * @param {{ o: THREE.Vector3, n: THREE.Vector3, w: number, h: number, depth?: number, course?: number[], len?: number[],
 *   out?: number, hole?: (s: number, t: number) => boolean, cuts?: number[], tint?: number, footDark?: number }} f
 */
export function blockFace(B, R, f) {
  const n = f.n.clone().normalize();
  const u = new THREE.Vector3().crossVectors(UP, n).normalize();
  const depth = f.depth ?? 0.5, gap = 0.035;
  const [c0, c1] = f.course || [0.5, 0.78];
  const [l0, l1] = f.len || [0.7, 1.45];
  const cuts = f.cuts || [];
  const basis = new THREE.Matrix4().makeBasis(u, UP, n);
  let t = 0, row = 0;
  while (t < f.h - 0.05) {
    let ch = c0 + (c1 - c0) * R();
    if (f.h - (t + ch) < c0 * 0.7) ch = f.h - t;
    let s = row % 2 ? -R() * 0.6 : 0;
    const edges = [0];
    while (s < f.w) {
      s += l0 + (l1 - l0) * R();
      if (s < f.w - 0.3) edges.push(s);
    }
    edges.push(f.w);
    for (const c of cuts) if (c > 0.05 && c < f.w - 0.05 && !edges.some((e) => Math.abs(e - c) < 0.05)) edges.push(c);
    edges.sort((a, b) => a - b);
    for (let i = 0; i < edges.length - 1; i++) {
      const s0 = edges[i], s1 = edges[i + 1];
      if (s1 - s0 < 0.08) continue;
      if (f.hole) {
        const mid = (s0 + s1) / 2;
        if (f.hole(mid, t + ch * 0.5) || f.hole(s0 + 0.02, t + 0.02) || f.hole(s1 - 0.02, t + 0.02) ||
          f.hole(s0 + 0.02, t + ch - 0.02) || f.hole(s1 - 0.02, t + ch - 0.02)) continue;
      }
      const out = (f.out ?? 0.07) * R();
      const sm = (s0 + s1) / 2, tm = t + ch / 2;
      const c = f.o.clone().addScaledVector(u, sm).addScaledVector(UP, tm).addScaledVector(n, out - depth / 2);
      _m.copy(basis).setPosition(c);
      const tone = (f.tint ?? 1) * (0.8 + 0.3 * R());
      const cool = 0.97 + 0.06 * R();
      B.box(s1 - s0 - gap, ch - gap, depth, _m, {
        color: [tone, tone * (0.99 + 0.02 * R()), tone * cool], bevel: true, faces: FACE.all & ~FACE.nz,
        uvOff: [R(), R()], footDark: f.footDark ?? 0.35,
      });
    }
    t += ch; row++;
  }
}

/** A row of merlons (and the low parapet under them) along a line from a to b (y = base), outward normal n. */
function parapet(B, R, a, b, base, n, o = {}) {
  const dir = new THREE.Vector3().subVectors(b, a); const len = dir.length(); dir.normalize();
  const th = o.thick ?? 0.45, lowH = o.low ?? 0.75, mH = o.merlon ?? 0.7, mW = o.mw ?? 1.0, gapW = o.gap ?? 0.75;
  const basis = new THREE.Matrix4().makeBasis(dir, UP, new THREE.Vector3().crossVectors(dir, UP));
  const skip = o.skip || (() => false);
  // the low wall as blocks
  let s = 0;
  while (s < len - 0.05) {
    const l = Math.min(len - s, 0.7 + 0.6 * R());
    const mid = s + l / 2;
    if (!skip(mid)) {
      const c = a.clone().addScaledVector(dir, mid).addScaledVector(UP, base + lowH / 2).addScaledVector(n, (o.shift ?? 0) + (R() - 0.5) * 0.04);
      _m.copy(basis).setPosition(c);
      const tone = 0.82 + 0.28 * R();
      B.box(l - 0.035, lowH, th, _m, { color: [tone, tone, tone * 1.02], bevel: true, uvOff: [R(), R()] });
    }
    s += l;
  }
  // merlons
  const step = mW + gapW; const count = Math.floor((len + gapW) / step);
  const pad = (len - (count * step - gapW)) / 2;
  for (let i = 0; i < count; i++) {
    const mid = pad + i * step + mW / 2;
    if (skip(mid)) continue;
    const c = a.clone().addScaledVector(dir, mid).addScaledVector(UP, base + lowH + mH / 2).addScaledVector(n, (o.shift ?? 0) + (R() - 0.5) * 0.05);
    _m.copy(basis).setPosition(c);
    const tone = 0.85 + 0.3 * R();
    B.box(mW - 0.03, mH - 0.02, th + 0.04, _m, { color: [tone, tone, tone * 1.02], bevel: true, uvOff: [R(), R()], topTint: 1.08 });
  }
}

/** Flagstone paving on top of a rectangle at height y. */
function paving(B, R, x0, z0, x1, z1, y) {
  let z = z0;
  while (z < z1 - 0.05) {
    const dz = Math.min(z1 - z, 0.55 + 0.45 * R());
    let x = x0 + (R() < 0.5 ? -0.3 * R() : 0);
    while (x < x1 - 0.05) {
      const dx = Math.min(x1 - x, 0.7 + 0.7 * R());
      const xa = Math.max(x, x0);
      const tone = 0.78 + 0.32 * R();
      B.aabb(xa + 0.015, y - 0.12, z + 0.015, x + dx - 0.015, y + 0.012 * R(), z + dz - 0.015,
        { color: [tone, tone, tone * 1.03], bevel: true, faces: FACE.noBottom, uvOff: [R(), R()] });
      x += dx;
    }
    z += dz;
  }
}

/** A square tower: four block faces, a corbel band, a flagstone top, merlons all round. Holes per face index. */
function tower(B, F, R, T, holes = {}) {
  const x0 = T.x - T.half, x1 = T.x + T.half, z0 = T.z - T.half, z1 = T.z + T.half, h = T.height;
  const faces = [
    { o: new THREE.Vector3(x0, 0, z1), n: new THREE.Vector3(0, 0, 1), w: x1 - x0, key: 'S' },
    { o: new THREE.Vector3(x1, 0, z1), n: new THREE.Vector3(1, 0, 0), w: z1 - z0, key: 'E' },
    { o: new THREE.Vector3(x1, 0, z0), n: new THREE.Vector3(0, 0, -1), w: x1 - x0, key: 'N' },
    { o: new THREE.Vector3(x0, 0, z0), n: new THREE.Vector3(-1, 0, 0), w: z1 - z0, key: 'W' },
  ];
  for (const f of faces) blockFace(B, R, { o: f.o, n: f.n, w: f.w, h: h - 0.55, hole: holes[f.key], course: [0.55, 0.8], len: [0.75, 1.5] });
  // core (fills the joints with shadow)
  B.aabb(x0 + 0.3, 0, z0 + 0.3, x1 - 0.3, h - 0.5, z1 - 0.3, { color: [0.3, 0.32, 0.36], faces: FACE.sides });
  // corbel band: a protruding course under the top
  for (const f of faces) blockFace(B, R, { o: f.o.clone().setY(h - 0.55).addScaledVector(f.n, 0.22).addScaledVector(new THREE.Vector3().crossVectors(UP, f.n), -0.22), n: f.n, w: f.w + 0.44, h: 0.55, course: [0.55, 0.55], len: [0.5, 0.8], out: 0.02, depth: 0.7, footDark: 0 });
  paving(F, R, x0 + 0.25, z0 + 0.25, x1 - 0.25, z1 - 0.25, h);
  for (const f of faces) {
    const u = new THREE.Vector3().crossVectors(UP, f.n);
    const a = f.o.clone().setY(0).addScaledVector(f.n, 0.0).addScaledVector(u, -0.22);
    const b = a.clone().addScaledVector(u, f.w + 0.44);
    parapet(B, R, a, b, h, f.n, { low: 0.55, merlon: 0.75, mw: 0.95, gap: 0.65, thick: 0.5, shift: 0.0 });
  }
}

/**
 * @returns {{ stone: Builder, flag: Builder, timber: Builder, roof: Builder, iron: Builder, voids: Builder, palisade: Builder,
 *   oilRects: {id:string,x0:number,x1:number,z0:number,z1:number,y0:number,y1:number}[] }}
 */
export function buildKeep(seed = 11) {
  const R = rng(seed);
  const stone = new Builder(4), flag = new Builder(4), timber = new Builder(4), roof = new Builder(4), iron = new Builder(2);
  const voids = new Builder(4), palisade = new Builder(4);
  const G = ARENA.gate, W = K.walk, H = K.wallHeight, th = K.wallThick;
  const sw = K.towers[0], se = K.towers[1], nw = K.towers[2], ne = K.towers[3];
  const st = ARENA.stair;

  // ---------------------------------------------------------------- the south wall (gate wall)
  const sx0 = sw.x + sw.half, sx1 = se.x - se.half; // -12.8 .. 12.8
  const inGate = (x, y) => x > G.x0 && x < G.x1 && y < gateTop(x);
  blockFace(stone, R, {
    o: new THREE.Vector3(sx0, 0, 0), n: new THREE.Vector3(0, 0, 1), w: sx1 - sx0, h: H,
    hole: (s, t) => inGate(sx0 + s, t), cuts: [G.x0 - sx0, G.x1 - sx0], footDark: 0.45,
  });
  blockFace(stone, R, {
    o: new THREE.Vector3(sx1, 0, -th), n: new THREE.Vector3(0, 0, -1), w: sx1 - sx0, h: H,
    hole: (s, t) => inGate(sx1 - s, t), cuts: [sx1 - G.x1, sx1 - G.x0],
  });
  // core with the passage cut out
  stone.aabb(sx0, 0, -th + 0.35, G.x0 - 0.3, H - 0.1, -0.35, { color: [0.3, 0.32, 0.36], faces: FACE.py });
  stone.aabb(G.x1 + 0.3, 0, -th + 0.35, sx1, H - 0.1, -0.35, { color: [0.3, 0.32, 0.36], faces: FACE.py });
  // the gate passage: side walls, a ceiling, darkness behind the doors
  blockFace(stone, R, { o: new THREE.Vector3(G.x0, 0, 0), n: new THREE.Vector3(1, 0, 0), w: th, h: G.height - 0.8, course: [0.5, 0.7], footDark: 0.5 });
  blockFace(stone, R, { o: new THREE.Vector3(G.x1, 0, -th), n: new THREE.Vector3(-1, 0, 0), w: th, h: G.height - 0.8, course: [0.5, 0.7], footDark: 0.5 });
  stone.aabb(G.x0, G.height - 0.05, -th, G.x1, G.height + 0.6, 0, { color: [0.36, 0.37, 0.4], faces: FACE.ny });
  // filler over the spring line between the side walls and the ceiling (inside the arch)
  stone.aabb(G.x0, G.height - 0.8, -th + 0.1, G.x0 + 0.5, G.height, -0.1, { color: [0.4, 0.41, 0.45], faces: FACE.px | FACE.ny });
  stone.aabb(G.x1 - 0.5, G.height - 0.8, -th + 0.1, G.x1, G.height, -0.1, { color: [0.4, 0.41, 0.45], faces: FACE.nx | FACE.ny });
  // the arch: a ring of voussoirs on both faces (they cover the cut block edges)
  for (const side of [1, -1]) {
    const zf = side > 0 ? 0 : -th;
    const N = 11;
    for (let i = 0; i < N; i++) {
      const a0 = Math.PI * (i / N), a1 = Math.PI * ((i + 1) / N);
      const am = (a0 + a1) / 2;
      const hw = (G.x1 - G.x0) / 2 + 0.25, rise = 0.8 + 0.25;
      const x = Math.cos(am) * hw, y = G.height - 0.8 + Math.sin(am) * rise;
      const nx = Math.cos(am) / hw, ny = Math.sin(am) / rise; const ang = Math.atan2(ny, nx);
      _q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang - Math.PI / 2);
      const seg = Math.hypot(Math.cos(a1) * hw - Math.cos(a0) * hw, Math.sin(a1) * rise - Math.sin(a0) * rise);
      const c = new THREE.Vector3(x + (G.x0 + G.x1) / 2, y + 0.22, zf + side * 0.12);
      _m.compose(c, _q, _s);
      const tone = 0.9 + 0.2 * R();
      stone.box(seg + 0.06, 0.62, 0.7, _m, { color: [tone, tone, tone * 1.03], bevel: true, uvOff: [R(), R()] });
    }
    // keystone
    _m.makeTranslation((G.x0 + G.x1) / 2, G.height + 0.3, zf + side * 0.2);
    stone.box(0.55, 0.8, 0.8, _m, { color: [1.0, 1.0, 1.03], bevel: true });
  }
  // buttresses flanking the gate, up to a merlon cap
  for (const bx of [[G.x0 - 1.1, G.x0], [G.x1, G.x1 + 1.1]]) {
    blockFace(stone, R, { o: new THREE.Vector3(bx[0], 0, 0.35), n: new THREE.Vector3(0, 0, 1), w: bx[1] - bx[0], h: 6.0, course: [0.5, 0.7], len: [0.5, 0.6], footDark: 0.45 });
    blockFace(stone, R, { o: new THREE.Vector3(bx[1], 0, 0.35), n: new THREE.Vector3(1, 0, 0), w: 0.35, h: 6.0, course: [0.5, 0.7], len: [0.35, 0.35] });
    blockFace(stone, R, { o: new THREE.Vector3(bx[0], 0, 0), n: new THREE.Vector3(-1, 0, 0), w: 0.35, h: 6.0, course: [0.5, 0.7], len: [0.35, 0.35] });
    stone.aabb(bx[0] - 0.08, 6.0, -0.6, bx[1] + 0.08, 6.55, 0.45, { color: [1, 1, 1.03], bevel: true, uvOff: [R(), R()] });
  }
  // the passage floor darkness + behind-door dark
  voids.aabb(G.x0 + 0.02, 0.0, -th + 0.05, G.x1 - 0.02, G.height - 0.1, -th + 0.1, { color: [1, 1, 1], faces: FACE.pz });

  // walk on top of the south wall, its parapet (gap over the stair top) and the inner kerb
  paving(flag, R, sx0, -th, sx1, -0.4, H);
  const stairGap = (x) => x > st.x0 - 0.05 && x < st.x1 + 0.05;
  parapet(stone, R, new THREE.Vector3(sx0, 0, -0.2), new THREE.Vector3(sx1, 0, -0.2), H, new THREE.Vector3(0, 0, 1),
    // a 0.5 m sill and wide crenels (1.5 m) between 0.9 m merlons whose tops sit ≈ 1.2 m
    // above the walk, so the slope, the road and the horde show over the sill from the wall walk (eye 1.68 m)
    { skip: (s) => stairGap(sx0 + s) || (sx0 + s > G.x0 - 1.15 && sx0 + s < G.x0 + 0.05) || (sx0 + s > G.x1 - 0.05 && sx0 + s < G.x1 + 1.15),
      thick: 0.45, shift: 0.02, low: 0.5, merlon: 0.72, mw: 0.95, gap: 1.5 });
  paving(flag, R, st.x0, -0.45, st.x1, 0.25, H); // the landing where the stair meets the walk
  parapet(stone, R, new THREE.Vector3(sx0, 0, -2.82), new THREE.Vector3(sx1, 0, -2.82), H, new THREE.Vector3(0, 0, -1),
    { low: 0.45, merlon: 0.0001, mw: 0.01, gap: 50, thick: 0.36 });

  // ---------------------------------------------------------------- side and north walls (outer faces + walk + palisade)
  const sides = [
    { name: 'W', o: new THREE.Vector3(K.x0, 0, nw.z + nw.half), n: new THREE.Vector3(-1, 0, 0), w: (sw.z - sw.half) - (nw.z + nw.half), inner: new THREE.Vector3(K.x0 + th, 0, sw.z - sw.half), inN: new THREE.Vector3(1, 0, 0) },
    { name: 'E', o: new THREE.Vector3(K.x1, 0, se.z - se.half), n: new THREE.Vector3(1, 0, 0), w: (se.z - se.half) - (ne.z + ne.half), inner: new THREE.Vector3(K.x1 - th, 0, ne.z + ne.half), inN: new THREE.Vector3(-1, 0, 0) },
    { name: 'N', o: new THREE.Vector3(ne.x - ne.half, 0, K.z0), n: new THREE.Vector3(0, 0, -1), w: (ne.x - ne.half) - (nw.x + nw.half), inner: new THREE.Vector3(nw.x + nw.half, 0, K.z0 + th), inN: new THREE.Vector3(0, 0, 1) },
  ];
  for (const s of sides) {
    blockFace(stone, R, { o: s.o, n: s.n, w: s.w, h: H, footDark: 0.4 });
    blockFace(stone, R, { o: s.inner, n: s.inN, w: s.w, h: H, tint: 0.92 });
    const u = new THREE.Vector3().crossVectors(UP, s.n);
    const a = s.o.clone(), b = s.o.clone().addScaledVector(u, s.w);
    const lo = new THREE.Vector3().copy(a).addScaledVector(s.n, -th), hi = new THREE.Vector3().copy(b);
    paving(flag, R, Math.min(lo.x, hi.x), Math.min(lo.z, hi.z), Math.max(lo.x, hi.x), Math.max(lo.z, hi.z), H);
    // a low stone sill + a timber palisade of pointed stakes on the outer edge
    parapet(stone, R, a.clone().addScaledVector(s.n, -0.22), b.clone().addScaledVector(s.n, -0.22), H, s.n, { low: 0.5, merlon: 0.0001, mw: 0.01, gap: 50, thick: 0.45 });
    stakes(palisade, R, a.clone().addScaledVector(s.n, -0.3).setY(H + 0.4), b.clone().addScaledVector(s.n, -0.3).setY(H + 0.4), 1.9);
  }

  // ---------------------------------------------------------------- towers
  const door = (w0, w1) => (s, t) => s > w0 && s < w1 && t > H - 0.05 && t < H + 2.2;
  // SW tower east face: s runs from z1 (south) to z0 → the walk (z -2.6..-0.4) is s ∈ [half-2.6.., ]
  const sDoor = (T) => [T.z + T.half - (-0.5), T.z + T.half - (-2.5)];
  const swD = sDoor(sw), seD = sDoor(se);
  tower(stone, flag, R, sw, { E: door(Math.min(swD[0], swD[1]), Math.max(swD[0], swD[1])) });
  // SE tower west face: its s runs from z0 (north) to z1 → s = z - z0
  const seW0 = -2.5 - (se.z - se.half), seW1 = -0.5 - (se.z - se.half);
  tower(stone, flag, R, se, { W: door(seW0, seW1) });
  tower(stone, flag, R, nw);
  tower(stone, flag, R, ne);
  // doorways: dark recesses with a timber lintel
  for (const [x, dir] of [[sw.x + sw.half, 1], [se.x - se.half, -1]]) {
    voids.aabb(x - dir * 0.6 - 0.01, H, -2.5, x - dir * 0.6 + 0.01, H + 2.2, -0.5, { color: [1, 1, 1], faces: dir > 0 ? FACE.px : FACE.nx });
    voids.aabb(Math.min(x, x - dir * 0.6), H - 0.01, -2.5, Math.max(x, x - dir * 0.6), H + 0.0, -0.5, { color: [1, 1, 1], faces: FACE.py });
    timber.aabb(x - 0.1, H + 2.2, -2.75, x + 0.1, H + 2.5, -0.25, { color: [0.9, 0.85, 0.8] });
  }
  // arrow slits (dark) on the tower faces that look at the valley
  for (const T of [sw, se, nw, ne]) {
    for (const [nx, nz] of [[0, 1], [1, 0], [-1, 0]]) {
      for (const y of [2.6, 7.4]) {
        const cx = T.x + nx * (T.half + 0.075), cz = T.z + nz * (T.half + 0.075);
        voids.aabb(cx - (nz ? 0.11 : 0.01), y, cz - (nx ? 0.11 : 0.01), cx + (nz ? 0.11 : 0.01), y + 0.95, cz + (nx ? 0.11 : 0.01),
          { color: [1, 1, 1], faces: nz ? FACE.pz : nx > 0 ? FACE.px : FACE.nx });
      }
    }
  }

  // ---------------------------------------------------------------- timber stair (outside the wall, west of the gate)
  {
    const steps = 20, run = (st.zBottom - st.zTop) / steps, rise = st.yTop / steps;
    for (let i = 0; i < steps; i++) {
      const z1 = st.zBottom - i * run, z0 = z1 - run - 0.04, y = rise * (i + 1);
      timber.aabb(st.x0 + 0.05, y - 0.09, z0, st.x1 - 0.05, y, z1, { color: [0.95 + 0.1 * R(), 0.9, 0.85], uvOff: [R(), R()] });
    }
    // stringers + posts + a handrail on the open (east) side and the west side
    const slope = Math.atan2(st.yTop, st.zBottom - st.zTop);
    const len = Math.hypot(st.yTop, st.zBottom - st.zTop);
    for (const x of [st.x0 + 0.1, st.x1 - 0.1]) {
      _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), slope);
      _m.compose(new THREE.Vector3(x, st.yTop / 2 - 0.22, (st.zBottom + st.zTop) / 2), _q, _s);
      timber.box(0.16, 0.32, len, _m, { color: [0.8, 0.74, 0.7] });
      _m.compose(new THREE.Vector3(x, st.yTop / 2 + 0.95, (st.zBottom + st.zTop) / 2), _q, _s);
      timber.box(0.1, 0.1, len, _m, { color: [0.9, 0.84, 0.78] });
      for (let k = 0; k <= 4; k++) {
        const z = st.zBottom - (k / 4) * (st.zBottom - st.zTop - 0.4) - 0.2;
        const yTopStep = st.yTop * (st.zBottom - z) / (st.zBottom - st.zTop);
        timber.aabb(x - 0.09, -0.3, z - 0.09, x + 0.09, yTopStep + 1.0, z + 0.09, { color: [0.78, 0.72, 0.68] });
      }
    }
    // cross bracing under the stair
    for (let k = 1; k < 4; k++) {
      const z = st.zBottom - (k / 4) * (st.zBottom - st.zTop);
      const y = st.yTop * (st.zBottom - z) / (st.zBottom - st.zTop);
      timber.aabb(st.x0 + 0.1, y * 0.45, z - 0.06, st.x1 - 0.1, y * 0.45 + 0.16, z + 0.06, { color: [0.75, 0.7, 0.66] });
    }
  }

  // ---------------------------------------------------------------- oil troughs (stone rims, aTag = trough index + 1)
  /** @type {{id:string,x0:number,x1:number,z0:number,z1:number,y0:number,y1:number}[]} */
  const oilRects = [];
  ARENA.oil.troughs.forEach((T, i) => {
    const tag = i + 1;
    const trench = T.id === 'trench-road';
    const rimH = trench ? 0.16 : 0.5, rw = trench ? 0.16 : 0.22;
    const box = (x0, z0, x1, z1) => {
      let x = x0;
      const along = x1 - x0 > z1 - z0;
      if (along) {
        while (x < x1 - 0.05) { const l = Math.min(x1 - x, 0.7 + 0.5 * R()); const tone = 0.8 + 0.25 * R();
          stone.aabb(x + 0.015, 0, z0, x + l - 0.015, rimH + 0.03 * R(), z1, { color: [tone, tone, tone * 1.03], bevel: true, uvOff: [R(), R()], tag }); x += l; }
      } else {
        let z = z0;
        while (z < z1 - 0.05) { const l = Math.min(z1 - z, 0.7 + 0.5 * R()); const tone = 0.8 + 0.25 * R();
          stone.aabb(x0, 0, z + 0.015, x1, rimH + 0.03 * R(), z + l - 0.015, { color: [tone, tone, tone * 1.03], bevel: true, uvOff: [R(), R()], tag }); z += l; }
      }
    };
    box(T.x0, T.z0 - rw / 2, T.x1, T.z0 + rw / 2);
    box(T.x0, T.z1 - rw / 2, T.x1, T.z1 + rw / 2);
    box(T.x0 - rw / 2, T.z0 + rw / 2, T.x0 + rw / 2, T.z1 - rw / 2);
    box(T.x1 - rw / 2, T.z0 + rw / 2, T.x1 + rw / 2, T.z1 - rw / 2);
    // basin floor (soot-able)
    stone.aabb(T.x0 + rw / 2, 0, T.z0 + rw / 2, T.x1 - rw / 2, 0.06, T.z1 - rw / 2, { color: [0.45, 0.45, 0.48], faces: FACE.py, tag });
    oilRects.push({ id: T.id, x0: T.x0 + rw / 2, x1: T.x1 - rw / 2, z0: T.z0 + rw / 2, z1: T.z1 - rw / 2, y0: 0.07, y1: trench ? 0.13 : 0.42 });
  });

  // ---------------------------------------------------------------- courtyard (only what the walk sees)
  const cz0 = K.z0 + th, cz1 = -th;
  // the hall against the north wall: stone, a slate gable roof
  house(stone, roof, timber, R, -10.5, cz0 + 0.2, 5.5, cz0 + 6.2, 4.2, 'x');
  house(stone, roof, timber, R, 6.8, cz0 + 0.2, 12.6, cz0 + 5.4, 3.4, 'z');
  house(stone, roof, timber, R, K.x0 + th + 0.2, -19, K.x0 + th + 5.2, -13, 3.2, 'z');
  // the well
  {
    const wx = 2.5, wz = -13;
    const ring = 10;
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2;
      _q.setFromAxisAngle(UP, -a);
      _m.compose(new THREE.Vector3(wx + Math.cos(a) * 1.0, 0.45, wz + Math.sin(a) * 1.0), _q, _s);
      const tone = 0.85 + 0.2 * R();
      stone.box(0.32, 0.9, 0.68, _m, { color: [tone, tone, tone], bevel: true, uvOff: [R(), R()] });
    }
    voids.aabb(wx - 0.9, 0.5, wz - 0.9, wx + 0.9, 0.52, wz + 0.9, { color: [1, 1, 1], faces: FACE.py });
    timber.aabb(wx - 1.15, 0, wz - 0.1, wx - 0.95, 2.6, wz + 0.1, {});
    timber.aabb(wx + 0.95, 0, wz - 0.1, wx + 1.15, 2.6, wz + 0.1, {});
    timber.aabb(wx - 1.2, 2.3, wz - 0.07, wx + 1.2, 2.45, wz + 0.07, {});
    for (const s of [-1, 1]) {
      _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), s * 0.62);
      _m.compose(new THREE.Vector3(wx, 2.75, wz + s * 0.55), _q, _s);
      roof.box(2.7, 0.08, 1.35, _m, { uvOff: [R(), R()] });
    }
  }
  // crates and a cart's worth of clutter along the walls
  const crate = (x, z, s, y = 0, rot = 0) => {
    _q.setFromAxisAngle(UP, rot);
    _m.compose(new THREE.Vector3(x, y + s / 2, z), _q, _s);
    const tone = 0.85 + 0.25 * R();
    timber.box(s, s, s, _m, { color: [tone, tone * 0.95, tone * 0.9], bevel: true, uvOff: [R(), R()] });
  };
  for (const [x, z] of [[-6, -6], [-5, -5.2], [9, -8], [10, -9], [-11, -24], [11.5, -20], [5, -6.2]]) {
    crate(x, z, 0.9 + 0.3 * R(), 0, R());
    if (R() < 0.6) crate(x + 0.1, z + 0.1, 0.7, 0.95, R());
  }
  // outside: a few crates at the stair foot and on the plaza by the gate (cover dressing)
  crate(-11.4, 9.2, 0.85, 0, 0.3); crate(-12.3, 8.6, 0.75, 0, 0.9); crate(-11.7, 8.9, 0.6, 0.85, 0.2);
  crate(-5.2, 2.6, 0.8, 0, 0.5); crate(5.4, 2.5, 0.75, 0, 0.2);

  return { stone, flag, timber, roof, iron, voids, palisade, oilRects };
}

/** A row of pointed stakes (palisade) from a to b, base y = a.y, height h. */
export function stakes(B, R, a, b, h) {
  const dir = new THREE.Vector3().subVectors(b, a); const len = dir.length(); dir.normalize();
  const cone = new THREE.ConeGeometry(0.17, 0.42, 4, 1);
  const n = Math.floor(len / 0.36);
  for (let i = 0; i <= n; i++) {
    const p = a.clone().addScaledVector(dir, (i / n) * len);
    const hh = h * (0.85 + 0.25 * R());
    _q.setFromAxisAngle(UP, R() * 0.8);
    _m.compose(p.clone().setY(a.y + hh / 2 - 0.3), _q, _s);
    const tone = 0.8 + 0.3 * R();
    B.box(0.24, hh, 0.24, _m, { color: [tone, tone * 0.95, tone * 0.9], uvOff: [R(), 0] });
    _m.compose(p.clone().setY(a.y + hh - 0.3 + 0.2), _q, _s);
    B.geom(cone, _m, { color: [tone * 0.9, tone * 0.85, tone * 0.8], uvScale: [0.25, 0.15] });
  }
  // two horizontal binding rails behind
  for (const y of [0.3, 1.1]) {
    const c = a.clone().add(b).multiplyScalar(0.5).setY(a.y + y);
    _m.makeBasis(dir, UP, new THREE.Vector3().crossVectors(dir, UP)).setPosition(c);
    B.box(len, 0.12, 0.1, _m, { color: [0.7, 0.66, 0.62] });
  }
}

/** A small stone building with a gable roof (ridge along 'x' or 'z'). */
function house(stone, roof, timber, R, x0, z0, x1, z1, h, ridge) {
  const faces = [
    { o: new THREE.Vector3(x0, 0, z1), n: new THREE.Vector3(0, 0, 1), w: x1 - x0 },
    { o: new THREE.Vector3(x1, 0, z1), n: new THREE.Vector3(1, 0, 0), w: z1 - z0 },
    { o: new THREE.Vector3(x1, 0, z0), n: new THREE.Vector3(0, 0, -1), w: x1 - x0 },
    { o: new THREE.Vector3(x0, 0, z0), n: new THREE.Vector3(-1, 0, 0), w: z1 - z0 },
  ];
  for (const f of faces) blockFace(stone, R, { o: f.o, n: f.n, w: f.w, h, course: [0.45, 0.6], len: [0.6, 1.1], tint: 0.95 });
  stone.aabb(x0 + 0.3, 0, z0 + 0.3, x1 - 0.3, h, z1 - 0.3, { color: [0.3, 0.3, 0.33], faces: FACE.py });
  // gable roof
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const span = ridge === 'x' ? z1 - z0 : x1 - x0, length = ridge === 'x' ? x1 - x0 : z1 - z0;
  const pitch = 0.62, half = span / 2 + 0.45;
  const slant = half / Math.cos(pitch), rise = Math.tan(pitch) * (span / 2);
  for (const s of [-1, 1]) {
    const axis = ridge === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    _q.setFromAxisAngle(axis, ridge === 'x' ? s * pitch : -s * pitch);
    const off = (half / 2) * s;
    const c = new THREE.Vector3(cx + (ridge === 'x' ? 0 : off), h + rise / 2 + 0.05, cz + (ridge === 'x' ? off : 0));
    _m.compose(c, _q, _s);
    if (ridge === 'x') roof.box(length + 0.6, 0.14, slant, _m, { uvOff: [R(), R()] });
    else roof.box(slant, 0.14, length + 0.6, _m, { uvOff: [R(), R()] });
  }
  // gable ends (stone triangles approximated by two stepped blocks) + a ridge beam
  for (const e of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const w = span * (1 - (k + 0.5) / 3.2), y = h + (rise / 3) * k;
      if (ridge === 'x') stone.aabb(e > 0 ? x1 - 0.4 : x0, y, cz - w / 2, e > 0 ? x1 : x0 + 0.4, y + rise / 3, cz + w / 2, { color: [0.92, 0.92, 0.95], bevel: true, uvOff: [R(), R()] });
      else stone.aabb(cx - w / 2, y, e > 0 ? z1 - 0.4 : z0, cx + w / 2, y + rise / 3, e > 0 ? z1 : z0 + 0.4, { color: [0.92, 0.92, 0.95], bevel: true, uvOff: [R(), R()] });
    }
  }
  if (ridge === 'x') timber.aabb(x0 - 0.3, h + rise - 0.05, cz - 0.12, x1 + 0.3, h + rise + 0.2, cz + 0.12, {});
  else timber.aabb(cx - 0.12, h + rise - 0.05, z0 - 0.3, cx + 0.12, h + rise + 0.2, z1 + 0.3, {});
  // a door
  timber.aabb(cx - 0.55, 0, (ridge === 'x' ? z1 : z1) + 0.0, cx + 0.55, 2.0, z1 + 0.06, { color: [0.75, 0.7, 0.65] });
}
