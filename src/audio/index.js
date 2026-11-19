// @ts-check
// VALLEYWARD · the Web Audio engine (docs/DESIGN.md §14.3, docs/AUDIO.md).
//
//   createAudio({ assetsBase }) → { unlock(), onEvent(ev, state), update(dt, state, listener), music(name|null), pause(),
//     resume(), setVolume(v), dispose(),
//     // extras (additive): play(id, opts) → voice|null, ui(name), setFire(provider), stats(), ready() → Promise,
//     // say(line) → seconds (Brother Cinder; also on EV.NPC_LINE), lines (VOICE_LINES), get unlocked, _ctx, _out (bench) }
// DESIGN §9: music states camp ⇄ night | night2 ⇄ kindle ⇄ troll → dawn → (coming-soon sting) → camp; the camp
// bed at dusk; the Ember Orbit loop while state.orbit is non-empty; the Lance sputters while hexed; towers, elites,
// Dousers, drops, charms, the shop and the skills are rate-limited one-shots (bank.js).
//
// Graph: one-shot voices come from a fixed pool (source → gain → stereo pan → near/far split → bus); beds (night
// ambience, crowd far/near, fire low/mid/high, the Lance loop) are persistent channels whose gains follow the state;
// music is two-plus crossfading loop players (night ⇄ kindle beat-matched, → troll, → dawn) and stingers.
// buses: music → duck → low-pass · amb → duck · sfx (+ far: low-passed) · ui → master → limiter → destination.
// The AudioContext is created here at load (no first-key hitch) and only resumed by unlock() on the first gesture.
// Files: assets/audio/manifest.json (assets-src/audio/build.mjs); decoded in the background, 4 at a time, by priority;
// a sound asked for before it decoded jumps the queue (a one-shot that misses is dropped, a bed starts when it lands).
// Rate limits: per id, at most `rate` starts per 100 ms and `max` voices; the requests of one frame are collected and the
// loudest (after distance) win; 40 voices in all (the quietest-oldest is stolen). update() allocates nothing.

import { EV, ENEMY_KINDS } from '../shared/events.js';
import { ARENA } from '../shared/arena.js';
import { TIMELINE } from '../shared/timeline.js';
import { SOUNDS, BUS_DB, XFADE, VOICE_LINES } from './bank.js';

const dbToGain = (db) => Math.pow(10, db / 20);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const POOL = 40;
const REQ_MAX = 384;
const BEDS = ['amb_night', 'crowd_far', 'crowd_near', 'fire_low', 'fire_mid', 'fire_high', 'w_lance_loop', 'amb_camp', 'orbit_loop', 'organ_loop', 'bat_flap',
  'rain_bed', 'ram_drum', 'coven_chant', 'whirlpool', 'hell_wind', 'host_march'];
// DESIGN §8: the percussion layers by night [perc_a, perc_b] over the night / night2 loop, synced to its beat
const LAYERS = ['mus_perc_a', 'mus_perc_b'];
const LAYER_BY_NIGHT = [[0, 0], [0, 0], [0, 0], [0.6, 0], [0.7, 0], [0.85, 0], [0.6, 0.6], [0.7, 0.7], [0.85, 0.85], [1, 1], [1, 1]];
/** the ending's beats (TIMELINE.ending ids or 'ending.beat' {id}) → audio cues, by keyword, first match wins */
const ENDING_CUES = [[/roar/, 'roar'], [/glove|hand|claw/, 'gloves'], [/cinder|kneel|master|welcome/, 'cinder'], [/credit/, 'credits'], [/hunt|village|chase/, 'hunt'],
  [/black|cut/, 'black'], [/reveal|pull|camera|demon|turn/, 'reveal'], [/gate|host|march/, 'host'], [/world|change|ash|ember|lava|burn/, 'world'],
  [/lamp|pillar/, 'lamp'], [/portal|tear|sky|open/, 'portal'], [/flood|fall|collapse|silence|steam|still/, 'flood']];
/** Event names for the Organ, bats, Pyre Burst, the Ash Roar (the sim's, plus a few aliases): docs/AUDIO.md */
const V3 = {
  organOn: ['organ.fire', 'organ.on'], organOff: ['organ.stop', 'organ.off'], overheat: ['organ.overheat'], organEquip: ['organ.equip'],
  batScreech: ['air.screech', 'bat.dive'], batCrash: ['air.crash', 'bat.crash'], batDeath: ['air.death'], batIgnite: ['air.ignite'], batHit: ['air.hit'],
  pyre: ['pyre.burst'], ashRoar: ['troll.roar', 'troll.ashroar'],
};
const V3_OF = new Map(); for (const [k, list] of Object.entries(V3)) for (const t of list) V3_OF.set(t, k);
/** the THUNDER ORGAN's weapon id (whatever the sim names it) */
const isOrgan = (w) => typeof w === 'string' && /organ|mini|gatling|thunder/i.test(w);
const ORGAN_RPS = 18;      // DESIGN §4.2: the loop's rounds per second
const ORGAN_HOLD = 0.085;  // the loop runs this long after the last round (rounds come every 55 ms), then fades
const ORGAN_FADE = 0.025;  // setTarget τ: ≈ −40 dB in 115 ms (≤ 120 ms, no tail sample)
/** a pentatonic ladder (semitones) for rapid pickups: coins and XP climb it within LADDER_WINDOW s */
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const LADDER_WINDOW = 0.55;
const KINDLE_SECONDS = 40; // DESIGN §7: spawns ×1.6 for 40 s

/** A silent stand-in (no Web Audio, e.g. Node tests): the same shape, nothing plays. */
function stub() {
  const noop = () => {};
  return {
    unlock: noop, onEvent: noop, update: noop, music: noop, pause: noop, resume: noop, setVolume: noop, dispose: noop,
    play: () => null, ui: noop, setFire: noop, stats: () => ({ stub: true }), ready: () => Promise.resolve(), get unlocked() { return false; },
    say: () => 0, lineSeconds: () => 0, lines: VOICE_LINES,
  };
}

/**
 * @param {{ assetsBase?: string }} [opts]
 */
/** false when the build has no audio files (tools/vite-audio.mjs defines it; outside Vite it is undefined: try to load) */
const HAS_FILES = typeof __VW_AUDIO__ === 'undefined' ? true : !!__VW_AUDIO__;

