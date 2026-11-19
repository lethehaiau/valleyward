// @ts-check
// VALLEYWARD · the roguelite layer (docs/DESIGN.md §9.1, §9.3, §9.2, §9.6, §5.4): the save (normalised, presets for tools),
// the loadout a night starts with (NPC upgrades + equipped charms + every card taken this run), Brother Cinder's
// lines (docs/STORY.md hint 4) and the shop / tower commands. Pure JS (Node and the browser); the sim owns the calls.
import { ARENA } from '../shared/arena.js';
import { freshSave, UPGRADES, upgradeCost, BASE_CHARM_SLOTS, TOWERS, CHARMS, NIGHTS, ORGAN } from '../shared/meta.js';
import { CARDS, CARD_BY_ID, newMods } from './cards.js';
import { newPlayer } from './player.js';
import { XP_NEXT } from './constants.js';

export const UPGRADE_BY_ID = Object.freeze(Object.fromEntries(UPGRADES.map((u) => [u.id, u])));
export const CHARM_BY_ID = Object.freeze(Object.fromEntries(CHARMS.map((c) => [c.id, c])));
export const PAD_BY_ID = Object.freeze(Object.fromEntries(ARENA.camp.pads.map((p) => [p.id, p])));

/** Brother Cinder's lines (docs/STORY.md hint 4, verbatim). EV.NPC_LINE carries the id; the HUD shows the text. */
export const NPC_LINES = Object.freeze({
  home: "You're home, Lamplighter. The lamp missed you.",
  hide: "Coin for the hide? It wears thin on you. Always has.",
  afraid: "They climb because they're afraid. Afraid is good. Afraid is loud.",
  gloves: "Don't mind the gloves. They smoke when you're cross.",
  eight: 'Eight more nights. Then we can all go out.',
  eat: 'Odd. I never see you eat.',
  fall: "You'll be back. You always are. That's rather the point of you.",
});
/** The idle rotation (after the first meeting, a fall or Night II's dawn take precedence). */
const NPC_IDLE = ['hide', 'afraid', 'gloves', 'eat', 'home'];

/** A typical Night I card set for the `mid` preset (what the bot picks over ≈ 10 level-ups). */
const MID_CARDS = Object.freeze({ blunderbuss: 1, contagion: 1, 'kestrel-dmg': 2, mason: 1, pellets: 2, wildfire: 1, 'kestrel-rate': 1, 'bomb-charge': 1 });

const int = (v, lo, hi, d = lo) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : d);

/** Charm slots for a save (2 + the Charm slot upgrade). */
export const charmSlots = (meta) => BASE_CHARM_SLOTS + (meta.upgrades.slots || 0);

/** A run in progress, validated (null when there is none: the next night is Night I of a new run). */
function normalizeRun(r) {
  if (!r || typeof r !== 'object') return null;
  const night = int(r.night, 1, NIGHTS.length, 1);
  const seen = new Set();
  const towers = (Array.isArray(r.towers) ? r.towers : []).filter((t) => t && PAD_BY_ID[t.pad] && TOWERS[t.type] && !seen.has(t.pad) && seen.add(t.pad))
    .map((t) => ({ pad: t.pad, type: t.type, level: int(t.level, 1, TOWERS[t.type].cost.length, 1) }));
  const taken = {};
  if (r.taken && typeof r.taken === 'object') for (const [id, n] of Object.entries(r.taken)) if (CARD_BY_ID[id]) taken[id] = int(n, 0, CARD_BY_ID[id].max, 0);
  return { night, towers, taken, level: int(r.level, 1, 99, 1), xp: Math.max(0, Number.isFinite(r.xp) ? r.xp : 0) };
}

/**
 * A save from storage, validated against meta.js (unknown ids dropped, levels clamped). Returns null for anything that
 * is not a v1 save. Adds `run` (the run in progress between nights, the sim's addition; null when none).
 * @param {any} raw
 */
