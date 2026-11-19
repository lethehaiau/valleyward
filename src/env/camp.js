// @ts-check
// Environment (DESIGN §9.2, STORY.md hint 2): the camp's set dressing.
//   buildStall(K)   Brother Cinder's stall at ARENA.camp.npc, a lean-to against the SW tower's south face: a cloth awning
//                   on two posts with a flapped valance, an anvil on a stump, a workbench, a small forge brazier, stacked
//                   crates, two blades on the wall and a hanging lantern. Timber / iron / stone go into the keep's merged
//                   builders (0 extra draws); the cloth is one Builder (1 draw); the brazier flame and the lantern glass are
//                   handed to buildProps as extra flames / glows (no lights: the west brazier lights the stall).
//   buildBanners(K) the goblins' banners dropped on the slope (a lamp crossed out): poles into K.timber, the cloth into
//                   one Builder (1 draw, alpha-tested Codex pixel texture).
//   createPads()    the six build pads: pixel rune circles burnt into the ground (1 draw, additive ember glow over a
//                   scorched disc); dim by night, awake at the camp, brighter when the player is near.
// The NPC himself and the towers on the pads are the actors'; colliders are the sim's.
import * as THREE from 'three';
import { ARENA } from '../shared/arena.js';
import { Builder } from './util.js';
import { gfx } from '../gfx/current.js';
import { envHeight } from './terrain.js';

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
const _e = new THREE.Euler();

/** A box at (x, y, z) (centre), size (sx, sy, sz), yaw ry and optional pitch/roll. */
function put(B, x, y, z, sx, sy, sz, ry = 0, o = {}, rx = 0, rz = 0) {
  _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
  _m.compose(_p.set(x, y, z), _q, _s);
  B.box(sx, sy, sz, _m, o);
}

/** A slab of width (x1 − x0) from p to q in the y–z plane (thickness t): one sagging awning segment. */
function slab(B, x0, x1, p, q, t, o = {}) {
  const dy = q[0] - p[0], dz = q[1] - p[1];
  const len = Math.hypot(dy, dz);
  _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.atan2(-dy, dz));
  _m.compose(_p.set((x0 + x1) / 2, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2), _q, _s);
  B.box(x1 - x0, t, len, _m, o);
}

/**
 * @param {{ timber: Builder, iron: Builder, stone: Builder }} K the keep's merged builders
 * @param {() => number} R seeded rng
 */
