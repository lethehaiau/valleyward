// @ts-check
// VALLEYWARD · the sim's numbers (docs/DESIGN.md §2, §3.2). Changes to DESIGN numbers are listed in docs/CORE.md.

export const DT = 1 / 60;
export const GRAVITY = 20;          // player gravity (snappy jump); bombs use G_BOMB, the Lance jet G_JET

export const PLAYER = Object.freeze({
  hp: 100, walk: 6, sprint: 9, jump: 1.1, accel: 12, decel: 20, stepUp: 0.45,
  meleeReach: 1.2,                  // an enemy this close (plus radii) hits the player
  fireReach: 1.5,                   // fire (heat ≥ 0.45, 5 dps) hurts the player only with the feet this close to the ground
});

export const WEAPON = Object.freeze({
  pistol: Object.freeze({ dmg: 18, rate: 4, mag: 8, reload: 1.2, pierce: 1, spreadDeg: 0.8, range: 60 }),
  blunderbuss: Object.freeze({ dmg: 9, pellets: 10, coneDeg: 9, rate: 1.2, mag: 4, reload: 1.6, pierce: 0, range: 40 }),
  lance: Object.freeze({ fuel: 100, burn: 14, regen: 6, regenDelay: 0.8, brazierMul: 3, brazierR: 2.5, range: 11,
    speed: 16, gravity: 14, nozzleDrop: 0.25, jetRadius: 0.75, streamLen: 1.8, streamRadius: 0.9, streamPush: 7 }),
  bomb: Object.freeze({ charges: 3, recharge: 7, speed: 20, gravity: 9.8, lift: 0.12, burstR: 3.5, fuelR: 2.5,
    blastDmg: 12, blastR: 2.5, push: 7 }),
  sunburst: Object.freeze({ kills: 150, radius: 14, seconds: 0.9, dmg: 20 }),
});

/** Enemy kinds in ENEMY_KINDS order: grunt, imp, spear, brute. Brutes take ×0.5 fire (their door shield is wet).
 *  Brute gateDps 8 → 6; every kind deals ×0.5 gate damage while burning (horde.js BURNING_GATE_MUL). */
export const ENEMY = Object.freeze([
  // DESIGN §5.7: grunt HP 12 → 22 (a burning grunt lives 5.5 s on Night I at BURN.dps 4), imp 6 → 12 with fire ×1 (3 s)
  Object.freeze({ kind: 'grunt', hp: 22, speed: 2.4, gateDps: 2, melee: 6, meleeEvery: 1.0, burnMul: 1, radius: 0.32, height: 1.1 }),
  Object.freeze({ kind: 'imp', hp: 12, speed: 4.0, gateDps: 1, melee: 4, meleeEvery: 0.8, burnMul: 1, radius: 0.26, height: 0.85 }),
  Object.freeze({ kind: 'spear', hp: 16, speed: 2.0, gateDps: 2, melee: 0, meleeEvery: 1.0, burnMul: 1, radius: 0.32, height: 1.2 }),
  Object.freeze({ kind: 'brute', hp: 70, speed: 1.6, gateDps: 6, melee: 14, meleeEvery: 1.4, burnMul: 0.5, radius: 0.6, height: 1.9 }),
  // DESIGN §5.4: the elites (chief, hexer) and the Douser; ENEMY_KINDS order (src/shared/events.js)
  Object.freeze({ kind: 'chief', hp: 220, speed: 2.1, gateDps: 6, melee: 12, meleeEvery: 1.2, burnMul: 0.5, radius: 0.55, height: 1.7 }),
  Object.freeze({ kind: 'hexer', hp: 140, speed: 2.0, gateDps: 2, melee: 6, meleeEvery: 1.0, burnMul: 0.6, radius: 0.4, height: 1.3 }),
  Object.freeze({ kind: 'douser', hp: 14, speed: 2.6, gateDps: 2, melee: 4, meleeEvery: 1.0, burnMul: 0.7, radius: 0.34, height: 1.15 }),
]);
export const K = Object.freeze({ grunt: 0, imp: 1, spear: 2, brute: 3, chief: 4, hexer: 5, douser: 6 });
/** Elites and Dousers (DESIGN §5.4). Chieftain: rallies goblins within `rallyR` (+20 % speed). Hexer: keeps 13–20 m from
 *  the Lamplighter and throws a hex every `every` s (flight at `speed` m/s); a hit makes the Lance sputter `sputter` s.
 *  Douser: every `every` s throws water at the hottest fire within `reach` m (a `douse` op of radius r on landing). */
