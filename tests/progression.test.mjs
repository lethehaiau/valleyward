// DESIGN (docs/DESIGN.md): skill cards unlock once then upgrade, the BEGIN NIGHT command and the first-camp tip, towers
// to 5 levels, weapon lines to 10, the THUNDER ORGAN, Bat Gremlins, the stronger Ash Troll and its Ash Roar, Pyre Burst,
// and the sim's enemy cost (LOD keeps far goblins moving at the same average speed). Node, the CPU fire proxy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, NO_INPUT } from '../src/sim/sim.js';
import { EV } from '../src/shared/events.js';
import { FIRE_OP } from '../src/shared/fireops.js';
import { UPGRADES, upgradeCost, TOWERS, ORGAN, NIGHTS } from '../src/shared/meta.js';
import { CARDS, CARD_BY_ID, drawCards, skillLevel } from '../src/sim/cards.js';
import { TROLL } from '../src/sim/constants.js';
import { groundFast } from '../src/sim/world.js';
import { groundHeight } from '../src/shared/arena.js';

const run = (sim, ticks, inp = NO_INPUT, onEv) => { for (let i = 0; i < ticks; i++) { sim.step(typeof inp === 'function' ? inp(sim.state) : inp); const ev = sim.drainEvents(); if (onEv) ev.forEach(onEv); } };

test('skill cards unlock once, then upgrade: an owned skill\'s unlock never reappears, no upgrade without it, one card per skill per offer', () => {
  const skills = CARDS.filter((c) => c.cls === 'skill' && c.kind === 'unlock').map((c) => c.id);
  assert.ok(skills.includes('pyre-burst') && skills.includes('cinder-trail') && skills.includes('contagion'));
  assert.ok(CARD_BY_ID['cinder-trail-up'] && !CARD_BY_ID['contagion-up'], 'single-level skills have no upgrade card');
  for (let seed = 1; seed <= 30; seed++) {
    const sim = createSim({ seed, spawnScale: 0 }); sim.startNight();
    const ctx = sim.ctx, taken = sim.state.taken;
    for (let k = 0; k < 40; k++) {
      const ids = drawCards(ctx, taken);
      const bySkill = ids.map((id) => CARD_BY_ID[id].skill).filter(Boolean);
      assert.equal(new Set(bySkill).size, bySkill.length, `seed ${seed}: two cards of one skill in ${ids}`);
      assert.equal(new Set(ids).size, ids.length);
      for (const id of ids) {
        const c = CARD_BY_ID[id];
        if (c.kind === 'unlock') assert.equal(skillLevel(taken, c.skill), 0, `seed ${seed}: the unlock of owned ${c.skill} offered`);
        if (c.kind === 'upgrade') { const lv = skillLevel(taken, c.skill); assert.ok(lv >= 1 && lv < c.levels, `seed ${seed}: ${id} offered at level ${lv}`); }
      }
      const id = ids[(seed + k) % ids.length]; CARD_BY_ID[id].apply(ctx); taken[id] = (taken[id] || 0) + 1;
    }
    for (const s of skills) assert.ok((taken[s] || 0) <= 1);
  }
});

test('BEGIN NIGHT: the command leaves the camp like E at the pan; the first camp of a save shows the tip once', () => {
  const sim = createSim({ seed: 2, save: 'fresh' });
  sim.toCamp(); const evs = []; run(sim, 2, NO_INPUT, (e) => evs.push(e));
  assert.equal(sim.state.camp.tip, true); assert.ok(evs.some((e) => e.type === EV.CAMP_ENTER && e.tip));
  sim.command({ act: 'beginNight' }); run(sim, 2);
  assert.equal(sim.state.mode, 'camp', 'ignored during the camp-enter hold');
  run(sim, 100);
  sim.command({ act: 'beginNight' }); run(sim, 2, NO_INPUT, (e) => evs.push(e));
  assert.equal(sim.state.mode, 'intro'); assert.ok(evs.some((e) => e.type === EV.CAMP_LEAVE));
  run(sim, 60 * 4.2); assert.equal(sim.state.mode, 'play');
  sim.toCamp(); run(sim, 2); assert.equal(sim.state.camp.tip, false, 'only the first camp');
});

