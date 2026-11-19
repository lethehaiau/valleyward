// @ts-check
// VALLEYWARD · the arena: the single source of truth for the sim's colliders, the terrain height, the fluid domain and
// the environment's layout (docs/DESIGN.md §2, §3.2, §14).
// Pure data + pure functions, no imports (Node tests and Vite both load it).
//
// Units: metres. Axes: y up, +X east, +Z south (downhill, toward the valley and the moon). A yaw is a rotation about +Y
// that matches three.js `object.rotation.y` for a model facing +Z: forward = (sin yaw, 0, cos yaw). Yaw π/2 faces east.
//
// The place: Valleyward Keep, a small square stone fort on a hilltop. Its south wall faces the valley. In front of the
// wall lies a flat earth plaza (the gate plaza) that runs east along the wall as the start of the road. South of the
// plaza the hill falls away to a misty pine valley where the horde gathers. The road leaves the plaza's east end and
// switchbacks down the slope. The beacon burns on the south-east corner tower.

export const ARENA = Object.freeze({
  /** The keep: walls are solid boxes; the courtyard is set dressing only (the player never enters it). */
  keep: Object.freeze({
    x0: -16, x1: 16, z0: -32, z1: 0, // outer faces
    wallThick: 3, wallHeight: 5, walkY: 5, parapetH: 1.1,
    // Wall walk the player can stand on: the top of the south wall between the corner towers.
    walk: Object.freeze({ x0: -12.6, x1: 12.6, z0: -2.6, z1: -0.4, y: 5 }),
    towers: Object.freeze([
      { id: 'sw', x: -16, z: 0, half: 3.2, height: 10 },
      { id: 'se', x: 16, z: 0, half: 3.2, height: 10, beacon: true }, // the beacon tower
      { id: 'nw', x: -16, z: -32, half: 3, height: 9 },
      { id: 'ne', x: 16, z: -32, half: 3, height: 9 },
    ]),
  }),
  /** The gate in the south wall: a barricaded wooden double door under an arch. The horde attacks it. */
  gate: Object.freeze({ x0: -2.5, x1: 2.5, z: 0, height: 4.2, hp: 1000, target: Object.freeze({ x: 0, z: 1.2 }) }),
  /** The beacon: an iron fire basket on top of the SE tower; kindled from the kindling pan on the wall walk (E). */
  beacon: Object.freeze({ basket: Object.freeze({ x: 16, y: 14.4, z: 0 }), // y 11.2 → 14.4: clear of the near merlons from the plaza
    pan: Object.freeze({ x: 11.6, y: 5, z: -1.5 }), useRadius: 2.2 }),
  /** A timber stair against the outside of the south wall, west of the gate: ground (z 10) up to the wall walk (z 0). */
  stair: Object.freeze({ x0: -10.25, x1: -7.75, zBottom: 10, zTop: 0.2, yTop: 5 }),
  /** The flat gate plaza in front of the south wall; it runs east along the wall as the first stretch of the road. */
  plaza: Object.freeze({ x0: -22, x1: 26, z0: 0, z1: 9, y: 0 }),
  /** Road centreline (visual + a cheaper cost in the horde's flow field). Width 6 m. Ends in the valley fog. */
  road: Object.freeze({ width: 6, points: Object.freeze([[4, 4.5], [24, 4.5], [31, 12], [24, 24], [34, 38], [25, 52], [32, 66], [29, 84]]) }),
  /** Oil: stone troughs at the foot of the south wall and a trench across the road at the plaza's east end. */
  oil: Object.freeze({
    // the troughs end 0.4 m short of the corner towers' footprint (|x| ≥ 12.8) and start
    // past the gate braziers (|x| 4), so no tower or brazier stands in the oil.
    troughs: Object.freeze([
      { id: 'trough-w', x0: -12.4, x1: -5, z0: 0.4, z1: 1.6 },
      { id: 'trough-e', x0: 5, x1: 12.4, z0: 0.4, z1: 1.6 },
      { id: 'trench-road', x0: 21.6, x1: 22.8, z0: 0.6, z1: 8.6 },
    ]),
    refillSeconds: 30, // a burnt-out trough refills this long after its fire is out
    barrels: Object.freeze([[8, 14], [-6, 18], [18, 20], [28, 16], [32, 28], [12, 30], [-10, 32], [22, 40], [36, 46], [4, 44]]),
    barrelRadius: 0.5,
  }),
  /** Braziers (always lit; standing within 2.5 m refills the Ember Lance 3× faster). */
  braziers: Object.freeze([[-4, 1.1], [4, 1.1], [21, 1.1], [-20.2, 7.6]]), // west one: off the trough/tower, then out of the plaza → Brother Cinder sight line (keeps him visible from the plaza)
  /** Where the player starts: on the plaza, facing east along the wall (the M1 framing: wall on the left). */
  playerSpawn: Object.freeze({ x: 3, z: 5, yaw: Math.PI / 2 }),
  /** Where the player may walk on the ground (plus the stair and the wall walk). */
  playerBounds: Object.freeze({ x0: -22, x1: 46, z0: 0.6, z1: 60 }),
  /** The horde spawns beyond the fog: the valley arc in the south and the east flank. Points are [x, z]. */
  spawns: Object.freeze({
    south: Object.freeze({ x0: -30, x1: 60, z0: 70, z1: 84 }),
    east: Object.freeze({ x0: 56, x1: 62, z0: 12, z1: 60 }),
  }),
  /** The fluid sim's ground rectangle (x0, z0, size): 64 × 64 m over the plaza, the road and the slope. */
  fluid: Object.freeze({ x0: -20, z0: -2, size: 64 }),
  /** The ground mesh extent (the far backdrop beyond it is the environment's business). */
  terrain: Object.freeze({ x0: -70, x1: 110, z0: -60, z1: 140 }),
  /** The camp between nights (DESIGN §9.2): Brother Cinder's stall on the west plaza, six build pads on open
   *  ground (clear of the stair, troughs, trench, braziers and the gate path), the dusk sun low in the west. */
  camp: Object.freeze({
    npc: Object.freeze({ x: -17.5, z: 3.5, yaw: Math.PI / 2, useRadius: 2.4 }),
    pads: Object.freeze([
      { id: 'pad-gate-w', x: -5.5, z: 6.5 },
      { id: 'pad-gate-e', x: 8.5, z: 6.5 },
      { id: 'pad-road', x: 16.5, z: 6.0 },
      { id: 'pad-west', x: -14, z: 7.5 },
      { id: 'pad-slope', x: 5, z: 15 },
      { id: 'pad-bend', x: 27, z: 14 },
    ]),
    padRadius: 1.0, padUseRadius: 2.2, towerRadius: 0.8,
    sunDir: Object.freeze({ x: -0.86, y: 0.2, z: 0.47 }), // dusk: low in the west-south-west, behind the keep's west wall
  }),
  /** The goblins' village in the valley (DESIGN §12.7): the environment builds it here; the actors stage
   *  the hunt here (villagers flee toward `forest`); the cinema's crane frames it. */
  village: Object.freeze({ x: 12, z: 108, r: 17, forest: Object.freeze({ x: -14, z: 126 }) }),
  /** The moon: low in the east-south-east over the valley (unit vector from the scene toward the moon). */
  moonDir: Object.freeze({ x: 0.83, y: 0.29, z: 0.48 }),
});

