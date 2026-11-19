// @ts-check
// Environment · props: oil barrels (instanced; burst into staves on EV.BARREL_BURST), the braziers and the beacon basket
// (iron, merged) with their pixel flame sprites (one instanced billboard draw), the kindling pan, fences with pointed
// posts along the plaza edge, boulders and grass tufts (instanced), oil surfaces in the troughs.
import * as THREE from 'three';
import { ARENA, groundHeight } from '../shared/arena.js';
import { Builder, FACE, rng, polyDist, vnoise } from './util.js';
import { envHeight } from './terrain.js';
import { stakes } from './keep.js';
import { gfx } from '../gfx/current.js';

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();

/** An iron fire basket (legs, vertical bars, rings) into an iron Builder. */
function basket(B, x, y, z, r, h, legH) {
  const bars = 10;
  for (let i = 0; i < bars; i++) {
    const a = (i / bars) * Math.PI * 2;
    _q.setFromAxisAngle(UP, -a);
    _m.compose(_p.set(x + Math.cos(a) * r, y + legH + h / 2, z + Math.sin(a) * r), _q, _s);
    B.box(0.07 * r / 0.45, h, 0.07 * r / 0.45, _m, {});
  }
  for (const yy of [legH + 0.04, legH + h * 0.55, legH + h - 0.04]) {
    const seg = 14;
    for (let i = 0; i < seg; i++) {
      const a = ((i + 0.5) / seg) * Math.PI * 2;
      const rr = r * (yy > legH + h * 0.9 ? 1.08 : 1.0);
      _q.setFromAxisAngle(UP, -a);
      _m.compose(_p.set(x + Math.cos(a) * rr, y + yy, z + Math.sin(a) * rr), _q, _s);
      B.box(0.06, 0.07, (2 * Math.PI * rr) / seg + 0.02, _m, {});
    }
  }
  // bowl
  B.aabb(x - r * 0.75, y + legH - 0.03, z - r * 0.75, x + r * 0.75, y + legH + 0.05, z + r * 0.75, {});
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const lx = x + Math.cos(a) * r * 0.85, lz = z + Math.sin(a) * r * 0.85;
    _q.setFromEuler(new THREE.Euler(Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18));
    _m.compose(_p.set(lx, y + legH / 2, lz), _q, _s);
    B.box(0.08, legH + 0.05, 0.08, _m, {});
  }
}

/** A square bar of width w from a to b into a Builder. */
const _ba = new THREE.Vector3(), _bb = new THREE.Vector3(), _bc = new THREE.Vector3();
function beam(B, a, b, w) {
  _ba.subVectors(b, a); const len = _ba.length(); _ba.normalize();
  _bb.set(1, 0, 0); if (Math.abs(_ba.x) > 0.9) _bb.set(0, 0, 1);
  _bc.crossVectors(_bb, _ba).normalize(); _bb.crossVectors(_ba, _bc).normalize();
  _m.makeBasis(_bb, _ba, _bc).setPosition(_p.addVectors(a, b).multiplyScalar(0.5));
  B.box(w, len, w, _m, {});
}

/**
 * @param {{ stone: Builder, timber: Builder, iron: Builder }} K builders shared with the keep
 * @param {Record<string, THREE.Material>} mats @param {Record<string, THREE.Texture>} tex @param {THREE.Texture} flameTex
 * @param {THREE.Texture} tuftTex @param {string} quality
 * @param {{ flames?: {x:number,y:number,z:number,s:number}[], glows?: {x:number,y:number,z:number,sx:number,sy:number,sz:number}[] }} [extra]
 *   DESIGN §9: flames and glowing boxes (lantern glass) that burn without a light of their own (Brother Cinder's stall)
 */