test('towers have 5 levels with DESIGN §9.6 numbers; the weapon lines go to 10 at base × 1.45^level (the Organ 1.3, DESIGN §4.2)', () => {
  assert.deepEqual(TOWERS.obelisk.cost, [140, 220, 360, 600, 1000]); assert.deepEqual(TOWERS.chainimp.pull, [1.2, 1.6, 2.2, 2.8, 3.4]);
  const sim = createSim({ seed: 3, save: 'rich' }); sim.toCamp(); run(sim, 100);
  sim.command({ act: 'build', pad: 'pad-road', type: 'obelisk' }); for (let k = 0; k < 5; k++) sim.command({ act: 'upgrade', pad: 'pad-road' });
  run(sim, 2);
  assert.equal(sim.state.run.towers.find((t) => t.pad === 'pad-road').level, 5);
  for (const id of ['kestrel', 'blunderbuss', 'lance', 'organ']) {
    const u = UPGRADES.find((x) => x.id === id);
    assert.equal(u.max, 10); assert.equal(upgradeCost(u, 3), Math.round(u.base * (id === 'organ' ? 1.3 : 1.45) ** 3));   // (DESIGN §4.2: the Organ's line 450 × 1.3^level)
  }
  const hide = UPGRADES.find((x) => x.id === 'hide'); assert.equal(hide.max, 5); assert.equal(upgradeCost(hide, 2), Math.round(60 * 1.6 ** 2));
  const g0 = sim.meta.gold; for (let k = 0; k < 10; k++) sim.command({ act: 'buy', item: 'kestrel' }); run(sim, 2);
  assert.equal(sim.meta.upgrades.kestrel, 10);
  const spent = Array.from({ length: 10 }, (_, l) => upgradeCost(UPGRADES.find((x) => x.id === 'kestrel'), l)).reduce((a, b) => a + b, 0);
  assert.equal(g0 - sim.meta.gold, spent);
});

test('the THUNDER ORGAN: its price (DESIGN §4.2: 4,500), slot 2, spin-up then ORGAN.rate rounds/s, a drum, overheat; rich owns it; the swap toggle', () => {
  const poor = createSim({ seed: 1, save: { v: 1, gold: ORGAN.cost - 1, upgrades: {}, charms: { owned: [], equipped: [] }, story: { seen: [] } } });
  poor.toCamp(); run(poor, 100); poor.command({ act: 'buyOrgan' }); const e0 = []; run(poor, 2, NO_INPUT, (e) => e0.push(e));
  assert.ok(e0.some((e) => e.type === 'shop.denied' && e.reason === 'gold')); assert.equal(poor.meta.organ.owned, false);
  poor.setGold(ORGAN.cost); poor.command({ act: 'buyOrgan' }); run(poor, 2);
  assert.equal(poor.meta.organ.owned, true); assert.equal(poor.meta.gold, 0); assert.equal(poor.state.player.unlocked.organ, true);
  poor.command({ act: 'equipOrgan', on: false }); run(poor, 2); assert.equal(poor.state.player.unlocked.organ, false, 'swapped back to the Blunderbuss');
  const sim = createSim({ seed: 1, spawnScale: 0, god: true, save: 'rich' }); sim.startNight(); sim.state.player.xpNext = 1e9;   // (no card pause mid-test)
  assert.equal(sim.meta.organ.owned, true);
  sim.teleport(3, 18, Math.PI, -0.1); sim.spawn('grunt', 60, 3, 6);
  sim.step({ weapon: 2 }); run(sim, 40, { yaw: Math.PI, pitch: -0.1 });
  assert.equal(sim.state.player.weapon, 'organ');
  const evs = []; let firstShotT = null, rounds = 0, hits = 0; const t0 = sim.state.t;
  // aim at the nearest goblin's chest below the wall walk
  const aim = (st) => { const H = st.horde, p = st.player; let bi = -1, bd = 1e9; for (let i = 0; i < H.count; i++) { if (H.state[i] !== 1 && H.state[i] !== 2) continue; const d = Math.hypot(H.x[i] - p.x, H.z[i] - p.z); if (d < bd) { bd = d; bi = i; } }
    if (bi < 0) return { fire: true, yaw: Math.PI, pitch: -0.1 }; const dx = H.x[bi] - p.x, dz = H.z[bi] - p.z; return { fire: true, yaw: Math.atan2(dx, dz), pitch: Math.atan2(H.y[bi] + 0.6 - (p.y + 1.68), Math.hypot(dx, dz)) }; };
  run(sim, 60 * 7, aim, (e) => { evs.push(e); if (e.type === EV.SHOT && e.weapon === 'organ') { rounds += e.pellets.length; hits += e.pellets.filter((q) => q.hitId != null).length; if (firstShotT == null) firstShotT = e.t - t0; } });
  assert.ok(firstShotT >= ORGAN.spinUp - 0.02 && firstShotT < ORGAN.spinUp + 0.1, `first round after ${firstShotT} s`);
  assert.ok(evs.some((e) => e.type === 'organ.fire') && evs.some((e) => e.type === 'organ.overheat'));
  assert.ok(rounds >= 18 * 5 && rounds <= ORGAN.drum, `${rounds} rounds before the overheat`);
  assert.equal(evs.filter((e) => e.type === 'organ.fire').length, 1, 'one firing loop start');
  assert.ok(hits > rounds * 0.5 && sim.state.stats.kills > 20, `hits ${hits} of ${rounds}, kills ${sim.state.stats.kills}`);
});

