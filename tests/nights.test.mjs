// DESIGN §8 (docs/DESIGN.md §8): the ten nights and their twists, the Siege Ram, rain, the shield wall, the swarm, the
// coven, THE RAINMOTHER (phases, tide, whirlpools, crack, lanterns, the loss at the gate), the ending to its card, the
// save after it, and determinism through Night X. Node, the CPU fire proxy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, memoryStorage, NO_INPUT } from '../src/sim/sim.js';
import { createBot } from '../src/bot/bot.js';
import { EV } from '../src/shared/events.js';
import { FIRE_OP } from '../src/shared/fireops.js';
import { ARENA } from '../src/shared/arena.js';
import { NIGHTS } from '../src/shared/meta.js';
import { TIMELINE } from '../src/shared/timeline.js';
import { RAM } from '../src/sim/ram.js';
import { BOSS } from '../src/sim/boss.js';
import { createFireProxy } from '../src/sim/fireproxy.js';
import { bossPower, bossHpMul, powerRaw, savePreset, POWER } from '../src/sim/run.js';
import { nightScale } from '../src/sim/constants.js';

const run = (sim, ticks, inp = NO_INPUT, onEv) => { for (let i = 0; i < ticks; i++) { sim.step(typeof inp === 'function' ? inp(sim.state) : inp); const ev = sim.drainEvents(); if (onEv) ev.forEach(onEv); } };
const night = (n, opts = {}) => { const sim = createSim({ seed: 3, spawnScale: 0, god: true, save: 'late', ...opts }); sim.goto(`night${n}`); sim.state.player.xpNext = 1e9; sim.drainEvents(); return sim; };

test('ten nights with titles, moons and twists; a dawn leads to the camp before the next night (no coming soon)', () => {
  assert.equal(NIGHTS.length, 10);
  assert.deepEqual(NIGHTS.map((n) => n.title), ['', 'BLOOD MOON', 'THE RAM', 'WET WIND', 'THE SHIELD WALL', 'THE SWARM', 'THE COVEN', 'RAM AND ROAR', 'THE LAST WATCH', 'THE RAINMOTHER']);
  assert.ok(NIGHTS[8].spawnMul >= 2.2 - 1e-9 && NIGHTS[0].spawnMul === 1);
  const sim = createSim({ seed: 1, god: true, save: 'mid' }); sim.startNight(); sim.state.player.xpNext = 1e9;
  sim.ctx.troll.arrive(); sim.state.night.trollQueue.length = 0; sim.ctx.troll.hit(1e9, 'bullet'); sim.troll(); sim.ctx.troll.hit(1e9, 'bullet');
  sim.setClock(300); const evs = []; run(sim, 60 * 10, NO_INPUT, (e) => evs.push(e));
  assert.equal(sim.state.mode, 'victory'); assert.ok(!evs.some((e) => e.type === EV.COMING_SOON));
  sim.command({ act: 'continue' }); run(sim, 120);
  assert.equal(sim.state.mode, 'camp'); assert.equal(sim.state.night.n, 3); assert.equal(sim.state.night.title, 'THE RAM');
});

test('the Siege Ram: walks the road, drums, swings 120 at the gate every 2.5 s; fire on its crew stalls it; guns kill the crew', () => {
  const sim = night(3, { save: 'fresh' }); sim.teleportHigh(-11, -1.5, 0, 0);   // (no towers: their fire would stall it)
  const r = sim.ctx.rams.spawn(); const evs = [];
  run(sim, 60 * 120, NO_INPUT, (e) => evs.push(e));
  assert.ok(evs.some((e) => e.type === 'ram.drum'));
  const hits = evs.filter((e) => e.type === 'ram.hit');
  assert.ok(hits.length >= 3, `hits ${hits.length}`);
  assert.ok(Math.abs(hits[1].t - hits[0].t - RAM.swingEvery) < 0.05 && Math.abs(hits[0].dmg - RAM.dmg * nightScale(3).dmg) < 0.1, JSON.stringify(hits[0]));   // (DESIGN §16: ×1.5 on Night III)
  assert.ok(evs.some((e) => e.type === 'ram.swing'));
  // fire on the crew: it stalls and burns
  const s2 = night(3, { save: 'fresh' }); const r2 = s2.ctx.rams.spawn(); run(s2, 60 * 20);
  const e2 = []; for (let i = 0; i < 60 * 6; i++) { s2.fireOp({ kind: FIRE_OP.BURST, x: r2.x, z: r2.z, r: 3, amount: 1, push: 0 }); s2.step(NO_INPUT); e2.push(...s2.drainEvents()); }
  assert.ok(e2.some((e) => e.type === 'ram.stall' && e.on) && r2.hp < r2.hpMax && r2.crew < RAM.crew, JSON.stringify({ hp: r2.hp, max: r2.hpMax, crew: r2.crew }));
  // guns
  const idx = s2.state.rams.indexOf(r2); for (let k = 0; k < 40 && r2.mode !== 'fall'; k++) s2.ctx.rams.damage(idx, 30, 'bullet');
  const e3 = s2.drainEvents(); assert.ok(e3.some((e) => e.type === 'ram.death')); void r;
});

