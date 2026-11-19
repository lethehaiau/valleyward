// @ts-check
// VALLEYWARD · the CPU fire proxy (docs/DESIGN.md §14.6): a 64 × 64 grid of 1 m cells over ARENA.fluid holding fuel, fire
// and heat, advected by the wind and fed by the same FIRE_OP ops as the GPU fluid. It is the sim's fire provider in Node
// (tests, the bot) and in the browser until the ground module's gameplay grid lands (or when the fire host fails, or the ground fire module has no gameplay grid). Pure JS.
// Tuned to roughly match the GPU fire (the classic module's numbers: firewraith/modules/classic/FLUID.md, "Measured fire behaviour"; see docs/CORE.md).
import { ARENA } from '../shared/arena.js';
import { FIRE_OP } from '../shared/fireops.js';

export const PROXY = Object.freeze({
  n: 64,
  igniteHeat: 0.22,      // fuel catches when the cell's heat reaches this
  fuelBurn: 0.085,       // fuel units burnt per second in a burning cell (a full trough cell lasts ≈ 12 s)
  fuelToFire: 9,         // fire added per unit of fuel burnt
  fireDecay: 0.8,        // 1/s (1.15 → 0.8 after __ew.fireCompare(): the GPU fire burnt 1.6× the cells, 2.2× the mean heat)
  heatGain: 1.1,         // heat follows fire × this (relaxing at 4/s), then decays at heatDecay
  heatDecay: 0.75,       // 1/s (0.95 → 0.75, same measurement)
  spread: 1.6,           // 1/s: an oiled cell next to fire warms by spread × the neighbour's fire (fire runs along a trough)
  windAdvect: 0.8,       // fraction of the wind speed the fire and heat drift with
  max: 1.5,
  stream: Object.freeze({ fire: 0.5, heat: 0.6, fuel: 0.035 }),
  burst: Object.freeze({ fire: 1.0, heat: 1.1 }),
  ember: Object.freeze({ fire: 0.35, heat: 0.5, r: 0.9 }),
});

