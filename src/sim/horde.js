// @ts-check
// VALLEYWARD · the horde in typed arrays (docs/DESIGN.md §5, §14.4): spawning on the night curve, the flow field toward
// the gate, spatial-hash separation, the mound at the gate, chasing the player within 6 m, spear-chuckers, brutes,
// burning from the fire provider (DoT, panic, ember ops), deaths and drops. Slots are stable ids: a dead slot
// (state 0) is reused by a later spawn; iterate i < horde.count and skip state 0. Pure JS.
import { ARENA, groundHeight } from '../shared/arena.js';
import { EV, ENEMY_KINDS } from '../shared/events.js';
import { FIRE_OP, FIRE_CAPS, BURN, HUE_OF } from '../shared/fireops.js';
import { DROPS } from '../shared/meta.js';
import { ENEMY, HORDE, NIGHT, SPEAR, ELITE, K as KI } from './constants.js';
import { flowDir, isBlocked, createSpatialHash, GRID, groundFast } from './world.js';
import { reachable } from './player.js';

export const ST = Object.freeze({ DEAD: 0, WALK: 1, ATTACK: 2, FLEE: 3, DYING: 4 });
/** XP per kill by kind (ENEMY_KINDS order), from meta.js DROPS (DESIGN §9.3). */
export const KILL_XP = Object.freeze(ENEMY_KINDS.map((k) => DROPS[k].xp));
const NK = ENEMY.length;
const KRAD = Float32Array.from(ENEMY.map((k) => k.radius));
const SEP_MAX = 0.12;   // m per tick
const LOD = true, LOD_R2 = 34 * 34, LOD_G2 = 26 * 26;   // DESIGN §15.4: far = > 34 m from the player and > 26 m from the gate
const BURNING_GATE_MUL = 0.5;   // gate damage ×0.5 while the attacker burns (all kinds)
const PILE_CLEAR = 3, PILE_FADE = 3;   // the mound is flat within 3 m of a player on the ground, full height from 6 m
const EMBER_CELL = 2, EMBER_CELL_EVERY = 0.3;   // one ember per 2 m cell per 0.3 s from burning goblins

export function newHorde(cap) {
  return {
    count: 0, alive: 0, cap,
    x: new Float32Array(cap), y: new Float32Array(cap), z: new Float32Array(cap), vx: new Float32Array(cap), vz: new Float32Array(cap),
    kind: new Uint8Array(cap), hp: new Float32Array(cap), burn: new Float32Array(cap), anim: new Float32Array(cap),
    state: new Uint8Array(cap), dyingT: new Float32Array(cap),
    // sim extras (read-only for the other modules): attack timer, ember timer, oil-soaked flag, pile height, target 0 gate 1 player 2 spear stand
    atkT: new Float32Array(cap), emberT: new Float32Array(cap), soak: new Uint8Array(cap), pile: new Float32Array(cap), target: new Uint8Array(cap),
    burned: new Uint8Array(cap),
    // DESIGN §9: the Chain Imp's slow (seconds left, speed factor) and pull (seconds left, velocity m/s)
    panX: new Float32Array(cap), panZ: new Float32Array(cap),   // the held heat gradient of a burning goblin (DESIGN §15.4)
    slowT: new Float32Array(cap), slowK: new Float32Array(cap), pullT: new Float32Array(cap), pullVX: new Float32Array(cap), pullVZ: new Float32Array(cap),
    free: /** @type {number[]} */ ([]),
    nearGate: 0, gateAttackers: 0,
  };
}

/** The spawn rate (per second) at clock c (seconds into the night). */
export function spawnRate(c) {
  const N = NIGHT;
  if (c < N.gentle) return N.gentleRate;
  if (c >= N.peakAt) return N.peakRate;
  return N.baseRate + (N.peakRate - N.baseRate) * (c - N.gentle) / (N.peakAt - N.gentle);
}
function mixAt(mix, c) { let w = mix[0].w; for (const m of mix) if (c >= m.at) w = m.w; return w; }

