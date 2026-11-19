// @ts-check
// VALLEYWARD · the Lamplighter's weapons (docs/DESIGN.md §4.1): the Kestrel and the Blunderbuss (hitscan against the
// enemies' cylinders, the troll and the barrels), the Ember Lance (fuel, a ballistic jet out to its range whose
// touch-down emits FIRE_OP.STREAM ops every tick; goblins inside the airborne jet catch fire), firebombs (ballistic,
// burst into BURST + FUEL ops) and the Sunburst ring. Also the barrels and the spears' flight. Pure JS.
import { ARENA, groundHeight, BODY } from '../shared/arena.js';
import { EV, WEAPONS } from '../shared/events.js';
import { FIRE_OP, HUE_OF } from '../shared/fireops.js';
import { WEAPON, ENEMY, BARREL, SPEAR } from './constants.js';
import { ORGAN } from '../shared/meta.js';
/** Weapon slots 1–3 (DESIGN §4.2: the THUNDER ORGAN takes slot 2 from the Blunderbuss once bought and equipped). */
export const slots = (p) => ['pistol', p.unlocked.organ ? 'organ' : 'blunderbuss', 'lance'];
import { raySolids, rayGround, supportHeight, insideSolid } from './world.js';
import { ST } from './horde.js';

const EYE = BODY.player.eye;
const D2R = Math.PI / 180;
/** Seconds a gun click stays pending (a sub-frame click, or one during the cooldown, still fires once). */
export const TRIGGER_BUFFER = 0.25;

/** Aim direction from yaw/pitch (unit vector). */
export function aimDir(yaw, pitch) { const c = Math.cos(pitch); return { x: Math.sin(yaw) * c, y: Math.sin(pitch), z: Math.cos(yaw) * c }; }

/**
 * The Lance's jet from the nozzle: a ballistic polyline until it touches down or reaches its horizontal range (then
 * it rains down where it is). Returns { pts: [x,y,z,…], land: {x,y,z}, hx, hz }.
 */
export function lanceArc(o, d, range) {
  const L = WEAPON.lance, pts = [o.x, o.y, o.z];
  let x = o.x, y = o.y, z = o.z, vx = d.x * L.speed, vy = d.y * L.speed, vz = d.z * L.speed;
  const hm = Math.hypot(d.x, d.z) || 1, hx = d.x / hm, hz = d.z / hm;
  const step = 0.045;
  for (let i = 0; i < 40; i++) {
    const nx = x + vx * step, ny = y + vy * step - 0.5 * L.gravity * step * step, nz = z + vz * step;
    vy -= L.gravity * step;
    const g = supportHeight(nx, nz, ny + 0.3);
    const hd = Math.hypot(nx - o.x, nz - o.z);
    if (ny <= g) {
      const t = (y - supportHeight(x, z, y + 0.3)) / Math.max(1e-4, (y - supportHeight(x, z, y + 0.3)) - (ny - g));
      const lx = x + (nx - x) * t, lz = z + (nz - z) * t;
      pts.push(lx, supportHeight(lx, lz, ny + 0.3), lz);
      return { pts, land: { x: lx, y: supportHeight(lx, lz, ny + 0.3), z: lz }, hx, hz };
    }
    if (hd >= range || insideSolid(nx, ny, nz)) {
      pts.push(nx, ny, nz);
      return { pts, land: { x: nx, y: groundHeight(nx, nz), z: nz }, hx, hz };
    }
    x = nx; y = ny; z = nz;
    pts.push(x, y, z);
  }
  return { pts, land: { x, y: groundHeight(x, z), z }, hx, hz };
}

