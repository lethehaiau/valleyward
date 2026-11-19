// @ts-check
// VALLEYWARD · air enemies (docs/DESIGN.md §5.5): the Bat Gremlin, a goblin strapped under a stitched bat-wing glider.
// Night II on: a flock of 3–6 every 25–40 s (at most 12 alive) comes in from the valley at 4–7 m, circles the
// Lamplighter at 10–16 m, and now and then dives at him (a 1.2 s dive, telegraphed by a screech and a shadow at `to`),
// hits for 6 if he is still there, and climbs away; it ignores the gate. HP 10: guns hit it in 3D (`rayHit`), the Ember
// Lance's airborne jet sets it alight (`jetHit`), ground fire only reaches it below 2.5 m; a burning one crashes (a small
// burst where it lands). Plain objects in `state.air` (≤ 12: no typed arrays needed). Pure JS, seeded RNG.
import { ARENA, groundHeight } from '../shared/arena.js';
import { EV } from '../shared/events.js';
import { FIRE_OP, BURN, HUE_OF } from '../shared/fireops.js';

export const AIR = Object.freeze({
  hp: 10, radius: 0.7, alt: [4, 7], circleR: [10, 16], speed: 9, turn: 2.2, max: 12, flock: [3, 6], every: [25, 40], firstAt: 25,
  diveEvery: [3.5, 7], dive: 1.2, climb: 1.8, hitR: 1.4, dmg: 6, fireBelow: 2.5, crashR: 1.4, gravity: 12, diveRange: 22,
});

