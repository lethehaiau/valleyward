// @ts-check
// VALLEYWARD · the Ash Troll (docs/DESIGN.md §6.2): arrives at 3:30 or after the 3rd kindle, walks the flow field through
// its own goblins to the gate; ash hide (fire ×0.2) that heats in fire and glows red-hot for 4 s at heat ≥ 1 (guns ×3);
// three telegraphed moves: smash the gate, throw a boulder where the player was, stomp when the player is within 6 m.
import { ARENA, groundHeight, BODY } from '../shared/arena.js';
import { EV } from '../shared/events.js';
import { FIRE_OP, BURN } from '../shared/fireops.js';
import { TROLL } from './constants.js';
import { flowDir } from './world.js';
import { ST } from './horde.js';

/** The night's troll HP: NIGHTS[n].trollHp (tuned at power 1, the `late` save) × the power scale set at nightfall. */
export const trollHp = (ctx) => Math.round((ctx.nightCfg?.trollHp ?? TROLL.hp) * (ctx.state?.night?.hpMul ?? 1));

export function createTroll(ctx) {
  let boulderId = 1, stepAcc = 0;

  function arrive() {
    const st = ctx.state;
    if (st.troll && st.troll.alive) return;   // a second troll (Night II) replaces a dead one (DESIGN §8.1)
    const s = TROLL.spawn;
    st.night.trollsArrived = (st.night.trollsArrived || 0) + 1;
    st.troll = { x: s.x, y: groundHeight(s.x, s.z), z: s.z, yaw: Math.atan2(ARENA.gate.target.x - s.x, ARENA.gate.target.z - s.z), hp: trollHp(ctx), hpMax: trollHp(ctx),
      heat: 0, glowing: false, glowT: 0, action: 'arrive', stage: 'arrive', actionT: 0, actionDur: 3.2, alive: true,
      cd: { smash: 1.5, throw: 4, stomp: 0, roar: TROLL.roar.first }, target: null, deathT: 0 };
    ctx.emit(EV.T_ARRIVE, { pos: { x: s.x, y: st.troll.y, z: s.z } });
  }

  function setAction(tr, action, stage, dur) { tr.action = action; tr.stage = stage; tr.actionT = 0; tr.actionDur = dur; }

  function hit(dmg, source) {
    const tr = ctx.state.troll;
    if (!tr || !tr.alive) return;
    let d = dmg;
    if (source === 'bullet' && tr.glowing) d *= TROLL.gunMul;
    if (source === 'fire') d *= TROLL.fireMul;
    tr.hp = Math.max(0, tr.hp - d);
    if (source !== 'fire' || ctx.state.tick % 30 === 0) ctx.emit(EV.T_HURT, { pos: { x: tr.x, y: tr.y + 4, z: tr.z }, dmg: d, hpFrac: tr.hp / tr.hpMax, glowing: tr.glowing, crit: source === 'bullet' && tr.glowing, source });
    if (tr.hp <= 0) {
      tr.alive = false; setAction(tr, 'dying', 'dying', 3); tr.glowing = false;
      ctx.state.stats.trollKilled = true;
      ctx.state.stats.trollsKilled = (ctx.state.stats.trollsKilled || 0) + 1;
      ctx.lootAt?.('troll', tr.x, tr.y + 1, tr.z);
      ctx.emit(EV.T_DEATH, { pos: { x: tr.x, y: tr.y, z: tr.z } });
      ctx.op({ kind: FIRE_OP.PUSH, x: tr.x, z: tr.z, vx: 0, vz: 0, r: 4 });
    }
  }
  function heatUp(a) {
    const tr = ctx.state.troll;
    if (!tr || !tr.alive || tr.glowing) return;
    tr.heat += a;
    if (tr.heat >= 1) { tr.glowing = true; tr.glowT = TROLL.glowSeconds; tr.heat = 1; ctx.emit(EV.T_GLOW, { on: true, heat: 1 }); }
  }

  function update(dt) {
    const st = ctx.state, tr = st.troll, p = st.player;
    if (!tr) return;
    tr.actionT += dt;
    if (!tr.alive) { tr.deathT += dt; return; }
    // heat: fire at its feet heats the hide (and burns it a little); it cools slowly otherwise
    let h = ctx.fire.heat(tr.x, tr.z);
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; h = Math.max(h, ctx.fire.heat(tr.x + Math.cos(a) * 1.4, tr.z + Math.sin(a) * 1.4)); }
    if (h >= BURN.threshold) { heatUp(h * TROLL.heatRate * dt); hit(BURN.dps * ctx.mods.fireDmg * dt, 'fire'); if (!tr.alive) return; }
    else if (!tr.glowing) tr.heat = Math.max(0, tr.heat - TROLL.heatDecay * dt);
    if (tr.glowing) { tr.glowT -= dt; if (tr.glowT <= 0) { tr.glowing = false; tr.heat = 0; ctx.emit(EV.T_GLOW, { on: false, heat: 0 }); } }
    for (const k in tr.cd) tr.cd[k] = Math.max(0, tr.cd[k] - dt);

    if (tr.action === 'arrive') { if (tr.actionT >= tr.actionDur) setAction(tr, 'walk', 'walk', 0); return; }
    // an action in progress: windup → active → recover
    if (tr.stage === 'windup' && tr.actionT >= tr.actionDur) { activate(tr, p); return; }
    if (tr.stage === 'recover') { if (tr.actionT >= tr.actionDur) setAction(tr, 'walk', 'walk', 0); return; }
    if (tr.stage === 'windup') return;

    // choose a move
    const T = ARENA.gate.target, gx = T.x, gz = T.z + TROLL.gateStand;
    const dGate = Math.hypot(gx - tr.x, gz - tr.z), dP = Math.hypot(p.x - tr.x, p.z - tr.z);
    const pGround = p.alive && (p.where !== 'walk') && p.y < 2;
    if (pGround && dP < TROLL.stomp.near && tr.cd.stomp <= 0) return windup(tr, 'stomp', TROLL.stomp.windup);
    if (p.alive && dP > TROLL.throw.minDist && tr.cd.throw <= 0 && st.mode === 'play') { tr.target = { x: p.x, y: p.y, z: p.z }; return windup(tr, 'throw', TROLL.throw.windup); }
    if (dGate < 0.8 && tr.cd.smash <= 0) return windup(tr, 'smash', TROLL.smash.windup);
    if (tr.cd.roar <= 0 && st.mode === 'play') return windup(tr, 'roar', TROLL.roar.windup);   // DESIGN §6.2: the Ash Roar
    // DESIGN §6.1: a Lamplighter on the ground within 8 m draws it: it turns and walks on him (the stomp is ready again soon)
    if (pGround && dP < TROLL.chase && dP > 2.5) {
      const dx = (p.x - tr.x) / dP, dz = (p.z - tr.z) / dP, v = TROLL.speed * 1.3 * dt;
      tr.x += dx * v; tr.z += dz * v; tr.y = groundHeight(tr.x, tr.z); tr.yaw = Math.atan2(dx, dz);
      stepAcc += v; if (stepAcc >= 1.9) { stepAcc = 0; ctx.emit(EV.T_STEP, { pos: { x: tr.x, y: tr.y, z: tr.z } }); }
      return;
    }
    // walk toward the gate (through its own goblins)
    if (dGate > 0.6) {
      let dx, dz;
      if (dGate < 6) { dx = (gx - tr.x) / dGate; dz = (gz - tr.z) / dGate; }
      else { const f = flowDir(tr.x, tr.z); dx = f.x; dz = f.z; }
      const v = Math.min(TROLL.speed * dt, dGate);
      tr.x += dx * v; tr.z += dz * v; tr.y = groundHeight(tr.x, tr.z);
      tr.yaw = Math.atan2(dx, dz);
      stepAcc += v;
      if (stepAcc >= 1.9) { stepAcc = 0; ctx.emit(EV.T_STEP, { pos: { x: tr.x, y: tr.y, z: tr.z } }); }
    } else tr.yaw = Math.atan2(T.x - tr.x, T.z - tr.z);
  }

  function windup(tr, move, dur) {
    setAction(tr, move, 'windup', dur);
    const p = ctx.state.player;
    if (move !== 'smash') tr.yaw = Math.atan2(p.x - tr.x, p.z - tr.z);
    ctx.emit(EV.T_WINDUP, { move, pos: { x: tr.x, y: tr.y, z: tr.z }, windup: dur, target: tr.target });
  }

  function activate(tr, p) {
    const st = ctx.state;
    if (tr.action === 'smash') {
      tr.cd.smash = TROLL.smash.every;
      ctx.emit(EV.T_SMASH, { pos: { x: tr.x, y: tr.y, z: tr.z - 2 }, target: 'gate' });
      ctx.hurtGate(TROLL.smash.dmg, { x: ARENA.gate.target.x, y: 2, z: 0 });
      setAction(tr, 'smash', 'recover', 0.9);
    } else if (tr.action === 'throw') {
      tr.cd.throw = TROLL.throw.every;
      const to = tr.target || { x: p.x, y: p.y, z: p.z };
      const from = { x: tr.x + Math.sin(tr.yaw) * 1.5, y: tr.y + 6.2, z: tr.z + Math.cos(tr.yaw) * 1.5 };
      const b = { id: boulderId++, x: from.x, y: from.y, z: from.z, fx: from.x, fy: from.y, fz: from.z, tx: to.x, ty: to.y, tz: to.z, t: 0, flight: TROLL.throw.flight, r: TROLL.throw.r };
      st.boulders.push(b);
      ctx.emit(EV.T_THROW, { id: b.id, from, to, flight: b.flight });
      setAction(tr, 'throw', 'recover', 0.8);
    } else if (tr.action === 'roar') {
      // the Ash Roar: a cone in front of the troll (toward the gate / the player) douses the fire and calls 30 goblins
      const R = TROLL.roar; tr.cd.roar = R.every;
      const T = ARENA.gate.target, dx0 = T.x - tr.x, dz0 = T.z - tr.z, d0 = Math.hypot(dx0, dz0) || 1, dir = { x: dx0 / d0, z: dz0 / d0 };
      tr.yaw = Math.atan2(dir.x, dir.z);
      for (let k = 1; k <= 4; k++) for (const a of [-R.angle * 0.7, 0, R.angle * 0.7]) {
        const c = Math.cos(a), s = Math.sin(a), ux = dir.x * c - dir.z * s, uz = dir.x * s + dir.z * c, dd = R.r * k / 4;
        ctx.op({ kind: FIRE_OP.DOUSE, x: tr.x + ux * dd, z: tr.z + uz * dd, r: 1.2 + dd * 0.25 });
      }
      ctx.op({ kind: FIRE_OP.PUSH, x: tr.x + dir.x * 4, z: tr.z + dir.z * 4, vx: dir.x * 8, vz: dir.z * 8, r: 5 });
      const made = ctx.horde.spawnMany(0, R.calls, tr.x - dir.x * 6, tr.z - dir.z * 6);
      ctx.emit('troll.roar', { pos: { x: tr.x, y: tr.y, z: tr.z }, dir, r: R.r, angle: R.angle, calls: made });
      st.stats.roars = (st.stats.roars || 0) + 1;
      setAction(tr, 'roar', 'recover', 1.0);
    } else if (tr.action === 'stomp') {
      tr.cd.stomp = TROLL.stomp.every;
      const R = TROLL.stomp.r;
      ctx.emit(EV.T_STOMP, { pos: { x: tr.x, y: tr.y, z: tr.z }, r: R });
      if (p.alive && p.where !== 'walk' && Math.hypot(p.x - tr.x, p.z - tr.z) < R && p.y < tr.y + 2) ctx.hurtPlayer(TROLL.stomp.dmg, 'stomp', { x: Math.sign(p.x - tr.x) || 1, z: Math.sign(p.z - tr.z) });
      ctx.op({ kind: FIRE_OP.PUSH, x: tr.x, z: tr.z, vx: 0, vz: 0, r: R });
      const H = st.horde;
      ctx.horde.hash.query(tr.x, tr.z, R, (i) => {
        const s = H.state[i]; if (s === ST.DEAD || s === ST.DYING) return false;
        const dx = H.x[i] - tr.x, dz = H.z[i] - tr.z, d = Math.hypot(dx, dz);
        if (d < R && d > 0.01) { const k = (R - d) / R * 2.5; H.x[i] += dx / d * k; H.z[i] += dz / d * k; }
        return false;
      });
      setAction(tr, 'stomp', 'recover', 0.9);
    }
  }

  /** Boulders in flight (parabola from the hand to the target in `flight` seconds). */
  function updateBoulders(dt) {
    const st = ctx.state, p = st.player;
    for (let k = st.boulders.length - 1; k >= 0; k--) {
      const b = st.boulders[k];
      b.t += dt;
      const u = Math.min(1, b.t / b.flight);
      b.x = b.fx + (b.tx - b.fx) * u; b.z = b.fz + (b.tz - b.fz) * u;
      b.y = b.fy + (b.ty - b.fy) * u + 9 * u * (1 - u) * 1.6;
      if (u >= 1) {
        st.boulders.splice(k, 1);
        ctx.emit(EV.T_BOULDER, { pos: { x: b.tx, y: b.ty, z: b.tz }, r: b.r });
        if (p.alive && Math.hypot(p.x - b.tx, p.z - b.tz) < b.r && Math.abs(p.y - b.ty) < 3) ctx.hurtPlayer(TROLL.throw.dmg, 'boulder', { x: p.x - b.tx, z: p.z - b.tz });
        ctx.blast(b.tx, b.ty, b.tz, b.r, 30, 0, 0);
        ctx.op({ kind: FIRE_OP.PUSH, x: b.tx, z: b.tz, vx: 0, vz: 0, r: b.r });
      }
    }
  }

  return { arrive, update, updateBoulders, hit, heatUp, reset() { boulderId = 1; stepAcc = 0; } };
}
export const TROLL_BODY = BODY.troll;