test('rain: Night IV squalls come and go; the Lance is shorter in the rain; the CPU proxy quenches', () => {
  const sim = night(4); const evs = []; let maxRain = 0;
  for (let i = 0; i < 60 * 200; i++) { sim.step(NO_INPUT); evs.push(...sim.drainEvents()); maxRain = Math.max(maxRain, sim.state.weather.rain); }
  const sq = evs.filter((e) => e.type === 'weather.squall');
  assert.ok(sq.some((e) => e.on) && sq.some((e) => !e.on) && maxRain > 0.8, JSON.stringify(sq.map((e) => [e.t, e.on])));
  // the Lance in the rain
  const dry = night(1), wet = night(4);
  wet.state.weather.rain = 1; wet.ctx.nightCfg = { ...wet.ctx.nightCfg, rain: null };
  for (const s of [dry, wet]) { s.teleport(3, 5, Math.PI / 2, 0.15); s.step({ weapon: 3 }); run(s, 30, { yaw: Math.PI / 2, pitch: 0.15 }); run(s, 5, { fire: true, yaw: Math.PI / 2, pitch: 0.15 }); }
  assert.ok(wet.state.player.jet.range < dry.state.player.jet.range * 0.9, `${wet.state.player.jet.range} vs ${dry.state.player.jet.range}`);
  // the proxy: the same burst cools faster with rain
  const a = createFireProxy(), b = createFireProxy(); b.setRain(1);
  for (const f of [a, b]) { f.apply([{ kind: FIRE_OP.BURST, x: 10, z: 20, r: 2, amount: 1, push: 0 }], { x: 0, z: 0 }); for (let i = 0; i < 90; i++) f.step(1 / 60); }
  assert.ok(b.heat(10, 20) < a.heat(10, 20) * 0.7, `${b.heat(10, 20)} vs ${a.heat(10, 20)}`);
});

test('Night V phalanxes, Night VI the swarm (≤ 24 bats), Night VII the coven: 20 s chant → the lamp locked 30 s; killing one breaks it', () => {
  const v = night(5); const ev5 = []; v.setClock(44); run(v, 120, NO_INPUT, (e) => ev5.push(e));
  const ph = ev5.find((e) => e.type === 'phalanx.spawn'); assert.ok(ph && ph.rows === 2 && ph.cols === 6);
  assert.ok(ev5.filter((e) => e.type === EV.E_SPAWN && e.kind === 'brute').length >= 12);
  const vi = night(6, { god: true }); vi.state.player.hpMax = vi.state.player.hp = 1e5; vi.setClock(20); let maxAir = 0;
  for (let i = 0; i < 60 * 100; i++) { vi.step(NO_INPUT); vi.drainEvents(); maxAir = Math.max(maxAir, vi.state.air.length); }
  assert.ok(maxAir > 12 && maxAir <= 24, `bats ${maxAir}`);
  // the coven
  const c = night(7); c.teleportHigh(-11, -1.5, 0, 0); const evc = []; c.setClock(69);
  run(c, 60 * 70, NO_INPUT, (e) => evc.push(e));
  assert.ok(evc.some((e) => e.type === 'coven.gather'));
  const chant = evc.find((e) => e.type === 'coven.chant' && e.on);
  assert.ok(chant, 'the coven chants');
  const lock = evc.find((e) => e.type === 'coven.lock');
  assert.ok(lock && lock.seconds === 30);
  assert.ok(c.state.night.kindleLockT > 0 || evc.some((e) => e.type === 'coven.lock'));
  const pan = ARENA.beacon.pan; c.state.night.kindleLockT = 20; c.state.night.kindleCd = 0; c.teleportHigh(pan.x - 0.5, pan.z, 0, 0);
  const k0 = c.state.night.kindle; c.step({ kindle: true }); assert.equal(c.state.night.kindle, k0, 'the lamp is locked');
  // broken: a coven member dies during the chant
  const c2 = night(7); c2.teleportHigh(-11, -1.5, 0, 0); c2.setClock(69); let broke = false;
  for (let i = 0; i < 60 * 70 && !broke; i++) { c2.step(NO_INPUT); for (const e of c2.drainEvents()) if (e.type === 'coven.chant' && e.on) { const H = c2.state.horde; c2.ctx.horde.damage(e.ids[0], 999, 'bullet', null); void H; } else if (e.type === 'coven.chant' && !e.on && e.broken) broke = true; }
  assert.ok(broke, 'killing one breaks the chant');
});

