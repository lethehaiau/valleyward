// DESIGN §9 (docs/DESIGN.md §9): the roguelite loop, the save, the shop, the towers, charms, elites, Dousers, the new
// skills, fire immunity and Night II, all in the pure sim (Node, the CPU fire proxy).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, memoryStorage, NO_INPUT } from '../src/sim/sim.js';
import { createBot } from '../src/bot/bot.js';
import { EV } from '../src/shared/events.js';
import { ARENA } from '../src/shared/arena.js';
import { FIRE_OP } from '../src/shared/fireops.js';
import { UPGRADES, upgradeCost, TOWERS, CHARM_DUP_GOLD, NIGHTS, DROP_FLY_AFTER, SAVE_KEY } from '../src/shared/meta.js';
import { normalizeSave, savePreset, NPC_LINES } from '../src/sim/run.js';
import { CARD_BY_ID } from '../src/sim/cards.js';
import { K } from '../src/sim/constants.js';

const run = (sim, ticks, inp = NO_INPUT, onEv) => { for (let i = 0; i < ticks; i++) { sim.step(typeof inp === 'function' ? inp(sim.state) : inp); const ev = sim.drainEvents(); if (onEv) ev.forEach(onEv); } };
const quiet = (opts = {}) => { const sim = createSim({ seed: 5, spawnScale: 0, ...opts }); sim.startNight(); sim.drainEvents(); return sim; };
const types = (evs) => evs.map((e) => e.type);

test('the loop: first launch → Night I → camp → Night II → camp → Night III (DESIGN §8: no coming soon) (bot, one seed)', () => {
  const storage = memoryStorage();
  const sim = createSim({ seed: 2, storage, god: true });   // (DESIGN §6.2's boss: the flow, not the fight, is under test here)
  assert.equal(sim.hadSave, false, 'a first launch has no save');
  sim.startIntro();
  const bot = createBot({ seed: 2 });
  const seen = [];
  let campEnters = 0;
  for (let i = 0; i < 60 * 60 * 25 && !seen.includes('night.start:3'); i++) {   // (DESIGN §16: tougher nights run into overtime)
    sim.step(bot(sim.state));
    for (const e of sim.drainEvents()) {
      if ([EV.RUN_START, EV.NIGHT_START, EV.DAWN, EV.FALLEN, EV.CAMP_ENTER, EV.CAMP_LEAVE, EV.COMING_SOON, EV.RUN_END, EV.NIGHT_TITLE].includes(e.type)) seen.push(`${e.type}:${e.type === EV.RUN_START ? e.runN : e.night ?? e.nextNight ?? e.completedNight ?? ''}${e.reason ? ':' + e.reason : ''}`);
      if (e.type === EV.CAMP_ENTER) campEnters++;
    }
  }
  const s = seen.join(' ');
  console.log(`loop: ${s}`);
  assert.match(s, /run\.start:1 night\.start:1 .*dawn:1 camp\.enter:2:dawn camp\.leave:2 night\.title:2 night\.start:2 .*dawn:2 camp\.enter:3:dawn camp\.leave:3 night\.title:3 night\.start:3/);
  assert.ok(!s.includes('coming.soon'));
  const meta = sim.meta;
  assert.equal(meta.nightsCompleted, 2); assert.equal(meta.bestNight, 2); assert.equal(meta.runN, 1);
  assert.ok(Object.values(meta.upgrades).some((v) => v > 0), 'the bot bought upgrades at the camp');
  // reload: a new sim on the same storage keeps everything permanent and starts at the camp
  const again = createSim({ seed: 3, storage });
  assert.equal(again.hadSave, true);
  assert.deepEqual(again.meta.upgrades, meta.upgrades);
  assert.deepEqual(again.meta.charms, meta.charms);
  assert.equal(again.meta.gold, meta.gold);
});

