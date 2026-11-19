// @ts-check
// VALLEYWARD · the deterministic fixed-step sim (docs/DESIGN.md §2, §3.2, §14, docs/DESIGN.md §9): the roguelite loop at Valleyward
// Keep: Night I → camp → Night II → "coming soon" → camp → a new run; a fall → camp and a new run. 60 Hz, seeded RNG,
// pure JS (no three.js, no DOM): it runs the same in Node (tests, the bot) and in the browser (main.js). It produces
// `state` (read-only for every other module), events (src/shared/events.js) and fire ops (src/shared/fireops.js), and
// reads the fire back through a provider { heat(x, z), fuel(x, z) } (the GPU fluid's read-back or the CPU proxy).
// The save (meta.js SAVE_KEY) goes through a storage adapter { load(), save(obj) } (main.js: localStorage; Node: memory).
import { ARENA, BODY, groundHeight } from '../shared/arena.js';
import { EV, ENEMY_KINDS } from '../shared/events.js';
import { FIRE_OP, WIND, HUE_OF } from '../shared/fireops.js';
import { TIMELINE } from '../shared/timeline.js';
import { NIGHTS, DROPS, DROP_FLY_AFTER, CHARMS, CHARM_DUP_GOLD } from '../shared/meta.js';
import { DT, NIGHT, NIGHT2_MIX, IMP_MIX, HORDE, PICKUP, XP_NEXT, TROUGH, BARREL, ELITE, SKILL, LOOT, ENEMY, K, nightScale, LEVEL_HEAL } from './constants.js';
import { createRng } from './rng.js';
import { createFireProxy } from './fireproxy.js';
import { newPlayer, stepPlayer } from './player.js';
import { newHorde, createHordeSystem, ST } from './horde.js';
import { createWeapons } from './weapons.js';
import { createTroll } from './troll.js';
import { createTowers, towerSpots, towerCircles } from './towers.js';
import { createSkills } from './skills.js';
import { createAir } from './air.js';
import { createRams } from './ram.js';
import { createTwists } from './twists.js';
import { createBoss } from './boss.js';
import { CARD_BY_ID, drawCards, newMods } from './cards.js';
import { normalizeSave, blankSave, savePreset, applyLoadout, nextNpcLine, shopCommand, charmSlots, isFirstLaunch, bossPower, bossHpMul } from './run.js';
import { setFlowObstacles } from './world.js';

export { DT };
const EV_XP_GAIN = EV.XP_GAIN;
export const NO_INPUT = Object.freeze({ fwd: 0, right: 0, sprint: false, jump: false, yaw: null, pitch: null, fire: false, firePress: false,
  bomb: false, weapon: 0, wheel: 0, reload: false, kindle: false, ult: false, card: 0 });
const ELITE_NAMES = Object.freeze({ chief: 'Goblin Chieftain', hexer: 'Hexer' });
/** A storage adapter in memory (Node, tests; the browser passes localStorage's, src/core/save.js). */
export function memoryStorage(init = null) { let v = init ? JSON.parse(JSON.stringify(init)) : null; return { load: () => (v ? JSON.parse(JSON.stringify(v)) : null), save: (o) => { v = JSON.parse(JSON.stringify(o)); }, clear: () => { v = null; } }; }

/**
 * @param {{ seed?: number, quality?: 'high'|'medium'|'low', god?: boolean, cap?: number, spawnScale?: number,
 *   storage?: { load(): any, save(o: any): void, clear?(): void }, save?: 'fresh'|'mid'|'rich'|object }} [opts]
 */
