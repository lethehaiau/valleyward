// VALLEYWARD · actors · the Rainmother's pool of cold light on the ground: a terrain-hugging additive disc
// (r 11 m) under her, so the 14 m giantess reads as one huge figure at night. Its vertices follow groundHeight() and are
// rebuilt only when she moves 0.25 m. One draw, only while she is alive.
import * as THREE from 'three';
import { gfx } from '../gfx/current.js';
import { groundHeight } from '../shared/arena.js';

const R = 11, SEG = 22;

export function createBossLight({ scene }) {
  const geo = new THREE.PlaneGeometry(2 * R, 2 * R, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const base = Float32Array.from(geo.attributes.position.array);   // local x, 0, z
  const pos = geo.attributes.position;
  pos.setUsage(THREE.DynamicDrawUsage);
  // the disc's shader is per edition (src/gfx/<edition>/materials/actors.js): uniforms uCol, uK, uTime
  const mat = gfx().materials.actorBossLightMaterial({ radius: R });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'actors.bossLight';
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 1;
  scene.add(mesh);
  // local x/z stay the plane's (vL = the offset from her); y = the ground under each vertex; the mesh moves with her
  let lx = 1e9, lz = 1e9, k = 0, t = 0;
  function update(dt, state) {
    t += dt;
    const b = state?.boss;
    const on = !!(b && b.kind === 'rainmother' && b.alive !== false && b.mode !== 'dead');
    k += ((on ? 1 : 0) - k) * Math.min(1, dt * 1.5);
    mesh.visible = k > 0.01 && !!b;
    if (!mesh.visible) return;
    if (Math.hypot(b.x - lx, b.z - lz) > 0.25) {
      lx = b.x; lz = b.z;
      mesh.position.set(b.x, 0, b.z);
      for (let i = 0; i < pos.count; i++) pos.setY(i, groundHeight(b.x + base[i * 3], b.z + base[i * 3 + 2]) + 0.12);
      pos.needsUpdate = true;
      geo.computeBoundingSphere();
    }
    mat.uniforms.uK.value = k * (b.mode === 'rise' ? Math.min(1, (b.t || 0) / 4) : 1);
    mat.uniforms.uTime.value = t;
  }
  return { mesh, update, dispose() { scene.remove(mesh); geo.dispose(); mat.dispose(); } };
}