/** @param {{ mods?: { decay?: number, spread?: number } }} [o] */
export function createFireProxy(o = {}) {
  const F = ARENA.fluid, N = PROXY.n, cell = F.size / N;
  const fuel = new Float32Array(N * N), fire = new Float32Array(N * N), heat = new Float32Array(N * N);
  const tmpA = new Float32Array(N * N), tmpB = new Float32Array(N * N);
  const mods = { decay: 1, spread: 1, ...(o.mods || {}) };
  let wind = { x: 0, z: 0 }, rain = 0;
  const clampMax = (v) => (v > PROXY.max ? PROXY.max : v);

  /** Visit cells within radius r of (x, z): cb(index, weight 0..1). */
  function disc(x, z, r, cb) {
    const gx = (x - F.x0) / cell - 0.5, gz = (z - F.z0) / cell - 0.5, gr = r / cell + 0.5;
    const i0 = Math.max(0, Math.floor(gx - gr)), i1 = Math.min(N - 1, Math.ceil(gx + gr));
    const j0 = Math.max(0, Math.floor(gz - gr)), j1 = Math.min(N - 1, Math.ceil(gz + gr));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(i - gx, j - gz) * cell;
      if (d > r + cell * 0.5) continue;
      cb(j * N + i, Math.max(0, Math.min(1, 1 - d / Math.max(r, 0.5)) + (d < cell ? 0.25 : 0)));
    }
  }
  function segment(x0, z0, x1, z1, r, cb) {
    const minx = Math.min(x0, x1) - r, maxx = Math.max(x0, x1) + r, minz = Math.min(z0, z1) - r, maxz = Math.max(z0, z1) + r;
    const i0 = Math.max(0, Math.floor((minx - F.x0) / cell)), i1 = Math.min(N - 1, Math.floor((maxx - F.x0) / cell));
    const j0 = Math.max(0, Math.floor((minz - F.z0) / cell)), j1 = Math.min(N - 1, Math.floor((maxz - F.z0) / cell));
    const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz || 1e-6;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = F.x0 + (i + 0.5) * cell, cz = F.z0 + (j + 0.5) * cell;
      const t = Math.max(0, Math.min(1, ((cx - x0) * dx + (cz - z0) * dz) / L2));
      const d = Math.hypot(cx - (x0 + dx * t), cz - (z0 + dz * t));
      if (d > r) continue;
      cb(j * N + i, 1 - (d / r) * 0.7);
    }
  }

  const api = {
    kind: 'proxy',
    ready: true,
    /** @param {any[]} ops @param {{x:number,z:number}} [w] */
    apply(ops, w) {
      if (w) wind = w;
      for (const op of ops) {
        switch (op.kind) {
          case FIRE_OP.STREAM: {
            const a = op.amount ?? 1, S = PROXY.stream;
            segment(op.x0, op.z0, op.x1, op.z1, op.radius ?? 0.9, (k, wt) => {
              fire[k] = clampMax(fire[k] + S.fire * a * wt); heat[k] = clampMax(heat[k] + S.heat * a * wt); fuel[k] = Math.min(2, fuel[k] + S.fuel * a * wt);
            });
            break;
          }
          case FIRE_OP.BURST: {
            const a = op.amount ?? 1, B = PROXY.burst;
            disc(op.x, op.z, op.r ?? 2, (k, wt) => { fire[k] = clampMax(fire[k] + B.fire * a * wt); heat[k] = clampMax(heat[k] + B.heat * a * wt); });
            break;
          }
          case FIRE_OP.FUEL: {
            const a = op.amount ?? 1;
            if (op.box) {
              const b = op.box;
              const i0 = Math.max(0, Math.floor((b.x0 - F.x0) / cell)), i1 = Math.min(N - 1, Math.floor((b.x1 - F.x0) / cell));
              const j0 = Math.max(0, Math.floor((b.z0 - F.z0) / cell)), j1 = Math.min(N - 1, Math.floor((b.z1 - F.z0) / cell));
              for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fuel[j * N + i] = Math.min(2, Math.max(fuel[j * N + i], a));
            } else disc(op.x, op.z, op.r ?? 2, (k, wt) => { fuel[k] = Math.min(2, fuel[k] + a * wt); });
            break;
          }
          case FIRE_OP.EMBER: {
            const a = op.amount ?? 1, E = PROXY.ember;
            disc(op.x, op.z, E.r, (k, wt) => { fire[k] = clampMax(fire[k] + E.fire * a * wt); heat[k] = clampMax(heat[k] + E.heat * a * wt); });
            break;
          }
          case FIRE_OP.DOUSE:
            // the point form, or the line form (the Rainmother's tide front: x0, z0, x1, z1, r)
            if (op.x0 != null) segment(op.x0, op.z0, op.x1, op.z1, op.r ?? 1.4, (k) => { fire[k] = 0; heat[k] = 0; });
            else disc(op.x, op.z, op.r ?? 3, (k) => { fire[k] = 0; heat[k] = 0; });
            break;
          case 'swirl':
            // a whirlpool: douse the eye (0.3 r) and wash the oil away over r (−1.5 fuel/s at one op per tick)
            disc(op.x, op.z, (op.r ?? 5) * 0.3, (k) => { fire[k] = 0; heat[k] = 0; });
            disc(op.x, op.z, op.r ?? 5, (k) => { fuel[k] = Math.max(0, fuel[k] - 0.025 * (op.amount ?? 1)); });
            break;
          default: break;   // PUSH: the proxy has no velocity field
        }
      }
    },
    /** @param {number} dt */
    step(dt) {
      if (!(dt > 0)) return;
      // DESIGN §8.3: rain quenches (decay ×(1 + 1.2 rain): at full rain the fire and heat fade ≈ 2.2× faster)
      const q = 1 + 1.2 * rain, P = PROXY, fd = Math.exp(-P.fireDecay * q * dt / mods.decay), hd = Math.exp(-P.heatDecay * q * dt / mods.decay), hk = 1 - Math.exp(-4 * dt);
      tmpA.set(fire);
      const sp = P.spread * mods.spread * dt;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const k = j * N + i;
        let f = fire[k], h = heat[k], u = fuel[k];
        if (u > 0) {
          // fire creeps along the oil: the hottest burning neighbour warms this cell
          if (h < P.igniteHeat) {
            const nb = Math.max(i > 0 ? tmpA[k - 1] : 0, i < N - 1 ? tmpA[k + 1] : 0, j > 0 ? tmpA[k - N] : 0, j < N - 1 ? tmpA[k + N] : 0);
            if (nb > 0.2) h += sp * nb;
          }
          if (h >= P.igniteHeat) { const b = Math.min(u, P.fuelBurn * dt); u -= b; f += b * P.fuelToFire; }
        }
        f *= fd;
        const ht = f * P.heatGain;
        h = ht > h ? h + (ht - h) * hk : h * hd;
        fire[k] = f < 1e-4 ? 0 : clampMax(f); heat[k] = h < 1e-4 ? 0 : clampMax(h); fuel[k] = u < 1e-4 ? 0 : u;
      }
      // wind drift (semi-Lagrangian, bilinear): fire and heat lean downwind
      const sx = wind.x * P.windAdvect * dt / cell, sz = wind.z * P.windAdvect * dt / cell;
      if (Math.abs(sx) + Math.abs(sz) > 1e-5) { advect(fire, sx, sz); advect(heat, sx, sz); }
    },
    heat: (x, z) => Math.min(1, sample(heat, x, z)),
    fuel: (x, z) => Math.min(1, sample(fuel, x, z)),
    fire: (x, z) => Math.min(1, sample(fire, x, z)),
    setMods(m) { Object.assign(mods, m); },
    /** DESIGN §8.3: the rain (0..1) quenches the proxy's fire. */
    setRain(r) { rain = Math.max(0, Math.min(1, r || 0)); },
    reset() { fuel.fill(0); fire.fill(0); heat.fill(0); },
    /** For the debug overlay and the tests. */
    grid: () => ({ n: N, x0: F.x0, z0: F.z0, cell, fire, heat, fuel }),
    /** Sum of fire over the grid (tests, the debug overlay). */
    total() { let s = 0; for (let k = 0; k < N * N; k++) s += fire[k]; return s; },
    hash() { let s = 0; for (let k = 0; k < N * N; k += 7) s += fire[k] * 3 + heat[k] * 5 + fuel[k] * 7; return Math.round(s * 1000); },
  };

  function advect(f, sx, sz) {
    tmpB.set(f);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = i - sx, z = j - sz;
      const x0 = Math.floor(x), z0 = Math.floor(z), tx = x - x0, tz = z - z0;
      const a = at(tmpB, x0, z0), b = at(tmpB, x0 + 1, z0), c = at(tmpB, x0, z0 + 1), d = at(tmpB, x0 + 1, z0 + 1);
      f[j * N + i] = (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
    }
  }
  function at(f, i, j) { return i < 0 || j < 0 || i >= N || j >= N ? 0 : f[j * N + i]; }
  function sample(f, x, z) {
    const gx = (x - F.x0) / cell - 0.5, gz = (z - F.z0) / cell - 0.5;
    if (gx < -1 || gz < -1 || gx > N || gz > N) return 0;
    const i = Math.floor(gx), j = Math.floor(gz), tx = gx - i, tz = gz - j;
    return (at(f, i, j) * (1 - tx) + at(f, i + 1, j) * tx) * (1 - tz) + (at(f, i, j + 1) * (1 - tx) + at(f, i + 1, j + 1) * tx) * tz;
  }
  return api;
}
