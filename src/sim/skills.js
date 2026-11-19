// @ts-check
// VALLEYWARD · the new level-up skills (docs/DESIGN.md §10.4) that act every tick: Hearthblood (regeneration, doubled in
// fire), Cinder Trail (lilac ember ops behind a running Lamplighter), Ember Orbit (blue fireballs circling at 2.2 m:
// `state.orbit` holds their positions for the presentation) and Brimstone Rain (a green meteor on the densest crowd:
// `state.meteors` holds those in flight). Soul Feast lives in the horde's kill. Pure JS.
import { EV } from '../shared/events.js';
import { FIRE_OP, HUE_OF } from '../shared/fireops.js';
import { BODY } from '../shared/arena.js';
import { SKILL, ENEMY } from './constants.js';
import { ST } from './horde.js';

const DC = 4, DX0 = -24, DZ0 = -2, DW = 20, DH = 18;   // the meteor's crowd grid: 4 m cells over x −24..56, z −2..70

export function createSkills(ctx) {
  const H = ctx.state.horde;
  const hitT = new Float32Array(H.cap).fill(-1e9);
  const dens = new Uint16Array(DW * DH);
  let trailT = 0, orbitEmberT = 0, meteorT = 4, regenAcc = 0, orbitAngle = 0, meteorId = 1;
  // DESIGN §10.4 Pyre Burst: fire kills queue a burst (a short delay, so chains ripple through a crowd); a token bucket
  // keeps it at ≤ SKILL.pyre.perSecond bursts a second
  const pyreQ = /** @type {{x:number,z:number,t:number}[]} */ ([]);
  let pyreTokens = SKILL.pyre.perSecond;
  ctx.pyre = (x, z) => {
    const lv = ctx.mods.pyre; if (!lv || pyreQ.length > 64) return;
    if (ctx.rng.next() >= SKILL.pyre.chance[lv - 1]) return;
    pyreQ.push({ x, z, t: ctx.state.t + SKILL.pyre.delay });
  };
  function pyre(dt) {
    const st = ctx.state, lv = ctx.mods.pyre, P = SKILL.pyre;
    pyreTokens = Math.min(P.perSecond, pyreTokens + P.perSecond * dt);
    if (!lv || !pyreQ.length) return;
    let n = 0;
    for (let k = 0; k < pyreQ.length; k++) {
      const b = pyreQ[k];
      if (b.t > st.t) { pyreQ[n++] = b; continue; }
      if (pyreTokens < 1) continue;   // over the budget: this burst is dropped
      pyreTokens -= 1;
      const r = P.r[lv - 1];
      ctx.op({ kind: FIRE_OP.BURST, x: b.x, z: b.z, r, amount: 0.7 * ctx.mods.fireAmount, push: 3, hue: HUE_OF.burning });
      ctx.emit('pyre.burst', { pos: { x: b.x, y: ctx.ground(b.x, b.z), z: b.z }, r, level: lv });
      ctx.blast(b.x, 0, b.z, r, P.dmg[lv - 1] * ctx.mods.fireDmg, r, 0.1);
      st.stats.pyreBursts = (st.stats.pyreBursts || 0) + 1;
    }
    pyreQ.length = n;
  }

  // DESIGN §3.4 exception: Hearthblood heals only in fire on the ground (not on the wall walk), nothing out of it.
  // `player.inFire` (heat at the feet ≥ 0.3 on the ground) is exposed for the bot and the HUD.
  function regen(dt) {
    const st = ctx.state, p = st.player, lv = ctx.mods.regen;
    p.inFire = p.alive && p.where === 'ground' && p.onGround && ctx.fire.heat(p.x, p.z) >= SKILL.regenHeat;
    if (!lv || !p.inFire || p.hp >= p.hpMax) return;
    const add = Math.min(p.hpMax - p.hp, SKILL.regen[lv - 1] * dt);
    p.hp += add; regenAcc += add;
    if (regenAcc >= 5) { ctx.emit(EV.P_HEAL, { amount: +regenAcc.toFixed(1), source: 'hearthblood' }); regenAcc = 0; }
  }

  // DESIGN §10.4 CINDER STEPS: fire wherever the Lamplighter walks
  function trail(dt) {
    const st = ctx.state, p = st.player, lv = ctx.mods.trail, T = SKILL.trail;
    if (!lv || !p.alive) return;
    trailT -= dt;
    if (trailT > 0 || p.speed < T.minSpeed) return;
    trailT = T.every;
    const amt = (a) => a[lv - 1] * ctx.mods.fireAmount;
    if (p.where === 'walk') {
      // cinders over the parapet: the foot of the wall under the player's x
      const x = p.x, z = T.wallZ[0] + ctx.rng.next() * (T.wallZ[1] - T.wallZ[0]), gy = ctx.ground(x, z);
      ctx.op({ kind: FIRE_OP.EMBER, x, z, amount: amt(T.wallAmount), hue: HUE_OF.trail });
      ctx.emit(EV.TRAIL, { pos: { x, y: gy, z }, from: { x, y: p.y + 1.1, z: -0.3 }, wall: true });
      return;
    }
    if (!p.onGround) return;
    const v = Math.hypot(p.vx, p.vz) || 1, ux = p.vx / v, uz = p.vz / v, x = p.x - ux * T.back, z = p.z - uz * T.back, w = T.width[lv - 1];
    for (const s of [-1, 1]) ctx.op({ kind: FIRE_OP.EMBER, x: x - uz * w * s, z: z + ux * w * s, amount: amt(T.amount), hue: HUE_OF.trail });
    ctx.emit(EV.TRAIL, { pos: { x, y: p.y, z } });
  }

  // DESIGN §10.4 EMBER GALE: a hot gust from the keep down the slope every 14/11/8 s
  let galeT = 0;
  function gale(dt) {
    const st = ctx.state, lv = ctx.mods.gale, G = SKILL.gale;
    if (!lv || st.mode !== 'play') return;
    if (st.night.galeT > 0) st.night.galeT = Math.max(0, st.night.galeT - dt);
    galeT += dt;
    if (galeT < G.every[lv - 1]) return;
    galeT = 0;
    st.night.galeT = G.seconds;   // (sim.js updateWind: the wind points downhill at gale strength while it lasts)
    ctx.emit(EV.GALE, { dir: { x: 0, z: 1 }, strength: G.wind, seconds: G.seconds, level: lv });
    // burning cells on the plaza and slope flare and lean downhill
    let n = 0;
    for (let x = G.x[0]; x <= G.x[1] && n < G.flareCap; x += 3) for (let z = 1.5; z <= G.reach && n < G.flareCap; z += 3) {
      if (ctx.fire.heat(x, z) < 0.25) continue;
      ctx.op({ kind: FIRE_OP.EMBER, x, z: z + 1, amount: G.flare * ctx.mods.fireAmount }); n++;
    }
    for (let x = G.x[0] + 6; x <= G.x[1]; x += 12) ctx.op({ kind: FIRE_OP.PUSH, x, z: G.reach / 2, vx: 0, vz: G.wind, r: 9 });
    // goblins in the gust's path: pushed back (+z) and staggered
    const H = st.horde, d = G.push[lv - 1];
    for (let i = 0; i < H.count; i++) {
      const s0 = H.state[i]; if (s0 === ST.DEAD || s0 === ST.DYING) continue;
      if (H.z[i] < 0.3 || H.z[i] > G.reach || H.x[i] < G.x[0] || H.x[i] > G.x[1]) continue;
      H.z[i] += d; H.y[i] = ctx.ground(H.x[i], H.z[i]); H.slowT[i] = Math.max(H.slowT[i], G.stagger); H.slowK[i] = 0;
    }
    st.stats.gales = (st.stats.gales || 0) + 1;
  }

  function orbit(dt) {
    const st = ctx.state, p = st.player, n = ctx.mods.orbit, O = SKILL.orbit;
    if (!n || !p.alive) { if (st.orbit.length) st.orbit.length = 0; return; }
    orbitAngle = (orbitAngle + O.spin * dt) % (Math.PI * 2);
    while (st.orbit.length < n) st.orbit.push({ x: 0, y: 0, z: 0, a: 0 });
    st.orbit.length = n;
    orbitEmberT -= dt;
    const ember = orbitEmberT <= 0;
    if (ember) orbitEmberT = O.emberEvery;
    let hits = 0;
    const now = st.t, dmg = O.dmg * ctx.mods.fireDmg;
    for (let k = 0; k < n; k++) {
      const b = st.orbit[k], a = orbitAngle + k * Math.PI * 2 / n;
      b.a = a; b.x = p.x + Math.cos(a) * O.r; b.z = p.z + Math.sin(a) * O.r; b.y = p.y + O.height;
      ctx.horde.hash.query(b.x, b.z, O.hitR + 0.7, (i) => {
        const s = H.state[i]; if (s === ST.DEAD || s === ST.DYING || hitT[i] > now) return false;
        const K = ENEMY[H.kind[i]];
        if (Math.hypot(H.x[i] - b.x, H.z[i] - b.z) > O.hitR + K.radius || b.y < H.y[i] - 0.3 || b.y > H.y[i] + K.height + 0.6) return false;
        hitT[i] = now + O.hitEvery;
        ctx.horde.ignite(i);
        if (hits++ < 6) ctx.emit(EV.ORBIT_HIT, { pos: { x: H.x[i], y: H.y[i] + K.height * 0.6, z: H.z[i] }, id: i });
        ctx.horde.damage(i, dmg, 'blast', null);
        st.stats.orbitHits = (st.stats.orbitHits || 0) + 1;
        return false;
      });
      const tr = st.troll;
      if (tr && tr.alive && Math.hypot(tr.x - b.x, tr.z - b.z) < BODY.troll.radius + O.hitR && (st.tick % 30 === k)) { ctx.troll.hit(dmg, 'blast'); ctx.troll.heatUp(0.05); }
      if (ember && p.where === 'ground') ctx.op({ kind: FIRE_OP.EMBER, x: b.x, z: b.z, amount: 0.45 * ctx.mods.fireAmount, hue: HUE_OF.orbit });
    }
  }

  function densest() {
    dens.fill(0);
    for (let i = 0; i < H.count; i++) {
      const s = H.state[i]; if (s === ST.DEAD || s === ST.DYING) continue;
      const gi = Math.floor((H.x[i] - DX0) / DC), gj = Math.floor((H.z[i] - DZ0) / DC);
      if (gi >= 0 && gj >= 0 && gi < DW && gj < DH) dens[gj * DW + gi]++;
    }
    let best = 0, bk = -1;
    for (let k = 0; k < dens.length; k++) if (dens[k] > best) { best = dens[k]; bk = k; }
    if (bk < 0) return null;
    // the centroid of the goblins in that cell
    const ci = bk % DW, cj = (bk / DW) | 0;
    let sx = 0, sz = 0, c = 0;
    for (let i = 0; i < H.count; i++) {
      const s = H.state[i]; if (s === ST.DEAD || s === ST.DYING) continue;
      if (Math.floor((H.x[i] - DX0) / DC) === ci && Math.floor((H.z[i] - DZ0) / DC) === cj) { sx += H.x[i]; sz += H.z[i]; c++; }
    }
    return { x: sx / c, z: sz / c, n: best };
  }

  function meteors(dt) {
    const st = ctx.state, lv = ctx.mods.meteor, M = SKILL.meteor;
    if (lv) {
      meteorT -= dt;
      if (meteorT <= 0) {
        meteorT = M.every[lv - 1];
        const d = densest();
        if (d && d.n >= M.minCrowd) {
          const y = ctx.ground(d.x, d.z);
          const from = { x: d.x + 9, y: y + 34, z: d.z - 14 };
          const m = { id: meteorId++, x: d.x, y, z: d.z, fx: from.x, fy: from.y, fz: from.z, t: 0, flight: M.flight, r: M.r };
          st.meteors.push(m);
          ctx.emit(EV.METEOR, { id: m.id, from, pos: { x: d.x, y, z: d.z }, r: M.r, flight: M.flight });
        } else meteorT = 1;
      }
    }
    for (let k = st.meteors.length - 1; k >= 0; k--) {
      const m = st.meteors[k];
      m.t += dt;
      if (m.t < m.flight) continue;
      st.meteors.splice(k, 1);
      ctx.op({ kind: FIRE_OP.BURST, x: m.x, z: m.z, r: M.r, amount: 1.1 * ctx.mods.fireAmount, push: 6, hue: HUE_OF.brimstone });
      ctx.blast(m.x, m.y, m.z, M.r, M.dmg * ctx.mods.fireDmg, M.r * 0.9, 0.4);
      st.stats.meteors = (st.stats.meteors || 0) + 1;
    }
  }

  return {
    update(dt) { regen(dt); trail(dt); gale(dt); orbit(dt); meteors(dt); pyre(dt); },
    /** a hidden handle for tests */
    get orbitAngle() { return orbitAngle; },
  };
}