export const ELITE = Object.freeze({
  maxPerNight: 3,
  chief: Object.freeze({ rallyR: 6, rally: 1.2 }),
  hexer: Object.freeze({ near: 13, far: 20, every: 5, speed: 14, hitR: 1.3, sputter: 2 }),
  douser: Object.freeze({ every: 4.5, reach: 9, r: 2.5, flight: 0.8, minHeat: 0.25 }),   // 3.5 → 4.5 s (≈ 1,500 throws a night was a steam storm)
});
/** The new skills (DESIGN §10.4). */
export const SKILL = Object.freeze({
  soulFeast: Object.freeze([0.03, 0.05, 0.07]), soulHeal: 6,
  // DESIGN §10.4 CINDER STEPS: at any walking speed; on the ground a wake (two embers side by side, wider by level); on the
  // wall walk cinders fall over the parapet onto the wall's foot under the player's x (z 0.4–1.5)
  trail: Object.freeze({ every: 0.2, minSpeed: 0.8, amount: [0.8, 1.05, 1.3], width: [0.45, 0.65, 0.85], back: 0.7, wallAmount: [0.7, 0.9, 1.1], wallZ: [0.4, 1.5] }),
  // DESIGN §10.4 EMBER GALE: every 14/11/8 s a 2.5 s hot gust from the keep downhill (+z): wind at gale strength, burning
  // slope cells flare, goblins on the plaza and slope within 18 m of the wall pushed back and staggered
  gale: Object.freeze({ every: [14, 11, 8], seconds: 2.5, push: [1.0, 1.5, 2.0], stagger: 0.4, reach: 18, wind: 4.5, flare: 0.5, flareCap: 16, x: [-16, 32] }),
  orbit: Object.freeze({ r: 2.2, spin: 2.6, hitR: 0.75, dmg: 10, hitEvery: 0.5, emberEvery: 0.3, height: 1.0 }),
  // DESIGN §3.4 exception: HEARTHBLOOD heals only while standing in fire on the ground (heat ≥ regenHeat), 2/3/4 HP/s
  regen: Object.freeze([2, 3, 4]), regenHeat: 0.3,
  bellows: 1.35,
  meteor: Object.freeze({ every: [8, 6], r: 3, dmg: 20, flight: 0.9, minCrowd: 4 }),
  // DESIGN §10.4: a fire kill bursts (chance by level) into a `burst` op of radius r that deals dmg and ignites; ≤ perSecond
  pyre: Object.freeze({ chance: [0.5, 0.75, 1], r: [1.6, 2.2, 2.8], dmg: [6, 10, 14], perSecond: 24, delay: 0.12 }),
});
/** XP gems and coins (DESIGN §9.3): they spill, wait meta.js DROP_FLY_AFTER s, then fly to the Lamplighter (speed m/s, accel m/s²). */
// DESIGN §16: `goldMul` scales every coin drop's chance (meta.js DROPS) so progress needs several nights' gold per upgrade
export const LOOT = Object.freeze({ spill: 1.6, fly0: 7, flyAccel: 34, flyMax: 42, eventCap: 12, heart: 0, heartHeal: 0, goldMul: 0.5 });
// to put the player's HP at stake on the wall: the global budget 0.8 → 1.6 spears/s, aim error 0.7 → 0.5 m,
// and they lead a moving target by 0.85 × the flight time (was a fixed 0.15 s)
export const SPEAR = Object.freeze({ near: 14, far: 18, every: 3, speed: 18, dmg: 8, hitR: 0.7, perSecond: 1.6, aimError: 0.5, lead: 0.85 });
export const BRUTE_FRONT = 0.25;

export const HORDE = Object.freeze({
  cap: Object.freeze({ high: 10000, medium: 6000, low: 3000 }),   // DESIGN §15.4: = the actors' instance buffers; 10,000 alive held 60 fps (CORE.md §Enemy cost)
  chaseR: 6,                        // switch to the player within this range
  gateR: 2.6,                       // attack the gate within this range of ARENA.gate.target
  gateAttackers: 20,                // at most this many deal gate damage per tick (the front of the pile); 24 → 20: the browser soak (GPU fire) lost 3/4 at the gate
  pileR: 7,                         // the mound forms within this range of the gate target
  pileStep: 0.22, pileMax: 3.2,     // height per crowding unit, max height (m)
  sepNeighbours: 10,
  dyingSeconds: 0.6,
  eventCap: 64,                     // per type per tick (ignite, death, hit); the stats still count every one
});

export const NIGHT = Object.freeze({
  dawnAt: 300, gentle: 20, gentleRate: 1.5, baseRate: 5, peakRate: 22, peakAt: 180,
  kindleCd: 45, kindleMul: 1.6, kindleSeconds: 40, kindleXp: 1.5, trollAt: 210, trollKindles: 3,
  // kind mix by clock (weights for grunt, imp, spear, brute)
  mix: Object.freeze([
    Object.freeze({ at: 0, w: [1, 0, 0, 0] }),
    Object.freeze({ at: 40, w: [0.8, 0.2, 0, 0] }),
    Object.freeze({ at: 60, w: [0.68, 0.2, 0.12, 0] }),
    Object.freeze({ at: 105, w: [0.64, 0.2, 0.12, 0.04] }),   // brutes 0.06 → 0.04
    Object.freeze({ at: 180, w: [0.62, 0.22, 0.12, 0.04] }),   // brutes 0.08 → 0.04 (they take ×0.5 fire)
  ]),
  southShare: 0.75,
});
/** DESIGN §8 Night VI (the swarm): imp floods (weights in ENEMY_KINDS order). */
export const IMP_MIX = Object.freeze([
  Object.freeze({ at: 0, w: [0.7, 0.3, 0, 0, 0, 0, 0] }),
  Object.freeze({ at: 30, w: [0.4, 0.5, 0.04, 0, 0, 0, 0.06] }),
  Object.freeze({ at: 105, w: [0.34, 0.5, 0.08, 0.03, 0, 0, 0.05] }),
]);
/** Night II's spawn mix (DESIGN §8.1: ×1.35 spawns, Dousers): weights for grunt, imp, spear, brute, chief, hexer, douser
 *  (elites come from NIGHTS[].elites, never from the mix). */