test('a fall: gold banked, the run reset to Night I (towers cleared, cards reset), upgrades and charms kept', () => {
  const storage = memoryStorage();
  const sim = createSim({ seed: 4, storage, save: 'mid' });
  assert.equal(sim.state.night.n, 2, 'mid is between Night I and Night II');
  assert.equal(sim.state.towers.length, 2);
  sim.startNight();
  assert.equal(sim.state.player.level, 11, 'the run carries its level');
  assert.ok(sim.state.taken.blunderbuss, 'and its cards');
  const gold0 = sim.meta.gold;
  sim.state.run.goldRun = 37.6;
  sim.state.gate.hp = 1;
  sim.teleportHigh(-6, -1.5, 0, 0);
  sim.spawn('brute', 6, 0, 2);
  const evs = [];
  run(sim, 600, NO_INPUT, (e) => evs.push(e));
  const end = evs.find((e) => e.type === EV.RUN_END);
  assert.ok(end && end.reason === 'fall' && end.goldBanked === 37, JSON.stringify(end));
  assert.equal(sim.meta.gold, gold0 + 37);
  assert.equal(sim.meta.run, null, 'the run is over in the save at once');
  sim.command({ act: 'continue' });
  run(sim, 2, NO_INPUT, (e) => evs.push(e));
  assert.equal(sim.state.mode, 'camp');
  assert.equal(sim.state.night.n, 1); assert.equal(sim.state.towers.length, 0); assert.equal(sim.state.player.level, 1);
  assert.deepEqual(sim.state.taken, {});
  assert.equal(sim.meta.upgrades.hide, 2); assert.deepEqual(sim.meta.charms.equipped, ['ember-tooth', 'cinder-ward']);
  assert.ok(evs.some((e) => e.type === EV.CAMP_ENTER && e.reason === 'fall'));
  // Brother Cinder's line after a fall
  sim.command({ act: 'open', panel: 'npc' });
  const ev2 = []; run(sim, 2, NO_INPUT, (e) => ev2.push(e));
  assert.equal(ev2.find((e) => e.type === EV.NPC_LINE)?.line, 'fall');
  assert.ok(NPC_LINES.fall.startsWith("You'll be back"));
});

test('the save: round-trip through the storage, normalised (unknown ids dropped, levels clamped), presets', () => {
  const raw = { v: 1, gold: 12.7, upgrades: { hide: 9, kestrel: 2, bogus: 3 }, charms: { owned: ['coin-hook', 'nope', 'coin-hook'], equipped: ['coin-hook', 'ember-tooth'] }, story: { seen: ['home'] },
    run: { night: 2, towers: [{ pad: 'pad-road', type: 'obelisk', level: 7 }, { pad: 'nowhere', type: 'obelisk', level: 1 }], taken: { mason: 9, fake: 1 }, level: 4, xp: 10 } };
  const s = normalizeSave(raw);
  assert.equal(s.gold, 12); assert.equal(s.upgrades.hide, 5); assert.equal(s.upgrades.kestrel, 2); assert.ok(!('bogus' in s.upgrades));
  assert.deepEqual(s.charms.owned, ['coin-hook']); assert.deepEqual(s.charms.equipped, ['coin-hook']);
  assert.deepEqual(s.run.towers, [{ pad: 'pad-road', type: 'obelisk', level: 5 }]);   // (DESIGN §9.6: 5 levels) assert.deepEqual(s.run.taken, { mason: 3 });
  assert.equal(normalizeSave({ v: 2 }), null); assert.equal(normalizeSave('x'), null);
  const storage = memoryStorage();
  const a = createSim({ seed: 1, storage, save: 'rich' });
  assert.equal(a.meta.gold, 99999);   // (rich has gold for the organ's line)
  a.toCamp(); a.drainEvents();
  a.command({ act: 'buy', item: 'hide' }); a.command({ act: 'build', pad: 'pad-slope', type: 'chainimp' }); a.command({ act: 'equip', charm: 'coin-hook', on: true });
  run(a, 2);
  const b = createSim({ seed: 1, storage });
  assert.equal(b.meta.upgrades.hide, 1); assert.deepEqual(b.meta.charms.equipped, ['ember-tooth', 'coin-hook']);
  assert.deepEqual(b.meta.run.towers, [{ pad: 'pad-slope', type: 'chainimp', level: 1 }]);
  assert.equal(b.meta.gold, 99999 - upgradeCost(UPGRADES[0], 0) - TOWERS.chainimp.cost[0]);
  assert.equal(typeof SAVE_KEY, 'string');
  const mid = savePreset('mid');
  assert.equal(mid.upgrades.hide, 2); assert.equal(mid.upgrades.lance, 2); assert.equal(mid.charms.equipped.length, 2); assert.equal(mid.run.towers.length, 2);
});

