// @ts-check
// VALLEYWARD · the towers (docs/DESIGN.md §9.6): built and upgraded at the camp, they act during the night. The
// Hellfire Obelisk pulses a violet fire nova (burst ops on its ring + damage inside); the Chain Imp throws chained hooks
// at goblins within 16 m (brutes and elites first): each hook slows, pulls toward the imp and deals damage. DESIGN §9.6:
// 5 levels, weak at first (meta.js TOWERS). Invulnerable (goblins ignore them; their colliders are in the flow field). Pure JS.
import { ARENA, groundHeight } from '../shared/arena.js';
import { EV } from '../shared/events.js';
import { FIRE_OP, HUE_OF } from '../shared/fireops.js';
import { TOWERS } from '../shared/meta.js';
import { ENEMY, K } from './constants.js';
import { ST } from './horde.js';
import { PAD_BY_ID } from './run.js';

const HOOK_SPEED = 38, HOOK_HOLD = 0.55, PULL_SECONDS = 0.4, IMP_Y = 1.7, OBELISK_Y = 3.2;

/** The run's towers with their pad positions: [{ pad, type, level, x, z }]. */
export function towerSpots(towers) {
  return towers.map((t) => { const p = PAD_BY_ID[t.pad]; return { ...t, x: p.x, z: p.z }; });
}
/** Round obstacles for the flow field and the player (ARENA.camp.towerRadius). */
export const towerCircles = (towers) => towerSpots(towers).map((t) => ({ x: t.x, z: t.z, r: ARENA.camp.towerRadius }));

export function createTowers(ctx) {
  const H = ctx.state.horde;
  /** Per-tower timers keyed by pad (a tower's first act comes a little after nightfall, staggered). */
  const cd = new Map();

  function pulse(t) {
    const st = ctx.state, T = TOWERS.obelisk, L = t.level - 1, r = T.radius[L], y = groundHeight(t.x, t.z);
    ctx.emit(EV.OBELISK_PULSE, { pad: t.pad, pos: { x: t.x, y: y + OBELISK_Y, z: t.z }, r, level: t.level });
    // real fire on the ring (the fluid carries it on); hue 'violet' (fireops HUE_OF.obelisk)
    const n = Math.max(8, Math.ceil(2 * Math.PI * r * 0.8 / 2.2));
    for (let k = 0; k < n; k++) {
      const a = (k + 0.5) / n * Math.PI * 2;
      ctx.op({ kind: FIRE_OP.BURST, x: t.x + Math.cos(a) * r * 0.8, z: t.z + Math.sin(a) * r * 0.8, r: 1.4, amount: 0.75 * ctx.mods.fireAmount, push: 3.5, hue: HUE_OF.obelisk });
    }
    const dmg = T.dmg[L] * ctx.mods.fireDmg;
    ctx.horde.hash.query(t.x, t.z, r, (i) => {
      const s = H.state[i]; if (s === ST.DEAD || s === ST.DYING) return false;
      if (Math.hypot(H.x[i] - t.x, H.z[i] - t.z) < r) ctx.horde.damage(i, dmg, 'blast', null);
      return false;
    });
    const tr = st.troll;
    if (tr && tr.alive && Math.hypot(tr.x - t.x, tr.z - t.z) < r + 2.2) { ctx.troll.heatUp(0.25); ctx.troll.hit(dmg, 'blast'); }
    st.stats.towerPulses = (st.stats.towerPulses || 0) + 1;
  }

  function throwHooks(t) {
    const st = ctx.state, T = TOWERS.chainimp, L = t.level - 1, n = T.targets[L], R = T.range;
    /** best n by score (brutes and elites first, then the nearest; not one already hooked) */
    const best = [];
    ctx.horde.hash.query(t.x, t.z, R, (i) => {
      const s = H.state[i]; if (s === ST.DEAD || s === ST.DYING) return false;
      const d = Math.hypot(H.x[i] - t.x, H.z[i] - t.z); if (d > R || d < 1.2) return false;
      const k = H.kind[i];
      let score = d;
      if (k === K.brute || k === K.chief || k === K.hexer) score -= 100;
      if (H.slowT[i] > 0) score += 40;
      if (best.length < n || score < best[best.length - 1][0]) {
        best.push([score, i, d]); best.sort((a, b) => a[0] - b[0]); if (best.length > n) best.pop();
      }
      return false;
    });
    if (!best.length) return false;
    const y = groundHeight(t.x, t.z) + IMP_Y;
    for (const [, i, d] of best) {
      const to = { x: H.x[i], y: H.y[i] + ENEMY[H.kind[i]].height * 0.6, z: H.z[i] };
      ctx.emit(EV.CHAIN_THROW, { pad: t.pad, from: { x: t.x, y, z: t.z }, to, targetId: i, flight: +(d / HOOK_SPEED).toFixed(3) });
      st.chains.push({ pad: t.pad, id: i, fx: t.x, fy: y, fz: t.z, tx: to.x, ty: to.y, tz: to.z, t: 0, flight: d / HOOK_SPEED, hooked: false, hold: HOOK_HOLD, level: t.level });
    }
    return true;
  }

  function updateChains(dt) {
    const st = ctx.state, T = TOWERS.chainimp;
    for (let k = st.chains.length - 1; k >= 0; k--) {
      const c = st.chains[k];
      c.t += dt;
      const i = c.id, alive = H.state[i] !== ST.DEAD && H.state[i] !== ST.DYING;
      if (alive && c.hooked) { c.tx = H.x[i]; c.ty = H.y[i] + ENEMY[H.kind[i]].height * 0.6; c.tz = H.z[i]; }
      if (!c.hooked && c.t >= c.flight) {
        c.hooked = true;
        if (alive) {
          const L = c.level - 1, dx = c.fx - H.x[i], dz = c.fz - H.z[i], d = Math.hypot(dx, dz) || 1;
          const pull = Math.min(T.pull[L], Math.max(0, d - 1.2));   // DESIGN §9.6: per level
          H.slowT[i] = T.slowFor; H.slowK[i] = 1 - T.slow[L];
          H.pullT[i] = PULL_SECONDS; H.pullVX[i] = dx / d * pull / PULL_SECONDS; H.pullVZ[i] = dz / d * pull / PULL_SECONDS;
          ctx.emit(EV.CHAIN_HOOK, { pad: c.pad, targetId: i, pos: { x: H.x[i], y: H.y[i], z: H.z[i] }, pull });
          ctx.horde.damage(i, T.dmg[L], 'bullet', null);
          st.stats.hooks = (st.stats.hooks || 0) + 1;
        }
      }
      if (c.t >= c.flight + c.hold || (c.hooked && !alive)) st.chains.splice(k, 1);
    }
  }

  /** One tick of the night (mode 'play'). */
  function update(dt) {
    const st = ctx.state;
    const spots = st.run.spots;
    for (let k = 0; k < spots.length; k++) {
      const t = spots[k];
      let c = cd.get(t.pad);
      if (c == null) c = 0.8 + k * 0.37;
      c -= dt;
      if (c <= 0) {
        if (t.type === 'obelisk') { pulse(t); c = TOWERS.obelisk.every[t.level - 1]; }
        else if (t.type === 'chainimp') c = throwHooks(t) ? TOWERS.chainimp.every[t.level - 1] : 0.25;
      }
      cd.set(t.pad, c);
    }
    updateChains(dt);
  }

  return { update, reset() { cd.clear(); } };
}
