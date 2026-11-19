// VALLEYWARD · the fire host · the world a fire module draws into (Fire API v1 `host.world`, firewraith/docs/API.md):
// the fire area, the terrain (JS and GLSL), the keep's walls, the moon, the Lance's ballistic physics and the game's
// fire-light knobs. Everything comes from src/shared/arena.js, src/sim/constants.js and src/shared/firelight.js.
import { ARENA, groundHeight } from '../shared/arena.js';
import { GROUND_GLSL, FIRELIGHT } from '../shared/firelight.js';
import { WEAPON } from '../sim/constants.js';

/** @returns {import('firewraith/api').World} */
export function makeWorld() {
  const k = ARENA.keep;
  const walls = [[k.x0, -k.wallThick, k.x1, 0], ...k.towers.map((t) => [t.x - t.half, t.z - t.half, t.x + t.half, t.z + t.half])];
  return Object.freeze({
    area: Object.freeze({ x0: ARENA.fluid.x0, z0: ARENA.fluid.z0, size: ARENA.fluid.size }),
    groundHeight,
    groundGLSL: GROUND_GLSL,
    walls: Object.freeze(walls.map((b) => Object.freeze(b))),
    moonDir: ARENA.moonDir,
    lance: Object.freeze({ speed: WEAPON.lance.speed, gravity: WEAPON.lance.gravity }),
    light: Object.freeze({ get gain() { return FIRELIGHT.uFireLightGain.value; }, get height() { return FIRELIGHT.uFireLightHeight.value; } }),
  });
}