export function buildStall(K, R) {
  const N = ARENA.camp.npc;
  const sw = ARENA.keep.towers[0];
  const face = sw.z + sw.half;                 // the tower's south face (z 3.2)
  const cloth = new Builder(4);
  /** @type {{ x: number, y: number, z: number, s: number }[]} */
  const flames = [];
  /** @type {{ x: number, y: number, z: number, sx: number, sy: number, sz: number }[]} */
  const glows = [];
  const X0 = N.x - 2.4, X1 = N.x + 2.2;        // awning span (−19.9 .. −15.3)
  const zF = face + 2.9, yB = 3.12, yF = 2.36;  // front edge, back (on the tower) and front heights
  const tone = () => { const t = 0.85 + 0.2 * R(); return [t, t * 0.97, t * 0.94]; };

  // ---------------------------------------------------------------- the frame: two posts, a front beam, a ledger, rafters
  for (const x of [X0 + 0.12, X1 - 0.12]) {
    put(K.timber, x, yF / 2 + 0.04, zF, 0.15, yF + 0.08, 0.15, R() * 0.1, { bevel: true, color: tone(), uvOff: [R(), R()] });
    put(K.timber, x, yF - 0.35, zF - 0.32, 0.08, 0.08, 0.75, 0, { color: tone() }, -0.75);   // knee brace
  }
  put(K.timber, (X0 + X1) / 2, yF + 0.02, zF, X1 - X0 + 0.3, 0.14, 0.14, 0, { bevel: true, color: tone(), uvOff: [R(), R()] });
  put(K.timber, (X0 + X1) / 2, yB + 0.05, face + 0.08, X1 - X0 + 0.2, 0.16, 0.14, 0, { bevel: true, color: tone() });
  for (let i = 0; i <= 3; i++) {
    const x = X0 + 0.1 + (i / 3) * (X1 - X0 - 0.2);
    slab(K.timber, x - 0.04, x + 0.04, [yB, face + 0.1], [yF + 0.06, zF], 0.08, { color: tone() });
  }
  // ---------------------------------------------------------------- the awning: 4 cloth strips that sag between the rafters
  const strips = 4, w = (X1 - X0 + 0.2) / strips;
  for (let i = 0; i < strips; i++) {
    const a = X0 - 0.1 + i * w, b = a + w + 0.02;
    const sag = 0.1 + 0.06 * R();
    const mid = [(yB + yF) / 2 - sag + 0.12, (face + 0.12 + zF) / 2];
    const shade = 0.88 + 0.16 * R();
    slab(cloth, a, b, [yB + 0.14, face + 0.12], mid, 0.035, { color: [shade, shade, shade], uvOff: [i * 0.27, 0] });
    slab(cloth, a, b, mid, [yF + 0.1, zF + 0.04], 0.035, { color: [shade, shade, shade], uvOff: [i * 0.27, 0.4] });
  }
  // the valance: flaps of uneven length hang from the front beam (the pixel-cut fringe of a market stall)
  const flaps = 9, fw = (X1 - X0 + 0.3) / flaps;
  for (let i = 0; i < flaps; i++) {
    const h = (i % 2 ? 0.3 : 0.42) + 0.06 * R();
    const x = X0 - 0.15 + (i + 0.5) * fw;
    put(cloth, x, yF + 0.08 - h / 2, zF + 0.1, fw - 0.03, h, 0.03, 0, { color: [0.8, 0.8, 0.8], uvOff: [i * 0.13, 0.1] }, 0.05 * (R() - 0.5));
  }

  // ---------------------------------------------------------------- the anvil on its stump, east of him (the counter)
  const ax = N.x + 1.15, az = N.z + 0.45;
  put(K.timber, ax, 0.29, az, 0.56, 0.58, 0.52, 0.3, { bevel: true, color: tone(), uvOff: [R(), R()] });
  put(K.iron, ax, 0.64, az, 0.3, 0.12, 0.22, 0.3);
  put(K.iron, ax, 0.74, az, 0.16, 0.1, 0.14, 0.3);
  put(K.iron, ax, 0.84, az, 0.56, 0.12, 0.2, 0.3);
  put(K.iron, ax + Math.cos(0.3) * 0.36, 0.86, az - Math.sin(0.3) * 0.36, 0.2, 0.07, 0.1, 0.3);          // the horn
  put(K.iron, ax + Math.cos(0.3) * 0.48, 0.875, az - Math.sin(0.3) * 0.48, 0.1, 0.04, 0.05, 0.3);
  put(K.iron, ax - 0.12, 0.93, az + 0.03, 0.22, 0.05, 0.05, 1.1);                                         // a hammer on it
  put(K.timber, ax - 0.2, 0.93, az + 0.16, 0.05, 0.04, 0.3, 1.1, { color: [0.7, 0.66, 0.6] });

  // ---------------------------------------------------------------- the workbench against the tower, tools on it
  const bx0 = N.x - 2.0, bx1 = N.x - 0.6, bz0 = face + 0.06, bz1 = face + 0.66;
  put(K.timber, (bx0 + bx1) / 2, 0.88, (bz0 + bz1) / 2, bx1 - bx0, 0.08, bz1 - bz0, 0, { bevel: true, color: tone(), uvOff: [R(), R()] });
  for (const [x, z] of [[bx0 + 0.07, bz0 + 0.07], [bx1 - 0.07, bz0 + 0.07], [bx0 + 0.07, bz1 - 0.07], [bx1 - 0.07, bz1 - 0.07]]) put(K.timber, x, 0.42, z, 0.09, 0.84, 0.09, 0, { color: tone() });
  put(K.timber, (bx0 + bx1) / 2, 0.22, (bz0 + bz1) / 2, bx1 - bx0 - 0.1, 0.05, bz1 - bz0 - 0.1, 0, { color: tone() });
  put(K.iron, bx0 + 0.35, 0.94, bz0 + 0.3, 0.45, 0.04, 0.05, 0.4);   // tongs
  put(K.iron, bx0 + 0.4, 0.94, bz0 + 0.38, 0.4, 0.04, 0.05, 0.55);
  put(K.iron, bx0 + 0.95, 0.95, bz0 + 0.25, 0.14, 0.06, 0.12, 0.1); // a block of iron stock
  put(K.iron, bx0 + 1.15, 0.96, bz0 + 0.42, 0.3, 0.08, 0.08, -0.3);
  // two blades leaning on the tower face, a shield-sized plate
  for (const [x, a] of [[N.x + 0.35, 0.12], [N.x + 0.62, -0.08]]) {
    put(K.iron, x, 0.62, face + 0.12, 0.07, 1.1, 0.02, 0, {}, -0.12, a);
    put(K.iron, x - Math.sin(a) * 0.38, 0.95, face + 0.1, 0.24, 0.04, 0.05, 0, {}, -0.12, a);
  }

  // ---------------------------------------------------------------- the small forge brazier (a flame, no light)
  const fx = N.x - 1.3, fz = face + 2.0;
  put(K.stone, fx, 0.26, fz, 0.72, 0.52, 0.72, 0.2, { bevel: true, uvOff: [R(), R()] });
  put(K.iron, fx, 0.56, fz, 0.6, 0.08, 0.6, 0.2);
  for (let i = 0; i < 4; i++) {
    const a = 0.2 + i * Math.PI / 2 + Math.PI / 4;
    put(K.iron, fx + Math.cos(a) * 0.27, 0.7, fz - Math.sin(a) * 0.27, 0.05, 0.22, 0.05, -a);
  }
  flames.push({ x: fx, y: 0.6, z: fz, s: 0.8 });
  glows.push({ x: fx, y: 0.62, z: fz, sx: 0.36, sy: 0.08, sz: 0.36 });

  // ---------------------------------------------------------------- crates and a sack-ish bundle in the back corner
  const crate = (x, z, s, y = 0, rot = 0) => put(K.timber, x, y + s / 2, z, s, s, s, rot, { bevel: true, color: tone(), uvOff: [R(), R()] });
  crate(X0 + 0.35, face + 0.55, 0.8, 0, 0.15);
  crate(X0 + 0.4, face + 0.5, 0.62, 0.8, 0.5);
  crate(X0 + 0.3, face + 1.45, 0.6, 0, -0.3);
  crate(X1 - 0.35, zF - 0.6, 0.5, 0, 0.7);

  // ---------------------------------------------------------------- the hanging lantern on the front beam
  const lx = N.x + 1.0, lz = zF + 0.02, ly = yF - 0.62;
  put(K.iron, lx, yF - 0.22, lz, 0.025, 0.36, 0.025);                       // chain
  put(K.iron, lx, ly + 0.2, lz, 0.26, 0.05, 0.26);                          // cap
  put(K.iron, lx, ly + 0.26, lz, 0.12, 0.06, 0.12);
  put(K.iron, lx, ly - 0.16, lz, 0.24, 0.04, 0.24);                         // base
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put(K.iron, lx + dx * 0.105, ly + 0.02, lz + dz * 0.105, 0.03, 0.34, 0.03);
  glows.push({ x: lx, y: ly + 0.02, z: lz, sx: 0.17, sy: 0.26, sz: 0.17 });

  return { cloth, flames, glows };
}

