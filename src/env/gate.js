// @ts-check
// Environment · the gate: oak double doors under the arch (vertical planks cut to the arch), two barricade beams, iron
// bands. Instanced (3 draws). Damage states from the gate's HP fraction (state.gate.hp / hpMax):
//   ≥ 0.75 whole · ≥ 0.5 cracked (a plank split, a beam askew) · ≥ 0.25 holed (planks broken off, a beam down, a band
//   bent) · > 0 failing (more planks gone, the leaves sag on their hinges) · 0 breached (the leaves hang open inward).
// GATE_HIT shakes the doors for a beat.
import * as THREE from 'three';
import { ARENA } from '../shared/arena.js';
import { gateTop } from './keep.js';

const G = ARENA.gate;
const DOOR_Z = -0.55;

/**
 * @param {Record<string, THREE.Material>} mats @param {(g: THREE.BufferGeometry) => void} ensureAttrs
 */
export function createGate(mats, ensureAttrs) {
  const group = new THREE.Group(); group.name = 'gate';
  const PL = 5; // planks per leaf
  const pw = (G.x1 - G.x0) / 2 / PL;
  // plank geometry: 1 × 4 m tall, uv 0..1 per 4 m, origin at the bottom centre; scaled per instance
  const plankGeo = new THREE.BoxGeometry(pw - 0.025, 4, 0.14);
  plankGeo.translate(0, 2, 0);
  { const uv = plankGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * pw / 4, uv.getY(i)); }
  const beamGeo = new THREE.BoxGeometry(1, 0.34, 0.24);
  { const uv = beamGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.4, uv.getY(i) * 0.1); }
  const bandGeo = new THREE.BoxGeometry(1, 0.13, 0.04);
  for (const g of [plankGeo, beamGeo, bandGeo]) ensureAttrs(g);

  /** pieces: { kind, leaf (-1 L, +1 R), base: {x,y,z,sy,rz}, broken: per-level overrides } */
  const planks = [], beams = [], bands = [];
  for (const leaf of [-1, 1]) {
    for (let i = 0; i < PL; i++) {
      const x = leaf < 0 ? G.x0 + pw * (i + 0.5) : (G.x0 + G.x1) / 2 + pw * (i + 0.5);
      const h = gateTop(x) - 0.02;
      planks.push({ leaf, x, y: 0, z: DOOR_Z + (i % 2 ? 0.015 : 0), sy: h / 4, rz: 0, tone: 0.85 + 0.25 * ((i * 7 + (leaf > 0 ? 3 : 0)) % 5) / 4 });
    }
    for (const y of [0.55, 1.75, 2.95]) bands.push({ leaf, x: leaf < 0 ? (G.x0 + (G.x0 + G.x1) / 2) / 2 : ((G.x0 + G.x1) / 2 + G.x1) / 2, y, z: DOOR_Z + 0.09, len: (G.x1 - G.x0) / 2 - 0.2, rz: 0 });
  }
  for (const y of [1.15, 2.45]) beams.push({ x: (G.x0 + G.x1) / 2, y, z: DOOR_Z + 0.25, len: G.x1 - G.x0 + 0.9, rz: 0 });

  // damage tables: which pieces break at which level (indices into planks / beams / bands)
  const BREAK = {
    planks: { 1: [7], 2: [1, 7, 8], 3: [1, 2, 3, 6, 7, 8] },
    beams: { 1: [], 2: [1], 3: [0, 1] },
    bands: { 2: [4], 3: [1, 4, 5] },
  };
  const iPlank = new THREE.InstancedMesh(plankGeo, mats.timber, planks.length);
  const iBeam = new THREE.InstancedMesh(beamGeo, mats.timber, beams.length);
  const iBand = new THREE.InstancedMesh(bandGeo, mats.iron, bands.length);
  iPlank.name = 'gate-planks'; iBeam.name = 'gate-beams'; iBand.name = 'gate-bands';
  for (const m of [iPlank, iBeam, iBand]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
  planks.forEach((p, i) => iPlank.setColorAt(i, new THREE.Color(p.tone, p.tone * 0.96, p.tone * 0.92)));
  beams.forEach((_, i) => iBeam.setColorAt(i, new THREE.Color(0.8, 0.75, 0.7)));

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  const st = { level: -1, frac: 1, shake: 0, t: 0, open: 0 };

  function hingeRot(leaf, level) {
    // DESIGN §12.4: the ending opens the doors from the inside, swinging them out over the plaza
    if (st.open > 0) { const e = st.open * st.open * (3 - 2 * st.open); return leaf * (level >= 4 ? 1.25 : 0) * (1 - e) + leaf * 1.5 * e; }
    if (level >= 4) return leaf * 1.25;   // swung open inward (breached)
    if (level >= 3) return leaf * 0.06;   // sagging
    return 0;
  }
  function layout() {
    const L = st.level;
    const sh = st.shake > 0 ? Math.sin(st.t * 70) * 0.035 * st.shake : 0;
    planks.forEach((p, i) => {
      let sy = p.sy, rz = 0, dy = 0, dz = 0;
      const broke = Object.entries(BREAK.planks).some(([lv, ids]) => L >= Number(lv) && ids.includes(i));
      if (broke) { const k = (i * 37) % 5; sy = p.sy * (0.25 + 0.12 * k); rz = ((k % 2) ? 1 : -1) * 0.06 * k; }
      if (L >= 4) { sy = p.sy * (0.55 + 0.1 * ((i * 13) % 4)); }
      // the hinge: rotate the leaf around its outer edge
      const hx = p.leaf < 0 ? G.x0 : G.x1;
      const a = hingeRot(p.leaf, L);
      const lx = p.x - hx;
      const x = hx + lx * Math.cos(a), z = p.z + sh - lx * Math.sin(a) * (p.leaf < 0 ? 1 : 1);
      _q.setFromEuler(_e.set(0, a, rz));
      _m.compose(_p.set(x, dy + (L >= 3 ? -0.04 : 0), z + dz), _q, _s.set(1, sy, 1));
      iPlank.setMatrixAt(i, _m);
    });
    beams.forEach((b, i) => {
      const down = (BREAK.beams[2].includes(i) && L >= 2) || (L >= 3) || L >= 4;
      const askew = L >= 1 && i === 0 && !down;
      const y = down ? 0.18 + 0.1 * i : b.y, rz = down ? (i ? 0.28 : -0.2) : askew ? 0.07 : 0;
      _q.setFromEuler(_e.set(down ? 0.4 : 0, 0, rz));
      _m.compose(_p.set(b.x + (down ? (i ? 0.6 : -0.5) : 0), y, b.z + sh + (down ? 0.55 : 0)), _q, _s.set(down ? b.len * 0.55 : b.len, 1, 1));
      iBeam.setMatrixAt(i, _m);
    });
    bands.forEach((b, i) => {
      const bent = Object.entries(BREAK.bands).some(([lv, ids]) => L >= Number(lv) && ids.includes(i));
      const hx = b.leaf < 0 ? G.x0 : G.x1;
      const a = hingeRot(b.leaf, L);
      const lx = b.x - hx;
      _q.setFromEuler(_e.set(0, a, bent ? 0.22 * (i % 2 ? 1 : -1) : 0));
      _m.compose(_p.set(hx + lx * Math.cos(a), b.y - (bent ? 0.1 : 0), b.z + sh - lx * Math.sin(a)), _q, _s.set(b.len * (bent ? 0.7 : 1), 1, 1));
      iBand.setMatrixAt(i, _m);
    });
    iPlank.instanceMatrix.needsUpdate = iBeam.instanceMatrix.needsUpdate = iBand.instanceMatrix.needsUpdate = true;
    iPlank.computeBoundingSphere(); iBeam.computeBoundingSphere(); iBand.computeBoundingSphere();
  }
  const levelOf = (f) => (f <= 0 ? 4 : f < 0.25 ? 3 : f < 0.5 ? 2 : f < 0.75 ? 1 : 0);

  const api = {
    group,
    get level() { return st.level; },
    /** @param {number} frac 0..1 @param {boolean} [force] */
    setHp(frac, force = false) {
      st.frac = frac;
      const L = levelOf(frac);
      if (L !== st.level || force) { st.level = L; layout(); }
    },
    hit(dmg = 1) { st.shake = Math.min(1, st.shake + 0.25 + dmg * 0.02); },
    /** DESIGN §8: 0 shut .. 1 swung wide open from the inside (the ending's host marches out). */
    setOpen(x) { const v = Math.max(0, Math.min(1, x)); if (Math.abs(v - st.open) > 1e-4) { st.open = v; layout(); } },
    get open() { return st.open; },
    update(dt) {
      st.t += dt;
      if (st.shake > 0) { st.shake = Math.max(0, st.shake - dt * 3); layout(); }
    },
  };
  api.setHp(1, true);
  return api;
}
