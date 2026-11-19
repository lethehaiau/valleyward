// VALLEYWARD · the active shading layer (decision 0001). main.js sets it once, before any module loads; shared world code
// asks it for whatever is shaded differently per edition:
//   import { gfx } from '../gfx/current.js';
//   const mat = gfx().materials.skyMaterial({ … });   // a GLSL ShaderMaterial (webgl2) or a TSL node material (webgpu)
//   gfx().patchFireLight(material);                  // the fire light on a standard material
// Both editions' factories have the same names and return materials whose `.uniforms` map the same names to objects
// with `.value`, so module code that animates uniforms is shared (docs/WEBGPU-PORT.md).
let G = null;
/** @param {any} layer src/gfx/webgl2/index.js or src/gfx/webgpu/index.js */
export function setGfx(layer) { G = layer; }
/** The active layer. Throws if main.js has not set it (a module loaded on its own: a bench sets it itself). */
export function gfx() { if (!G) throw new Error('gfx: no shading layer set (main.js calls setGfx before the lanes load)'); return G; }
/** The active layer or null. */
export const gfxOrNull = () => G;
