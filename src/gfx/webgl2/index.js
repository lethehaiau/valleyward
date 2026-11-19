// VALLEYWARD · the WebGL2 shading layer (edition 'webgl2'): three.js WebGLRenderer + GLSL. Every module runs here. Custom
// shaders move under ./materials/ as each module gets its WebGPU twin (docs/WEBGPU-PORT.md); the look is ./look.js.
import * as THREE from 'three';
import { patchFireLight } from '../../shared/firelight.js';
import * as materials from './materials/index.js';
import { createLook } from './look.js';

export const edition = 'webgl2';

/** The modules this edition runs (the others are off: the greybox / a core fallback stands in). */
export const LANES = Object.freeze({ env: true, look: true, fire: true, actors: true, fx: true, cinema: true, ui: true, audio: true });

/** @param {{ antialias?: boolean }} o */
export async function createRenderer({ antialias = false } = {}) {
  return new THREE.WebGLRenderer({ antialias, powerPreference: 'high-performance' });
}

/** The fire light on a standard material (onBeforeCompile; see src/shared/firelight.js). */
export { patchFireLight, materials, createLook };

/** Once a frame, before the modules update (nothing to sync in this edition: the GLSL reads FIRELIGHT's uniforms directly). */
export function frame() {}

/** What the GPU is (debug logs): the unmasked renderer string when the browser gives it. */
export function describeGpu(renderer) {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
}