test('THE RAINMOTHER: rises at 0:30, three phases, tide hits and knocks back, whirlpools, cracks in fire (guns ×3), lanterns, the loss at the gate', () => {
  const sim = night(10, { save: 'endgame' }); sim.teleport(25, 30, 0, 0);
  const evs = []; sim.setClock(29); run(sim, 60 * 8, NO_INPUT, (e) => evs.push(e));
  assert.ok(evs.some((e) => e.type === 'boss.rise')); const b = sim.state.boss; assert.equal(b.hp, Math.round(NIGHTS[9].bossHp * sim.state.night.hpMul)); assert.equal(b.phase, 1);
  assert.ok(sim.state.weather.rain > 0.3, 'the storm comes with her');
  // the tide: the Lamplighter on the road in its line takes 20 and is knocked back
  const s2 = night(10, { save: 'endgame', god: false }); s2.state.player.hpMax = s2.state.player.hp = 1e4; s2.setClock(29); run(s2, 60 * 9);
  const B2 = s2.state.boss; s2.teleport((B2.x + 1) / 2, (B2.z + 4) / 2, 0, 0);
  const e2 = []; B2.tideT = 0; run(s2, 60 * 3, NO_INPUT, (e) => e2.push(e));
  assert.ok(e2.some((e) => e.type === 'boss.tide') && e2.some((e) => e.type === 'boss.tide.hit') && e2.some((e) => e.type === EV.P_HURT && e.source === 'tide'));
  // phases, whirlpools, hexes
  const e3 = []; sim.ctx.bossSys.hurt(b.hpMax * 0.4, 'blast'); run(sim, 60 * 12, NO_INPUT, (e) => e3.push(e));
  assert.equal(b.phase, 2); assert.ok(e3.some((e) => e.type === 'boss.phase' && e.phase === 2) && e3.some((e) => e.type === 'boss.whirl'));
  // the crack: heavy fire at her feet → guns ×3 (she has to be inside the fire's domain: up the hill)
  b.x = 26; b.z = 40; b.k = 6;
  const e4 = []; for (let i = 0; i < 60 * 5 && !b.cracked; i++) { sim.fireOp({ kind: FIRE_OP.BURST, x: b.x, z: b.z, r: 3, amount: 1, push: 0 }); sim.step(NO_INPUT); e4.push(...sim.drainEvents()); }
  assert.ok(b.cracked && e4.some((e) => e.type === 'boss.crack' && e.on));
  const hp0 = b.hp; sim.ctx.bossSys.hurt(100, 'bullet'); assert.ok(Math.abs(hp0 - b.hp - 300) < 1e-6, 'guns ×3 while cracked');
  // a lantern shot out: a shaman less, less rain
  const L = b.lanterns[0]; const rain0 = sim.state.weather.rain;
  sim.ctx.bossSys.hitRay({ lantern: 0 }, 999); const e5 = sim.drainEvents();
  assert.ok(!L.alive && b.lanternsOut === 1 && b.shamans === BOSS.lanterns - 1 && e5.some((e) => e.type === 'boss.lantern'));
  run(sim, 60 * 6); assert.ok(sim.state.weather.rain < rain0);
  // the loss at the gate
  const s3 = night(10, { save: 'endgame', god: false }); s3.setClock(29); run(s3, 60 * 7);
  const B3 = s3.state.boss; B3.x = ARENA.gate.target.x + 1; B3.z = ARENA.gate.target.z + 7; B3.k = 99;
  const e6 = []; run(s3, 60 * 6, NO_INPUT, (e) => e6.push(e));
  assert.ok(e6.some((e) => e.type === 'boss.gate') && e6.some((e) => e.type === EV.FALLEN && e.cause === 'boss'));
});