test('Bat Gremlins: Night II only, flocks of 3–6 (≤ 12 alive), dives that hit a standing Lamplighter, hit by guns in 3D, lit by the Lance\'s jet', () => {
  const n1 = createSim({ seed: 5, spawnScale: 0, god: true }); n1.startNight(); n1.setClock(20); run(n1, 60 * 60);
  assert.equal(n1.state.air.length, 0, 'none in Night I');
  const sim = createSim({ seed: 5, spawnScale: 0, save: 'mid' }); sim.startNight(); sim.setClock(24);
  sim.teleport(3, 6, 0, 0); sim.state.player.hpMax = sim.state.player.hp = 5000;   // (a standing target: they hit it often)
  const evs = []; let maxAlive = 0;
  run(sim, 60 * 70, { yaw: 0, pitch: 0 }, (e) => evs.push(e)); maxAlive = sim.state.air.length;
  const spawns = evs.filter((e) => e.type === 'air.spawn');
  assert.ok(spawns.length >= 2 && spawns.every((e) => e.n >= 1 && e.n <= 6), JSON.stringify(spawns.map((e) => e.n)));
  assert.ok(maxAlive <= 12);
  assert.ok(evs.some((e) => e.type === 'air.screech') && evs.some((e) => e.type === 'air.hit') && evs.some((e) => e.type === EV.P_HURT && e.source === 'air'));
  // a gun hits a bat in the air; the Lance's jet sets one alight
  const st = sim.state, b = st.air.find((x) => x.alive);
  assert.ok(b, 'a bat alive');
  const p = st.player; sim.ctx.state.player.xpNext = 1e9;
  const dir = { x: b.x - p.x, y: b.y - (p.y + 1.68), z: b.z - p.z }, dl = Math.hypot(dir.x, dir.y, dir.z);
  const hit = sim.ctx.air.rayHit({ x: p.x, y: p.y + 1.68, z: p.z }, { x: dir.x / dl, y: dir.y / dl, z: dir.z / dl }, 80);
  assert.ok(hit && Math.abs(hit.t - dl) < 1);
  sim.ctx.air.jetHit(b.x - 1, b.y, b.z, b.x + 1, b.y, b.z, 0.75);
  assert.ok(b.burn > 0 && b.mode === 'fall');
  const e2 = []; run(sim, 60 * 4, { yaw: 0, pitch: 0 }, (e) => e2.push(e));
  assert.ok(e2.some((e) => e.type === 'air.crash' && e.burned));
});