test('the shop: costs grow ×1.6 a level, gold is checked, levels cap; charm slots 2 → 4', () => {
  const sim = createSim({ seed: 1, save: { v: 1, gold: 1000, upgrades: {}, charms: { owned: ['ember-tooth', 'coin-hook', 'ashen-step', 'soot-lens', 'cinder-ward'], equipped: [] }, story: { seen: [] } } });
  sim.toCamp(); sim.drainEvents();
  const hide = UPGRADES.find((u) => u.id === 'hide');
  assert.deepEqual([0, 1, 2, 3, 4].map((l) => upgradeCost(hide, l)), [60, 96, 154, 246, 393]);
  const evs = [];
  for (let k = 0; k < 6; k++) { sim.command({ act: 'buy', item: 'hide' }); run(sim, 1, NO_INPUT, (e) => evs.push(e)); }
  const buys = evs.filter((e) => e.type === EV.BUY);
  assert.equal(buys.length, 5, 'five levels (60 + 96 + 154 + 246 + 393 = 949), then MAXED');
  assert.equal(sim.meta.gold, 1000 - 949); assert.equal(buys[4].goldLeft, 51);
  assert.ok(evs.some((e) => e.type === 'shop.denied' && e.reason === 'max'));
  sim.command({ act: 'buy', item: 'lance' }); run(sim, 1, NO_INPUT, (e) => evs.push(e));
  assert.ok(evs.some((e) => e.type === 'shop.denied' && e.reason === 'gold'), 'the Lance costs 60: not enough gold');
  for (const c of ['ember-tooth', 'coin-hook', 'ashen-step']) { sim.command({ act: 'equip', charm: c, on: true }); run(sim, 1); }
  assert.deepEqual(sim.meta.charms.equipped, ['ember-tooth', 'coin-hook'], 'two slots at start');
  sim.setGold(1000); sim.command({ act: 'buy', item: 'slots' }); sim.command({ act: 'equip', charm: 'ashen-step', on: true }); run(sim, 1);
  assert.equal(sim.meta.charms.equipped.length, 3);
  sim.command({ act: 'equip', charm: 'coin-hook', on: false }); run(sim, 1);
  assert.deepEqual(sim.meta.charms.equipped, ['ember-tooth', 'ashen-step']);
  // upgrades apply at nightfall
  sim.setGold(5000); for (const id of ['kestrel', 'lance', 'bombs', 'gate']) sim.command({ act: 'buy', item: id }); run(sim, 1);
  sim.command({ act: 'kindle' }); run(sim, 60 * 4.2);
  const st = sim.state, p = st.player;
  assert.equal(st.mode, 'play');
  assert.equal(p.hpMax, 100 + 15 * 5); assert.equal(p.fuelMax, 115); assert.equal(p.bombsMax, 4); assert.equal(st.gate.hpMax, 1150);
  assert.ok(Math.abs(st.mods.kestrelDmg - 1.15) < 1e-9 && Math.abs(st.mods.dmgTaken - 0.75) < 1e-9 && Math.abs(st.mods.speed - 1.08) < 1e-9, JSON.stringify(st.mods));
});

