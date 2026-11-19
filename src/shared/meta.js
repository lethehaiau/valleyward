// @ts-check
// VALLEYWARD · the roguelite catalogue (docs/DESIGN.md §9.3, §9.2, §9.6, §5.4, §10.4): permanent upgrades, towers, charms, drop tables and the
// save format. Pure data + pure helpers, no imports (Node tests and Vite both load it). The sim applies these
// numbers; the UI shows the same names, costs and effects; the bot reads them to shop. Numbers may be tuned (see
// docs/CORE.md); never rename ids.

/** localStorage key (the save is a per-viewer convenience: wrap every access in try/catch; Node uses memory). */
export const SAVE_KEY = 'valleyward.save.v1';

/** A fresh save. */
export function freshSave() {
  return {
    v: 1, gold: 0, runN: 0, bestNight: 0, nightsCompleted: 0,
    upgrades: { hide: 0, kestrel: 0, blunderbuss: 0, lance: 0, bombs: 0, gate: 0, slots: 0, organ: 0 },
    // DESIGN §4.2: the THUNDER ORGAN (owned: bought for ORGAN.cost; equipped: it takes slot 2 from the Blunderbuss)
    organ: { owned: false, equipped: false },
    ended: false,   // DESIGN §12.9: the ending was seen (nothing else persists after it)
    charms: { owned: /** @type {string[]} */ ([]), equipped: /** @type {string[]} */ ([]) },
    story: { seen: /** @type {string[]} */ ([]) },
  };
}

/** Permanent upgrades sold by Brother Cinder. cost(level) = round(base × growth^level) for buying level+1; growth 1.6,
 *  the weapon lines (DESIGN §4.3: 10 levels) 1.45. `needs`: only sold once that item is owned (the THUNDER ORGAN's line). */
export const UPGRADES = Object.freeze([
  { id: 'hide', name: 'Hide', max: 5, base: 60, text: '+15 max HP, −5 % damage taken', per: { hpMax: 15, dmgTaken: -0.05 } },
  { id: 'kestrel', name: 'Kestrel', max: 10, base: 50, growth: 1.45, weapon: true, text: '+15 % damage, +8 % rate', per: { kestrelDmg: 0.15, kestrelRate: 0.08 } },
  { id: 'blunderbuss', name: 'Blunderbuss', max: 10, base: 120, growth: 1.45, weapon: true, text: 'Lv 1: carried from the start of every night; then +2 pellets', per: { pellets: 2 } },
  { id: 'lance', name: 'Ember Lance', max: 10, base: 60, growth: 1.45, weapon: true, text: '+15 % tank, +15 % refill speed', per: { lanceTank: 0.15, lanceRefill: 0.15 } },
  // DESIGN §4.2: rescaled to the new price (4,500): 450 × 1.3^level, each level a smaller step
  { id: 'organ', name: 'Thunder Organ', max: 10, base: 450, growth: 1.3, weapon: true, needs: 'organ', text: '+8 % damage, +3 % rate, +8 % drum', per: { organDmg: 0.08, organRate: 0.03, organDrum: 0.08 } },
  { id: 'bombs', name: 'Firebombs', max: 3, base: 90, text: '+1 firebomb charge', per: { bombs: 1 } },
  { id: 'gate', name: 'Gate', max: 4, base: 70, text: '+15 % gate HP', per: { gateHp: 0.15 } },
  { id: 'slots', name: 'Charm slot', max: 2, base: 200, text: '+1 charm slot', per: { slots: 1 } },
]);
/** @param {{base:number, growth?:number}} u @param {number} level current level (0-based) → cost of the next level */
export const upgradeCost = (u, level) => Math.round(u.base * Math.pow(u.growth ?? 1.6, level));

/** DESIGN §4.2: the THUNDER ORGAN, a six-barrel brass rotary gun with a hand crank (slot 2 once bought and equipped).
 *  Hold to fire: spin-up, then `rate` rounds/s hitscan of `dmg` within `spreadDeg`; a `drum` of rounds, `reload` s; it
 *  heats over `heatSeconds` of continuous fire and locks for `overheat` s; it cools at `cool` of full heat per second. */
