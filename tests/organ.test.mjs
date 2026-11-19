// DESIGN §4.2: the THUNDER ORGAN reworked — a price (4,500) an average player reaches around Nights V–VI, the clear best slot-2
// weapon (pierce 1, Kestrel damage applies, an overheat that vents instead of stalling), its 10 levels rescaled; and
// `surf` on every EV.SHOT pellet. Node, the CPU fire proxy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, NO_INPUT } from '../src/sim/sim.js';
import { EV } from '../src/shared/events.js';
import { ORGAN, UPGRADES, upgradeCost } from '../src/shared/meta.js';
import { K } from '../src/sim/constants.js';
import { campaign } from '../tools/qa/campaign.mjs';

const run = (sim, ticks, inp = NO_INPUT, onEv) => { for (let i = 0; i < ticks; i++) { sim.step(typeof inp === 'function' ? inp(sim.state) : inp); const ev = sim.drainEvents(); if (onEv) ev.forEach(onEv); } };

test('the Organ\'s numbers: 4,500 gold, 20 × 20 rounds/s, pierce 1, a 300-round drum; 10 levels at 450 × 1.3^level', () => {
  assert.equal(ORGAN.cost, 4500); assert.equal(ORGAN.rate, 20); assert.equal(ORGAN.dmg, 20); assert.equal(ORGAN.pierce, 1); assert.equal(ORGAN.drum, 300);
  const U = UPGRADES.find((u) => u.id === 'organ'); assert.equal(U.base, 450); assert.equal(U.max, 10);
  let all = 0; for (let k = 0; k < 10; k++) all += upgradeCost(U, k);
  assert.ok(upgradeCost(U, 0) === 450 && upgradeCost(U, 9) < ORGAN.cost * 1.1 && all < 25000, `levels cost ${all} in all`);
  assert.ok(U.per.organDmg < 0.10, 'each level a smaller step than before');
});

test('holding the trigger through an overheat: the heat vents during the lock and the Organ fires again', () => {
  const sim = createSim({ seed: 1, spawnScale: 0, god: true, save: 'rich' }); sim.startNight();
  sim.teleportHigh(2, -1.5, 0, -0.05); sim.step({ weapon: 2 }); run(sim, 40, { yaw: 0, pitch: -0.05 });
  let rounds = 0, overheats = 0, fires = 0;
  run(sim, 60 * 16, { fire: true, yaw: 0, pitch: -0.05 }, (e) => { if (e.type === EV.SHOT && e.weapon === 'organ') rounds += e.pellets.length; if (e.type === 'organ.overheat') overheats++; if (e.type === 'organ.fire') fires++; });
  assert.ok(overheats >= 2 && fires >= 3, `overheats ${overheats}, loops ${fires}`);
  assert.ok(rounds > 16 * ORGAN.rate * 0.6, `${rounds} rounds in 16 s held`);
});

test('the Organ grows with its own line (not with Kestrel damage); a round passes through one goblin', () => {
  const dmgOf = (kestrel, organ) => {
    const save = { v: 1, gold: 0, upgrades: { kestrel, organ }, organ: { owned: true, equipped: true }, charms: { owned: [], equipped: [] }, story: { seen: ['home', 'camp-tip'] } };
    const sim = createSim({ seed: 2, spawnScale: 0, god: true, save }); sim.startNight();
    const H = sim.state.horde, a = sim.ctx.horde.spawnAt(K.brute, 2, 14), b = sim.ctx.horde.spawnAt(K.brute, 2, 16.5);
    for (const i of [a, b]) { H.hp[i] = 1e6; H.slowT[i] = 99; H.slowK[i] = 0; }
    sim.teleport(2, 6, 0, 0); const p = sim.state.player; sim.step({ weapon: 2 }); run(sim, 40, { yaw: 0, pitch: 0 });
    const y = H.y[a] + 1.0 - (p.y + 1.68); let shots = 0;
    run(sim, 60 * 2, { fire: true, yaw: 0, pitch: Math.atan2(y, 8) }, (e) => { if (e.type === EV.SHOT && e.weapon === 'organ') shots += e.pellets.length; });
    return { a: 1e6 - H.hp[a], b: 1e6 - H.hp[b], shots, per: (1e6 - H.hp[a]) / shots };
  };
  const d0 = dmgOf(0, 0), dk = dmgOf(4, 0), d5 = dmgOf(0, 5);
  assert.ok(d0.a > 0 && d0.b > 0, `the round passes through the first goblin: ${JSON.stringify(d0)}`);
  assert.ok(Math.abs(dk.per - d0.per) < d0.per * 0.05, `Kestrel 4 leaves the Organ as it is: ${dk.per.toFixed(1)} vs ${d0.per.toFixed(1)}`);
  assert.ok(d5.per > d0.per * 1.3, `Organ level 5 (+40 %): ${d5.per.toFixed(1)} vs ${d0.per.toFixed(1)} a round`);
});