export function createSim(opts = {}) {
  const quality = opts.quality || 'high';
  const cap = opts.cap || HORDE.cap[quality] || HORDE.cap.high;
  let god = !!opts.god, attempt = 0;
  const baseSeed = Math.max(1, Math.floor(opts.seed || 1));
  /** @type {any[]} */ let events = [];
  const proxy = createFireProxy();
  let provider = /** @type {any} */ (proxy);
  const storage = opts.storage || memoryStorage();
  /** The save (permanent): from a preset, an object, the storage, or blank. */
  let meta = /** @type {any} */ (null);
  if (typeof opts.save === 'string') { meta = savePreset(opts.save); storage.save(meta); }
  else if (opts.save && typeof opts.save === 'object') { meta = normalizeSave(opts.save) || blankSave(); storage.save(meta); }
  else { try { meta = normalizeSave(storage.load()); } catch { meta = null; } meta ||= blankSave(); }
  const hadSave = !isFirstLaunch(meta);
  /** The run: the towers, the gold not yet banked, the cards/level carried into the next night. */
  const newRun = () => ({ runN: meta.runN, night: 1, towers: [], goldRun: 0, gold: 0, carry: { taken: {}, level: 1, xp: 0 }, spots: [], started: false });
  let run = newRun();
  if (meta.run) Object.assign(run, { night: meta.run.night, towers: meta.run.towers.map((t) => ({ ...t })), carry: { taken: { ...meta.run.taken }, level: meta.run.level, xp: meta.run.xp }, started: true });
  const cmdQueue = /** @type {any[]} */ ([]);

  const ctx = /** @type {any} */ ({
    state: null, rng: null, mods: newMods(), spawnScale: opts.spawnScale ?? 1, nightCfg: NIGHTS[0], nightMix: NIGHT.mix,
    emit(type, payload) { events.push({ t: +ctx.state.t.toFixed(4), ...payload, type }); },   // (the event's type always wins over a payload key)
    op(o) { (inStep ? ctx.state.fireOps : pending).push(o); },
    get fire() { return provider; },
    proxyMods(m) { proxy.setMods(m); },
  });

  /** Write the save (the run in progress between nights included). */
  function persist() {
    meta.run = run.ended ? null : run.started || run.towers.length ? { night: run.night, towers: run.towers.map((t) => ({ pad: t.pad, type: t.type, level: t.level })), taken: { ...run.carry.taken }, level: run.carry.level, xp: run.carry.xp } : null;
    try { storage.save(meta); } catch { /* storage is a convenience */ }
  }

  /** A fresh night state for night n (the camp before it uses the same state, in mode 'camp'). */
  function fresh(n, mode = 'title') {
    const seed = baseSeed + attempt * 7919;
    ctx.rng = createRng(seed);
    const cfg = NIGHTS[Math.max(0, Math.min(NIGHTS.length - 1, n - 1))];
    ctx.nightCfg = cfg;
    ctx.ns = nightScale(cfg.n);   // DESIGN §5.7: the goblins grow with the night
    // DESIGN §8: the night's spawn mix ('n1' | 'n2' | 'imps'), Dousers ×douserMul (Night IV)
    let mix = cfg.mix === 'imps' ? IMP_MIX : cfg.mix === 'n1' || cfg.n < 2 ? NIGHT.mix : NIGHT2_MIX;
    if (cfg.douserMul > 1) mix = mix.map((m) => { const w = m.w.slice(); const extra = w[6] * (cfg.douserMul - 1); w[6] += extra; w[0] = Math.max(0, w[0] - extra); return { at: m.at, w }; });
    ctx.nightMix = mix;
    const elitePlan = [];
    for (const [kind, times] of Object.entries(cfg.elites || {})) for (const at of times) elitePlan.push({ kind, at });
    elitePlan.sort((a, b) => a.at - b.at);
    ctx.state = {
      t: 0, tick: 0, mode, modeT: 0, paused: false, seed, attempt, timeScale: 1, quality,
      night: { n: cfg.n, name: cfg.name, title: cfg.title || '', twist: cfg.twist || null, moon: cfg.moon, kindleLockT: 0, clock: 0, dawnAt: NIGHT.dawnAt, kindle: 0, kindleCd: 0, kindleT: 0, waveN: 0, galeT: 0, edge: false,
        trollQueue: cfg.trolls.slice(), trollsArrived: 0, elitePlan: elitePlan.slice(0, ELITE.maxPerNight), elitesSpawned: 0 },
      player: newPlayer(), gate: { hp: ARENA.gate.hp, hpMax: ARENA.gate.hp }, troll: null, horde: newHorde(cap),
      pickups: [], bombs: [], spears: [], boulders: [],
      troughs: ARENA.oil.troughs.map((t) => ({ id: t.id, oil: 1, lit: false, refillT: 0, emberT: 0 })),
      barrels: ARENA.oil.barrels.map(() => ({ alive: true, fuse: -1 })),
      wind: { x: 0, z: -WIND.base }, fireOps: [], cards: null, taken: {}, mods: ctx.mods,
      stats: { kills: 0, burned: 0, shots: 0, timeAlive: 0, level: 1, gateLost: 0, gold: 0, kindles: 0, trollKilled: false, cards: [], killedBy: { fire: 0, bullet: 0, blast: 0 }, night: cfg.n, charms: [] },
      ring: null, fireSource: provider === proxy ? 'proxy' : 'module',
      // DESIGN §9: the save, the run, the camp, and what the new systems draw from
      meta, run, camp: { near: null, panel: null, padId: null, nextNight: cfg.n, tip: false },
      orbit: [], meteors: [], chains: [], hexes: [], splashes: [], elites: [], air: [],
      // DESIGN §8: rams, the weather, the Rainmother, the coven's chant, her whirlpools, the ending
      rams: [], weather: { rain: 0, squall: false }, boss: null, coven: [], whirls: [], ending: null,
      /** aliases the HUD reads: the save, and the run's towers with their pad positions */
      get save() { return meta; },
      get towers() { return run.spots; },
    };
    ctx.horde = createHordeSystem(ctx);
    ctx.weapons = createWeapons(ctx);
    ctx.troll = createTroll(ctx);
    ctx.towers = createTowers(ctx);
    ctx.skills = createSkills(ctx);
    ctx.air = createAir(ctx);
    ctx.rams = createRams(ctx);
    ctx.twists = createTwists(ctx);
    ctx.bossSys = createBoss(ctx);
    applyLoadout(ctx, run.carry);
    run.spots = towerSpots(run.towers);
    setFlowObstacles(towerCircles(run.towers));
    wind.a0 = Math.PI + 0.3; wind.ph = ctx.rng.range(0, 6.28); wind.next = ctx.rng.range(WIND.gustEvery[0], WIND.gustEvery[1]); wind.gs = -1; wind.amp = 0;
    pickupId = 1; gateAcc = 0; gateAccT = 0; dropCaps.xp = 0; dropCaps.gold = 0; goldTick.value = 0; goldTick.n = 0;
    xpBatch.value = 0; xpBatch.count = 0; xpBatch.n = 0; xpBatch.t = 0; xpBatch.spots = [];
    xpTick.value = 0; xpTick.n = 0; xpTick.from = [];
    proxy.reset();
  }
  const wind = { a0: 0, ph: 0, next: 0, gs: -1, amp: 0 };
  let pickupId = 1, gateAcc = 0, gateAccT = 0;
  const dropCaps = { xp: 0, gold: 0 }, goldTick = { value: 0, n: 0, pos: null };
  /** Credited XP since the last EV.PICKUP 'xp' (one event per XP_FLUSH s: the audio tick). */
  const xpBatch = { value: 0, count: 0, n: 0, t: 0, spots: /** @type {any[]} */ ([]) };
  const XP_FLUSH = 0.15;
  /** This tick's credited XP: one EV.XP_GAIN { value, n, from: ≤ 8 positions } per tick (the FX's wisps). */
  const xpTick = { value: 0, n: 0, from: /** @type {any[]} */ ([]) };
  function flushXpTick() {
    if (xpTick.n) { ctx.emit(EV_XP_GAIN, { value: +xpTick.value.toFixed(2), n: xpTick.n, from: xpTick.from }); xpTick.value = 0; xpTick.n = 0; xpTick.from = []; }
    if (goldTick.n) { ctx.emit(EV.PICKUP, { kind: 'gold', value: +goldTick.value.toFixed(2), count: goldTick.n, pos: goldTick.pos }); goldTick.value = 0; goldTick.n = 0; }
    dropCaps.xp = 0; dropCaps.gold = 0;
  }
  function flushXp(force = false) {
    const st = ctx.state;
    if (!xpBatch.count || (!force && st.t - xpBatch.t < XP_FLUSH)) return;
    const spots = xpBatch.spots.slice(0, Math.min(4, xpBatch.n));
    ctx.emit(EV.PICKUP, { kind: 'xp', value: +xpBatch.value.toFixed(2), count: xpBatch.count, pos: spots[(xpBatch.n - 1) % 4], spots, from: 'gem' });
    xpBatch.value = 0; xpBatch.count = 0; xpBatch.n = 0; xpBatch.t = st.t; xpBatch.spots = [];
  }
  let inStep = false, pending = /** @type {any[]} */ ([]);

  function setMode(m) {
    const st = ctx.state, prev = st.mode;
    if (prev === m) return;
    st.mode = m; st.modeT = 0;
    ctx.emit(EV.MODE, { mode: m, prev });
  }
  const douseAll = () => { for (let x = -14; x <= 44; x += 12) for (let z = 4; z <= 62; z += 12) ctx.op({ kind: FIRE_OP.DOUSE, x, z, r: 9 }); };

  // ---------------------------------------------------------------------------------------------- shared helpers (ctx)
  ctx.hurtPlayer = (dmg, source, dir) => {
    const st = ctx.state, p = st.player;
    if (!p.alive || st.mode !== 'play') return;
    if (god) return;   // god mode: no damage and no hurt event (captures and probes: no red hurt edge in the key-art views)
    if (source === 'fire') return;   // DESIGN §3.3: the Lamplighter is immune to fire
    dmg *= ctx.mods.dmgTaken;   // Hide, Cinder Ward
    p.hp = Math.max(0, p.hp - dmg);
    p.hurtT = 0;
    ctx.emit(EV.P_HURT, { pos: { x: p.x, y: p.y, z: p.z }, dmg: +dmg.toFixed(2), source, dir: dir || { x: 0, z: 0 } });
    if (p.hp <= 0) {
      p.alive = false; p.jet.on = false;
      ctx.emit(EV.P_DEATH, { pos: { x: p.x, y: p.y, z: p.z } });
      fall('player');
    }
  };
  ctx.hurtGate = (dmg, pos) => {
    const st = ctx.state, g = st.gate;
    if (st.mode !== 'play') return;
    if (god) dmg = 0;
    g.hp = Math.max(0, g.hp - dmg);
    st.stats.gateLost += dmg;
    ctx.emit(EV.GATE_HIT, { pos: pos || { x: 0, y: 2, z: 0 }, dmg, hpFrac: g.hp / g.hpMax });
    if (g.hp <= 0) { ctx.emit(EV.GATE_BREACH, {}); fall('gate'); }
  };
  ctx.ground = (x, z) => groundY(x, z);
  /** A pickup spills from (x, y, z): it hops out, waits DROP_FLY_AFTER s, then flies to the Lamplighter (DESIGN §9.3). */
  function addPickup(kind, x, y, z, value, extra) {
    const st = ctx.state;
    if (st.pickups.length >= PICKUP.cap) credit(st.pickups.shift());   // never lost: the oldest is credited at once
    const a = ctx.rng.next() * Math.PI * 2, sp = LOOT.spill * (0.5 + ctx.rng.next());
    const g = { id: pickupId++, kind, x, y, z, y0: y, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, value, t: 0, fly: false, ...(extra || {}) };
    st.pickups.push(g);
    return g;
  }
  ctx.drop = (kind, x, z, value) => addPickup(kind, x, groundY(x, z) + 0.35, z, value);
  /** Loot from a kill (meta.js DROPS): an XP gem, coins by chance, a charm from elites (DESIGN §16: no hearts). */
  ctx.loot = (kindIdx, x, y, z) => lootAt(ENEMY_KINDS[kindIdx], x, y, z);
  ctx.lootAt = (kind, x, y, z) => lootAt(kind, x, y, z);
  function lootAt(kind, x, y, z) {
    const st = ctx.state, D = DROPS[kind]; if (!D || st.mode !== 'play') return;   // nothing drops after dawn or a fall
    const r = ctx.rng, gy = Math.max(groundY(x, z) + 0.35, y + 0.35);
    const xp = D.xp * (st.night.kindleT > 0 ? NIGHT.kindleXp : 1);
    addPickup('xp', x, gy, z, xp);
    if (dropCaps.xp++ < LOOT.eventCap) ctx.emit(EV.XP_DROP, { pos: { x, y: gy, z }, value: xp, n: 1, kind });
    if (r.next() < D.gold * LOOT.goldMul) {
      for (let c = 0; c < D.coins; c++) addPickup('gold', x, gy, z, 1);
      if (dropCaps.gold++ < LOOT.eventCap) ctx.emit(EV.GOLD_DROP, { pos: { x, y: gy, z }, value: D.coins, n: D.coins, kind });
    }
    r.next();   // (DESIGN §3.4: no heart drops; the draw stays so the loot stream keeps its order)
    if (D.charm > 0 && r.next() < D.charm) {
      const notOwned = CHARMS.filter((c) => !meta.charms.owned.includes(c.id) && !st.pickups.some((g) => g.kind === 'charm' && g.charm === c.id));
      const ch = notOwned.length ? notOwned[r.int(notOwned.length)] : CHARMS[r.int(CHARMS.length)];
      addPickup('charm', x, gy, z, 0, { charm: ch.id });
      ctx.emit(EV.CHARM_DROP, { pos: { x, y: gy, z }, charm: ch.id });
    }
  }
  /** Credit a pickup that reached the Lamplighter. */
  function credit(g) {
    if (!g) return;
    const st = ctx.state, p = st.player, pos = { x: g.x, y: g.y, z: g.z };
    if (g.kind === 'xp') {
      p.xp += g.value;
      xpBatch.value += g.value; xpBatch.count++; xpBatch.spots[xpBatch.n % 4] = pos; xpBatch.n++;
      xpTick.value += g.value; xpTick.n++; if (xpTick.from.length < 8) xpTick.from.push(pos);
    } else if (g.kind === 'gold') {
      const v = g.value * ctx.mods.gold;
      run.goldRun += v; run.gold = Math.floor(run.goldRun); st.stats.gold += v;
      goldTick.value += v; goldTick.n++; goldTick.pos = pos;
    } else if (g.kind === 'heart') {
      p.hp = Math.min(p.hpMax, p.hp + g.value); ctx.emit(EV.P_HEAL, { amount: g.value, source: g.soul ? 'soul-feast' : 'heart' });
      ctx.emit(EV.PICKUP, { kind: 'heart', value: g.value, pos });
    } else if (g.kind === 'charm') {
      const dup = meta.charms.owned.includes(g.charm);
      let gold = 0;
      if (dup) { gold = CHARM_DUP_GOLD; meta.gold += gold; }
      else {
        meta.charms.owned.push(g.charm);
        if (meta.charms.equipped.length < charmSlots(meta)) { meta.charms.equipped.push(g.charm); ctx.emit(EV.CHARM_EQUIP, { charm: g.charm, slot: meta.charms.equipped.length - 1, on: true, auto: true }); }
      }
      st.stats.charms.push(g.charm);
      ctx.emit(EV.CHARM_PICKUP, { charm: g.charm, dup, gold, pos });
      persist();
    }
  }
  /** Every pickup still out there is credited (dawn, a fall: the run's gold is never lost). */
  function collectAll() { const st = ctx.state; for (const g of st.pickups) credit(g); st.pickups.length = 0; flushXpTick(); flushXp(true); }
  /** Bank the run's gold into the save (dawn and a fall). */
  function bank() { const g = Math.floor(run.goldRun + 1e-6); meta.gold += g; run.goldRun -= g; if (run.goldRun < 1e-6) run.goldRun = 0; run.gold = Math.floor(run.goldRun); return g; }

  ctx.blast = (x, y, z, r, dmg, igniteR, trollHeat) => {
    const H = ctx.state.horde, R = Math.max(r, igniteR);
    ctx.horde.hash.query(x, z, R, (i) => {
      const s = H.state[i]; if (s === ST.DEAD || s === ST.DYING) return false;
      const d = Math.hypot(H.x[i] - x, H.z[i] - z);
      if (igniteR && d < igniteR) ctx.horde.ignite(i);
      if (dmg && d < r) ctx.horde.damage(i, dmg, 'blast', null);
      return false;
    });
    const tr = ctx.state.troll;
    if (tr && tr.alive && Math.hypot(tr.x - x, tr.z - z) < R + BODY.troll.radius) { if (trollHeat) ctx.troll.heatUp(trollHeat); if (dmg) ctx.troll.hit(dmg, 'blast'); }
    if (dmg && ctx.state.rams.length) ctx.rams.blast(x, z, r, dmg);   // DESIGN §5.6
    if (dmg && ctx.state.boss) ctx.bossSys.blast(x, z, r, dmg);       // DESIGN §6.3
    void y;
  };
  ctx.burstBarrel = (b) => {
    const st = ctx.state, bar = st.barrels[b];
    if (!bar || !bar.alive) return;
    bar.alive = false;
    const [x, z] = ARENA.oil.barrels[b], y = groundY(x, z);
    ctx.emit(EV.BARREL_BURST, { idx: b, pos: { x, y, z } });
    ctx.op({ kind: FIRE_OP.BURST, x, z, r: BARREL.burstR, amount: 1.2 * ctx.mods.fireAmount, push: 8, hue: HUE_OF.barrel });
    ctx.op({ kind: FIRE_OP.FUEL, x, z, r: BARREL.fuelR, amount: 1 });
    ctx.blast(x, y, z, BARREL.blastR, BARREL.blastDmg, BARREL.burstR, 0.6);
    ARENA.oil.barrels.forEach(([bx, bz], k) => { if (k !== b && st.barrels[k].alive && st.barrels[k].fuse < 0 && Math.hypot(bx - x, bz - z) < 4) st.barrels[k].fuse = BARREL.fuse; });
  };
  ctx.throwSpear = (i) => ctx.weapons.throwSpear(i);
  /** A Hexer throws a hex at the Lamplighter (lands after its flight; a hit makes the Lance sputter). */
  ctx.throwHex = (i) => {
    const st = ctx.state, H = st.horde, p = st.player, E = ELITE.hexer;
    const from = { x: H.x[i], y: H.y[i] + 1.3, z: H.z[i] }, d = Math.hypot(p.x - from.x, p.z - from.z), flight = Math.max(0.5, d / E.speed);
    const to = { x: p.x + p.vx * flight * 0.7 + ctx.rng.range(-0.6, 0.6), y: p.y + 1.0, z: p.z + p.vz * flight * 0.7 + ctx.rng.range(-0.6, 0.6) };
    st.hexes.push({ id: i, fx: from.x, fy: from.y, fz: from.z, tx: to.x, ty: to.y, tz: to.z, x: from.x, y: from.y, z: from.z, t: 0, flight });
  };
  /** A Douser throws water at the hottest fire within reach (a lit trough first). Returns false when there is none. */
  ctx.douse = (i) => {
    const st = ctx.state, H = st.horde, E = ELITE.douser, x = H.x[i], z = H.z[i];
    let bx = 0, bz = 0, bh = 0;
    ARENA.oil.troughs.forEach((T, k) => {
      if (!st.troughs[k].lit) return;
      const cx = Math.max(T.x0, Math.min(T.x1, x)), cz = Math.max(T.z0, Math.min(T.z1, z)), d = Math.hypot(cx - x, cz - z);
      if (d <= E.reach && 1 + (E.reach - d) / E.reach > bh) { bh = 1 + (E.reach - d) / E.reach; bx = cx; bz = cz; }
    });
    if (!bh) {
      const f = provider;
      for (const r of [2.5, 5, 8]) for (let a = 0; a < 6; a++) {
        const sx = x + Math.cos(a * 1.047 + r) * r, sz = z + Math.sin(a * 1.047 + r) * r, h = f.heat(sx, sz);
        if (h >= E.minHeat && h > bh) { bh = h; bx = sx; bz = sz; }
      }
    }
    if (!bh) return false;
    const from = { x, y: H.y[i] + 1.2, z }, to = { x: bx, y: groundY(bx, bz), z: bz };
    st.splashes.push({ id: i, fx: from.x, fy: from.y, fz: from.z, tx: to.x, ty: to.y, tz: to.z, x: from.x, y: from.y, z: from.z, t: 0, flight: E.flight, r: E.r });
    ctx.emit(EV.DOUSE_THROW, { id: i, from, to, r: E.r, flight: E.flight });
    return true;
  };
  ctx.eliteDied = (i) => { const st = ctx.state; st.elites = st.elites.filter((e) => e.id !== i); };
  ctx.fall = (cause) => fall(cause);
  ctx.isGod = () => god;
  ctx.proxyRain = (r) => proxy.setRain(r);

  let groundY = groundHeight;
  // ---------------------------------------------------------------------------------------------- flow
  function fall(cause) {
    const st = ctx.state;
    if (st.mode !== 'play') return;
    st.stats.timeAlive = st.night.clock;
    collectAll();
    const goldBanked = bank();
    ctx.emit(EV.FALLEN, { cause, stats: { ...st.stats } });
    ctx.emit(EV.RUN_END, { reason: 'fall', night: st.night.n, stats: { ...st.stats }, goldBanked });
    meta.bestNight = Math.max(meta.bestNight, st.night.n - 1);
    meta.npc.pending = 'fall';
    run.ended = true;   // the run is over (the save says so at once); its towers stay drawn until the camp starts a new one
    persist();
    setMode('fallen');
  }
  function fillTroughs() {
    for (const t of ARENA.oil.troughs) ctx.op({ kind: FIRE_OP.FUEL, box: { x0: t.x0, z0: t.z0, x1: t.x1, z1: t.z1 }, amount: 1 });
  }
  function startNight() {
    const st = ctx.state;
    if (st.mode === 'play') return false;
    const p = st.player, s = ARENA.playerSpawn;
    Object.assign(p, { x: s.x, y: 0, z: s.z, vx: 0, vy: 0, vz: 0, onGround: true, yaw: s.yaw });
    p.safe = { x: s.x, y: 0, z: s.z };
    if (!run.started) {
      meta.runN++; run.runN = meta.runN; run.started = true; run.goldRun = 0;
      ctx.emit(EV.RUN_START, { runN: run.runN, night: st.night.n });
    }
    run.night = st.night.n;
    // the power the Lamplighter brings into the night (analytics only since DESIGN §16)
    st.night.power = +bossPower(meta, run).toFixed(4); st.night.hpMul = 1;   // (DESIGN §5.7: the power scaling reversed: fixed boss HP; power stays an analytics number)
    persist();
    fillTroughs();
    setMode('play');
    ctx.emit(EV.NIGHT_START, { night: st.night.n });
    return true;
  }
  /** Dusk at the keep between nights (DESIGN §9.2): the next night's state, no horde, free movement. */
  function enterCamp(reason) {
    const prev = ctx.state.mode;
    if (reason === 'fall' || reason === 'complete') { run = newRun(); }
    attempt++;
    fresh(run.night, 'camp');
    const st = ctx.state, p = st.player, s = ARENA.playerSpawn;
    Object.assign(p, { x: s.x, y: 0, z: s.z, yaw: -Math.PI / 2, pitch: 0.02 });
    p.safe = { x: s.x, y: 0, z: s.z };
    pending = [];
    douseAll();
    ctx.emit(EV.MODE, { mode: 'camp', prev });
    // DESIGN §9.2: the first camp of a save shows the 3-step tip (talk to Brother Cinder · build on a pad · begin the night)
    if (!meta.story.seen.includes('camp-tip')) { st.camp.tip = true; meta.story.seen.push('camp-tip'); }
    ctx.emit(EV.CAMP_ENTER, { nextNight: run.night, reason, tip: st.camp.tip });
    persist();
  }
  function leaveCamp() {
    const st = ctx.state, c = st.camp;
    if (c.panel === 'npc') ctx.emit(EV.NPC_CLOSE, {});
    c.panel = null; c.padId = null;
    st.night.fromCamp = true;
    applyLoadout(ctx, run.carry);   // upgrades and charms bought at the camp apply at nightfall (DESIGN §9.2)
    ctx.emit(EV.CAMP_LEAVE, { night: st.night.n, duration: TIMELINE.campLeave.duration });
    setMode('intro');
  }
  function openNpc() {
    const st = ctx.state;
    st.camp.panel = 'npc'; st.camp.padId = null;
    ctx.emit(EV.NPC_OPEN, {});
    ctx.emit(EV.NPC_LINE, { line: nextNpcLine(meta) });
    persist();
  }
  function openPad(pad) {
    const c = ctx.state.camp;
    c.panel = 'pad'; c.padId = pad;
    ctx.emit('pad.open', { pad, tower: ctx.state.run.towers.find((t) => t.pad === pad) || null });   // (not in EV: main.js calls ui.panel('pad'))
  }
  function closePanel() {
    const c = ctx.state.camp;
    if (!c.panel) return;
    ctx.emit(c.panel === 'npc' ? EV.NPC_CLOSE : 'pad.close', { panel: c.panel, pad: c.padId });
    c.panel = null; c.padId = null; c.closedAt = ctx.state.t;
  }
  /** Apply one command (the UI through main.js, or the bot's `cmds`), at the start of a tick: deterministic. */
  function applyCommand(c) {
    const st = ctx.state;
    if (!c || typeof c !== 'object') return false;
    if (c.act === 'skipEnding') {
      const E = st.ending;
      if (st.mode !== 'ending' || !E || !E.skippable || E.t < TIMELINE.ending.skippableAfter) return false;
      E.t = TIMELINE.ending.beats[TIMELINE.ending.beats.length - 1].at - DT; return true;   // to the card (the beats in between still fire, in one tick)
    }
    if (c.act === 'continue' && st.mode === 'ending') {
      if (!st.ending || st.ending.beat !== 'card') return false;
      enterCamp('complete'); return true;   // Play again: a new run (the camp before Night I)
    }
    if (c.act === 'continue') {
      if (st.mode === 'victory' && st.victoryShown) { enterCamp(st.night.n >= NIGHTS.length ? 'complete' : 'dawn'); return true; }
      if (st.mode === 'fallen' && st.modeT >= 0.5) { enterCamp('fall'); return true; }
      return false;
    }
    if (st.mode !== 'camp') return false;
    if (c.act === 'close') { closePanel(); return true; }
    if (c.act === 'open') { if (c.panel === 'npc') openNpc(); else if (c.panel === 'pad' && c.pad) openPad(c.pad); return true; }
    if (c.act === 'kindle') { leaveCamp(); return true; }
    if (c.act === 'beginNight') { if (st.modeT < TIMELINE.camp.hold) return false; leaveCamp(); return true; }   // DESIGN §9.2: the BEGIN NIGHT button   // DESIGN §9.2: the BEGIN NIGHT button
    const r = shopCommand(st, c);
    if (r.ok) {
      ctx.emit(r.ev[0], r.ev[1]);
      if (r.towers) { run.spots = towerSpots(run.towers); setFlowObstacles(towerCircles(run.towers)); }
      if (c.act === 'equip' || c.act === 'buy' || c.act === 'buyOrgan' || c.act === 'equipOrgan') applyLoadout(ctx, run.carry);   // the camp's Lamplighter shows it at once (HP, the charm's hue)
      persist();
    } else ctx.emit('shop.denied', { act: c.act, item: c.item || c.charm || c.type || c.pad, reason: r.reason });
    return r.ok;
  }

  // ---------------------------------------------------------------------------------------------- per-tick systems
  function updateWind(dt) {
    const st = ctx.state, t = st.t;
    if (t >= wind.next) { wind.gs = t; wind.amp = ctx.rng.range(WIND.gustMax * 0.5, WIND.gustMax) - WIND.base; wind.next = t + ctx.rng.range(WIND.gustEvery[0], WIND.gustEvery[1]); }
    let gust = 0;
    if (wind.gs >= 0 && t - wind.gs < 5) gust = wind.amp * Math.sin(Math.PI * (t - wind.gs) / 5);
    let a = wind.a0 + 0.5 * Math.sin(t / 37 + wind.ph) + 0.25 * Math.sin(t / 13 + wind.ph * 2);
    let sp = WIND.base + gust;
    if (st.night.galeT > 0) { a = 0; sp = Math.max(sp, SKILL.gale.wind); }   // DESIGN §10.4 Ember Gale: downhill (+z) at gale strength
    st.wind.x = Math.sin(a) * sp; st.wind.z = Math.cos(a) * sp;
  }
  function updateOil(dt) {
    const st = ctx.state, f = provider;
    ARENA.oil.troughs.forEach((T, k) => {
      const tr = st.troughs[k];
      if (tr.refillT > 0) { tr.refillT -= dt; if (tr.refillT <= 0) { tr.refillT = 0; tr.oil = 1; ctx.op({ kind: FIRE_OP.FUEL, box: { x0: T.x0, z0: T.z0, x1: T.x1, z1: T.z1 }, amount: 1 }); ctx.emit(EV.TROUGH_FULL, { id: tr.id }); } return; }
      const long = T.x1 - T.x0 >= T.z1 - T.z0, n = TROUGH.points;
      const pt = (u) => (long ? [T.x0 + (T.x1 - T.x0) * u, (T.z0 + T.z1) / 2] : [(T.x0 + T.x1) / 2, T.z0 + (T.z1 - T.z0) * u]);
      if (tr.dousedT > 0) tr.dousedT -= dt;
      if (!tr.lit && tr.oil > 0 && !(tr.dousedT > 0)) {
        for (let i = 0; i < n; i++) { const [x, z] = pt((i + 0.5) / n); if (f.heat(x, z) >= TROUGH.igniteHeat) { tr.lit = true; ctx.emit(EV.TROUGH_LIT, { id: tr.id }); break; } }
      }
      if (tr.lit) {
        tr.oil = Math.max(0, tr.oil - dt / TROUGH.burnSeconds);
        tr.emberT -= dt;
        if (tr.emberT <= 0) { tr.emberT = TROUGH.emberEvery; for (let i = 0; i < n; i++) { const [x, z] = pt((i + 0.5) / n); ctx.op({ kind: FIRE_OP.EMBER, x, z, amount: 1, hue: HUE_OF.trough }); } }
        if (tr.oil <= 0) { tr.lit = false; tr.refillT = ARENA.oil.refillSeconds; ctx.emit(EV.TROUGH_OUT, { id: tr.id }); }
      }
    });
    ARENA.oil.barrels.forEach(([x, z], k) => {
      const b = st.barrels[k];
      if (!b.alive) return;
      if (b.fuse < 0 && f.heat(x, z) >= BARREL.igniteHeat) b.fuse = BARREL.fuse;
      if (b.fuse >= 0) { b.fuse -= dt; if (b.fuse <= 0) ctx.burstBarrel(k); }
    });
  }
  /** Pickups: spill (hop out), then after DROP_FLY_AFTER s fly to the chest (accelerating); the magnet reach collects at once. */
  function updatePickups(dt) {
    const st = ctx.state, p = st.player, mag = p.magnet;
    for (let k = st.pickups.length - 1; k >= 0; k--) {
      const g = st.pickups[k];
      g.t += dt;
      const dx = p.x - g.x, dz = p.z - g.z, dy = p.y + 0.9 - g.y, dh = Math.hypot(dx, dz);
      if (!g.fly) {
        if (p.alive && (g.t >= DROP_FLY_AFTER || (dh < mag && Math.abs(dy) < 7))) g.fly = true;
        else {
          const u = Math.min(1, g.t / DROP_FLY_AFTER), damp = 1 - u;
          g.x += g.vx * dt * damp; g.z += g.vz * dt * damp;
          g.y = Math.max(groundY(g.x, g.z) + 0.35, g.y0 + 1.6 * u * (1 - u) * 2);
          continue;
        }
      }
      const d = Math.hypot(dh, dy) || 1, sp = Math.min(LOOT.flyMax, LOOT.fly0 + LOOT.flyAccel * Math.max(0, g.t - DROP_FLY_AFTER)), v = Math.min(d, sp * dt);
      g.x += dx / d * v; g.y += dy / d * v; g.z += dz / d * v;
      if (d - v < 0.7) { st.pickups.splice(k, 1); credit(g); }
    }
  }
  function updateHexes(dt) {
    const st = ctx.state, p = st.player, E = ELITE.hexer;
    for (let k = st.hexes.length - 1; k >= 0; k--) {
      const h = st.hexes[k];
      h.t += dt;
      const u = Math.min(1, h.t / h.flight);
      h.x = h.fx + (h.tx - h.fx) * u; h.z = h.fz + (h.tz - h.fz) * u; h.y = h.fy + (h.ty - h.fy) * u + 2.5 * u * (1 - u);
      if (u < 1) continue;
      st.hexes.splice(k, 1);
      const hit = p.alive && Math.hypot(p.x - h.tx, p.z - h.tz) < E.hitR && Math.abs(p.y + 1 - h.ty) < 1.6;
      if (hit) { p.sputterT = E.sputter; if (p.jet.on) p.jet.on = false; }
      ctx.emit(h.src === 'boss' ? 'boss.hex' : EV.HEX, { from: { x: h.fx, y: h.fy, z: h.fz }, to: { x: h.tx, y: h.ty, z: h.tz }, hit, flight: h.flight });
    }
  }
  function updateSplashes(dt) {
    const st = ctx.state, H = st.horde;
    for (let k = st.splashes.length - 1; k >= 0; k--) {
      const s = st.splashes[k];
      s.t += dt;
      const u = Math.min(1, s.t / s.flight);
      s.x = s.fx + (s.tx - s.fx) * u; s.z = s.fz + (s.tz - s.fz) * u; s.y = s.fy + (s.ty - s.fy) * u + 2.2 * u * (1 - u);
      if (u < 1) continue;
      st.splashes.splice(k, 1);
      ctx.op({ kind: FIRE_OP.DOUSE, x: s.tx, z: s.tz, r: s.r });
      // a doused trough goes out (its oil stays: it can be lit again after a moment)
      ARENA.oil.troughs.forEach((T, j) => {
        const cx = Math.max(T.x0, Math.min(T.x1, s.tx)), cz = Math.max(T.z0, Math.min(T.z1, s.tz));
        if (st.troughs[j].lit && Math.hypot(cx - s.tx, cz - s.tz) < s.r) { st.troughs[j].lit = false; st.troughs[j].dousedT = 1.5; }
      });
      // and the goblins under the water stop burning
      ctx.horde.hash.query(s.tx, s.tz, s.r, (i) => { if (H.burn[i] > 0 && Math.hypot(H.x[i] - s.tx, H.z[i] - s.tz) < s.r) H.burn[i] = 0; return false; });
      st.stats.douses = (st.stats.douses || 0) + 1;
    }
  }
  function updateElites() {
    const st = ctx.state, n = st.night, plan = n.elitePlan, H = st.horde;
    for (const e of st.elites) { e.x = H.x[e.id]; e.y = H.y[e.id]; e.z = H.z[e.id]; e.hp = Math.max(0, H.hp[e.id]); }
    while (n.elitesSpawned < plan.length && n.clock >= plan[n.elitesSpawned].at) {
      const e = plan[n.elitesSpawned++], kidx = K[e.kind];
      if (ctx.horde.spawnMany(kidx, 1) < 1) continue;
      const H = st.horde;
      let id = -1; for (let i = H.count - 1; i >= 0; i--) if (H.state[i] && H.kind[i] === kidx && !st.elites.some((x) => x.id === i)) { id = i; break; }
      if (id < 0) continue;
      st.elites.push({ id, kind: e.kind, name: ELITE_NAMES[e.kind] || e.kind, hpMax: ENEMY[kidx].hp * (ctx.ns?.hp ?? 1) });
      ctx.emit(EV.ELITE_SPAWN, { id, kind: e.kind, name: ELITE_NAMES[e.kind], pos: { x: H.x[id], y: H.y[id], z: H.z[id] } });
    }
  }
  function kindle() {
    const st = ctx.state, n = st.night, p = st.player;
    n.kindle++; n.kindleCd = NIGHT.kindleCd * ctx.mods.kindleCd; n.kindleT = NIGHT.kindleSeconds; p.fuel = p.fuelMax; st.stats.kindles++;
    p.holdFireT = TIMELINE.kindle.glance ?? 1.0;   // the kindle glance: weapons hold for its second
    ctx.emit(EV.KINDLE, { level: n.kindle });
    n.waveN++;
    ctx.emit(EV.WAVE, { n: n.waveN, size: Math.round(40 * NIGHT.kindleMul), kindled: true });
    if (n.kindle >= NIGHT.trollKindles && !st.troll && n.trollQueue.length) { n.trollQueue.shift(); ctx.troll.arrive(); }
  }

  function stepPlay(inp, dt) {
    const st = ctx.state, p = st.player, n = st.night;
    updateWind(dt);
    if (p.alive) stepPlayer(ctx, inp, dt);
    ctx.weapons.update(dt, inp);
    // the trolls (Night II: a second one at 4:00, or when the first is dead if it still lives then; DESIGN §8.1)
    if (n.trollQueue.length && n.clock >= n.trollQueue[0] && (!st.troll || (!st.troll.alive && st.troll.deathT >= 2))) { n.trollQueue.shift(); ctx.troll.arrive(); }
    ctx.troll.update(dt); ctx.troll.updateBoulders(dt);
    if (st.mode !== 'play') return;
    updateElites();
    const gd = ctx.horde.update(dt, { spawn: true, flee: false });
    if (gd > 0) {
      gateAcc += gd; gateAccT += dt;
      const g = st.gate; if (!god) { g.hp = Math.max(0, g.hp - gd); st.stats.gateLost += gd; }
      if (gateAccT >= 0.1) { ctx.emit(EV.GATE_HIT, { pos: { x: 0, y: 1.5, z: 0.2 }, dmg: +gateAcc.toFixed(2), hpFrac: g.hp / g.hpMax }); gateAcc = 0; gateAccT = 0; }
      if (g.hp <= 0) { ctx.emit(EV.GATE_BREACH, {}); fall('gate'); return; }
    }
    ctx.towers.update(dt);
    ctx.skills.update(dt);
    ctx.air.update(dt);   // DESIGN §5.5: Bat Gremlins (Night II)
    ctx.rams.update(dt);  // DESIGN §5.6
    ctx.twists.update(dt);   // DESIGN §8.3 rain, Night V phalanxes, Night VII the coven
    ctx.bossSys.update(dt);  // DESIGN §6.3 the Rainmother
    if (st.mode !== 'play') return;
    if (st.boss && !st.boss.alive && st.boss.deathT >= 3) { startEnding(); return; }
    updateHexes(dt); updateSplashes(dt);
    updateOil(dt);
    updatePickups(dt);
    flushXp(); flushXpTick();
    if (st.mode !== 'play') return;
    // the beacon
    if (n.kindleCd > 0) { n.kindleCd = Math.max(0, n.kindleCd - dt); if (n.kindleCd === 0) ctx.emit(EV.BEACON_READY, {}); }
    if (n.kindleT > 0) n.kindleT = Math.max(0, n.kindleT - dt);
    const pan = ARENA.beacon.pan;
    if (inp.kindle && p.alive && n.kindleCd <= 0 && !(n.kindleLockT > 0) && Math.hypot(p.x - pan.x, p.y - pan.y, p.z - pan.z) <= ARENA.beacon.useRadius) kindle();
    // (DESIGN §3.3: the Lamplighter is immune to fire: no burn rule for the player any more)
    // the night clock, waves, dawn
    const before = n.clock;
    n.clock = Math.min(NIGHT.dawnAt, n.clock + dt);
    if (Math.floor(n.clock / 30) > Math.floor(before / 30)) { n.waveN++; ctx.emit(EV.WAVE, { n: n.waveN, size: Math.round(30 * (spawnRateAt(n.clock))), kindled: false }); }
    st.stats.timeAlive = n.clock;
    if (!ctx.nightCfg.boss && n.clock >= NIGHT.dawnAt && !n.trollQueue.length && (!st.troll || (!st.troll.alive && st.troll.deathT >= 1.5)) && (ctx.nightCfg.trolls.length === 0 || st.troll)) { dawn(); return; }
    // level-ups
    if (p.xp >= p.xpNext) levelUp();
  }
  function stepCamp(inp, dt) {
    const st = ctx.state, p = st.player, c = st.camp;
    updateWind(dt);
    // the player is held while a panel is up and during the 'camp' cinema's fade (TIMELINE.camp.hold)
    if (!c.panel && st.modeT >= TIMELINE.camp.hold) stepPlayer(ctx, inp, dt);
    else { p.vx = p.vy = p.vz = 0; p.speed = 0; if (inp.yaw != null) p.yaw = inp.yaw; if (inp.pitch != null) p.pitch = Math.max(-1.45, Math.min(1.45, inp.pitch)); }
    // what is in reach (the UI's prompt): Brother Cinder, a build pad, the lamp's kindling pan
    const npc = ARENA.camp.npc, pan = ARENA.beacon.pan;
    let near = null;
    if (Math.hypot(p.x - npc.x, p.z - npc.z) <= npc.useRadius && p.y < 1.5) near = 'npc';
    else if (Math.hypot(p.x - pan.x, p.y - pan.y, p.z - pan.z) <= ARENA.beacon.useRadius) near = 'lamp';
    else if (p.y < 1.5) {
      let bd = ARENA.camp.padUseRadius;
      for (const pad of ARENA.camp.pads) { const d = Math.hypot(p.x - pad.x, p.z - pad.z); if (d <= bd) { bd = d; near = pad.id; } }
    }
    c.near = near;
    // (E right after a panel closed is the same key press the UI used to close it: ignored for 0.3 s)
    if (inp.kindle && st.modeT >= TIMELINE.camp.hold && !(st.t - (c.closedAt ?? -9) < 0.3)) {
      if (c.panel) closePanel();
      else if (near === 'npc') openNpc();
      else if (near === 'lamp') leaveCamp();
      else if (near) openPad(near);
    }
  }
  function spawnRateAt(c) { return c < NIGHT.gentle ? NIGHT.gentleRate : NIGHT.baseRate + (NIGHT.peakRate - NIGHT.baseRate) * Math.min(1, (c - NIGHT.gentle) / (NIGHT.peakAt - NIGHT.gentle)); }
  function levelUp() {
    const st = ctx.state, p = st.player;
    const cards = drawCards(ctx, st.taken);
    p.xp -= p.xpNext; p.level++; p.xpNext = XP_NEXT(p.level); st.stats.level = p.level;
    // DESIGN §3.4: the only healing in a night: +10 % of max HP on every level-up
    if (p.alive && p.hp < p.hpMax) { const add = Math.min(p.hpMax - p.hp, p.hpMax * LEVEL_HEAL); p.hp += add; ctx.emit(EV.P_HEAL, { amount: +add.toFixed(1), source: 'level' }); }
    if (!cards.length) return;
    st.cards = cards;
    p.jet.on = false;
    ctx.emit(EV.LEVEL_UP, { level: p.level, cards: cards.slice() });
    setMode('cards');
  }
  function pickCard(c) {
    const st = ctx.state;
    if (st.mode !== 'cards' || !st.cards) return false;
    const id = typeof c === 'number' ? st.cards[c - 1] : c;
    if (!id || !st.cards.includes(id)) return false;
    const card = CARD_BY_ID[id];
    card.apply(ctx);
    st.taken[id] = (st.taken[id] || 0) + 1;
    st.stats.cards.push(id);
    st.cards = null;
    ctx.emit(EV.CARD_PICK, { cardId: id, level: st.player.level });
    setMode('play');
    return true;
  }
  /** DESIGN §12: the Rainmother has fallen → the ending (mode 'ending', TIMELINE.ending; the sim holds the player). */
  function startEnding() {
    const st = ctx.state, p = st.player;
    if (st.mode === 'ending') return;
    collectAll();
    const goldBanked = bank();
    st.air.length = 0; p.jet.on = false; p.vx = p.vy = p.vz = 0;
    const seen = !!meta.ended;
    // (the Lamplighter stands on the wall walk above the gate for the reveal; then the village and Cinder's mark)
    Object.assign(p, { x: 2, y: ARENA.keep.walk.y, z: -1.5, yaw: 0, pitch: 0.05, where: 'walk', onGround: true }); p.safe = { x: 2, y: ARENA.keep.walk.y, z: -1.5 };
    const V = /** @type {any} */ (ARENA).village || { x: 12, z: 108, r: 17 };
    st.ending = { t: 0, beat: null, skippable: seen, beatK: 0, village: { x: V.x, z: V.z, r: V.r ?? 17 }, cinder: { x: 2, z: 1.8 } };
    meta.ended = true; meta.nightsCompleted++; meta.bestNight = Math.max(meta.bestNight, st.night.n);
    ctx.emit('ending.start', { stats: { ...st.stats }, seen });
    ctx.emit(EV.RUN_END, { reason: 'complete', night: st.night.n, stats: { ...st.stats }, goldBanked });
    run.ended = true;
    persist();
    setMode('ending');
  }
  function stepEnding(dt) {
    const st = ctx.state, E = st.ending, TL = TIMELINE.ending;
    E.t = Math.min(TL.duration, E.t + dt);
    while (E.beatK < TL.beats.length && E.t >= TL.beats[E.beatK].at) {
      const b = TL.beats[E.beatK++];
      E.beat = b.id;
      ctx.emit('ending.beat', { id: b.id, at: b.at, night: st.night.n });
      if (b.id === 'cinder') ctx.emit(EV.NPC_LINE, { line: 'master' });
      if (b.id === 'flood') ctx.op({ kind: FIRE_OP.DOUSE, x: 29, z: 60, r: 12 });
    }
    // the rain stops with the flood; the goblins flee from the host on
    st.weather.rain = Math.max(0, st.weather.rain - dt / 3); proxy.setRain(st.weather.rain);
    ctx.horde.update(dt, { spawn: false, flee: E.t >= 18 });
  }
  function dawn() {
    const st = ctx.state, p = st.player, nN = st.night.n;
    collectAll();
    ctx.emit(EV.DAWN, { night: nN });
    st.air.length = 0;   // the Bat Gremlins leave with the night
    st.goldBanked = bank();
    meta.nightsCompleted++; meta.bestNight = Math.max(meta.bestNight, nN);
    if (nN === 2) meta.npc.pending = 'eight';   // "Eight more nights. Then we can all go out."
    if (nN < NIGHTS.length) {
      run.night = nN + 1;
      run.carry = { taken: { ...st.taken }, level: p.level, xp: p.xp };
    } else {
      ctx.emit(EV.RUN_END, { reason: 'complete', night: nN, stats: { ...st.stats }, goldBanked: st.goldBanked });
      meta.npc.pending = 'eight';
      run.ended = true;
    }
    persist();
    setMode('victory');
    p.jet.on = false;
  }

  function step(input) {
    const st = ctx.state;
    if (st.paused) { st.fireOps = []; return; }
    st.fireOps = pending; pending = [];
    inStep = true;
    try { tick(input); } finally { inStep = false; }
  }
  function tick(input) {
    // commands first (the UI's from sim.command, the bot's in input.cmds): a state change at a tick boundary
    if (cmdQueue.length) for (const c of cmdQueue.splice(0)) applyCommand(c);
    if (input && Array.isArray(input.cmds)) for (const c of input.cmds) applyCommand(c);
    const st = ctx.state;
    const inp = sanitizeInput(input);
    const p = st.player;
    const look = { ...inp, yaw: inp.yaw ?? p.yaw, pitch: inp.pitch ?? p.pitch };
    const dt = DT;
    st.tick++; st.t += dt; st.modeT += dt;
    switch (st.mode) {
      case 'title': break;
      case 'camp': stepCamp(look, dt); break;
      case 'intro': {
        // from the camp the night begins with the 'campLeave' cinema (TIMELINE.campLeave), else the full intro
        const fromCamp = !!st.night.fromCamp, T = fromCamp ? TIMELINE.campLeave : TIMELINE.intro;
        const cardAt = fromCamp ? T.card : T.beats.find((b) => b.id === 'card').at;
        if (st.modeT >= cardAt && st.modeT - DT < cardAt) ctx.emit(EV.NIGHT_TITLE, { night: st.night.n, name: st.night.name });
        if (st.modeT >= T.duration) startNight();
        break;
      }
      case 'cards':
        if (inp.card >= 1 && inp.card <= 3) pickCard(inp.card);
        break;
      case 'play':
        stepPlay(look, dt);
        break;
      case 'victory': {
        updateWind(dt);
        ctx.horde.update(dt, { spawn: false, flee: true });
        ctx.troll.update(dt);
        if (st.modeT > 0.4 && st.modeT < 4.2 && st.tick % 30 === 0) douseAll();
        const vAt = TIMELINE.dawn.beats.find((b) => b.id === 'card').at;
        if (st.modeT >= vAt && st.modeT - DT < vAt) {
          st.victoryShown = true;
          const nN = st.night.n, last = nN >= NIGHTS.length;
          ctx.emit(EV.VICTORY, { stats: { ...st.stats }, night: nN, goldBanked: st.goldBanked || 0, last });
          ctx.emit(EV.STORY, { beat: nN >= 2 ? 'dawn2' : 'dawn1', night: nN });
          // (DESIGN §8: no coming-soon card any more; Night X ends in the ending, not a dawn)
        }
        break;
      }
      case 'ending': stepEnding(dt); break;
      case 'fallen': {
        const F = TIMELINE.fallen;
        st.timeScale = st.modeT < F.slowmo ? F.slowmoScale : 1;
        ctx.horde.update(dt, { spawn: false, flee: false });
        ctx.troll.update(dt); ctx.troll.updateBoulders(dt);
        break;
      }
      default: break;
    }
    const st2 = ctx.state;   // (the camp swaps the state object)
    if (st2.mode !== 'fallen') st2.timeScale = 1;
    st2.ring = ctx.weapons.ring;
    if (provider === proxy) { proxy.apply(st2.fireOps, st2.wind); proxy.step(dt); }
  }

  fresh(run.night, 'title');
  if (run.started) ctx.state.stats.level = ctx.state.player.level;
  return {
    get state() { return ctx.state; },
    step,
    drainEvents() { const e = events; events = []; return e; },
    /** Use `fire` ({ heat, fuel }) as the fire provider; null (or the proxy) = the CPU proxy. */
    setFire(fire) { provider = fire && fire !== proxy ? fire : proxy; ctx.state.fireSource = provider === proxy ? 'proxy' : 'module'; },
    get fire() { return provider; },
    proxy,
    /** Was there a save at boot (then a start goes to the camp; a first launch goes straight into Night I)? */
    get hadSave() { return hadSave; },
    startIntro() { if (ctx.state.mode !== 'title') return false; setMode('intro'); return true; },
    startNight,
    /** Skip the intro (after TIMELINE.intro.skippableAfter, or any time with force). */
    skipIntro(force = false) { const st = ctx.state; if (st.mode === 'title' && force) { startNight(); return true; } if (st.mode !== 'intro' || (!force && st.modeT < TIMELINE.intro.skippableAfter)) return false; return startNight(); },
    /** Restart the current night (the menu's "restart"): the run's carry and towers as at nightfall. */
    retry() {
      attempt++;
      if (run.ended) run = newRun();   // after a fall (or the last dawn) the restart is a new run at Night I
      fresh(run.started ? ctx.state.night.n : 1, 'fallen');
      pending = [];
      ctx.emit(EV.RETRY, {});
      douseAll();
      startNight();
      return true;
    },
    /** The camp (from the title with a save, or a tool): reason 'start'. */
    toCamp(reason = 'start') { enterCamp(reason); return true; },
    /** A UI / tool command, applied at the next tick: { act: 'buy', item } | { act: 'equip', charm, on } |
     *  { act: 'build', pad, type } | { act: 'upgrade', pad } | { act: 'open', panel, pad } | { act: 'close' } |
     *  { act: 'kindle' } (leave the camp) | { act: 'continue' } (after the dawn / fallen / coming-soon card). */
    command(c) { if (c && typeof c === 'object') cmdQueue.push({ ...c }); },
    /** Tools: jump to a state. 'camp' | 'night1' (a new run) | 'night2' (the run in the save, else a fresh one, at Night II). */
    goto(where) {
      if (where === 'camp') { enterCamp('start'); return true; }
      if (where === 'ending') {
        // DESIGN §14.8: play the ending directly (Night X's state, the Rainmother already fallen)
        run.night = NIGHTS.length; attempt++; fresh(NIGHTS.length, 'title'); pending = []; douseAll();
        ctx.state.weather.rain = 1; ctx.emit(EV.RETRY, {}); startNight();
        startEnding(); return true;
      }
      const m = /^night(\d+)$/.exec(String(where));
      const n = Math.max(1, Math.min(NIGHTS.length, m ? Number(m[1]) : 1));
      if (n === 1) { run = newRun(); } else run.night = n;
      attempt++;
      fresh(n, 'title');
      pending = []; douseAll();
      ctx.emit(EV.RETRY, {});
      startNight();
      return true;
    },
    /** The save: write it now / reset it / set the gold (tools). */
    save() { persist(); return JSON.parse(JSON.stringify(meta)); },
    resetSave() { const fresh0 = blankSave(); for (const k of Object.keys(meta)) delete meta[k]; Object.assign(meta, fresh0); run = newRun(); ctx.state.run = run; try { storage.clear ? storage.clear() : storage.save(meta); } catch { /* */ } return true; },
    setGold(n) { meta.gold = Math.max(0, Math.floor(Number(n) || 0)); persist(); return meta.gold; },
    get meta() { return meta; },
    get run() { return run; },
    pickCard,
    teleport(x, z, yaw, pitch) {
      const p = ctx.state.player;
      p.x = x; p.z = z; p.y = groundY(x, z); p.vx = p.vy = p.vz = 0; p.onGround = true;
      if (yaw != null) p.yaw = yaw; if (pitch != null) p.pitch = pitch;
      p.safe = { x: p.x, y: p.y, z: p.z };
    },
    /** Put the player on the wall walk / stair at (x, z) (for views and tests). */
    teleportHigh(x, z, yaw, pitch) { const p = ctx.state.player; p.x = x; p.z = z; p.y = 5; p.vx = p.vy = p.vz = 0; p.onGround = true; if (yaw != null) p.yaw = yaw; if (pitch != null) p.pitch = pitch; p.safe = { x, y: 5, z }; p.where = 'walk'; },
    spawn(kind, n = 1, x, z) { const k = typeof kind === 'number' ? kind : ENEMY_KINDS.indexOf(kind); return ctx.horde.spawnMany(Math.max(0, k), n, x, z); },
    troll() { const n = ctx.state.night; if (n.trollQueue.length) n.trollQueue.shift(); ctx.troll.arrive(); return ctx.state.troll; },
    setClock(s) { ctx.state.night.clock = Math.max(0, Math.min(NIGHT.dawnAt, s)); },
    fireOp(o) { pending.push(o); },
    setGod(on) { god = !!on; },
    get god() { return god; },
    hash() { return hashState(ctx.state, proxy); },
    ctx,
    /** A ground height function for the pickups (main may pass the arena's groundHeight; default import below). */
    setGround(fn) { groundY = fn; },
  };
}