test('towers: the Obelisk pulses a violet fire nova that damages inside its radius; the Chain Imp hooks, slows and pulls (brutes first)', () => {
  const sim = createSim({ seed: 7, spawnScale: 0, god: true, save: { v: 1, gold: 2000, upgrades: {}, charms: { owned: [], equipped: [] }, story: { seen: [] } } });
  sim.toCamp(); sim.drainEvents();
  sim.command({ act: 'build', pad: 'pad-slope', type: 'obelisk' }); sim.command({ act: 'build', pad: 'pad-bend', type: 'chainimp' }); sim.command({ act: 'upgrade', pad: 'pad-bend' });
  const evs = []; run(sim, 2, NO_INPUT, (e) => evs.push(e));
  const builds = evs.filter((e) => e.type === EV.TOWER_BUILD);
  assert.equal(builds.length, 2); assert.equal(builds[0].tower, 'obelisk'); assert.equal(builds[0].type, EV.TOWER_BUILD);
  assert.ok(evs.some((e) => e.type === EV.TOWER_UPGRADE && e.level === 2));
  assert.equal(sim.meta.gold, 2000 - TOWERS.obelisk.cost[0] - TOWERS.chainimp.cost[0] - TOWERS.chainimp.cost[1]);
  sim.command({ act: 'kindle' }); run(sim, 60 * 4.2);
  assert.equal(sim.state.mode, 'play');
  const H = sim.state.horde;
  sim.spawn('grunt', 8, 5, 17);   // inside the obelisk's 4.5 m
  sim.spawn('grunt', 6, 27, 24); sim.spawn('brute', 1, 30, 22);   // near the imp (27, 14)
  const ops = [], ev2 = [];
  const hp0 = []; for (let i = 0; i < H.count; i++) hp0[i] = H.hp[i];
  for (let i = 0; i < 60 * 4; i++) { sim.step(NO_INPUT); ops.push(...sim.state.fireOps); ev2.push(...sim.drainEvents()); }
  const pulse = ev2.find((e) => e.type === EV.OBELISK_PULSE);
  assert.ok(pulse && pulse.r === TOWERS.obelisk.radius[0] && pulse.pad === 'pad-slope');
  const violet = ops.filter((o) => o.kind === FIRE_OP.BURST && o.hue === 'violet');
  assert.ok(violet.length >= 8, `violet bursts: ${violet.length}`);
  for (const o of violet) assert.ok(Math.hypot(o.x - 5, o.z - 15) < TOWERS.obelisk.radius[0] + 0.1);
  assert.ok(ev2.some((e) => e.type === EV.E_HIT && Math.hypot(e.pos.x - 5, e.pos.z - 15) < 6), 'the nova hurts the goblins inside');
  const throws = ev2.filter((e) => e.type === EV.CHAIN_THROW), hooks = ev2.filter((e) => e.type === EV.CHAIN_HOOK);
  assert.ok(throws.length >= 2 && hooks.length >= 2, `throws ${throws.length} hooks ${hooks.length}`);
  assert.equal(H.kind[throws[0].targetId], K.brute, 'the first hook goes to the brute');
  const hooked = hooks[0].targetId;
  assert.ok(Math.abs(H.slowK[hooked] - (1 - TOWERS.chainimp.slow[1])) < 1e-6 || H.slowT[hooked] <= 0, 'level 2 slows 40 %');
  assert.ok(sim.state.stats.hooks >= 2);
  // the pull: a goblin hooked from 10 m moves ~2.5 m toward the imp in 0.4 s
  const sim2 = createSim({ seed: 8, spawnScale: 0, god: true, save: { v: 1, gold: 500, upgrades: {}, charms: { owned: [], equipped: [] }, story: { seen: [] }, run: { night: 1, towers: [{ pad: 'pad-bend', type: 'chainimp', level: 1 }], taken: {}, level: 1, xp: 0 } } });
  sim2.startNight();
  sim2.spawn('brute', 1, 27, 25);
  const H2 = sim2.state.horde;
  let id = -1, d0 = 0, dHook = 0;
  for (let i = 0; i < 60 * 3 && dHook === 0; i++) { sim2.step(NO_INPUT); for (const e of sim2.drainEvents()) if (e.type === EV.CHAIN_HOOK) { id = e.targetId; d0 = Math.hypot(H2.x[id] - 27, H2.z[id] - 14); dHook = 1; } }
  assert.ok(id >= 0, 'hooked');
  run(sim2, 30);
  const d1 = Math.hypot(H2.x[id] - 27, H2.z[id] - 14);
  assert.ok(d0 - d1 > TOWERS.chainimp.pull[0] * 0.75, `pulled ${(d0 - d1).toFixed(2)} m (from ${d0.toFixed(1)})`);
});

