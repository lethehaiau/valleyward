// @ts-check
// VALLEYWARD · the nights' twists that are schedules rather than units (docs/DESIGN.md §8.1, §8.3): rain (Night IV's squalls,
// Night X's storm: `state.weather`), the shield wall (Night V's phalanxes: brutes in lines, spear-chuckers behind) and
// the coven (Night VII: 3 Hexers gather and chant for 20 s; if none of them dies, the lamp is locked for 30 s:
// `state.night.kindleLockT`). Pure JS, seeded.
import { ARENA, groundHeight } from '../shared/arena.js';
import { K } from './constants.js';

export const TWIST = Object.freeze({
  squall: Object.freeze({ every: [70, 90], last: [30, 45], first: [35, 55], peak: 0.85, ramp: 3 }),
  storm: Object.freeze({ base: 0.6, phase: [0.6, 1.0, 0.85], lantern: 0.08, ramp: 4 }),
  phalanx: Object.freeze({ rows: 2, cols: 6, gap: 1.4, spears: 6 }),
  coven: Object.freeze({ chant: 20, lock: 30, gatherAfter: 45, spread: 3, speed: 2.4, at: Object.freeze({ x: [4, 22], z: [30, 38] }) }),
});

export function createTwists(ctx) {
  const r = () => ctx.rng;
  let squallNext = -1, squallEnd = -1;
  /** the coven groups: { ids: [3 slots], t0, chantT, state: 'walk' | 'chant' | 'done' } */
  const covens = [];

  function weather(dt) {
    const st = ctx.state, cfg = ctx.nightCfg, W = st.weather, n = st.night;
    let target = 0;
    if (cfg.rain === 'squalls') {
      const S = TWIST.squall;
      if (squallNext < 0) squallNext = r().range(S.first[0], S.first[1]);
      if (!W.squall && n.clock >= squallNext && st.mode === 'play') { W.squall = true; squallEnd = n.clock + r().range(S.last[0], S.last[1]); ctx.emit('weather.squall', { on: true }); }
      if (W.squall && n.clock >= squallEnd) { W.squall = false; squallNext = n.clock + r().range(S.every[0], S.every[1]); ctx.emit('weather.squall', { on: false }); }
      target = W.squall ? S.peak : 0;
    } else if (cfg.rain === 'storm') {
      const b = st.boss, S = TWIST.storm;
      target = b && b.alive ? S.phase[b.phase - 1] - S.lantern * b.lanternsOut : b ? 0 : S.base;
    }
    const ramp = cfg.rain === 'storm' ? TWIST.storm.ramp : TWIST.squall.ramp;
    W.rain += Math.max(-dt / ramp, Math.min(dt / ramp, target - W.rain));
    if (W.rain < 1e-4) W.rain = 0;
    ctx.proxyRain(W.rain);
  }

  function phalanx() {
    const st = ctx.state, cfg = ctx.nightCfg, n = st.night;
    if (!cfg.phalanx) return;
    while ((n.phalanxN || 0) < cfg.phalanx.length && n.clock >= cfg.phalanx[n.phalanxN || 0]) {
      n.phalanxN = (n.phalanxN || 0) + 1;
      // a block of brutes in lines across the road's lower stretch, spear-chuckers behind them
      const P = TWIST.phalanx, cx = r().range(22, 32), cz = r().range(70, 78);
      for (let row = 0; row < P.rows; row++) for (let c = 0; c < P.cols; c++) ctx.horde.spawnAt(K.brute, cx + (c - (P.cols - 1) / 2) * P.gap, cz + row * P.gap);
      for (let c = 0; c < P.spears; c++) ctx.horde.spawnAt(K.spear, cx + (c - (P.spears - 1) / 2) * P.gap, cz + P.rows * P.gap + 1.2);
      ctx.emit('phalanx.spawn', { pos: { x: cx, y: 0, z: cz }, rows: P.rows, cols: P.cols });
      st.stats.phalanxes = (st.stats.phalanxes || 0) + 1;
    }
  }

  function coven(dt) {
    const st = ctx.state, cfg = ctx.nightCfg, n = st.night, H = st.horde, C = TWIST.coven;
    if (cfg.coven) while ((n.covenN || 0) < cfg.coven.length && n.clock >= cfg.coven[n.covenN || 0]) {
      n.covenN = (n.covenN || 0) + 1;
      const S = ARENA.spawns.south, cx = r().range(S.x0 + 15, S.x1 - 15), cz = r().range(S.z0, S.z1), ids = [];
      for (let k = 0; k < 3; k++) { const i = ctx.horde.spawnAt(K.hexer, cx + (k - 1) * C.spread, cz); if (i >= 0) ids.push(i); }
      // they walk together to a gathering spot up the slope (≈ 30 m from the gate, out of the gate's fire) and chant there
      const gx = r().range(C.at.x[0], C.at.x[1]), gz = r().range(C.at.z[0], C.at.z[1]);
      if (ids.length) { covens.push({ ids, t0: n.clock, chantT: 0, state: 'walk', pos: { x: gx, y: groundHeight(gx, gz), z: gz } }); ctx.emit('coven.gather', { pos: { x: gx, y: groundHeight(gx, gz), z: gz }, from: { x: cx, y: 0, z: cz }, ids }); }
    }
    const alive = (i) => H.state[i] !== 0 && H.state[i] !== 4 && H.kind[i] === K.hexer;
    for (const g of covens) {
      if (g.state === 'done') continue;
      const live = g.ids.filter(alive);
      if (g.state === 'walk') {
        if (!live.length) { g.state = 'done'; continue; }
        // walk them to the spot (the horde's own steering is held: slowK 0), each to its place round it
        let arrived = 0;
        live.forEach((i, k) => {
          const a = k / 3 * Math.PI * 2, tx = g.pos.x + Math.cos(a) * 1.6, tz = g.pos.z + Math.sin(a) * 1.6, dx = tx - H.x[i], dz = tz - H.z[i], d = Math.hypot(dx, dz);
          H.slowT[i] = 0.2; H.slowK[i] = 0;
          H.vx[i] = 0; H.vz[i] = 0;   // (the horde must not move them as well)
          if (d > 0.4) { const v = Math.min(d, C.speed * dt); H.x[i] += dx / d * v; H.z[i] += dz / d * v; } else arrived++;
          H.y[i] = groundHeight(H.x[i], H.z[i]);
        });
        const ready = arrived === live.length || n.clock - g.t0 > C.gatherAfter;
        if (ready && live.length === g.ids.length) {
          g.state = 'chant'; g.chantT = 0;
          ctx.emit('coven.chant', { on: true, pos: g.pos, ids: g.ids });
        } else if (live.length < g.ids.length) { g.state = 'done'; }   // one of them died on the way: no coven
      } else if (g.state === 'chant') {
        for (const i of live) { H.slowT[i] = 0.2; H.slowK[i] = 0; }   // they stand and chant
        g.chantT += dt;
        if (live.length < g.ids.length) { g.state = 'done'; ctx.emit('coven.chant', { on: false, pos: g.pos, broken: true }); st.stats.covensBroken = (st.stats.covensBroken || 0) + 1; continue; }
        if (g.chantT >= C.chant) {
          g.state = 'done';
          ctx.emit('coven.chant', { on: false, pos: g.pos, broken: false });
          n.kindleLockT = C.lock; ctx.emit('coven.lock', { seconds: C.lock });
          st.stats.covenLocks = (st.stats.covenLocks || 0) + 1;
        }
      }
    }
    st.coven = covens.filter((g) => g.state === 'chant').map((g) => ({ pos: g.pos, t: g.chantT, ids: g.ids }));
    if (n.kindleLockT > 0) n.kindleLockT = Math.max(0, n.kindleLockT - dt);
  }

  return {
    update(dt) { weather(dt); if (ctx.state.mode === 'play') { phalanx(); coven(dt); } },
    weather,
  };
}
