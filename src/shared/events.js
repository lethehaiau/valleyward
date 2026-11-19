// @ts-check
// VALLEYWARD · sim → presentation events (docs/DESIGN.md §14.4). The sim pushes `{ type, t, ...payload }` objects; main.js
// drains them once per rendered frame and hands each to env, fluid, actors, fx, cinema, ui and audio via
// `onEvent(ev, state)`. Adding a type is fine (append + document here); never rename or remove
// one. Positions are world metres {x, y, z}; `t` is sim seconds; `id` of an enemy is its slot index in state.horde.

export const EV = Object.freeze({
  // flow
  MODE: 'mode',                     // { mode, prev }  modes: 'title' | 'intro' | 'play' | 'cards' | 'victory' | 'fallen' | 'camp' (DESIGN §9)
  NIGHT_START: 'night.start',       // {}  control handed to the player
  WAVE: 'wave',                     // { n, size, kindled: bool }  a wave begins (also after a kindle)
  DAWN: 'dawn',                     // {}  the troll is dead and the night timer ran out: dawn breaks (victory follows)
  VICTORY: 'victory',               // { stats }
  FALLEN: 'fallen',                 // { cause: 'player' | 'gate', stats }
  RETRY: 'retry',                   // {}  state reset (short re-entry, no full intro)

  // player
  P_STEP: 'player.step',            // { pos, speed }
  P_JUMP: 'player.jump',            // { pos }
  P_LAND: 'player.land',            // { pos, fall }
  P_HURT: 'player.hurt',            // { pos, dmg, source: 'melee' | 'spear' | 'boulder' | 'stomp' | 'fire', dir: {x,z} }
  P_DEATH: 'player.death',          // { pos }
  P_HEAL: 'player.heal',            // { amount }
  WEAPON_SWITCH: 'weapon.switch',   // { weapon }  'pistol' | 'blunderbuss' | 'lance'
  SHOT: 'weapon.shot',              // { weapon, origin, dir, pellets: [{ to, hitId|null, surf? }] }  hitscan shot (tracers, muzzle); DESIGN §4.2: `surf` = 'enemy' | 'ground' | 'stone' | 'wood' | 'air' (what the round struck; 'air' = no hit within range)
  RELOAD: 'weapon.reload',          // { weapon, seconds }
  DRY: 'weapon.dry',                // { weapon }  trigger with no ammo / fuel
  LANCE_ON: 'lance.on',             // { origin, dir }   the Ember Lance starts spraying (audio loop, jet visual)
  LANCE_OFF: 'lance.off',           // {}
  BOMB_THROW: 'bomb.throw',         // { id, from, vel, fuse }  a firebomb leaves the hand (actors/fx draw it from state.bombs)
  BOMB_BURST: 'bomb.burst',         // { id, pos, r }  bursts: a fire op 'burst' is queued the same tick
  SUNBURST: 'sunburst',             // { pos, r }  the ultimate fire nova (Q)
  PICKUP: 'pickup',                 // { kind: 'xp' | 'gold' | 'heart', value, pos }
  XP_GAIN: 'xp.gain',               // { value, n, from: [pos ≤ 8] }  XP credited on kills this tick (the FX's wisps)
  LEVEL_UP: 'level.up',             // { level, cards: [cardId, cardId, cardId] }  the sim enters mode 'cards'
  CARD_PICK: 'card.pick',           // { cardId, level }

  // horde
  E_SPAWN: 'enemy.spawn',           // { id, kind, pos }   (batched: at most one event per kind per tick, with `count`)
  E_HIT: 'enemy.hit',               // { id, kind, pos, dmg, source: 'bullet' | 'fire' | 'blast', crit: bool }
  E_IGNITE: 'enemy.ignite',         // { id, kind, pos }  starts burning (sprite turns to its burning frames)
  E_DEATH: 'enemy.death',           // { id, kind, pos, burned: bool }
  E_ATTACK: 'enemy.attack',         // { id, kind, pos, target: 'gate' | 'player' }
  SPEAR_THROW: 'spear.throw',       // { id, from, vel }  (state.spears holds the live ones)
  SPEAR_HIT: 'spear.hit',           // { id, pos, target: 'player' | 'ground' }
  GATE_HIT: 'gate.hit',             // { pos, dmg, hpFrac }  (batched per tick)
  GATE_BREACH: 'gate.breach',       // {}  gate HP 0 (the FALLEN flow follows)

  // fire and oil
  BARREL_BURST: 'barrel.burst',     // { idx, pos }  an oil barrel explodes (fuel splash + fire burst)
  TROUGH_LIT: 'trough.lit',         // { id }   an oil trough caught fire
  TROUGH_OUT: 'trough.out',         // { id }   burnt out (refills after ARENA.oil.refillSeconds)
  TROUGH_FULL: 'trough.full',       // { id }   refilled
  KINDLE: 'beacon.kindle',          // { level }  the beacon is kindled (bigger wave called, lance refilled)
  BEACON_READY: 'beacon.ready',     // {}  the kindle cooldown is over

  // the Ash Troll
  T_ARRIVE: 'troll.arrive',         // { pos }  emerges from the valley fog (cinema: arrival beat)
  T_STEP: 'troll.step',             // { pos }
  T_WINDUP: 'troll.windup',         // { move: 'smash' | 'throw' | 'stomp', pos, windup }
  T_SMASH: 'troll.smash',           // { pos, target: 'gate' | 'ground' }
  T_THROW: 'troll.throw',           // { from, to, flight }  a boulder (state.boulders)
  T_BOULDER: 'troll.boulder',       // { pos, r }  boulder lands
  T_STOMP: 'troll.stomp',           // { pos, r }
  T_GLOW: 'troll.glow',             // { on: bool, heat }  the ash hide is red-hot (guns ×3) or cooled
  T_HURT: 'troll.hurt',             // { pos, dmg, hpFrac, glowing: bool }
  T_DEATH: 'troll.death',           // { pos }

  // DESIGN §9: the roguelite loop, camp, NPC, towers, elites, charms, skills, coloured fire, story
  RUN_START: 'run.start',           // { runN, night }  a new run begins at Night I (towers cleared, cards reset)
  RUN_END: 'run.end',               // { reason: 'fall' | 'complete', night, stats, goldBanked }
  CAMP_ENTER: 'camp.enter',         // { nextNight, reason: 'dawn' | 'fall' | 'start' | 'complete' }
  CAMP_LEAVE: 'camp.leave',         // { night }  the lamp is kindled at the camp: the night begins (cinema)
  NIGHT_TITLE: 'night.title',       // { night }  "NIGHT II" card beat
  COMING_SOON: 'coming.soon',       // { completedNight }  after Night II's dawn: NIGHTS III–X · COMING SOON
  NPC_OPEN: 'npc.open',             // {}  Brother Cinder's panel opens (the sim holds the player)
  NPC_CLOSE: 'npc.close',           // {}
  NPC_LINE: 'npc.line',             // { line }  a line id from docs/STORY.md (subtitle + optional voice)
  BUY: 'shop.buy',                  // { item, level, cost, goldLeft }
  GOLD_DROP: 'gold.drop',           // { pos, value, n }  coins spill (they fly to the player after 0.6 s)
  XP_DROP: 'xp.drop',               // { pos, value, n }  ember gems spill (they fly to the player after 0.6 s)
  CHARM_DROP: 'charm.drop',         // { pos, charm }  an elite drops a charm
  CHARM_PICKUP: 'charm.pickup',     // { charm, dup: bool, gold }  (a duplicate turns into gold)
  CHARM_EQUIP: 'charm.equip',       // { charm, slot, on: bool }
  ELITE_SPAWN: 'elite.spawn',       // { id, kind: 'chief' | 'hexer', pos }
  HEX: 'hexer.hex',                 // { from, to, hit: bool }  a hit makes the Lance sputter for 2 s
  DOUSE_THROW: 'douser.throw',      // { id, from, to, r }  a Douser throws water (a 'douse' fire op follows on landing)
  TOWER_BUILD: 'tower.build',       // { pad, type: 'obelisk' | 'chainimp', level, cost }
  TOWER_UPGRADE: 'tower.upgrade',   // { pad, type, level, cost }
  OBELISK_PULSE: 'obelisk.pulse',   // { pad, pos, r, level }  violet fire nova (burst ops on the ring, hue 'violet')
  CHAIN_THROW: 'chain.throw',       // { pad, from, to, targetId }  a hook flies
  CHAIN_HOOK: 'chain.hook',         // { pad, targetId, pos, pull }  hooked: slowed and pulled toward the imp
  ORBIT_HIT: 'orbit.hit',           // { pos, id }  an Ember Orbit fireball hits a goblin (blue)
  METEOR: 'meteor',                 // { from, pos, r, flight }  Brimstone Rain (green) lands after `flight` s
  TRAIL: 'trail',                   // { pos, from?, wall? }  Cinder Steps drop fire (lilac), batched ≤ 1 per 0.2 s; DESIGN §10.4: `wall` true = cinders fall from the parapet point `from` to `pos` at the wall's foot
  GALE: 'gale',                     // { dir: {x, z}, strength, seconds, level }  DESIGN §10.4 Ember Gale: a hot gust from the keep down the slope (fire leans and flares downhill, goblins pushed back)
  STORY: 'story',                   // { beat }  a STORY.md beat fired (dawn lines, lamp vision, coming soon)

  // the Thunder Organ, the Bat Gremlin, the Ash Roar, Pyre Burst
  ORGAN_SPIN: 'organ.spin',         // { on }  the crank starts / stops (silent)
  ORGAN_FIRE: 'organ.fire',         // {}  rounds begin: start the one firing loop
  ORGAN_STOP: 'organ.stop',         // { reason: 'release' | 'overheat' | 'empty' | 'switch' }  end the loop
  ORGAN_OVERHEAT: 'organ.overheat', // { seconds }
  ORGAN_EQUIP: 'organ.equip',       // { on }  slot 2 swap toggle at Brother Cinder's
  AIR_SPAWN: 'air.spawn',           // { n, pos }  a Bat Gremlin flock arrives (Night II)
  AIR_SCREECH: 'air.screech',       // { id, pos, to, windup }  the dive's telegraph (`to` = the ground shadow)
  AIR_DIVE: 'air.dive',             // { id, from, to, seconds }
  AIR_HIT: 'air.hit',               // { id, pos }  a dive hits the player (EV.P_HURT source 'air' follows)
  AIR_IGNITE: 'air.ignite',         // { id, pos }
  AIR_DEATH: 'air.death',           // { id, pos, burned }
  AIR_CRASH: 'air.crash',           // { id, pos }  a burning one crashes (a small burst op)
  T_ROAR: 'troll.roar',             // { pos, dir: {x, z}, r, angle, calls }  Ash Roar: douses a cone, calls goblins
  PYRE_BURST: 'pyre.burst',         // { pos, r, level }  a fire kill bursts (a burst op follows)
});

/** Enemy kinds (state.horde.kind values, in this order). */
export const ENEMY_KINDS = Object.freeze(['grunt', 'imp', 'spear', 'brute', 'chief', 'hexer', 'douser']); // chief/hexer/douser: DESIGN §5.4

/** Weapons in slot order (1, 2, 3); firebombs and the sunburst are separate keys. */
export const WEAPONS = Object.freeze(['pistol', 'blunderbuss', 'lance']);