test('charms: a Chieftain drops one (a pickup that flies to you), duplicates give gold, Witchfire Wick turns the Lance green', () => {
  const sim = quiet({ seed: 11 });
  sim.teleport(3, 5, 0, 0);
  sim.spawn('chief', 1, 4, 8);
  const H = sim.state.horde;
  let chief = -1; for (let i = 0; i < H.count; i++) if (H.state[i] && H.kind[i] === K.chief) chief = i;
  sim.ctx.horde.damage(chief, 999, 'bullet', null);
  const evs = []; run(sim, 120, NO_INPUT, (e) => evs.push(e));
  const drop = evs.find((e) => e.type === EV.CHARM_DROP), pick = evs.find((e) => e.type === EV.CHARM_PICKUP);
  assert.ok(drop && pick && pick.charm === drop.charm && pick.dup === false, JSON.stringify({ drop, pick }));
  assert.ok(sim.meta.charms.owned.includes(drop.charm) && sim.meta.charms.equipped.includes(drop.charm), 'owned and auto-equipped');
  // (DESIGN §16: coin drops are a chance ×0.3 now, so a gold pile is not guaranteed)
  // a duplicate → CHARM_DUP_GOLD
  const gold0 = sim.meta.gold;
  sim.ctx.state.pickups.push({ id: 999, kind: 'charm', charm: drop.charm, x: 3, y: 1, z: 5.2, y0: 1, vx: 0, vz: 0, value: 0, t: 1, fly: true });
  const ev2 = []; run(sim, 5, NO_INPUT, (e) => ev2.push(e));
  const dup = ev2.find((e) => e.type === EV.CHARM_PICKUP);
  assert.ok(dup && dup.dup && dup.gold === CHARM_DUP_GOLD); assert.equal(sim.meta.gold, gold0 + CHARM_DUP_GOLD);
  // Witchfire Wick
  const w = createSim({ seed: 3, spawnScale: 0, save: { v: 1, gold: 0, runN: 1, upgrades: {}, charms: { owned: ['witchfire-wick'], equipped: ['witchfire-wick'] }, story: { seen: [] } } });
  w.startNight(); w.teleport(3, 5, Math.PI / 2, -0.1);
  w.step({ weapon: 3 }); run(w, 30);
  const ops = []; for (let i = 0; i < 20; i++) { w.step({ fire: true, yaw: Math.PI / 2, pitch: -0.1 }); ops.push(...w.state.fireOps); }
  const streams = ops.filter((o) => o.kind === FIRE_OP.STREAM);
  assert.ok(streams.length > 10 && streams.every((o) => o.hue === 'green'));
  assert.ok(Math.abs(w.state.mods.fireDmg - 1.05) < 1e-9);
});

