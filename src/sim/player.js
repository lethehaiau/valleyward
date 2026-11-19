// @ts-check
// VALLEYWARD · the Lamplighter's body: walk/sprint/jump on the terrain, the timber stair (with rails) and the wall walk
// (closed by its parapets), against the towers, braziers and barrels, inside ARENA.playerBounds. Never falls through:
// one ground truth (supportHeight) and a fall guard that returns the player to the last safe spot. Pure JS.
import { ARENA, groundHeight, BODY } from '../shared/arena.js';
import { EV } from '../shared/events.js';
import { PLAYER, GRAVITY } from './constants.js';
import { TOWERS, STAIR_BOX, supportHeight, onWalk, stairY } from './world.js';

const R = BODY.player.radius;
const NPC = ARENA.camp.npc;
/** Brother Cinder's stall (src/env/camp.js buildStall): solid boxes on the ground (all ≤ 2.4 m high). */
const STALL = [
  { x0: -19.855, x1: -19.705, z0: 6.025, z1: 6.175 }, { x0: -15.495, x1: -15.345, z0: 6.025, z1: 6.175 },   // awning posts
  { x0: -16.7, x1: -16.0, z0: 3.6, z1: 4.3 },     // anvil
  { x0: -19.5, x1: -18.1, z0: 3.26, z1: 3.86 },   // workbench
  { x0: -19.16, x1: -18.44, z0: 4.84, z1: 5.56 }, // forge
  { x0: -19.95, x1: -19.15, z0: 3.35, z1: 4.15 }, { x0: -19.9, x1: -19.3, z0: 4.35, z1: 4.95 }, { x0: -15.9, x1: -15.4, z0: 5.25, z1: 5.75 },   // crates
];
const WALK = ARENA.keep.walk, S = ARENA.stair, B = ARENA.playerBounds;
const JUMP_V = Math.sqrt(2 * GRAVITY * PLAYER.jump);
/** Fence runs inside the player's bounds ([x, z] polylines, 0.25 m thick) are solid for the player
 *  (the horde ignores them). The environment has no run inside the bounds today; a run added to
 *  `ARENA.colliders.fences` becomes solid at once. */
const FENCES = /** @type {any} */ (ARENA).colliders?.fences ?? [];

/** Push the circle (x, z, r) out of an AABB; returns the corrected position in `p`. */
function pushOutBox(p, b, r) {
  const cx = Math.max(b.x0, Math.min(b.x1, p.x)), cz = Math.max(b.z0, Math.min(b.z1, p.z));
  const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-9) { const d = Math.sqrt(d2); p.x = cx + dx / d * r; p.z = cz + dz / d * r; return true; }
  // centre inside the box: leave by the nearest face
  const l = p.x - b.x0, rr = b.x1 - p.x, n = p.z - b.z0, s = b.z1 - p.z, m = Math.min(l, rr, n, s);
  if (m === l) p.x = b.x0 - r; else if (m === rr) p.x = b.x1 + r; else if (m === n) p.z = b.z0 - r; else p.z = b.z1 + r;
  return true;
}
/** Push the player's circle out of a segment (a fence run) of half-thickness ht. */
function pushOutSeg(p, ax, az, bx, bz, ht) {
  const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - ax) * vx + (p.z - az) * vz) / L2));
  const cx = ax + vx * t, cz = az + vz * t, dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz), m = ht + R;
  if (d >= m) return;
  if (d < 1e-6) { const l = Math.sqrt(L2); p.x = cx - vz / l * m; p.z = cz + vx / l * m; return; }
  p.x = cx + dx / d * m; p.z = cz + dz / d * m;
}
function pushOutCircle(p, cx, cz, cr) {
  const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz), m = cr + R;
  if (d >= m) return;
  if (d < 1e-6) { p.x = cx + m; return; }
  p.x = cx + dx / d * m; p.z = cz + dz / d * m;
}

/**
 * Advance the player one tick.
 * @param {any} ctx  { state, emit }
 * @param {any} inp  { fwd, right, sprint, jump, yaw, pitch }
 * @param {number} dt
 */
