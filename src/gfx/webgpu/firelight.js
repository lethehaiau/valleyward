// VALLEYWARD · the WebGPU edition's fire light (the TSL twin of src/shared/firelight.js; decision 0001). The same
// light: the ground fire module's light map over ARENA.fluid, sampled at `worldPos + normal × reach`, faded by the height
// above the real ground, × the surface's albedo, added to the outgoing light. It reads the same FIRELIGHT values (the
// fire host writes them); `syncFireLight()` copies them into the TSL uniforms once a frame (the layer's `frame()`).
//   patchFireLight(material)             a standard material (Lambert, Standard, Phong, Basic, …): sets emissiveNode
//   emberFireLight(worldPos, worldNormal) a TSL vec3 for your own node material (× your albedo, then add)
//   ewGround(xz)                          the terrain height (TSL), identical to groundHeight / GROUND_GLSL
import { DataTexture, LinearFilter } from 'three/webgpu';
import { Fn, uniform, texture, vec2, vec3, float, clamp, smoothstep, min, max, sin, select, positionWorld, normalWorld, materialEmissive, diffuseColor } from 'three/tsl';
import { FIRELIGHT } from '../../shared/firelight.js';

const U = {
  rect: uniform(FIRELIGHT.uFireLightRect.value.clone()),
  gain: uniform(FIRELIGHT.uFireLightGain.value),
  reach: uniform(FIRELIGHT.uFireLightReach.value),
  height: uniform(FIRELIGHT.uFireLightHeight.value),
};
/** Every texture node that samples the light map (a node's texture is fixed when it is cloned, so all are re-pointed when
 *  the fire host swaps the map). */
const mapNodes = new Set();
/** The default map (src/shared/firelight.js: a 1×1 black DataTexture with Nearest filtering) would make the WGSL builder
 *  compile every light-map read as an unfiltered textureLoad with no sampler, and a filtered map swapped in later (a ground
 *  module's light map) would then keep the blocky read or mismatch its binding layout. So this edition stands in a
 *  linear-filtered 1×1 black placeholder for it. A module's light map must be filterable too (8-bit or half-float). */
const DEFAULT_MAP = FIRELIGHT.uFireLightMap.value;
const PLACEHOLDER = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
PLACEHOLDER.minFilter = PLACEHOLDER.magFilter = LinearFilter; PLACEHOLDER.generateMipmaps = false; PLACEHOLDER.needsUpdate = true;
const mapOf = (m) => (!m || m === DEFAULT_MAP ? PLACEHOLDER : m);
let mapNow = mapOf(FIRELIGHT.uFireLightMap.value);

/** Copy FIRELIGHT into the TSL uniforms (once a frame, before rendering). */
export function syncFireLight() {
  U.rect.value.copy(FIRELIGHT.uFireLightRect.value);
  U.gain.value = FIRELIGHT.uFireLightGain.value;
  U.reach.value = FIRELIGHT.uFireLightReach.value;
  U.height.value = FIRELIGHT.uFireLightHeight.value;
  const m = mapOf(FIRELIGHT.uFireLightMap.value);
  if (m !== mapNow) { mapNow = m; for (const n of mapNodes) n.value = m; }
}

/** The terrain height in TSL (identical to `groundHeight` in src/shared/arena.js and GROUND_GLSL). @param {any} p vec2 (x, z) */
export const ewGround = Fn(([p]) => {
  const d = p.y.sub(9.0);
  const fall = smoothstep(0.0, 61.0, d).mul(-14.0).sub(max(0.0, d.sub(61.0)).mul(0.04));
  const s = smoothstep(6.0, 40.0, d);
  const sides = p.x.mul(p.x).mul(s).mul(0.0026).sub(s.mul(0.0026 * 16.0));
  const roll = sin(p.x.mul(0.19).add(0.7)).mul(sin(p.y.mul(0.16))).mul(smoothstep(3.0, 18.0, d)).mul(0.45);
  return select(p.y.lessThanEqual(9.0), float(0.0), fall.add(sides).add(roll));
});

/** The fire light (linear RGB) at a world point with a world normal: multiply by your albedo and add. */
export const emberFireLight = Fn(([p, n]) => {
  const q = p.add(n.mul(U.reach));
  const uv = q.xz.sub(U.rect.xy).div(U.rect.zw);
  const e = min(uv, vec2(1.0).sub(uv));
  const inside = smoothstep(0.0, 0.02, min(e.x, e.y));
  const tex = texture(mapNow, clamp(uv, 0.0, 1.0));
  mapNodes.add(tex);
  const L = tex.rgb.mul(inside);
  const above = max(0.0, p.y.sub(ewGround(p.xz))).div(max(0.001, U.height));
  const fade = float(1.0).div(above.mul(above).add(1.0));
  const facing = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0).mul(0.3).add(0.7);
  return L.mul(fade).mul(facing).mul(U.gain);
});

/**
 * The fire light on a standard material: WebGPURenderer converts a built-in material by copying every enumerable property
 * (NodeLibrary.fromMaterial), so the emissiveNode set here carries over. Adds `fireLight × albedo` to what the material
 * emits already (as the GLSL patch adds it to the outgoing light). Idempotent.
 * @template M @param {M} material @returns {M}
 */
export function patchFireLight(material) {
  const m = /** @type {any} */ (material);
  if (!m || m.userData?.__fireLightNode) return material;
  m.userData.__fireLightNode = true;
  const n = normalWorld.toVar();
  const fl = emberFireLight(positionWorld, n).mul(diffuseColor.rgb);
  m.emissiveNode = m.emissive?.isColor ? vec3(materialEmissive).add(fl) : fl;
  m.needsUpdate = true;
  return material;
}