test('elites and Dousers: at most 3 elites a night on schedule; a Hexer hex sputters the Lance; a Douser puts fire out', () => {
  // the schedule: Night I chieftains at 2:00 and 3:20; Night II hexers at 1:30, 2:40, 3:50
  const s1 = createSim({ seed: 1, spawnScale: 0, god: true }); s1.startNight();
  const e1 = []; s1.setClock(119); run(s1, 60 * 2, NO_INPUT, (e) => e1.push(e)); s1.setClock(199); run(s1, 60 * 2, NO_INPUT, (e) => e1.push(e));
  assert.deepEqual(e1.filter((e) => e.type === EV.ELITE_SPAWN).map((e) => e.kind), ['chief', 'chief']);
  assert.equal(s1.state.elites.length, 2); assert.equal(s1.state.elites[0].name, 'Goblin Chieftain');
  assert.deepEqual(NIGHTS[1].elites.hexer.length, 3);
  // a hex
  const s = quiet({ seed: 12 });
  s.teleport(3, 5, 0, 0);
  s.spawn('hexer', 1, 3, 21);   // 16 m south: in its 13–20 m band
  const evs = []; run(s, 60 * 6, NO_INPUT, (e) => evs.push(e));
  const hex = evs.find((e) => e.type === EV.HEX);
  assert.ok(hex, 'a hex was thrown');
  assert.ok(hex.hit, 'a standing Lamplighter is hit');
  // sputter: the lance does not spray for 2 s after a hit
  const s2 = quiet({ seed: 12 }); s2.teleport(3, 5, Math.PI / 2, -0.1); s2.step({ weapon: 3 }); run(s2, 30);
  s2.state.player.sputterT = 2;
  const o2 = []; for (let i = 0; i < 60; i++) { s2.step({ fire: true, yaw: Math.PI / 2, pitch: -0.1 }); o2.push(...s2.state.fireOps); }
  assert.equal(o2.filter((o) => o.kind === FIRE_OP.STREAM).length, 0, 'no spray while hexed');
  for (let i = 0; i < 80; i++) { s2.step({ fire: true, yaw: Math.PI / 2, pitch: -0.1 }); o2.push(...s2.state.fireOps); }
  assert.ok(o2.filter((o) => o.kind === FIRE_OP.STREAM).length > 10, 'sprays again after 2 s');
  // a Douser throws water at a burning trough
  const d = quiet({ seed: 13 });
  d.teleportHigh(-2, -1.5, 0, 0);
  d.state.troughs[1].lit = true;
  d.spawn('douser', 1, 9, 7);
  const ev3 = [], ops3 = [];
  for (let i = 0; i < 60 * 4; i++) { d.step(NO_INPUT); ev3.push(...d.drainEvents()); ops3.push(...d.state.fireOps); }
  assert.ok(ev3.some((e) => e.type === EV.DOUSE_THROW), 'a throw');
  assert.ok(ops3.some((o) => o.kind === FIRE_OP.DOUSE && o.r === 2.5), 'a douse op on landing');
});

