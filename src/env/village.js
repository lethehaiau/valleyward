// @ts-check
// Environment (DESIGN §12.7, a quiet hint on every night): the goblins' village in the valley beyond the slope,
// on the valley floor past the horde's mustering ground, seen from the wall walk ≈ 110 m away as a peaceful far village:
// round wattle-and-daub huts with thatched cone roofs (Codex tiles), drying racks with hides, a well, stake fences and
// lantern posts (glowing glass, no lights). In the ending's hunt beat it burns: `setBurn(x)` swells pixel flames on the
// roofs and racks (light-less instances of the props flame draw) and a wide additive fire glow over the village.
// Geometry merges into the keep's timber / stone / voids builders; the walls and roofs are 2 draws; the glow is 1 draw.
import * as THREE from 'three';
import { ARENA } from '../shared/arena.js';
import { Builder, rng } from './util.js';
import { envHeight } from './terrain.js';
import { stakes } from './keep.js';
import { gfx } from '../gfx/current.js';

/** The village centre (x, z) and radius (pines keep clear of it: nature.js). */
export const VILLAGE = Object.freeze(/** @type {any} */ (ARENA).village ?? { x: 12, z: 108, r: 17 });   // ARENA.village wins when the arena defines it

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();

/**
 * @param {{ timber: Builder, stone: Builder, voids: Builder }} K
 * @returns {{ mud: Builder, thatch: Builder, glows: {x:number,y:number,z:number,sx:number,sy:number,sz:number}[], fires: {x:number,y:number,z:number,s:number}[] }}
 */