export function buildProps(K, mats, tex, flameTex, tuftTex, quality, extra = {}) {
  const xFlames = extra.flames || [], xGlows = extra.glows || [];
  const R = rng(23);
  const group = new THREE.Group(); group.name = 'props';
  /** @type {{ x: number, y: number, z: number, s: number }[]} */
  const flames = [];

  // ---------------------------------------------------------------- braziers on stone pillars
  for (const [bx, bz] of ARENA.braziers) {
    const pillarH = 0.75;
    K.stone.aabb(bx - 0.42, 0, bz - 0.42, bx + 0.42, pillarH, bz + 0.42, { color: [0.95, 0.95, 0.98], bevel: true, uvOff: [R(), R()] });
    K.stone.aabb(bx - 0.5, pillarH, bz - 0.5, bx + 0.5, pillarH + 0.12, bz + 0.5, { color: [1.05, 1.05, 1.08], bevel: true, uvOff: [R(), R()] });
    basket(K.iron, bx, pillarH + 0.12, bz, 0.42, 0.55, 0.32);
    flames.push({ x: bx, y: pillarH + 0.12 + 0.32 + 0.05, z: bz, s: 1.45 });
  }
  // ---------------------------------------------------------------- the beacon basket on the SE tower + the kindling pan
  const B = ARENA.beacon;
  // an iron cresset mast on the tower top lifts the basket to ARENA.beacon.basket.y, clear of the merlons
  // (a stone footing, four raked iron legs, a centre post, two square collars, X-bracing and a deck under the basket)
  const top = ARENA.keep.towers.find((t) => t.beacon)?.height ?? 10;
  const by = B.basket.y - 0.2;
  {
    const bx = B.basket.x, bz = B.basket.z, foot = top + 0.45, deck = by - 0.12;
    K.stone.aabb(bx - 1.25, top, bz - 1.25, bx + 1.25, foot, bz + 1.25, { color: [0.95, 0.95, 0.98], bevel: true, uvOff: [R(), R()] });
    const legAt = (sx, sz, y) => { const k = (y - foot) / (deck - foot); const r = 1.0 + (0.55 - 1.0) * k; return new THREE.Vector3(bx + sx * r, y, bz + sz * r); };
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sz] of corners) beam(K.iron, legAt(sx, sz, foot), legAt(sx, sz, deck), 0.17);
    beam(K.iron, new THREE.Vector3(bx, foot, bz), new THREE.Vector3(bx, deck, bz), 0.22);
    const y1 = foot + (deck - foot) * 0.38, y2 = foot + (deck - foot) * 0.74;
    for (const y of [y1, y2, deck - 0.02]) {
      for (let i = 0; i < 4; i++) {
        const [ax, az] = corners[i], [cx, cz] = corners[(i + 1) % 4];
        beam(K.iron, legAt(ax, az, y), legAt(cx, cz, y), 0.12);
      }
    }
    for (const [ya, yb] of [[foot + 0.05, y1], [y1, y2]]) {
      for (let i = 0; i < 4; i++) {
        const [ax, az] = corners[i], [cx, cz] = corners[(i + 1) % 4];
        beam(K.iron, legAt(ax, az, ya), legAt(cx, cz, yb), 0.07);
        beam(K.iron, legAt(cx, cz, ya), legAt(ax, az, yb), 0.07);
      }
    }
    K.iron.aabb(bx - 0.85, deck - 0.06, bz - 0.85, bx + 0.85, deck + 0.04, bz + 0.85, {});
    // a ladder of iron rungs up one leg (west face, toward the walk)
    for (let y = foot + 0.4; y < deck - 0.2; y += 0.42) beam(K.iron, legAt(-1, -1, y).add(new THREE.Vector3(-0.05, 0, 0)), legAt(-1, 1, y).add(new THREE.Vector3(-0.05, 0, 0)), 0.045);
  }
  basket(K.iron, B.basket.x, by, B.basket.z, 1.05, 1.0, 0.2);
  flames.push({ x: B.basket.x, y: by + 0.2 + 0.1, z: B.basket.z, s: 3.2 });
  {
    const p = B.pan;
    K.iron.aabb(p.x - 0.5, p.y + 0.55, p.z - 0.4, p.x + 0.5, p.y + 0.62, p.z + 0.4, {});
    for (const [dx, dz] of [[-0.42, -0.32], [0.42, -0.32], [-0.42, 0.32], [0.42, 0.32]]) K.iron.aabb(p.x + dx - 0.04, p.y, p.z + dz - 0.04, p.x + dx + 0.04, p.y + 0.6, p.z + dz + 0.04, {});
    for (let i = 0; i < 4; i++) {
      _q.setFromAxisAngle(UP, R() * Math.PI);
      _m.compose(_p.set(p.x + (R() - 0.5) * 0.4, p.y + 0.7 + i * 0.06, p.z + (R() - 0.5) * 0.3), _q, _s);
      K.timber.box(0.75, 0.1, 0.1, _m, { color: [0.8, 0.72, 0.65] });
    }
  }

  // ---------------------------------------------------------------- fences: pointed posts + rails, broken in places
  // No fence may stand where the player or the horde walks, and
  // fences get no colliders. Every run inside ARENA.playerBounds is gone: the plaza-edge runs (6, 9.4)–(12, 9.6)–
  // (18, 9.5), (20.5, 9.4)–(25, 9.2), (−21, 9.4)–(−15, 9.5), (−14, 9.6)–(−11.6, 10.2), the road bend (27.5, 7)–(29.5, 10.5)
  // and the mid-slope runs (35.5, 10.5)–(37, 15), (18, 16.5)–(21, 22). Any run added here later is dropped if a post
  // would stand within 0.6 m of the bounds (the edges are marked by the boulder band, the pine lines and the palisade).
  const fenceLines = /** @type {number[][][]} */ ([]);
  const FB = ARENA.playerBounds;
  const inBounds = (/** @type {number[]} */ [x, z]) => x > FB.x0 - 0.6 && x < FB.x1 + 0.6 && z > FB.z0 - 0.6 && z < FB.z1 + 0.6;
  for (const line of fenceLines) {
    if (line.some(inBounds)) continue;
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i], [bx2, bz2] = line[i + 1];
      const len = Math.hypot(bx2 - ax, bz2 - az);
      const n = Math.max(1, Math.round(len / 2.0));
      const dir = new THREE.Vector3(bx2 - ax, 0, bz2 - az).normalize();
      for (let k = 0; k <= n; k++) {
        const x = ax + (bx2 - ax) * (k / n), z = az + (bz2 - az) * (k / n);
        const y = envHeight(x, z);
        const h = 1.35 + 0.25 * R();
        _q.setFromEuler(new THREE.Euler((R() - 0.5) * 0.08, R() * 0.6, (R() - 0.5) * 0.08));
        _m.compose(_p.set(x, y + h / 2 - 0.2, z), _q, _s);
        K.timber.box(0.2, h, 0.2, _m, { color: [0.85, 0.8, 0.75], uvOff: [R(), 0] });
        _m.compose(_p.set(x, y + h - 0.2 + 0.16, z), _q, _s);
        K.timber.geom(new THREE.ConeGeometry(0.15, 0.32, 4, 1), _m, { color: [0.8, 0.74, 0.7], uvScale: [0.2, 0.1] });
        if (k < n) {
          const x2 = ax + (bx2 - ax) * ((k + 1) / n), z2 = az + (bz2 - az) * ((k + 1) / n);
          const y2 = envHeight(x2, z2);
          for (const ry of [0.45, 0.95]) {
            if (R() < 0.12) continue; // a missing rail here and there
            const a = new THREE.Vector3(x, y + ry, z), b = new THREE.Vector3(x2, y2 + ry, z2);
            const d = new THREE.Vector3().subVectors(b, a); const l = d.length(); d.normalize();
            const side = new THREE.Vector3().crossVectors(d, UP).normalize();
            const up2 = new THREE.Vector3().crossVectors(side, d);
            _m.makeBasis(d, up2, side).setPosition(a.add(b).multiplyScalar(0.5));
            K.timber.box(l, 0.12, 0.08, _m, { color: [0.78, 0.72, 0.68], uvOff: [R(), R()] });
          }
        }
      }
      void dir;
    }
  }
  // the palisade at the plaza's west end: the west bound (x −22). It stands beyond the bound
  // (x −22.8, the player's eye stops at −21.6), runs from the keep's tower to the slope and turns down it a little
  stakes(K.timber, R, new THREE.Vector3(-22.8, 0, 0.2), new THREE.Vector3(-22.8, 0, 9.2), 2.6);
  stakes(K.timber, R, new THREE.Vector3(-22.8, envHeight(-22.8, 9.6), 9.6), new THREE.Vector3(-23.0, envHeight(-23.0, 14), 14), 2.3);

  // ---------------------------------------------------------------- oil barrels (instanced: staves + hoops)
  const barrelGeo = new THREE.CylinderGeometry(0.4, 0.4, 1.0, 10, 4);
  {
    const P = barrelGeo.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const y = P.getY(i); const k = 1 + 0.12 * (1 - (2 * y) ** 2);
      P.setX(i, P.getX(i) * k); P.setZ(i, P.getZ(i) * k);
    }
    barrelGeo.computeVertexNormals();
    const uv = barrelGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.65, uv.getY(i) * 0.25);
    barrelGeo.translate(0, 0.5, 0);
  }
  const hoopGeo = new THREE.BufferGeometry();
  {
    const hb = new Builder(1);
    for (const y of [0.12, 0.88]) hb.geom(new THREE.CylinderGeometry(0.43, 0.43, 0.07, 10, 1, true), new THREE.Matrix4().makeTranslation(0, y, 0), { uvScale: [0.6, 0.05] });
    for (const y of [0.36, 0.64]) hb.geom(new THREE.CylinderGeometry(0.455, 0.455, 0.06, 10, 1, true), new THREE.Matrix4().makeTranslation(0, y, 0), { uvScale: [0.6, 0.05] });
    hoopGeo.copy(hb.build());
  }
  const nB = ARENA.oil.barrels.length;
  const barrels = new THREE.InstancedMesh(barrelGeo, mats.barrel, nB);
  const hoops = new THREE.InstancedMesh(hoopGeo, mats.iron, nB);
  barrels.name = 'barrels'; hoops.name = 'barrel-hoops';
  /** @type {THREE.Matrix4[]} */
  const barrelM = [];
  ARENA.oil.barrels.forEach(([x, z], i) => {
    const y = groundHeight(x, z) - 0.03;
    _q.setFromAxisAngle(UP, R() * Math.PI * 2);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(1, 1, 1));
    barrelM.push(m); barrels.setMatrixAt(i, m); hoops.setMatrixAt(i, m);
  });
  barrels.castShadow = hoops.castShadow = true; barrels.receiveShadow = hoops.receiveShadow = true;
  group.add(barrels, hoops);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const barrelAlive = new Array(nB).fill(true);

  // debris staves (one pool, ballistic)
  const DEB = 72;
  const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.7, 0.05), mats.barrel, DEB);
  debris.name = 'barrel-debris';
  debris.frustumCulled = false;
  const deb = Array.from({ length: DEB }, () => ({ t: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3() }));
  for (let i = 0; i < DEB; i++) debris.setMatrixAt(i, zero);
  group.add(debris);
  let debNext = 0;

  // ---------------------------------------------------------------- boulders on the slope (instanced)
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  {
    const P = rockGeo.attributes.position;
    const key = (x, y, z) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    const off = new Map();
    for (let i = 0; i < P.count; i++) {
      const k = key(P.getX(i), P.getY(i), P.getZ(i));
      if (!off.has(k)) off.set(k, 0.78 + 0.4 * R());
      const s = off.get(k);
      P.setXYZ(i, P.getX(i) * s, Math.max(-0.35, P.getY(i)) * s * 0.75, P.getZ(i) * s);
    }
    rockGeo.computeVertexNormals();
  }
  const rockSpots = [];
  for (let i = 0; i < 400 && rockSpots.length < 70; i++) {
    const x = -40 + R() * 110, z = 10 + R() * 70;
    if (polyDist(ARENA.road.points, x, z) < 5) continue;
    if (ARENA.oil.barrels.some(([bx, bz]) => Math.hypot(bx - x, bz - z) < 2.5)) continue;
    if (vnoise(x * 0.07, z * 0.07) < 0.45) continue;
    rockSpots.push([x, z, 0.35 + R() * R() * 1.6]);
  }
  for (const [x, z, s] of [[-17, 9.6, 0.8], [-19, 8.8, 0.55], [25.5, 9.4, 0.7], [27.5, 8.5, 0.5], [9.5, 9.6, 0.45]]) rockSpots.push([x, z, s]);
  // inside the player's bounds a rock stays knee-high (≤ 0.45), so walking over it reads right
  const PB = ARENA.playerBounds;
  for (const r of rockSpots) if (r[0] > PB.x0 - 1.5 && r[0] < PB.x1 + 1.5 && r[1] > PB.z0 - 1.5 && r[1] < PB.z1 + 1.5) r[2] = Math.min(r[2], 0.45);
  // the bounds read as a natural barrier, a band of boulders just outside each open edge
  // (west down the slope beyond the palisade, east along x 46, south across the slope at z 60), so no invisible walls
  const band = (ax, az, bx2, bz2, outX, outZ) => {
    const len = Math.hypot(bx2 - ax, bz2 - az), n = Math.round(len / 1.45);
    for (let k = 0; k <= n; k++) {
      const t = k / n, s = 0.62 + 0.5 * R();
      if (R() < 0.08) continue;   // a broken line, not a wall
      rockSpots.push([ax + (bx2 - ax) * t + outX * (0.35 + 0.95 * s), az + (bz2 - az) * t + outZ * (0.35 + 0.95 * s), s]);
      if (R() < 0.4) { const s2 = 0.4 + 0.4 * R(); rockSpots.push([ax + (bx2 - ax) * t + outX * (1.6 + 1.2 * s2) + (R() - 0.5), az + (bz2 - az) * t + outZ * (1.6 + 1.2 * s2) + (R() - 0.5), s2]); }
    }
  };
  band(PB.x0, 9.6, PB.x0, PB.z1, -1, 0);
  band(PB.x1, PB.z0 + 0.2, PB.x1, PB.z1, 1, 0);
  band(PB.x0, PB.z1, PB.x1, PB.z1, 0, 1);
  const rocks = new THREE.InstancedMesh(rockGeo, mats.rock, rockSpots.length);
  rocks.name = 'rocks';
  rockSpots.forEach(([x, z, s], i) => {
    _q.setFromEuler(new THREE.Euler((R() - 0.5) * 0.4, R() * 6.28, (R() - 0.5) * 0.4));
    _m.compose(_p.set(x, envHeight(x, z) - 0.1 * s, z), _q, new THREE.Vector3(s * (0.9 + 0.5 * R()), s * (0.8 + 0.5 * R()), s * (0.9 + 0.5 * R())));
    rocks.setMatrixAt(i, _m);
  });
  rocks.castShadow = true; rocks.receiveShadow = true;
  group.add(rocks);

  // ---------------------------------------------------------------- grass tufts (crossed pixel cards, instanced)
  const tuftGeo = new THREE.BufferGeometry();
  {
    const tb = new Builder(1);
    for (const a of [0, Math.PI / 2]) {
      const pg = new THREE.PlaneGeometry(0.9, 0.6); pg.translate(0, 0.28, 0);
      tb.geom(pg, new THREE.Matrix4().makeRotationY(a));
    }
    tuftGeo.copy(tb.build());
    // normals up so the cards light like the ground under them
    const N = tuftGeo.attributes.normal; for (let i = 0; i < N.count; i++) N.setXYZ(i, 0, 1, 0);
  }
  const nTuft = quality === 'low' ? 1200 : quality === 'medium' ? 2200 : 3400;
  const tufts = new THREE.InstancedMesh(tuftGeo, mats.tuft, nTuft);
  tufts.name = 'tufts';
  let placed = 0;
  for (let i = 0; i < nTuft * 6 && placed < nTuft; i++) {
    const x = -30 + R() * 90, z = 0.3 + R() * 60;
    const dr = polyDist(ARENA.road.points, x, z);
    const P = ARENA.plaza;
    const onPlaza = x > P.x0 && x < P.x1 && z < P.z1 - 0.8;
    const verge = (dr > 2.6 && dr < 4.6) || (z > P.z1 - 1.5 && z < P.z1 + 1.5) || (z < 2.6 && z > 1.7);
    if (dr < 2.8) continue;
    if (onPlaza && !verge) continue;
    if (z < 1.75 && x > -16 && x < 16) continue;                      // not in the troughs
    if (x > ARENA.stair.x0 - 0.3 && x < ARENA.stair.x1 + 0.3 && z < ARENA.stair.zBottom + 0.3) continue;
    const dens = verge ? 0.9 : 0.25 + 0.6 * vnoise(x * 0.12, z * 0.12);
    if (R() > dens) continue;
    const s = 0.6 + R() * 0.8;
    _q.setFromAxisAngle(UP, R() * Math.PI);
    _m.compose(_p.set(x, envHeight(x, z) - 0.04, z), _q, new THREE.Vector3(s, s * (0.8 + 0.5 * R()), s));
    tufts.setMatrixAt(placed++, _m);
  }
  tufts.count = placed;
  tufts.receiveShadow = true;
  group.add(tufts);

  // ---------------------------------------------------------------- pixel flames (instanced billboards)
  const flameGeo = new THREE.PlaneGeometry(1, 1.5); flameGeo.translate(0, 0.75, 0);
  const flameMat = gfx().materials.envFlameMaterial({   // per edition (decision 0001)
    uMap: { value: flameTex }, uTime: { value: 0 }, uGain: { value: 3.2 }, uDark: { value: 0 }, uDarkFrom: { value: 0 }, uDarkTo: { value: 0 },
  });
  const flameInst = new THREE.InstancedBufferGeometry();
  flameInst.index = flameGeo.index; flameInst.attributes.position = flameGeo.attributes.position; flameInst.attributes.uv = flameGeo.attributes.uv;
  // + COLUMN extra instances over the beacon basket (scale 0 until a kindle: the flare's fire column)
  const COLUMN = 3;
  const NF = flames.length + COLUMN + xFlames.length;
  const fAttr = new THREE.InstancedBufferAttribute(new Float32Array(NF * 4), 4);
  const pAttr = new THREE.InstancedBufferAttribute(new Float32Array(NF), 1);
  flames.forEach((f, i) => { fAttr.setXYZW(i, f.x, f.y, f.z, f.s); pAttr.setX(i, R()); });
  const bf = flames[flames.length - 1];
  for (let k = 0; k < COLUMN; k++) { fAttr.setXYZW(flames.length + k, bf.x + (R() - 0.5) * 0.3, bf.y + 1.6 + k * 2.6, bf.z + (R() - 0.5) * 0.3, 0); pAttr.setX(flames.length + k, R()); }
  xFlames.forEach((f, k) => { fAttr.setXYZW(flames.length + COLUMN + k, f.x, f.y, f.z, f.s); pAttr.setX(flames.length + COLUMN + k, R()); });
  flameInst.setAttribute('aFlame', fAttr); flameInst.setAttribute('aPhase', pAttr);
  flameInst.instanceCount = NF;
  const flameMesh = new THREE.Mesh(flameInst, flameMat);
  flameMesh.name = 'flames';
  flameMesh.frustumCulled = false;
  flameMesh.renderOrder = 2;
  group.add(flameMesh);
  // coals glowing in each basket (HDR basic)
  const coals = new Builder(1);
  flames.forEach((f, i) => {
    const r = i === flames.length - 1 ? 0.8 : 0.32;
    for (let k = 0; k < 6; k++) {
      _q.setFromEuler(new THREE.Euler(R(), R(), R()));
      _m.compose(_p.set(f.x + (R() - 0.5) * r, f.y - 0.08 + R() * 0.06, f.z + (R() - 0.5) * r), _q, _s);
      coals.box(r * 0.5, r * 0.3, r * 0.45, _m, { color: [1, 0.35 + 0.3 * R(), 0.1] });
    }
  });
  xFlames.forEach((f) => {
    for (let k = 0; k < 4; k++) {
      _q.setFromEuler(new THREE.Euler(R(), R(), R()));
      _m.compose(_p.set(f.x + (R() - 0.5) * 0.25, f.y - 0.04 + R() * 0.04, f.z + (R() - 0.5) * 0.25), _q, _s);
      coals.box(0.14, 0.08, 0.12, _m, { color: [1, 0.35 + 0.3 * R(), 0.1] });
    }
  });
  for (const g of xGlows) coals.aabb(g.x - g.sx / 2, g.y - g.sy / 2, g.z - g.sz / 2, g.x + g.sx / 2, g.y + g.sy / 2, g.z + g.sz / 2, { color: [0.75, 0.42, 0.14] });
  const coalMesh = new THREE.Mesh(coals.build(), mats.coals);
  coalMesh.name = 'coals';
  group.add(coalMesh);

  // ---------------------------------------------------------------- oil surfaces (one mesh each: level + burnt look)
  /** @type {{ mesh: THREE.Mesh, mat: THREE.MeshStandardMaterial, rect: any, burn: number, lit: boolean }[]} */
  const oils = [];
  return {
    group, flames, flameMat, flameAttr: fAttr, column: { first: flames.length, count: COLUMN }, extraFlames: { first: flames.length + COLUMN, count: xFlames.length }, barrels, hoops, rocks, tufts, barrelM, barrelAlive, zero, debris, deb,
    nextDebris() { const i = debNext; debNext = (debNext + 1) % DEB; return i; }, oils,
  };
}
