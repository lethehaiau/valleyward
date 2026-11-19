// @ts-check
// VALLEYWARD · the sound bank: every sound id the engine can play and how it plays (docs/AUDIO.md).
// The files themselves are listed in assets/audio/manifest.json (written by assets-src/audio/build.mjs from this table);
// an id with no file plays nothing. Pure data, no imports (the Node build reads it).
//
// Fields: bus 'music'|'amb'|'sfx'|'ui' · gain dB (mix level on top of the normalised file) · pitch: ± semitones of
// random jitter per play · vary: ± dB random · max: concurrent voices of this id (the oldest is stolen) · rate: at most
// this many starts per 100 ms (the loudest requests of a frame win; the rest are dropped) · spatial: panned by the
// listener's yaw and attenuated by distance (ref m: full level inside; roll: how fast it falls off) · loop · prio: load
// order (0 first) · cls: how the build treats it ('music' | 'sting' | 'sfx' | 'loop' | 'bed' | 'voice').

/** @typedef {{ bus: string, gain: number, pitch?: number, vary?: number, max?: number, rate?: number, gap?: number, spatial?: boolean,
 *   ref?: number, roll?: number, loop?: boolean, prio?: number, cls: string, desc?: string }} SoundDef */

/** @type {Record<string, SoundDef>} */
export const SOUNDS = {
  // music (-18 LUFS files)
  mus_night: { bus: 'music', gain: -1, loop: true, prio: 0, cls: 'music', desc: 'night theme loop (dark folk, D minor)' },
  mus_kindle: { bus: 'music', gain: -1, loop: true, prio: 1, cls: 'music', desc: 'kindle layer: the heavier night theme' },
  mus_troll: { bus: 'music', gain: -0.5, loop: true, prio: 1, cls: 'music', desc: 'the Ash Troll theme loop' },
  mus_dawn: { bus: 'music', gain: -1, prio: 2, cls: 'sting', desc: 'dawn resolution (one-shot)' },
  mus_nightcard: { bus: 'music', gain: 1, prio: 0, cls: 'sting', desc: 'NIGHT I card sting' },
  mus_fallen: { bus: 'music', gain: 0, prio: 2, cls: 'sting', desc: 'fallen card sting' },

  // weapons (SFX files peak −3 dBFS)
  w_kestrel_shot: { bus: 'sfx', gain: -1, max: 6, rate: 3, prio: 0, cls: 'sfx', desc: 'Kestrel flintlock shot (one file, no jitter: the same shot every time)' },
  w_kestrel_reload: { bus: 'sfx', gain: -6, max: 1, prio: 0, cls: 'sfx', desc: 'Kestrel reload' },
  w_blunder_shot: { bus: 'sfx', gain: -1.5, max: 3, rate: 2, prio: 1, cls: 'sfx', desc: 'blunderbuss blast (one file, no jitter: the same blast every time)' },
  w_blunder_reload: { bus: 'sfx', gain: -6, max: 1, prio: 1, cls: 'sfx', desc: 'blunderbuss reload' },
  w_lance_ignite: { bus: 'sfx', gain: -5, max: 2, prio: 0, cls: 'sfx', desc: 'Ember Lance ignite' },
  w_lance_loop: { bus: 'sfx', gain: -3, loop: true, max: 1, prio: 0, cls: 'loop', desc: 'Ember Lance spray loop' },
  w_lance_stop: { bus: 'sfx', gain: -7, max: 2, prio: 0, cls: 'sfx', desc: 'Ember Lance stop / hiss' },
  w_switch: { bus: 'sfx', gain: -10, max: 1, prio: 1, cls: 'sfx', desc: 'weapon switch' },
  w_dry: { bus: 'sfx', gap: 0.15, gain: -8, max: 1, rate: 1, prio: 1, cls: 'sfx', desc: 'dry trigger click (procedural)' },
  bomb_throw: { bus: 'sfx', gain: -7, pitch: 1, max: 3, prio: 0, cls: 'sfx', desc: 'firebomb throw whoosh' },
  bomb_burst: { bus: 'sfx', gain: -2, pitch: 0.8, vary: 1, max: 4, rate: 2, spatial: true, ref: 8, roll: 0.6, prio: 0, cls: 'sfx', desc: 'clay smash + fire burst' },
  sunburst: { bus: 'sfx', gain: -1, max: 1, prio: 1, cls: 'sfx', desc: 'Sunburst fire nova' },

  // fire and oil
  barrel_burst: { bus: 'sfx', gain: -3, pitch: 1, max: 3, rate: 2, spatial: true, ref: 10, roll: 0.5, prio: 1, cls: 'sfx', desc: 'oil barrel explosion' },
  trough_ignite: { bus: 'sfx', gain: -3, max: 3, rate: 2, spatial: true, ref: 10, roll: 0.6, prio: 1, cls: 'sfx', desc: 'trough ignition whoosh' },
  fire_low: { bus: 'amb', gain: -4, loop: true, prio: 1, cls: 'loop', desc: 'fire crackle bed, low' },
  fire_mid: { bus: 'amb', gain: -4, loop: true, prio: 1, cls: 'loop', desc: 'fire crackle bed, mid' },
  fire_high: { bus: 'amb', gain: -4, loop: true, prio: 1, cls: 'loop', desc: 'fire crackle bed, high' },
  ignite_puff: { bus: 'sfx', gain: -12, pitch: 2, vary: 2, max: 4, rate: 2, spatial: true, ref: 6, roll: 1, prio: 1, cls: 'sfx', desc: 'small ignition (a goblin catches fire)' },
  fire_out: { bus: 'sfx', gain: -8, max: 2, spatial: true, ref: 8, roll: 0.6, prio: 2, cls: 'sfx', desc: 'fire dies to a hiss' },

  // the horde
  crowd_far: { bus: 'amb', gain: -2, loop: true, prio: 1, cls: 'bed', desc: 'horde chatter bed, far' },
  crowd_near: { bus: 'amb', gain: -2, loop: true, prio: 1, cls: 'bed', desc: 'horde chatter bed, near' },
  gob_death: { bus: 'sfx', gain: -9, pitch: 2.5, vary: 2, max: 6, rate: 3, spatial: true, ref: 4, roll: 1, prio: 0, cls: 'sfx', desc: 'goblin death squeak (6)' },
  gob_burn: { bus: 'sfx', gain: -12, pitch: 2, vary: 2, max: 4, rate: 2, spatial: true, ref: 4, roll: 1, prio: 1, cls: 'sfx', desc: 'burning goblin shriek (3)' },
  imp_chitter: { bus: 'sfx', gain: -11, pitch: 2, vary: 2, max: 3, rate: 2, spatial: true, ref: 4, roll: 1, prio: 1, cls: 'sfx', desc: 'imp chitter' },
  hit_flesh: { bus: 'sfx', gain: -11, pitch: 2, vary: 2, max: 6, rate: 4, spatial: true, ref: 6, roll: 0.8, prio: 0, cls: 'sfx', desc: 'bullet hits a goblin' },
  hit_wood: { bus: 'sfx', gain: -9, pitch: 1.5, vary: 1, max: 3, rate: 2, spatial: true, ref: 6, roll: 0.8, prio: 1, cls: 'sfx', desc: 'bullet hits a brute’s door shield' },
  claw: { bus: 'sfx', gap: 0.12, gain: -9, pitch: 1.5, vary: 2, max: 3, rate: 2, spatial: true, ref: 3, roll: 1, prio: 1, cls: 'sfx', desc: 'a goblin claws the player' },
  spear_throw: { bus: 'sfx', gain: -9, pitch: 1.5, max: 3, rate: 2, spatial: true, ref: 6, roll: 0.8, prio: 1, cls: 'sfx', desc: 'spear throw whoosh' },
  spear_impact: { bus: 'sfx', gain: -7, pitch: 1, max: 3, rate: 2, spatial: true, ref: 6, roll: 0.8, prio: 1, cls: 'sfx', desc: 'spear impact: [0] earth, [1] body' },
  gate_thud: { bus: 'sfx', gap: 0.28, gain: -3, pitch: 1.5, vary: 1.5, max: 3, rate: 1, spatial: true, ref: 10, roll: 0.5, prio: 0, cls: 'sfx', desc: 'blows on the gate (3)' },
  gate_splinter: { bus: 'sfx', gap: 0.8, gain: -4, max: 2, spatial: true, ref: 10, roll: 0.5, prio: 1, cls: 'sfx', desc: 'the gate splinters (damage step)' },
  gate_breach: { bus: 'sfx', gain: -2, max: 1, prio: 2, cls: 'sfx', desc: 'the gate collapses' },
  horde_flee: { bus: 'sfx', gain: -4, max: 1, prio: 2, cls: 'sfx', desc: 'the horde flees at dawn' },

  // the beacon
  beacon_kindle: { bus: 'sfx', gain: -3, max: 1, spatial: true, ref: 14, roll: 0.3, prio: 1, cls: 'sfx', desc: 'the beacon kindles (roar)' },
  beacon_ready: { bus: 'sfx', gain: -11, max: 1, spatial: true, ref: 14, roll: 0.3, prio: 1, cls: 'sfx', desc: 'the beacon is ready again (ember crackle)' },

  // pickups and UI
  xp_tick: { bus: 'ui', gain: -16, max: 4, rate: 2, prio: 0, cls: 'sfx', desc: 'XP gem tick (procedural; pitched up a ladder)' },
  gold: { bus: 'ui', gain: -12, pitch: 1, max: 3, rate: 2, prio: 1, cls: 'sfx', desc: 'gold clink' },
  heart: { bus: 'ui', gap: 0.25, gain: -8, max: 1, prio: 1, cls: 'sfx', desc: 'heart pickup / heal' },
  levelup: { bus: 'ui', gain: -6, max: 1, prio: 0, cls: 'sfx', desc: 'level-up chime' },
  card_hover: { bus: 'ui', gain: -16, max: 2, rate: 2, prio: 1, cls: 'sfx', desc: 'card hover (procedural)' },
  card_pick: { bus: 'ui', gain: -8, max: 1, prio: 1, cls: 'sfx', desc: 'card pick' },
  ui_click: { bus: 'ui', gain: -14, max: 2, rate: 2, prio: 1, cls: 'sfx', desc: 'UI click (procedural)' },

  // the Ash Troll
  troll_horn: { bus: 'sfx', gain: -4, max: 1, prio: 2, cls: 'sfx', desc: 'a low horn from the valley (troll arrival)' },
  troll_roar: { bus: 'sfx', gain: -4, max: 1, spatial: true, ref: 25, roll: 0.3, prio: 2, cls: 'sfx', desc: 'troll roar' },
  troll_windup: { bus: 'sfx', gain: -6, pitch: 0.8, max: 1, spatial: true, ref: 18, roll: 0.4, prio: 2, cls: 'sfx', desc: 'troll windup growl (telegraph)' },
  troll_step: { bus: 'sfx', gap: 0.15, gain: -4, pitch: 0.8, max: 2, rate: 1, spatial: true, ref: 14, roll: 0.5, prio: 2, cls: 'sfx', desc: 'troll footstep' },
  troll_smash: { bus: 'sfx', gain: -1, max: 1, spatial: true, ref: 16, roll: 0.4, prio: 2, cls: 'sfx', desc: 'troll smash' },
  troll_throw: { bus: 'sfx', gain: -5, max: 1, spatial: true, ref: 16, roll: 0.4, prio: 2, cls: 'sfx', desc: 'troll boulder throw grunt' },
  boulder_impact: { bus: 'sfx', gain: -2, pitch: 0.8, max: 2, spatial: true, ref: 10, roll: 0.5, prio: 2, cls: 'sfx', desc: 'boulder lands' },
  troll_stomp: { bus: 'sfx', gain: -1, max: 1, spatial: true, ref: 14, roll: 0.4, prio: 2, cls: 'sfx', desc: 'troll stomp' },
  troll_hit: { bus: 'sfx', gap: 0.06, gain: -8, pitch: 1.5, vary: 1, max: 3, rate: 2, spatial: true, ref: 14, roll: 0.4, prio: 2, cls: 'sfx', desc: 'shot hits the ash hide' },
  troll_sizzle: { bus: 'sfx', gap: 1.0, gain: -6, max: 2, spatial: true, ref: 14, roll: 0.4, prio: 2, cls: 'sfx', desc: 'the hide glows red-hot (sizzle)' },
  troll_death: { bus: 'sfx', gain: -3, max: 1, spatial: true, ref: 25, roll: 0.3, prio: 2, cls: 'sfx', desc: 'troll death roar + collapse' },

  // the Lamplighter
  p_hurt: { bus: 'sfx', gap: 0.22, gain: -6, pitch: 0.8, max: 1, rate: 1, prio: 0, cls: 'sfx', desc: 'player hurt grunt (no words)' },
  p_death: { bus: 'sfx', gain: -3, max: 1, prio: 1, cls: 'sfx', desc: 'player death' },
  step_earth: { bus: 'sfx', gap: 0.12, gain: -15, pitch: 1.2, vary: 2, max: 2, rate: 1, prio: 0, cls: 'sfx', desc: 'footstep on earth' },
  step_stone: { bus: 'sfx', gap: 0.12, gain: -15, pitch: 1.2, vary: 2, max: 2, rate: 1, prio: 1, cls: 'sfx', desc: 'footstep on stone' },
  step_timber: { bus: 'sfx', gap: 0.12, gain: -14, pitch: 1.2, vary: 2, max: 2, rate: 1, prio: 1, cls: 'sfx', desc: 'footstep on timber' },

  // ambience
  amb_night: { bus: 'amb', gain: -2, loop: true, prio: 0, cls: 'bed', desc: 'night forest bed (wind in pines, crickets, a far owl)' },
  wind_gust: { bus: 'amb', gain: -8, max: 2, prio: 1, cls: 'sfx', desc: 'wind gust (random, panned)' },

  // ================================================================================================= DESIGN §9
  // music: the camp at dusk, Night II, the coming-soon sting (same D minor / 92 BPM world)
  mus_camp: { bus: 'music', gain: -2, loop: true, prio: 0, cls: 'music', desc: 'the camp at dusk (calm, slightly sinister loop)' },
  mus_night2: { bus: 'music', gain: -1, loop: true, prio: 1, cls: 'music', desc: 'Night II: the heavier night theme (loop)' },
  mus_soon: { bus: 'music', gain: 0, prio: 2, cls: 'sting', desc: 'NIGHTS III–X · COMING SOON sting (choir swell, cut off)' },
  // Brother Cinder (docs/STORY.md hint 4; ids = EV.NPC_LINE `line`, see VOICE_LINES below)
  vo_cinder_home: { bus: 'voice', gain: 0, max: 1, prio: 1, cls: 'voice', desc: 'Brother Cinder: "You\'re home, Lamplighter. The lamp missed you."' },
  vo_cinder_hide: { bus: 'voice', gain: 0, max: 1, prio: 2, cls: 'voice', desc: 'Brother Cinder: "Coin for the hide? It wears thin on you. Always has."' },
  vo_cinder_afraid: { bus: 'voice', gain: 0, max: 1, prio: 2, cls: 'voice', desc: 'Brother Cinder: "They climb because they\'re afraid. Afraid is good. Afraid is loud."' },
  vo_cinder_gloves: { bus: 'voice', gain: 0, max: 1, prio: 2, cls: 'voice', desc: 'Brother Cinder: "Don\'t mind the gloves. They smoke when you\'re cross."' },
  vo_cinder_eight: { bus: 'voice', gain: 0, max: 1, prio: 2, cls: 'voice', desc: 'Brother Cinder: "Eight more nights. Then we can all go out."' },
  vo_cinder_eat: { bus: 'voice', gain: 0, max: 1, prio: 2, cls: 'voice', desc: 'Brother Cinder: "Odd. I never see you eat."' },
  vo_cinder_fall: { bus: 'voice', gain: 0, max: 1, prio: 1, cls: 'voice', desc: 'Brother Cinder: "You\'ll be back. You always are. That\'s rather the point of you."' },
  // gold, XP, charms, the shop
  coin_spill: { bus: 'sfx', gain: -10, pitch: 1.5, vary: 1.5, max: 3, rate: 2, gap: 0.05, spatial: true, ref: 6, roll: 0.8, prio: 1, cls: 'sfx', desc: 'coins spill from a kill' },
  coin_tick: { bus: 'ui', gain: -13, max: 4, rate: 2, gap: 0.035, prio: 0, cls: 'sfx', desc: 'coin collect: a bright pixel clink (procedural; pitched up a ladder)' },
  xp_collect: { bus: 'ui', gain: -17, pitch: 0.3, max: 4, rate: 2, gap: 0.04, prio: 1, cls: 'sfx', desc: 'XP ember gem collect (glassy tick; pitched up a ladder)' },
  charm_found: { bus: 'ui', gain: -5, max: 1, prio: 1, cls: 'sfx', desc: 'a charm is found (glassy chime)' },
  shop_buy: { bus: 'ui', gain: -5, max: 2, gap: 0.12, prio: 1, cls: 'sfx', desc: 'shop: buy (coins on the counter)' },
  charm_equip: { bus: 'ui', gain: -3, max: 2, gap: 0.08, prio: 1, cls: 'sfx', desc: 'equip a charm (click + hum)' },
  npc_open: { bus: 'ui', gain: -9, max: 1, gap: 0.3, prio: 1, cls: 'sfx', desc: 'Brother Cinder\'s stall opens (curtain + embers)' },
  // towers
  tower_build: { bus: 'sfx', gain: -3, max: 2, gap: 0.2, spatial: true, ref: 10, roll: 0.4, prio: 1, cls: 'sfx', desc: 'tower build (stone grinding + whoomp)' },
  tower_upgrade: { bus: 'sfx', gain: -3, max: 2, gap: 0.2, spatial: true, ref: 10, roll: 0.4, prio: 1, cls: 'sfx', desc: 'tower upgrade (stone grind + whoomp)' },
  obelisk_pulse: { bus: 'sfx', gain: -7, pitch: 0.7, vary: 1, max: 3, rate: 1, gap: 0.25, spatial: true, ref: 8, roll: 0.6, prio: 1, cls: 'sfx', desc: 'Hellfire Obelisk pulse (deep violet whoomp-hum)' },
  chain_throw: { bus: 'sfx', gain: -11, pitch: 1.5, vary: 1.5, max: 3, rate: 2, gap: 0.08, spatial: true, ref: 6, roll: 0.8, prio: 1, cls: 'sfx', desc: 'Chain Imp throw (chain rattle)' },
  chain_hook: { bus: 'sfx', gain: -10, pitch: 1.5, vary: 1.5, max: 3, rate: 2, gap: 0.08, spatial: true, ref: 6, roll: 0.8, prio: 1, cls: 'sfx', desc: 'Chain Imp hook (clank + goblin yelp)' },
  // skills
  orbit_loop: { bus: 'sfx', gain: -9, loop: true, prio: 1, cls: 'loop', desc: 'Ember Orbit hum (loop while the orbit is up)' },
  orbit_hit: { bus: 'sfx', gain: -12, pitch: 2, vary: 2, max: 3, rate: 2, gap: 0.06, spatial: true, ref: 5, roll: 1, prio: 1, cls: 'sfx', desc: 'Ember Orbit fireball hits a goblin' },
  meteor_whistle: { bus: 'sfx', gain: -12, pitch: 0.8, max: 2, spatial: true, ref: 18, roll: 0.3, prio: 1, cls: 'sfx', desc: 'Brimstone Rain: the meteor falls (whistle)' },
  meteor_impact: { bus: 'sfx', gain: -2, pitch: 0.8, vary: 1, max: 2, rate: 1, spatial: true, ref: 10, roll: 0.5, prio: 1, cls: 'sfx', desc: 'Brimstone Rain: the meteor lands' },
  trail_crackle: { bus: 'sfx', gain: -16, pitch: 2, vary: 2, max: 2, rate: 1, gap: 0.15, prio: 1, cls: 'sfx', desc: 'Cinder Trail crackle (behind the player)' },
  // elites and Dousers
  chief_horn: { bus: 'sfx', gain: -7, max: 1, gap: 1.5, spatial: true, ref: 25, roll: 0.3, prio: 1, cls: 'sfx', desc: 'Goblin Chieftain war horn (elite arrives)' },
  hexer_cackle: { bus: 'sfx', gain: -8, max: 1, gap: 1.0, spatial: true, ref: 12, roll: 0.5, prio: 1, cls: 'sfx', desc: 'Hexer cackle (elite arrives)' },
  hex_zap: { bus: 'sfx', gain: -7, pitch: 1, max: 2, rate: 1, gap: 0.2, spatial: true, ref: 8, roll: 0.6, prio: 1, cls: 'sfx', desc: 'Hexer hex (a sour magic zap)' },
  lance_sputter: { bus: 'sfx', gain: -8, max: 1, gap: 0.5, prio: 1, cls: 'sfx', desc: 'the Ember Lance sputters (hexed)' },
  douse_throw: { bus: 'sfx', gain: -9, pitch: 1.5, max: 3, rate: 2, gap: 0.1, spatial: true, ref: 6, roll: 0.8, prio: 1, cls: 'sfx', desc: 'Douser bucket throw' },
  douse_splash: { bus: 'sfx', gain: -5, pitch: 1.5, vary: 1, max: 3, rate: 2, gap: 0.1, spatial: true, ref: 8, roll: 0.6, prio: 1, cls: 'sfx', desc: 'Douser splash + steam hiss on fire' },
  // the camp
  amb_camp: { bus: 'amb', gain: -2, loop: true, prio: 0, cls: 'bed', desc: 'camp at dusk (birds, wind, distant crickets)' },
  horde_rise: { bus: 'sfx', gain: -9, max: 1, prio: 1, cls: 'sfx', desc: 'the horde\'s distant war cry as the night begins' },

  // ================================================================================================= THE ORGAN, BATS, PYRE BURST, THE ASH ROAR
  // the THUNDER ORGAN: ONE seamless firing loop while the trigger is held (one sound per gun); nothing per round
  organ_loop: { bus: 'sfx', gain: -3, loop: true, prio: 1, cls: 'loop', desc: 'THUNDER ORGAN firing loop (18 rounds/s, seamless; the only sound while firing)' },
  organ_overheat: { bus: 'sfx', gain: -6, max: 1, gap: 0.5, prio: 1, cls: 'sfx', desc: 'THUNDER ORGAN overheats (steam hiss + cooling pings; its own event only)' },
  // the Bat Gremlin (Night II on)
  bat_flap: { bus: 'sfx', gain: -10, loop: true, prio: 1, cls: 'loop', desc: 'Bat Gremlin wing flaps (a soft loop that follows the nearest bat)' },
  bat_screech: { bus: 'sfx', gain: -8, max: 2, rate: 1, gap: 0.25, spatial: true, ref: 8, roll: 0.6, prio: 1, cls: 'sfx', desc: 'Bat Gremlin dive screech (the telegraph)' },
  bat_crash: { bus: 'sfx', gain: -3, pitch: 1.5, max: 2, rate: 1, gap: 0.1, spatial: true, ref: 6, roll: 0.8, prio: 1, cls: 'sfx', desc: 'a burning Bat Gremlin crashes' },
  // Pyre Burst (a skill, not a gun: variants and jitter are fine); it can fire 24×/s, so ≤ 10 starts per second
  pyre_pop: { bus: 'sfx', gain: -7, pitch: 2, vary: 2, max: 3, rate: 1, gap: 0.09, spatial: true, ref: 6, roll: 0.8, prio: 1, cls: 'sfx', desc: 'Pyre Burst: a fire kill bursts (a short fiery pop)' },
  // the Ash Troll's Ash Roar
  ash_roar: { bus: 'sfx', gain: -6, max: 1, gap: 2, spatial: true, ref: 25, roll: 0.3, prio: 2, cls: 'sfx', desc: 'the Ash Roar: a deep roar and the hiss of smothered fire' },
  // the camp's BEGIN NIGHT button (the HUD: ew:ui 'begin')
  ui_begin: { bus: 'ui', gain: -8, max: 1, gap: 0.3, prio: 1, cls: 'sfx', desc: 'BEGIN NIGHT button: a soft click (procedural)' },

  // ================================================================================================= DESIGN §8
  // music: percussion layers over night/night2 by night number (synced to the loop's beat), the Rainmother, the ending
  mus_perc_a: { bus: 'music', gain: -4, loop: true, prio: 2, cls: 'music', desc: 'later nights: war-drum layer over the night loop (Nights III–X)' },
  mus_perc_b: { bus: 'music', gain: -5, loop: true, prio: 2, cls: 'music', desc: 'last nights: heavier battle percussion layer (Nights VI–X)' },
  mus_rain: { bus: 'music', gain: -1, loop: true, prio: 2, cls: 'music', desc: 'THE RAINMOTHER: storm theme (low choir, timpani, rain)' },
  mus_end_portal: { bus: 'music', gain: 0, prio: 2, cls: 'sting', desc: 'ending: a rising dark choir as the portal opens' },
  mus_end_reveal: { bus: 'music', gain: 1, prio: 2, cls: 'sting', desc: 'ending: the brutal swell at the reveal and the roar' },
  mus_end_hunt: { bus: 'music', gain: -1, prio: 2, cls: 'sting', desc: 'ending: the quiet, terrible coda under the hunt' },
  mus_end_credits: { bus: 'music', gain: -1, prio: 2, cls: 'sting', desc: 'credits: the camp motif, slowed and darkened (made from the camp music)' },
  vo_cinder_master: { bus: 'voice', gain: 0, max: 1, prio: 2, cls: 'voice', desc: 'Brother Cinder: "Welcome home, Master."' },
  // weather
  rain_bed: { bus: 'amb', gain: -1, loop: true, prio: 1, cls: 'bed', desc: 'rain bed (level = state.weather.rain)' },
  thunder: { bus: 'sfx', gain: 0, pitch: 1, vary: 2, max: 2, gap: 4, prio: 2, cls: 'sfx', desc: 'thunder (random while it rains hard; on lightning events)' },
  // the Siege Ram, the coven
  ram_drum: { bus: 'sfx', gain: -6, loop: true, prio: 2, cls: 'loop', desc: 'the Siege Ram\'s war drum (a loop that follows the nearest ram)' },
  ram_impact: { bus: 'sfx', gain: -1, pitch: 1, vary: 1, max: 2, rate: 1, gap: 0.6, spatial: true, ref: 12, roll: 0.4, prio: 2, cls: 'sfx', desc: 'the Siege Ram hits the gate' },
  coven_chant: { bus: 'sfx', gain: -8, loop: true, prio: 2, cls: 'loop', desc: 'the Hexer coven\'s chant (a loop while they chant)' },
  // the Rainmother
  tide_wave: { bus: 'sfx', gain: -2, max: 2, gap: 0.8, spatial: true, ref: 18, roll: 0.4, prio: 2, cls: 'sfx', desc: 'the Rainmother\'s tidal wave' },
  whirlpool: { bus: 'sfx', gain: -8, loop: true, prio: 2, cls: 'loop', desc: 'whirlpool (a loop while one is near)' },
  rain_step: { bus: 'sfx', gain: 0, pitch: 0.8, max: 2, gap: 0.3, spatial: true, ref: 20, roll: 0.35, prio: 2, cls: 'sfx', desc: 'the Rainmother\'s footstep (huge)' },
  rain_rise: { bus: 'sfx', gain: -2, max: 1, gap: 3, spatial: true, ref: 30, roll: 0.25, prio: 2, cls: 'sfx', desc: 'the Rainmother rises from the river' },
  lantern_shatter: { bus: 'sfx', gain: -5, pitch: 1.5, max: 2, rate: 1, gap: 0.15, spatial: true, ref: 16, roll: 0.4, prio: 2, cls: 'sfx', desc: 'a blue lantern in her crown is shot out' },
  rain_collapse: { bus: 'sfx', gain: -1, max: 1, gap: 5, spatial: true, ref: 30, roll: 0.25, prio: 2, cls: 'sfx', desc: 'the Rainmother collapses' },
  // the ending
  portal_rip: { bus: 'sfx', gain: 0, max: 1, gap: 3, prio: 2, cls: 'sfx', desc: 'ending: the portal tears open (cosmic rip + roar)' },
  hell_wind: { bus: 'amb', gain: 0, loop: true, prio: 2, cls: 'bed', desc: 'ending: the world changes (a burning wind bed)' },
  gate_open: { bus: 'sfx', gain: -2, max: 1, gap: 3, prio: 2, cls: 'sfx', desc: 'ending: the keep\'s gate opens from inside' },
  host_march: { bus: 'amb', gain: 0, loop: true, prio: 2, cls: 'bed', desc: 'ending: the host marches (a rumble of many feet)' },
  demon_roar: { bus: 'sfx', gain: -2, max: 1, gap: 2, prio: 2, cls: 'sfx', desc: 'ending: the roar (huge, inhuman, no words)' },
  gloves_ignite: { bus: 'sfx', gain: 0, max: 1, gap: 2, prio: 2, cls: 'sfx', desc: 'ending: the gloves ignite and burn away' },
  hunt_flee: { bus: 'sfx', gain: -6, max: 1, gap: 2, prio: 2, cls: 'sfx', desc: 'ending: the hunt (animals flee a burning forest, distant)' },

  // ============================================================================================== DESIGN §10.4
  gale_gust: { bus: 'sfx', gain: -9, max: 1, gap: 4, prio: 1, cls: 'sfx', desc: 'EMBER GALE: a hot gust sweeping from the keep down the slope (EV.GALE every 14 / 11 / 8 s)' },
};