/** Body sizes the sim and the actors agree on (metres). */
export const BODY = Object.freeze({
  player: Object.freeze({ radius: 0.4, height: 1.8, eye: 1.68 }),
  grunt: Object.freeze({ radius: 0.32, height: 1.1 }),
  imp: Object.freeze({ radius: 0.26, height: 0.85 }),
  spear: Object.freeze({ radius: 0.32, height: 1.2 }),
  brute: Object.freeze({ radius: 0.6, height: 1.9 }),
  troll: Object.freeze({ radius: 2.2, height: 7.0 }),
  chief: Object.freeze({ radius: 0.55, height: 1.7 }),   // elites and Dousers (DESIGN §5.4)
  hexer: Object.freeze({ radius: 0.4, height: 1.3 }),
  douser: Object.freeze({ radius: 0.34, height: 1.15 }),
});

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/**
 * Ground height at (x, z), metres. Flat plaza (y 0) north of z 9, then the hill falls south toward the valley
 * (≈ −14 m at z 70), with the valley sides rising a little to funnel the horde, and a gentle roll so the slope is
 * not a plane. Inside the keep's footprint it returns 0 (the courtyard floor). Same function for sim, env and fluid.
 * @param {number} x @param {number} z @returns {number}
 */
export function groundHeight(x, z) {
  if (z <= 9) return 0;
  const d = z - 9;
  const fall = -14 * smooth(0, 61, d) - 0.04 * Math.max(0, d - 61); // reaches −14 at z 70, keeps falling gently
  const sides = 0.0026 * x * x * smooth(6, 40, d) - 0.0026 * 4 * 4 * smooth(6, 40, d); // funnel toward x ≈ 4..30
  const roll = 0.45 * Math.sin(x * 0.19 + 0.7) * Math.sin(z * 0.16) * smooth(3, 18, d);
  return fall + sides + roll;
}

/**
 * Height of what the player stands on at (x, z), given their current height y (so the wall walk wins when the player
 * is up there). Returns the ground, the stair ramp or the wall walk.
 * @param {number} x @param {number} z @param {number} y @returns {number}
 */
export function standHeight(x, z, y) {
  const s = ARENA.stair;
  if (x >= s.x0 && x <= s.x1 && z <= s.zBottom && z >= s.zTop) {
    const yStair = s.yTop * (s.zBottom - z) / (s.zBottom - s.zTop);
    if (y >= yStair - 0.9) return yStair;
  }
  const w = ARENA.keep.walk;
  if (x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1 && y >= w.y - 0.9) return w.y;
  return groundHeight(x, z);
}

/** World (x, z) → fluid texture UV in [0, 1]² (u along +X, v along +Z). @param {number} x @param {number} z */
export function fluidUV(x, z) {
  const f = ARENA.fluid;
  return { u: (x - f.x0) / f.size, v: (z - f.z0) / f.size };
}
