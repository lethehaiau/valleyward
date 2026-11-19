// VALLEYWARD · actors · the Ash Troll's ground telegraphs (DESIGN §6.2): a red pixel ring (r 5) that fills
// from the troll's feet over the stomp's 0.8 s windup, and for a thrown boulder a dithered shadow at the landing point
// that shrinks and darkens over the 1.4 s flight (a faint one already during the 1.0 s throw windup) inside a dashed red
// rim at the impact radius. One instanced draw (≤ 8 decals), drawn on the world's 8 px/m pixel grid, following the
// terrain (shared ewGround) or flat on the wall walk when the boulder targets it. Reads `state.troll` and
// `state.boulders` only. The FX (src/fx/) draw the impact rings and dust on top; they do not draw these windup decals.
// Per-instance attributes: iC = (centre x, centre z, radius m, flat y; < -100 follows the terrain), iD = (kind 0 stomp
// ring / 1 boulder shadow, progress 0..1, alpha, quad half-size / radius).
import * as THREE from 'three';
import { gfx } from '../gfx/current.js';
import { ARENA, groundHeight } from '../shared/arena.js';
import { TROLL } from '../sim/constants.js';

const CAP = 8;
const STOMP_R = TROLL?.stomp?.r ?? 5;

/** @param {{ scene: THREE.Scene }} o */
export function createTelegraphs({ scene }) {
  const base = new THREE.PlaneGeometry(2, 2, 24, 24);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  const iC = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const iD = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iC', iC); geo.setAttribute('iD', iD);
  geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  // the decal shader is per edition (src/gfx/<edition>/materials/actors.js): uniforms uTime, uWalk
  const mat = gfx().materials.actorTelegraphMaterial({ walk: ARENA.keep.walk });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'actors.telegraphs';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.visible = false;
  scene.add(mesh);
  const C = iC.array, D = iD.array;
  let now = 0, n = 0;
  const put = (x, z, r, flatY, kind, prog, alpha, ext) => {
    if (n >= CAP) return;
    const o = n * 4;
    C[o] = x; C[o + 1] = z; C[o + 2] = r; C[o + 3] = flatY;
    D[o] = kind; D[o + 1] = prog; D[o + 2] = alpha; D[o + 3] = ext;
    n++;
  };
  /** the decal lies flat at y on the wall walk (a target well above the terrain), else it follows the terrain */
  const flatAt = (x, y, z) => (y != null && y - groundHeight(x, z) > 0.5 ? y : -999);

  function update(dt, state) {
    now += dt;
    mat.uniforms.uTime.value = now;
    n = 0;
    const tr = state?.troll;
    if (tr && tr.alive !== false && tr.hp > 0) {
      const dur = Math.max(0.05, tr.actionDur || 0.8);
      const u = Math.max(0, Math.min(1, (tr.actionT || 0) / dur));
      if (tr.action === 'stomp' && tr.stage === 'windup') put(tr.x, tr.z, STOMP_R, -999, 0, u, Math.min(1, 0.4 + u * 3), 1.1);
      if (tr.action === 'throw' && tr.stage === 'windup' && tr.target) {
        const t = tr.target, r = TROLL?.throw?.r ?? 2.5;
        put(t.x, t.z, r, flatAt(t.x, t.y, t.z), 1, 0, 0.25 + 0.35 * u, 1.85);
      }
    }
    const bs = state?.boulders;
    if (bs) for (let k = 0; k < bs.length; k++) {
      const b = bs[k];
      if (b.tx == null) continue;
      const u = Math.max(0, Math.min(1, (b.t || 0) / Math.max(0.05, b.flight || 1.4)));
      put(b.tx, b.tz, b.r || 2.5, flatAt(b.tx, b.ty, b.tz), 1, Math.max(0.02, u), 1, 1.85);
    }
    geo.instanceCount = n;
    mesh.visible = n > 0 && !mesh.userData.hidden;   // userData.hidden: a debug toggle that sticks
    if (n > 0) {
      for (const a of [iC, iD]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
    }
    return n;
  }

  return {
    mesh, update,
    get count() { return n; },
    dispose() { scene.remove(mesh); geo.dispose(); base.dispose(); mat.dispose(); },
  };
}