test('the ending: her fall → mode ending, every beat in order to the card, "Welcome home, Master.", the save records ended; the first one is not skippable; Play again → a new run', () => {
  const storage = memoryStorage();
  const sim = createSim({ seed: 4, god: true, save: 'endgame', storage }); sim.goto('night10'); sim.setClock(29); run(sim, 60 * 8);
  const b = sim.state.boss; sim.ctx.bossSys.hurt(1e9, 'bullet');
  const evs = []; run(sim, 60 * 5, NO_INPUT, (e) => evs.push(e));
  assert.equal(sim.state.mode, 'ending'); assert.ok(evs.some((e) => e.type === 'boss.death') && evs.some((e) => e.type === 'ending.start'));
  assert.equal(sim.meta.ended, true); assert.equal(sim.meta.bestNight, 10);
  sim.command({ act: 'skipEnding' }); run(sim, 60 * 4, NO_INPUT, (e) => evs.push(e));
  assert.notEqual(sim.state.ending.beat, 'card', 'the first ending is not skippable');
  run(sim, Math.ceil(60 * (TIMELINE.ending.duration + 1)), NO_INPUT, (e) => evs.push(e));
  const beats = evs.filter((e) => e.type === 'ending.beat').map((e) => e.id);
  assert.deepEqual(beats, TIMELINE.ending.beats.map((x) => x.id));
  assert.ok(evs.some((e) => e.type === EV.NPC_LINE && e.line === 'master'));
  assert.equal(sim.state.ending.beat, 'card'); assert.equal(sim.state.mode, 'ending', 'it waits at the card');
  sim.command({ act: 'continue' }); run(sim, 3);
  assert.equal(sim.state.mode, 'camp'); assert.equal(sim.state.night.n, 1); assert.equal(sim.state.towers.length, 0);
  // a second ending (the save says ended) is skippable after 3 s
  const s2 = createSim({ seed: 5, storage }); s2.goto('ending'); run(s2, 60 * 1);
  s2.command({ act: 'skipEnding' }); run(s2, 2); assert.notEqual(s2.state.ending.beat, 'card', 'not before 3 s');
  run(s2, 60 * 2.5); s2.command({ act: 'skipEnding' }); run(s2, 3); assert.equal(s2.state.ending.beat, 'card');
  void b;
});

test('determinism through Night X: one seed replays the boss fight to the same hash', () => {
  const h = () => { const s = createSim({ seed: 9, save: 'endgame' }); s.goto('night10'); const bot = createBot({ seed: 9 }); for (let i = 0; i < 60 * 90; i++) { s.step(bot(s.state)); s.drainEvents(); } return [s.hash(), s.state.boss?.hp | 0, s.state.weather.rain.toFixed(3)].join('/'); };
  assert.equal(h(), h());
});

test('bossPower (analytics since DESIGN §16): fresh 0, mid ≈ 0.35, late 1, endgame ≈ 1.15, cap 1.25; boss HP is fixed (no scaling)', () => {
  const P = (name) => { const s = savePreset(name); return bossPower(s, s.run); };
  assert.equal(P('fresh'), 0);
  assert.ok(Math.abs(P('mid') - 0.35) < 0.03, `mid ${P('mid')}`);
  assert.equal(powerRaw(savePreset('late'), savePreset('late').run), POWER.ref); assert.equal(P('late'), 1);
  assert.ok(Math.abs(P('endgame') - 1.15) < 0.02, `endgame ${P('endgame')}`);
  const s = savePreset('mid'), base = bossPower(s, s.run);
  for (const k of ['kestrel', 'blunderbuss', 'lance', 'hide', 'bombs']) { const t = savePreset('mid'); t.upgrades[k] += 1; assert.ok(bossPower(t, t.run) > base, k); }
  const max = savePreset('endgame'); Object.assign(max.upgrades, { kestrel: 10, blunderbuss: 10, lance: 10, hide: 5, bombs: 3 });
  assert.ok(bossPower(max, max.run) <= POWER.cap);
  for (const c of NIGHTS) for (const p of [0, 0.36, 1, 1.25]) assert.equal(bossHpMul(c, p), 1, 'DESIGN §16: no hpFloor, no scaling');
  // in the sim: the troll's HP is the night's, whatever the save
  const hp3 = (save) => { const m = createSim({ seed: 2, spawnScale: 0, god: true, save }); m.goto('night3'); m.setClock(209); run(m, 90); assert.equal(m.state.night.hpMul, 1); return m.state.troll.hpMax; };
  for (const save of ['fresh', 'mid', 'late']) assert.equal(hp3(save), NIGHTS[2].trollHp, save);
});
