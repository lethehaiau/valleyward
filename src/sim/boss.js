// @ts-check
// VALLEYWARD · THE RAINMOTHER (docs/DESIGN.md §6.3, Night X): a 14 m river-giantess of dark water and stones. She rises
// out of the valley river at 0:30 and walks up the road toward the lamp; the storm comes with her (twists.js reads her
// phase). HP 91,000 on Night X (meta.js NIGHTS[9].bossHp; BOSS.hp 12,000 is only the fallback) in three phases:
// 1 Tide (tidal waves down the road: a douse line + 40 dmg + knockback, and a goblin wave), 2 Downpour (whirlpools that
// pull goblins and the Lamplighter; her shamans hex the Lance), 3 The Climb (faster; reaching the gate loses the night).
// Standing in heavy fire she cracks (guns ×3 for a while); the six blue lanterns in her hair can be shot out (each: a
// shaman less, rain −0.08). Her fall → the ending. One object in `state.boss`. Pure JS.
import { ARENA, groundHeight } from '../shared/arena.js';
import { EV } from '../shared/events.js';
import { FIRE_OP } from '../shared/fireops.js';
import { K } from './constants.js';

export const BOSS = Object.freeze({
  hp: 12000, height: 14, radius: 3.4, rise: 6, speed: [0.42, 0.42, 0.4], gateR: 5.5,
  // staging: THE CLIMB brings her close — at phase 3 she leaves the road and strides straight up the slope
  // at the gate at `surge` m/s until she is `surgeTo` m from it (≈ 20–24 m from the wall walk, in front of it: 14 m tall,
  // ≥ 35 % of the frame height from there), then climbs at speed[2] (0.7 → 0.4, so the time she leaves for the last
  // stretch stays about what it was from mid-road)
  climb: Object.freeze({ surge: 3.0, surgeTo: 22 }),
  crackHeat: 0.4, crackRate: 0.6, crackDecay: 0.2, crackSeconds: 5, crackMul: 3, fireDps: 6,
  tide: Object.freeze({ every: [13, 17, 0], windup: 1.6, width: 4.5, dmg: 40, knock: 9, wave: 36 }),   // (DESIGN §6.1: 20 → 40)
  whirl: Object.freeze({ every: 9, first: 4, r: 5.5, seconds: 5, pull: 3.2 }),
  hex: Object.freeze({ every: 5.5, speed: 16, hitR: 1.4, sputter: 2 }),
  lanterns: 6, lanternHp: 30, lanternR: 0.55,
});

