// @ts-check
// Environment · pines (instanced low-poly layered cones, three variants, near set casts shadows, far set thins into the
// fog out to the valley floor and the far ridges) and the valley fog layers (big soft planes with drifting noise,
// manual exp² fog so they melt into the same haze).
import * as THREE from 'three';
import { VILLAGE } from './village.js';
import { ARENA } from '../shared/arena.js';
import { Builder, rng, polyDist, vnoise } from './util.js';
import { envHeight, ROAD_DRAWN } from './terrain.js';
import { gfx } from '../gfx/current.js';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * One tier of a pine: a low-poly skirt (side faces from the tip down to a jittered rim) plus a shallow dark underside,
 * non-indexed with flat normals. Every face gets its own planar UVs in metres (an orthonormal
 * basis in the face plane), so the pixel texels are square on every face instead of the streaks the triplanar pick
 * gave on slanted cones.
 */
function tier(r, h, seg, R, shade, mpt) {
  const P = [], N = [], U = [], C = [];
  const rim = [];
  const a0 = R() * Math.PI * 2;
  for (let i = 0; i < seg; i++) {
    const a = a0 + (i / seg) * Math.PI * 2;
    const rr = r * (0.88 + 0.24 * R());
    rim.push(new THREE.Vector3(Math.cos(a) * rr, -0.06 * h * R(), Math.sin(a) * rr));
  }
  const tip = new THREE.Vector3((R() - 0.5) * 0.08 * r, h, (R() - 0.5) * 0.08 * r);
  const under = new THREE.Vector3(0, h * 0.2, 0);
  const T = new THREE.Vector3(), S = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const tri = (A, B, Cc, cols) => {
    e1.subVectors(B, A); e2.subVectors(Cc, A); n.crossVectors(e1, e2).normalize();
    T.copy(e1).normalize(); S.crossVectors(n, T).normalize();
    const ou = R() * 4, ov = R() * 4;
    for (const [k, V] of [[0, A], [1, B], [2, Cc]]) {
      P.push(V.x, V.y, V.z); N.push(n.x, n.y, n.z);
      e1.subVectors(V, A);
      U.push(e1.dot(T) / mpt + ou, e1.dot(S) / mpt + ov);
      const c = cols[k]; C.push(c, c, c);
    }
  };
  for (let i = 0; i < seg; i++) {
    const p0 = rim[i], p1 = rim[(i + 1) % seg];
    tri(p0, tip, p1, [shade[0], shade[1], shade[0]]);          // the skirt (rim dark, tip light)
    tri(p1, under, p0, [shade[2], shade[2] * 0.8, shade[2]]);  // the underside (dark)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return g;
}

/** One pine variant: a trunk + `layers` stepped tiers (each one's rim well outside the tier above at that height). */
function pineGeometry(layers, height, R) {
  const B = new Builder(2);
  const trunkH = height * 0.14;
  const trunk = new THREE.CylinderGeometry(0.1 * height / 8, 0.2 * height / 8, trunkH + 0.8, 5, 1);
  B.geom(trunk, new THREE.Matrix4().makeTranslation(0, (trunkH + 0.8) / 2 - 0.4, 0), { color: [1.5, 0.95, 0.75], uvScale: [0.3, 0.6] });
  const crown = height - trunkH;
  const step = crown * 0.86 / layers;
  for (let i = 0; i < layers; i++) {
    const t = i / Math.max(1, layers - 1);
    const r = (0.34 - 0.2 * t) * height * (0.92 + 0.16 * R());
    const h = i === layers - 1 ? crown - step * i : step * 1.75;   // the top tier is the spire
    const y = trunkH + step * i;
    const g = tier(r, h, i === layers - 1 ? 6 : 7 + (i % 2), R, [0.72 + 0.06 * t, 1.28 + 0.1 * t, 0.42], 2);
    B.geom(g, new THREE.Matrix4().makeTranslation(0, y, 0), { uvScale: [1, 1] });
  }
  return B.build();
}

/**
 * @param {THREE.Material} pineMat @param {string} quality
 */
export function buildPines(pineMat, quality) {
  const R = rng(77);
  const variants = [pineGeometry(4, 7.5, R), pineGeometry(5, 10, R), pineGeometry(6, 12.5, R)];
  const mul = quality === 'low' ? 0.45 : quality === 'medium' ? 0.7 : 1;
  /** @type {number[][][]} */
  const near = [[], [], []], far = [[], [], []];
  const K = ARENA.keep;
  const PB = ARENA.playerBounds;
  const ok = (x, z) => {
    // no pine inside the player's bounds (they have no collider); the bound lines below frame them
    if (x > PB.x0 - 4.5 && x < PB.x1 + 4.5 && z > PB.z0 - 6 && z < PB.z1 + 4.5) return false;
    if (x > K.x0 - 6 && x < K.x1 + 6 && z > K.z0 - 6 && z < 11) return false;   // keep + plaza
    if (x > ARENA.plaza.x0 - 2 && x < ARENA.plaza.x1 + 2 && z < 12.5) return false;
    if (polyDist(ROAD_DRAWN, x, z) < 5.5) return false;
    if (x > 24 && x < 64 && z > -14 && z < 22 && vnoise(x * 0.2, z * 0.2) < 0.8) return false; // the open hilltop east of the plaza (m1 looks down it)
    if (x > 24 && x < 260 && z > -40 && z < 16) return false;                                          // the plateau east stays open: m1 sees the far ridges
    if (x > 24 && x < 220 && z >= 14 && z < 48 && vnoise(x * 0.11, z * 0.11 + 7) < 0.82) return false;   // the slope m1 looks across: a few clumps only
    if (x > 120 && z < 90 && vnoise(x * 0.07, z * 0.07 + 2) < 0.7) return false;                          // the far east: sparse, the ridges show
    const S = ARENA.spawns;
    if (x > S.south.x0 - 6 && x < S.south.x1 + 6 && z > S.south.z0 - 8 && z < S.south.z1 + 8 && vnoise(x * 0.1, z * 0.1) < 0.7) return false; // the horde's mustering ground
    if (x > S.east.x0 - 6 && x < S.east.x1 + 6 && z > S.east.z0 && z < S.east.z1 && vnoise(x * 0.1, z * 0.1 + 3) < 0.65) return false;
    if (ARENA.oil.barrels.some(([bx, bz]) => Math.hypot(bx - x, bz - z) < 3)) return false;
    if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < VILLAGE.r + 7) return false;                          // DESIGN §8: the goblin village's clearing
    return true;
  };
  const place = (x, z, scale) => {
    const v = R() < 0.3 ? 0 : R() < 0.55 ? 1 : 2;
    const d = Math.hypot(x - 4, z - 10);
    scale *= 0.72 + 0.28 * Math.min(1, Math.hypot(x, z) / 70);   // shorter near the keep (they towered over the wall walk)
    const list = d < 70 ? near : far;
    list[v].push([x, envHeight(x, z) - 0.3, z, scale, R() * Math.PI * 2]);
  };
  // the slope and the valley: clumped by noise, sparser in the horde's corridor (x -8..42, z 12..70)
  const N = Math.round(9000 * mul);
  for (let i = 0; i < N; i++) {
    const x = -160 + R() * 360, z = -110 + R() * 420;
    if (!ok(x, z)) continue;
    const clump = vnoise(x * 0.035, z * 0.035);
    const corridor = x > -8 && x < 42 && z > 12 && z < 74;
    let p = 0.24 + 1.2 * Math.max(0, clump - 0.3);
    if (corridor) p *= 0.22;
    if (z < -40) p *= 0.6;
    const dist = Math.hypot(x - 4, z - 10);
    if (dist > 160) p *= 0.75;
    if (R() > p) continue;
    place(x, z, (0.55 + 0.5 * R()) * (dist > 120 ? 1.25 : 1));
  }
  // dense pine lines just beyond the west and south bounds (their crowns stop short of the
  // bound; the boulder band in props.js marks the edge itself), and clumps beyond the east bound down the slope
  const line = (ax, az, bx, bz, every, out, n0) => {
    const len = Math.hypot(bx - ax, bz - az), n = Math.round(len / every);
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      for (let j = 0; j < n0; j++) {
        const o = out[0] + j * out[1] + R() * out[1] * 0.8;
        const x = ax + (bx - ax) * t + (az === bz ? (R() - 0.5) * every : -o), z = az + (bz - az) * t + (az === bz ? o : (R() - 0.5) * every);
        if (polyDist(ROAD_DRAWN, x, z) < 5.5) continue;
        const v = R() < 0.35 ? 0 : 1;
        (Math.hypot(x - 4, z - 10) < 70 ? near : far)[v].push([x, envHeight(x, z) - 0.3, z, 0.6 + 0.35 * R(), R() * 6.28]);
      }
    }
  };
  line(PB.x0, 12, PB.x0, PB.z1 + 4, 3.2, [4.2, 3.4], 3);                 // west, down the slope
  line(PB.x0 - 6, PB.z1, PB.x1 + 6, PB.z1, 3.6, [4.4, 3.8], 2);          // south, across the slope (the horde walks through)
  for (const [x, z, s] of [[51, 21, 1.1], [52, 30, 1.0], [-26.5, 12.5, 1.1], [-27, 17, 1.0], [-31, 24, 1.15], [51, 44, 1.0]]) {
    near[1].push([x, envHeight(x, z) - 0.3, z, s * 0.8, R() * 6.28]);    // hero pines framing m1 / m2 (outside the bounds)
  }
  const group = new THREE.Group(); group.name = 'pines';
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  let count = 0;
  for (const [set, shadow] of [[near, true], [far, false]]) {
    set.forEach((list, v) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(variants[v], pineMat, list.length);
      list.forEach(([x, y, z, s, a], i) => {
        _q.setFromAxisAngle(UP, a);
        _m.compose(_p.set(x, y, z), _q, _s.set(s, s * (0.9 + 0.25 * R()), s));
        im.setMatrixAt(i, _m);
      });
      im.castShadow = shadow; im.receiveShadow = true;
      im.computeBoundingSphere();
      im.name = `pines-${shadow ? 'near' : 'far'}-${v}`;
      group.add(im);
      count += list.length;
    });
  }
  group.userData.count = count;
  return group;
}

/**
 * Valley fog: three stacked planes over the valley, drifting noise, manual exp² distance fog.
 * @param {THREE.Texture} noise @param {THREE.FogExp2} fog
 */
export function buildValleyFog(noise, fog) {
  const B = new Builder(1);
  const layers = [[-9.5, 0.55], [-12.5, 0.75], [-16, 1.0]];
  layers.forEach(([y], i) => {
    const pg = new THREE.PlaneGeometry(700, 560, 1, 1); pg.rotateX(-Math.PI / 2);
    B.geom(pg, new THREE.Matrix4().makeTranslation(40, y, 300), { color: [i / 2, 0, 0] });
  });
  const mat = gfx().materials.envValleyFogMaterial({   // per edition (decision 0001); transparent, no depth write
    uNoise: { value: noise }, uTime: { value: 0 }, uColor: { value: new THREE.Color('#4d7d92') },
    uFogColor: { value: fog.color }, uFogDensity: { value: fog.density }, uAlpha: { value: 0.78 },
  });
  const mesh = new THREE.Mesh(B.build(), mat);
  mesh.name = 'valley-fog';
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  return mesh;
}