test('EV.SHOT pellets carry surf: ground, stone, air, enemy', () => {
  const shoot = (yaw, pitch, setup) => { const sim = createSim({ seed: 1, spawnScale: 0, god: true, save: 'rich' }); sim.startNight(); sim.teleportHigh(2, -1.5, yaw, pitch); if (setup) setup(sim);
    const s = {}; run(sim, 90, { fire: true, yaw, pitch }, (e) => { if (e.type === EV.SHOT) for (const q of e.pellets) { assert.ok(['enemy', 'ground', 'stone', 'wood', 'air'].includes(q.surf)); s[q.surf] = (s[q.surf] || 0) + 1; } }); return s; };
  assert.ok(shoot(0, -0.35).ground > 0, 'down the slope: ground');
  assert.ok(shoot(Math.PI / 2, -0.02).stone > 0, 'along the wall: a tower');
  assert.ok(shoot(0, 0.3).air > 0, 'up: air');
  const probe = createSim({ seed: 1, spawnScale: 0, god: true, save: 'rich' }); probe.startNight(); probe.teleportHigh(2, -1.5, 0, 0);
  const eye = probe.state.player.y + 1.68, pitch = Math.atan2(probe.ctx.ground(2, 14) + 1.0 - eye, 14 + 1.5);
  const e = shoot(0, pitch, (sim) => { const H = sim.state.horde; for (let k = 0; k < 6; k++) { const i = sim.ctx.horde.spawnAt(K.brute, 2 + (k - 2.5) * 0.4, 14); H.hp[i] = 1e6; H.slowT[i] = 99; H.slowK[i] = 0; } });
  assert.ok(e.enemy > 0, `into a crowd: ${JSON.stringify(e)}`);
});

test('a campaign buys the Organ around its first reach of Nights V–VI (the noisy bot, seed 1)', () => {
  const c = campaign(1, { save: 'fresh', shop: true, maxNights: 40, policy: 'noisy', stopOnOrgan: true });
  console.log(`organ: ${JSON.stringify(c.organAt)}; ${c.seq.join(' ')}`);
  assert.ok(c.organAt, 'bought');
  assert.ok(c.organAt.maxNight >= 4 && c.organAt.maxNight <= 7, `furthest night at purchase ${c.organAt.maxNight}`);
});

test('the climb staging: THE CLIMB leaves the road and strides up the slope to ≈ 22 m from the gate, in front of the wall walk (≥ 30 % of the frame height)', async () => {
  const { BOSS } = await import('../src/sim/boss.js');
  const { ARENA } = await import('../src/shared/arena.js');
  const sim = createSim({ seed: 3, spawnScale: 0, god: true, save: 'endgame' }); sim.goto('night10'); sim.state.player.xpNext = 1e9;
  sim.setClock(29); run(sim, 60 * 10);
  const b = sim.state.boss; assert.ok(b && b.mode !== 'rise');
  const T = ARENA.gate.target, d0 = Math.hypot(b.x - T.x, b.z - T.z);
  sim.ctx.bossSys.hurt(b.hpMax * 0.7, 'blast'); run(sim, 2); assert.equal(b.phase, 3);
  run(sim, 60 * Math.ceil((d0 - BOSS.climb.surgeTo) / BOSS.climb.surge + 2));
  const dG = Math.hypot(b.x - T.x, b.z - T.z);
  assert.ok(dG <= BOSS.climb.surgeTo + 0.5 && dG > BOSS.gateR, `at ${dG.toFixed(1)} m from the gate (from ${d0.toFixed(1)})`);
  assert.ok(b.z > 10, `in front of the wall, up the slope (z ${b.z.toFixed(1)})`);
  // from the wall walk's parapet: her 14 m spans ≥ 30 % of a 78° frame
  const eye = { x: 2, y: 5 + 1.68, z: -0.55 }, dh = Math.hypot(b.x - eye.x, b.z - eye.z), mid = Math.atan2(b.y + 6 - eye.y, dh), t = Math.tan(39 * Math.PI / 180);
  const frac = (Math.tan(Math.atan2(b.y + BOSS.height - eye.y, dh) - mid) - Math.tan(Math.atan2(b.y - eye.y, dh) - mid)) / (2 * t);
  assert.ok(frac >= 0.3, `${(frac * 100).toFixed(0)} % of the frame height at ${dh.toFixed(1)} m`);
  // then the slow climb: 0.4 m/s
  const z1 = b.z; run(sim, 60 * 5); assert.ok(Math.abs(Math.hypot(b.x - T.x, b.z - T.z) - (dG - 2)) < 0.6, `climbing slowly (${z1.toFixed(1)} → ${b.z.toFixed(1)})`);
});