export function createBoss(ctx) {
  const PATH = [...ARENA.road.points].reverse().map(([x, z]) => ({ x, z }));
  PATH.unshift({ x: 30, z: 92 });   // the river, beyond the road's end
  PATH.push({ x: ARENA.gate.target.x + 1.5, z: ARENA.gate.target.z + 3 });
  const whirls = /** @type {{x:number,z:number,t:number,r:number}[]} */ ([]);

  function lanternPos(b, k) {
    const a = k / BOSS.lanterns * Math.PI * 2 + b.yaw;
    return { x: b.x + Math.cos(a) * 1.8, y: b.y + BOSS.height - 1.2 + (k % 2) * 0.6, z: b.z + Math.sin(a) * 1.8 };
  }

  function rise() {
    const st = ctx.state, p0 = PATH[0];
    const HP = Math.round((ctx.nightCfg?.bossHp ?? BOSS.hp) * (st.night?.hpMul ?? 1));   // (NIGHTS[9].bossHp at power 1 × the power scale)
    st.boss = { kind: 'rainmother', x: p0.x, y: groundHeight(p0.x, p0.z) - BOSS.height, z: p0.z, yaw: Math.PI, hp: HP, hpMax: HP, phase: 1, mode: 'rise', t: 0,
      heat: 0, cracked: false, crackT: 0, lanterns: [], lanternsOut: 0, shamans: BOSS.lanterns, alive: true, deathT: 0, k: 1,
      tideT: 8, whirlT: BOSS.whirl.first, hexT: 3, action: null, actionT: 0, tideTo: null };
    const b = st.boss;
    for (let k = 0; k < BOSS.lanterns; k++) b.lanterns.push({ alive: true, hp: BOSS.lanternHp, ...lanternPos(b, k) });
    ctx.emit('boss.rise', { pos: { x: b.x, y: groundHeight(b.x, b.z), z: b.z } });
  }

  function hurt(dmg, source) {
    const st = ctx.state, b = st.boss; if (!b || !b.alive) return;
    const d = dmg * (source === 'bullet' && b.cracked ? BOSS.crackMul : 1);
    b.hp = Math.max(0, b.hp - d);
    if (source !== 'fire' || st.tick % 30 === 0) ctx.emit('boss.hurt', { dmg: +d.toFixed(1), hpFrac: b.hp / b.hpMax, source, cracked: b.cracked, pos: { x: b.x, y: b.y + 8, z: b.z } });
    const ph = b.hp > b.hpMax * 0.66 ? 1 : b.hp > b.hpMax * 0.33 ? 2 : 3;
    if (ph !== b.phase) { b.phase = ph; ctx.emit('boss.phase', { phase: ph }); }
    if (b.hp <= 0) {
      b.alive = false; b.mode = 'dead'; b.deathT = 0; b.cracked = false;
      st.stats.bossKilled = true;
      ctx.emit('boss.death', { pos: { x: b.x, y: b.y, z: b.z } });
      for (let x = -10; x <= 40; x += 10) for (let z = 10; z <= 80; z += 14) ctx.op({ kind: FIRE_OP.PUSH, x, z, vx: 0, vz: 2, r: 6 });
    }
  }
  /** Rays: a lantern first (small spheres at her crown), then her body (a vertical cylinder). */
  function rayHit(o, d, maxT) {
    const b = ctx.state.boss; if (!b || !b.alive || b.mode === 'rise') return null;
    let best = null, bt = maxT;
    b.lanterns.forEach((L, k) => {
      if (!L.alive) return;
      const ox = o.x - L.x, oy = o.y - L.y, oz = o.z - L.z, bb = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - BOSS.lanternR * BOSS.lanternR, disc = bb * bb - c;
      if (disc < 0) return; const t = -bb - Math.sqrt(disc); if (t >= 0 && t < bt) { bt = t; best = { t, lantern: k }; }
    });
    const ox = o.x - b.x, oz = o.z - b.z, a = d.x * d.x + d.z * d.z;
    if (a > 1e-9) {
      const bq = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - BOSS.radius * BOSS.radius, disc = bq * bq - 4 * a * c;
      if (disc >= 0) { const t = Math.max(0, (-bq - Math.sqrt(disc)) / (2 * a)), y = o.y + d.y * t; if (t < bt && y >= b.y && y <= b.y + BOSS.height) { bt = t; best = { t, lantern: -1 }; } }
    }
    return best;
  }
  function hitRay(h, dmg) {
    const st = ctx.state, b = st.boss;
    if (h.lantern >= 0) {
      const L = b.lanterns[h.lantern]; L.hp -= dmg;
      if (L.hp <= 0 && L.alive) { L.alive = false; b.lanternsOut++; b.shamans = Math.max(0, b.shamans - 1); ctx.emit('boss.lantern', { idx: h.lantern, pos: { x: L.x, y: L.y, z: L.z }, left: BOSS.lanterns - b.lanternsOut }); }
    } else hurt(dmg, 'bullet');
  }
  function blast(x, z, r, dmg) { const b = ctx.state.boss; if (b && b.alive && b.mode !== 'rise' && Math.hypot(b.x - x, b.z - z) < r + BOSS.radius) hurt(dmg, 'blast'); }

  function tide(b) {
    // a tidal wave down toward the gate: a douse line (every 3 m), 40 dmg + knockback to the Lamplighter in it, a goblin wave
    const st = ctx.state, p = st.player, T = ARENA.gate.target, to = b.tideTo || { x: T.x, z: T.z + 3 };
    const dx = to.x - b.x, dz = to.z - b.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
    for (let s = 2; s < L; s += 3) ctx.op({ kind: FIRE_OP.DOUSE, x: b.x + ux * s, z: b.z + uz * s, r: BOSS.tide.width * 0.6 });
    // the wave front for the fluid (the line form of DOUSE, once per tick while it runs down the road)
    b.front = { x: b.x, z: b.z, ux, uz, L, t: 0, wx: -uz * BOSS.tide.width / 2, wz: ux * BOSS.tide.width / 2 };
    const px = p.x - b.x, pz = p.z - b.z, along = px * ux + pz * uz, across = Math.abs(px * uz - pz * ux);
    if (p.alive && along > 0 && along < L + 2 && across < BOSS.tide.width / 2 && p.y - groundHeight(p.x, p.z) < 2) {
      ctx.emit('boss.tide.hit', { pos: { x: p.x, y: p.y, z: p.z } });
      ctx.hurtPlayer(BOSS.tide.dmg, 'tide', { x: ux, z: uz });
      p.vx += ux * BOSS.tide.knock; p.vz += uz * BOSS.tide.knock;
    }
    ctx.horde.spawnMany(K.grunt, BOSS.tide.wave, b.x - ux * 4, b.z - uz * 4);
    st.stats.tides = (st.stats.tides || 0) + 1;
  }

  function update(dt) {
    const st = ctx.state, cfg = ctx.nightCfg, n = st.night;
    if (cfg?.boss === 'rainmother' && !st.boss && n.clock >= (cfg.bossAt ?? 30) && st.mode === 'play') rise();
    const b = st.boss; if (!b) return;
    b.t += dt;
    if (!b.alive) { b.deathT += dt; b.y -= dt * 2.5; return; }
    const p = st.player, T = ARENA.gate.target;
    if (b.mode === 'rise') {
      b.y = groundHeight(b.x, b.z) - BOSS.height * Math.max(0, 1 - b.t / BOSS.rise);
      if (b.t >= BOSS.rise) { b.mode = 'walk'; b.t = 0; b.y = groundHeight(b.x, b.z); }
      for (let k = 0; k < BOSS.lanterns; k++) Object.assign(b.lanterns[k], lanternPos(b, k));
      return;
    }
    // fire at her feet: she steams and cracks (guns ×3), and burns a little
    let h = ctx.fire.heat(b.x, b.z);
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; h = Math.max(h, ctx.fire.heat(b.x + Math.cos(a) * 2.6, b.z + Math.sin(a) * 2.6)); }
    if (h >= BOSS.crackHeat) { b.heat = Math.min(1, b.heat + h * BOSS.crackRate * dt); hurt(BOSS.fireDps * ctx.mods.fireDmg * dt, 'fire'); if (!b.alive) return; }
    else if (!b.cracked) b.heat = Math.max(0, b.heat - BOSS.crackDecay * dt);
    if (!b.cracked && b.heat >= 1) { b.cracked = true; b.crackT = BOSS.crackSeconds; ctx.emit('boss.crack', { on: true, pos: { x: b.x, y: b.y + 6, z: b.z } }); }
    if (b.cracked) { b.crackT -= dt; if (b.crackT <= 0) { b.cracked = false; b.heat = 0; ctx.emit('boss.crack', { on: false }); } }

    // an action in progress (the tide's windup)
    if (b.action === 'tide') {
      b.actionT += dt;
      if (b.actionT >= BOSS.tide.windup) { tide(b); b.action = null; b.mode = b.phase === 3 ? 'climb' : 'walk'; }
    } else {
      // walk the road toward the gate (faster in the climb)
      const dG = Math.hypot(T.x - b.x, T.z - b.z);
      if (dG < BOSS.gateR) {
        if (ctx.isGod?.()) { b.mode = 'climb'; return; }   // (god mode, captures: she stands at the gate)
        ctx.emit('boss.gate', { pos: { x: b.x, y: b.y, z: b.z } }); ctx.fall('boss'); return;
      }
      // THE CLIMB (phase 3) leaves the road and climbs straight up the slope at the gate (in full view of the wall walk;
      // the road's last stretch runs behind the SE tower)
      const tgt = b.phase === 3 ? PATH[PATH.length - 1] : PATH[Math.min(b.k, PATH.length - 1)], dx = tgt.x - b.x, dz = tgt.z - b.z, d = Math.hypot(dx, dz);
      if (b.phase < 3 && d < 1.2 && b.k < PATH.length - 1) b.k++;
      const surge = b.phase === 3 && dG > BOSS.climb.surgeTo;
      const v = (surge ? BOSS.climb.surge : BOSS.speed[b.phase - 1]) * (ctx.nightCfg?.bossSpeed ?? 1) * dt;
      if (d > 1e-3) { b.x += dx / d * Math.min(v, d); b.z += dz / d * Math.min(v, d); b.yaw = Math.atan2(dx, dz); }
      b.y = groundHeight(b.x, b.z);
      b.mode = b.phase === 3 ? 'climb' : 'walk';
      b.stepAcc = (b.stepAcc || 0) + v;
      if (b.stepAcc >= 3) { b.stepAcc = 0; ctx.emit('boss.step', { pos: { x: b.x, y: b.y, z: b.z } }); }
      // the tide (phases 1–2)
      const tEvery = BOSS.tide.every[b.phase - 1];
      if (tEvery > 0) { b.tideT -= dt; if (b.tideT <= 0) { b.tideT = tEvery; b.action = 'tide'; b.actionT = 0; b.mode = 'tide'; b.tideTo = { x: T.x, z: T.z + 3 };
        ctx.emit('boss.tide', { from: { x: b.x, y: b.y, z: b.z }, to: { x: b.tideTo.x, y: 0, z: b.tideTo.z }, width: BOSS.tide.width, windup: BOSS.tide.windup }); } }
    }
    for (let k = 0; k < BOSS.lanterns; k++) if (b.lanterns[k].alive) Object.assign(b.lanterns[k], lanternPos(b, k));

    // whirlpools (phase 2 on): near the Lamplighter on the ground, or on the plaza when he is on the wall
    if (b.phase >= 2) {
      b.whirlT -= dt;
      if (b.whirlT <= 0) {
        b.whirlT = BOSS.whirl.every;
        const onWalk = p.where !== 'ground';
        const wx = onWalk ? ctx.rng.range(-6, 8) : p.x + ctx.rng.range(-3, 3), wz = onWalk ? ctx.rng.range(4, 10) : p.z + ctx.rng.range(-3, 3);
        whirls.push({ x: wx, z: wz, t: BOSS.whirl.seconds, r: BOSS.whirl.r });
        ctx.emit('boss.whirl', { pos: { x: wx, y: groundHeight(wx, wz), z: wz }, r: BOSS.whirl.r, seconds: BOSS.whirl.seconds });
        ctx.op({ kind: FIRE_OP.DOUSE, x: wx, z: wz, r: BOSS.whirl.r * 0.7 });
      }
      // the shamans hex the Lance (fewer with each lantern shot out)
      if (b.shamans > 0) {
        b.hexT -= dt * (b.shamans / BOSS.lanterns);
        if (b.hexT <= 0) {
          b.hexT = BOSS.hex.every;
          const from = { x: b.x, y: b.y + BOSS.height - 1, z: b.z }, dd = Math.hypot(p.x - from.x, p.z - from.z), flight = Math.max(0.6, dd / BOSS.hex.speed);
          st.hexes.push({ id: -1, src: 'boss', fx: from.x, fy: from.y, fz: from.z, tx: p.x + p.vx * flight * 0.6, ty: p.y + 1, tz: p.z + p.vz * flight * 0.6, x: from.x, y: from.y, z: from.z, t: 0, flight });
        }
      }
    }
    // the tide's front running down to the gate (1.5 s), as the fluid's line douse with its push
    if (b.front) {
      const f = b.front; f.t += dt; const d = Math.min(f.L, f.L * f.t / 1.5), cx = f.x + f.ux * d, cz = f.z + f.uz * d;
      ctx.op({ kind: FIRE_OP.DOUSE, x0: cx - f.wx, z0: cz - f.wz, x1: cx + f.wx, z1: cz + f.wz, r: 1.4, vx: f.ux * 6, vz: f.uz * 6 });
      if (f.t >= 1.5) b.front = null;
    }
    // the whirlpools pull goblins and the Lamplighter (on the ground); the fluid gets a swirl op per tick
    const H = st.horde;
    for (const w of whirls) ctx.op({ kind: 'swirl', x: w.x, z: w.z, r: w.r, spin: 9, pull: 2, amount: Math.min(1, w.t, BOSS.whirl.seconds - w.t + 0.01) });
    for (let k = whirls.length - 1; k >= 0; k--) {
      const w = whirls[k]; w.t -= dt;
      if (w.t <= 0) { whirls.splice(k, 1); continue; }
      ctx.horde.hash.query(w.x, w.z, w.r, (i) => {
        const s = H.state[i]; if (s === 0 || s === 4) return false;
        const dx = w.x - H.x[i], dz = w.z - H.z[i], d = Math.hypot(dx, dz) || 1;
        if (d < w.r) { H.pullT[i] = Math.max(H.pullT[i], 0.1); H.pullVX[i] = dx / d * BOSS.whirl.pull; H.pullVZ[i] = dz / d * BOSS.whirl.pull; }
        return false;
      });
      if (p.alive && p.where === 'ground') { const dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz); if (d < w.r && d > 0.3) { p.x += dx / d * BOSS.whirl.pull * 0.6 * dt; p.z += dz / d * BOSS.whirl.pull * 0.6 * dt; } }
    }
    st.whirls = whirls.map((w) => ({ x: w.x, z: w.z, r: w.r, t: w.t }));
  }

  return { update, hurt, rayHit, hitRay, blast, rise, BOSS };
}