/** Brother Cinder's lines: EV.NPC_LINE `line` id → { sound, text } (text verbatim from docs/STORY.md hint 4; the HUD subtitles it). */
export const VOICE_LINES = Object.freeze({
  home: { sound: 'vo_cinder_home', text: "You're home, Lamplighter. The lamp missed you." },
  hide: { sound: 'vo_cinder_hide', text: 'Coin for the hide? It wears thin on you. Always has.' },
  afraid: { sound: 'vo_cinder_afraid', text: "They climb because they're afraid. Afraid is good. Afraid is loud." },
  gloves: { sound: 'vo_cinder_gloves', text: "Don't mind the gloves. They smoke when you're cross." },
  eight: { sound: 'vo_cinder_eight', text: 'Eight more nights. Then we can all go out.' },
  eat: { sound: 'vo_cinder_eat', text: 'Odd. I never see you eat.' },
  fall: { sound: 'vo_cinder_fall', text: "You'll be back. You always are. That's rather the point of you." },
  master: { sound: 'vo_cinder_master', text: 'Welcome home, Master.' }, // the ending (STORY.md, Night X)
});

/** Bus levels (dB) under the master. */
export const BUS_DB = { music: -4, amb: -6, sfx: 0, ui: -2, voice: -3 };

/** Music crossfade times (seconds) by "from>to"; `default` otherwise. */
export const XFADE = { default: 2.5, 'night>kindle': 1.5, 'kindle>night': 4, 'night2>kindle': 1.5, 'kindle>night2': 4, '>troll': 2.0, '>dawn': 3, '>null': 2,
  '>camp': 3, 'camp>night': 2.5, 'camp>night2': 2.5, 'night>night2': 3, '>rain': 4, 'rain>null': 1.2 };