/** Where the goblins dropped their banners on the slope (x, z, kind: 0 planted askew, 1 fallen flat, yaw). */
const BANNERS = [
  [10.5, 17.5, 0, 0.5], [-2.5, 21, 1, 2.2], [17.5, 26, 0, -0.4], [27.5, 19.5, 1, 0.9], [6.5, 31, 0, 0.2], [22, 36.5, 1, -1.2],
];

/**
 * The goblins' banners (STORY.md hint 2: a lamp crossed out), dropped on the slope where the horde climbs.
 * @param {{ timber: Builder }} K @param {() => number} R
 */
export function buildBanners(K, R) {
  const cloth = new Builder(1);
  const W = 0.9, H = 1.35;
  for (const [x, z, kind, yaw] of BANNERS) {
    const gy = envHeight(x, z);
    const g = new THREE.PlaneGeometry(W, H, 2, 6);
    const P = g.attributes.position;
    if (kind === 0) {
      // a pole planted at a lean, a crossbar at the top, the cloth hanging from it with a slow wave
      const lean = 0.18 + 0.12 * R(), lr = R() * Math.PI * 2;
      const top = new THREE.Vector3(Math.sin(lr) * lean * 2.5, 2.5, Math.cos(lr) * lean * 2.5);
      const base = new THREE.Vector3(x, gy - 0.2, z);
      const dir = top.clone().normalize();
      _q.setFromUnitVectors(UP, dir);
      _m.compose(_p.copy(base).addScaledVector(dir, 1.35), _q, _s);
      K.timber.box(0.07, 2.7, 0.07, _m, { color: [0.75, 0.7, 0.66] });
      const tip = base.clone().addScaledVector(dir, 2.55);
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), right);
      _m.compose(_p.copy(tip), _q, _s);
      K.timber.box(W + 0.16, 0.06, 0.06, _m, { color: [0.72, 0.68, 0.64] });
      const fwd = new THREE.Vector3().crossVectors(right, UP);
      for (let i = 0; i < P.count; i++) {
        const u = P.getX(i), v = P.getY(i);             // u across, v up (−H/2 .. H/2)
        const down = H / 2 - v;                         // 0 at the bar
        const wave = Math.sin(u * 3.1 + down * 2.4 + R() * 0.2) * 0.06 * down + 0.05 * down * down;
        _p.copy(tip).addScaledVector(right, u).addScaledVector(UP, -down - 0.04).addScaledVector(fwd, wave);
        P.setXYZ(i, _p.x, _p.y, _p.z);
      }
    } else {
      // fallen: the pole on the ground, the cloth trampled flat, crumpled over the slope
      const c = Math.cos(yaw), s = Math.sin(yaw);
      for (let k = 0; k < 3; k++) {
        const t = -1.1 + k * 1.1;
        const px = x - s * 0.62 + c * t, pz = z - c * 0.62 - s * t;
        _q.setFromAxisAngle(UP, yaw);
        _m.compose(_p.set(px, envHeight(px, pz) + 0.05, pz), _q, _s);
        K.timber.box(1.12, 0.07, 0.07, _m, { color: [0.72, 0.68, 0.64] });
      }
      for (let i = 0; i < P.count; i++) {
        const u = P.getX(i), v = P.getY(i);
        const wx = x + c * u + s * v * 0.95, wz = z - s * u + c * v * 0.95;
        const crumple = 0.04 + 0.05 * Math.abs(Math.sin(u * 7 + v * 5));
        P.setXYZ(i, wx, envHeight(wx, wz) + crumple, wz);
      }
    }
    g.computeVertexNormals();
    cloth.geom(g, new THREE.Matrix4(), { color: kind === 0 ? [0.95, 0.95, 0.95] : [0.8, 0.78, 0.76] });
    g.dispose();
  }
  return { cloth, count: BANNERS.length };
}