export function createAudio({ assetsBase = './assets/' } = {}) {
  const AC = globalThis.AudioContext || /** @type {any} */ (globalThis).webkitAudioContext;
  if (!AC) return stub();
  /** @type {AudioContext} */
  let ctx;
  try { ctx = new AC({ latencyHint: 'interactive' }); } catch { try { ctx = new AC(); } catch { return stub(); } }

  const base = String(assetsBase).replace(/\/?$/, '/') + 'audio/';
  const query = new URLSearchParams(globalThis.location?.search || '');
  const muted = query.get('mute') === '1';
  let volume = 1, disposed = false, unlocked = false, suspended = false;
  const rand = mulberry(Number(query.get('seed')) || 1213);

  // ------------------------------------------------------------------------------------------------ graph
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 2; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.15;
  limiter.connect(ctx.destination);
  const master = ctx.createGain(); master.gain.value = muted ? 0 : volume; master.connect(limiter);
  /** @type {Record<string, GainNode>} */
  const bus = {};
  for (const name of ['music', 'amb', 'sfx', 'ui', 'voice']) { const g = ctx.createGain(); g.gain.value = dbToGain(BUS_DB[name] ?? 0); bus[name] = g; }
  const musicDuck = ctx.createGain();
  const musicLP = ctx.createBiquadFilter(); musicLP.type = 'lowpass'; musicLP.frequency.value = 20000; musicLP.Q.value = 0.5;
  bus.music.connect(musicDuck).connect(musicLP).connect(master);
  const ambDuck = ctx.createGain();
  // the beds (crowd, fire, night) dip for a moment under each gunshot so the shot stays clear in a busy night
  const shotDuck = ctx.createGain(); bus.amb.connect(ambDuck).connect(shotDuck).connect(master);
  function shotDip(db, hold) {
    const t = ctx.currentTime; const gp = shotDuck.gain;
    gp.cancelScheduledValues(t); gp.setValueAtTime(gp.value, t); gp.setTargetAtTime(dbToGain(db), t, 0.004); gp.setTargetAtTime(1, t + hold, 0.12);
  }
  const stingBus = ctx.createGain(); stingBus.gain.value = dbToGain(BUS_DB.music ?? 0); stingBus.connect(master); // stingers ride over the duck
  bus.sfx.connect(master); bus.ui.connect(master); bus.voice.connect(master);
  // far sounds: a darker, slightly quieter copy of the sfx bus
  const farLP = ctx.createBiquadFilter(); farLP.type = 'lowpass'; farLP.frequency.value = 2600; farLP.Q.value = 0.4;
  const far = ctx.createGain(); far.gain.value = 0.85; far.connect(farLP).connect(bus.sfx);
  // a short outdoor space (the keep's wall slap + the valley): one convolver fed by small sends; far sounds get more
  const verb = ctx.createConvolver();
  try { verb.buffer = makeHillIR(ctx); } catch { /* the mix stays dry */ }
  const verbOut = ctx.createGain(); verbOut.gain.value = 0.9; verb.connect(verbOut).connect(master);
  const sendNear = ctx.createGain(); sendNear.gain.value = 0.1; bus.sfx.connect(sendNear).connect(verb);
  const sendFar = ctx.createGain(); sendFar.gain.value = 0.35; farLP.connect(sendFar).connect(verb);

  // ------------------------------------------------------------------------------------------------ loading
  /** @type {Map<string, { buffer: AudioBuffer, loopStart?: number, loopEnd?: number, bpm?: number, beat0?: number }[]>} */
  const buffers = new Map();
  /** @type {any} */
  let manifest = null;
  /** @type {{ id: string, k: number, f: any, prio: number, done: boolean, rank: number }[]} */
  let queue = [];
  let loaded = 0, failed = 0, total = 0;
  // nothing but the manifest loads before the game is ready. The background queue starts at the
  // first of: the game reports ready (window.__ew.bootMs, set right after progress 1), the title click (unlock()), the
  // game leaving 'title' (?night= / ?camp= / ?ending=), or a caller of ready(). It then runs 4 at a time,
  // ordered by the start mode (startOrder). Before that, a sound asked for still loads at once (up to 2 on-demand
  // workers), so nothing is ever silent for want of a start. A failed fetch or decode is never retried.
  let bgStarted = false, activeWorkers = 0, startMode = '', manifestReady = false, inFlight = 0, maxInFlight = 0;
  /** @type {string[]} */ const fetchLog = []; // the order files were requested (tests and the bench)
  let resolveAll = () => {}; const allDone = new Promise((r) => { resolveAll = r; });
  const checkAll = () => { if (manifestReady && loaded + failed >= total) resolveAll(); };
  async function loadOne(j) {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); if (fetchLog.length < 400) fetchLog.push(j.id);
    try {
      const res = await fetch(base + j.f.file + (j.f.h ? '?v=' + j.f.h : '')); // content-hashed: never a stale cached file
      if (!res.ok) throw new Error(String(res.status));
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      const list = buffers.get(j.id) || []; list[j.k] = { buffer, loopStart: j.f.loopStart, loopEnd: j.f.loopEnd, bpm: j.f.bpm, beat0: j.f.beat0 };
      buffers.set(j.id, list); loaded++;
      if (pendingMusic && 'mus_' + pendingMusic === j.id) { const n = pendingMusic; pendingMusic = null; musicName = null; music(n); }
    } catch (e) { failed++; failedIds.add(j.id); console.warn('[audio] failed', j.f?.file, /** @type {any} */ (e)?.message || e); } // done stays true: never retried
    finally { inFlight--; checkAll(); }
  }
  const failedIds = new Set();
  /** the next file: one asked for (prio < 0) first; else, once the background runs, the queue in start order */
  function pickNext() { let first = null; for (const q of queue) { if (q.done) continue; if (q.prio < 0) return q; if (!first && bgStarted) first = q; } return first; }
  async function worker() {
    activeWorkers++;
    try { for (;;) { if (disposed) return; const j = pickNext(); if (!j) return; j.done = true; await loadOne(j); } }
    finally { activeWorkers--; }
  }
  function kick() { const cap = bgStarted ? 4 : 2; while (activeWorkers < cap) { const before = activeWorkers; worker(); if (activeWorkers === before) break; if (!pickNext()) break; } }
  /** the load order by how the game starts (fresh save → Night I; a save → the camp; ?night= / ?ending= → that) */
  const GROUP_OF = [
    ['ending', /^(mus_end_|portal_rip|hell_wind|gate_open|host_march|demon_roar|gloves_ignite|hunt_flee|vo_cinder_master)/],
    ['nightX', /^(mus_rain|tide_wave|whirlpool|rain_step|rain_rise|rain_collapse|lantern_shatter)/],
    ['late', /^(mus_perc_|rain_bed|thunder|ram_|coven_)/],
    ['night2', /^(mus_night2|bat_|hex_zap|hexer_|douse_|lance_sputter|obelisk_|chain_|orbit_|meteor_|trail_|organ_|pyre_|ash_roar|gale_)/],
    ['camp', /^(mus_camp|amb_camp|npc_open|vo_cinder_|shop_buy|charm_equip|tower_|ui_begin|mus_soon)/],
    ['night1b', /^(mus_kindle|mus_troll|troll_|boulder_|sunburst|mus_dawn|mus_fallen|w_blunder|chief_horn|charm_found|coin_spill|horde_flee)/],
    ['core', /^(ui_click|card_|levelup|w_kestrel|w_dry|w_switch|step_|p_hurt|xp_|coin_tick|gold$|heart)/],
  ];
  const groupOf = (id) => { for (const [g, re] of GROUP_OF) if (re.test(id)) return g; return 'night'; }; // the rest: Night I's beds and the horde
  const ORDERS = {
    fresh: ['core', 'night', 'night1b', 'camp', 'night2', 'late', 'nightX', 'ending'],
    camp: ['core', 'camp', 'night', 'night1b', 'night2', 'late', 'nightX', 'ending'],
    night2: ['core', 'night', 'night2', 'night1b', 'camp', 'late', 'nightX', 'ending'],
    late: ['core', 'night', 'night2', 'late', 'night1b', 'camp', 'nightX', 'ending'],
    nightX: ['core', 'night', 'nightX', 'late', 'night2', 'night1b', 'camp', 'ending'],
    ending: ['core', 'ending', 'camp', 'night', 'night1b', 'night2', 'late', 'nightX'],
  };
  /** how the game starts: the URL's shortcuts, else the state (a first launch, the sim's own rule in run.js isFirstLaunch) */
  function decideStart() {
    const qs = query; const st = lastState;
    const n = Number(qs.get('night')) || (st?.night?.n ?? 0);
    if (qs.get('ending') === '1' || st?.mode === 'ending') return 'ending';
    if (qs.get('camp') === '1' || st?.mode === 'camp') return 'camp';
    if (qs.has('night') || (st && st.mode !== 'title' && n)) return n >= 10 ? 'nightX' : n >= 3 ? 'late' : n === 2 ? 'night2' : 'fresh';
    const m = st ? (st.meta || st.save) : null;
    const first = !m || (m.runN === 0 && m.nightsCompleted === 0 && m.gold === 0 && !m.run);
    return first ? 'fresh' : 'camp';
  }
  function startBackground(why) {
    if (bgStarted || disposed) return;
    bgStarted = true; startMode = decideStart(); startWhy = why;
    const order = ORDERS[startMode] || ORDERS.fresh;
    for (const q of queue) { const g = order.indexOf(groupOf(q.id)); q.rank = (g < 0 ? order.length : g) * 10 + (SOUNDS[q.id]?.prio ?? 2); }
    queue.sort((a, b) => (a.prio < 0 ? -1 : 0) - (b.prio < 0 ? -1 : 0) || a.rank - b.rank); // asked-for first, then the start order (stable)
    if (manifestReady) kick();
  }
  let startWhy = '';
  const loadDone = (async () => {
    if (!HAS_FILES) { manifest = { sounds: {} }; manifestReady = true; resolveAll(); console.info('[audio] this build has no audio files: silent'); return; }
    try {
      const r = await fetch(base + 'manifest.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(`manifest.json ${r.status}`);
      manifest = await r.json();
    } catch (e) { manifest = { sounds: {} }; manifestReady = true; resolveAll(); console.warn('[audio] no manifest; silent', /** @type {any} */ (e)?.message || e); return; }
    for (const [id, s] of Object.entries(manifest.sounds || {})) {
      const def = SOUNDS[id]; if (!def || !Array.isArray(s.files)) continue;
      s.files.forEach((f, k) => { if (f) queue.push({ id, k, f, prio: def.prio ?? 2, done: false, rank: 0 }); });
    }
    total = queue.length; manifestReady = true;
    if (bgStarted) { bgStarted = false; startBackground(startWhy); } else if (queue.some((q) => q.prio < 0)) kick();
    for (const id of asked) markAsked(id); asked.clear();
    checkAll();
    await allDone;
  })();
  /** a sound asked for before the manifest arrived (marked when it lands) */
  const asked = new Set();
  function markAsked(id) { let hit = false; for (const q of queue) if (q.id === id && !q.done && q.prio > -1) { q.prio = -1; hit = true; } if (hit) kick(); }
  /** variants of an id (dense), or an empty list; asking for a missing one loads it now (front of the queue, a worker) */
  const EMPTY = /** @type {any[]} */ ([]);
  function variants(id) {
    const l = buffers.get(id);
    if (l) return l;
    if (failedIds.has(id)) return EMPTY;                 // failed once: never retried (no per-frame refetch)
    if (!manifestReady) { asked.add(id); return EMPTY; }
    markAsked(id);
    return EMPTY;
  }

  // ------------------------------------------------------------------------------------------------ the listener
  const lis = { x: ARENA.playerSpawn.x, y: 1.7, z: ARENA.playerSpawn.z, yaw: ARENA.playerSpawn.yaw, rx: 0, rz: 1 };
  function setListener(x, y, z, yaw) { lis.x = x; lis.y = y; lis.z = z; lis.yaw = yaw; lis.rx = -Math.cos(yaw); lis.rz = Math.sin(yaw); }
  setListener(lis.x, lis.y, lis.z, lis.yaw);
  /** out: [gain multiplier, pan −1..1, far 0..1, distance] for a source at (x, z); arena yaw convention: forward = (sin, cos) */
  const sp = new Float32Array(4);
  function spatial(def, x, z) {
    const dx = x - lis.x, dz = z - lis.z; const d = Math.sqrt(dx * dx + dz * dz);
    const ref = def.ref ?? 5, roll = def.roll ?? 1;
    sp[0] = d <= ref ? 1 : ref / (ref + roll * (d - ref));
    sp[1] = d < 0.5 ? 0 : clamp((dx * lis.rx + dz * lis.rz) / d, -1, 1) * 0.8 * smooth(0.5, 3, d);
    sp[2] = smooth(14, 50, d);
    sp[3] = d;
    return sp;
  }

  // ------------------------------------------------------------------------------------------------ the voice pool
  /** @typedef {{ i: number, gain: GainNode, pan: StereoPannerNode, gN: GainNode, gF: GainNode, busName: string,
   *   src: AudioBufferSourceNode|null, id: string, t0: number, end: number, loud: number, active: boolean }} Slot */
  /** @type {Slot[]} */
  const slots = [];
  for (let i = 0; i < POOL; i++) {
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    const gN = ctx.createGain(), gF = ctx.createGain(); gF.gain.value = 0;
    gain.connect(pan); pan.connect(gN); pan.connect(gF); gN.connect(bus.sfx); gF.connect(far);
    slots.push({ i, gain, pan, gN, gF, busName: 'sfx', src: null, id: '', t0: -1, end: -1, loud: -200, active: false });
  }
  /** per id: recent start times (ring of `rate`), last start, live voice count */
  /** @type {Map<string, { ring: Float64Array, ri: number, last: number, plays: number, drops: number }>} */
  const idState = new Map();
  for (const id of Object.keys(SOUNDS)) idState.set(id, { ring: new Float64Array(Math.max(1, SOUNDS[id].rate || 8)).fill(-1), ri: 0, last: -1, plays: 0, drops: 0 });
  const lastVariant = new Map();
  let voicesPlayed = 0, voicesDropped = 0, stolen = 0;

  function stopSlot(s, fade = 0.03) {
    if (!s.active) return;
    const t = ctx.currentTime;
    try { s.gain.gain.cancelScheduledValues(t); s.gain.gain.setValueAtTime(s.gain.gain.value, t); s.gain.gain.linearRampToValueAtTime(0, t + fade); s.src?.stop(t + fade + 0.005); } catch { /* */ }
    s.active = false; s.end = Math.min(s.end, t + fade + 0.005);
  }
  /** a free slot, or the quietest-oldest busy one if the new sound is louder than it (it is faded out in 6 ms) */
  function grabSlot(now, loud) {
    let victim = null, vScore = Infinity;
    for (const s of slots) {
      if (!s.active && now >= s.end) return s;
      if (!s.active) continue; // fading out
      if (now > s.end + 0.02) { s.active = false; return s; }
      const score = s.loud - (now - s.t0) * 6;
      if (score < vScore) { vScore = score; victim = s; }
    }
    if (victim && vScore < loud) { stolen++; return victim; }
    return null;
  }

  /**
   * Play an id now (no rate limiting; onEvent goes through want()). opts: { x, z (a position → panned and attenuated),
   * db, rate, delay, variant, offset }. @returns {Slot|null}
   */
  function play(id, o = /** @type {any} */ ({})) {
    if (disposed) return null;
    const def = SOUNDS[id]; if (!def) return null;
    const list = variants(id); if (!list.length) return null;
    if (ctx.state !== 'running' && !o.force) return null; // a frozen clock would pile one-shots up
    const now = ctx.currentTime;
    let db = def.gain + (def.vary ? (rand() * 2 - 1) * def.vary : 0) + (o.db ?? 0);
    let pan = o.pan ?? 0, farMix = 0;
    if (def.spatial && o.x != null) { const r = spatial(def, o.x, o.z); db += 20 * Math.log10(Math.max(1e-4, r[0])); pan = r[1]; farMix = r[2]; }
    if (db < -70) return null;
    // the id's own voice cap: steal its oldest
    if (def.max) {
      let n = 0, oldest = null;
      for (const s of slots) if (s.active && s.id === id && now <= s.end) { n++; if (!oldest || s.t0 < oldest.t0) oldest = s; }
      if (n >= def.max && oldest) { stopSlot(oldest, 0.03); stolen++; }
    }
    const s = grabSlot(now, db); if (!s) { voicesDropped++; return null; }
    let k = o.variant ?? Math.floor(rand() * list.length);
    if (o.variant == null && list.length > 1 && k === lastVariant.get(id)) k = (k + 1 + Math.floor(rand() * (list.length - 1))) % list.length;
    k = clamp(k, 0, list.length - 1); lastVariant.set(id, k);
    const entry = list[k] || list.find(Boolean); if (!entry) return null; // a variant still decoding: any loaded one
    const src = ctx.createBufferSource(); src.buffer = entry.buffer;
    const semis = def.pitch ? (rand() * 2 - 1) * def.pitch : 0;
    src.playbackRate.value = Math.pow(2, semis / 12) * (o.rate ?? 1);
    const g = dbToGain(db);
    let t0 = now + Math.max(0, o.delay ?? 0);
    const gp = s.gain.gain;
    gp.cancelScheduledValues(now); s.pan.pan.cancelScheduledValues(now); s.gN.gain.cancelScheduledValues(now); s.gF.gain.cancelScheduledValues(now);
    if (s.src && now < s.end + 0.01) { // still sounding (stolen or fading): a 6 ms fade, then the new sound
      gp.setValueAtTime(gp.value, now); gp.linearRampToValueAtTime(0, now + 0.006);
      try { s.src.stop(now + 0.006); } catch { /* */ }
      t0 = Math.max(t0, now + 0.007);
    }
    gp.setValueAtTime(g, t0);
    s.pan.pan.setValueAtTime(pan, t0);
    const busName = def.bus;
    if (s.busName !== busName) { s.gN.disconnect(); s.gN.connect(bus[busName] || bus.sfx); s.busName = busName; }
    s.gN.gain.setValueAtTime(busName === 'sfx' ? 1 - farMix : 1, t0); s.gF.gain.setValueAtTime(busName === 'sfx' ? farMix : 0, t0);
    src.connect(s.gain);
    const off = Math.min(o.offset ?? 0, entry.buffer.duration - 0.01);
    try { src.start(t0, off); } catch { return null; }
    s.src = src; s.id = id; s.t0 = t0; s.end = t0 + (entry.buffer.duration - off) / src.playbackRate.value; s.loud = db; s.active = true;
    src.onended = () => { try { src.disconnect(); } catch { /* */ } if (s.src === src) { s.src = null; s.active = false; } };
    voicesPlayed++;
    return s;
  }

  // requests of one frame: collected by want(), flushed (loudest first, per-id rate) after the event loop of the frame
  /** @type {{ id: string, def: any, x: number, z: number, hasPos: boolean, db: number, rate: number, delay: number, variant: number, loud: number, done: boolean }[]} */
  const reqs = [];
  for (let i = 0; i < REQ_MAX; i++) reqs.push({ id: '', def: null, x: 0, z: 0, hasPos: false, db: 0, rate: 1, delay: 0, variant: -1, loud: 0, done: true });
  let nReq = 0, flushQueued = false;
  const flushOpts = { x: /** @type {number|undefined} */ (undefined), z: 0, db: 0, rate: 1, delay: 0, variant: /** @type {number|undefined} */ (undefined) };
  /**
   * Ask for a sound (rate-limited). pos: {x, z} or null; db; rate (playback); delay; variant (−1 = random).
   */
  function want(id, pos, db = 0, rate = 1, delay = 0, variant = -1) {
    const def = SOUNDS[id]; if (!def || disposed) return;
    if (ctx.state !== 'running') return;
    const st = idState.get(id);
    if (def.gap && st && ctx.currentTime - st.last < def.gap) { st.drops++; voicesDropped++; return; }
    if (nReq >= REQ_MAX) { voicesDropped++; return; }
    const r = reqs[nReq++];
    r.id = id; r.def = def; r.hasPos = !!(pos && def.spatial); r.x = pos ? pos.x : 0; r.z = pos ? pos.z : 0; r.db = db; r.rate = rate; r.delay = delay; r.variant = variant; r.done = false;
    r.loud = def.gain + db + (r.hasPos ? 20 * Math.log10(Math.max(1e-4, spatial(def, r.x, r.z)[0])) : 0);
    if (!flushQueued) { flushQueued = true; queueMicrotask(flush); }
  }
  function flush() {
    flushQueued = false;
    const now = ctx.currentTime;
    for (let i = 0; i < nReq; i++) {
      const r = reqs[i]; if (r.done) continue;
      const st = idState.get(r.id); const def = r.def;
      // how many starts this id may still make in the 100 ms window
      let allowed = 99;
      if (def.rate && st) { allowed = 0; for (let j = 0; j < st.ring.length; j++) if (now - st.ring[j] >= 0.1) allowed++; }
      if (def.gap) allowed = Math.min(allowed, st && now - st.last < def.gap ? 0 : 1);
      while (allowed > 0) {
        let best = -1, bl = -Infinity;
        for (let j = i; j < nReq; j++) { const q = reqs[j]; if (!q.done && q.id === r.id && q.loud > bl) { bl = q.loud; best = j; } }
        if (best < 0) break;
        const q = reqs[best]; q.done = true; allowed--;
        flushOpts.x = q.hasPos ? q.x : undefined; flushOpts.z = q.z; flushOpts.db = q.db; flushOpts.rate = q.rate; flushOpts.delay = q.delay; flushOpts.variant = q.variant >= 0 ? q.variant : undefined;
        const s = play(q.id, flushOpts);
        if (s && st) { st.ring[st.ri] = now; st.ri = (st.ri + 1) % st.ring.length; st.last = now; st.plays++; }
      }
      for (let j = i; j < nReq; j++) { const q = reqs[j]; if (!q.done && q.id === r.id) { q.done = true; if (st) st.drops++; voicesDropped++; } }
    }
    nReq = 0;
  }

  // ------------------------------------------------------------------------------------------------ beds
  /** @type {Record<string, { gain: GainNode, pan: StereoPannerNode, src: AudioBufferSourceNode|null, target: number, panT: number }>} */
  const beds = {};
  for (const id of BEDS) {
    const def = SOUNDS[id];
    const gain = ctx.createGain(); gain.gain.value = 0; const pan = ctx.createStereoPanner();
    gain.connect(pan).connect(bus[def.bus] || bus.amb);
    beds[id] = { gain, pan, src: null, target: 0, panT: 0 };
  }
  function bedStart(id) {
    const b = beds[id]; if (b.src || disposed) return;
    const l = buffers.get(id); if (!l || !l[0]) { variants(id); return; }
    const e = l[0]; const src = ctx.createBufferSource(); src.buffer = e.buffer; src.loop = true;
    if (e.loopEnd) { src.loopStart = e.loopStart || 0; src.loopEnd = Math.min(e.loopEnd, e.buffer.duration); }
    src.connect(b.gain); src.start(ctx.currentTime, rand() * (e.loopEnd || e.buffer.duration) * 0.9); b.src = src;
  }
  /** set a bed's level (0..1 of its bank gain) and pan, smoothed */
  function bed(id, level, panV = 0, tau = 0.35, panTau = 0.25) {
    const b = beds[id]; if (!b) return;
    if (level > 0.001 && !b.src) bedStart(id);
    const g = level <= 0.001 ? 0 : dbToGain(SOUNDS[id].gain) * level;
    const t = ctx.currentTime;
    if (Math.abs(g - b.target) > 0.002) { b.gain.gain.setTargetAtTime(g, t, tau); b.target = g; }
    if (Math.abs(panV - b.panT) > 0.02) { b.pan.pan.setTargetAtTime(panV, t, panTau); b.panT = panV; }
  }

  // ------------------------------------------------------------------------------------------------ music
  /** @type {string|null} */ let musicName = null;
  /** @type {string|null} */ let pendingMusic = null;
  /** @type {{ name: string, gain: GainNode, src: AudioBufferSourceNode, startAt: number, entry: any, offset: number }|null} */
  let cur = null;
  /** @type {string|null|undefined} */ let musicOverride = undefined; // a manual music() call holds until the next mode change
  /**
   * Crossfade to a music state. Loops (night, kindle, troll) loop seamlessly; night ⇄ kindle (same 92 BPM grid) start the
   * new loop on the old one's beat phase. dawn is a one-shot. A state whose file is not decoded yet starts when it lands.
   * @param {string|null} name @param {number} [xf]
   */
  function music(name, xf) {
    if (disposed) return;
    name = name || null;
    if (name === musicName) return;
    const key = `${musicName || ''}>${name || 'null'}`;
    const fade = xf ?? XFADE[key] ?? (name ? XFADE['>' + name] ?? XFADE.default : XFADE['>null']);
    musicName = name;
    const t = ctx.currentTime;
    const old = cur; cur = null;
    if (old) {
      try { old.gain.gain.cancelScheduledValues(t); old.gain.gain.setValueAtTime(old.gain.gain.value, t); old.gain.gain.linearRampToValueAtTime(0, t + fade); old.src.stop(t + fade + 0.05); } catch { /* */ }
      old.src.onended = () => { try { old.src.disconnect(); old.gain.disconnect(); } catch { /* */ } };
    }
    pendingMusic = null;
    if (!name) return;
    const list = variants('mus_' + name);
    if (!list.length) { pendingMusic = name; return; }
    const def = SOUNDS['mus_' + name]; const e = list[0];
    const g = ctx.createGain(); g.connect(bus.music);
    const src = ctx.createBufferSource(); src.buffer = e.buffer; src.connect(g);
    let offset = 0;
    if (def.loop) {
      src.loop = true; if (e.loopEnd) { src.loopStart = e.loopStart || 0; src.loopEnd = Math.min(e.loopEnd, e.buffer.duration); }
      // beat-match against the outgoing loop when both carry a grid at the same tempo
      if (old && old.entry.bpm && e.bpm && Math.abs(old.entry.bpm - e.bpm) / e.bpm < 0.02 && def.loop) {
        const L0 = old.entry.loopEnd || old.entry.buffer.duration;
        const pos = ((t + 0.05 - old.startAt) + old.offset) % L0;
        const P0 = 60 / old.entry.bpm, P1 = 60 / e.bpm;
        const phase = (((pos - (old.entry.beat0 || 0)) / P0) % 1 + 1) % 1;
        offset = (e.beat0 || 0) + phase * P1;
      }
    }
    const inT = old ? fade : Math.min(fade, 2.5);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(dbToGain(def.gain), t + inT);
    try { src.start(t + 0.05, offset); } catch { return; }
    cur = { name, gain: g, src, startAt: t + 0.05, entry: e, offset };
    if (!def.loop) src.onended = () => { if (cur && cur.src === src) { cur = null; musicName = null; } };
  }
  /** a stinger over the music (the music ducks under it) */
  function sting(id, duckDb = -6, rate = 1) {
    const l = variants(id); if (!l.length || ctx.state !== 'running') return;
    const e = l[0]; const src = ctx.createBufferSource(); src.buffer = e.buffer; src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = dbToGain(SOUNDS[id].gain); src.connect(g).connect(stingBus);
    src.start(); src.onended = () => { try { src.disconnect(); g.disconnect(); } catch { /* */ } };
    duck(e.buffer.duration / rate * 0.8, duckDb);
    stingsPlayed++;
  }
  let stingsPlayed = 0;
  function duck(seconds, db = -6) {
    const t = ctx.currentTime;
    musicDuck.gain.cancelScheduledValues(t); musicDuck.gain.setValueAtTime(musicDuck.gain.value, t);
    musicDuck.gain.setTargetAtTime(dbToGain(db), t, 0.08); musicDuck.gain.setTargetAtTime(1, t + seconds, 0.6);
  }
  function setMusicFilter(hz, seconds = 0.5) {
    const t = ctx.currentTime;
    musicLP.frequency.cancelScheduledValues(t); musicLP.frequency.setValueAtTime(musicLP.frequency.value, t);
    musicLP.frequency.exponentialRampToValueAtTime(Math.max(80, hz), t + seconds);
  }

  // ------------------------------------------------------------------------------------------------ the sim
  let mode = /** @type {string|null} */ (null);
  let modeClock = 0, lastBeatT = -1, simT = 0;
  let kindleUntil = -1;
  let trollArriveT = -1, trollRoared = false;
  let introCardDone = false;
  let gateStep = 0; // splinter thresholds crossed (0.75, 0.5, 0.25)
  let xpLadder = 0, xpLast = -1;
  let windT = 6 + rand() * 6;
  let hordeT = 0, fireT = 0;
  let crowdNear = 0, crowdFar = 0, crowdPan = 0, fireI = 0, firePan = 0;
  let lanceOn = false;
  let lastShotT = -10; // the last SHOT (a troll hit sounds only right after one)
  let hbHealT = -10, galeT0 = -100, galeLen = 2.5, galeK = 1; // Hearthblood's heal tick, the Ember Gale's flare
  // the Organ, bats, Pyre Burst, the Ash Roar
  let organUntil = -1, organOnEv = false, organRate = 1, organLevel = 0, organStarts = 0;
  let batNear = 0, batPan = 0, batN = 0;
  // DESIGN §8
  const whirlPos = { x: 0, z: 0 }; let whirlUntil = -1;
  let rainBoss = false, covenOn = false, endWind = 0, endHost = 0, thunderT = 9, layerChk = 0, rainLvl = 0, ramNear = 0, ramPan = 0, whirlNear = 0, whirlPan = 0, scanT = 0;
  const endDone = new Set();
  /** @type {{ src: AudioBufferSourceNode, g: GainNode }|null} */ let endCue = null;
  /** an ending cue: a one-shot over the music bus that fades the previous cue out */
  function cue(id, fadePrev = 0.8) {
    const l = variants(id); if (!l.length || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    if (endCue) { const o = endCue; try { o.g.gain.cancelScheduledValues(t); o.g.gain.setValueAtTime(o.g.gain.value, t); o.g.gain.linearRampToValueAtTime(0, t + fadePrev); o.src.stop(t + fadePrev + 0.05); } catch { /* */ } }
    const src = ctx.createBufferSource(); src.buffer = l[0].buffer; const g = ctx.createGain(); g.gain.value = dbToGain(SOUNDS[id].gain);
    src.connect(g).connect(stingBus); src.start(t + 0.02); endCue = { src, g }; stingsPlayed++;
    src.onended = () => { try { src.disconnect(); g.disconnect(); } catch { /* */ } if (endCue && endCue.src === src) endCue = null; };
  }
  function endCueStop(fade = 1.5) { if (!endCue) return; const o = endCue, t = ctx.currentTime; endCue = null; try { o.g.gain.cancelScheduledValues(t); o.g.gain.setValueAtTime(o.g.gain.value, t); o.g.gain.linearRampToValueAtTime(0, t + fade); o.src.stop(t + fade + 0.05); } catch { /* */ } }
  /** the ending (DESIGN §12), one cue per kind of beat */
  function endingBeat(id) {
    const key = String(id ?? '').toLowerCase(); let k = null; for (const [re, name] of ENDING_CUES) if (re.test(key)) { k = name; break; }
    if (!k || endDone.has(k)) return; endDone.add(k);
    switch (k) {
      case 'flood': want('rain_collapse', null, -3); want('fire_out', null, -4, 0.8, 1.5); break; // the Rainmother falls (deduped with her death event); then silence and steam
      case 'lamp': cue('mus_end_portal'); want('beacon_kindle', BASKET, 2); break;          // TIMELINE 5 s: the pillar of fire; the dark choir starts rising
      case 'portal': want('portal_rip', null); if (!endDone.has('lamp')) { endDone.add('lamp'); cue('mus_end_portal'); } break; // 8 s: the sky tears open
      case 'world': endWind = 1; break;                                                        // the burning wind
      case 'host': want('gate_open', null); endHost = 1; break;                               // the gate from inside, then the march
      case 'gloves': want('gloves_ignite', null); break;
      case 'reveal': cue('mus_end_reveal', 0.4); break;                                       // the brutal swell
      case 'roar': if (!endDone.has('reveal')) { endDone.add('reveal'); cue('mus_end_reveal', 0.4); } want('demon_roar', null); break;
      case 'cinder': say('master'); break;                                                     // "Welcome home, Master."
      case 'hunt': cue('mus_end_hunt', 1.2); want('hunt_flee', null, 0, 1, 0.6); endHost = 0.5; endWind = 0.6; break;
      case 'black': endCueStop(0.25); endWind = 0; endHost = 0; break;                     // 50 s: a cut to black, a cut in the sound too
      case 'credits': cue('mus_end_credits', 1.0); want('fire_out', null, -6); endWind = 0; endHost = 0; break; // the camp motif, slowed; the lamp's last crackle
    }
  }
  // the percussion layers: one gain per layer into the music bus (so the muffle and the ducks apply), one looping source
  /** @type {Record<string, { out: GainNode, src: AudioBufferSourceNode|null, sg: GainNode|null, entry: any, startAt: number, offset: number, level: number, base: any }>} */
  const layers = {};
  for (const id of LAYERS) { const out = ctx.createGain(); out.gain.value = 0; out.connect(bus.music); layers[id] = { out, src: null, sg: null, entry: null, startAt: 0, offset: 0, level: 0, base: null }; }
  const loopPos = (o, t) => { const L = o.entry.loopEnd || o.entry.buffer.duration; return (((t - o.startAt) + o.offset) % L + L) % L; };
  const beatPhase = (o, t) => { const P = 60 / o.entry.bpm; return (((loopPos(o, t) - (o.entry.beat0 || 0)) / P) % 1 + 1) % 1; };
  /** start (or re-sync) a layer on the base loop's beat phase, keeping the layer's own bar position; 30 ms crossfade */
  function layerStart(id, l) {
    const list = variants(id); if (!list.length || !cur || !cur.entry.bpm) return;
    const e = list[0]; const t = ctx.currentTime + 0.05; const L = e.loopEnd || e.buffer.duration; const Pl = 60 / (e.bpm || cur.entry.bpm);
    const beatsIn = l.src && l.entry ? Math.floor((loopPos(l, t) - (e.beat0 || 0)) / Pl) : 0;
    const off = ((((e.beat0 || 0) + (beatsIn + beatPhase(cur, t)) * Pl) % L) + L) % L;
    const src = ctx.createBufferSource(); src.buffer = e.buffer; src.loop = true; src.loopStart = 0; src.loopEnd = Math.min(L, e.buffer.duration);
    const sg = ctx.createGain(); sg.gain.value = 0; src.connect(sg).connect(l.out); src.start(t, off); sg.gain.setTargetAtTime(1, t, 0.01);
    if (l.src && l.sg) { const os = l.src, og = l.sg; og.gain.setTargetAtTime(0, t, 0.01); try { os.stop(t + 0.15); } catch { /* */ } }
    l.src = src; l.sg = sg; l.entry = e; l.startAt = t; l.offset = off; l.base = cur; layerSyncs++;
  }
  let layerSyncs = 0;
  const BAT_K = ['bat', 'batgremlin', 'bat_gremlin', 'flyer'].map((k) => ENEMY_KINDS.indexOf(k)).find((i) => i >= 0) ?? -1;
  /** the organ loop on now (the first round must not wait for the next frame) */
  function organFire(rps) {
    if (!(organLevel > 0)) organStarts++;
    if (rps > 0) organRate = clamp(rps / ORGAN_RPS, 0.8, 1.45);
    const b = beds.organ_loop; if (b && b.src && Math.abs(b.src.playbackRate.value - organRate) > 0.01) b.src.playbackRate.setTargetAtTime(organRate, ctx.currentTime, 0.05);
    organLevel = 1; bed('organ_loop', 1, 0, 0.004);
  }
  function organStop() { organUntil = -1; organOnEv = false; if (organLevel > 0) { organLevel = 0; bed('organ_loop', 0, 0, ORGAN_FADE); } }
  // DESIGN §9
  let nightN = 1, soonHold = false, npcOpen = false, lastCardT = -10, hexUntil = -1, hexChopT = 0, hexWas = false, campLeaving = false;
  let coinLadder = 0, coinLast = -1, orbitN = 0, orbitLevel = 0;
  /** @type {Slot|null} */ let voiceSlot = null;
  let linesSaid = 0;
  const PADS = new Map((ARENA.camp?.pads || []).map((pd) => [pd.id, pd]));
  /** a tower event's position: its pos, else its pad (id or index) */
  function padPos(ev) { if (ev.pos) return ev.pos; const pd = typeof ev.pad === 'number' ? ARENA.camp?.pads?.[ev.pad] : PADS.get(ev.pad); return pd || null; }
  /** the current night (1-based): the night the latest RUN_START / CAMP_LEAVE / NIGHT_TITLE named (the state's field may
   *  still hold the last night during the camp-leave intro); before any of those, the sim's field */
  let evNight = false;
  function curNight(state) {
    if (evNight) return nightN;
    const n = state ? (state.night?.n ?? state.nightN ?? state.run?.night) : null;
    return typeof n === 'number' && n > 0 ? n : nightN;
  }
  /** the night-card sting, once per card (the intro beat and EV.NIGHT_TITLE may both ask) */
  function nightCard(n) {
    introCardDone = true;
    const now = ctx.currentTime; if (now - lastCardT < 4) return; lastCardT = now;
    sting('mus_nightcard', -6, n >= 10 ? 0.84 : n >= 2 ? Math.max(0.86, 0.94 - 0.012 * (n - 2)) : 1); // lower and slower night by night
  }
  /** a pickup ladder step: the playback rate for the n-th pickup of a quick run */
  const ladderRate = (k) => Math.pow(2, LADDER[Math.min(k, LADDER.length - 1)] / 12);
  // Brother Cinder: EV.NPC_LINE `line` → a VOICE_LINES key (the id, the sound id, an index or the text itself)
  const LINE_KEYS = Object.keys(VOICE_LINES);
  const normLine = (t) => String(t).toLowerCase().replace(/[^a-z]+/g, '');
  const LINE_BY_TEXT = new Map(LINE_KEYS.map((k) => [normLine(/** @type {any} */ (VOICE_LINES)[k].text), k]));
  function lineKey(line) {
    if (line == null) return null;
    if (typeof line === 'object') line = line.id ?? line.line ?? line.text;
    if (typeof line === 'number') return LINE_KEYS[line] ?? null;
    const s0 = String(line);
    if (/** @type {any} */ (VOICE_LINES)[s0]) return s0;
    const m = /^vo_cinder_(\w+)$/.exec(s0) || /^cinder[._-](\w+)$/.exec(s0); if (m && /** @type {any} */ (VOICE_LINES)[m[1]]) return m[1];
    const n = normLine(s0); if (!n) return null;
    if (LINE_BY_TEXT.has(n)) return LINE_BY_TEXT.get(n) ?? null;
    for (const [t, k] of LINE_BY_TEXT) if (t.startsWith(n.slice(0, 18)) || n.startsWith(t.slice(0, 18))) return k;
    return null;
  }
  /**
   * Brother Cinder speaks a line (a new line cuts the previous one); the music and the ambience dip under him.
   * @param {any} line @returns {number} the line's length in seconds (0 when it cannot play: the subtitle still shows)
   */
  let lastSayKey = '', lastSayT = -10, masterSaid = false;
  function say(line) {
    const key = lineKey(line); if (!key || disposed) return 0;
    if (key === lastSayKey && ctx.currentTime - lastSayT < 1.5) return 0; // the ending's beat and the sim's NPC_LINE may both ask
    if (key === 'master' && mode === 'ending') { if (masterSaid) return 0; masterSaid = true; } // once per ending
    lastSayKey = key; lastSayT = ctx.currentTime;
    const id = /** @type {any} */ (VOICE_LINES)[key].sound;
    const list = variants(id); if (!list.length || ctx.state !== 'running') return 0;
    if (voiceSlot && voiceSlot.active && voiceSlot.id.startsWith('vo_')) stopSlot(voiceSlot, 0.08);
    const s = play(id, { delay: 0.05 }); if (!s) return 0;
    voiceSlot = s; linesSaid++;
    const st = idState.get(id); if (st) { st.plays++; st.last = ctx.currentTime; }
    const d = list[0].buffer.duration;
    duck(d + 0.3, -7);
    if (endCue) { const g = endCue.g.gain, t0 = ctx.currentTime, g0 = g.value; g.cancelScheduledValues(t0); g.setValueAtTime(g0, t0); g.setTargetAtTime(g0 * 0.4, t0, 0.08); g.setTargetAtTime(g0, t0 + d + 0.2, 0.4); } // an ending cue dips under him
    const t = ctx.currentTime; ambDuck.gain.cancelScheduledValues(t); ambDuck.gain.setTargetAtTime(0.5, t, 0.1); ambDuck.gain.setTargetAtTime(muffled ? 0.4 : 1, t + d + 0.3, 0.5);
    return d;
  }
  /** @type {{ heat: (x: number, z: number) => number }|null} */
  let fireProvider = null;
  const troll = { x: 30, z: 80 };
  const TROUGH_C = new Map(ARENA.oil.troughs.map((t) => [t.id, { x: (t.x0 + t.x1) / 2, z: (t.z0 + t.z1) / 2 }]));
  const BASKET = { x: ARENA.beacon.basket.x, z: ARENA.beacon.basket.z };

  /** the mix while the sim waits (level-up cards, the menu): music low-passed, ambience down */
  let muffled = false;
  function muffle(on) {
    if (on === muffled) return; muffled = on;
    const t = ctx.currentTime;
    ambDuck.gain.cancelScheduledValues(t); ambDuck.gain.setTargetAtTime(on ? 0.4 : 1, t, 0.15);
    setMusicFilter(on ? 1100 : 20000, on ? 0.35 : 0.5);
  }
  function onMode(m, prev) {
    if (m === mode) return;
    if (mode === 'ending' && m !== 'ending') { endCueStop(m === 'title' || m === 'camp' || m === 'play' ? 1.5 : 3); endWind = 0; endHost = 0; }
    mode = m; modeClock = 0; lastBeatT = -1; musicOverride = undefined; soonHold = false;
    if (m !== 'cards' && muffled) muffle(false);
    switch (m) {
      case 'intro': introCardDone = false; setMusicFilter(20000, 0.3); if (prev !== 'camp') campLeaving = false; break; // from the camp: TIMELINE.campLeave (NIGHT_TITLE plays the card)
      case 'play': setMusicFilter(20000, 0.4); if (prev === 'intro' && !introCardDone) nightCard(curNight(lastState)); break;
      case 'ending': endDone.clear(); masterSaid = false; endWind = 0; endHost = 0; rainBoss = false; covenOn = false; organStop(); break; // DESIGN §12: the beats cue everything
      case 'camp': // between nights: no horde, dusk; the run's in-night state is over
        setMusicFilter(20000, 0.6); musicDuck.gain.setTargetAtTime(1, ctx.currentTime, 0.3);
        kindleUntil = -1; trollArriveT = -1; trollRoared = false; gateStep = 0; hexUntil = -1;
        if (lanceOn) { lanceOn = false; bed('w_lance_loop', 0, 0, 0.08); }
        break;
      case 'cards': muffle(true); break; // the sim waits on the cards
      case 'victory': setMusicFilter(20000, 1); dawnPlayed = false; break;
      case 'fallen': setMusicFilter(420, 0.6); duck(2.4, -5); break;
    }
  }
  function onBeat(m, id) {
    if (m === 'ending') { endingBeat(id); return; }
    switch (`${m}:${id}`) {
      case 'intro:beacon': want('beacon_ready', BASKET, 4); break;
      case 'intro:card': if (!introCardDone) nightCard(curNight(lastState)); break;
      case 'fallen:card': sting('mus_fallen', -12); break;
    }
  }
  function kindOf(k) { return typeof k === 'number' ? ENEMY_KINDS[k] : k; }
  function stepSurface(p) {
    if (!p) return 'step_earth';
    const s = ARENA.stair;
    if ((p.y ?? 0) > 4.3) return 'step_stone';
    if (p.x >= s.x0 - 0.3 && p.x <= s.x1 + 0.3 && p.z <= s.zBottom && p.z >= s.zTop && (p.y ?? 0) > 0.25) return 'step_timber';
    return 'step_earth';
  }

  /** @param {any} ev @param {any} state */
  function onEvent(ev, state) {
    if (disposed || !ev) return;
    const p = ev.pos;
    switch (ev.type) {
      case EV.MODE: onMode(ev.mode, ev.prev); break;
      case EV.NIGHT_START: if (mode === 'intro') onMode('play', 'intro'); break;
      case EV.RETRY:
        kindleUntil = -1; trollArriveT = -1; trollRoared = false; gateStep = 0; introCardDone = true; musicOverride = undefined;
        setMusicFilter(20000, 0.8); musicDuck.gain.setTargetAtTime(1, ctx.currentTime, 0.3); musicName = null; music(curNight(state) >= 2 ? 'night2' : 'night', 1.2);
        break;
      case EV.DAWN: want('horde_flee', null); want('fire_out', null, 2); break;
      case EV.FALLEN: break; // mode 'fallen' handles the mix; the card beat plays the sting
      case EV.VICTORY: break;

      // the Lamplighter
      case EV.P_STEP: { const sp0 = ev.speed ?? 6; want(stepSurface(p), null, sp0 > 7.5 ? 2 : 0, sp0 > 7.5 ? 1.05 : 1); break; }
      case EV.P_JUMP: want(stepSurface(p), null, -4, 1.1); break;
      case EV.P_LAND: want(stepSurface(p), null, (ev.fall ?? 0) > 2 ? 5 : 2, 0.85); break;
      case EV.P_HURT: want('p_hurt', null, (ev.dmg ?? 8) >= 20 ? 2 : 0); break;
      case EV.P_DEATH: want('p_death', null); break;
      case EV.P_HEAL: // sources 'level' (a heal now and then) and 'hearthblood' (continuous while standing in fire)
        if (ev.source === 'hearthblood') { if (simT - hbHealT >= 3) { hbHealT = simT; want('heart', null, -10, 0.92); } } // quiet, ≤ 1 per 3 s
        else want('heart', null);
        break;
      case EV.GALE: { // DESIGN §10.4 EMBER GALE: one hot gust from the keep down the slope; the fire beds flare with it
        const lv = Math.max(1, Math.min(3, ev.level ?? 1)); want('gale_gust', null, (lv - 1) * 1, 1 - 0.03 * (lv - 1));
        galeT0 = simT; galeLen = Math.max(0.5, ev.seconds ?? 2.5); break;
      }
      case EV.WEAPON_SWITCH: want('w_switch', null); if (!isOrgan(ev.weapon)) organStop(); break;
      case EV.SHOT: // exactly one sound per trigger pull (one file, no jitter); the bed dip is a gain change, not a sound
        lastShotT = ctx.currentTime;
        if (ev.pellets) for (let i = 0; i < ev.pellets.length; i++) { const pe = ev.pellets[i]; if (pe && typeof pe.hitId === 'number' && pe.hitId < 0) want('hit_flesh', pe.to, 0, 1.15); } // a gun hit on a Bat Gremlin
        if (isOrgan(ev.weapon)) { organUntil = ctx.currentTime + ORGAN_HOLD; organFire(ev.rps ?? ev.rate ?? 0); shotDip(-3, 0.1); break; } // the THUNDER ORGAN: its one loop, nothing per round
        if (ev.weapon === 'blunderbuss') { want('w_blunder_shot', null); shotDip(-6, 0.15); } else if (ev.weapon === 'pistol') { want('w_kestrel_shot', null); shotDip(-4, 0.08); }
        break;
      case EV.RELOAD: {
        const id = ev.weapon === 'blunderbuss' || isOrgan(ev.weapon) ? 'w_blunder_reload' : ev.weapon === 'pistol' ? 'w_kestrel_reload' : null; if (!id) break;
        if (isOrgan(ev.weapon)) organStop();
        const d = variants(id)[0]?.buffer.duration; const r = d && ev.seconds ? clamp(d / ev.seconds, 0.9, 1.3) : 1;
        want(id, null, 0, r); break;
      }
      case EV.DRY: want('w_dry', null); break;
      case EV.LANCE_ON: lanceOn = true; want('w_lance_ignite', null); bed('w_lance_loop', 1, 0, 0.04); break;
      case EV.LANCE_OFF: if (lanceOn) { lanceOn = false; bed('w_lance_loop', 0, 0, 0.06); want('w_lance_stop', null); } break;
      case EV.BOMB_THROW: want('bomb_throw', null); break;
      case EV.BOMB_BURST: want('bomb_burst', p); break;
      case EV.SUNBURST: want('sunburst', null); duck(1.2, -4); break;
      case EV.PICKUP:
        if (ev.kind === 'xp') { // an ember gem (or a batch) reaches the player: a glassy tick climbing a pentatonic ladder
          const now = ctx.currentTime; xpLadder = now - xpLast < LADDER_WINDOW ? xpLadder + 1 : 0; xpLast = now;
          if (variants('xp_collect').length) want('xp_collect', null, 0, ladderRate(xpLadder) * 0.9); else want('xp_tick', null, 0, ladderRate(xpLadder));
        } else if (ev.kind === 'gold') { // coins reach the player: the pixel clink up the ladder (+ the old clink, quieter)
          const now = ctx.currentTime; coinLadder = now - coinLast < LADDER_WINDOW ? coinLadder + 1 : 0; coinLast = now;
          if (variants('coin_tick').length) want('coin_tick', null, Math.min(3, ((ev.count ?? ev.value ?? 1) - 1) * 0.5), ladderRate(coinLadder)); else want('gold', null);
        } else if (ev.kind === 'heart') want('heart', null);
        break;
      case EV.LEVEL_UP: want('levelup', null); break;
      case EV.CARD_PICK: want('card_pick', null); break;

      // the horde
      case EV.E_HIT:
        if (ev.source === 'bullet') {
          const k = kindOf(ev.kind);
          if (k === 'brute') want('hit_wood', p, ev.crit ? 3 : 0); else want('hit_flesh', p, ev.crit ? 3 : 0, k === 'imp' ? 1.2 : 1);
        }
        break;
      case EV.E_IGNITE: want('ignite_puff', p); if (rand() < 0.15) want('gob_burn', p, -3); break; // burning deaths shriek too: keep the ignite shrieks sparse
      case EV.E_DEATH: {
        const k = kindOf(ev.kind);
        if (BAT_K >= 0 && ev.kind === BAT_K || /^bat/.test(String(k))) { if (ev.burned) want('bat_crash', p); else want('gob_death', p, 0, 1.15); break; } // a Bat Gremlin
        if (ev.burned) want('gob_burn', p, 0, k === 'imp' ? 1.25 : k === 'brute' ? 0.75 : 1);
        else if (k === 'imp') want('imp_chitter', p);
        else want('gob_death', p, k === 'brute' ? 2 : 0, k === 'brute' ? 0.72 : k === 'spear' ? 0.92 : 1);
        break;
      }
      case EV.E_ATTACK: if (ev.target === 'player') want('claw', p); break;
      case EV.SPEAR_THROW: want('spear_throw', ev.from || p); break;
      case EV.SPEAR_HIT: want('spear_impact', ev.target === 'player' ? null : p, ev.target === 'player' ? 2 : 0, 1, 0, ev.target === 'player' ? 1 : 0); break;
      case EV.GATE_HIT: {
        const gp = p || { x: 0, z: 0.5 };
        want('gate_thud', gp, (ev.dmg ?? 2) >= 30 ? 4 : 0);
        const f = ev.hpFrac ?? 1; const step = f < 0.25 ? 3 : f < 0.5 ? 2 : f < 0.75 ? 1 : 0;
        if (step > gateStep) { gateStep = step; want('gate_splinter', gp, step); }
        break;
      }
      case EV.GATE_BREACH: want('gate_breach', null); duck(2, -8); break;

      // fire and oil
      case EV.BARREL_BURST: want('barrel_burst', p); break;
      case EV.TROUGH_LIT: want('trough_ignite', TROUGH_C.get(ev.id) || p); break;
      case EV.TROUGH_OUT: want('fire_out', TROUGH_C.get(ev.id) || p); break;
      case EV.KINDLE: kindleUntil = simT + KINDLE_SECONDS; want('beacon_kindle', BASKET); duck(1.5, -3); break;
      case EV.BEACON_READY: want('beacon_ready', BASKET); break;

      // the Ash Troll
      case EV.T_ARRIVE: trollArriveT = simT; trollRoared = false; want('troll_horn', null); if (p) { troll.x = p.x; troll.z = p.z; } break;
      case EV.T_STEP: want('troll_step', p); break;
      case EV.T_WINDUP:
        if (ev.move === 'smash') want('troll_windup', p, 0, 1, 0, 0);
        else if (ev.move === 'throw') want('troll_windup', p, -1, 1.12, 0, 1);
        else if (ev.move === 'stomp') want('troll_windup', p, 0, 1.3, 0, 0);
        else if (/roar|ash/.test(String(ev.move))) want('troll_windup', p, 2, 0.85, 0, 0); // the Ash Roar's telegraph: the deepest growl
        break;
      case EV.T_SMASH: want('troll_smash', p); if (ev.target === 'gate') want('gate_thud', p || { x: 0, z: 0.5 }, 5); break;
      case EV.T_THROW: want('troll_throw', ev.from || p); break;
      case EV.T_BOULDER: want('boulder_impact', p); break;
      case EV.T_STOMP: want('troll_stomp', p); break;
      case EV.T_GLOW: if (ev.on) want('troll_sizzle', p || troll); break;
      case EV.T_HURT: // only a real hit: a bullet (the sim also sends T_HURT for fire ticks and blasts, without a source)
        if (ev.source ? ev.source === 'bullet' : ctx.currentTime - lastShotT < 0.25) want('troll_hit', p || troll, ev.glowing ? 3 : 0, ev.glowing ? 1.18 : 1);
        break;
      case EV.T_DEATH: want('troll_death', p || troll); duck(3, -6); break;

      // DESIGN §9: the run, the camp, Brother Cinder
      case EV.RUN_START: nightN = ev.night || 1; evNight = true; kindleUntil = -1; break;
      case EV.CAMP_ENTER: if (ev.nextNight) nightN = ev.nextNight; if (mode !== 'camp' && state?.mode === 'camp') onMode('camp', mode); break;
      case EV.CAMP_LEAVE: // the lamp is kindled at the camp: a roar at the basket, then the horde answers from the valley
        if (ev.night) { nightN = ev.night; evNight = true; } campLeaving = true;
        want('beacon_kindle', BASKET, 2); want('horde_rise', null, 0, 1, TIMELINE.campLeave?.vision ?? 1.6); duck(1.5, -3); break; // the horde answers on the vision beat
      case EV.NIGHT_TITLE: if (ev.night) { nightN = ev.night; evNight = true; } nightCard(ev.night || nightN); break;
      case EV.COMING_SOON: soonHold = true; sting('mus_soon', -14); break; // the dawn music fades (autoMusic → null)
      case EV.NPC_OPEN: npcOpen = true; want('npc_open', null); break;
      case EV.NPC_CLOSE: npcOpen = false; break;
      case EV.NPC_LINE: say(ev.line ?? ev.id ?? ev.text); break;
      case EV.BUY: want('shop_buy', null); break;
      case EV.GOLD_DROP: { const n = ev.n ?? ev.value ?? 1; want('coin_spill', p, n >= 8 ? 4 : n >= 3 ? 2 : 0, n >= 8 ? 0.9 : 1); break; }
      case EV.XP_DROP: if ((ev.n ?? 1) >= 5 || (ev.value ?? 0) >= 10) want('xp_collect', null, -6, 0.75); break; // big spills only (elites, the troll)
      case EV.CHARM_DROP: want('charm_found', null, -5, 0.89); break;
      case EV.CHARM_PICKUP: want('charm_found', null); if (ev.dup) want('coin_spill', null, 2, 1, 0.45); break;
      case EV.CHARM_EQUIP: want('charm_equip', null, ev.on === false ? -3 : 0, ev.on === false ? 0.84 : 1); break;
      // towers (camp builds; night pulses and hooks)
      case EV.TOWER_BUILD: { const pp = padPos(ev); want('tower_build', pp); if ((ev.tower ?? ev.kind) === 'chainimp') want('chain_throw', pp, -2, 0.9, 1.3); break; } // the tower's type is `tower`
      case EV.TOWER_UPGRADE: want('tower_upgrade', padPos(ev), 0, 1 + 0.06 * Math.max(0, (ev.level ?? 2) - 2)); break;
      case EV.OBELISK_PULSE: { const lv = ev.level ?? 1; want('obelisk_pulse', p || padPos(ev), (lv - 1) * 1.5, 1 - 0.04 * (lv - 1)); break; }
      case EV.CHAIN_THROW: want('chain_throw', ev.from || p); break;
      case EV.CHAIN_HOOK: want('chain_hook', p); break;
      // skills
      case EV.ORBIT_HIT: want('orbit_hit', p); break;
      case EV.METEOR: { // the whistle ends as the meteor lands; the impact on landing
        const fl = Math.max(0.05, ev.flight ?? 1); const wd = variants('meteor_whistle')[0]?.buffer.duration ?? 1.76;
        if (fl >= wd * 0.75) want('meteor_whistle', p, 0, 1, Math.max(0, fl - wd)); else want('meteor_whistle', p, -2, Math.min(1.35, wd / fl));
        want('meteor_impact', p, 0, 1, fl); break;
      }
      case EV.TRAIL: want('trail_crackle', null); break;
      case 'pad.open': want('ui_click', null); break; // a pad's build/upgrade panel (not in EV)
      case 'shop.denied': want('w_dry', null); break; // not enough gold / maxed / no slot
      // elites and Dousers
      case EV.ELITE_SPAWN: { const k = kindOf(ev.kind); if (k === 'chief') { want('chief_horn', p); duck(1.4, -3); } else if (k === 'hexer') want('hexer_cackle', p); break; }
      case EV.HEX:
        if (ev.hit) { hexUntil = simT + 2; want('hex_zap', null, 1, 0.85); if (lanceOn || state?.player?.weapon === 'lance') want('lance_sputter', null); }
        else want('hex_zap', ev.to || p || ev.from); // HEX fires at landing
        break;
      default: { // the Organ, bats, Pyre Burst, the Ash Roar by name (or EV's own); the nights (DESIGN §8) by keyword below
        const k = V3_OF.get(ev.type); if (!k) { onEventV4(ev, state); break; }
        if (k === 'organOn') { organOnEv = true; organFire(ev.rps ?? 0); }       // 'organ.fire': rounds begin
        else if (k === 'organOff') organStop();                                  // 'organ.stop' {reason}: release / overheat / empty / switch
        else if (k === 'overheat') { organStop(); want('organ_overheat', null); } // its own hiss, only here
        else if (k === 'organEquip') want('w_switch', null);
        else if (k === 'batScreech') want('bat_screech', p || ev.to);            // the dive's telegraph
        else if (k === 'batCrash') want('bat_crash', p);
        else if (k === 'batDeath') { if (!ev.burned) want('gob_death', p, 0, 1.15); } // a burning one crashes ('air.crash')
        else if (k === 'batIgnite') want('ignite_puff', p);
        else if (k === 'batHit') want('claw', null);                              // the dive strikes the player
        else if (k === 'pyre') want('pyre_pop', p);
        else if (k === 'ashRoar') { want('ash_roar', p || troll); duck(2, -4); }
        break;
      }
      case EV.DOUSE_THROW: { // the bucket leaves the hand; the splash and steam on landing (≈ 11 m/s)
        const f = ev.from || p, to = ev.to || p; want('douse_throw', f);
        const d = f && to ? Math.hypot(to.x - f.x, to.z - f.z) : 6; want('douse_splash', to, 0, 1, ev.flight ?? clamp(d / 11, 0.35, 1.1)); break;
      }
    }
  }

  /** DESIGN §8 events, matched by keyword (the sim's names: docs/AUDIO.md) */
  function onEventV4(ev, state) {
    const t = String(ev.type || ''); const p = ev.pos;
    if (/^ending/.test(t)) { if (ev.id != null || ev.beat != null) endingBeat(ev.id ?? ev.beat); else if (/start|begin/.test(t) && mode !== 'ending') onMode('ending', mode); return; }
    if (/^(boss|rainmother)\b|rainmother/.test(t)) { // 'boss.*' (state.boss.kind 'rainmother')
      if (/tide\.hit/.test(t)) want('douse_splash', null, 3, 0.8);                         // the wave hits the Lamplighter
      else if (/rise|wake|emerge/.test(t)) { rainBoss = true; want('rain_rise', p || null); duck(2.5, -4); }
      else if (/tide|wave/.test(t)) want('tide_wave', p || ev.from || null);
      else if (/whirl/.test(t)) { whirlPos.x = p ? p.x : lis.x; whirlPos.z = p ? p.z : lis.z; whirlUntil = simT + (ev.seconds ?? 6); want('tide_wave', p || null, -8, 1.3); }
      else if (/step/.test(t)) want('rain_step', p || null);
      else if (/lantern|crown/.test(t)) want('lantern_shatter', p || null);
      else if (/hex/.test(t)) onEvent({ type: EV.HEX, from: ev.from, to: ev.to, hit: ev.hit, pos: p }, state);
      else if (/crack/.test(t)) { if (ev.on !== false) want('troll_sizzle', p || null, 2, 0.8); }
      else if (/phase/.test(t)) want('rain_rise', p || null, -6, 1.1);                     // her moan at each phase
      else if (/gate/.test(t)) want('gate_breach', null);
      else if (/death|dead|collapse|die/.test(t)) { rainBoss = false; want('rain_collapse', p || null); }
      else if (/hurt|hit/.test(t) && (ev.source ? ev.source === 'bullet' : ctx.currentTime - lastShotT < 0.25)) want('troll_hit', p || null, ev.cracked ? 3 : 0, ev.cracked ? 1.1 : 0.85);
      return;
    }
    if (/^ram\./.test(t)) { // the Siege Ram (its drum is the loop that follows state.rams in mode 'walk')
      if (/hit/.test(t)) want('ram_impact', p || { x: 0, z: 0.5 });
      else if (/carrier/.test(t)) want('gob_death', p || null, 0, 0.92);
      else if (/death/.test(t)) want('barrel_burst', p || null, -2, 0.8);
      return;
    }
    if (/^coven\./.test(t)) {
      if (/chant/.test(t)) covenOn = ev.on !== false && !ev.broken;
      else if (/gather/.test(t)) want('hexer_cackle', p || null);
      else if (/lock/.test(t)) { covenOn = false; want('fire_out', BASKET, 2, 0.7); } // the lamp is dimmed
      return;
    }
    if (/^weather\.squall/.test(t)) { if (ev.on) want('thunder', null); return; }
    if (/thunder|lightning/.test(t)) { want('thunder', null); return; }
  }

  /** the music the state asks for */
  function autoMusic(state) {
    const m = state?.mode || mode;
    if (m === 'camp') return 'camp';
    if (m === 'ending') return null; // the ending's cues are its music (endingBeat)
    if (m === 'intro' || m === 'play' || m === 'cards') {
      const rm = state ? (state.rainmother || state.boss) : null;
      if (rainBoss || (rm && (rm.hp ?? 0) > 0 && rm.risen !== false && rm.stage !== 'hidden' && rm.stage !== 'asleep' && rm.alive !== false && (rm.kind ?? 'rainmother') === 'rainmother')) return 'rain';
      const tr = state?.troll;
      if (tr && tr.hp > 0) return 'troll';
      if (state?.night && typeof state.night.kindleT === 'number' ? state.night.kindleT > 0 : kindleUntil > simT) return 'kindle'; // the sim's own kindle timer when it has one
      const nn = curNight(state); return nn === 1 ? 'night' : nn === 2 ? 'night2' : nn % 2 ? 'night' : 'night2'; // III–X alternate under the layers
    }
    if (m === 'victory') return soonHold ? null : modeClock >= DAWN_QUIET_AT ? 'dawn' : null; // coming soon: the dawn fades under the sting
    return null; // title, fallen
  }
  let dawnPlayed = false;
  const DAWN_QUIET_AT = TIMELINE.dawn.beats.find((b) => b.id === 'quiet')?.at ?? 4;

  /**
   * @param {number} dt @param {any} state
   * @param {{x:number,y:number,z:number,yaw:number,pitch?:number,fx?:number,fz?:number}} [listener] the camera; yaw in the
   *   arena convention (forward = (sin yaw, cos yaw), as state.player.yaw), or give the forward vector as fx/fz
   */
  function update(dt, state, listener) {
    if (disposed) return;
    if (state) lastState = state;
    if (!bgStarted) { // the background load waits for the game: progress 1 (main.js sets __ew.bootMs then) or play begun
      const ew = /** @type {any} */ (globalThis).__ew; const bm = ew ? ew.bootMs : null;
      if (bm > 0) startBackground('ready'); else if (state && state.mode && state.mode !== 'title') startBackground('mode');
    }
    if (!unlocked && ctx.state === 'running') unlock(); // the page already had a gesture
    dt = dt > 0 && dt < 1 ? dt : 0;
    if (listener) {
      setListener(listener.x, listener.y, listener.z, listener.yaw ?? lis.yaw);
      // an explicit forward vector wins over the yaw (right = (−fz, fx) on the ground plane)
      const fx = /** @type {any} */ (listener).fx, fz = /** @type {any} */ (listener).fz;
      if (fx != null && fz != null) { const n = Math.hypot(fx, fz) || 1; lis.rx = -fz / n; lis.rz = fx / n; }
    }
    else if (state?.player) setListener(state.player.x, state.player.y + 1.68, state.player.z, state.player.yaw);
    if (state) {
      simT = state.t ?? simT + dt;
      if (state.mode && state.mode !== mode) onMode(state.mode, mode);
      const wait = !!state.paused || state.mode === 'cards' || npcOpen || !!state.camp?.panel;
      if (wait !== muffled && mode !== 'fallen') muffle(wait); // the menu (state.paused) and the cards
      if (state.troll) { troll.x = state.troll.x; troll.z = state.troll.z; }
    } else simT += dt;
    modeClock += dt;
    const mt = state && typeof state.modeT === 'number' ? Math.max(state.modeT, 0) : modeClock;
    // timeline beats of the current mode
    const tl = mode === 'intro' ? (campLeaving ? null : TIMELINE.intro) : mode === 'fallen' ? TIMELINE.fallen : mode === 'victory' ? TIMELINE.dawn : mode === 'ending' ? /** @type {any} */ (TIMELINE).ending || null : null;
    if (tl) {
      const beats = tl.beats;
      for (let i = 0; i < beats.length; i++) { const b = beats[i]; if (b.at > lastBeatT && b.at <= mt && mt - b.at < 0.75) onBeat(mode === 'victory' ? 'dawn' : mode, b.id); }
      lastBeatT = mt;
    }
    // the troll's arrival overlay: the roar on its beat
    if (trollArriveT >= 0 && !trollRoared && simT - trollArriveT >= TROLL_ROAR_AT) { trollRoared = true; want('troll_roar', troll, 2); }
    // music by state (a manual music() call holds until the state's own choice changes); no state, no automatic music
    if (state) {
      const auto = autoMusic(state);
      if (musicOverride !== undefined && auto !== overrideBase) musicOverride = undefined;
      const target = musicOverride !== undefined ? musicOverride : auto;
      if (target === 'dawn') { if (!dawnPlayed) { dawnPlayed = true; music('dawn'); } }
      else if (target !== musicName) music(target);
    }
    if (!unlocked || ctx.state !== 'running') return;

    // the later nights' percussion layers over night / night2, on the loop's beat (re-synced if they drift > 15 ms)
    {
      const nn = curNight(state); const row = LAYER_BY_NIGHT[nn > 10 ? 10 : nn < 0 ? 0 : nn] || LAYER_BY_NIGHT[0];
      const baseOk = !!(cur && cur.entry.bpm && (cur.name === 'night' || cur.name === 'night2') && (mode === 'play' || mode === 'cards' || mode === 'intro'));
      layerChk -= dt; const chk = layerChk <= 0; if (chk) layerChk = 1;
      for (let i = 0; i < LAYERS.length; i++) {
        const id = LAYERS[i]; const l = layers[id]; const lv = baseOk ? row[i] : 0;
        if (lv > 0 && (!l.src || l.base !== cur)) layerStart(id, l);
        else if (lv > 0 && l.src && l.entry && l.entry.bpm) { // every frame (arithmetic only): a loop's wrap shifts its beat grid by up to ≈ 30 ms
          const t = ctx.currentTime; let d = beatPhase(l, t) - beatPhase(cur, t); d = d - Math.round(d);
          if (Math.abs(d * 60 / cur.entry.bpm) > 0.015) layerStart(id, l);
        }
        if (Math.abs(lv - l.level) > 0.01) { l.level = lv; l.out.gain.setTargetAtTime(lv * dbToGain(SOUNDS[id].gain), ctx.currentTime, lv > 0 ? 1.0 : 0.6); }
        if (lv === 0 && l.src && chk && l.out.gain.value < 0.003) { try { l.src.stop(); } catch { /* */ } l.src = null; l.sg = null; l.base = null; }
      }
    }

    // the THUNDER ORGAN: the loop holds while rounds keep coming (or the sim says it fires), then fades ≤ 120 ms
    {
      const pl = state ? state.player : null;
      // with the sim's own state (player.organ.firing) that wins, so a lost 'organ.stop' never leaves the loop on
      const known = !!(pl && pl.organ && typeof pl.organ.firing === 'boolean');
      const want1 = known ? (isOrgan(pl.weapon) && pl.organ.firing && !(pl.organ.lockT > 0)) || ctx.currentTime < organUntil : organOnEv || ctx.currentTime < organUntil;
      if (organLevel > 0 && (!want1 || (state && mode !== 'play') || (pl && pl.weapon && !isOrgan(pl.weapon)))) organStop();
    }
    if (benchBeds) return;
    // beds: night ambience by mode
    const camp = mode === 'camp';
    const live = mode === 'intro' || mode === 'play' || mode === 'cards' || mode === 'fallen' || mode === 'title' || camp;
    const ending = mode === 'ending';
    bed('amb_night', camp ? 0.2 : ending ? 0.25 : live ? 1 : mode === 'victory' ? 0.5 : 0.7, 0, 1.2);
    // weather, the ram, the coven, whirlpools (every 0.1 s, no allocation), the ending's beds
    scanT -= dt;
    if (scanT <= 0 && state) {
      scanT = 0.1;
      const w = state.weather; rainLvl = w && typeof w.rain === 'number' ? clamp(w.rain, 0, 1) : 0;
      ramNear = 0; ramPan = 0; whirlNear = 0; whirlPan = 0;
      const rams = state.rams || state.siege?.rams || (state.ram ? state.ram : null);
      const nr = rams ? (typeof rams.length === 'number' ? rams.length : 1) : 0;
      for (let i = 0; i < nr; i++) { const o = typeof rams.length === 'number' ? rams[i] : rams; if (!o || o.alive === false || (o.hp ?? 1) <= 0 || (o.mode && o.mode !== 'walk')) continue; /* the drum while it marches */ const dx = o.x - lis.x, dz = o.z - lis.z; const d = Math.sqrt(dx * dx + dz * dz); const lv = smooth(80, 10, d); if (lv > ramNear) { ramNear = lv; ramPan = d > 0.5 ? clamp((dx * lis.rx + dz * lis.rz) / d, -1, 1) * 0.6 : 0; } }
      const wh = state.whirlpools || (state.rainmother || state.boss)?.whirlpools;
      if (wh && typeof wh.length === 'number') for (let i = 0; i < wh.length; i++) { const o = wh[i]; if (!o) continue; const dx = o.x - lis.x, dz = o.z - lis.z; const d = Math.sqrt(dx * dx + dz * dz); const lv = smooth(30, 4, d); if (lv > whirlNear) { whirlNear = lv; whirlPan = d > 0.5 ? clamp((dx * lis.rx + dz * lis.rz) / d, -1, 1) * 0.6 : 0; } }
      const cv = state.coven; if (cv && typeof cv === 'object') covenOn = !!(cv.chanting ?? cv.active ?? ((cv.t ?? 0) > 0));
      if (simT < whirlUntil) { const dx = whirlPos.x - lis.x, dz = whirlPos.z - lis.z; const d = Math.sqrt(dx * dx + dz * dz); const lv = smooth(30, 4, d) * Math.min(1, (whirlUntil - simT) / 0.8); if (lv > whirlNear) { whirlNear = lv; whirlPan = d > 0.5 ? clamp((dx * lis.rx + dz * lis.rz) / d, -1, 1) * 0.6 : 0; } }
    }
    const weatherLive = mode === 'play' || mode === 'cards' || mode === 'intro' || mode === 'fallen';
    bed('rain_bed', weatherLive ? rainLvl : 0, 0, ending ? 0.8 : 1.5);
    if (weatherLive && rainLvl > 0.55) { thunderT -= dt; if (thunderT <= 0) { thunderT = 10 + rand() * 18; if (play('thunder', { pan: (rand() * 2 - 1) * 0.6, db: -2 + rand() * 3 })) { const st = idState.get('thunder'); if (st) st.plays++; } } }
    bed('ram_drum', mode === 'play' || mode === 'cards' ? ramNear : 0, ramPan, 0.5);
    bed('coven_chant', (mode === 'play' || mode === 'cards') && covenOn ? 1 : 0, 0, 0.8);
    bed('whirlpool', mode === 'play' || mode === 'cards' ? whirlNear : 0, whirlPan, 0.4);
    bed('hell_wind', ending ? endWind : 0, 0, 1.5);
    bed('host_march', ending ? endHost : 0, 0, 1.2);
    bed('amb_camp', camp ? 1 : 0, 0, camp ? 1.5 : 1.0);
    // crowd beds: horde around the listener (a full scan every 0.1 s; typed arrays, no allocation)
    hordeT -= dt;
    if (hordeT <= 0 && state?.horde) {
      hordeT = 0.1;
      const h = state.horde; const n = Math.min(h.count || 0, h.x?.length || 0);
      let near = 0, mid = 0, farN = 0, pn = 0, burnN = 0, bp = 0, bd2 = 1e9, bpx = 0, bpz = 0, bn = 0;
      for (let i = 0; i < n; i++) {
        const st = h.state ? h.state[i] : 1; if (st === 0) continue;
        const dx = h.x[i] - lis.x, dz = h.z[i] - lis.z; const d2 = dx * dx + dz * dz;
        if (d2 < 196) { near++; const d = Math.sqrt(d2) + 0.01; pn += (dx * lis.rx + dz * lis.rz) / d; }
        else if (d2 < 3600) mid++; else farN++;
        if (h.burn && h.burn[i] > 0 && d2 < 625) { burnN += 1 / (1 + d2 / 64); bp += (dx * lis.rx + dz * lis.rz) / (Math.sqrt(d2) + 0.01); }
        if (BAT_K >= 0 && h.kind && h.kind[i] === BAT_K) { const dy = (h.y ? h.y[i] : 5) - lis.y; const d3 = d2 + dy * dy; if (d3 < bd2) { bd2 = d3; bpx = dx; bpz = dz; } if (d3 < 196) bn++; }
      }
      // air enemies kept outside the horde arrays (state.bats / state.air: [{ x, y, z }])
      const air = state.bats || state.air;
      if (air && typeof air.length === 'number') for (let i = 0; i < air.length; i++) { const o = air[i]; if (!o || o.alive === false) continue; const dx = o.x - lis.x, dz = o.z - lis.z, dy = (o.y ?? 5) - lis.y; const d3 = dx * dx + dy * dy + dz * dz; if (d3 < bd2) { bd2 = d3; bpx = dx; bpz = dz; } if (d3 < 196) bn++; }
      const bd = Math.sqrt(bd2); batN = bn;
      batNear = bd2 < 1e8 ? smooth(16, 3, bd) * Math.min(1, 0.6 + 0.15 * bn) : 0;
      batPan = bd2 < 1e8 && bd > 0.5 ? clamp((bpx * lis.rx + bpz * lis.rz) / Math.max(0.5, Math.hypot(bpx, bpz)), -1, 1) * 0.6 : 0;
      crowdNear = clamp(Math.sqrt(near / 36), 0, 1);
      crowdFar = clamp(Math.sqrt((mid + 0.35 * farN) / 420), 0, 1);
      crowdPan = near ? clamp(pn / near, -1, 1) * 0.6 : 0;
      fireBurn = Math.min(1.2, burnN * 0.08); fireBurnPan = burnN > 0.01 ? clamp(bp / Math.max(1, burnN * 4), -1, 1) * 0.5 : 0;
    }
    const playing = mode === 'play' || mode === 'cards' || mode === 'intro';
    bed('crowd_far', playing ? 0.15 + 0.85 * crowdFar : mode === 'victory' || camp || ending ? 0 : 0.2, 0, 0.8);
    bed('crowd_near', playing ? crowdNear : 0, crowdPan, 0.3);
    bed('bat_flap', playing ? batNear : 0, batPan, 0.25, 0.15); // the Bat Gremlins: one soft loop that follows the nearest
    // fire beds: lit troughs, braziers, burning goblins and (when given) the live fire field near the listener
    fireT -= dt;
    if (fireT <= 0) {
      fireT = 0.15;
      let I = 0, pw = 0;
      const tr = state?.troughs;
      if (tr) for (let i = 0; i < tr.length; i++) {
        if (!tr[i].lit) continue; const t = ARENA.oil.troughs[i]; if (!t) continue;
        const cx = clamp(lis.x, t.x0, t.x1), cz = clamp(lis.z, t.z0, t.z1); const dx = cx - lis.x, dz = cz - lis.z; const d2 = dx * dx + dz * dz;
        const w = 1 / (1 + d2 / 40); I += w; pw += w * (d2 > 0.25 ? (dx * lis.rx + dz * lis.rz) / Math.sqrt(d2) : 0);
      }
      const br = ARENA.braziers;
      for (let i = 0; i < br.length; i++) { const dx = br[i][0] - lis.x, dz = br[i][1] - lis.z; const d2 = dx * dx + dz * dz; const w = 0.22 / (1 + d2 / 6); I += w; pw += w * (d2 > 0.25 ? (dx * lis.rx + dz * lis.rz) / Math.sqrt(d2) : 0); }
      I += fireBurn; pw += fireBurn * fireBurnPan;
      const fp = fireProvider || (state?.fire && typeof state.fire.heat === 'function' ? state.fire : null);
      if (fp) {
        let hs = 0, hp = 0;
        for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4; const r = k & 1 ? 6 : 2.5; const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
          let hv = 0; try { hv = +fp.heat(lis.x + ox, lis.z + oz) || 0; } catch { hv = 0; }
          hv = clamp(hv, 0, 2) * (k & 1 ? 0.5 : 1); hs += hv; hp += hv * (ox * lis.rx + oz * lis.rz) / r;
        }
        I += hs * 0.35; pw += hp * 0.35;
      }
      if (mode === 'victory') I *= Math.max(0, 1 - modeClock / 4);
      fireI = I; firePan = I > 0.01 ? clamp(pw / I, -1, 1) * 0.7 : 0;
    }
    // the Ember Gale: the fire beds swell (≤ +35 %) over the gust's seconds, a sine bump, then back
    { const u = (simT - galeT0) / galeLen; galeK = u >= 0 && u <= 1 ? 1 + 0.35 * Math.sin(Math.PI * u) : 1; }
    bed('fire_low', galeK * (live || ending || mode === 'victory' ? smooth(0.02, 0.2, fireI) * (1 - 0.5 * smooth(0.7, 1.2, fireI)) : 0), firePan, 0.5);
    bed('fire_mid', galeK * (live || ending || mode === 'victory' ? smooth(0.3, 0.75, fireI) * (1 - 0.4 * smooth(1.1, 1.6, fireI)) : 0), firePan, 0.5);
    bed('fire_high', galeK * (live || ending || mode === 'victory' ? smooth(0.85, 1.5, fireI) : 0), firePan, 0.6);
    if (state && lanceOn && ((state.player && state.player.weapon !== 'lance') || mode !== 'play')) { lanceOn = false; bed('w_lance_loop', 0, 0, 0.08); }
    // hexed: the Lance loop chokes (random dips every 60–130 ms for 2 s), then comes back
    if (lanceOn && (simT < hexUntil || (state?.player?.sputterT ?? 0) > 0)) {
      hexWas = true; hexChopT -= dt;
      if (hexChopT <= 0) { hexChopT = 0.06 + rand() * 0.07; bed('w_lance_loop', rand() < 0.35 ? 0.08 : 0.35 + rand() * 0.65, 0, 0.012); }
    } else if (hexWas) { hexWas = false; if (lanceOn) bed('w_lance_loop', 1, 0, 0.05); }
    // Ember Orbit: the hum while state.orbit holds fireballs (an array, or { n | count }); it pans with the first orbs
    const orb = state ? state.orbit : null;
    orbitN = !orb ? 0 : typeof orb === 'number' ? orb : typeof orb.length === 'number' ? orb.length : (orb.n ?? orb.count ?? 0) | 0;
    let opan = 0;
    if (orbitN > 0 && typeof orb.length === 'number') {
      const k = Math.min(orbitN, 3); let m0 = 0;
      for (let i = 0; i < k; i++) { const o = orb[i]; if (!o || o.x == null) continue; const dx = o.x - lis.x, dz = o.z - lis.z; const d = Math.sqrt(dx * dx + dz * dz) + 0.01; opan += (dx * lis.rx + dz * lis.rz) / d; m0++; }
      opan = m0 ? clamp(opan / m0, -1, 1) * 0.45 : 0;
    }
    orbitLevel = orbitN > 0 && (mode === 'play' || mode === 'cards') ? 0.55 + 0.15 * Math.min(3, orbitN) : 0;
    bed('orbit_loop', orbitLevel, opan, orbitLevel ? 0.25 : 0.4, 0.05);
    // wind gusts
    windT -= dt;
    if (windT <= 0) { windT = 9 + rand() * 14; if (live) play('wind_gust', { pan: (rand() * 2 - 1) * 0.7, db: (camp ? -8 : -3) + rand() * 4, rate: 0.9 + rand() * 0.2 }); }
  }
  let fireBurn = 0, fireBurnPan = 0;
  let benchBeds = false;
  const TROLL_ROAR_AT = TIMELINE.troll.beats.find((b) => b.id === 'roar')?.at ?? 2.2;

  // ------------------------------------------------------------------------------------------------ control
  function unlock() {
    if (disposed) return;
    unlocked = true;
    startBackground('click'); // the title click starts the background load at the latest
    if (!suspended && ctx.state !== 'running') ctx.resume().catch(() => {});
    try { const b = ctx.createBuffer(1, 1, ctx.sampleRate); const s = ctx.createBufferSource(); s.buffer = b; s.connect(master); s.start(); } catch { /* */ }
    if (pendingMusic) { const n = pendingMusic; pendingMusic = null; musicName = null; music(n); }
  }
  function pause() { suspended = true; if (ctx.state === 'running') ctx.suspend().catch(() => {}); }
  function resume() { suspended = false; if (unlocked && ctx.state !== 'running') ctx.resume().catch(() => {}); }
  function setVolume(v) {
    volume = clamp(Number(v) || 0, 0, 1);
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t); master.gain.setTargetAtTime(muted ? 0 : volume * volume, t, 0.05);
  }
  /** a manual music state; it holds until the next mode change (then the state drives the music again) */
  let overrideBase = /** @type {string|null} */ (null);
  function musicManual(name) { overrideBase = autoMusic(lastState); musicOverride = name || null; if (musicOverride === 'dawn') dawnPlayed = true; music(musicOverride); }
  let lastState = /** @type {any} */ (null);
  const UI = { hover: 'card_hover', click: 'ui_click', pick: 'card_pick', open: 'ui_click', close: 'ui_click', levelup: 'levelup',
    // DESIGN §9: Brother Cinder's panel and the pads (the HUD may send these instead of the sim's events; not both)
    stall: 'npc_open', buy: 'shop_buy', equip: 'charm_equip', unequip: 'charm_equip', build: 'tower_build', upgrade: 'tower_upgrade', deny: 'w_dry', tab: 'card_hover',
    // the camp's BEGIN NIGHT button
    begin: 'ui_begin', start: 'ui_begin', 'begin-night': 'ui_begin' };
  function ui(name) { const id = /** @type {any} */ (UI)[name] || (SOUNDS[name] ? name : null); if (id) want(id, null, name === 'unequip' ? -3 : 0, name === 'unequip' ? 0.84 : 1); }
  const onUiEvent = (e) => ui(/** @type {any} */ (e).detail?.sound);
  globalThis.addEventListener?.('ew:ui', onUiEvent);
  // a line by DOM event (for the UI, which has no audio handle): the detail gets `seconds` back synchronously
  const onSayEvent = (e) => { const d = /** @type {any} */ (e).detail; if (d) d.seconds = say(d.line ?? d.id ?? d.text); };
  globalThis.addEventListener?.('ew:say', onSayEvent);
  function setFire(p) { fireProvider = p && typeof p.heat === 'function' ? p : null; }

  function dispose() {
    if (disposed) return;
    for (const s of slots) stopSlot(s, 0.02);
    for (const id of BEDS) { try { beds[id].src?.stop(); } catch { /* */ } }
    for (const id of LAYERS) { try { layers[id].src?.stop(); } catch { /* */ } }
    endCueStop(0.02);
    try { cur?.src.stop(); } catch { /* */ }
    disposed = true;
    globalThis.removeEventListener?.('ew:ui', onUiEvent); globalThis.removeEventListener?.('ew:say', onSayEvent);
    setTimeout(() => ctx.close().catch(() => {}), 80);
  }
  function stats() {
    let active = 0; const now = ctx.currentTime; for (const s of slots) if (s.active && now <= s.end) active++;
    /** @type {Record<string, { plays: number, drops: number }>} */
    const per = {}; for (const [id, st] of idState) if (st.plays || st.drops) per[id] = { plays: st.plays, drops: st.drops };
    return {
      state: ctx.state, unlocked, paused: suspended, muted, sampleRate: ctx.sampleRate, music: musicName, pendingMusic,
      loaded, failed, total, load: { started: bgStarted, why: startWhy, mode: startMode, workers: activeWorkers, maxInFlight }, voices: active, pool: POOL, played: voicesPlayed, dropped: voicesDropped, stolen, mode,
      beds: Object.fromEntries(BEDS.map((id) => [id, +beds[id].target.toFixed(3)])), crowdNear: +crowdNear.toFixed(2), crowdFar: +crowdFar.toFixed(2),
      fire: +fireI.toFixed(2), kindle: kindleUntil > simT, perId: per,
      organ: { on: organLevel > 0, starts: organStarts, rate: +organRate.toFixed(3) }, bats: { near: +batNear.toFixed(2), n: batN },
      layers: { a: +layers.mus_perc_a.level.toFixed(2), b: +layers.mus_perc_b.level.toFixed(2), syncs: layerSyncs }, rain: +rainLvl.toFixed(2), rainBoss, ending: [...endDone],
      night: curNight(lastState), npcOpen, soonHold, hexed: simT < hexUntil || (lastState?.player?.sputterT ?? 0) > 0, orbit: orbitN, stings: stingsPlayed, lines: linesSaid,
    };
  }

  const api = {
    unlock, onEvent, update, music: musicManual, pause, resume, setVolume, dispose,
    play: (id, o) => play(id, o || {}), want, ui, setFire, stats, get unlocked() { return unlocked; },
    /** resolves when every file decoded (asking for it starts the background load) */
    ready: () => { startBackground('ready()'); return loadDone; },
    /** the files in the order they were requested (for tests and the bench) */
    _fetchLog: () => fetchLog.slice(),
    say, lines: VOICE_LINES,
    /** a line's length in seconds without playing it (subtitle timing); 0 until it decoded */
    lineSeconds(line) { const k = lineKey(line); const l = k ? buffers.get(/** @type {any} */ (VOICE_LINES)[k].sound) : null; return l && l[0] ? l[0].buffer.duration : 0; },
    /** for the preview bench and tools */ _ctx: ctx, _out: limiter, _variants: (id) => variants(id).length, _bed: bed,
    _benchBeds(on) { benchBeds = !!on; },
    /** restart the current music loop `before` s ahead of its loop point (to hear the seam) */
    _seam(before = 4) {
      if (!cur || !cur.entry.loopEnd) return null;
      const old = cur; const e = old.entry; const L = e.loopEnd;
      try { old.src.onended = null; old.src.stop(); } catch { /* */ }
      const src = ctx.createBufferSource(); src.buffer = e.buffer; src.loop = true; src.loopStart = e.loopStart || 0; src.loopEnd = Math.min(L, e.buffer.duration); src.connect(old.gain);
      const t = ctx.currentTime + 0.02; const off = Math.max(0, L - before); src.start(t, off);
      cur = { ...old, src, startAt: t, offset: off };
      return { name: old.name, loopEnd: L, seamInS: before };
    },
    _slots() { return slots.map((x) => ({ id: x.id, active: x.active, t0: x.t0, end: x.end, loud: x.loud })); },
    /** the percussion layers vs the base loop: level and beat-phase offset (ms) */
    _layers() { const t = ctx.currentTime; return LAYERS.map((id) => { const l = layers[id]; if (!l.src || !cur || !cur.entry.bpm || !l.entry) return { id, level: l.level, on: false }; let d = beatPhase(l, t) - beatPhase(cur, t); d -= Math.round(d); return { id, level: l.level, on: true, diffMs: +(d * 60 / cur.entry.bpm * 1000).toFixed(2) }; }); },
    /** bench: fade every one-shot voice out (5 ms), so a play test gets a free slot */
    _stopAll() { for (const x of slots) stopSlot(x, 0.005); },
    /** decoded buffers: id → [{ dur, ch, rate, loopEnd }] */
    _info() {
      /** @type {Record<string, any[]>} */ const o = {};
      for (const [id, l] of buffers) o[id] = l.filter(Boolean).map((e) => ({ dur: +e.buffer.duration.toFixed(4), ch: e.buffer.numberOfChannels, rate: e.buffer.sampleRate, loopEnd: e.loopEnd ?? null, len: e.buffer.length }));
      return o;
    },
  };
  try { /** @type {any} */ (globalThis).__ewAudio = api; } catch { /* */ } // tests / debug: __ewAudio.stats()
  return api;
}

/**
 * A generated stereo impulse response for a hilltop outside a stone keep: a wall slap at ~22 ms and ~48 ms, then a short
 * diffuse tail (≈ 0.9 s to −60 dB) darkening over time. Built once at load (≈ 43k samples per channel).
 * @param {BaseAudioContext} ctx
 */
function makeHillIR(ctx) {
  const sr = ctx.sampleRate, len = Math.round(sr * 0.9), ir = ctx.createBuffer(2, len, sr);
  const r = mulberry(77);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c); let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr; const k = 0.25 + 0.7 * Math.min(1, t / 0.6); // darker as it decays
      lp += ((r() * 2 - 1) - lp) * (1 - k);
      d[i] = lp * Math.exp(-t * 7.6) * Math.min(1, t / 0.012) * 0.55;
    }
    for (const [ms, g] of [[22 + c * 3, 0.42], [48 - c * 4, 0.26], [83 + c * 6, 0.12]]) { const i0 = Math.round(ms / 1000 * sr); for (let j = 0; j < 24; j++) d[i0 + j] += g * (1 - j / 24) * (j % 2 ? -1 : 1); }
  }
  return ir;
}

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