test('new cards: Ember Orbit (blue, hits), Cinder Trail (lilac embers while running), Brimstone Rain (green burst), Bellows; no healing cards (DESIGN §16)', () => {
  for (const id of ['mend', 'soul-feast', 'soul-feast-up', 'windward']) assert.equal(CARD_BY_ID[id], undefined, `${id} removed`);
  const sim = quiet({ seed: 21 });
  sim.teleport(3, 5, 0, 0);
  for (const id of ['ember-orbit', 'ember-orbit', 'cinder-trail', 'brimstone', 'bellows']) { CARD_BY_ID[id].apply(sim.ctx); sim.state.taken[id] = (sim.state.taken[id] || 0) + 1; }
  assert.equal(sim.state.mods.orbit, 2); assert.ok(Math.abs(sim.state.mods.lanceRefill - 1.35) < 1e-9);
  sim.spawn('grunt', 6, 3, 7.2);
  const ops = [], evs = [];
  for (let i = 0; i < 60 * 3; i++) { sim.step({ fwd: i < 90 ? 1 : 0, sprint: true, yaw: Math.PI / 2 }); ops.push(...sim.state.fireOps); evs.push(...sim.drainEvents()); }
  assert.equal(sim.state.orbit.length, 2);
  assert.ok(Math.abs(Math.hypot(sim.state.orbit[0].x - sim.state.player.x, sim.state.orbit[0].z - sim.state.player.z) - 2.2) < 1e-6);
  assert.ok(evs.some((e) => e.type === EV.ORBIT_HIT), 'the orbit hits goblins');
  assert.ok(ops.some((o) => o.kind === FIRE_OP.EMBER && o.hue === 'blue'), 'blue embers');
  assert.ok(ops.some((o) => o.kind === FIRE_OP.EMBER && o.hue === 'lilac'), 'the lilac trail');
  assert.ok(evs.some((e) => e.type === EV.TRAIL));
  // brimstone: a crowd far out, a meteor, a green burst after its flight
  sim.spawn('grunt', 30, 10, 30);
  const o2 = [], e2 = [];
  for (let i = 0; i < 60 * 10; i++) { sim.step(NO_INPUT); o2.push(...sim.state.fireOps); e2.push(...sim.drainEvents()); }
  assert.ok(e2.some((e) => e.type === EV.METEOR));
  assert.ok(o2.some((o) => o.kind === FIRE_OP.BURST && o.hue === 'green' && o.r === 3));
  // DESIGN §3.4: no regeneration
  const p = sim.state.player; p.hp = 50;
  run(sim, 120);
  assert.equal(p.hp, 50, 'no healing over time');
});

test('drops (DESIGN §9.3): every kill spills an XP gem that flies to you after 0.6 s; gold banks at dawn', () => {
  const sim = quiet({ seed: 31 });
  sim.teleportHigh(0, -1.5, 0, 0);
  sim.state.player.xpNext = 1e9;
  sim.spawn('grunt', 10, 6, 14); sim.spawn('brute', 2, 10, 14);
  const H = sim.state.horde;
  for (let i = 0; i < H.count; i++) if (H.state[i]) sim.ctx.horde.damage(i, 999, 'bullet', null);
  const evs = sim.drainEvents();
  assert.equal(evs.filter((e) => e.type === EV.XP_DROP).length, 12);
  assert.equal(sim.state.player.xp, 0, 'not yet: the gems spill first');
  const xpGems = sim.state.pickups.filter((g) => g.kind === 'xp');
  assert.equal(xpGems.length, 12);
  run(sim, Math.round(DROP_FLY_AFTER * 60) - 2);
  assert.ok(sim.state.pickups.filter((g) => g.kind === 'xp').every((g) => !g.fly), 'they wait 0.6 s');
  run(sim, 120);
  assert.equal(sim.state.player.xp, 10 * 1 + 2 * 5, 'credited on arrival');
  assert.equal(sim.state.pickups.length, 0);
});

test('the Lamplighter is immune to fire (DESIGN §3.3)', () => {
  const sim = quiet(); sim.setFire({ heat: () => 1, fuel: () => 1 });
  sim.teleport(3, 5, 0, 0);
  const hp0 = sim.state.player.hp;
  const evs = []; run(sim, 300, NO_INPUT, (e) => evs.push(e));
  assert.equal(sim.state.player.hp, hp0);
  assert.ok(!evs.some((e) => e.type === EV.P_HURT && e.source === 'fire'));
});

