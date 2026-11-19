// VALLEYWARD · the WebGPU edition's custom materials, every module's (TSL). Same names as src/gfx/webgl2/materials/index.js.
import * as actors from './actors.js';
import * as env from './env.js';
import * as fx from './fx.js';
export * from './actors.js';
export * from './env.js';
export * from './fx.js';
/** Which modules have every custom material here. */
export const READY = Object.freeze({ actors: !!actors.READY, env: !!env.READY, fx: !!fx.READY });
