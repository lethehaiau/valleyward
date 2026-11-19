// @ts-check
// One instanced draw of pixel particles (camera-facing, velocity-stretched or flat on the ground), simulated on
// the CPU in fixed arrays: spawn writes a slot, update integrates and compacts (swap-remove), then writes only the live
// instances into the GPU attributes. No allocation per frame. Three pools make the FX: additive (flashes, sparks,
// stars, embers), alpha (smoke, dust, debris, ichor) and the numbers (on top, no depth test). The material comes from the
// active shading layer (gfx().materials.fxPoolMaterial: GLSL in webgl2, TSL in webgpu).
import * as THREE from 'three';
import { TILES_PER_ROW } from './atlas.js';
import { gfx } from '../gfx/current.js';

export const MODE = Object.freeze({ billboard: 0, stretch: 1, flat: 2 });
export const FLAG = Object.freeze({ alignVel: 1, bounce: 2, growStretch: 4, fastSize: 8, spin: 16 });

/**
 * @param {{ max: number, map: THREE.Texture | null, blending?: THREE.Blending, depthTest?: boolean, renderOrder?: number, name?: string }} o
 */
export function createPool({ max, map, blending = THREE.NormalBlending, depthTest = true, renderOrder = 0, name = 'ew-fx' }) {
  const N = max | 0;
  // simulation state
  const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
  const vx = new Float32Array(N), vy = new Float32Array(N), vz = new Float32Array(N);
  const age = new Float32Array(N), life = new Float32Array(N), grav = new Float32Array(N), drag = new Float32Array(N);
  const s0 = new Float32Array(N), s1 = new Float32Array(N), sk = new Float32Array(N), str = new Float32Array(N);
  const c0 = new Float32Array(N * 4), c1 = new Float32Array(N * 4), fin = new Float32Array(N), fout = new Float32Array(N);
  const tile = new Float32Array(N), mode = new Float32Array(N), rot = new Float32Array(N), rotV = new Float32Array(N), offX = new Float32Array(N);
  const dx = new Float32Array(N), dy = new Float32Array(N), dz = new Float32Array(N), floorY = new Float32Array(N);
  const flags = new Uint8Array(N);
  let alive = 0;

  // GPU
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  const aPos = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
  const aSize = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2);
  const aDir = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
  const aCol = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  const aTile = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  for (const a of [aPos, aSize, aDir, aCol, aTile]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPos', aPos); geo.setAttribute('aSize', aSize); geo.setAttribute('aDir', aDir);
  geo.setAttribute('aCol', aCol); geo.setAttribute('aTile', aTile);
  geo.instanceCount = 0;
  // the shading is per edition (decision 0001): src/gfx/{webgl2,webgpu}/materials/fx.js
  const mat = gfx().materials.fxPoolMaterial({ name, map, tiles: TILES_PER_ROW, blending, depthTest });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.matrixAutoUpdate = false;

  /**
   * @param {{ x: number, y: number, z: number, vx?: number, vy?: number, vz?: number, life: number, size: number, size1?: number,
   *   sizeK?: number, grav?: number, drag?: number, col: number[], col1?: number[], fin?: number, fout?: number, tile: number,
   *   mode?: number, rot?: number, rotV?: number, offX?: number, stretch?: number, dir?: number[], flags?: number, floor?: number }} p
   * @returns {number} slot or -1 when full
   */
  function spawn(p) {
    if (alive >= N) return -1;
    const i = alive++;
    px[i] = p.x; py[i] = p.y; pz[i] = p.z;
    vx[i] = p.vx || 0; vy[i] = p.vy || 0; vz[i] = p.vz || 0;
    age[i] = 0; life[i] = Math.max(0.016, p.life);
    grav[i] = p.grav || 0; drag[i] = p.drag || 0;
    s0[i] = p.size; s1[i] = p.size1 ?? p.size; sk[i] = p.sizeK || 1; str[i] = p.stretch || 0;
    const a = p.col, b = p.col1 || p.col;
    c0[i * 4] = a[0]; c0[i * 4 + 1] = a[1]; c0[i * 4 + 2] = a[2]; c0[i * 4 + 3] = a[3] ?? 1;
    c1[i * 4] = b[0]; c1[i * 4 + 1] = b[1]; c1[i * 4 + 2] = b[2]; c1[i * 4 + 3] = b[3] ?? (a[3] ?? 1);
    fin[i] = p.fin || 0; fout[i] = p.fout ?? 0.6;
    tile[i] = p.tile; mode[i] = p.mode || 0; rot[i] = p.rot || 0; rotV[i] = p.rotV || 0; offX[i] = p.offX || 0;
    const d = p.dir; dx[i] = d ? d[0] : 0; dy[i] = d ? d[1] : 1; dz[i] = d ? d[2] : 0;
    flags[i] = p.flags || 0; floorY[i] = p.floor ?? -1e9;
    return i;
  }

  function kill(i) {
    const j = --alive;
    if (i === j) return;
    px[i] = px[j]; py[i] = py[j]; pz[i] = pz[j]; vx[i] = vx[j]; vy[i] = vy[j]; vz[i] = vz[j];
    age[i] = age[j]; life[i] = life[j]; grav[i] = grav[j]; drag[i] = drag[j];
    s0[i] = s0[j]; s1[i] = s1[j]; sk[i] = sk[j]; str[i] = str[j];
    for (let k = 0; k < 4; k++) { c0[i * 4 + k] = c0[j * 4 + k]; c1[i * 4 + k] = c1[j * 4 + k]; }
    fin[i] = fin[j]; fout[i] = fout[j]; tile[i] = tile[j]; mode[i] = mode[j]; rot[i] = rot[j]; rotV[i] = rotV[j]; offX[i] = offX[j];
    dx[i] = dx[j]; dy[i] = dy[j]; dz[i] = dz[j]; flags[i] = flags[j]; floorY[i] = floorY[j];
  }

  const P = aPos.array, S = aSize.array, D = aDir.array, C = aCol.array, TL = aTile.array;
  /** @param {number} dt */
  function update(dt) {
    for (let i = 0; i < alive; i++) {
      age[i] += dt;
      if (age[i] >= life[i]) { kill(i); i--; continue; }
      const f = flags[i];
      if (dt > 0) {
        vy[i] -= grav[i] * dt;
        const dr = drag[i] > 0 ? Math.max(0, 1 - drag[i] * dt) : 1;
        vx[i] *= dr; vy[i] *= dr; vz[i] *= dr;
        px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
        if (py[i] < floorY[i]) {
          py[i] = floorY[i];
          if (f & FLAG.bounce) { vy[i] = Math.abs(vy[i]) * 0.35; vx[i] *= 0.6; vz[i] *= 0.6; rotV[i] *= 0.5; } else { vy[i] = 0; vx[i] *= 0.8; vz[i] *= 0.8; }
        }
        rot[i] += rotV[i] * dt;
      }
      const t = age[i] / life[i];
      const se = sk[i] === 1 ? t : 1 - Math.pow(1 - t, sk[i]);
      const size = s0[i] + (s1[i] - s0[i]) * se;
      let a = 1;
      if (fin[i] > 0 && t < fin[i]) a = t / fin[i];
      if (t > fout[i]) a *= Math.max(0, 1 - (t - fout[i]) / Math.max(1e-3, 1 - fout[i]));
      const o3 = i * 3, o4 = i * 4, o2 = i * 2;
      P[o3] = px[i]; P[o3 + 1] = py[i]; P[o3 + 2] = pz[i];
      let stretch = str[i];
      if (f & FLAG.alignVel) {
        const sp = Math.hypot(vx[i], vy[i], vz[i]);
        if (sp > 1e-4) { D[o3] = vx[i] / sp; D[o3 + 1] = vy[i] / sp; D[o3 + 2] = vz[i] / sp; }
        else { D[o3] = dx[i]; D[o3 + 1] = dy[i]; D[o3 + 2] = dz[i]; }
        if (f & FLAG.growStretch) stretch = Math.min(stretch, age[i] * sp + 0.15);
        else if (stretch <= 0) stretch = sp * 0.035;
      } else { D[o3] = dx[i]; D[o3 + 1] = dy[i]; D[o3 + 2] = dz[i]; }
      S[o2] = size; S[o2 + 1] = stretch;
      C[o4] = c0[o4] + (c1[o4] - c0[o4]) * t; C[o4 + 1] = c0[o4 + 1] + (c1[o4 + 1] - c0[o4 + 1]) * t;
      C[o4 + 2] = c0[o4 + 2] + (c1[o4 + 2] - c0[o4 + 2]) * t; C[o4 + 3] = (c0[o4 + 3] + (c1[o4 + 3] - c0[o4 + 3]) * t) * a;
      TL[o4] = tile[i]; TL[o4 + 1] = mode[i]; TL[o4 + 2] = rot[i]; TL[o4 + 3] = offX[i];
    }
    geo.instanceCount = alive;
    for (const [a, n] of [[aPos, 3], [aSize, 2], [aDir, 3], [aCol, 4], [aTile, 4]]) {
      const attr = /** @type {THREE.InstancedBufferAttribute} */ (a);
      attr.clearUpdateRanges();
      if (alive > 0) { attr.addUpdateRange(0, alive * /** @type {number} */ (n)); attr.needsUpdate = true; }
    }
    mesh.visible = alive > 0;
  }

  return {
    mesh, spawn, update,
    clear() { alive = 0; geo.instanceCount = 0; mesh.visible = false; },
    get alive() { return alive; }, get max() { return N; },
    dispose() { geo.dispose(); quad.dispose(); mat.dispose(); },
  };
}