/**
 * Every input field checked: a number must be finite (a NaN or ±Infinity yaw used to put the player's
 * position to NaN for the rest of the night: `??` lets NaN through), else its default; flags become booleans.
 * yaw/pitch fall back to null (= keep the player's own), fwd/right are clamped to [−1, 1], slots to integers.
 */
const FINITE = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export function sanitizeInput(input) {
  if (!input) return NO_INPUT;
  const i = input, clamp1 = (v) => Math.max(-1, Math.min(1, FINITE(v, 0)));
  return {
    fwd: clamp1(i.fwd), right: clamp1(i.right), sprint: !!i.sprint, jump: !!i.jump,
    yaw: FINITE(i.yaw, null), pitch: i.pitch == null || !Number.isFinite(i.pitch) ? null : Math.max(-1.5, Math.min(1.5, i.pitch)),
    fire: !!i.fire, firePress: !!i.firePress, bomb: !!i.bomb, weapon: Math.trunc(FINITE(i.weapon, 0)), wheel: Math.sign(FINITE(i.wheel, 0)),
    reload: !!i.reload, kindle: !!i.kindle, ult: !!i.ult, card: Math.trunc(FINITE(i.card, 0)),
  };
}

/** A stable hash of the gameplay state (rounded), for determinism tests. */
export function hashState(st, proxy) {
  const H = st.horde;
  let sx = 0, sz = 0, shp = 0, alive = 0;
  for (let i = 0; i < H.count; i++) { if (H.state[i] === 0) continue; alive++; sx += H.x[i]; sz += H.z[i]; shp += H.hp[i]; }
  const vals = [st.tick, st.night.clock, st.player.x, st.player.y, st.player.z, st.player.hp, st.player.fuel, st.gate.hp, alive, sx, sz, shp,
    st.stats.kills, st.stats.burned, st.player.xp, st.player.level, st.troll ? st.troll.hp : -1, proxy ? proxy.hash() : 0,
    st.meta ? st.meta.gold : 0, st.run ? st.run.goldRun : 0, st.pickups.length, st.night.n, st.air ? st.air.length : 0];
  let h = 0x811c9dc5;
  for (const v of vals) { const s = String(Math.round(v * 100)); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } }
  return h.toString(16);
}