export function normalizeSave(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return null;
  const s = freshSave();
  s.gold = Math.max(0, Math.floor(Number.isFinite(raw.gold) ? raw.gold : 0));
  s.runN = int(raw.runN, 0, 1e6, 0); s.bestNight = int(raw.bestNight, 0, 99, 0); s.nightsCompleted = int(raw.nightsCompleted, 0, 1e6, 0);
  for (const u of UPGRADES) s.upgrades[u.id] = int(raw.upgrades?.[u.id], 0, u.max, 0);
  const owned = [...new Set((raw.charms?.owned || []).filter((id) => CHARM_BY_ID[id]))];
  s.charms.owned = owned;
  s.charms.equipped = [...new Set((raw.charms?.equipped || []).filter((id) => owned.includes(id)))].slice(0, charmSlots(s));
  s.story.seen = (raw.story?.seen || []).filter((x) => typeof x === 'string').slice(0, 64);
  s.organ = { owned: !!raw.organ?.owned, equipped: !!raw.organ?.owned && raw.organ?.equipped !== false };
  s.ended = !!raw.ended;   // DESIGN §12.9
  if (!s.organ.owned) s.upgrades.organ = 0;
  /** @type {any} */ (s).run = normalizeRun(raw.run);
  /** @type {any} */ (s).npc = { talks: int(raw.npc?.talks, 0, 1e6, 0), pending: typeof raw.npc?.pending === 'string' && NPC_LINES[raw.npc.pending] ? raw.npc.pending : null };
  return s;
}

/** A blank save in the sim's shape (freshSave + run + npc). */
export function blankSave() { return /** @type {any} */ (normalizeSave(freshSave())); }

/**
 * Saves for tools (`?save=fresh|mid|rich`): fresh = a first launch; mid = between Night I and Night II of a
 * run (Hide 2, Lance 2, an Obelisk + a Chain Imp built, 2 charms equipped, a typical Night I card set, level 11);
 * rich = every state reachable from the camp (99,999 gold, the THUNDER ORGAN equipped, three charms owned);
 * late / endgame: see below.
 * @param {'fresh'|'mid'|'rich'|string} name
 */
export function savePreset(name) {
  const s = blankSave();
  if (name === 'mid') {
    Object.assign(s, { gold: 120, runN: 1, bestNight: 1, nightsCompleted: 1 });
    s.upgrades.hide = 2; s.upgrades.lance = 2;
    s.charms.owned = ['ember-tooth', 'cinder-ward']; s.charms.equipped = ['ember-tooth', 'cinder-ward'];
    s.run = { night: 2, towers: [{ pad: 'pad-gate-w', type: 'obelisk', level: 1 }, { pad: 'pad-gate-e', type: 'chainimp', level: 1 }], taken: { ...MID_CARDS }, level: 11, xp: 0 };
    s.story.seen = ['home'];
  } else if (name === 'late' || name === 'endgame') {
    // DESIGN §8.1, §14.8: 'late' = a player with mid-high upgrades for Nights III–IX (the run at Night III; ?night=N moves it);
    // 'endgame' = Night X ready (high upgrades, six towers, a strong card set)
    const late = name === 'late';
    Object.assign(s, { gold: late ? 300 : 600, runN: late ? 3 : 6, bestNight: late ? 2 : 9, nightsCompleted: late ? 6 : 30 });
    Object.assign(s.upgrades, late ? { hide: 3, kestrel: 4, blunderbuss: 2, lance: 4, bombs: 1, gate: 1, slots: 1 } : { hide: 5, kestrel: 7, blunderbuss: 4, lance: 7, bombs: 2, gate: 2, slots: 2 });
    s.charms.owned = ['ember-tooth', 'cinder-ward', 'bellows-heart', 'spark-bead', 'coin-hook'];
    s.charms.equipped = late ? ['ember-tooth', 'cinder-ward', 'bellows-heart'] : ['ember-tooth', 'cinder-ward', 'bellows-heart', 'spark-bead'];
    const L = late ? 2 : 3;
    s.run = { night: late ? 3 : 10,
      towers: (late ? ['pad-gate-w', 'pad-gate-e'] : ['pad-gate-w', 'pad-gate-e', 'pad-road', 'pad-west'])
        .map((pad, k) => ({ pad, type: k % 2 ? 'chainimp' : 'obelisk', level: L })),
      taken: late ? { ...MID_CARDS, 'pyre-burst': 1, bellows: 1 }
        : { ...MID_CARDS, 'pyre-burst': 1, 'pyre-burst-up': 1, brimstone: 1, bellows: 1, 'lance-tank': 1, vigour: 1, 'kestrel-dmg': 3, 'kestrel-rate': 2 },
      level: late ? 14 : 22, xp: 0 };
    s.story.seen = ['home', 'camp-tip'];
  } else if (name === 'rich') {
    // DESIGN §4.2: rich owns the THUNDER ORGAN (equipped) so it can be tested, and has gold for every upgrade line
    Object.assign(s, { gold: 99999, runN: 1, bestNight: 1, nightsCompleted: 1 });
    s.organ = { owned: true, equipped: true };
    s.charms.owned = ['ember-tooth', 'coin-hook', 'witchfire-wick']; s.charms.equipped = ['ember-tooth'];
    s.story.seen = ['home'];
  }
  return s;
}