test('the Ash Troll: HP from NIGHTS (tuned: Night I 9,250, Night II 10,000), damage ×1.4, the Ash Roar douses a cone and calls 30 goblins', () => {
  assert.equal(NIGHTS[0].trollHp, 9250); assert.equal(NIGHTS[1].trollHp, 10000);
  assert.equal(TROLL.smash.dmg, 84);
  const sim = createSim({ seed: 6, spawnScale: 0, god: true }); sim.startNight(); sim.state.player.xpNext = 1e9;
  const tr = sim.troll(); assert.equal(tr.hpMax, NIGHTS[0].trollHp);
  const evs = [], ops = [];
  for (let i = 0; i < 60 * 30; i++) { sim.step(NO_INPUT); evs.push(...sim.drainEvents()); ops.push(...sim.state.fireOps); }
  const roar = evs.find((e) => e.type === 'troll.roar');
  assert.ok(roar && roar.calls === 30, JSON.stringify(roar));
  assert.ok(evs.some((e) => e.type === EV.T_WINDUP && e.move === 'roar'));
  assert.ok(ops.filter((o) => o.kind === FIRE_OP.DOUSE).length >= 12);
  const n2 = createSim({ seed: 6, spawnScale: 0, god: true, save: 'mid' }); n2.startNight(); assert.equal(n2.troll().hpMax, NIGHTS[1].trollHp);
});

test('Pyre Burst: fire kills burst (burst ops + damage + ignite), chance by level, at most 24 a second', () => {
  const sim = createSim({ seed: 7, spawnScale: 0, god: true }); sim.startNight(); sim.state.player.xpNext = 1e9;
  sim.teleportHigh(-11, -1.5, 0, 0);
  for (const id of ['pyre-burst', 'pyre-burst-up', 'pyre-burst-up']) { CARD_BY_ID[id].apply(sim.ctx); sim.state.taken[id] = (sim.state.taken[id] || 0) + 1; }
  assert.equal(sim.state.mods.pyre, 3);
  sim.spawn('grunt', 300, 10, 20);
  const evs = [], ops = [];
  for (let i = 0; i < 60 * 7; i++) { if (i === 0) sim.fireOp({ kind: FIRE_OP.BURST, x: 10, z: 20, r: 1.5, amount: 1, push: 0 }); sim.step(NO_INPUT); evs.push(...sim.drainEvents()); ops.push(...sim.state.fireOps); }
  const bursts = evs.filter((e) => e.type === 'pyre.burst');
  assert.ok(bursts.length >= 5, `${bursts.length} bursts`);
  assert.ok(bursts.every((e) => e.r === 2.8));
  // ≤ 24 a second (the token bucket starts full)
  for (let s = 0; s < 7; s++) assert.ok(bursts.filter((e) => e.t >= s && e.t < s + 1).length <= 48, 'rate');
  assert.ok(bursts.length <= 24 + 7 * 24);
  assert.ok(ops.filter((o) => o.kind === FIRE_OP.BURST).length >= bursts.length);
});

test('enemy cost: the ground table matches groundHeight; far goblins (LOD) keep walking at the same average speed', () => {
  for (let k = 0; k < 400; k++) { const x = -38 + (k * 7.31) % 108, z = -5 + (k * 3.17) % 94; assert.ok(Math.abs(groundFast(x, z) - groundHeight(x, z)) < 0.03, `(${x}, ${z})`); }
  const sim = createSim({ seed: 8, spawnScale: 0, god: true }); sim.startNight(); sim.teleportHigh(1.5, -1.4, 0, 0);
  sim.spawn('grunt', 20, 30, 70);
  const H = sim.state.horde, z0 = []; for (let i = 0; i < H.count; i++) z0.push(H.z[i]);
  run(sim, 60 * 5);
  let moved = 0; for (let i = 0; i < 20; i++) moved += z0[i] - H.z[i];
  assert.ok(moved / 20 > 6, `far goblins moved ${(moved / 20).toFixed(2)} m toward the keep in 5 s`);
});