export function createHordeSystem(ctx) {
  const H = ctx.state.horde;
  const hash = createSpatialHash(H.cap);
  let spawnAcc = 0, spearTokens = 1;
  // ember cells: the last sim time each EMBER_CELL m cell over GRID got an ember from a burning goblin
  const ECW = Math.ceil(GRID.w / EMBER_CELL), ECH = Math.ceil(GRID.h / EMBER_CELL), emberCellT = new Float32Array(ECW * ECH).fill(-1e9);
  const emberCell = (x, z) => { const i = Math.floor((x - GRID.x0) / EMBER_CELL), j = Math.floor((z - GRID.z0) / EMBER_CELL); return i < 0 || j < 0 || i >= ECW || j >= ECH ? -1 : j * ECW + i; };
  const caps = { ignite: 0, death: 0, hit: 0, attack: 0, ember: 0 };

  function spawn(kindIdx, x, z) {
    if (H.alive >= H.cap) return -1;
    const i = H.free.length ? /** @type {number} */ (H.free.pop()) : H.count++;
    if (i >= H.cap) { H.count = H.cap; return -1; }
    const K = ENEMY[kindIdx];
    H.x[i] = x; H.z[i] = z; H.y[i] = groundHeight(x, z); H.vx[i] = 0; H.vz[i] = 0; H.kind[i] = kindIdx; H.hp[i] = K.hp * (ctx.ns?.hp ?? 1);   // DESIGN §5.7: HP grows with the night
    H.burn[i] = 0; H.anim[i] = ctx.rng.next(); H.state[i] = ST.WALK; H.dyingT[i] = 0; H.atkT[i] = ctx.rng.range(0, K.meleeEvery);
    H.emberT[i] = 0; H.soak[i] = 0; H.pile[i] = 0; H.target[i] = 0; H.burned[i] = 0;
    H.slowT[i] = 0; H.slowK[i] = 1; H.pullT[i] = 0; H.pullVX[i] = 0; H.pullVZ[i] = 0;
    if (kindIdx === KI.hexer) H.atkT[i] = ELITE.hexer.every * 0.5; else if (kindIdx === KI.douser) H.atkT[i] = ELITE.douser.every * 0.5;
    H.alive++;
    return i;
  }
  function spawnPoint() {
    const r = ctx.rng, S = ARENA.spawns;
    for (let tries = 0; tries < 8; tries++) {
      const south = r.next() < NIGHT.southShare, b = south ? S.south : S.east;
      const x = r.range(b.x0, b.x1), z = r.range(b.z0, b.z1);
      if (!isBlocked(x, z)) return [x, z];
    }
    return [29, 80];
  }
  /** Spawn n of a kind (debug hook / tests); near (x, z) when given, else at the spawn edges. */
  function spawnMany(kindIdx, n, x, z) {
    let first = -1, made = 0;
    for (let k = 0; k < n; k++) {
      const [sx, sz] = x != null ? [x + ctx.rng.range(-2, 2), z + ctx.rng.range(-2, 2)] : spawnPoint();
      const i = spawn(kindIdx, sx, sz);
      if (i < 0) break;
      if (first < 0) first = i; made++;
    }
    if (made) ctx.emit(EV.E_SPAWN, { id: first, kind: ENEMY_KINDS[kindIdx], count: made, pos: { x: H.x[first], y: H.y[first], z: H.z[first] } });
    return made;
  }

  /** source: the killing blow ('fire' DoT, 'bullet', 'blast'); stats.killedBy counts them (balance: fire's share of kills). */
  function kill(i, burned, source = burned ? 'fire' : 'blast') {
    const st = ctx.state, K = ENEMY[H.kind[i]];
    H.state[i] = ST.DYING; H.dyingT[i] = 0; H.hp[i] = 0; H.burned[i] = burned ? 1 : 0;
    st.stats.kills++; if (burned) st.stats.burned++;
    const kb = st.stats.killedBy || (st.stats.killedBy = { fire: 0, bullet: 0, blast: 0 }); kb[source] = (kb[source] || 0) + 1;
    const kk = st.stats.killedKind || (st.stats.killedKind = [0, 0, 0, 0]); kk[H.kind[i]] = (kk[H.kind[i]] || 0) + 1;
    st.player.sunburst = Math.min(1, st.player.sunburst + ctx.mods.sunburstRate / 150);
    if (caps.death++ < HORDE.eventCap) ctx.emit(EV.E_DEATH, { id: i, kind: K.kind, pos: { x: H.x[i], y: H.y[i], z: H.z[i] }, burned: !!burned });
    // DESIGN §9.3: an XP gem always, gold by chance (meta.js DROPS), a charm from elites; they spill and fly to the
    // Lamplighter after DROP_FLY_AFTER s (ctx.loot in sim.js); Soul Feast may add a heart
    ctx.loot(H.kind[i], H.x[i], H.y[i], H.z[i]);
    if (burned && ctx.mods.pyre) ctx.pyre(H.x[i], H.z[i]);   // DESIGN §10.4: Pyre Burst
    if (H.kind[i] === KI.chief || H.kind[i] === KI.hexer) ctx.eliteDied(i);
  }

  /** Damage enemy i. source 'bullet' | 'fire' | 'blast'. dir: the shot's horizontal direction (brute fronts). */
  function damage(i, dmg, source, dir) {
    if (H.state[i] === ST.DEAD || H.state[i] === ST.DYING) return false;
    let d = dmg;
    if (source === 'bullet' && H.kind[i] === 3 && dir) {
      const vx = H.vx[i], vz = H.vz[i], m = Math.hypot(vx, vz);
      if (m > 0.1 && (dir.x * vx + dir.z * vz) / m < -0.3) d *= 0.25;   // the door shield faces where it walks
    }
    if (source === 'bullet' && ctx.mods.pitch) H.soak[i] = 1;
    H.hp[i] -= d;
    if (source !== 'fire' && caps.hit++ < HORDE.eventCap) ctx.emit(EV.E_HIT, { id: i, kind: ENEMY_KINDS[H.kind[i]], pos: { x: H.x[i], y: H.y[i] + 0.6, z: H.z[i] }, dmg: d, source, crit: false });
    if (H.hp[i] <= 0) { kill(i, H.burn[i] > 0 || source === 'fire', source); return true; }
    return false;
  }
  function ignite(i) {
    if (H.state[i] === ST.DEAD || H.state[i] === ST.DYING) return;
    if (H.burn[i] <= 0 && caps.ignite++ < HORDE.eventCap) ctx.emit(EV.E_IGNITE, { id: i, kind: ENEMY_KINDS[H.kind[i]], pos: { x: H.x[i], y: H.y[i], z: H.z[i] } });
    H.burn[i] = Math.max(H.burn[i], BURN.seconds * ctx.mods.burnSeconds);
  }

  function update(dt, opts) {
    const st = ctx.state, p = st.player, fire = ctx.fire;
    for (const k in caps) caps[k] = 0;
    spearTokens = Math.min(2, spearTokens + SPEAR.perSecond * (ctx.nightCfg?.spearMul ?? 1) * dt);   // a global budget: a volley, never a hail (Night V ×2)
    // spawning
    if (opts.spawn) {
      const rate = spawnRate(st.night.clock) * (st.night.kindleT > 0 ? NIGHT.kindleMul : 1) * (st.night.clock >= NIGHT.dawnAt ? 0.6 : 1) * ctx.spawnScale * (ctx.nightCfg?.spawnMul ?? 1);
      spawnAcc += rate * dt;
      const w = mixAt(ctx.nightMix || NIGHT.mix, st.night.clock), made = new Array(NK).fill(0), first = new Array(NK).fill(-1);
      while (spawnAcc >= 1) {
        spawnAcc -= 1;
        if (H.alive >= H.cap) { spawnAcc = 0; break; }
        let u = ctx.rng.next(), kind = 0;
        for (let k = 0; k < w.length; k++) { if (u < w[k]) { kind = k; break; } u -= w[k]; }
        const [x, z] = spawnPoint();
        const i = spawn(kind, x, z);
        if (i >= 0) { made[kind]++; if (first[kind] < 0) first[kind] = i; }
      }
      for (let k = 0; k < NK; k++) if (made[k]) ctx.emit(EV.E_SPAWN, { id: first[k], kind: ENEMY_KINDS[k], count: made[k], pos: { x: H.x[first[k]], y: H.y[first[k]], z: H.z[first[k]] } });
    }

    hash.build(H.count, H.x, H.z, H.state);
    const T = ARENA.gate.target, canReach = reachable(p), fleeing = opts.flee;
    let nearGate = 0, attackers = 0, gateDmg = 0;
    const pileH = Math.min(1, Math.max(0, (H.nearGate - 12) / 90)) * 3.2;
    const contagion = ctx.mods.contagion ? 0.5 : 1;
    // the mound never forms on the Lamplighter (goblins once stacked on the player: the spawn (3, 5) is 4.8 m
    // from the gate, so goblins chasing a player on the plaza were lifted into a tower of sprites in front of the lens):
    // only goblins pressing on the gate pile up, and their height fades to 0 within PILE_CLEAR m of a player on the ground
    const pGround = p.alive && p.y - groundHeight(p.x, p.z) < 2;
    // the Chieftains' rally (DESIGN §5.4): goblins within ELITE.chief.rallyR of a living chief move +20 %
    const chiefs = [];
    for (const e of st.elites) if (e.kind === 'chief' && H.state[e.id] !== ST.DEAD && H.state[e.id] !== ST.DYING) chiefs.push(H.x[e.id], H.z[e.id]);
    const RR = ELITE.chief.rallyR * ELITE.chief.rallyR;

    for (let i = 0; i < H.count; i++) {
      const s = H.state[i];
      if (s === ST.DEAD) continue;
      if (s === ST.DYING) { H.dyingT[i] += dt; if (H.dyingT[i] >= HORDE.dyingSeconds) { H.state[i] = ST.DEAD; H.alive--; H.free.push(i); } continue; }
      const K = ENEMY[H.kind[i]];
      const x = H.x[i], z = H.z[i];
      // DESIGN §15.4 LOD: a goblin far from the Lamplighter and the gate (the valley, the lower road) steps every other
      // tick with twice the dt (by slot parity: half the walkers each tick); near ones every tick
      let dtI = dt;
      if (LOD && (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) > LOD_R2 && (x - T.x) * (x - T.x) + (z - T.z) * (z - T.z) > LOD_G2 && !fleeing) {
        if (((i + st.tick) & 1) === 1) continue;
        dtI = dt * 2;
      }

      // burning (read from the fire provider)
      const heat = fire.heat(x, z);
      if (heat >= BURN.threshold) ignite(i);
      let burning = H.burn[i] > 0;
      if (burning) {
        H.burn[i] -= dtI;
        H.hp[i] -= BURN.dps * K.burnMul * (ctx.ns?.burn ?? 1) * (H.soak[i] ? 2 : 1) * ctx.mods.fireDmg * dtI;
        H.emberT[i] -= dtI;
        if (H.emberT[i] <= 0) {
          H.emberT[i] = BURN.emberEvery * contagion;
          // at most one ember per EMBER_CELL m cell per EMBER_CELL_EVERY s: a dense burning pile no longer
          // drops an ember per goblin, so contagion cannot sweep the whole mound in seconds and the gate pile can form
          const ci = emberCell(x, z), now = ctx.state.t;
          if (caps.ember < FIRE_CAPS.ember && (ci < 0 || now - emberCellT[ci] >= EMBER_CELL_EVERY)) {
            if (ci >= 0) emberCellT[ci] = now;
            caps.ember++; ctx.op({ kind: FIRE_OP.EMBER, x, z, amount: 0.8 * ctx.mods.fireAmount, hue: HUE_OF.burning });
          }
        }
        if (H.hp[i] <= 0) { kill(i, true, 'fire'); continue; }
      }

      // where to go
      const dxg = T.x - x, dzg = T.z - z, dg = Math.hypot(dxg, dzg);
      const dxp = p.x - x, dzp = p.z - z, dp = Math.hypot(dxp, dzp);
      let dx = 0, dz = 0, speed = K.speed * (ctx.ns?.speed ?? 1), stop = false;
      H.anim[i] += dtI * (1 + K.speed * 0.5);
      if (fleeing) {
        const f = flowDir(x, z); dx = -f.x; dz = -f.z; speed *= 1.5; H.state[i] = ST.FLEE;
      } else if (H.kind[i] === KI.hexer && p.alive && dp <= ELITE.hexer.far && dp >= ELITE.hexer.near - 2 && !(canReach && dp < HORDE.chaseR)) {
        // the Hexer: stand off and throw a hex at the Lamplighter (DESIGN §5.4)
        stop = true; H.target[i] = 2; H.state[i] = ST.ATTACK;
        H.atkT[i] -= dtI;
        if (H.atkT[i] <= 0) { H.atkT[i] = ELITE.hexer.every; ctx.throwHex(i); }
        H.vx[i] = dxp / (dp || 1) * 0.01; H.vz[i] = dzp / (dp || 1) * 0.01;
      } else if (H.kind[i] === 2 && p.alive && dp <= SPEAR.far && dp >= SPEAR.near - 2 && !(canReach && dp < HORDE.chaseR)) {
        // spear-chucker: stand and throw (line of sight: outside the keep's walls, always true on this hillside)
        stop = true; H.target[i] = 2; H.state[i] = ST.ATTACK;
        H.atkT[i] -= dtI;
        if (H.atkT[i] <= 0 && spearTokens >= 1) { spearTokens -= 1; H.atkT[i] = SPEAR.every; ctx.throwSpear(i); }
        H.vx[i] = dxp / (dp || 1) * 0.01; H.vz[i] = dzp / (dp || 1) * 0.01;
      } else if (canReach && dp < HORDE.chaseR && Math.abs(p.y - H.y[i]) < 1.6) {
        H.target[i] = 1;
        dx = dxp / (dp || 1); dz = dzp / (dp || 1);
        if (dp < 1.2 + K.radius + 0.4 && K.melee > 0) {
          stop = true; H.state[i] = ST.ATTACK;
          H.atkT[i] -= dtI;
          if (H.atkT[i] <= 0) {
            H.atkT[i] = K.meleeEvery;
            if (caps.attack++ < 8) ctx.emit(EV.E_ATTACK, { id: i, kind: K.kind, pos: { x, y: H.y[i], z }, target: 'player' });
            ctx.hurtPlayer(K.melee * (ctx.ns?.dmg ?? 1), 'melee', { x: -dxp / (dp || 1), z: -dzp / (dp || 1) });
          }
        } else H.state[i] = ST.WALK;
      } else {
        H.target[i] = 0;
        if (dg < HORDE.gateR) {
          stop = true;
          if (attackers < HORDE.gateAttackers) {
            // a burning goblin panics: half its gate damage while it burns
            attackers++; H.state[i] = ST.ATTACK; gateDmg += K.gateDps * (ctx.ns?.dmg ?? 1) * (burning ? BURNING_GATE_MUL : 1) * dtI;
            H.atkT[i] -= dtI;
            if (H.atkT[i] <= 0) { H.atkT[i] = 1; if (caps.attack++ < 8) ctx.emit(EV.E_ATTACK, { id: i, kind: K.kind, pos: { x, y: H.y[i], z }, target: 'gate' }); }
          } else H.state[i] = ST.WALK;
          dx = dxg / (dg || 1) * 0.3; dz = dzg / (dg || 1) * 0.3;   // keep pressing in
        } else {
          const f = flowDir(x, z); dx = f.x; dz = f.z; H.state[i] = ST.WALK;
        }
      }
      if (dg < HORDE.pileR && H.target[i] === 0 && !fleeing) nearGate++;
      // the Douser: water on the hottest fire within reach (DESIGN §5.4, STORY hint 3)
      if (H.kind[i] === KI.douser && !fleeing) { H.atkT[i] -= dtI; if (H.atkT[i] <= 0) H.atkT[i] = ctx.douse(i) ? ELITE.douser.every : 0.5; }
      // rally, the Chain Imp's slow
      if (chiefs.length && H.kind[i] !== KI.chief) for (let c = 0; c < chiefs.length; c += 2) { const ex = x - chiefs[c], ez = z - chiefs[c + 1]; if (ex * ex + ez * ez < RR) { speed *= ELITE.chief.rally; break; } }
      if (H.slowT[i] > 0) { H.slowT[i] -= dtI; speed *= H.slowK[i]; }

      // imps are erratic: a weave across their path
      if (H.kind[i] === 1 && !stop && !fleeing) { const w = Math.sin(H.anim[i] * 3.1 + i * 1.7) * 0.75; const ox = -dz * w, oz = dx * w; dx += ox; dz += oz; }
      // panic: run away from the heat gradient
      if (burning && !fleeing) {
        // (DESIGN §15.4: the heat gradient is sampled every other tick, by slot parity, and held in between)
        if (((i + st.tick) & 1) === 0 || dtI > dt) { H.panX[i] = fire.heat(x + 1, z) - fire.heat(x - 1, z); H.panZ[i] = fire.heat(x, z + 1) - fire.heat(x, z - 1); }
        const gx = H.panX[i], gz = H.panZ[i], gm = Math.hypot(gx, gz);
        if (gm > 0.02) { dx = dx * (1 - BURN.panic) - gx / gm * BURN.panic; dz = dz * (1 - BURN.panic) - gz / gm * BURN.panic; }
        speed *= 1.3; stop = false;
      }

      // separation (a few neighbours from the hash)
      // (DESIGN §15.4: the hash's cells walked inline — no closure per goblin per tick — and radii from a typed table)
      let sx = 0, sz = 0, seen = 0;
      const ri = K.radius;
      {
        const ci0 = Math.max(0, Math.floor(x - 0.9 - GRID.x0)), ci1 = Math.min(GRID.w - 1, Math.floor(x + 0.9 - GRID.x0));
        const cj0 = Math.max(0, Math.floor(z - 0.9 - GRID.z0)), cj1 = Math.min(GRID.h - 1, Math.floor(z + 0.9 - GRID.z0));
        const HS = hash.start, HC = hash.counts, HI = hash.items, HX = H.x, HZ = H.z, HK = H.kind, cap = HORDE.sepNeighbours;
        scan: for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) {
          const c = cj * GRID.w + ci;
          for (let q = HS[c], e = HS[c] + HC[c]; q < e; q++) {
            const j = HI[q]; if (j === i) continue;
            const ex = x - HX[j], ez = z - HZ[j], d2 = ex * ex + ez * ez, rr = ri + KRAD[HK[j]];
            if (d2 < rr * rr && d2 > 1e-8) { const d = Math.sqrt(d2), o = (rr - d) / d; sx += ex * o; sz += ez * o; }
            else if (d2 <= 1e-8) { const a = ((i * 2.39996) % 6.28319) - ((j * 2.39996) % 6.28319); sx += Math.cos(a) * 0.04; sz += Math.sin(a) * 0.04; }   // a coincident pair splits
            if (++seen >= cap) break scan;
          }
        }
      }
      // separation as a position offset, bounded: a walker is pushed back along its path by at most half its
      // own step, and by ≤ SEP_MAX m a tick in all. Uncapped, a stack of 20+ goblins funnelled onto one flow line kicked its
      // members 0.4 m backwards every few ticks, so the stack stood still for minutes (the road near (29, 64)).
      let ox = sx * 0.35, oz = sz * 0.35;
      const mm = Math.hypot(dx, dz);
      if (!stop && mm > 1e-6) {
        const ux = dx / mm, uz = dz / mm, along = ox * ux + oz * uz, lim = -0.5 * speed * dtI;
        if (along < lim) { ox += (lim - along) * ux; oz += (lim - along) * uz; }
      }
      const om = Math.hypot(ox, oz);
      if (om > SEP_MAX) { ox *= SEP_MAX / om; oz *= SEP_MAX / om; }

      // move
      const m = Math.hypot(dx, dz) || 1;
      const tvx = stop ? 0 : dx / m * speed, tvz = stop ? 0 : dz / m * speed;
      const kk = Math.min(1, 8 * dtI);
      H.vx[i] += (tvx - H.vx[i]) * kk; H.vz[i] += (tvz - H.vz[i]) * kk;
      let nx = x + H.vx[i] * dtI + ox, nz = z + H.vz[i] * dtI + oz;
      if (H.pullT[i] > 0) { H.pullT[i] -= dtI; nx += H.pullVX[i] * dtI; nz += H.pullVZ[i] * dtI; }   // hooked: dragged toward the imp
      if (isBlocked(nx, nz)) {
        if (!isBlocked(nx, z)) nz = z; else if (!isBlocked(x, nz)) nx = x; else { nx = x; nz = z; }
      }
      if (nz < 0.35) nz = 0.35;
      H.x[i] = nx; H.z[i] = nz;
      // the mound: a cone at the gate that grows with the crowd
      let target = 0;
      const onGate = H.target[i] === 0 && !fleeing && H.state[i] !== ST.FLEE;
      if (dg < HORDE.pileR && onGate) {
        target = pileH * (1 - dg / HORDE.pileR) * (0.75 + 0.25 * Math.sin(i * 12.9898));
        if (pGround) { const u = Math.min(1, Math.max(0, (Math.hypot(nx - p.x, nz - p.z) - PILE_CLEAR) / PILE_FADE)); target *= u * u * (3 - 2 * u); }
      }
      if (onGate) H.pile[i] += (target - H.pile[i]) * Math.min(1, 3 * dtI);
      else H.pile[i] = 0;   // a goblin that turns on the player (or flees, or stands to throw) is on the ground at once
      H.y[i] = groundFast(nx, nz) + H.pile[i];
      if (fleeing && Math.hypot(nx - T.x, nz - T.z) > 75) { H.state[i] = ST.DEAD; H.alive--; H.free.push(i); }
    }
    H.nearGate = nearGate; H.gateAttackers = attackers;
    return gateDmg;
  }

  /** Spawn one of a kind at (x, z) (twists: phalanxes, covens); returns the slot or −1. */
  function spawnAt(kindIdx, x, z) {
    const i = spawn(kindIdx, x, z);
    if (i >= 0) ctx.emit(EV.E_SPAWN, { id: i, kind: ENEMY_KINDS[kindIdx], count: 1, pos: { x, y: H.y[i], z } });
    return i;
  }
  return { update, spawn, spawnMany, spawnAt, damage, ignite, kill, hash, reset() { spawnAcc = 0; } };
}