// DESIGN §4.2 (reachable on Nights V–VI, and the strongest slot-2 weapon): 4,500 gold (from the
// campaign gold curve: what an average player has left by first reaching Night V–VI after the core upgrades and the
// run's towers), 20 rounds/s of 20 that pass through one goblin (pierce 1), a tighter spread, a 300-round drum; an
// overheat vents the heat to `ventTo` during its lock (holding the trigger through it no longer stalls the gun); its
// damage grows with its own line only (not with Kestrel damage)
export const ORGAN = Object.freeze({ id: 'organ', name: 'Thunder Organ', cost: 4500, spinUp: 0.45, rate: 20, dmg: 20, spreadDeg: 2.0,
  drum: 300, reload: 2.2, heatSeconds: 6, overheat: 1.5, ventTo: 0.35, cool: 0.5, range: 55, pierce: 1,
  text: 'Six brass barrels and a crank: hold to spin up, then 20 rounds a second that punch through a goblin. Takes slot 2 from the Blunderbuss.' });
export const BASE_CHARM_SLOTS = 2;

/** Towers (built and upgraded only at the camp; they last for the run). Index = level − 1. */
export const TOWERS = Object.freeze({
  obelisk: Object.freeze({ id: 'obelisk', name: 'Black Obelisk', hue: 'violet', // on-screen name: STORY.md bans "hell" before Night X (internal: the Hellfire Obelisk)
    cost: [140, 220, 360, 600, 1000],   // DESIGN §9.6: weak at first, great after upgrades (5 levels)
    every: [4.5, 3.8, 3.0, 2.3, 1.7], radius: [3.0, 3.8, 4.8, 5.8, 7.0], dmg: [3, 5, 8, 12, 18],
    text: 'Pulses a fire nova around itself; the fire burns on' }),
  chainimp: Object.freeze({ id: 'chainimp', name: 'Chain Imp', cost: [110, 180, 300, 520, 900],
    every: [2.6, 2.1, 1.6, 1.2, 0.9], targets: [1, 1, 2, 3, 4], range: 16, slow: [0.3, 0.4, 0.55, 0.65, 0.75], slowFor: 2.5,
    pull: [1.2, 1.6, 2.2, 2.8, 3.4], dmg: [2, 3, 4, 6, 8],
    text: 'Throws chained hooks: slows and pulls goblins toward itself' }),
});

/** Charms (small perks; permanent once found; equipped in slots). */
export const CHARMS = Object.freeze([
  { id: 'ember-tooth', name: 'Ember Tooth', text: '+10 % fire damage', mod: { fireDmg: 0.10 } },
  { id: 'coin-hook', name: 'Coin Hook', text: '+15 % gold', mod: { gold: 0.15 } },
  { id: 'ashen-step', name: 'Ashen Step', text: '+8 % move speed', mod: { speed: 0.08 } },
  { id: 'bellows-heart', name: 'Bellows Heart', text: '+20 % Lance refill', mod: { lanceRefill: 0.20 } },
  { id: 'cinder-ward', name: 'Cinder Ward', text: '−8 % damage taken', mod: { dmgTaken: -0.08 } },
  { id: 'soot-lens', name: 'Soot Lens', text: '+20 % pickup reach', mod: { magnet: 0.20 } },
  { id: 'kindle-knot', name: 'Kindle Knot', text: 'The lamp kindles 20 % sooner', mod: { kindleCd: -0.20 } },
  { id: 'spark-bead', name: 'Spark Bead', text: '+1 firebomb at nightfall', mod: { bombsStart: 1 } },
  { id: 'witchfire-wick', name: 'Witchfire Wick', text: 'Your Lance burns green; +5 % fire damage', mod: { fireDmg: 0.05, lanceHue: 'green' } },
]);
export const CHARM_DUP_GOLD = 30;

/** Drops per kind: gold chance, coins per drop, XP value, charm chance (DESIGN §9.3, §5.4). */
export const DROPS = Object.freeze({
  grunt: { gold: 0.15, coins: 1, xp: 1, charm: 0 },
  imp: { gold: 0.15, coins: 1, xp: 1, charm: 0 },
  spear: { gold: 0.25, coins: 1, xp: 2, charm: 0 },
  brute: { gold: 0.6, coins: 3, xp: 5, charm: 0 },
  douser: { gold: 0.3, coins: 1, xp: 2, charm: 0 },
  chief: { gold: 1, coins: 12, xp: 25, charm: 1 },
  hexer: { gold: 1, coins: 8, xp: 18, charm: 0.5 },
  troll: { gold: 1, coins: 40, xp: 80, charm: 0 },
  bat: { gold: 0.15, coins: 1, xp: 1, charm: 0 },
  ram: { gold: 1, coins: 15, xp: 30, charm: 0 },   // DESIGN §5.6: the Siege Ram's crew   // DESIGN §5.5: the Bat Gremlin drops like a grunt
});
/** Seconds before dropped XP/gold fly to the player (soul-like, so the wall walk is never starved). */
export const DROP_FLY_AFTER = 0.6;

