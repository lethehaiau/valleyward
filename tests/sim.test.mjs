// The sim's contracts: determinism, the flow field, the player's bounds (never out, never under the floor), the stair
// and the wall walk, the night flow (intro → play → cards → fallen → retry), the beacon, the troll, events and ops.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, NO_INPUT } from '../src/sim/sim.js';
import { createBot } from '../src/bot/bot.js';
import { FLOW, cellOf, GRID, flowDir, supportHeight, isBlocked } from '../src/sim/world.js';
import { ARENA, groundHeight } from '../src/shared/arena.js';
import { EV } from '../src/shared/events.js';
import { FIRE_OP } from '../src/shared/fireops.js';
import { TIMELINE } from '../src/shared/timeline.js';
import { runNight } from './helpers.mjs';

test('determinism: one seed replays to the same state hash; another seed differs', () => {
  const h = (seed) => { const sim = createSim({ seed }); sim.startNight(); const bot = createBot({ seed }); for (let i = 0; i < 60 * 75; i++) { sim.step(bot(sim.state)); sim.drainEvents(); } return sim.hash(); };
  const a = h(11), b = h(11), c = h(12);
  assert.equal(a, b); assert.notEqual(a, c);
});

test('the flow field reaches the gate from every spawn cell (and the road is cheaper)', () => {
  const S = ARENA.spawns;
  let n = 0;
  for (const b of [S.south, S.east]) for (let x = b.x0; x <= b.x1; x += 1) for (let z = b.z0; z <= b.z1; z += 1) {
    if (isBlocked(x, z)) continue;
    n++;
    assert.ok(Number.isFinite(FLOW.dist[cellOf(x, z)]), `no path from (${x}, ${z})`);
  }
  assert.ok(n > 500);
  // following the field from a spawn arrives at the gate
  for (const [x0, z0] of [[-28, 80], [58, 82], [60, 14], [30, 76]]) {
    let x = x0, z = z0;
    for (let i = 0; i < 4000; i++) { const d = flowDir(x, z); x += d.x * 0.25; z += d.z * 0.25; if (Math.hypot(x - ARENA.gate.target.x, z - ARENA.gate.target.z) < 1.5) break; }
    assert.ok(Math.hypot(x - ARENA.gate.target.x, z - ARENA.gate.target.z) < 1.5, `stuck at (${x.toFixed(1)}, ${z.toFixed(1)}) from (${x0}, ${z0})`);
  }
  assert.ok(GRID.w * GRID.h > 0);
});

test('the player never leaves the bounds or sinks under what it stands on (random play, 60 s × 6 seeds)', () => {
  const B = ARENA.playerBounds;
  for (let seed = 1; seed <= 6; seed++) {
    const sim = createSim({ seed, god: true, spawnScale: 0 });
    sim.startNight();
    let yaw = 0, fwd = 1, right = 0;
    for (let i = 0; i < 60 * 60; i++) {
      if (i % 40 === 0) { yaw = ((i * 2654435761 + seed * 97) % 6283) / 1000; fwd = ((i / 40 + seed) % 3) - 1; right = ((i / 40 + seed * 2) % 3) - 1; }
      sim.step({ fwd, right, yaw, sprint: i % 200 < 100, jump: i % 90 === 0 });
      const p = sim.state.player;
      const sup = supportHeight(p.x, p.z, p.y + 0.01);
      assert.ok(p.y >= sup - 0.05, `seed ${seed} tick ${i}: under the floor y ${p.y} < ${sup} at (${p.x}, ${p.z})`);
      if (p.where === 'ground') assert.ok(p.x >= B.x0 - 0.01 && p.x <= B.x1 + 0.01 && p.z >= B.z0 - 0.01 && p.z <= B.z1 + 0.01, `seed ${seed}: out of bounds (${p.x}, ${p.z})`);
    }
  }
});