/**
 * The player's power at nightfall: one number from what the Lamplighter brings into
 * the night. Bosses once scaled with it (`bossHpMul`); DESIGN §5.7 reversed that, so boss HP is fixed and this is an
 * analytics number (`state.night.power`). A weighted sum of the weapon lines in use (Kestrel,
 * slot 2 = the Blunderbuss line or, when owned and equipped, the THUNDER ORGAN, the Ember Lance), Hide, Firebombs, the
 * run's card levels and its towers' levels, divided by the same sum for the `late` preset; above 1 it saturates toward
 * the cap (an `endgame` save is ≈ 1.15, never past 1.25). Anchors: fresh 0, mid ≈ 0.36, late 1.00, endgame ≈ 1.15.
 * Gate, charm-slot and charm upgrades do not count. Pure.
 * @param {any} save the save (meta.js shape) @param {any} run the run (`save.run` shape, or the sim's run with `carry`)
 */
export const POWER = Object.freeze({
  w: Object.freeze({ kestrel: 1, slot2: 0.8, lance: 1.2, hide: 0.3, bombs: 0.8, cards: 0.2, towers: 0.5 }),
  organ: Object.freeze({ owned: 6, perLevel: 0.5 }),   // the Organ in slot 2 counts as Blunderbuss 6 + 0.5 a level
  ref: 16.5,                                          // the sum for the `late` preset (tests/nights.test.mjs checks it)
  cap: 1.25, sat: 1,                                  // above 1: 1 + (cap − 1)(1 − e^(−(r − 1)/sat))
});
export function powerRaw(save, run) {
  const U = save?.upgrades || {}, W = POWER.w, lv = (k) => Math.max(0, Number(U[k]) || 0);
  const organ = save?.organ?.owned && save?.organ?.equipped;
  const slot2 = organ ? POWER.organ.owned + POWER.organ.perLevel * lv('organ') : lv('blunderbuss');
  const taken = run?.taken ?? run?.carry?.taken ?? {};
  const cards = Object.values(taken).reduce((a, v) => a + Math.max(0, Number(v) || 0), 0);
  const towers = (run?.towers || []).reduce((a, t) => a + Math.max(0, Number(t?.level) || 0), 0);
  return W.kestrel * lv('kestrel') + W.slot2 * slot2 + W.lance * lv('lance') + W.hide * lv('hide') + W.bombs * lv('bombs')
    + W.cards * cards + W.towers * towers;
}
export function bossPower(save, run) {
  const r = powerRaw(save, run) / POWER.ref;
  return r <= 1 ? r : Math.min(POWER.cap, 1 + (POWER.cap - 1) * (1 - Math.exp(-(r - 1) / POWER.sat)));
}
/** A night's boss HP multiplier at that power: max(hpMin, lerp(hpFloor, 1, power)) (Night I/II: floor 1, unchanged;
 *  III–X: never below hpMin 0.35 of the tuned HP; the floor is the slope's foot, tuned on the `mid` save). */
export function bossHpMul(cfg, power) {
  const f = cfg?.hpFloor ?? 1, p = Math.max(0, Math.min(POWER.cap, Number.isFinite(power) ? power : 1));
  return Math.max(cfg?.hpMin ?? 0, f + (1 - f) * p);
}

/** Is this the very first launch (nothing ever played or bought)? Then the game starts straight in Night I. */
export const isFirstLaunch = (meta) => !meta || (meta.runN === 0 && meta.nightsCompleted === 0 && meta.gold === 0 && !meta.run);

/**
 * The loadout a night starts with (DESIGN §9: upgrades apply at nightfall): a fresh player and fresh mods from the NPC
 * upgrades and the equipped charms, then every card taken this run replayed (instant cards such as Kindled Flesh and
 * Windward skipped), level and XP carried. Full HP, a full tank, every firebomb (+ Spark Bead's).
 * @param {any} ctx sim ctx (state, mods, proxyMods) @param {{ taken: Record<string, number>, level: number, xp: number }} carry
 */