export function stepPlayer(ctx, inp, dt) {
  const st = ctx.state, p = st.player;
  p.yaw = inp.yaw; p.pitch = Math.max(-1.45, Math.min(1.45, inp.pitch));
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw), rx = -fz, rz = fx;
  let wx = fx * inp.fwd + rx * inp.right, wz = fz * inp.fwd + rz * inp.right;
  const m = Math.hypot(wx, wz);
  if (m > 1) { wx /= m; wz /= m; }
  const speed = (inp.sprint && inp.fwd > 0.2 ? PLAYER.sprint : PLAYER.walk) * (ctx.mods?.speed || 1);   // Ashen Step (DESIGN §5.4)
  const k = 1 - Math.exp(-(m > 0.01 ? PLAYER.accel : PLAYER.decel) * dt * (p.onGround ? 1 : 0.35));
  p.vx += (wx * speed - p.vx) * k; p.vz += (wz * speed - p.vz) * k;

  if (inp.jump && p.onGround) { p.vy = JUMP_V; p.onGround = false; ctx.emit(EV.P_JUMP, { pos: { x: p.x, y: p.y, z: p.z } }); }

  const prev = { x: p.x, y: p.y, z: p.z };
  const q = { x: p.x + p.vx * dt, z: p.z + p.vz * dt };
  const high = onWalk(p.x, p.z, p.y);
  const onRamp = !high && p.x >= S.x0 - 0.05 && p.x <= S.x1 + 0.05 && p.z >= S.zTop - 0.05 && p.z <= S.zBottom && p.y > 0.2 && p.y >= stairY(p.z) - 0.9;
  if (high) {
    // the wall walk: parapets on both sides; the only way off is the stair opening on the south edge
    q.x = Math.max(WALK.x0 + R, Math.min(WALK.x1 - R, q.x));
    q.z = Math.max(WALK.z0 + R, q.z);
    const inOpening = q.x >= S.x0 + R && q.x <= S.x1 - R;
    if (!inOpening) q.z = Math.min(WALK.z1 - R, q.z);
    else if (q.z > WALK.z1 - R) q.x = Math.max(S.x0 + R, Math.min(S.x1 - R, q.x));
  } else if (onRamp) {
    q.x = Math.max(S.x0 + R, Math.min(S.x1 - R, q.x));   // rails
    q.z = Math.min(q.z, S.zBottom + 2);
  } else {
    q.x = Math.max(B.x0 + R, Math.min(B.x1 - R, q.x));
    q.z = Math.max(B.z0 + R, Math.min(B.z1 - R, q.z));
    for (const t of TOWERS) pushOutBox(q, t, R);
    for (const [bx, bz] of ARENA.braziers) pushOutCircle(q, bx, bz, 0.45);
    // DESIGN §9: the run's towers on their pads and Brother Cinder at his stall are solid
    for (const t of st.run?.spots || []) pushOutCircle(q, t.x, t.z, ARENA.camp.towerRadius);
    pushOutCircle(q, NPC.x, NPC.z, 0.45);
    if (q.x < -14.8 && q.z < 6.8) for (const b of STALL) pushOutBox(q, b, R);
    for (const line of FENCES) for (let k = 0; k + 1 < line.length; k++) pushOutSeg(q, line[k][0], line[k][1], line[k + 1][0], line[k + 1][1], 0.125);
    const bar = ARENA.oil.barrels;
    for (let i = 0; i < bar.length; i++) if (st.barrels[i]?.alive) pushOutCircle(q, bar[i][0], bar[i][1], ARENA.oil.barrelRadius);
    // the stair's sides: solid where its tread is higher than a step above the feet
    const sb = { x0: STAIR_BOX.x0, x1: STAIR_BOX.x1, z0: STAIR_BOX.z0, z1: STAIR_BOX.z1 };
    if (q.x > sb.x0 - R && q.x < sb.x1 + R && q.z > sb.z0 && q.z < sb.z1 && stairY(q.z) > p.y + PLAYER.stepUp) pushOutBox(q, sb, R);
    q.z = Math.max(B.z0 + R, q.z);
  }
  p.x = q.x; p.z = q.z;

  // vertical
  p.vy -= GRAVITY * dt;
  p.y += p.vy * dt;
  const sup = supportHeight(p.x, p.z, Math.max(p.y, prev.y));
  if (p.y <= sup) {
    if (!p.onGround) { const fall = Math.max(0, p.fallFrom - sup); ctx.emit(EV.P_LAND, { pos: { x: p.x, y: sup, z: p.z }, fall }); }
    p.y = sup; p.vy = 0; p.onGround = true;
  } else if (p.onGround && p.vy <= 0 && p.y - sup < 0.45) {
    p.y = sup; p.vy = 0;   // walking down a slope or the stair: stay on it
  } else {
    if (p.onGround) p.fallFrom = p.y;
    p.onGround = false;
    p.fallFrom = Math.max(p.fallFrom, p.y);
  }
  if (p.onGround) p.fallFrom = p.y;

  // fall guard (never expected): below the ground by 2 m → the last safe spot
  if (p.y < groundHeight(p.x, p.z) - 2) { p.x = p.safe.x; p.y = p.safe.y; p.z = p.safe.z; p.vx = p.vy = p.vz = 0; p.onGround = true; }
  else if (p.onGround) { p.safe.x = p.x; p.safe.y = p.y; p.safe.z = p.z; }

  // footsteps from the real displacement
  const moved = Math.hypot(p.x - prev.x, p.z - prev.z);
  p.speed = moved / dt;
  if (p.onGround) {
    p.stepAcc += moved;
    if (p.stepAcc >= 2.1) { p.stepAcc = 0; ctx.emit(EV.P_STEP, { pos: { x: p.x, y: p.y, z: p.z }, speed: p.speed }); }
  }
  p.where = onWalk(p.x, p.z, p.y) ? 'walk' : (p.y > 0.6 && p.x >= S.x0 - 0.05 && p.x <= S.x1 + 0.05 && p.z <= S.zBottom ? 'stair' : 'ground');
}

/** Can ground enemies reach the player (melee, chase)? Not on the wall walk, not high on the stair. */
export const reachable = (p) => p.alive && (p.where === 'ground' || (p.where === 'stair' && p.y < 1.3));

export function newPlayer() {
  const s = ARENA.playerSpawn;
  return {
    x: s.x, y: 0, z: s.z, yaw: s.yaw, pitch: -0.04, vx: 0, vy: 0, vz: 0, onGround: true, speed: 0, where: 'ground',
    hp: PLAYER.hp, hpMax: PLAYER.hp, weapon: 'pistol', ammo: { pistol: 8, blunderbuss: 4 }, fuel: 100, fuelMax: 100,
    reloadT: 0, firing: false, bombs: 3, bombsMax: 3, sunburst: 0, level: 1, xp: 0, xpNext: 0, magnet: 3, alive: true,
    fallFrom: 0, stepAcc: 0, safe: { x: s.x, y: 0, z: s.z }, unlocked: { pistol: true, blunderbuss: false, lance: true },
    cool: 0, trigBuf: 0, holdFireT: 0, sputterT: 0, lanceIdle: 0, bombT: 0, hurtT: 0, fireHurtT: 0, switchT: 1, jet: { on: false, ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0, lx: 0, ly: 0, lz: 0, range: 11, t: 0 },
  };
}
