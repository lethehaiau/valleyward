// @ts-check
// VALLEYWARD · the fire contract between the sim, the fire modules and the CPU fire grid (docs/DESIGN.md §14.6; decision
// docs/decisions/0001). The fire events themselves (FIRE_OP, FIRE_HUE, FIRE_CAPS) are Firewraith's Fire API v1
// (firewraith/docs/API.md "Events") and are re-exported here; this file keeps the game's own rules: which source uses
// which hue, how fire burns enemies, the wind.
//
// Every sim tick the sim fills `state.fireOps` (cleared at the start of the tick) with plain objects. main.js hands the
// ops of every tick since the last rendered frame to the fire host (`fire.events(ops, state.wind)`), which passes them to
// the `ground` fire module. Units are world metres, metres per second and seconds; x/z are world coordinates
// (ARENA.fluid is the fire area).
//
// Gameplay reads the fire back: `fire.heat(x, z)` and `fire.fuel(x, z)` (0..1). In the browser these come from the
// ground module's gameplay grid when it has one (≤ 2 frames old for 'classic'); in Node tests, for a visual-only module,
// while that grid is stale, and when the fire host fails, the CPU fire grid (src/sim/fireproxy.js) answers from its own
// coarse grid fed by the same ops. Enemy burning: heat ≥ BURN.threshold.
import { FIRE_OP, FIRE_HUE, FIRE_CAPS } from 'firewraith/api';

export { FIRE_OP, FIRE_HUE, FIRE_CAPS };

/** Which source uses which hue. */
export const HUE_OF = Object.freeze({ lance: 'orange', bomb: 'orange', trough: 'orange', barrel: 'orange', burning: 'orange', sunburst: 'orange',
  obelisk: 'violet', orbit: 'blue', brimstone: 'green', trail: 'lilac', witchfire: 'green' });


/** Burning rules the sim applies from `fire.heat` (metres, seconds, damage per second). */
// Fire that wiped crowds in 1.3–2 s never let M1's burning, running, spreading column form, so burning goblins
// live ≈ 3 s (grunt) while they panic and drop embers.
export const BURN = Object.freeze({
  threshold: 0.22,   // heat at the enemy's feet that sets it alight
  seconds: 3.5,      // burning lasts this long after the last contact (refreshed while standing in fire) (was 2.8)
  dps: 4,            // damage per second while burning (grunt 12 HP → ~3 s; was 9 → 1.3 s)
  emberEvery: 0.3,   // a burning enemy drops an EMBER op this often (the Contagion card shortens it)
  panic: 0.65,       // while burning, an enemy runs away from the heat gradient at this fraction of its speed boost
});

/** The wind: state.wind = { x, z } m/s, slowly varying; gusts every 20–40 s up to 3 m/s (seeded). */
export const WIND = Object.freeze({ base: 0.6, gustMax: 3.0, gustEvery: [20, 40] });