export function buildVillage(K) {
  const R = rng(4242);
  const mud = new Builder(4), thatch = new Builder(4);
  const glows = [], fires = [];
  const V = VILLAGE;
  const gy = (x, z) => envHeight(x, z) - 0.15;
  const tone = () => { const t = 0.82 + 0.25 * R(); return [t, t * 0.97, t * 0.93]; };

  // ---------------------------------------------------------------- huts in a loose ring round the well
  const huts = 8;
  for (let i = 0; i < huts; i++) {
    const a = (i / huts) * Math.PI * 2 + 0.3 + (R() - 0.5) * 0.35;
    const d = 9 + R() * 3.5;
    const x = V.x + Math.cos(a) * d, z = V.z + Math.sin(a) * d;
    const r = 2.1 + R() * 0.9, h = 1.7 + R() * 0.4, rh = 2.2 + R() * 0.8;
    const y = gy(x, z);
    const wall = new THREE.CylinderGeometry(r, r * 1.04, h, 12, 1, true);
    _m.compose(_p.set(x, y + h / 2, z), _q.setFromAxisAngle(UP, R() * 6.28), _s);
    mud.geom(wall, _m, { color: tone(), uvScale: [(2 * Math.PI * r) / 4, h / 4] });
    const roof = new THREE.ConeGeometry(r + 0.55, rh, 12, 2, true);
    _m.compose(_p.set(x, y + h + rh / 2 - 0.12, z), _q.setFromAxisAngle(UP, R() * 6.28), _s);
    thatch.geom(roof, _m, { color: tone(), uvScale: [(2 * Math.PI * (r + 0.55)) / 4, Math.hypot(rh, r + 0.55) / 4] });
    // the knot of straw at the top and a dark doorway facing the well
    _m.compose(_p.set(x, y + h + rh - 0.2, z), _q.identity(), _s);
    thatch.geom(new THREE.CylinderGeometry(0.12, 0.3, 0.5, 6), _m, { color: [0.7, 0.66, 0.6] });
    const ia = Math.atan2(V.z - z, V.x - x);
    _q.setFromAxisAngle(UP, -ia + Math.PI / 2);
    _m.compose(_p.set(x + Math.cos(ia) * (r + 0.02), y + 0.6, z + Math.sin(ia) * (r + 0.02)), _q, _s);
    K.voids.box(0.85, 1.2, 0.06, _m, {});
    fires.push({ x, y: y + h + 0.3, z, s: 4.6 + R() * 1.8 }, { x: x + (R() - 0.5) * r, y: y + h * 0.4, z: z + (R() - 0.5) * r, s: 2.8 + R() * 1.2 });
  }
  // ---------------------------------------------------------------- the well at the centre
  {
    const y = gy(V.x, V.z);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      _q.setFromAxisAngle(UP, -a);
      _m.compose(_p.set(V.x + Math.cos(a) * 0.9, y + 0.35, V.z + Math.sin(a) * 0.9), _q, _s);
      K.stone.box(0.5, 0.7, 0.32, _m, { bevel: true, uvOff: [R(), R()] });
    }
    _m.compose(_p.set(V.x, y + 0.66, V.z), _q.identity(), _s);
    K.voids.box(1.3, 0.04, 1.3, _m, {});
    for (const s of [-1, 1]) K.timber.aabb(V.x + s * 1.0 - 0.07, y, V.z - 0.07, V.x + s * 1.0 + 0.07, y + 2.1, V.z + 0.07, { color: tone() });
    K.timber.aabb(V.x - 1.15, y + 2.05, V.z - 0.06, V.x + 1.15, y + 2.17, V.z + 0.06, { color: tone() });
    for (const s of [-1, 1]) {
      _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), s * 0.55);
      _m.compose(_p.set(V.x, y + 2.35, V.z + s * 0.5), _q, _s);
      thatch.box(2.5, 0.08, 1.2, _m, { color: tone() });
    }
  }
  // ---------------------------------------------------------------- drying racks with hides and fish
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.9 + R() * 0.3, d = 5 + R() * 1.5;
    const x = V.x + Math.cos(a) * d, z = V.z + Math.sin(a) * d, y = gy(x, z), yaw = a + Math.PI / 2;
    const ux = Math.cos(yaw), uz = -Math.sin(yaw);
    for (const s of [-1, 1]) K.timber.aabb(x + ux * s * 1.2 - 0.06, y, z + uz * s * 1.2 - 0.06, x + ux * s * 1.2 + 0.06, y + 1.9, z + uz * s * 1.2 + 0.06, { color: tone() });
    _q.setFromAxisAngle(UP, yaw);
    _m.compose(_p.set(x, y + 1.85, z), _q, _s);
    K.timber.box(2.6, 0.08, 0.08, _m, { color: tone() });
    for (let k = 0; k < 4; k++) {
      const t = -0.9 + k * 0.6;
      _m.compose(_p.set(x + ux * t, y + 1.35 - R() * 0.2, z + uz * t), _q, _s);
      const c = k % 2 ? [0.85, 0.72, 0.55] : [0.6, 0.62, 0.66];
      K.timber.box(0.42, 0.8 + R() * 0.3, 0.04, _m, { color: c });
    }
    fires.push({ x, y: y + 0.8, z, s: 2.6 });
  }
  // ---------------------------------------------------------------- the stake fence round the village (two gaps)
  const FR = V.r, segs = 14;
  for (let k = 0; k < segs; k++) {
    if (k === 3 || k === 10) continue;
    const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1) / segs) * Math.PI * 2;
    const A = new THREE.Vector3(V.x + Math.cos(a0) * FR, 0, V.z + Math.sin(a0) * FR);
    const B = new THREE.Vector3(V.x + Math.cos(a1) * FR, 0, V.z + Math.sin(a1) * FR);
    A.y = B.y = Math.min(gy(A.x, A.z), gy(B.x, B.z));
    stakes(K.timber, R, A, B, 1.4);
  }
  // ---------------------------------------------------------------- lantern posts (warm glass, seen through the fog)
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.15, d = i % 2 ? 6.8 : 13.5;
    const x = V.x + Math.cos(a) * d, z = V.z + Math.sin(a) * d, y = gy(x, z);
    K.timber.aabb(x - 0.06, y, z - 0.06, x + 0.06, y + 2.2, z + 0.06, { color: tone() });
    K.timber.aabb(x - 0.05, y + 2.1, z - 0.05, x + 0.45, y + 2.18, z + 0.05, { color: tone() });
    glows.push({ x: x + 0.4, y: y + 1.8, z, sx: 0.22, sy: 0.3, sz: 0.22 });
  }
  return { mud, thatch, glows, fires };
}

/** The wide fire glow over the burning village (camera-facing, additive, HDR so the bloom spreads it). */
export function createVillageGlow() {
  const uniforms = { uBurn: { value: 0 }, uTime: { value: 0 } };
  const mat = gfx().materials.envVillageGlowMaterial(uniforms);   // per edition (decision 0001); additive, no depth write
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.position.set(VILLAGE.x, envHeight(VILLAGE.x, VILLAGE.z) + 5, VILLAGE.z);
  mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.name = 'village-glow'; mesh.visible = false;
  return { mesh, uniforms };
}