export const NIGHT2_MIX = Object.freeze([
  Object.freeze({ at: 0, w: [1, 0, 0, 0, 0, 0, 0] }),
  Object.freeze({ at: 30, w: [0.84, 0.1, 0, 0, 0, 0, 0.06] }),
  Object.freeze({ at: 60, w: [0.63, 0.18, 0.12, 0, 0, 0, 0.07] }),
  Object.freeze({ at: 105, w: [0.58, 0.2, 0.12, 0.04, 0, 0, 0.06] }),
  Object.freeze({ at: 180, w: [0.58, 0.2, 0.12, 0.04, 0, 0, 0.06] }),
]);

export const PICKUP = Object.freeze({ magnet: 3, fly: 14, life: 60, cap: 600, gold: 0.10, heart: 0.01, heal: 15, xp: 1 });
// XP is credited on every kill: ≈ 1 XP per goblin, ~5,000–6,000 a night. The curve gives a wall player
// ≈ 8–12 level-ups a night (L2 at ≈ 45 s, then one every ≈ 25–30 s). Was 10 + 7L + 0.8L² (gems: 0–5 level-ups a night).
export const XP_K = 100;
// balance (an alternative measured worse on the wall): past level 12 each level costs 12 % more per level (level 20 ×1.96, 30 ×3.16):
// Night I plays as before, the run's cards snowball less across later nights
export const XP_GROW = Object.freeze({ from: 12, per: 0.12 });
export const XP_NEXT = (level) => Math.round(XP_K * (level <= 1 ? 0.6 : level - 0.2) * (1 + XP_GROW.per * Math.max(0, level - XP_GROW.from)));

// DESIGN §6.2 (a stronger boss): HP 2,400 → 4,000 (Night II 4,500: meta.js NIGHTS[].trollHp), damage ×1.4 (smash 60 → 84,
// throw 25 → 35, stomp 18 → 25), cadence +25 % (every ÷ 1.25), and the Ash Roar (every 20 s: a cone that douses the fire
// in front of it and calls 30 goblins)
export const TROLL = Object.freeze({
  hp: 4000, speed: 1.4, radius: 2.2, height: 7, fireMul: 0.2, glowSeconds: 4, gunMul: 3, heatRate: 0.55, heatDecay: 0.12,
  smash: Object.freeze({ windup: 1.2, dmg: 84, every: 2.72 }),
  // DESIGN §6.1: no tanking: a boulder 42 and a stomp 40 (3–4 hits kill a Lamplighter with Hide 2: 130 HP, −10 %);
  // the stomp reaches 6 m and the troll walks on a Lamplighter on the ground within `chase` 8 m
  throw: Object.freeze({ windup: 1.0, flight: 1.4, r: 2.5, dmg: 42, every: 5.2, minDist: 10 }),
  stomp: Object.freeze({ windup: 0.8, r: 6, dmg: 40, every: 2.6, near: 5.5 }),
  roar: Object.freeze({ windup: 1.0, every: 20, first: 12, r: 12, angle: 0.6, calls: 30 }),   // angle: the cone's half-angle (rad)
  spawn: Object.freeze({ x: 29, z: 82 }),
  gateStand: 3.2,                   // stands this far south of the gate target to smash
  chase: 8,                         // DESIGN §6.1: turns on a Lamplighter on the ground within 8 m
});

export const TROUGH = Object.freeze({ burnSeconds: 14, igniteHeat: 0.3, emberEvery: 0.25, points: 6 });
export const BARREL = Object.freeze({ blastR: 3, blastDmg: 30, burstR: 3.2, fuelR: 2.5, igniteHeat: 0.5, fuse: 0.5, height: 1.1 });

/** DESIGN §5.7: the goblins grow with the night (every kind, the elites and the Siege Ram's crew): HP, melee and gate
 *  damage, speed, and the fire damage they take (floor 0.5). Night n's multipliers: `nightScale(n)`. */
export const NIGHT_SCALE = Object.freeze({ hp: 0.5, dmg: 0.25, speed: 0.03, burn: 0.07, burnFloor: 0.5 });
export function nightScale(n) {
  const k = Math.max(0, (n || 1) - 1), S = NIGHT_SCALE;
  return Object.freeze({ n: n || 1, hp: 1 + S.hp * k, dmg: 1 + S.dmg * k, speed: 1 + S.speed * k, burn: Math.max(S.burnFloor, 1 - S.burn * k) });
}
/** DESIGN §3.4: the only healing in a night: a level-up heals this fraction of max HP. */
export const LEVEL_HEAL = 0.10;
