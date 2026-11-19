// Contracts: XP on every kill, fire hurts only near the
// ground, a sub-frame click fires, the resolution governor ignores back-pressure stalls, jammed walkers get unstuck.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, NO_INPUT } from '../src/sim/sim.js';
import { EV } from '../src/shared/events.js';
import { ARENA, groundHeight } from '../src/shared/arena.js';
import { createResolutionGovernor } from '../src/core/resolution.js';
import { KILL_XP } from '../src/sim/horde.js';

const play = (seed = 5) => { const sim = createSim({ seed, spawnScale: 0 }); sim.startNight(); sim.drainEvents(); return sim; };

test('XP (DESIGN §9.3: gems that fly to the player) is credited on arrival; PICKUP xp events are batched with the positions', () => {
  const sim = play();
  sim.teleportHigh(0, -1.5, 0, 0);
  sim.state.player.xpNext = 1e9;
  const n = sim.spawn('grunt', 12, 6, 14) + sim.spawn('brute', 2, 10, 14);
  assert.equal(n, 14);
  const H = sim.state.horde;
  for (let i = 0; i < H.count; i++) if (H.state[i]) sim.ctx.horde.damage(i, 999, 'bullet', null);
  sim.drainEvents();
  for (let i = 0; i < 150; i++) sim.step(NO_INPUT);   // 0.6 s spill + ≈ 0.8 s flight up to the walk, + a 0.15 s batch
  assert.equal(sim.state.player.xp, 12 * KILL_XP[0] + 2 * KILL_XP[3], 'credited once the gems arrive');
  assert.ok(!sim.state.pickups.some((g) => g.kind === 'xp'), 'no XP gem left');
  const xpEv = sim.drainEvents().filter((e) => e.type === EV.PICKUP && e.kind === 'xp');
  assert.ok(xpEv.length >= 1 && xpEv.length <= 6, `batched: ${xpEv.length} events`);
  assert.equal(xpEv.reduce((a, e) => a + e.count, 0), 14);
  assert.ok(xpEv[0].pos && Array.isArray(xpEv[0].spots) && xpEv[0].spots.length <= 4);
  assert.equal(sim.state.stats.killedBy.bullet, 14);
});

test('fire never hurts the Lamplighter (DESIGN §3.3: on the plaza, the walk or the stair)', () => {
  const hot = { heat: () => 1, fuel: () => 1 };
  const hurtAt = (place) => {
    const sim = play(); sim.setFire(hot);
    place(sim);
    const hp0 = sim.state.player.hp;
    for (let i = 0; i < 90; i++) sim.step(NO_INPUT);
    return hp0 - sim.state.player.hp;
  };
  assert.equal(hurtAt((s) => s.teleport(3, 5, 0, 0)), 0, 'on the plaza');
  assert.equal(hurtAt((s) => s.teleportHigh(-2, -1.5, 0, 0)), 0, 'on the wall walk');
  const S = ARENA.stair, cx = (S.x0 + S.x1) / 2;
  assert.equal(hurtAt((s) => { s.teleport(cx, 4, 0, 0); const p = s.state.player; p.y = S.yTop * (S.zBottom - 4) / (S.zBottom - S.zTop); }), 0, 'high on the stair (y ≈ 3.1)');
});

test('a click shorter than one frame fires the gun once (firePress without a held trigger)', () => {
  const sim = play();
  sim.teleport(3, 5, Math.PI / 2, 0);
  const shots0 = sim.state.stats.shots;
  sim.step({ firePress: true, fire: false });
  for (let i = 0; i < 30; i++) sim.step(NO_INPUT);
  assert.equal(sim.state.stats.shots - shots0, 1, 'one shot from a sub-frame click');
  // a click during the cooldown is kept and fires when the hammer is back
  sim.step({ firePress: true, fire: true }); sim.step({ firePress: false, fire: false });
  sim.step({ firePress: true, fire: false });
  for (let i = 0; i < 30; i++) sim.step(NO_INPUT);
  assert.equal(sim.state.stats.shots - shots0, 3);
});

