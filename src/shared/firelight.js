// VALLEYWARD · the shared fire light (docs/DESIGN.md §11.6): a light map rendered from the fire. The fluid downsamples and blurs its fire
// field into a small light map over ARENA.fluid; every lit material in the world (terrain, walls, props, horde sprites,
// the troll, pickups) samples it at `worldPos + normal * reach` (one texture fetch) and adds warm light that fades with
// the height above the ground. The viewmodel uses `nearCamera` instead.
// DESIGN §11.5: the map's RGB carries the fire's hue (violet near an Obelisk, blue round the Ember Orbit), so
// nothing changes for the materials. Everyone else only calls `patchFireLight(material)` (built-in materials) or uses FIRELIGHT_GLSL + fireLightUniforms()
// in their own ShaderMaterial (sprites), and never writes the uniforms. Details and examples: Firewraith's
// modules/classic/FLUID.md, "The light map and the light at the camera".
//
// Tested (preview/fluid.html): MeshLambertMaterial, MeshStandardMaterial, MeshBasicMaterial (it has no `objectNormal`,
// so the patch reads the `normal` attribute itself), plain and InstancedMesh (instanceMatrix). BatchedMesh
// (batchingMatrix), Phong, Toon and Physical go through the same chunks but were not run.
import * as THREE from 'three';
import { ARENA } from './arena.js';

const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
black.needsUpdate = true;

/** The uniforms shared by every patched material (same objects, so one write updates all). */
export const FIRELIGHT = {
  uFireLightMap: { value: /** @type {THREE.Texture} */ (black) },               // RGB = fire light colour × strength (linear; the colour follows the fire's hue)
  uFireLightRect: { value: new THREE.Vector4(ARENA.fluid.x0, ARENA.fluid.z0, ARENA.fluid.size, ARENA.fluid.size) },
  uFireLightGain: { value: 1.0 },                                                 // global strength
  uFireLightReach: { value: 1.6 },                                                // metres along the normal
  uFireLightHeight: { value: 4.0 },                                               // light halves at this height above the ground
  /** Fire light at the camera (RGB, linear), for the first-person viewmodel and the UI. */
  nearCamera: new THREE.Color(0, 0, 0),
};

/** The terrain height in GLSL, identical to `groundHeight` in src/shared/arena.js. Defines ewGround(vec2 xz). */
export const GROUND_GLSL = /* glsl */`
float ewSmooth(float e0, float e1, float x) { float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float ewGround(vec2 p) {
  if (p.y <= 9.0) return 0.0;
  float d = p.y - 9.0;
  float fall = -14.0 * ewSmooth(0.0, 61.0, d) - 0.04 * max(0.0, d - 61.0);
  float s = ewSmooth(6.0, 40.0, d);
  float sides = 0.0026 * p.x * p.x * s - 0.0026 * 16.0 * s;
  float roll = 0.45 * sin(p.x * 0.19 + 0.7) * sin(p.y * 0.16) * ewSmooth(3.0, 18.0, d);
  return fall + sides + roll;
}`;

/**
 * GLSL for your own ShaderMaterial (e.g. the horde sprites): declares the uniforms, ewGround() and
 *   vec3 emberFireLight(vec3 worldPos, vec3 worldNormal)   // linear RGB to multiply by your albedo and add
 * Merge `fireLightUniforms()` into the material's uniforms. For a camera-facing sprite pass the direction toward the
 * camera (or (0,1,0) for a flat ground decal) as the normal.
 */
export const FIRELIGHT_GLSL = /* glsl */`
uniform sampler2D uFireLightMap; uniform vec4 uFireLightRect; uniform float uFireLightGain;
uniform float uFireLightReach; uniform float uFireLightHeight;
${GROUND_GLSL}
vec3 emberFireLight(vec3 p, vec3 n) {
  vec3 q = p + n * uFireLightReach;
  vec2 uv = (q.xz - uFireLightRect.xy) / uFireLightRect.zw;
  vec2 e = min(uv, 1.0 - uv);
  float inside = smoothstep(0.0, 0.02, min(e.x, e.y));
  vec3 L = texture2D(uFireLightMap, clamp(uv, 0.0, 1.0)).rgb * inside;
  float above = max(0.0, p.y - ewGround(p.xz)) / max(0.001, uFireLightHeight);
  float fade = 1.0 / (1.0 + above * above);
  float facing = 0.7 + 0.3 * clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
  return L * fade * facing * uFireLightGain;
}`;

/** The shared uniform objects for a ShaderMaterial that includes FIRELIGHT_GLSL (same objects: live updates). */
export function fireLightUniforms() {
  return {
    uFireLightMap: FIRELIGHT.uFireLightMap, uFireLightRect: FIRELIGHT.uFireLightRect, uFireLightGain: FIRELIGHT.uFireLightGain,
    uFireLightReach: FIRELIGHT.uFireLightReach, uFireLightHeight: FIRELIGHT.uFireLightHeight,
  };
}

const VERT_DECL = '\nvarying vec3 vFireWorldPos; varying vec3 vFireWorldNormal;';
const VERT_BODY = /* glsl */`
{
  vec4 fw = vec4(transformed, 1.0);
  vec3 fn = normal;
#ifdef USE_BATCHING
  fw = batchingMatrix * fw; fn = mat3(batchingMatrix) * fn;
#endif
#ifdef USE_INSTANCING
  fw = instanceMatrix * fw; fn = mat3(instanceMatrix) * fn;
#endif
  fw = modelMatrix * fw;
  vFireWorldPos = fw.xyz;
  vFireWorldNormal = mat3(modelMatrix) * fn;
}`;

/**
 * Add the fire light to a three.js material (MeshLambertMaterial, MeshStandardMaterial / Physical, MeshPhongMaterial,
 * MeshBasicMaterial, MeshToonMaterial; plain, instanced or batched meshes). Idempotent; chains an existing
 * onBeforeCompile. The light is added to the outgoing radiance (× the albedo) before tone mapping.
 * @template {THREE.Material} M @param {M} material @returns {M}
 */
export function patchFireLight(material) {
  const m = /** @type {any} */ (material);
  if (m.userData.__fireLight) return material;
  m.userData.__fireLight = true;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    Object.assign(shader.uniforms, fireLightUniforms());
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>' + VERT_DECL)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>' + VERT_DECL + '\n' + FIRELIGHT_GLSL)
      .replace('#include <opaque_fragment>', '{ vec3 fn = vFireWorldNormal; fn = dot(fn, fn) > 1e-8 ? normalize(fn) : vec3(0.0, 1.0, 0.0);\n' +
        '  outgoingLight += emberFireLight(vFireWorldPos, fn) * diffuseColor.rgb; }\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + '|firelight2';
  material.needsUpdate = true;
  return material;
}

/** CPU twin of the light for one point (used for `nearCamera`): RGB from a 64² summary grid. Internal to the fire code. This is
 *  the orange light; coloured fire (DESIGN §11.5) mixes in each hue's light colour (the ground fire module's light map; Firewraith `HUE_LIGHT`). */
export const FIRE_LIGHT_COLOR = Object.freeze([1.0, 0.42, 0.13]);
