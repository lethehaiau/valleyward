// VALLEYWARD · the shading layers (decision docs/decisions/0001): the game has two editions, one per graphics API.
//   webgl2: three.js WebGLRenderer + GLSL (src/gfx/webgl2/, and the modules' GLSL shaders)
//   webgpu: three.js WebGPURenderer + TSL / WGSL (src/gfx/webgpu/)
// Everything else (the sim, the bot, the UI, the audio, the cinema logic, the world's geometry and standard materials,
// the assets) is shared. The page boots ONE edition: ?gpu=webgl2|webgpu, else the backend of the fire modules picked
// (?lance= / ?ground= / ?firemod=), else webgl2; without WebGPU in the browser it is webgl2 (the reason is reported).
// A module whose shaders are not yet in an edition's layer is off in that edition, and the greybox stands in for it.
import { DEV_LANCE, REGISTRY, requestedModules } from '../core/fire-registry.js';

export const EDITIONS = Object.freeze(['webgl2', 'webgpu']);

/** Which edition to boot, and why. @param {URLSearchParams} q @param {{ hasWebGPU?: boolean }} [env] */
export function pickEdition(q, env = { hasWebGPU: typeof navigator !== 'undefined' && !!navigator.gpu }) {
  let want = 'webgl2', why = 'default';
  const forced = q.get('gpu');
  if (forced && EDITIONS.includes(forced)) { want = forced; why = `?gpu=${forced}`; }
  else {
    const picks = requestedModules(q);
    for (const slot of ['ground', 'lance']) {
      const r = REGISTRY[picks[slot]];
      if (r && r.backend === 'webgpu') { want = 'webgpu'; why = `the ${slot} module "${picks[slot]}" is a webgpu module`; break; }
    }
    if (!picks.lance && !picks.ground && DEV_LANCE) {
      want = REGISTRY[DEV_LANCE].backend;
      why = `the dev Lance default "${DEV_LANCE}"`;
    }
  }
  if (want === 'webgpu' && !env.hasWebGPU) return { edition: 'webgl2', why: `${why}, but this browser has no WebGPU: the webgl2 edition`, downgraded: true };
  return { edition: want, why, downgraded: false };
}

/** Load an edition's shading layer. @param {'webgl2'|'webgpu'} edition */
export function loadGfx(edition) {
  return edition === 'webgpu' ? import('./webgpu/index.js') : import('./webgl2/index.js');
}