export function applyLoadout(ctx, carry) {
  const st = ctx.state, meta = st.meta, U = meta.upgrades, per = (id) => UPGRADE_BY_ID[id].per;
  const m = newMods();
  ctx.mods = m; st.mods = m;
  ctx.proxyMods({ decay: 1, spread: 1 });
  m.kestrelDmg *= 1 + per('kestrel').kestrelDmg * U.kestrel;
  m.kestrelRate *= 1 + per('kestrel').kestrelRate * U.kestrel;
  m.pellets += per('blunderbuss').pellets * Math.max(0, U.blunderbuss - 1);
  m.lanceRefill *= 1 + per('lance').lanceRefill * U.lance;
  m.dmgTaken *= 1 + per('hide').dmgTaken * U.hide;
  let magnet = 1;
  for (const id of meta.charms.equipped) {
    const c = CHARM_BY_ID[id]; if (!c) continue;
    const d = /** @type {any} */ (c.mod);
    if (d.fireDmg) m.fireDmg += d.fireDmg;
    if (d.gold) m.gold += d.gold;
    if (d.speed) m.speed += d.speed;
    if (d.lanceRefill) m.lanceRefill *= 1 + d.lanceRefill;
    if (d.dmgTaken) m.dmgTaken *= 1 + d.dmgTaken;
    if (d.magnet) magnet += d.magnet;
    if (d.kindleCd) m.kindleCd *= 1 + d.kindleCd;
    if (d.bombsStart) m.bombsStart += d.bombsStart;
    if (d.lanceHue) m.lanceHue = d.lanceHue;
  }
  const old = st.player, p = newPlayer();
  // (re-applied at the camp after a purchase and at nightfall: keep where the Lamplighter stands and looks)
  if (old) { Object.assign(p, { x: old.x, y: old.y, z: old.z, yaw: old.yaw, pitch: old.pitch, where: old.where, onGround: old.onGround }); p.safe = { ...old.safe }; }
  p.hpMax = p.hp = 100 + per('hide').hpMax * U.hide;
  p.fuelMax = p.fuel = Math.round(100 * (1 + per('lance').lanceTank * U.lance));
  p.bombsMax = p.bombs = 3 + per('bombs').bombs * U.bombs;
  p.unlocked.blunderbuss = U.blunderbuss >= 1;
  // DESIGN §4.2: the THUNDER ORGAN takes slot 2 for every night once bought and equipped (its own 10-level line)
  p.unlocked.organ = !!(meta.organ?.owned && meta.organ?.equipped);
  m.organDmg = 1 + per('organ').organDmg * (U.organ || 0); m.organRate = 1 + per('organ').organRate * (U.organ || 0);
  m.organDrum = 1 + per('organ').organDrum * (U.organ || 0);
  p.organ = { spin: 0, heat: 0, drum: Math.round(ORGAN.drum * m.organDrum), drumMax: Math.round(ORGAN.drum * m.organDrum), reloadT: 0, lockT: 0, firing: false, spinning: false, acc: 0 };
  p.magnet *= magnet;
  st.player = p;
  st.gate.hpMax = st.gate.hp = Math.round(ARENA.gate.hp * (1 + per('gate').gateHp * U.gate));
  st.taken = { ...carry.taken };
  for (const c of CARDS) { if (c.instant) continue; for (let k = 0; k < (st.taken[c.id] || 0); k++) c.apply(ctx); }
  p.hp = p.hpMax; p.fuel = p.fuelMax; p.bombs = p.bombsMax + m.bombsStart; st.gate.hp = st.gate.hpMax;
  p.level = carry.level; p.xp = carry.xp; p.xpNext = XP_NEXT(p.level);
  st.stats.level = p.level;
  return p;
}

/** The next NPC line id for this meeting (and the bookkeeping). */
export function nextNpcLine(meta) {
  const npc = meta.npc || (meta.npc = { talks: 0, pending: null });
  let line;
  if (npc.pending) { line = npc.pending; npc.pending = null; }
  else if (!meta.story.seen.includes('home')) line = 'home';
  else line = NPC_IDLE[npc.talks % NPC_IDLE.length];
  npc.talks++;
  if (!meta.story.seen.includes(line)) meta.story.seen.push(line);
  return line;
}