export function createWeapons(ctx) {
  const H = ctx.state.horde;
  let prevLand = null, lanceOn = false, ringT = -1, ringX = 0, ringZ = 0, ringR = 0, bombId = 1, spearId = 1;

  /** One hitscan ray: enemies (pierce), the troll, barrels; stops at walls and the ground. */
  function ray(o, d, range, dmg, pierce, hitsOut) {
    // DESIGN §4.2: `surf` = what the round struck at its end point ('enemy' | 'ground' | 'stone' | 'wood' | 'air')
    const tS = raySolids(o, d, range), tG = rayGround(o, d, range);
    let maxT = Math.min(tS, tG), surf = tS < tG ? 'stone' : tG < range ? 'ground' : 'air';
    // barrels first (they stop the ray)
    const bar = ARENA.oil.barrels;
    for (let b = 0; b < bar.length; b++) {
      if (!ctx.state.barrels[b].alive) continue;
      const t = cylHit(o, d, bar[b][0], groundHeight(bar[b][0], bar[b][1]), bar[b][1], ARENA.oil.barrelRadius, BARREL.height);
      if (t >= 0 && t < maxT) { maxT = t; surf = 'wood'; ctx.burstBarrel(b); }
    }
    const tr = ctx.state.troll;
    let trollT = -1;
    if (tr && tr.alive) { trollT = cylHit(o, d, tr.x, tr.y, tr.z, BODY.troll.radius, BODY.troll.height); if (trollT >= 0 && trollT < maxT) maxT = trollT; else trollT = -1; }
    // enemies along the ray, nearest first
    const hits = [];
    const hm = Math.hypot(d.x, d.z) || 1e-6, hdx = d.x / hm, hdz = d.z / hm;
    for (let i = 0; i < H.count; i++) {
      const s = H.state[i];
      if (s === ST.DEAD || s === ST.DYING) continue;
      const ex = H.x[i] - o.x, ez = H.z[i] - o.z;
      const along = ex * hdx + ez * hdz;
      if (along < -1 || along > maxT * hm + 1) continue;
      const K = ENEMY[H.kind[i]];
      const t = cylHit(o, d, H.x[i], H.y[i], H.z[i], K.radius + 0.06, K.height);
      if (t >= 0 && t < maxT) hits.push(t, i);
    }
    const order = [];
    for (let k = 0; k < hits.length; k += 2) order.push([hits[k], hits[k + 1]]);
    order.sort((a, b) => a[0] - b[0]);
    let endT = maxT, firstId = null, n = 0;
    for (const [t, i] of order) {
      ctx.horde.damage(i, dmg, 'bullet', { x: hdx, z: hdz });
      if (firstId == null) firstId = i;
      n++;
      if (n > pierce) { endT = t; surf = 'enemy'; break; }
    }
    if (trollT >= 0 && n <= pierce) { ctx.troll.hit(dmg, 'bullet'); endT = trollT; surf = 'enemy'; }
    // DESIGN §5.5: Bat Gremlins in the air (3D spheres), when nothing nearer stopped the ray
    if (ctx.air && n <= pierce) { const a = ctx.air.rayHit(o, d, endT); if (a) { endT = a.t; surf = 'enemy'; ctx.air.damage(a.idx, dmg, 'bullet'); if (firstId == null) firstId = -1 - a.idx; } }
    // DESIGN §8: the Siege Ram's crew and the Rainmother (her lanterns first)
    if (ctx.state.rams.length && n <= pierce) { const r = ctx.rams.rayHit(o, d, endT); if (r) { endT = r.t; surf = 'enemy'; ctx.rams.damage(r.idx, dmg, 'bullet'); if (firstId == null) firstId = -1000 - r.idx; } }
    if (ctx.state.boss && n <= pierce) { const b = ctx.bossSys.rayHit(o, d, endT); if (b) { endT = b.t; surf = 'enemy'; ctx.bossSys.hitRay(b, dmg); if (firstId == null) firstId = b.lantern >= 0 ? -2000 - b.lantern : -3000; } }
    hitsOut.push({ to: { x: o.x + d.x * endT, y: o.y + d.y * endT, z: o.z + d.z * endT }, hitId: firstId, surf });
  }

  function shoot(p, w, inp) {
    const st = ctx.state, mods = ctx.mods, r = ctx.rng;
    const o = { x: p.x, y: p.y + EYE, z: p.z };
    const base = aimDir(p.yaw, p.pitch);
    const pellets = [];
    if (w === 'pistol') {
      const W = WEAPON.pistol, s = W.spreadDeg * D2R;
      const d = jitter(base, r.gauss() * s * 0.5, r.gauss() * s * 0.5);
      ray(o, d, W.range, W.dmg * mods.kestrelDmg, W.pierce, pellets);
    } else {
      const W = WEAPON.blunderbuss, s = W.coneDeg * D2R, n = W.pellets + mods.pellets;
      for (let k = 0; k < n; k++) { const a = r.next() * Math.PI * 2, rr = Math.sqrt(r.next()) * s * 0.5; ray(o, jitter(base, Math.cos(a) * rr, Math.sin(a) * rr), W.range, W.dmg * mods.kestrelDmg, W.pierce, pellets); }
    }
    st.stats.shots++;
    ctx.emit(EV.SHOT, { weapon: w, origin: o, dir: base, pellets });
    void inp;
  }

  function throwBomb(p) {
    const W = WEAPON.bomb, d = aimDir(p.yaw, p.pitch + W.lift);
    const b = { id: bombId++, x: p.x + d.x * 0.5, y: p.y + EYE - 0.15, z: p.z + d.z * 0.5, vx: d.x * W.speed, vy: d.y * W.speed, vz: d.z * W.speed, t: 0 };
    ctx.state.bombs.push(b);
    ctx.emit(EV.BOMB_THROW, { id: b.id, from: { x: b.x, y: b.y, z: b.z }, vel: { x: b.vx, y: b.vy, z: b.vz }, fuse: 4 });
  }
  function burstBomb(b) {
    const W = WEAPON.bomb, m = ctx.mods, r = W.burstR * m.bombRadius;
    ctx.op({ kind: FIRE_OP.BURST, x: b.x, z: b.z, r, amount: 1 * m.fireAmount, push: W.push, hue: HUE_OF.bomb });
    ctx.op({ kind: FIRE_OP.FUEL, x: b.x, z: b.z, r: W.fuelR * m.bombRadius, amount: 0.7 });
    ctx.emit(EV.BOMB_BURST, { id: b.id, pos: { x: b.x, y: b.y, z: b.z }, r });
    ctx.blast(b.x, b.y, b.z, W.blastR * m.bombRadius, W.blastDmg, r * 0.85, 0.6);
  }

  /** DESIGN §4.2, the THUNDER ORGAN: hold to spin up (ORGAN.spinUp s), then ORGAN.rate rounds/s hitscan; a drum, a
   *  reload, heat and an overheat lock. Events for one firing loop (the audio code): 'organ.spin' {on}, 'organ.fire' {}, 'organ.stop'
   *  {reason: 'release' | 'overheat' | 'empty' | 'switch'}, 'organ.overheat' {seconds}; EV.SHOT per tick with rounds. */
  function organ(dt, inp, play) {
    const st = ctx.state, p = st.player, o = p.organ, m = ctx.mods;
    if (!o) return;
    if (o.lockT > 0) { o.lockT = Math.max(0, o.lockT - dt); o.heat = Math.max(ORGAN.ventTo, o.heat - (1 - ORGAN.ventTo) * dt / ORGAN.overheat); }   // DESIGN §4.2: the overheat vents
    if (o.reloadT > 0) { o.reloadT -= dt; if (o.reloadT <= 0) { o.reloadT = 0; o.drum = o.drumMax; } }
    const held = p.weapon === 'organ';
    if (play && held && inp.reload && o.reloadT <= 0 && o.drum < o.drumMax) { o.reloadT = ORGAN.reload; ctx.emit(EV.RELOAD, { weapon: 'organ', seconds: ORGAN.reload }); }
    const want = play && held && (inp.fire || inp.firePress) && p.switchT >= 0.6 && o.reloadT <= 0 && o.lockT <= 0;
    if (want !== o.spinning) { o.spinning = want; ctx.emit('organ.spin', { on: want }); }
    o.spin = want ? Math.min(1, o.spin + dt / ORGAN.spinUp) : Math.max(0, o.spin - dt / 0.6);
    const stop = (reason) => { if (o.firing) { o.firing = false; ctx.emit('organ.stop', { reason }); } o.acc = 0; };
    if (want && o.spin >= 1 && o.drum > 0) {
      if (!o.firing) { o.firing = true; ctx.emit('organ.fire', {}); }
      p.firing = true;
      o.acc += dt * ORGAN.rate * (m.organRate || 1);
      const origin = { x: p.x, y: p.y + EYE, z: p.z }, base = aimDir(p.yaw, p.pitch), s = ORGAN.spreadDeg * D2R, pellets = [];
      while (o.acc >= 1 && o.drum > 0) {
        o.acc -= 1; o.drum--;
        const a = ctx.rng.next() * Math.PI * 2, rr = Math.sqrt(ctx.rng.next()) * s * 0.5;
        ray(origin, jitter(base, Math.cos(a) * rr, Math.sin(a) * rr), ORGAN.range, ORGAN.dmg * (m.organDmg || 1), ORGAN.pierce, pellets);   // (DESIGN §4.2: its own line only; Kestrel damage made it explode later: see CORE.md)
      }
      if (pellets.length) { st.stats.shots++; ctx.emit(EV.SHOT, { weapon: 'organ', origin, dir: base, pellets }); }
      o.heat = Math.min(1, o.heat + dt / ORGAN.heatSeconds);
      if (o.heat >= 1) { o.lockT = ORGAN.overheat; stop('overheat'); ctx.emit('organ.overheat', { seconds: ORGAN.overheat }); }
      else if (o.drum <= 0) { stop('empty'); o.reloadT = ORGAN.reload; ctx.emit(EV.RELOAD, { weapon: 'organ', seconds: ORGAN.reload }); }
    } else {
      stop(!held ? 'switch' : 'release');
      if (o.lockT <= 0) o.heat = Math.max(0, o.heat - ORGAN.cool * dt);
      if (play && held && inp.firePress && (o.drum <= 0 || o.lockT > 0)) ctx.emit(EV.DRY, { weapon: 'organ' });
    }
  }

  function update(dt, inp) {
    const st = ctx.state, p = st.player, mods = ctx.mods;
    // the kindle glance holds every weapon for a second; moving, looking and E stay live
    if (p.holdFireT > 0) p.holdFireT = Math.max(0, p.holdFireT - dt);
    const play = st.mode === 'play' && p.alive && !(p.holdFireT > 0);
    p.cool = Math.max(0, p.cool - dt);
    p.switchT = Math.min(1, p.switchT + dt / 0.35);
    // weapon switch (1/2/3, wheel)
    if (play) {
      let want = null;
      const S = slots(p);
      if (inp.weapon >= 1 && inp.weapon <= 3) want = S[inp.weapon - 1];
      else if (inp.wheel) { const order = S.filter((w) => p.unlocked[w]); const k = order.indexOf(p.weapon); want = order[(k + (inp.wheel > 0 ? 1 : order.length - 1)) % order.length]; }
      if (want && want !== p.weapon && p.unlocked[want]) { p.weapon = want; p.switchT = 0; p.reloadT = 0; p.cool = Math.max(p.cool, 0.2); ctx.emit(EV.WEAPON_SWITCH, { weapon: want }); }
    }
    if (p.weapon === 'blunderbuss' && p.unlocked.organ) p.weapon = 'organ';   // (the organ replaced it)
    if (p.weapon === 'organ' && !p.unlocked.organ) p.weapon = 'pistol';
    // reloads
    if (p.reloadT > 0) { p.reloadT -= dt; if (p.reloadT <= 0) { p.reloadT = 0; if (p.weapon === 'pistol') p.ammo.pistol = WEAPON.pistol.mag; if (p.weapon === 'blunderbuss') p.ammo.blunderbuss = WEAPON.blunderbuss.mag; } }
    const gun = p.weapon === 'pistol' || p.weapon === 'blunderbuss';
    if (play && gun && inp.reload && p.reloadT <= 0 && p.ammo[p.weapon] < WEAPON[p.weapon].mag) { p.reloadT = WEAPON[p.weapon].reload; ctx.emit(EV.RELOAD, { weapon: p.weapon, seconds: p.reloadT }); }
    p.firing = false;
    // a click is buffered for TRIGGER_BUFFER s: a press and release inside one frame, or a click during the
    // cooldown or the switch, still fires once; holding the trigger auto-fires as before
    p.trigBuf = inp.firePress ? TRIGGER_BUFFER : Math.max(0, (p.trigBuf || 0) - dt);
    if (play && gun && (inp.fire || p.trigBuf > 0) && p.switchT >= 0.6) {
      if (p.reloadT <= 0 && p.ammo[p.weapon] <= 0) { p.reloadT = WEAPON[p.weapon].reload; ctx.emit(EV.RELOAD, { weapon: p.weapon, seconds: p.reloadT }); }
      if (p.reloadT > 0 || p.ammo[p.weapon] <= 0) { if (inp.firePress) ctx.emit(EV.DRY, { weapon: p.weapon }); }
      else if (p.cool <= 0) {
        const W = WEAPON[p.weapon];
        shoot(p, p.weapon, inp);
        p.ammo[p.weapon]--; p.firing = true; p.trigBuf = 0;
        p.cool = 1 / (W.rate * (p.weapon === 'pistol' ? mods.kestrelRate : 1));
        if (p.ammo[p.weapon] <= 0) { p.reloadT = W.reload; ctx.emit(EV.RELOAD, { weapon: p.weapon, seconds: W.reload }); }
      }
    }

    organ(dt, inp, play);   // DESIGN §4.2
    // the Ember Lance
    const L = WEAPON.lance;
    // a Hexer's hex makes the Lance sputter (DESIGN §5.4): no spray for ELITE.hexer.sputter s
    if (p.sputterT > 0) p.sputterT = Math.max(0, p.sputterT - dt);
    const sputter = p.sputterT > 0;
    const spraying = play && p.weapon === 'lance' && (inp.fire || inp.firePress) && p.fuel > 0 && p.switchT >= 0.5 && !sputter;
    const jet = p.jet;
    if (spraying) {
      p.fuel = Math.max(0, p.fuel - L.burn * dt); p.lanceIdle = 0; p.firing = true;
      const d = aimDir(p.yaw, p.pitch), fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      const o = { x: p.x + fx * 0.55 - fz * 0.22, y: p.y + EYE - L.nozzleDrop, z: p.z + fz * 0.55 + fx * 0.22 };
      const range = L.range * mods.lanceRange * (1 - 0.2 * (st.weather?.rain || 0));   // DESIGN §8.3: rain shortens the jet
      const arc = lanceArc(o, d, range);
      Object.assign(jet, { on: true, ox: o.x, oy: o.y, oz: o.z, dx: d.x, dy: d.y, dz: d.z, lx: arc.land.x, ly: arc.land.y, lz: arc.land.z, range, t: jet.t + dt });
      if (!lanceOn) { lanceOn = true; ctx.emit(EV.LANCE_ON, { origin: o, dir: d }); }
      const lx = arc.land.x, lz = arc.land.z, amt = mods.fireAmount, hue = mods.lanceHue || HUE_OF.lance;   // Witchfire Wick: green
      jet.hue = hue;
      ctx.op({ kind: FIRE_OP.STREAM, x0: lx, z0: lz, x1: lx + arc.hx * L.streamLen, z1: lz + arc.hz * L.streamLen, vx: arc.hx * L.streamPush, vz: arc.hz * L.streamPush, amount: amt, radius: L.streamRadius, hue });
      if (prevLand) { const g = Math.hypot(lx - prevLand.x, lz - prevLand.z); if (g > 0.4 && g < 5) ctx.op({ kind: FIRE_OP.STREAM, x0: prevLand.x, z0: prevLand.z, x1: lx, z1: lz, vx: arc.hx * L.streamPush * 0.5, vz: arc.hz * L.streamPush * 0.5, amount: amt * 0.8, radius: L.streamRadius, hue }); }
      prevLand = { x: lx, z: lz };
      // goblins inside the airborne jet catch fire; the troll heats
      const P = arc.pts;
      for (let k = 0; k + 5 < P.length; k += 3) {
        const ax = P[k], ay = P[k + 1], az = P[k + 2], bx = P[k + 3], by = P[k + 4], bz = P[k + 5];
        const mx = (ax + bx) / 2, mz = (az + bz) / 2, half = Math.hypot(bx - ax, bz - az) / 2 + L.jetRadius + 0.6;
        ctx.horde.hash.query(mx, mz, half, (i) => {
          const s = H.state[i]; if (s === ST.DEAD || s === ST.DYING || H.burn[i] > 0) return false;
          const K = ENEMY[H.kind[i]];
          const dd = segDist(H.x[i], H.y[i] + K.height * 0.5, H.z[i], ax, ay, az, bx, by, bz);
          if (dd < L.jetRadius + K.radius + K.height * 0.35) ctx.horde.ignite(i);
          return false;
        });
        const tr = st.troll;
        if (tr && tr.alive && Math.hypot(mx - tr.x, mz - tr.z) < BODY.troll.radius + 0.8 && (ay + by) / 2 < tr.y + BODY.troll.height) ctx.troll.heatUp(0.9 * dt, 'jet');
        if (ctx.air && st.air.length) ctx.air.jetHit(ax, ay, az, bx, by, bz, L.jetRadius);   // DESIGN §5.5: the airborne jet lights Bat Gremlins
      }
    } else {
      if (lanceOn) { lanceOn = false; ctx.emit(EV.LANCE_OFF, {}); }
      jet.on = false; prevLand = null;
      if (play && p.weapon === 'lance' && inp.firePress && (p.fuel <= 0 || sputter)) ctx.emit(EV.DRY, { weapon: 'lance', sputter });
      p.lanceIdle += dt;
      if (p.lanceIdle >= L.regenDelay) {
        let near = false;
        if (p.where === 'ground') for (const [bx, bz] of ARENA.braziers) if (Math.hypot(p.x - bx, p.z - bz) < L.brazierR) near = true;
        p.fuel = Math.min(p.fuelMax, p.fuel + L.regen * (near ? L.brazierMul : 1) * (mods.lanceRefill || 1) * dt);
      }
    }

    // firebombs
    const BW = WEAPON.bomb;
    if (p.bombs < p.bombsMax) { p.bombT += dt; if (p.bombT >= BW.recharge) { p.bombT = 0; p.bombs++; } } else p.bombT = 0;
    if (play && inp.bomb && p.bombs > 0) { p.bombs--; throwBomb(p); }
    for (let k = st.bombs.length - 1; k >= 0; k--) {
      const b = st.bombs[k];
      b.t += dt; b.vy -= BW.gravity * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      let hit = b.t > 4 || b.y <= supportHeight(b.x, b.z, b.y + 0.2) || insideSolid(b.x, b.y, b.z);
      if (!hit) ctx.horde.hash.query(b.x, b.z, 0.8, (i) => { const s = H.state[i]; if (s !== ST.DEAD && s !== ST.DYING && Math.hypot(H.x[i] - b.x, H.z[i] - b.z) < ENEMY[H.kind[i]].radius + 0.25 && b.y < H.y[i] + ENEMY[H.kind[i]].height + 0.2) { hit = true; return true; } return false; });
      const tr = st.troll;
      if (!hit && tr && tr.alive && Math.hypot(b.x - tr.x, b.z - tr.z) < BODY.troll.radius + 0.2 && b.y < tr.y + BODY.troll.height) hit = true;
      if (hit) { b.y = Math.max(b.y, groundHeight(b.x, b.z)); st.bombs.splice(k, 1); burstBomb(b); }
    }

    // the Sunburst
    if (play && inp.ult && p.sunburst >= 1 && ringT < 0) {
      p.sunburst = 0; ringT = 0; ringX = p.x; ringZ = p.z; ringR = 0;
      ctx.emit(EV.SUNBURST, { pos: { x: p.x, y: p.y, z: p.z }, r: WEAPON.sunburst.radius });
    }
    if (ringT >= 0) {
      const SB = WEAPON.sunburst;
      ringT += dt;
      const R1 = Math.min(SB.radius, SB.radius * ringT / SB.seconds), R0 = ringR;
      const n = Math.min(24, Math.max(6, Math.ceil(2 * Math.PI * R1 / 2.6)));
      for (let k = 0; k < n; k++) { const a = (k + ringT * 3) / n * Math.PI * 2; ctx.op({ kind: FIRE_OP.BURST, x: ringX + Math.cos(a) * R1, z: ringZ + Math.sin(a) * R1, r: 1.6, amount: 0.9 * ctx.mods.fireAmount, push: 5, hue: HUE_OF.sunburst }); }
      ctx.horde.hash.query(ringX, ringZ, R1 + 0.5, (i) => {
        const s = H.state[i]; if (s === ST.DEAD || s === ST.DYING) return false;
        const d = Math.hypot(H.x[i] - ringX, H.z[i] - ringZ);
        if (d >= R0 - 0.3 && d <= R1 + 0.3) { ctx.horde.ignite(i); ctx.horde.damage(i, SB.dmg, 'blast', null); }
        return false;
      });
      const tr = st.troll;
      if (tr && tr.alive) { const d = Math.hypot(tr.x - ringX, tr.z - ringZ); if (d >= R0 - BODY.troll.radius && d <= R1 + BODY.troll.radius) ctx.troll.heatUp(0.5, 'ring'); }
      ringR = R1;
      if (ringT >= SB.seconds) ringT = -1;
    }

    // spears in flight
    for (let k = st.spears.length - 1; k >= 0; k--) {
      const s = st.spears[k];
      s.t += dt; s.vy -= 9.8 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      const dxp = s.x - p.x, dzp = s.z - p.z, dy = s.y - (p.y + 0.9);
      if (p.alive && Math.hypot(dxp, dzp) < SPEAR.hitR && Math.abs(dy) < 1.0) {
        st.spears.splice(k, 1); ctx.emit(EV.SPEAR_HIT, { id: s.id, pos: { x: s.x, y: s.y, z: s.z }, target: 'player' });
        ctx.hurtPlayer(SPEAR.dmg, 'spear', { x: s.vx / Math.hypot(s.vx, s.vz), z: s.vz / Math.hypot(s.vx, s.vz) });
        continue;
      }
      if (s.t > 3 || s.y <= supportHeight(s.x, s.z, s.y + 0.3) || insideSolid(s.x, s.y, s.z)) {
        st.spears.splice(k, 1); ctx.emit(EV.SPEAR_HIT, { id: s.id, pos: { x: s.x, y: Math.max(s.y, groundHeight(s.x, s.z)), z: s.z }, target: 'ground' });
      }
    }
  }

  /** A spear-chucker throws at the player's chest (a ballistic low arc at SPEAR.speed). */
  function throwSpear(i) {
    const p = ctx.state.player;
    const from = { x: H.x[i], y: H.y[i] + 1.4, z: H.z[i] };
    // lead the target by the spear's flight time (the player's HP at stake on the wall; a change of
    // direction still dodges it, standing still does not)
    const lead = SPEAR.lead * Math.hypot(p.x - from.x, p.z - from.z) / SPEAR.speed;
    const e = SPEAR.aimError, tx = p.x + p.vx * lead + ctx.rng.range(-e, e), tz = p.z + p.vz * lead + ctx.rng.range(-e, e), ty = p.y + 1.0;
    const dx = tx - from.x, dz = tz - from.z, dh = Math.hypot(dx, dz) || 1, dy = ty - from.y;
    const v = SPEAR.speed, g = 9.8, v2 = v * v, disc = v2 * v2 - g * (g * dh * dh + 2 * dy * v2);
    const ang = disc >= 0 ? Math.atan((v2 - Math.sqrt(disc)) / (g * dh)) : Math.atan2(dy, dh) + 0.25;
    const s = { id: spearId++, x: from.x, y: from.y, z: from.z, vx: dx / dh * v * Math.cos(ang), vy: v * Math.sin(ang), vz: dz / dh * v * Math.cos(ang), t: 0, from: H.kind[i] };
    ctx.state.spears.push(s);
    ctx.emit(EV.SPEAR_THROW, { id: s.id, from, vel: { x: s.vx, y: s.vy, z: s.vz } });
  }

  return {
    update, throwSpear, burstBomb,
    reset() { prevLand = null; lanceOn = false; ringT = -1; },
    get ring() { return ringT >= 0 ? { x: ringX, z: ringZ, r: ringR } : null; },
  };
}

function jitter(d, a, b) {
  // rotate the direction by small angles a (yaw) and b (pitch)
  const yaw = Math.atan2(d.x, d.z) + a, pitch = Math.asin(Math.max(-1, Math.min(1, d.y))) + b;
  return aimDir(yaw, pitch);
}

/** Ray o + d t (|d| = 1) against a vertical cylinder at (cx, cz), radius r, from y0 to y0 + h. t ≥ 0 or −1. */
export function cylHit(o, d, cx, y0, cz, r, h) {
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) { if (ox * ox + oz * oz > r * r) return -1; const t = (d.y < 0 ? (y0 + h - o.y) : (y0 - o.y)) / d.y; return t >= 0 ? t : -1; }
  const b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r, disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  if (t2 < 0) return -1;
  if (t < 0) t = 0;
  const y = o.y + d.y * t;
  if (y >= y0 && y <= y0 + h) return t;
  // enter through the top or bottom cap within the side span
  const tc = d.y !== 0 ? ((d.y < 0 ? y0 + h : y0) - o.y) / d.y : -1;
  if (tc >= t && tc <= t2) return tc;
  return -1;
}
function segDist(px, py, pz, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, L2 = dx * dx + dy * dy + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / L2));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t, pz - az - dz * t);
}
