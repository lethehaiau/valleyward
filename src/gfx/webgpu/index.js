// VALLEYWARD · the WebGPU shading layer (edition 'webgpu'): three.js WebGPURenderer + TSL / WGSL. It shares three's
// core with the WebGL2 edition (`three` and `three/webgpu` both import build/three.core.js), so the shared world code's
// meshes and standard materials render here unchanged (WebGPURenderer converts the built-in materials to node
// materials itself). Custom GLSL (ShaderMaterial, onBeforeCompile) does not run here: a module whose custom materials have
// no TSL twin yet (./materials/<module>.js READY) is off in this edition and the greybox stands in (docs/WEBGPU-PORT.md).
import { WebGPURenderer } from 'three/webgpu';
import * as materials from './materials/index.js';
import { READY as LOOK_READY, createLook } from './look.js';
import { patchFireLight, syncFireLight, ewGround } from './firelight.js';

export const edition = 'webgpu';

/** The modules this edition runs: the art modules once ported; the fire host runs webgpu fire modules only. */
export const LANES = Object.freeze({
  env: materials.READY.env, look: LOOK_READY, fire: true, actors: materials.READY.actors, fx: materials.READY.fx,
  cinema: true, ui: true, audio: true,
});
export const LANE_OFF_REASON = 'not in the webgpu edition yet (its shaders have no TSL twin)';

/** @param {{ antialias?: boolean }} o */
export async function createRenderer({ antialias = true } = {}) {
  const r = new WebGPURenderer({ antialias, powerPreference: 'high-performance' });
  await r.init();
  if (!r.backend?.isWebGPUBackend) console.warn('[ew] the webgpu edition is running on three\'s WebGL2 fallback backend');
  return r;
}

export { patchFireLight, materials, createLook };
/** The terrain height in TSL (`Fn(vec2 xz) → float`, identical to groundHeight): the fire host hands it to webgpu fire
 *  modules as `world.groundTSL` (Fire API v1). */
export { ewGround };

/** Once a frame, before the modules update: the fire light's uniforms follow FIRELIGHT. */
export function frame() { syncFireLight(); }

/** What the GPU is (debug logs). */
export function describeGpu(renderer) {
  const info = renderer.backend?.adapter?.info;
  return `WebGPU${renderer.backend?.isWebGPUBackend ? '' : ' (WebGL2 fallback backend)'}${info ? `: ${info.vendor} ${info.architecture}`.trim() : ''}`;
}