test('Night II: spawns ×1.35 with Dousers; two trolls (2:30 and 4:00); dawn needs both dead; the moon is blood', () => {
  const sim = createSim({ seed: 9, god: true, save: 'mid' });
  sim.startNight();
  const st = sim.state;
  assert.equal(st.night.n, 2); assert.equal(st.night.moon, 'blood'); assert.deepEqual(st.night.trollQueue, [150, 240]);
  const evs = [];
  sim.setClock(100); run(sim, 60 * 20, NO_INPUT, (e) => evs.push(e));
  assert.ok(evs.some((e) => e.type === EV.E_SPAWN && e.kind === 'douser'), 'Dousers in the mix');
  sim.setClock(149); run(sim, 120, NO_INPUT, (e) => evs.push(e));
  assert.equal(evs.filter((e) => e.type === EV.T_ARRIVE).length, 1);
  sim.ctx.troll.hit(1e6, 'bullet'); run(sim, 200);
  sim.setClock(239); run(sim, 120, NO_INPUT, (e) => evs.push(e));
  assert.equal(evs.filter((e) => e.type === EV.T_ARRIVE).length, 2, 'the second troll');
  assert.ok(st === sim.state && st.troll.alive);
  sim.setClock(300); run(sim, 120);
  assert.equal(sim.state.mode, 'play', 'no dawn while the second troll lives');
  sim.ctx.troll.hit(1e6, 'bullet'); run(sim, 200);
  assert.equal(sim.state.mode, 'victory');
});

test('determinism through the camp: one seed replays the whole loop to the same hash', () => {
  const h = () => {
    const sim = createSim({ seed: 17, save: 'rich' }); sim.toCamp();
    const bot = createBot({ seed: 17 });
    for (let i = 0; i < 60 * 50; i++) { sim.step(bot(sim.state)); sim.drainEvents(); }
    return [sim.hash(), sim.state.mode, sim.meta.gold].join('/');
  };
  const a = h(), b = h();
  assert.equal(a, b);
  assert.match(a, /\/play\//, 'the bot shopped, kindled the lamp and is in the night');
});

test('the gate mound never forms on the Lamplighter: chasers stay on the ground; the mound still forms at the gate', async () => {
  const { groundHeight } = await import('../src/shared/arena.js');
  // a player on the plaza near the gate (3, 6), a crowd at the gate and 30 grunts 7 m ahead
  const sim = createSim({ seed: 41, spawnScale: 0, god: true }); sim.startNight();
  sim.teleport(3, 6, Math.PI / 2, 0); sim.state.player.xpNext = 1e9;
  sim.spawn('grunt', 120, 0.5, 2.5); sim.spawn('grunt', 30, 10, 6);
  const H = sim.state.horde;
  let worst = 0, near = 0, chasers = 0;
  for (let t = 0; t < 60 * 6; t++) {
    sim.step({ yaw: Math.PI / 2, pitch: 0 }); sim.drainEvents();
    const p = sim.state.player;
    for (let i = 0; i < H.count; i++) {
      if (!H.state[i] || H.state[i] === 4) continue;
      const lift = H.y[i] - groundHeight(H.x[i], H.z[i]);
      if (H.target[i] === 1) { chasers++; worst = Math.max(worst, lift); }
      if (Math.hypot(H.x[i] - p.x, H.z[i] - p.z) < 3) { near++; worst = Math.max(worst, lift); }
    }
  }
  assert.ok(chasers > 100 && near > 100, `the crowd reached the player (chaser-ticks ${chasers}, near-ticks ${near})`);
  assert.ok(worst <= 0.05, `a goblin by the player was lifted ${worst.toFixed(2)} m`);
  // no player near (on the far end of the wall walk): the mound forms at the gate's mouth
  const m = createSim({ seed: 42, spawnScale: 0, god: true }); m.startNight();
  m.teleportHigh(-11, -1.5, 0, 0); m.state.player.xpNext = 1e9;
  m.spawn('grunt', 200, 0.5, 3);
  const H2 = m.state.horde;
  for (let t = 0; t < 60 * 6; t++) { m.step(NO_INPUT); m.drainEvents(); }
  let top = 0; for (let i = 0; i < H2.count; i++) if (H2.state[i] && H2.state[i] !== 4 && Math.hypot(H2.x[i], H2.z[i] - 1.2) < 3) top = Math.max(top, H2.y[i] - groundHeight(H2.x[i], H2.z[i]));
  assert.ok(top > 1.0, `the gate mound is ${top.toFixed(2)} m high`);
});
