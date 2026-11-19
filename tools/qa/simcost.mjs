// Enemy cost in the sim (DESIGN §15.4): Node, the CPU fire proxy, god mode, no spawning; N goblins spread over the
// slope and the road walk to the gate (a burning share kept alight by bursts on the road) for `--ticks` ticks. Reports
// ms per tick (mean and p95), ms per tick per 1,000 alive, and the horde update's share. One line per N.
//   node tools/qa/simcost.mjs [--n 2500,5000,10000,20000] [--ticks 600] [--fire 1]
import { performance } from 'node:perf_hooks';
import { createSim } from '../../src/sim/sim.js';

const argv = process.argv.slice(2), opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const NS = opt('n', '2500,5000,10000,20000').split(',').map(Number), TICKS = Number(opt('ticks', 600)), FIRE = opt('fire', '1') !== '0';
const rows = [];
for (const N of NS) {
  const sim = createSim({ seed: 3, god: true, spawnScale: 0, cap: Math.max(N + 200, 2500) });
  sim.startNight(); sim.teleportHigh(1.5, -1.4, 0, 0); sim.state.player.xpNext = 1e9;
  // spread over the plaza, the road and the slope (as a night's crowd), in blocks of 50
  const spots = [[4, 6], [12, 7], [20, 9], [26, 16], [24, 24], [30, 32], [26, 42], [32, 50], [-6, 14], [6, 20], [14, 28], [0, 36], [18, 40], [8, 48], [28, 58], [-10, 30]];
  let made = 0;
  for (let k = 0; made < N; k++) { const [x, z] = spots[k % spots.length]; made += sim.spawn('grunt', Math.min(50, N - made), x + ((k * 7) % 9) - 4, z + ((k * 5) % 7) - 3); if (k > N) break; }
  const ctx = sim.ctx, H = sim.state.horde;
  let hordeMs = 0;
  const orig = ctx.horde.update;
  ctx.horde.update = (dt, o) => { const t0 = performance.now(); const r = orig(dt, o); hordeMs += performance.now() - t0; return r; };
  // keep the count: top up what dies; keep a fire on the road so a share burns (the ignite/panic/ember path)
  const times = [];
  for (let t = 0; t < TICKS; t++) {
    if (FIRE && t % 30 === 0) for (const [x, z] of [[20, 9], [26, 24], [12, 30]]) sim.fireOp({ kind: 'burst', x, z, r: 2.5, amount: 1, push: 1 });
    if (t % 60 === 0 && H.alive < N) { const need = N - H.alive; for (let m = 0; m < need; m += 50) sim.spawn('grunt', Math.min(50, need - m), 30 + (m % 7), 60 + (m % 11)); }
    const t0 = performance.now(); sim.step({ yaw: 0, pitch: 0 }); times.push(performance.now() - t0);
    sim.drainEvents();
  }
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length, p95 = times[Math.floor(times.length * 0.95)];
  const row = { n: N, alive: H.alive, msPerTick: +mean.toFixed(3), p95: +p95.toFixed(3), msPer1k: +(mean / (H.alive / 1000)).toFixed(3), hordeShare: +(hordeMs / times.reduce((a, b) => a + b, 0)).toFixed(2), burning: Array.from(H.burn.slice(0, H.count)).filter((b) => b > 0).length };
  rows.push(row); console.log(JSON.stringify(row));
}
console.log('SIMCOST', JSON.stringify(rows));