test('adaptive resolution: back-pressure stalls are not load; a slow GPU steps down; it recovers in seconds', () => {
  // uncapped back-pressure: 1 ms frames with a 0.3 s stall every 0.5 s → stays at full resolution
  let g = createResolutionGovernor(1.5);
  for (let t = 0; t < 20;) { for (let k = 0; k < 200; k++) { g(0.001); t += 0.001; } g(0.3); t += 0.3; }
  assert.equal(g(0.001), 1.5, 'stalls ignored');
  // an isolated burst of slow frames (one 2 s window) does not drop
  g = createResolutionGovernor(1.5);
  for (let i = 0; i < 120; i++) g(1 / 60); for (let i = 0; i < 60; i++) g(0.034); for (let i = 0; i < 240; i++) g(1 / 60);
  assert.equal(g(1 / 60), 1.5, 'one bad window is ignored');
  // a GPU that runs at 30 fps steps down, then recovers within ~6 s of headroom
  g = createResolutionGovernor(1.5);
  for (let i = 0; i < 300; i++) g(0.034);
  const low = g(0.034);
  assert.ok(low < 1.5, `stepped down to ${low}`);
  let s = 0, d = low; while (d < 1.5 && s < 20) { d = g(1 / 60); s += 1 / 60; }
  assert.ok(s <= 4 * Math.round((1.5 - low) / 0.1) + 2.5, `recovered to 1.5 in ${s.toFixed(1)} s`);
});

test('the horde never jams for long at a fire front (walkers keep making headway)', () => {
  const sim = createSim({ seed: 2, god: true, spawnScale: 0 });
  sim.startNight(); sim.teleportHigh(1.5, -1.4, 0, 0);
  sim.state.player.xpNext = 1e9;   // (the burnt crowd's XP gems reach the player; no card screen mid-test)
  // a burning crowd panics back into a dense column on the road (a spot where walkers jammed, near (29, 64))
  sim.spawn('grunt', 120, 28.5, 66); sim.spawn('spear', 30, 28.5, 68);
  sim.fireOp({ kind: 'burst', x: 29, z: 59, r: 3, amount: 1, push: 0 });
  const H = sim.state.horde, last = new Map();
  let stuck = 0; const where = [];
  for (let t = 1; t <= 60 * 20; t++) {
    sim.step(NO_INPUT); sim.drainEvents();
    if (t % 300 === 0) for (let i = 0; i < H.count; i++) {
      if (H.state[i] !== 1 || H.burn[i] > 0 || H.z[i] < 20) { last.delete(i); continue; }   // walkers on the road (the gate pile stands still by design)
      const w = last.get(i);
      if (w && Math.hypot(H.x[i] - w.x, H.z[i] - w.z) < 0.3) { stuck++; where.push([+H.x[i].toFixed(1), +H.z[i].toFixed(1), H.kind[i], t / 60]); }
      last.set(i, { x: H.x[i], z: H.z[i] });
    }
  }
  assert.ok(stuck <= 2, `${stuck} walkers made < 0.3 m of headway in 5 s: ${JSON.stringify(where.slice(0, 8))}`);
  void groundHeight;
});

test('a NaN or infinite input never corrupts the night', () => {
  const sim = play();
  sim.teleport(3, 5, Math.PI / 2, 0);
  for (let i = 0; i < 30; i++) sim.step({ fwd: NaN, right: Infinity, yaw: NaN, pitch: -Infinity, weapon: NaN, wheel: NaN, card: NaN, fire: true });
  for (let i = 0; i < 30; i++) sim.step({ fwd: 1, yaw: NaN });
  const p = sim.state.player;
  for (const k of ['x', 'y', 'z', 'yaw', 'pitch', 'vx', 'vz']) assert.ok(Number.isFinite(p[k]), `player.${k} = ${p[k]}`);
  assert.ok(p.x > 3.5, `still walks on a NaN yaw (kept its own yaw): x ${p.x}`);
});
