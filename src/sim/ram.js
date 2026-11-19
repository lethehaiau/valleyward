// @ts-check
// VALLEYWARD · the Siege Ram (docs/DESIGN.md §5.6, Night III on): a felled oak trunk with an iron ram's head carried by 8
// goblins (one sprite crew) walks the road to the gate at 1.2 m/s (a war drum every 1.5 s), then swings: 120 gate damage
// every 2.5 s. HP 600 = the crew's (each carrier 75): it slows as carriers fall, and fire on the crew makes it stall
// (they burn: 18 HP/s). Plain objects in `state.rams` (a few a night). Pure JS.
import { ARENA, groundHeight } from '../shared/arena.js';
import { EV } from '../shared/events.js';
import { BURN } from '../shared/fireops.js';

export const RAM = Object.freeze({ hp: 600, crew: 8, speed: 1.2, minSpeed: 0.35, drumEvery: 1.5, swingEvery: 2.5, windup: 0.8, dmg: 120,
  radius: 1.5, height: 2.0, length: 6, burnDps: 18, burnFor: 2.5, gateR: 3.4 });

export function createRams(ctx) {
  let id = 1;
  /** the road from the valley to the gate (ARENA.road reversed, then the gate's mouth) */
  const PATH = [...ARENA.road.points].reverse().map(([x, z]) => ({ x, z }));
  PATH.push({ x: ARENA.gate.target.x + 1, z: ARENA.gate.target.z + 2.2 });

  function spawn() {
    const st = ctx.state, p0 = PATH[0];
    const r = { id: id++, x: p0.x, y: groundHeight(p0.x, p0.z), z: p0.z, yaw: Math.PI, hp: RAM.hp * (ctx.ns?.hp ?? 1), hpMax: RAM.hp * (ctx.ns?.hp ?? 1), crew: RAM.crew,   // (DESIGN §16: the crew grows with the night)
      mode: 'walk', t: 0,
      burn: 0, k: 1, drumT: 0.5, swingT: 1.0, stalled: false };
    st.rams.push(r);
    ctx.emit('ram.spawn', { id: r.id, pos: { x: r.x, y: r.y, z: r.z } });
    st.stats.rams = (st.stats.rams || 0) + 1;
    return r;
  }
  function damage(idx, dmg, source) {
    const st = ctx.state, r = st.rams[idx]; if (!r || r.mode === 'fall') return false;
    r.hp -= dmg;
    const crew = Math.max(0, Math.ceil(r.hp / (r.hpMax / RAM.crew)));
    if (crew < r.crew) { r.crew = crew; ctx.emit('ram.carrier', { id: r.id, crew, pos: { x: r.x, y: r.y, z: r.z } }); }
    if (r.hp <= 0) {
      r.mode = 'fall'; r.t = 0;
      ctx.emit('ram.death', { id: r.id, pos: { x: r.x, y: r.y, z: r.z }, burned: r.burn > 0 || source === 'fire' });
      st.stats.kills++; st.stats.ramKills = (st.stats.ramKills || 0) + 1;
      ctx.lootAt('ram', r.x, r.y, r.z);
      return true;
    }
    return false;
  }
  /** The nearest ram hit by the ray o + d t (|d| = 1) within maxT: a vertical cylinder round the trunk's middle. */
  function rayHit(o, d, maxT) {
    const R = ctx.state.rams; let best = null, bt = maxT;
    for (let k = 0; k < R.length; k++) {
      const r = R[k]; if (r.mode === 'fall') continue;
      const ox = o.x - r.x, oz = o.z - r.z, a = d.x * d.x + d.z * d.z; if (a < 1e-9) continue;
      const b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - RAM.radius * RAM.radius, disc = b * b - 4 * a * c; if (disc < 0) continue;
      const t = Math.max(0, (-b - Math.sqrt(disc)) / (2 * a)), y = o.y + d.y * t;
      if (t < bt && y >= r.y && y <= r.y + RAM.height) { bt = t; best = { t, idx: k }; }
    }
    return best;
  }
  /** Area damage (bombs, barrels, meteors, novas): rams within r of (x, z). */
  function blast(x, z, r, dmg) { const R = ctx.state.rams; for (let k = 0; k < R.length; k++) if (R[k].mode !== 'fall' && Math.hypot(R[k].x - x, R[k].z - z) < r + RAM.radius) damage(k, dmg, 'blast'); }

  function update(dt) {
    const st = ctx.state, cfg = ctx.nightCfg, n = st.night;
    if (cfg?.rams && st.mode === 'play') while ((n.ramsSpawned || 0) < cfg.rams.length && n.clock >= cfg.rams[n.ramsSpawned || 0]) { n.ramsSpawned = (n.ramsSpawned || 0) + 1; spawn(); }
    const R = st.rams, T = ARENA.gate.target, fire = ctx.fire;
    for (let k = R.length - 1; k >= 0; k--) {
      const r = R[k];
      r.t += dt;
      if (r.mode === 'fall') { if (r.t > 4) R.splice(k, 1); continue; }
      // fire on the crew: sampled at three points along the trunk
      const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw);
      let h = 0;
      for (const u of [-0.4, 0, 0.4]) h = Math.max(h, fire.heat(r.x + fx * u * RAM.length, r.z + fz * u * RAM.length));
      if (h >= BURN.threshold) r.burn = RAM.burnFor;
      const stalled = r.burn > 0;
      if (stalled !== r.stalled) { r.stalled = stalled; ctx.emit('ram.stall', { id: r.id, on: stalled }); }
      if (r.burn > 0) { r.burn -= dt; if (damage(k, RAM.burnDps * (ctx.ns?.hp ?? 1) * (ctx.ns?.burn ?? 1) * ctx.mods.fireDmg * dt, 'fire')) continue; }
      const dG = Math.hypot(T.x - r.x, T.z - r.z);
      if (dG < RAM.gateR) {
        // at the gate: swing (windup, then the hit), every 2.5 s; a burning crew drops it
        if (r.mode !== 'swing') { r.mode = 'swing'; r.swingT = RAM.swingEvery - RAM.windup; }
        if (!stalled) {
          const before = r.swingT; r.swingT += dt;
          if (before < RAM.swingEvery - RAM.windup && r.swingT >= RAM.swingEvery - RAM.windup) ctx.emit('ram.swing', { id: r.id, pos: { x: r.x, y: r.y, z: r.z }, windup: RAM.windup });
          if (r.swingT >= RAM.swingEvery) {
            r.swingT = 0;
            const dmg = RAM.dmg * (ctx.ns?.dmg ?? 1) * (0.5 + 0.5 * r.crew / RAM.crew);
            ctx.emit('ram.hit', { id: r.id, pos: { x: T.x, y: 2, z: 0.3 }, dmg: +dmg.toFixed(1) });
            ctx.hurtGate(dmg, { x: T.x, y: 2, z: 0.2 });
            st.stats.ramHits = (st.stats.ramHits || 0) + 1;
          }
        }
        continue;
      }
      if (stalled) { if (r.mode !== 'stall') r.mode = 'stall'; continue; }
      r.mode = 'walk';
      // walk the road toward the gate; slower as the carriers fall
      const tgt = PATH[Math.min(r.k, PATH.length - 1)], dx = tgt.x - r.x, dz = tgt.z - r.z, d = Math.hypot(dx, dz);
      if (d < 1.0 && r.k < PATH.length - 1) r.k++;
      const v = RAM.speed * Math.max(RAM.minSpeed, r.crew / RAM.crew) * dt;
      if (d > 1e-3) { r.x += dx / d * Math.min(v, d); r.z += dz / d * Math.min(v, d); r.yaw = Math.atan2(dx, dz); }
      r.y = groundHeight(r.x, r.z);
      r.drumT -= dt;
      if (r.drumT <= 0) { r.drumT = RAM.drumEvery; ctx.emit('ram.drum', { id: r.id, pos: { x: r.x, y: r.y, z: r.z } }); }
    }
  }

  return { update, spawn, damage, rayHit, blast, RAM };
}