// ------------------------------------------------------------------------------------------------ the build pads
// the pads' shader is per edition: envPadMaterial in src/gfx/{webgl2,webgpu}/materials/env.js (decision 0001)

/** The six build pads: one draped grid per pad, one draw. */
export function createPads() {
  const C = ARENA.camp;
  const S = 2.8, n = 14;
  const pos = [], loc = [], pad = [], idx = [];
  C.pads.forEach((pd, k) => {
    const base = pos.length / 3;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const lx = (i / n - 0.5) * S, lz = (j / n - 0.5) * S;
      const x = pd.x + lx, z = pd.z + lz;
      pos.push(x, envHeight(x, z) + 0.05, z);
      loc.push(lx / C.padRadius, -lz / C.padRadius); pad.push(k);
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = base + j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aLocal', new THREE.Float32BufferAttribute(loc, 2));
  g.setAttribute('aPad', new THREE.Float32BufferAttribute(pad, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const uniforms = {
    uPad: { value: C.pads.map((_, k) => new THREE.Vector4(0.1, 0, 0, k + 1)) }, uTime: { value: 0 }, uFogDensity: { value: 0.006 },
  };
  const mat = gfx().materials.envPadMaterial(uniforms);   // per edition (decision 0001); premultiplied-style blend, polygon offset
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'camp-pads';
  mesh.renderOrder = 1;
  const near = C.pads.map(() => 0), built = C.pads.map(() => 0);
  return {
    mesh, uniforms,
    /**
     * @param {number} dt @param {number} t @param {number} camp 0..1 @param {number} fogDensity
     * @param {number} nearIdx the pad the player stands at (−1 none) @param {boolean[]} builtArr
     */
    update(dt, t, camp, fogDensity, nearIdx, builtArr) {
      uniforms.uTime.value = t; uniforms.uFogDensity.value = fogDensity;
      const base = 0.1 + 0.5 * camp;                                 // dim by night, awake at the camp
      for (let k = 0; k < near.length; k++) {
        near[k] += ((k === nearIdx ? 1 : 0) * camp - near[k]) * Math.min(1, dt * 6);
        built[k] += ((builtArr[k] ? 1 : 0) - built[k]) * Math.min(1, dt * 4);
        const v = uniforms.uPad.value[k];
        v.x = base * (1 - 0.35 * built[k]); v.y = near[k]; v.z = built[k];
      }
    },
  };
}