export function createAir(ctx) {
  let nextFlock = AIR.firstAt, id = 1;
  const r = () => ctx.rng;

  function spawnFlock() {
    const st = ctx.state, alive = st.air.length, swarm = ctx.nightCfg?.air === 'swarm' ? 2 : 1;   // DESIGN §8 Night VI: flocks ×2
    const n = Math.min(AIR.max * swarm - alive, (AIR.flock[0] + r().int(AIR.flock[1] - AIR.flock[0] + 1)) * swarm);
    if (n <= 0) return;
    const S = ARENA.spawns.south, cx = r().range(S.x0 + 10, S.x1 - 10), cz = r().range(S.z0, S.z1);
    for (let k = 0; k < n; k++) {
      const x = cx + r().range(-4, 4), z = cz + r().range(-4, 4), alt = r().range(AIR.alt[0], AIR.alt[1]);
      st.air.push({ id: id++, x, y: groundHeight(x, z) + alt, z, vx: 0, vy: 0, vz: -AIR.speed, yaw: Math.PI, hp: AIR.hp * (ctx.ns?.hp ?? 1), mode: 'circle', t: 0,
        burn: 0, alt, ring: r().range(AIR.circleR[0], AIR.circleR[1]), ang: r().range(0, Math.PI * 2), dir: r().next() < 0.5 ? -1 : 1,
        diveT: r().range(AIR.diveEvery[0], AIR.diveEvery[1]) + 4, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, alive: true });
    }
    ctx.emit('air.spawn', { n, pos: { x: cx, y: groundHeight(cx, cz) + 6, z: cz } });
    st.stats.airSpawned = (st.stats.airSpawned || 0) + n;
  }

  function ignite(b) {
    if (b.burn > 0 || !b.alive) return;
    b.burn = BURN.seconds;
    ctx.emit('air.ignite', { id: b.id, pos: { x: b.x, y: b.y, z: b.z } });
    if (b.mode !== 'fall') { b.mode = 'fall'; b.t = 0; }   // a burning glider goes down
  }
  function kill(b, burned) {
    if (!b.alive) return;
    b.alive = false; b.hp = 0;
    const st = ctx.state;
    st.stats.kills++; if (burned) st.stats.burned++;
    st.stats.airKills = (st.stats.airKills || 0) + 1;
    ctx.emit('air.death', { id: b.id, pos: { x: b.x, y: b.y, z: b.z }, burned: !!burned });
    ctx.lootAt('bat', b.x, b.y, b.z);
    if (b.mode !== 'fall') { b.mode = 'fall'; b.t = 0; }
  }
  function damage(idx, dmg, source) {
    const b = ctx.state.air[idx]; if (!b || !b.alive) return false;
    b.hp -= dmg;
    if (b.hp <= 0) { kill(b, b.burn > 0 || source === 'fire'); return true; }
    return false;
  }

  /** The nearest bat hit by the ray o + d t within maxT (|d| = 1): { t, idx } or null. */
  function rayHit(o, d, maxT) {
    const A = ctx.state.air; let best = null, bt = maxT;
    for (let k = 0; k < A.length; k++) {
      const b = A[k]; if (!b.alive) continue;
      const ox = o.x - b.x, oy = o.y - b.y, oz = o.z - b.z, bb = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - AIR.radius * AIR.radius;
      const disc = bb * bb - c; if (disc < 0) continue;
      const t = -bb - Math.sqrt(disc);
      if (t >= 0 && t < bt) { bt = t; best = { t, idx: k }; }
    }
    return best;
  }
  /** The Lance's airborne jet (segment a → b, radius r) sets bats alight. */
  function jetHit(ax, ay, az, bx, by, bz, rad) {
    for (const b of ctx.state.air) {
      if (!b.alive || b.burn > 0) continue;
      const dx = bx - ax, dy = by - ay, dz = bz - az, L2 = dx * dx + dy * dy + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((b.x - ax) * dx + (b.y - ay) * dy + (b.z - az) * dz) / L2));
      if (Math.hypot(b.x - ax - dx * t, b.y - ay - dy * t, b.z - az - dz * t) < rad + AIR.radius) ignite(b);
    }
  }

  function steer(b, tx, ty, tz, speed, dt) {
    const dx = tx - b.x, dy = ty - b.y, dz = tz - b.z, d = Math.hypot(dx, dy, dz) || 1;
    const k = Math.min(1, AIR.turn * dt);
    b.vx += (dx / d * speed - b.vx) * k; b.vy += (dy / d * speed - b.vy) * k; b.vz += (dz / d * speed - b.vz) * k;
  }

  function update(dt) {
    const st = ctx.state, p = st.player, A = st.air;
    if (ctx.nightCfg?.air && st.mode === 'play') {
      if (st.night.clock >= nextFlock) { spawnFlock(); nextFlock = st.night.clock + r().range(AIR.every[0], AIR.every[1]); }
    }
    for (let k = A.length - 1; k >= 0; k--) {
      const b = A[k];
      b.t += dt;
      const g = groundHeight(b.x, b.z);
      if (b.burn > 0) { b.burn -= dt; if (b.alive) { b.hp -= BURN.dps * ctx.mods.fireDmg * dt; if (b.hp <= 0) kill(b, true); } }
      if (b.mode === 'fall') {
        b.vy -= AIR.gravity * dt; b.vx *= 1 - 0.4 * dt; b.vz *= 1 - 0.4 * dt;
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        if (b.y <= groundHeight(b.x, b.z) + 0.2) {
          const y = groundHeight(b.x, b.z);
          ctx.emit('air.crash', { id: b.id, pos: { x: b.x, y, z: b.z }, burned: b.burn > 0 });
          if (b.burn > 0) {
            ctx.op({ kind: FIRE_OP.BURST, x: b.x, z: b.z, r: AIR.crashR, amount: 0.6 * ctx.mods.fireAmount, push: 2, hue: HUE_OF.burning });
            ctx.blast(b.x, y, b.z, AIR.crashR, 4, AIR.crashR, 0);
          }
          if (b.alive) kill(b, b.burn > 0);
          A.splice(k, 1);
        }
        continue;
      }
      if (!b.alive) continue;
      // ground fire reaches it only low (a dive); the Lance's jet is checked in weapons.js (jetHit)
      if (b.y - g < AIR.fireBelow && ctx.fire.heat(b.x, b.z) >= BURN.threshold) { ignite(b); continue; }
      const px = p.x, py = p.y + 1.1, pz = p.z;
      if (b.mode === 'circle') {
        b.ang += b.dir * AIR.speed / b.ring * dt;
        const tx = px + Math.cos(b.ang) * b.ring, tz = pz + Math.sin(b.ang) * b.ring, ty = Math.max(groundHeight(tx, tz), p.y) + b.alt;
        steer(b, tx, ty, tz, AIR.speed, dt);
        b.diveT -= dt;
        if (b.diveT <= 0 && p.alive && st.mode === 'play' && Math.hypot(b.x - px, b.z - pz) < AIR.diveRange) {
          // the dive: a screech and a shadow where the Lamplighter stands now, then 1.2 s straight at it
          b.mode = 'dive'; b.t = 0;
          b.fx = b.x; b.fy = b.y; b.fz = b.z; b.tx = px; b.ty = py; b.tz = pz;
          ctx.emit('air.screech', { id: b.id, pos: { x: b.x, y: b.y, z: b.z }, to: { x: px, y: p.y, z: pz }, windup: AIR.dive });
          ctx.emit('air.dive', { id: b.id, from: { x: b.x, y: b.y, z: b.z }, to: { x: px, y: py, z: pz }, seconds: AIR.dive });
        }
      } else if (b.mode === 'dive') {
        const u = Math.min(1, b.t / AIR.dive), e = u * u * (3 - 2 * u);
        const nx = b.fx + (b.tx - b.fx) * e, ny = b.fy + (b.ty - b.fy) * e - Math.sin(Math.PI * u) * 0.8, nz = b.fz + (b.tz - b.fz) * e;
        b.vx = (nx - b.x) / dt; b.vy = (ny - b.y) / dt; b.vz = (nz - b.z) / dt;
        if (u >= 1) {
          if (p.alive && Math.hypot(px - b.x, py - b.y, pz - b.z) < AIR.hitR) { ctx.emit('air.hit', { id: b.id, pos: { x: b.x, y: b.y, z: b.z } }); ctx.hurtPlayer(AIR.dmg, 'air', { x: Math.sign(b.vx), z: Math.sign(b.vz) }); }
          b.mode = 'climb'; b.t = 0;
        }
      } else if (b.mode === 'climb') {
        const ax = b.x - px, az = b.z - pz, d = Math.hypot(ax, az) || 1;
        steer(b, b.x + ax / d * 8, Math.max(g, p.y) + b.alt + 1, b.z + az / d * 8, AIR.speed * 1.2, dt);
        if (b.t >= AIR.climb) { b.mode = 'circle'; b.t = 0; b.ang = Math.atan2(b.z - pz, b.x - px); b.diveT = r().range(AIR.diveEvery[0], AIR.diveEvery[1]); }
      }
      if (b.mode !== 'dive') { b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; }
      else { b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; }
      b.y = Math.max(b.y, groundHeight(b.x, b.z) + 0.3);
      b.yaw = Math.atan2(b.vx, b.vz);
    }
  }

  return { update, rayHit, jetHit, damage, ignite, AIR };
}