/** The ten nights (DESIGN §8.1). `title` shows on the NIGHT card; `moon` is the moon's id (it reddens to black); `twist`
 *  names the night's new thing. Spawns ×1 → ×2.2. `trolls`: arrival times (s); `trollHp` per troll (tuned
 *  against the noisy bot; DESIGN §16: fixed per night, no scaling by the player's power). `elites`: arrival times by kind (≤ 3 a night). Twists' schedules: `rams` (Siege Ram arrival
 *  times), `phalanx` (shield-wall waves), `coven` (3 Hexers that gather and chant), `rain` ('squalls' | 'storm'), `air`
 *  (true | 'swarm': flocks ×2), `mix` ('n1' | 'n2' | 'imps'), `douserMul`, `boss` ('rainmother'). */
export const NIGHTS = Object.freeze([
  { n: 1, name: 'NIGHT I', title: '', length: 300, spawnMul: 1, trolls: [210], trollHp: 9250, elites: { chief: [120, 200] }, dousers: false, hexers: false, air: false, mix: 'n1', moon: 'teal', twist: null },
  { n: 2, name: 'NIGHT II', title: 'BLOOD MOON', length: 300, spawnMul: 1.35, trolls: [150, 240], trollHp: 10000, elites: { hexer: [90, 160, 230] }, dousers: true, hexers: true, air: true, mix: 'n2', moon: 'blood', twist: 'air' },
  { n: 3, name: 'NIGHT III', title: 'THE RAM', length: 300, spawnMul: 1.45, trolls: [210], trollHp: 30000, elites: { chief: [100, 190] }, dousers: true, air: false, mix: 'n2', moon: 'rust', twist: 'ram', rams: [40, 120, 200] },
  { n: 4, name: 'NIGHT IV', title: 'WET WIND', length: 300, spawnMul: 1.55, trolls: [150, 240], trollHp: 24000, elites: { hexer: [150] }, dousers: true, douserMul: 2, air: false, mix: 'n2', moon: 'crimson', twist: 'rain', rain: 'squalls' },
  { n: 5, name: 'NIGHT V', title: 'THE SHIELD WALL', length: 300, spawnMul: 1.65, trolls: [150, 240], trollHp: 30000, elites: { chief: [140] }, dousers: true, air: false, mix: 'n2', moon: 'darkred', twist: 'phalanx', phalanx: [45, 105, 165, 225], spearMul: 2 },
  { n: 6, name: 'NIGHT VI', title: 'THE SWARM', length: 300, spawnMul: 1.75, trolls: [150, 240], trollHp: 37000, elites: { hexer: [100, 200] }, dousers: true, air: 'swarm', mix: 'imps', moon: 'redviolet', twist: 'swarm' },
  { n: 7, name: 'NIGHT VII', title: 'THE COVEN', length: 300, spawnMul: 1.85, trolls: [150, 240], trollHp: 46000, elites: {}, dousers: true, air: true, mix: 'n2', moon: 'violet', twist: 'coven', coven: [70, 170, 250] },
  { n: 8, name: 'NIGHT VIII', title: 'RAM AND ROAR', length: 300, spawnMul: 2.0, trolls: [150, 240], trollHp: 74000, elites: { chief: [100, 200] }, dousers: true, air: true, mix: 'n2', moon: 'deepred', twist: 'ramroar', rams: [60, 150, 230] },
  { n: 9, name: 'NIGHT IX', title: 'THE LAST WATCH', length: 300, spawnMul: 2.2, trolls: [120, 200, 260], trollHp: 61000, elites: { chief: [90], hexer: [170, 240] }, dousers: true, air: true, mix: 'n2', moon: 'blackred', twist: 'lastwatch', rams: [80, 180], phalanx: [130], rain: 'squalls' },
  { n: 10, name: 'NIGHT X', title: 'THE RAINMOTHER', length: 300, spawnMul: 2.3, trolls: [], trollHp: 10000, elites: {}, dousers: true, air: false, mix: 'n2', moon: 'black', twist: 'rainmother', rain: 'storm', boss: 'rainmother', bossAt: 30, bossHp: 91000 },
]);
export const NIGHTS_PLANNED = 10;
