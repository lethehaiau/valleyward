// @ts-check
// Environment · DESIGN §9, STORY.md hint 8: at dusk in the camp the low western sun throws the player's shadow across the
// plaza and up the keep's south wall, and the shadow has two small horns. One mesh, two quads (the wall strip just in
// front of the outer face, the ground strip from the feet toward the wall), placed in the vertex shader from the
// player's feet; each fragment traces back toward the sun onto a vertical silhouette plane through the player and reads
// a soft silhouette (a cloaked body, a head, two short horns). Multiply-blended, so it only darkens what the sun lights;
// skipped where the SW tower already shades the wall, on the slope and on the wall walk. Over the gate it falls on the
// doors (drawn on the wall plane, a few decimetres in front of them: the parallax does not show). Subtle by design
// (≈ 70 % darker on the wall, 60 % on the ground at the core, a penumbra that widens with distance: it reads like the
// tower's real shadow, but only as a thin figure, so it stays a detail).
import * as THREE from 'three';
import { ARENA } from '../shared/arena.js';
import { gfx } from '../gfx/current.js';

// the shadow's shader is per edition: envHornedShadowMaterial in src/gfx/{webgl2,webgpu}/materials/env.js (decision 0001)

export function createHornedShadow() {
  const g = new THREE.BufferGeometry();
  const P = [], K = [], I = [];
  for (let kind = 0; kind < 2; kind++) {
    const b = P.length / 3;
    P.push(0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0); K.push(kind, kind, kind, kind);
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(K, 1));
  g.setIndex(I);
  const L = new THREE.Vector3(ARENA.camp.sunDir.x, ARENA.camp.sunDir.y, ARENA.camp.sunDir.z).normalize();
  const uniforms = {
    uP: { value: new THREE.Vector3(0, 0, 4) }, uL: { value: L }, uWallZ: { value: ARENA.keep.z1 + 0.09 },
    uK: { value: 0 }, uTint: { value: new THREE.Color(0.2, 0.22, 0.32) },
  };
  const mat = gfx().materials.envHornedShadowMaterial(uniforms);   // per edition (decision 0001); multiply blend, double-sided
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'horned-shadow';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.visible = false;
  return {
    mesh, uniforms,
    /** @param {number} camp 0..1 @param {{x:number,y:number,z:number}|null} feet the player's feet */
    update(camp, feet) {
      let k = 0;
      if (feet && camp > 0.01) {
        const onPlaza = feet.y < 0.6 ? 1 : 0;                         // not on the stair or the wall walk
        const w = ARENA.keep.walk;
        const inX = feet.x > ARENA.keep.x0 - 4 && feet.x < ARENA.keep.x1 + 8 ? 1 : 0;
        k = camp * onPlaza * inX * (1 - THREE.MathUtils.smoothstep(feet.z, 5.0, 7.5)) * (feet.z > w.z1 + 0.6 ? 1 : 0);
        uniforms.uP.value.set(feet.x, feet.y, feet.z);
      }
      uniforms.uK.value = k;
      mesh.visible = k > 0.003;
    },
  };
}
