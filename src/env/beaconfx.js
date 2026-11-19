// @ts-check
// Environment · the beacon's kindle flare: a warm sky glow around the basket (one additive
// camera-facing quad, HDR so the bloom spreads it) and a fountain of sparks (one Points draw, animated in the shader).
// Both idle low while the beacon burns and swell with `flare` (1 on EV.KINDLE, decaying over ≈ 3 s). The fire column
// (extra flame billboards) and the light pulse live in props.js / index.js. Warm colours: fire only (ART-DIRECTION §3).
import * as THREE from 'three';
import { gfx } from '../gfx/current.js';

/**
 * @param {{ x: number, y: number, z: number }} at the basket's flame base
 */
export function buildBeaconFx(at) {
  const group = new THREE.Group(); group.name = 'beacon-fx';
  const uniforms = { uFlare: { value: 0 }, uTime: { value: 0 }, uPx: { value: 900 } };

  // ---------------------------------------------------------------- sky glow (camera-facing, additive, depth-tested)
  const glowMat = gfx().materials.envBeaconGlowMaterial(uniforms);   // per edition (decision 0001); additive
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), glowMat);
  glow.position.set(at.x, at.y + 1.4, at.z);
  glow.frustumCulled = false;
  glow.renderOrder = 3;
  glow.name = 'beacon-glow';
  group.add(glow);

  // ---------------------------------------------------------------- sparks (shader-animated fountain)
  const N = 220;
  const seed = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
  const sparkMat = gfx().materials.envBeaconSparkMaterial({ ...uniforms, uBase: { value: new THREE.Vector3(at.x, at.y + 0.6, at.z) } });   // per edition; additive points
  const sparks = gfx().materials.envPoints(g, sparkMat);
  sparks.frustumCulled = false;
  sparks.renderOrder = 3;
  sparks.name = 'beacon-sparks';
  group.add(sparks);

  // ---------------------------------------------------------------- DESIGN §9, STORY.md hint 5: the vision in the flare
  // For half a second of the kindle glance a file of small horned figures marches through the fire column: dark pixel
  // silhouettes alpha-blended over the flames and the glow (the bloom still bleeds into their edges, so they read as
  // shapes in the fire, not as cut-outs).
  const visU = { uVision: { value: 0 }, uTime: uniforms.uTime };
  const visMat = gfx().materials.envBeaconVisionMaterial(visU);   // per edition (decision 0001); transparent
  const vision = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), visMat);
  vision.position.set(at.x, at.y + 2.7, at.z);    // inside the flare's column, above the basket rim (seen from the glance lens)
  vision.frustumCulled = false;
  vision.renderOrder = 4;              // over the flames and the additive glow: the HDR glow + bloom washed a dimmer pass out
  vision.name = 'beacon-vision';
  vision.visible = false;
  group.add(vision);

  return {
    group, uniforms,
    /** @param {number} t @param {number} flare 0..1 @param {number} px the render target's height in pixels @param {number} [vis] 0..1 the vision */
    update(t, flare, px, vis = 0) {
      uniforms.uTime.value = t; uniforms.uFlare.value = flare; uniforms.uPx.value = px;
      visU.uVision.value = vis; vision.visible = vis > 0.01;
    },
  };
}