test('the stair climbs to the wall walk and back; its sides and the parapets hold', () => {
  const sim = createSim({ seed: 1, god: true, spawnScale: 0 });
  sim.startNight();
  const S = ARENA.stair, cx = (S.x0 + S.x1) / 2;
  const walkTo = (x, z, max = 900) => { for (let i = 0; i < max; i++) { const p = sim.state.player, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz); if (d < 0.2) return true; sim.step({ yaw: Math.atan2(dx, dz), fwd: Math.min(1, d), pitch: 0 }); } return false; };
  sim.teleport(cx, 13, Math.PI);
  assert.ok(walkTo(cx, S.zBottom + 0.5));
  assert.ok(walkTo(cx, -1.2), 'up the stair to the walk');
  const p = sim.state.player;
  assert.equal(p.where, 'walk'); assert.ok(Math.abs(p.y - 5) < 0.05, `on the walk at y ${p.y}`);
  // the parapet: walking south off the walk (away from the opening) stops at the edge
  walkTo(3, -1.2);
  for (let i = 0; i < 120; i++) sim.step({ yaw: 0, fwd: 1 });
  assert.equal(sim.state.player.where, 'walk'); assert.ok(sim.state.player.z <= ARENA.keep.walk.z1, 'held by the parapet');
  // the kindling pan is reachable
  assert.ok(walkTo(ARENA.beacon.pan.x - 0.5, ARENA.beacon.pan.z));
  // and back down
  assert.ok(walkTo(cx, -1.2)); assert.ok(walkTo(cx, S.zBottom + 1.5, 1200), 'down the stair');
  assert.equal(sim.state.player.where, 'ground'); assert.ok(Math.abs(sim.state.player.y - groundHeight(sim.state.player.x, sim.state.player.z)) < 0.05);
  // the stair's side is solid from the ground
  sim.teleport(S.x1 + 1.5, 5, -Math.PI / 2);
  for (let i = 0; i < 120; i++) sim.step({ yaw: -Math.PI / 2, fwd: 1 });
  assert.ok(sim.state.player.x >= S.x1 + 0.35, `walked into the stair's side: x ${sim.state.player.x}`);
});

test('the night flow: intro → play; level-up → cards (sim paused) → pick → play; fall → retry', () => {
  const sim = createSim({ seed: 3 });
  assert.equal(sim.state.mode, 'title');
  sim.startIntro(); assert.equal(sim.state.mode, 'intro');
  assert.equal(sim.skipIntro(), false, 'not skippable at once');
  for (let i = 0; i < 60 * TIMELINE.intro.skippableAfter + 2; i++) sim.step(NO_INPUT);
  assert.equal(sim.skipIntro(), true); assert.equal(sim.state.mode, 'play');
  sim.state.player.xp = sim.state.player.xpNext + 1;
  sim.step(NO_INPUT);
  assert.equal(sim.state.mode, 'cards'); assert.equal(sim.state.cards.length, 3);
  const t = sim.state.night.clock;
  for (let i = 0; i < 30; i++) sim.step(NO_INPUT);
  assert.equal(sim.state.night.clock, t, 'the clock holds while the cards are up');
  sim.step({ card: 2 });
  assert.equal(sim.state.mode, 'play'); assert.equal(sim.state.stats.cards.length, 1);
  sim.state.gate.hp = 1;
  sim.teleportHigh(-6, -1.5, 0, 0);
  sim.spawn('brute', 6, 0, 2);
  let fell = null;
  for (let i = 0; i < 600 && !fell; i++) { sim.step(NO_INPUT); for (const e of sim.drainEvents()) if (e.type === EV.FALLEN) fell = e.cause; }
  assert.equal(fell, 'gate'); assert.equal(sim.state.mode, 'fallen');
  sim.retry();
  assert.equal(sim.state.mode, 'play'); assert.equal(sim.state.gate.hp, ARENA.gate.hp); assert.equal(sim.state.horde.alive, 0);
  assert.ok(sim.drainEvents().some((e) => e.type === EV.RETRY));
});

