// @ts-check
// Environment · the ground: one mesh from groundHeight (src/shared/arena.js) over ARENA.terrain, finer on the plaza and the
// slope (0.75 m), coarser away from play, plus a far ring out to the mountains (the backdrop beyond ARENA.terrain is
// the environment's own shape). Three pixel tiles blended per texel with a hashed dither (grass, earth, road), so the road edge
// reads as pixels, not a smear. Vertex colour: contact darkening at the wall foot, broad tone patches.
import * as THREE from 'three';
import { ARENA, groundHeight } from '../shared/arena.js';
import { polyDist, vnoise, smooth, clamp } from './util.js';
import { gfx } from '../gfx/current.js';

const T = ARENA.terrain;
/** The sim's road + a visual-only continuation that winds on down the far valley (texture and pine clearing only). */
export const ROAD_DRAWN = [...ARENA.road.points.map((p) => [p[0], p[1]]), [38, 104], [27, 126], [40, 150], [30, 178], [44, 215], [33, 260]];

/** The ground height the environment draws: exactly groundHeight inside ARENA.terrain, a falling/rolling backdrop outside it. */
export function envHeight(x, z) {
  const cx = clamp(x, T.x0, T.x1), cz = clamp(z, T.z0, T.z1);
  const h = groundHeight(cx, cz);
  const d = Math.hypot(x - cx, z - cz);
  if (d <= 0) return h;
  const side = z > T.z1 - 20 ? smooth(25, 110, Math.abs(x - 26)) : 1;     // the far valley keeps a floor down its axis
  const hills = ((vnoise(x * 0.012, z * 0.012) - 0.45) * 26 + (vnoise(x * 0.04 + 9, z * 0.04) - 0.5) * 6) * side;
  const north = z < T.z0 ? -(T.z0 - z) * 0.18 : 0;
  const east = x > T.x1 ? -(x - T.x1) * 0.22 : 0;                       // the hill falls away east (m1's horizon opens)
  if (x > T.x1 && z < 60) return h + hills * 0.25 * smooth(0, 120, d) + north + east;
  return h + hills * smooth(0, 120, d) + north + east - (z > T.z1 ? (z - T.z1) * 0.02 : 0);
}

function axis(segs) {
  // segs: [[from, to, step], ...] contiguous
  const out = [];
  for (const [a, b, s] of segs) for (let v = a; v < b - 1e-6; v += s) out.push(v);
  out.push(segs[segs.length - 1][1]);
  return out;
}

/**
 * @param {Record<string, THREE.Texture>} tex @param {string} quality
 */
export function createTerrain(tex, quality) {
  const fine = quality === 'low' ? 1.25 : 0.75;
  const xs = axis([[-520, -110, 30], [-110, -70, 8], [-70, -32, 2], [-32, 52, fine], [52, 110, 2], [110, 150, 8], [150, 620, 30]]);
  const zs = axis([[-420, -100, 30], [-100, -60, 8], [-60, -6, 2.5], [-6, 42, fine], [42, 92, 1.5], [92, 140, 3], [140, 200, 10], [200, 760, 30]]);
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), mix = new Float32Array(nx * nz * 2);
  const road = ROAD_DRAWN;
  const halfRoad = ARENA.road.width / 2;
  const K = ARENA.keep;
  let k = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++, k++) {
    const x = xs[i], z = zs[j];
    const y = envHeight(x, z);
    pos.set([x, y, z], k * 3);
    // road: inside the 6 m band, feathered 1 m (the plaza road starts at x 4)
    const dr = polyDist(road, x, z);
    let wr = 1 - smooth(halfRoad - 0.6, halfRoad + 0.9, dr);
    // earth: the plaza (and the courtyard), patches on the slope, a worn band along the wall foot
    const P = ARENA.plaza;
    let we = 0;
    if (x > P.x0 - 1 && x < P.x1 + 1 && z > -0.5 && z < P.z1 + 0.6) we = 1 - smooth(P.z1 - 1.2, P.z1 + 0.8, z) * 0.85;
    if (x > K.x0 && x < K.x1 && z > K.z0 && z < K.z1) we = 1;
    const patch = vnoise(x * 0.09 + 3, z * 0.09 - 7);
    we = Math.max(we, smooth(0.62, 0.78, patch) * 0.9);
    we = Math.max(we, wr * 0.6);
    mix[k * 2] = wr; mix[k * 2 + 1] = clamp(we, 0, 1);
    // tone: broad patches + contact darkening at the south wall foot + darker far valley floor
    let s = 0.86 + 0.24 * vnoise(x * 0.05, z * 0.05);
    if (z > -0.2 && z < 2.2 && x > K.x0 - 3.5 && x < K.x1 + 3.5) s *= 0.7 + 0.3 * smooth(0, 2.2, z);
    col.set([s, s, s * 1.02], k * 3);
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.set([a, c, b, b, c, d], q); q += 6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aMix', new THREE.BufferAttribute(mix, 2));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(nx * nz * 2), 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();

  const m = new THREE.MeshLambertMaterial({ map: tex.grass, vertexColors: true });
  const U = { uRoad: { value: tex.road }, uEarth: { value: tex.earth } };
  gfx().materials.envPatchTerrain(m, U);   // per edition (decision 0001): src/gfx/{webgl2,webgpu}/materials/env.js
  gfx().patchFireLight(m);
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}