/**
 * Apply one shop / tower command to the save and the run. Returns { ok, ev?: [type, payload], reason? }; the sim emits
 * the event. Only in the camp (towers are built and upgraded between nights only, DESIGN §9.2).
 * @param {any} st sim state @param {any} c command
 */
export function shopCommand(st, c) {
  const meta = st.meta, run = st.run;
  if (c.act === 'buy') {
    if (c.item === ORGAN.id + '-gun' || c.item === 'thunder-organ') return buyOrgan(meta);
    const u = UPGRADE_BY_ID[c.item]; if (!u) return { ok: false, reason: 'unknown item' };
    if (u.needs === 'organ' && !meta.organ?.owned) return { ok: false, reason: 'locked' };
    const lv = meta.upgrades[u.id] || 0; if (lv >= u.max) return { ok: false, reason: 'max' };
    const cost = upgradeCost(u, lv); if (meta.gold < cost) return { ok: false, reason: 'gold' };
    meta.gold -= cost; meta.upgrades[u.id] = lv + 1;
    return { ok: true, ev: ['shop.buy', { item: u.id, level: lv + 1, cost, goldLeft: meta.gold }] };
  }
  if (c.act === 'buyOrgan') return buyOrgan(meta);
  if (c.act === 'equipOrgan') {
    if (!meta.organ?.owned) return { ok: false, reason: 'not owned' };
    meta.organ.equipped = c.on !== false;
    return { ok: true, ev: ['organ.equip', { on: meta.organ.equipped }] };
  }
  if (c.act === 'equip') {
    const ch = CHARM_BY_ID[c.charm]; if (!ch || !meta.charms.owned.includes(ch.id)) return { ok: false, reason: 'not owned' };
    const eq = meta.charms.equipped, on = c.on !== false, at = eq.indexOf(ch.id);
    if (on) {
      if (at >= 0) return { ok: false, reason: 'equipped' };
      if (eq.length >= charmSlots(meta)) return { ok: false, reason: 'slots' };
      eq.push(ch.id);
      return { ok: true, ev: ['charm.equip', { charm: ch.id, slot: eq.length - 1, on: true }] };
    }
    if (at < 0) return { ok: false, reason: 'not equipped' };
    eq.splice(at, 1);
    return { ok: true, ev: ['charm.equip', { charm: ch.id, slot: at, on: false }] };
  }
  if (c.act === 'build') {
    const T = TOWERS[c.type], pad = PAD_BY_ID[c.pad];
    if (!T || !pad) return { ok: false, reason: 'unknown' };
    if (run.towers.some((t) => t.pad === pad.id)) return { ok: false, reason: 'taken' };
    const cost = T.cost[0]; if (meta.gold < cost) return { ok: false, reason: 'gold' };
    meta.gold -= cost;
    run.towers.push({ pad: pad.id, type: T.id, level: 1 });
    return { ok: true, ev: ['tower.build', { pad: pad.id, tower: T.id, level: 1, cost, pos: { x: pad.x, y: 0, z: pad.z } }], towers: true };
  }
  if (c.act === 'upgrade') {
    const t = run.towers.find((x) => x.pad === c.pad); if (!t) return { ok: false, reason: 'empty pad' };
    const T = TOWERS[t.type]; if (t.level >= T.cost.length) return { ok: false, reason: 'max' };
    const cost = T.cost[t.level]; if (meta.gold < cost) return { ok: false, reason: 'gold' };
    meta.gold -= cost; t.level++;
    return { ok: true, ev: ['tower.upgrade', { pad: t.pad, tower: t.type, level: t.level, cost, pos: { x: PAD_BY_ID[t.pad].x, y: 0, z: PAD_BY_ID[t.pad].z } }], towers: true };
  }
  return { ok: false, reason: 'unknown act' };
}

/** DESIGN §4.2: buy the THUNDER ORGAN (once; equipped at once: it takes slot 2 from the Blunderbuss). */
function buyOrgan(meta) {
  if (meta.organ?.owned) return { ok: false, reason: 'owned' };
  if (meta.gold < ORGAN.cost) return { ok: false, reason: 'gold' };
  meta.gold -= ORGAN.cost;
  meta.organ = { owned: true, equipped: true };
  return { ok: true, ev: ['shop.buy', { item: 'thunder-organ', level: 1, cost: ORGAN.cost, goldLeft: meta.gold }] };
}