test('the Lance streams fire ops along its ground track and sets goblins alight; firebombs burst into burst + fuel', () => {
  const sim = createSim({ seed: 5, god: true, spawnScale: 0 });
  sim.startNight();
  sim.teleport(3, 5, Math.PI / 2, -0.05);
  sim.spawn('grunt', 12, 10, 5);
  sim.step({ weapon: 3 }); for (let i = 0; i < 30; i++) sim.step({});
  const ops = [];
  for (let i = 0; i < 90; i++) { sim.step({ fire: true, yaw: Math.PI / 2, pitch: -0.05 }); ops.push(...sim.state.fireOps); }
  const streams = ops.filter((o) => o.kind === FIRE_OP.STREAM);
  assert.ok(streams.length >= 80, `stream ops: ${streams.length}`);
  const land = streams[streams.length - 1];
  assert.ok(land.x0 > 6 && land.x0 < 3 + 11.5, `lands at x ${land.x0}`);
  const ev = sim.drainEvents();
  assert.ok(ev.some((e) => e.type === EV.LANCE_ON) && ev.some((e) => e.type === EV.E_IGNITE));
  assert.ok(sim.proxy.heat(land.x0, land.z0) > 0.3, 'the proxy is hot where the jet lands');
  assert.ok(sim.state.player.fuel < 100);
  // a firebomb
  const bombOps = [];
  sim.step({ bomb: true, yaw: Math.PI / 2, pitch: -0.1 });
  for (let i = 0; i < 120; i++) { sim.step({}); bombOps.push(...sim.state.fireOps); }
  assert.ok(bombOps.some((o) => o.kind === FIRE_OP.BURST) && bombOps.some((o) => o.kind === FIRE_OP.FUEL));
  assert.ok(sim.drainEvents().some((e) => e.type === EV.BOMB_BURST));
});

test('the beacon: E at the pan kindles (cooldown, lance refill, bigger waves); the 3rd kindle calls the troll', () => {
  const sim = createSim({ seed: 2, god: true, spawnScale: 0 });
  sim.startNight();
  const pan = ARENA.beacon.pan;
  sim.teleportHigh(pan.x - 0.5, pan.z, 0, 0);
  sim.state.player.fuel = 10;
  sim.step({ kindle: true });
  assert.equal(sim.state.night.kindle, 1); assert.equal(sim.state.player.fuel, sim.state.player.fuelMax);
  sim.step({ kindle: true }); assert.equal(sim.state.night.kindle, 1, 'cooldown holds');
  for (let k = 2; k <= 3; k++) { sim.state.night.kindleCd = 0; sim.step({ kindle: true }); }
  assert.equal(sim.state.night.kindle, 3); assert.ok(sim.state.troll, 'the troll arrives after the 3rd kindle');
  assert.ok(sim.drainEvents().some((e) => e.type === EV.T_ARRIVE));
});

test('the troll: fire heats it to a glow (guns ×3); it telegraphs its moves; dawn needs it dead', () => {
  const sim = createSim({ seed: 4, god: true, spawnScale: 0 });
  sim.startNight();
  sim.state.player.xpNext = 1e9;   // (the troll's 80 XP gem would open the cards before the dawn)
  const tr = sim.troll();
  for (let i = 0; i < 60 * 6; i++) sim.step({});
  tr.x = 6; tr.z = 12; tr.y = groundHeight(6, 12);
  for (let i = 0; i < 90 && !tr.glowing; i++) { sim.fireOp({ kind: FIRE_OP.BURST, x: 6, z: 12, r: 3, amount: 1, push: 0 }); sim.step({}); }
  assert.ok(tr.glowing, `the troll did not glow (heat ${tr.heat})`);
  const ev = sim.drainEvents();
  assert.ok(ev.some((e) => e.type === EV.T_GLOW && e.on));
  assert.ok(ev.some((e) => e.type === EV.T_WINDUP), 'a windup before a move');
  sim.setClock(300);
  for (let i = 0; i < 120; i++) sim.step({});
  assert.equal(sim.state.mode, 'play', 'no dawn while the troll lives');
  tr.hp = 1; sim.ctx.troll.hit(5, 'bullet');
  for (let i = 0; i < 200; i++) sim.step({});
  assert.equal(sim.state.mode, 'victory');
});

test('events carry a type and a time; fire ops stay inside the caps', () => {
  const r = runNight({ seed: 7, maxSeconds: 150, onTick: (sim) => {
    const ops = sim.state.fireOps;
    assert.ok(ops.filter((o) => o.kind === FIRE_OP.EMBER).length <= 160);
  } });
  assert.ok(r.counts[EV.NIGHT_START] === 1 && r.counts[EV.E_SPAWN] > 10 && r.counts[EV.E_DEATH] > 10);
});
