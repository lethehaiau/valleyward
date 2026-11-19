// @ts-check
// Combat FX that are not the fire fluid (docs/DESIGN.md §14.3 createFx). Pixel-styled with chunky
// puffs, squares and rings, in three instanced draws (additive / alpha / numbers): muzzle flashes at
// actors.sockets.muzzle(), tracers, hit sparks and goblin ichor, firebomb and barrel bursts (flash, debris, smoke puff,
// ground shock ring; the fluid does the fire itself), the Sunburst ring, damage numbers (crits bigger), the XP wisps
// (a small cyan streak from each kill to the player: XP is credited on every kill; capped and batched), gold
// twinkles and their magnet trail (no hearts since DESIGN §16), the level-up burst of cyan stars, the kindle flare at the beacon basket, troll dust / stomp ring /
// boulder debris, gate splinters, spear trails and lance nozzle sparks. Bursts are budgeted per frame (a burning horde
// can raise hundreds of events a second) and delayed parts run on an effect queue on game time.
import * as THREE from 'three';
import { EV, ENEMY_KINDS } from '../shared/events.js';
import { ARENA, groundHeight } from '../shared/arena.js';
import { makeAtlas, TILE } from './atlas.js';
import { createPool, MODE, FLAG } from './pool.js';
import { gfx } from '../gfx/current.js';
import { DROP_FLY_AFTER } from '../shared/meta.js';
import { TIMELINE } from '../shared/timeline.js';

/** sRGB hex → linear rgb × intensity (+ alpha) */
function lin(hex, k = 1, a = 1) { const c = new THREE.Color(hex); return [c.r * k, c.g * k, c.b * k, a]; }
const COL = Object.freeze({
  core: lin('#fff2b8', 1.7), yellow: lin('#ffd24a', 1.45), orange: lin('#ff9a2e', 1.3), ember: lin('#e85a1c', 1.15), crimson: lin('#a3241a', 1.0),
  white: lin('#ffffff', 1), whiteHot: lin('#ffffff', 1.8), tracer: lin('#fff2b8', 2.0), tracerEnd: lin('#ff9a2e', 1.3, 0),
  // smoke is a light charcoal-brown at ≤ 0.45 alpha that fades to clear as it rises (0.85 stacked to black)
  smoke: lin('#4a3c35', 1, 0.4), smokeLit: lin('#7a5340', 1, 0.45), smokeEnd: lin('#5d5550', 1, 0), ash: lin('#8a8a86', 1, 0.5), dust: lin('#6b6458', 1, 0.5), dustPale: lin('#8f8878', 1, 0.5),
  ichor: lin('#4d5a22'), ichor2: lin('#6f7a3a'), impIchor: lin('#6b1f19'), wood: lin('#6b4a2e'), wood2: lin('#8a6640'), stone: lin('#4a5560'), stone2: lin('#6a747c'),
  clay: lin('#3a2a22'), cyan: lin('#a4e6ee', 1.6), wisp: lin('#7fe9f2', 2.1), wispTail: lin('#3d8f9c', 1.4, 0), cyanSoft: lin('#9ee1e9', 1.1), gold: lin('#f6e7a0', 1.4), heart: lin('#ff6b7a', 1.4),
  ring: lin('#ffb25a', 1.25), ringDust: lin('#7d7466', 1, 0.3), num: lin('#ffffff', 1), numCrit: lin('#fff2b8', 1.25), numTroll: lin('#ffe9c4', 1.15),
});
/** DESIGN §11.5 coloured fire: white core → hue body → deep hue edge (alpha pool: additive hues over the teal night go pale). */
const HUE = Object.freeze({
  orange: { core: COL.core, body: COL.orange, edge: COL.crimson, hot: COL.yellow },
  violet: { core: lin('#f3dcff', 1.35), body: lin('#9b45ff', 1.05), edge: lin('#3d1270', 0.9), hot: lin('#c58cff', 1.15) },
  blue: { core: lin('#d6efff', 1.3), body: lin('#1f6bff', 1.0), edge: lin('#0e2f80', 0.9), hot: lin('#5aaaff', 1.05) },
  green: { core: lin('#ecffd2', 1.35), body: lin('#52d93a', 1.0), edge: lin('#17591a', 0.9), hot: lin('#a6f07e', 1.15) },
  lilac: { core: lin('#fbecff', 1.3), body: lin('#b583ff', 1.05), edge: lin('#5a3a8f', 0.9), hot: lin('#dcb8ff', 1.15) },
});
const hueOf = (h) => HUE[h] || HUE.orange;
const COL2 = Object.freeze({ iron: lin('#9aa4ac', 1.15), ironLit: lin('#d7dee3', 1.3), water: lin('#a8dcff', 1.3), water2: lin('#5fa8de', 1.1), steam: lin('#d9e3e7', 1, 0.42), steamEnd: lin('#c3cdd2', 1, 0),
  coin: lin('#f5bf2a', 1.05), coinEdge: lin('#8a5a10', 1.0), gem: lin('#5fe0f0', 1.1), hit: lin('#ffffff', 1.4), hitCrit: lin('#fff2b8', 1.5), rune: lin('#7fe9f2', 1.5) });
/** where the flying drops land: a point WISP.depth m ahead that projects onto the gold counter / the XP bar (NDC) */
const DROP_TO = Object.freeze({ gold: [-0.86, 0.73], xp: [-0.62, 0.86] });
const QUALITY = Object.freeze({ high: { k: 1, add: 1500, alpha: 4000, num: 320 }, medium: { k: 0.7, add: 1000, alpha: 2600, num: 240 }, low: { k: 0.45, add: 600, alpha: 1500, num: 160 } });
/** XP wisps: at most `alive` in flight and one new every `every` seconds (one wisp stands for a batch). */
// sized in SCREEN space (head ≈ 0.75 % of the frame height ≈ 5–8 px, tail ≤ 4 %), one wisp per 0.08 s at most (a
// wisp stands for every kill of its batch), ≤ 10 in flight, flying to the XP bar (top left), never near the lens.
const WISP = Object.freeze({ alive: 10, every: 0.08, flight: [0.45, 0.65], head: 0.0075, width: 0.0032, tail: 0.04, ndc: [-0.62, 0.86], depth: 4 });
/** the sim's XP event (EV.XP_GAIN); without it the wisps start from enemy.death */
const EV_XP = /** @type {any} */ (EV).XP_GAIN || 'xp.gain';

/** a tiny seeded RNG (the FX never touch the sim's RNG) */
function rng(seed = 0x9e3779b9) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Game-time effect queue (world-build kit/effect-queue.js), reused slots, no closures kept after they run. */
function createQueue() {
  let time = 0; /** @type {{ at: number, run: () => void }[]} */ let jobs = [];
  return {
    schedule(delay, run) { jobs.push({ at: time + Math.max(0, delay), run }); },
    advance(dt) {
      if (!(dt > 0) || !jobs.length) { time += dt > 0 ? dt : 0; return; }
      time += dt;
      let w = 0; const due = [];
      for (let i = 0; i < jobs.length; i++) { const j = jobs[i]; if (j.at <= time) due.push(j); else jobs[w++] = j; }
      jobs.length = w;
      for (const j of due) j.run();
    },
    clear() { jobs = []; time = 0; },
  };
}

/**
 * @param {{ scene: THREE.Scene, camera: THREE.Camera, quality?: 'high'|'medium'|'low', actors?: any }} o
 */
export function createFx({ scene, camera, quality = 'high', actors = null }) {
  const Q = QUALITY[quality] || QUALITY.high;
  const map = makeAtlas();
  const add = createPool({ max: Q.add, map, blending: THREE.AdditiveBlending, renderOrder: 20, name: 'ew-fx-add' });
  const alpha = createPool({ max: Q.alpha, map, blending: THREE.NormalBlending, renderOrder: 19, name: 'ew-fx-alpha' });
  const nums = createPool({ max: Q.num, map, blending: THREE.NormalBlending, depthTest: false, renderOrder: 40, name: 'ew-fx-num' });
  const root = new THREE.Group();
  root.name = 'ew-fx';
  root.add(alpha.mesh, add.mesh, nums.mesh);
  scene.add(root);
  const queue = createQueue();
  const R = rng(0x5eed);
  const rr = (a, b) => a + (b - a) * R();
  const K = Q.k;
  const cnt = (n) => Math.max(1, Math.round(n * K));

  // per-frame budgets (reset in update)
  const BUDGET = { death: Math.round(28 * K) + 4, ignite: Math.round(14 * K) + 2, hit: Math.round(40 * K) + 4, num: Math.round(14 * K) + 4, gate: 2, pyre: Math.round(6 * K) + 2, imp: Math.round(20 * K) + 4 };
  const used = { death: 0, ignite: 0, hit: 0, num: 0, gate: 0, pyre: 0 };
  const take = (k) => (used[k] < BUDGET[k] ? (used[k]++, true) : false);

  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), camPos = new THREE.Vector3(), camFwd = new THREE.Vector3();
  let twinkleT = 0, trailT = 0, glowT = 0, nozzleT = 0, lastGateT = -1, clock = 0;
  // XP wisps: CPU slots; each frame the head is re-drawn as a short additive streak toward the player's chest
  const WN = Math.max(8, Math.round(WISP.alive * (K < 1 ? 0.75 + 0.25 * K : 1)));
  const wsx = new Float32Array(WN), wsy = new Float32Array(WN), wsz = new Float32Array(WN), wcx = new Float32Array(WN), wcy = new Float32Array(WN), wcz = new Float32Array(WN);
  const wt = new Float32Array(WN), wdur = new Float32Array(WN), wpx = new Float32Array(WN), wpy = new Float32Array(WN), wpz = new Float32Array(WN);
  let wAlive = 0, lastWispAt = -1, xpEvSeen = false, organN = 0;
  const wTo = new THREE.Vector3(), wR = new THREE.Vector3(), wU = new THREE.Vector3();
  /** world height of the frame at distance d from the lens (screen-space sizing) */
  const frameH = (d) => 2 * Math.max(0.05, d) * Math.tan(((/** @type {any} */ (camera).fov || 78) * Math.PI) / 360);
  let lastState = /** @type {any} */ (null);

  function muzzle(out, fallback) {
    try {
      const m = actors?.sockets?.muzzle?.(out);
      if (m && Number.isFinite(m.x)) return out.set(m.x, m.y, m.z);
    } catch { /* fall through */ }
    if (fallback) return out.set(fallback.x, fallback.y, fallback.z);
    camera.getWorldPosition(out); camera.getWorldDirection(tmp2);
    return out.addScaledVector(tmp2, 0.7).add(tmp2.set(0.18, -0.16, 0).applyQuaternion(camera.quaternion));
  }
  const floorAt = (x, z) => groundHeight(x, z) + 0.02;

  // ---------------------------------------------------------------------------------------------- building blocks
  function flash(x, y, z, size, col = COL.core, life = 0.08, tile = TILE.disc) {
    alpha.spawn({ x, y, z, life, size, size1: size * 0.3, sizeK: 2, col, col1: COL.orange, fout: 0.85, tile, rot: rr(0, 6.28) });
  }
  /** pixel squares / shards with gravity that bounce and settle */
  function debris(x, y, z, n, col, col2, { speed = 4, up = 4, size = 0.12, life = 0.9, tile = TILE.square, grav = 18, pool = alpha } = {}) {
    for (let i = 0; i < n; i++) {
      const a = rr(0, 6.283), s = rr(0.3, 1) * speed;
      pool.spawn({ x, y, z, vx: Math.cos(a) * s, vy: rr(0.4, 1) * up, vz: Math.sin(a) * s, life: life * rr(0.7, 1.2), size: size * rr(0.7, 1.3),
        col: R() < 0.5 ? col : col2, fout: 0.75, tile, grav, drag: 0.4, rot: rr(0, 6.28), rotV: rr(-12, 12), flags: FLAG.bounce, floor: floorAt(x, z) + 0.04 });
    }
  }
  /** soft round smoke / dust puffs (the pool draws tile 6 as a procedural soft disc); they fade to clear as they rise */
  function puffs(x, y, z, n, col, { r = 0.6, size = 0.7, size1 = 1.8, rise = 1.2, life = 1.2, spread = 1.4, col1 = null } = {}) {
    const c1 = col1 || [col[0], col[1], col[2], 0];
    for (let i = 0; i < n; i++) {
      const a = rr(0, 6.283), d = rr(0, r);
      alpha.spawn({ x: x + Math.cos(a) * d, y: y + rr(0, r * 0.6), z: z + Math.sin(a) * d, vx: Math.cos(a) * spread * rr(0.3, 1), vy: rise * rr(0.5, 1.2), vz: Math.sin(a) * spread * rr(0.3, 1),
        life: life * rr(0.75, 1.25), size: size * rr(0.8, 1.2), size1: size1 * rr(0.8, 1.2), sizeK: 3, col, col1: c1, fin: 0.1, fout: 0.5, tile: TILE.puff, drag: 1.6, rot: rr(0, 6.28), rotV: rr(-0.6, 0.6) });
    }
  }
  /** additive sparks: streaks that fly out and fall */
  function sparks(x, y, z, n, { speed = 7, up = 3, life = 0.35, col = COL.yellow, col1 = COL.ember, size = 0.05, grav = 14, dirX = 0, dirY = 0, dirZ = 0 } = {}) {
    for (let i = 0; i < n; i++) {
      tmp.set(rr(-1, 1), rr(-0.2, 1), rr(-1, 1)).normalize();
      tmp.x += dirX; tmp.y += dirY; tmp.z += dirZ; tmp.normalize();
      const s = speed * rr(0.5, 1.1);
      alpha.spawn({ x, y, z, vx: tmp.x * s, vy: tmp.y * s + up * R(), vz: tmp.z * s, life: life * rr(0.6, 1.2), size, col, col1, fout: 0.5,
        tile: TILE.streak, mode: MODE.stretch, flags: FLAG.alignVel, grav, drag: 1.2, floor: floorAt(x, z) });
    }
  }
  function embers(x, y, z, n, { spread = 0.6, rise = 3, life = 1.2, size = 0.08, hue = null } = {}) {
    const H = hue ? hueOf(hue) : null;
    for (let i = 0; i < n; i++) {
      alpha.spawn({ x: x + rr(-spread, spread), y: y + rr(0, spread), z: z + rr(-spread, spread), vx: rr(-0.8, 0.8), vy: rise * rr(0.5, 1.3), vz: rr(-0.8, 0.8),
        life: life * rr(0.6, 1.3), size: size * rr(0.7, 1.4), size1: size * 0.4, col: H ? (R() < 0.4 ? H.hot : H.body) : R() < 0.4 ? COL.yellow : COL.orange, col1: H ? H.edge : COL.crimson, fout: 0.55, tile: TILE.ember, drag: 0.8, grav: -0.5 });
    }
  }
  /** a flat expanding ring on the ground (or at height y) */
  function ring(x, y, z, r, { life = 0.4, col = COL.ring, col1, pool = alpha, tile = TILE.ring, start = 0.3 } = {}) {
    pool.spawn({ x, y: y + 0.08, z, life, size: Math.max(0.2, start), size1: r * 2, sizeK: 2.4, col, col1: col1 || [col[0] * 0.5, col[1] * 0.4, col[2] * 0.3, 0], fout: 0.35, tile, mode: MODE.flat });
  }
  function stars(x, y, z, n, { r = 1.6, speed = 3, life = 0.9, col = COL.cyan, size = 0.22, up = 1.5 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rr(-0.2, 0.2), d = rr(0.4, 1) * r;
      add.spawn({ x: x + Math.cos(a) * d * 0.3, y: y + rr(-0.4, 0.6), z: z + Math.sin(a) * d * 0.3, vx: Math.cos(a) * speed * rr(0.6, 1.1), vy: up * rr(0.3, 1.2), vz: Math.sin(a) * speed * rr(0.6, 1.1),
        life: life * rr(0.7, 1.2), size: size * rr(0.7, 1.4), size1: size * 0.2, sizeK: 1, col, fin: 0.05, fout: 0.5, tile: R() < 0.7 ? TILE.star : TILE.bigStar, drag: 2.2, grav: -0.4 });
    }
  }

  // ------------------------------------------------------------------------------------------------------- DESIGN §9
  const camR = new THREE.Vector3(), camU = new THREE.Vector3();
  /** a point D m ahead of the lens that projects onto NDC (nx, ny): where the flying drops end */
  function screenPoint(out, nx, ny, D = WISP.depth) {
    camera.getWorldPosition(camPos); camera.getWorldDirection(camFwd); camera.updateMatrixWorld();
    camR.setFromMatrixColumn(camera.matrixWorld, 0).normalize(); camU.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const tv = Math.tan(((/** @type {any} */ (camera).fov || 78) * Math.PI) / 360), th = tv * (/** @type {any} */ (camera).aspect || 16 / 9);
    return out.copy(camPos).addScaledVector(camFwd, D).addScaledVector(camR, nx * D * th).addScaledVector(camU, ny * D * tv);
  }
  const distCam = (x, y, z) => { camera.getWorldPosition(camPos); return Math.hypot(x - camPos.x, y - camPos.y, z - camPos.z); };
  /** the hit marker (no crosshair, DESIGN §13): a small screen-sized "×" flash at the world impact point, drawn on top */
  function hitMark(x, y, z, crit) {
    const fh = frameH(distCam(x, y, z));
    const sz = fh * (crit ? 0.04 : 0.03);
    nums.spawn({ x, y, z, life: crit ? 0.14 : 0.11, size: sz, size1: sz * 0.8, sizeK: 1, col: crit ? COL2.hitCrit : COL2.hit, fout: 0.45, tile: TILE.plus, rot: 0.785 });
    nums.spawn({ x, y, z, life: 0.05, size: sz * 0.35, col: crit ? COL2.hitCrit : COL2.hit, fout: 0.5, tile: TILE.disc });
  }
  function hflash(x, y, z, size, hue, life = 0.14) {
    const H = hueOf(hue);
    alpha.spawn({ x, y, z, life, size, size1: size * 0.3, sizeK: 2, col: H.core, col1: H.body, fout: 0.85, tile: TILE.disc, rot: rr(0, 6.28) });
    alpha.spawn({ x, y, z, life: life * 1.4, size: size * 1.5, size1: size * 0.5, sizeK: 2, col: [H.body[0], H.body[1], H.body[2], 0.7], col1: [H.edge[0], H.edge[1], H.edge[2], 0], fout: 0.7, tile: TILE.disc });
  }
  const padPos = (pad) => ARENA.camp?.pads?.find((p, i) => p.id === pad || i === Number(pad)) || null;
  const fdt = () => Math.max(0.02, frameDt * 1.5);   // a one-frame sprite (redrawn every frame by its owner)
  let frameDt = 1 / 60;

  // chains (Chain Imp): a segmented line from the imp's hand to the goblin, a hook, a tug
  const CH = []; const CH_MAX = 10;
  function chainThrow(ev) {
    const f = P(ev.from), to = P(ev.to); if (!f) return;
    if (CH.length >= CH_MAX) CH.shift();
    const tx = to ? to.x : f.x, tz = to ? to.z : f.z;
    const fy = f.y > groundHeight(f.x, f.z) + 0.6 ? f.y : groundHeight(f.x, f.z) + 1.6;
    CH.push({ pad: ev.pad, tid: Number.isInteger(ev.targetId) ? ev.targetId : -1, fx: f.x, fy, fz: f.z, tx, ty: to ? to.y : groundHeight(tx, tz), tz, t: 0,
      fly: Math.max(0.1, Math.hypot(tx - f.x, tz - f.z) / 45), hookAt: -1 });
  }
  function chainHook(ev) {
    const c = CH.find((k) => k.hookAt < 0 && (k.tid === ev.targetId || (ev.targetId == null && k.pad === ev.pad))) || CH.find((k) => k.hookAt < 0);
    const p = P(ev.pos);
    if (c) { c.hookAt = c.t; if (c.t < c.fly) c.t = c.fly; }
    if (p) { flash(p.x, p.y + 0.7, p.z, 0.45, COL2.ironLit, 0.07); sparks(p.x, p.y + 0.7, p.z, cnt(5), { speed: 3.5, up: 1.5, life: 0.25, size: 0.035, col: COL2.ironLit, col1: COL2.iron }); }
  }
  function stepChains(dt, st) {
    if (Array.isArray(st?.chains)) { CH.length = 0; return; }   // the actors draw every state.chains entry; the FX keep the hook spark
    const H = st?.horde;
    for (let i = CH.length - 1; i >= 0; i--) {
      const c = CH[i]; c.t += dt;
      const end = c.hookAt >= 0 ? c.hookAt + 0.55 : c.fly + 0.5;
      if (c.t > end) { CH.splice(i, 1); continue; }
      if (H && c.tid >= 0 && c.tid < (H.count || 0) && H.state?.[c.tid]) { c.tx = H.x[c.tid]; c.ty = H.y[c.tid]; c.tz = H.z[c.tid]; }
      const u = Math.min(1, c.t / c.fly);
      const ex = c.fx + (c.tx - c.fx) * u, ey = c.fy + (c.ty + 0.7 - c.fy) * u, ez = c.fz + (c.tz - c.fz) * u;
      const L = Math.hypot(ex - c.fx, ey - c.fy, ez - c.fz), n = Math.max(3, Math.min(26, Math.round(L / 0.32)));
      // sag while it flies, taut on the hook, a short shiver on the tug
      const tug = c.hookAt >= 0 ? Math.max(0, 1 - (c.t - c.hookAt) / 0.3) : 0;
      const sag = c.hookAt >= 0 ? 0.04 : 0.35 * Math.min(1, L / 8);
      const a = c.hookAt >= 0 && c.t - c.hookAt > 0.35 ? 1 - (c.t - c.hookAt - 0.35) / 0.2 : 1;
      for (let k = 1; k <= n; k++) {
        const v = k / n, y = c.fy + (ey - c.fy) * v - Math.sin(v * Math.PI) * sag * L * 0.15 + (tug ? Math.sin(v * 31 + c.t * 80) * 0.05 * tug : 0);
        const cc = k % 2 ? COL2.iron : COL2.ironLit, ca = a < 1 ? [cc[0], cc[1], cc[2], Math.max(0, a)] : cc;
        alpha.spawn({ x: c.fx + (ex - c.fx) * v, y, z: c.fz + (ez - c.fz) * v, life: fdt(), size: k % 2 ? 0.15 : 0.11, col: ca, fout: 0, tile: TILE.square, rot: k % 2 ? 0.785 : 0 });
      }
      alpha.spawn({ x: ex, y: ey, z: ez, life: fdt(), size: 0.32, col: COL2.ironLit, fout: 0, tile: TILE.shard, rot: Math.atan2(ex - c.fx, ey - c.fy) });
    }
  }

  // Ember Orbit fireballs (from state.orbit) — blue balls with a short trail
  let orbitT = 0;
  function stepOrbit(dt, st) {
    const ob = Array.isArray(st?.orbit) ? st.orbit : Array.isArray(st?.player?.orbit) ? st.player.orbit : null;
    if (!ob || !ob.length || dt <= 0) return;
    const B = HUE.blue; orbitT += dt;
    for (let i = 0; i < ob.length && i < 6; i++) {
      const b = ob[i]; if (!b || !Number.isFinite(b.x)) continue;
      const y = Number.isFinite(b.y) ? b.y : groundHeight(b.x, b.z) + 1.1;
      alpha.spawn({ x: b.x, y, z: b.z, life: fdt(), size: 0.38, col: B.body, fout: 0, tile: TILE.disc });
      alpha.spawn({ x: b.x, y, z: b.z, life: fdt(), size: 0.15, col: B.core, fout: 0, tile: TILE.disc });
      alpha.spawn({ x: b.x + rr(-0.04, 0.04), y: y + rr(-0.04, 0.04), z: b.z + rr(-0.04, 0.04), vy: rr(0.1, 0.4), life: rr(0.14, 0.2), size: 0.22, size1: 0.04, col: B.body, col1: [B.edge[0], B.edge[1], B.edge[2], 0.2], fout: 0.4, tile: TILE.disc, drag: 2 });
      if (R() < 0.35) alpha.spawn({ x: b.x, y, z: b.z, vx: rr(-0.6, 0.6), vy: rr(0.5, 1.6), vz: rr(-0.6, 0.6), life: rr(0.3, 0.6), size: 0.06, col: B.hot, col1: B.edge, fout: 0.5, tile: TILE.ember, grav: -0.4 });
    }
  }

  // projectiles with a flight time: Brimstone meteors, Douser water, the Hexer's orb
  const PR = []; const PR_MAX = 24;
  function launch(kind, from, to, dur, extra = {}) {
    if (!to) return;
    if (PR.length >= PR_MAX) PR.shift();
    const f = from || { x: to.x - 6, y: (to.y ?? 0) + 24, z: to.z + 4 };
    PR.push({ kind, sx: f.x, sy: f.y ?? groundHeight(f.x, f.z) + 1.4, sz: f.z, ex: to.x, ey: to.y ?? groundHeight(to.x, to.z), ez: to.z, t: 0, dur: Math.max(0.15, dur), px: f.x, py: f.y ?? 0, pz: f.z, ...extra });
  }
  function stepProjectiles(dt) {
    for (let i = PR.length - 1; i >= 0; i--) {
      const q = PR[i]; q.t += dt;
      const u = Math.min(1, q.t / q.dur);
      let x, y, z;
      if (q.kind === 'meteor') { const w = Math.pow(u, 1.35); x = q.sx + (q.ex - q.sx) * w; y = q.sy + (q.ey - q.sy) * w; z = q.sz + (q.ez - q.sz) * w; }
      else { const arc = q.kind === 'water' ? 1 + 0.22 * Math.hypot(q.ex - q.sx, q.ez - q.sz) : 0.6; x = q.sx + (q.ex - q.sx) * u; z = q.sz + (q.ez - q.sz) * u; y = q.sy + (q.ey - q.sy) * u + Math.sin(u * Math.PI) * arc; }
      const vx = (x - q.px) / Math.max(1e-3, dt), vy = (y - q.py) / Math.max(1e-3, dt), vz = (z - q.pz) / Math.max(1e-3, dt);
      if (q.kind === 'meteor') {
        const G = HUE.green;
        alpha.spawn({ x, y, z, life: fdt(), size: 1.5, col: [G.body[0], G.body[1], G.body[2], 0.75], fout: 0, tile: TILE.disc });
        alpha.spawn({ x, y, z, life: fdt(), size: 0.8, col: G.core, fout: 0, tile: TILE.disc });
        alpha.spawn({ x, y, z, vx: vx * 0.02, vy: vy * 0.02, vz: vz * 0.02, life: fdt(), size: 0.5, col: G.hot, col1: [G.edge[0], G.edge[1], G.edge[2], 0], fout: 0.2, tile: TILE.streak, mode: MODE.stretch, stretch: 6, flags: FLAG.alignVel });
        for (let k = 0; k < 2; k++) alpha.spawn({ x: x + rr(-0.3, 0.3), y: y + rr(-0.3, 0.3), z: z + rr(-0.3, 0.3), vx: rr(-0.8, 0.8), vy: rr(0, 1.2), vz: rr(-0.8, 0.8), life: rr(0.35, 0.7), size: rr(0.25, 0.5), size1: 0.05, col: G.body, col1: [G.edge[0], G.edge[1], G.edge[2], 0], fout: 0.5, tile: TILE.disc, drag: 1.5 });
        // the landing marker: a green ring that closes in on the impact radius
        const mr = (q.r || 3) * 2 * (1.8 - 0.8 * u);
        alpha.spawn({ x: q.ex, y: floorAt(q.ex, q.ez) + 0.08, z: q.ez, life: fdt(), size: mr, col: [G.hot[0], G.hot[1], G.hot[2], 0.35 + 0.5 * u], fout: 0, tile: TILE.thinRing, mode: MODE.flat });
      } else if (q.kind === 'water' && !q.hidden) {
        alpha.spawn({ x, y, z, life: fdt(), size: 0.42, col: COL2.water, fout: 0, tile: TILE.disc });
        if (R() < 0.6) alpha.spawn({ x, y, z, vx: rr(-0.5, 0.5), vy: rr(-1, 0.5), vz: rr(-0.5, 0.5), life: 0.4, size: 0.07, col: COL2.water2, fout: 0.4, tile: TILE.square, grav: 12, floor: floorAt(x, z) });
      } else if (q.kind === 'hex' && !q.hidden) {
        const G = HUE.green, d = distCam(x, y, z), k = d < 2.5 ? 0.4 : 1;
        alpha.spawn({ x, y, z, life: fdt(), size: 0.62 * k, col: [G.edge[0], G.edge[1], G.edge[2], 0.85], fout: 0, tile: TILE.disc });
        alpha.spawn({ x, y, z, life: fdt(), size: 0.34 * k, col: G.hot, fout: 0, tile: TILE.disc });
        for (let a = 0; a < 2; a++) { const ang = q.t * 18 + a * Math.PI; alpha.spawn({ x: x + Math.cos(ang) * 0.38 * k, y: y + Math.sin(ang * 0.7) * 0.2, z: z + Math.sin(ang) * 0.38 * k, life: 0.12, size: 0.09 * k, col: G.core, fout: 0.5, tile: TILE.square, rot: 0.785 }); }
      }
      q.px = x; q.py = y; q.pz = z;
      if (u >= 1) { PR.splice(i, 1); land(q); }
    }
  }
  function land(q) {
    const x = q.ex, z = q.ez, gy = floorAt(x, z);
    if (q.kind === 'meteor') {
      const r = q.r || 3, G = HUE.green;
      hflash(x, gy + 0.6, z, r * 0.8, 'green', 0.16);
      ring(x, gy, z, r * 1.15, { col: G.body, col1: [G.edge[0], G.edge[1], G.edge[2], 0], life: 0.42, start: r * 0.3 });
      sparks(x, gy + 0.4, z, cnt(22), { speed: 9, up: 5, life: 0.55, size: 0.07, col: G.hot, col1: G.edge });
      debris(x, gy + 0.3, z, cnt(10), COL.stone, COL.clay, { speed: 6, up: 7, size: 0.16, life: 1.1, tile: TILE.chunk });
      embers(x, gy + 0.3, z, cnt(12), { spread: r * 0.3, rise: 4, life: 1.2, hue: 'green' });
      queue.schedule(0.08, () => puffs(x, gy + 0.6, z, cnt(4), COL.smokeLit, { col1: COL.smokeEnd, r: 1, size: 1, size1: 2.4, rise: 2.2, life: 1.4, spread: 1.4 }));
    } else if (q.kind === 'water') {
      const r = q.r || 2.5;
      debris(x, gy + 0.2, z, cnt(18), COL2.water, COL2.water2, { speed: 4.5, up: 5.5, size: 0.12, life: 0.65, grav: 16 });
      ring(x, gy, z, r, { col: [COL2.water[0], COL2.water[1], COL2.water[2], 0.6], life: 0.4, start: 0.4, tile: TILE.thinRing });
      puffs(x, gy + 0.2, z, cnt(5), COL2.steam, { col1: COL2.steamEnd, r: r * 0.6, size: 0.7, size1: 2.0, rise: 2.2, life: 1.6, spread: 1 });
      queue.schedule(0.3, () => puffs(x, gy + 0.3, z, cnt(4), COL2.steam, { col1: COL2.steamEnd, r: r * 0.5, size: 0.8, size1: 2.2, rise: 2.6, life: 1.6, spread: 0.8 }));
    } else if (q.kind === 'hex') {
      const y = q.ey + (q.hit ? 0 : 0.2), k = distCam(x, y, z) < 2.5 ? 0.35 : 1;
      hflash(x, y, z, 0.9 * k, 'green', 0.12);
      sparks(x, y, z, cnt(q.hit ? 10 : 6), { speed: 4, up: 2, life: 0.35, size: 0.04 * k, col: HUE.green.hot, col1: HUE.green.edge });
    }
  }

  // XP gems and gold coins: they spill, then fly to the gold counter / the XP bar after DROP_FLY_AFTER (DESIGN §9.3)
  const DQ = Math.max(24, Math.round(64 * K)); const DR = [];
  let dropNew = 0, xpDropSeen = false;
  function spill(kind, pos, n) {
    const p = P(pos); if (!p) return;
    if (Array.isArray(lastState?.pickups) && lastState.pickups.some((k) => k && (k.kind === 'xp' || k.fly != null))) { // real gems / coins exist
      if (kind === 'gold' && dropNew++ < 10) { const gy = groundHeight(p.x, p.z); for (let i = 0; i < 3; i++) add.spawn({ x: p.x + rr(-0.3, 0.3), y: Math.max(p.y ?? gy, gy) + rr(0.5, 1.1), z: p.z + rr(-0.3, 0.3), vy: rr(0.5, 1.5), life: 0.35, size: 0.1, size1: 0.22, col: COL.gold, fin: 0.3, fout: 0.5, tile: TILE.star }); }
      return;
    }
    const gy = groundHeight(p.x, p.z), y0 = Math.max(p.y ?? gy, gy) + 0.8;
    const k = Math.min(kind === 'gold' ? 6 : 4, Math.max(1, n | 0));
    for (let i = 0; i < k; i++) {
      if (DR.length >= DQ || dropNew >= 14) return;
      dropNew++;
      const a = rr(0, 6.283), sp = rr(1.2, 2.6);
      DR.push({ kind, x: p.x, y: y0, z: p.z, vx: Math.cos(a) * sp, vy: rr(3, 5), vz: Math.sin(a) * sp, t: 0, fly: (DROP_FLY_AFTER || 0.6) + rr(0, 0.15), dur: rr(0.45, 0.6),
        sx: 0, sy: 0, sz: 0, cx: 0, cy: 0, cz: 0, px: 0, py: 0, pz: 0 });
    }
  }
  const dTo = new THREE.Vector3();
  function stepDrops(dt) {
    if (!DR.length) return;
    for (let i = DR.length - 1; i >= 0; i--) {
      const d = DR[i]; d.t += dt;
      const gold = d.kind === 'gold';
      if (d.t < d.fly) {
        d.vy -= 16 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        const fl = floorAt(d.x, d.z) + 0.08;
        if (d.y < fl) { d.y = fl; d.vy = Math.abs(d.vy) * 0.38; d.vx *= 0.55; d.vz *= 0.55; }
        alpha.spawn({ x: d.x, y: d.y, z: d.z, life: fdt(), size: gold ? 0.2 : 0.17, col: gold ? COL2.coin : COL2.gem, fout: 0, tile: gold ? TILE.disc : TILE.diamond });
        if (gold) alpha.spawn({ x: d.x, y: d.y, z: d.z, life: fdt(), size: 0.11, col: COL2.coinEdge, fout: 0, tile: TILE.square, rot: 0.785 });
        if (d.t + dt >= d.fly) { // take off: an arc to the HUD
          d.sx = d.x; d.sy = d.y; d.sz = d.z; d.px = d.x; d.py = d.y; d.pz = d.z;
          camera.getWorldPosition(camPos);
          d.cx = (d.x + camPos.x) / 2 + rr(-1.5, 1.5); d.cz = (d.z + camPos.z) / 2 + rr(-1.5, 1.5); d.cy = Math.max(d.y, camPos.y) + rr(1.5, 3);
        }
        continue;
      }
      const ndc = gold ? DROP_TO.gold : DROP_TO.xp;
      screenPoint(dTo, ndc[0], ndc[1]);
      const u0 = Math.min(1, (d.t - d.fly) / d.dur), u = u0 * u0 * (1.6 - 0.6 * u0);
      const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
      const x = a * d.sx + b * d.cx + c * dTo.x, y = a * d.sy + b * d.cy + c * dTo.y, z = a * d.sz + b * d.cz + c * dTo.z;
      const fh = frameH(distCam(x, y, z));
      const vx = (x - d.px) / Math.max(1e-3, dt), vy = (y - d.py) / Math.max(1e-3, dt), vz = (z - d.pz) / Math.max(1e-3, dt), sp = Math.hypot(vx, vy, vz);
      const head = gold ? COL2.coin : COL.wisp, tail = gold ? lin('#b8861f', 1.2, 0) : COL.wispTail;
      if (sp > 0.01) alpha.spawn({ x, y, z, vx: vx * 0.02, vy: vy * 0.02, vz: vz * 0.02, life: 0.1, size: WISP.width * fh, col: head, col1: tail, fout: 0.4, tile: TILE.streak, mode: MODE.stretch, stretch: Math.min(sp * 0.035, WISP.tail * fh), flags: FLAG.alignVel });
      alpha.spawn({ x, y, z, life: fdt(), size: WISP.head * 1.15 * fh, col: head, fout: 0, tile: gold ? TILE.disc : TILE.diamond });
      d.px = x; d.py = y; d.pz = z;
      if (u0 >= 1) DR.splice(i, 1);
    }
  }

  // a charm on the ground: a burst, then a bobbing sparkle until it is picked up
  const CHM = [];
  function charmDrop(p) {
    const gy = floorAt(p.x, p.z);
    stars(p.x, gy + 0.8, p.z, cnt(18), { col: COL.gold, size: 0.22, speed: 3, life: 1, up: 3 });
    ring(p.x, gy, p.z, 2.2, { col: COL2.coin, life: 0.6, start: 0.3, tile: TILE.thinRing });
    hflash(p.x, gy + 0.8, p.z, 0.9, 'orange', 0.12);
    for (let i = 0; i < 8; i++) queue.schedule(i * 0.06, () => add.spawn({ x: p.x + rr(-0.2, 0.2), y: gy + 0.3, z: p.z + rr(-0.2, 0.2), vy: rr(3, 5), life: 0.6, size: 0.12, size1: 0.03, col: COL.gold, fout: 0.5, tile: TILE.star, drag: 1.5 }));
    if (CHM.length >= 4) CHM.shift();
    CHM.push({ x: p.x, z: p.z, gy, t: 0 });
  }
  function charmPickup() {
    const c = CHM.shift(); if (!c) return;
    stars(c.x, c.gy + 0.9, c.z, cnt(14), { col: COL.gold, size: 0.18, speed: 4, life: 0.7, up: 2 });
  }
  function stepCharms(dt) {
    for (let i = CHM.length - 1; i >= 0; i--) {
      const c = CHM[i]; c.t += dt;
      if (c.t > 10) { CHM.splice(i, 1); continue; }
      const y = c.gy + 0.75 + Math.sin(c.t * 3) * 0.12;
      alpha.spawn({ x: c.x, y, z: c.z, life: fdt(), size: 0.36, col: COL2.coin, fout: 0, tile: TILE.diamond, rot: Math.sin(c.t * 2) * 0.3 });
      alpha.spawn({ x: c.x, y, z: c.z, life: fdt(), size: 0.16, col: [1.6, 1.6, 1.5, 1], fout: 0, tile: TILE.diamond });
      if (R() < dt * 10) add.spawn({ x: c.x + rr(-0.35, 0.35), y: y + rr(-0.3, 0.4), z: c.z + rr(-0.35, 0.35), life: 0.4, size: 0.08, size1: 0.2, col: COL.gold, fin: 0.3, fout: 0.5, tile: TILE.star });
    }
  }

  /** the Obelisk's violet nova (the fluid draws the violet fire; this is the pulse's flash and ring) */
  function obeliskPulse(p, r, level) {
    const gy = floorAt(p.x, p.z), V = HUE.violet, cy = Number.isFinite(p.y) && p.y > gy + 1 ? p.y : gy + 3.2;   // pos.y = the core
    hflash(p.x, cy, p.z, 1.3 + 0.2 * (level || 1), 'violet', 0.16);
    ring(p.x, gy, p.z, r, { col: [V.body[0], V.body[1], V.body[2], 0.9], col1: [V.edge[0], V.edge[1], V.edge[2], 0], life: 0.45, start: 0.6, tile: TILE.thinRing });
    queue.schedule(0.08, () => ring(p.x, gy + 0.04, p.z, r * 1.05, { col: [V.hot[0], V.hot[1], V.hot[2], 0.55], col1: [V.edge[0], V.edge[1], V.edge[2], 0], life: 0.3, start: r * 0.6, tile: TILE.thinRing }));
    const n = cnt(14 + 4 * (level || 1));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rr(-0.1, 0.1), s = r / 0.42;
      alpha.spawn({ x: p.x + Math.cos(a) * 0.6, y: gy + 0.35, z: p.z + Math.sin(a) * 0.6, vx: Math.cos(a) * s, vy: rr(0.4, 1.4), vz: Math.sin(a) * s, life: 0.42 * rr(0.85, 1.05), size: 0.08,
        col: V.hot, col1: V.edge, fout: 0.5, tile: TILE.streak, mode: MODE.stretch, stretch: 1.1, flags: FLAG.alignVel | FLAG.growStretch, drag: 1.2 });
    }
    embers(p.x, cy - 0.4, p.z, cnt(6), { spread: 0.4, rise: 3, life: 1, hue: 'violet' });
  }
  /** a tower rises or levels up: a rune ring, a column of sparks in its hue, dust and stone */
  function towerBurst(ev, up) {
    const pd = padPos(ev.pad) || P(ev.pos); if (!pd) return;
    const kind = ev.tower || ev.kind;
    const gy = floorAt(pd.x, pd.z), hue = kind === 'obelisk' ? 'violet' : 'orange', H = hueOf(hue);
    ring(pd.x, gy, pd.z, up ? 2.6 : 2.0, { col: COL2.rune, life: 0.55, start: 0.4, tile: TILE.thinRing });
    ring(pd.x, gy, pd.z, 1.6, { col: COL.ringDust, life: 0.5, start: 0.5 });
    hflash(pd.x, gy + 1.2, pd.z, up ? 2.4 : 2.0, hue, 0.2);
    sparks(pd.x, gy + 0.4, pd.z, cnt(up ? 26 : 18), { speed: 4, up: 8, life: 0.8, size: 0.06, col: H.hot, col1: H.edge, dirY: 1.5 });
    stars(pd.x, gy + 0.5, pd.z, cnt(12), { col: COL.cyan, size: 0.16, speed: 2, life: 0.9, up: 4, r: 1 });
    puffs(pd.x, gy + 0.2, pd.z, cnt(5), COL.dust, { r: 1, size: 0.8, size1: 2, rise: 0.8, life: 1.1, spread: 1.8 });
    if (!up) debris(pd.x, gy + 0.3, pd.z, cnt(8), COL.stone, COL.stone2, { speed: 3.5, up: 5, size: 0.14, life: 0.9, tile: TILE.chunk });
  }

  // ------------------------------------------------------------------------------------------------------- THE ORGAN, BATS, PYRE BURST
  const BAT_KIND = () => ENEMY_KINDS.indexOf('bat');
  const COL3 = { shadow: lin('#05080a', 1, 0.42), dive: lin('#ff4a3a', 1.2), diveCore: lin('#ffd0c0', 1.3), feather: lin('#5a4636'), feather2: lin('#8a7560'),
    ash: lin('#9a948a', 1, 0.55), ashDark: lin('#5a5650', 1, 0.5), roar: lin('#e8e2d6', 1.05), roarHot: lin('#ff6a3a', 1.1), brass: lin('#c9a24a', 1.2) };
  /** dive telegraphs: a red ring at the target that closes over the dive (≤ 12) */
  const DV = [];
  function batDive(ev) {
    const to = P(ev.to) || P(ev.pos); if (!to) return;
    if (DV.length >= 12) DV.shift();
    DV.push({ x: to.x, z: to.z, t: 0, dur: Math.max(0.3, Number(ev.seconds) || Number(ev.t) || Number(ev.flight) || 1.2), id: ev.id });
  }
  /** shadows under every flying bat + the dive rings, redrawn each frame */
  function stepAir(dt, st) {
    for (let i = DV.length - 1; i >= 0; i--) {
      const d = DV[i]; d.t += dt; if (d.t > d.dur + 0.15) { DV.splice(i, 1); continue; }
      const u = Math.min(1, d.t / d.dur), gy = floorAt(d.x, d.z) + 0.06, a = 0.45 + 0.5 * u;
      alpha.spawn({ x: d.x, y: gy, z: d.z, life: fdt(), size: 2 * (2.4 - 1.8 * u), col: [COL3.dive[0], COL3.dive[1], COL3.dive[2], a], fout: 0, tile: TILE.thinRing, mode: MODE.flat });
      if ((d.t * 8 | 0) % 2 === 0) alpha.spawn({ x: d.x, y: gy + 0.01, z: d.z, life: fdt(), size: 0.35, col: COL3.diveCore, fout: 0, tile: TILE.diamond, mode: MODE.flat });
    }
    let n = 0;
    const draw = (x, y, z) => {
      if (n >= 24 || !Number.isFinite(x)) return;
      const gy = floorAt(x, z), alt = (y ?? gy) - gy; if (alt < 0.8) return;
      n++;
      const k = Math.max(0.15, 1 - alt / 12);
      alpha.spawn({ x, y: gy + 0.04, z, life: fdt(), size: 0.7 + alt * 0.06, col: [COL3.shadow[0], COL3.shadow[1], COL3.shadow[2], COL3.shadow[3] * k], fout: 0, tile: TILE.disc, mode: MODE.flat });
    };
    const air = Array.isArray(st?.air) ? st.air : Array.isArray(st?.bats) ? st.bats : null;   // the sim: state.air (≤ 12)
    if (air) { for (const b of air) if (b && b.alive !== false) draw(b.x, b.y, b.z); return; }
    const BK = BAT_KIND(), H = st?.horde;
    if (BK < 0 || !H || !H.kind) return;
    for (let i = 0; i < (H.count || 0) && n < 24; i++) if (H.kind[i] === BK && (H.state ? H.state[i] : 1) && H.hp[i] > 0) draw(H.x[i], H.y[i], H.z[i]);
  }
  /** a bat comes down: feathers drift, a dusty pop (burned: an orange pop and embers) */
  function batDeath(p, burned) {
    const y = Math.max(p.y, groundHeight(p.x, p.z) + 0.6);
    for (let i = 0; i < cnt(7); i++) { const a = rr(0, 6.283), s = rr(0.6, 2.2);
      alpha.spawn({ x: p.x, y, z: p.z, vx: Math.cos(a) * s, vy: rr(0.5, 2.5), vz: Math.sin(a) * s, life: rr(1.2, 2), size: rr(0.12, 0.2), col: R() < 0.5 ? COL3.feather : COL3.feather2, fout: 0.4, tile: TILE.shard, grav: 1.6, drag: 2.4, rot: rr(0, 6.28), rotV: rr(-5, 5), floor: floorAt(p.x, p.z) }); }
    if (burned) { hflash(p.x, y, p.z, 0.8, 'orange', 0.12); embers(p.x, y, p.z, cnt(5), { spread: 0.3, rise: 2 }); }
    else alpha.spawn({ x: p.x, y, z: p.z, life: 0.3, size: 0.5, size1: 1, sizeK: 3, col: COL.dustPale, fout: 0.2, tile: TILE.puff, rot: rr(0, 6) });
  }
  /** Pyre Burst: an orange pop where a fire kill bursts (≤ 8 a frame; the fluid draws the fire) */
  function pyrePop(p, r) {
    const gy = floorAt(p.x, p.z), y = Math.max(p.y ?? gy, gy) + 0.5;
    hflash(p.x, y, p.z, Math.min(2.4, r * 0.75), 'orange', 0.12);
    ring(p.x, gy, p.z, r, { col: COL.ring, life: 0.28, start: 0.4, tile: TILE.thinRing });
    sparks(p.x, y, p.z, cnt(6), { speed: 6, up: 3, life: 0.4, size: 0.05 });
  }
  /** Ash Roar: the cone telegraph on the ground (windup), then ash + steam through the cone (release) */
  const RO = [];
  function roarWindup(ev) {
    const p = P(ev.pos); if (!p) return;
    const d = ev.dir || {}; let dx = Number(d.x), dz = Number(d.z);
    const tr = lastState?.troll, pl = lastState?.player;
    if ((!Number.isFinite(dx) || !Number.isFinite(dz)) && tr && Number.isFinite(tr.yaw)) { dx = Math.sin(tr.yaw); dz = Math.cos(tr.yaw); }   // the sim turns the troll to the player at the windup
    if ((!Number.isFinite(dx) || !Number.isFinite(dz)) && pl) { dx = pl.x - p.x; dz = pl.z - p.z; }
    if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) < 1e-3) { const g = ARENA.gate.target; dx = g.x - p.x; dz = g.z - p.z; }
    const l = Math.hypot(dx, dz) || 1;
    if (RO.length >= 3) RO.shift();
    RO.push({ x: p.x, z: p.z, dx: dx / l, dz: dz / l, range: Number(ev.r ?? ev.range) || 12, half: Number(ev.angle) || 0.6, t: 0, dur: Math.max(0.4, Number(ev.windup) || 1.0) });   // the sim: angle = the half-angle
  }
  function stepRoar(dt) {
    for (let i = RO.length - 1; i >= 0; i--) {
      const c = RO[i]; c.t += dt; if (c.t > c.dur + 0.1) { RO.splice(i, 1); continue; }
      const u = Math.min(1, c.t / c.dur), base = Math.atan2(c.dx, c.dz), col = u > 0.75 && (c.t * 10 | 0) % 2 ? COL3.roarHot : COL3.roar;
      // the two edges and the far arc, as pixel squares on the ground; the fill grows from the troll to the range
      const edge = (ang, from, to, step) => { for (let r = from; r <= to; r += step) { const x = c.x + Math.sin(ang) * r, z = c.z + Math.cos(ang) * r; alpha.spawn({ x, y: floorAt(x, z) + 0.08, z, life: fdt(), size: 0.45, col: [col[0], col[1], col[2], 0.8], fout: 0, tile: TILE.square, mode: MODE.flat, rot: ang }); } };
      edge(base - c.half, 2, c.range, 0.75); edge(base + c.half, 2, c.range, 0.75);
      const arcN = Math.max(6, Math.round(c.range * c.half * 2 / 0.75));
      for (let k = 0; k <= arcN; k++) { const a = base - c.half + (2 * c.half * k) / arcN, x = c.x + Math.sin(a) * c.range, z = c.z + Math.cos(a) * c.range; alpha.spawn({ x, y: floorAt(x, z) + 0.08, z, life: fdt(), size: 0.45, col: [col[0], col[1], col[2], 0.8], fout: 0, tile: TILE.square, mode: MODE.flat, rot: a }); }
      // a red sweep fills the cone from the troll outward over the windup (what the roar will douse and stun)
      const fr = 2 + (c.range - 2) * u;
      for (let row = 0; row < 3; row++) {
        const rr0 = fr - row * 0.9; if (rr0 < 2) break;
        const fillN = Math.max(4, Math.round(rr0 * c.half * 2 / 0.9));
        for (let k = 0; k <= fillN; k++) { const a = base - c.half + (2 * c.half * k) / fillN, x = c.x + Math.sin(a) * rr0, z = c.z + Math.cos(a) * rr0; alpha.spawn({ x, y: floorAt(x, z) + 0.06, z, life: fdt(), size: 0.85, col: [COL3.dive[0], COL3.dive[1], COL3.dive[2], 0.4 - row * 0.1], fout: 0, tile: TILE.square, mode: MODE.flat, rot: a }); }
      }
    }
  }
  function roarRelease(ev) {
    const p = P(ev.pos); const c = RO.find((r) => p && Math.hypot(r.x - p.x, r.z - p.z) < 3) || RO[RO.length - 1];
    const x0 = p ? p.x : c?.x, z0 = p ? p.z : c?.z; if (!Number.isFinite(x0)) return;
    let dx = Number(ev.dir?.x), dz = Number(ev.dir?.z); if (!Number.isFinite(dx) || !Number.isFinite(dz)) { dx = c?.dx ?? 0; dz = c?.dz ?? 1; }
    const l = Math.hypot(dx, dz) || 1, range = Number(ev.r ?? ev.range) || c?.range || 12, half = Number(ev.angle) || c?.half || 0.6, base = Math.atan2(dx / l, dz / l);
    if (c) RO.splice(RO.indexOf(c), 1);
    for (let k = 0; k < cnt(14); k++) { const a = base + rr(-half, half), r = rr(2, range), x = x0 + Math.sin(a) * r, z = z0 + Math.cos(a) * r;
      queue.schedule(r / 22, () => puffs(x, floorAt(x, z) + 0.3, z, 1, R() < 0.5 ? COL3.ash : COL2.steam, { col1: COL2.steamEnd, r: 0.5, size: 1, size1: 2.6, rise: 1.6, life: 1.4, spread: 1.2 })); }
    const gy = floorAt(x0, z0);
    puffs(x0, gy + 1.5, z0, cnt(5), COL3.ash, { col1: COL.smokeEnd, r: 1.4, size: 1.2, size1: 3, rise: 1.4, life: 1.6, spread: 2 });
  }

  // ------------------------------------------------------------------------------------------------------- DESIGN §6.3
  const COL4 = { water: lin('#8fd0ff', 1.2), waterDeep: lin('#3a86d0', 1.1), foam: lin('#f2faff', 1.3), lane: lin('#bfe6ff', 1.15, 0.9) };
  /** the Rainmother's tidal waves: a lane to where it goes, then a foaming front sweeping along it (≤ 4) */
  const TW = [];
  function tideWave(ev) {
    const f = P(ev.from), to = P(ev.to); if (!f || !to) return;
    if (TW.length >= 4) TW.shift();
    TW.push({ fx: f.x, fz: f.z, tx: to.x, tz: to.z, w: Number(ev.width) || 6, t: 0, warn: Math.max(0, Number(ev.warn) || 0.8), dur: Math.max(0.6, Number(ev.t ?? ev.seconds ?? ev.flight) || 2.2) });
  }
  /** whirlpools: two spiral arms of water turning inward, a ring at r (≤ 4) */
  const WP = [];
  function whirlpool(ev) {
    const p = P(ev.pos); if (!p) return;
    if (WP.length >= 4) WP.shift();
    WP.push({ x: p.x, z: p.z, r: Number(ev.r) || 5, t: 0, dur: Math.max(1, Number(ev.t ?? ev.seconds) || 6) });
  }
  function stepTide(dt) {
    for (let i = TW.length - 1; i >= 0; i--) {
      const w = TW[i]; w.t += dt; if (w.t > w.warn + w.dur + 0.2) { TW.splice(i, 1); continue; }
      const dx = w.tx - w.fx, dz = w.tz - w.fz, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L, px = -uz, pz = ux;
      // the lane: dashed edges from the front to the end (a warning: where the water will run)
      const u = Math.max(0, Math.min(1, (w.t - w.warn) / w.dur)), front = L * easeIn2(u);
      for (let s = front; s <= L; s += 1.4) for (const side of [-1, 1]) {
        const x = w.fx + ux * s + px * side * w.w / 2, z = w.fz + uz * s + pz * side * w.w / 2;
        alpha.spawn({ x, y: floorAt(x, z) + 0.06, z, life: fdt(), size: 0.6, col: COL4.lane, fout: 0, tile: TILE.square, mode: MODE.flat, rot: Math.atan2(ux, uz) });
      }
      if (w.t < w.warn) continue;
      // the front: a foaming line across the lane, spray rising off it
      const n = Math.max(6, Math.round(w.w / 0.6));
      for (let k = 0; k <= n; k++) {
        const o = (k / n - 0.5) * w.w, x = w.fx + ux * front + px * o, z = w.fz + uz * front + pz * o, gy = floorAt(x, z);
        alpha.spawn({ x, y: gy + 0.08, z, life: fdt(), size: 1.2, col: k % 2 ? COL4.water : COL4.foam, fout: 0, tile: TILE.square, mode: MODE.flat, rot: Math.atan2(ux, uz) });
        alpha.spawn({ x: x - ux * 0.9, y: gy + 0.07, z: z - uz * 0.9, life: fdt(), size: 1.1, col: COL4.waterDeep, fout: 0, tile: TILE.square, mode: MODE.flat, rot: Math.atan2(ux, uz) });
        if (R() < 0.35) alpha.spawn({ x, y: gy + 0.3, z, vx: ux * 3 + rr(-0.5, 0.5), vy: rr(2, 4.5), vz: uz * 3 + rr(-0.5, 0.5), life: rr(0.4, 0.7), size: rr(0.08, 0.16), col: COL4.foam, col1: COL4.water, fout: 0.5, tile: TILE.square, grav: 12 });
      }
    }
    for (let i = WP.length - 1; i >= 0; i--) {
      const q = WP[i]; q.t += dt; if (q.t > q.dur) { WP.splice(i, 1); continue; }
      const a0 = q.t * 2.6, fade = Math.min(1, q.t / 0.4, (q.dur - q.t) / 0.5), gy = floorAt(q.x, q.z) + 0.07;
      for (let arm = 0; arm < 2; arm++) for (let k = 0; k < 14; k++) {
        const f = k / 14, a = a0 + arm * Math.PI + f * 4.2, rr0 = q.r * (1 - f * 0.85);
        alpha.spawn({ x: q.x + Math.sin(a) * rr0, y: gy, z: q.z + Math.cos(a) * rr0, life: fdt(), size: 0.75 - 0.35 * f, col: [(k % 3 ? COL4.water : COL4.foam)[0], (k % 3 ? COL4.water : COL4.foam)[1], (k % 3 ? COL4.water : COL4.foam)[2], 0.95 * fade], fout: 0, tile: TILE.square, mode: MODE.flat, rot: a });
      }
      alpha.spawn({ x: q.x, y: gy - 0.01, z: q.z, life: fdt(), size: q.r * 2, col: [COL4.waterDeep[0], COL4.waterDeep[1], COL4.waterDeep[2], 0.7 * fade], fout: 0, tile: TILE.thinRing, mode: MODE.flat, rot: a0 });
    }
  }
  const easeIn2 = (u) => u * u * (3 - 2 * u);

  // ------------------------------------------------------------------------------------------------------- DESIGN §10.4
  /** Ember Gale: a hot gust sweeps from the keep's wall down the slope for `seconds`: ember streaks riding it, a pale heat
   *  shimmer, a bright front running ahead (the fluid leans and flares the fire itself: the sim's wind points downhill) */
  const GL = [];
  function gale(ev) {
    let dx = Number(ev.dir?.x), dz = Number(ev.dir?.z);
    if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) < 1e-3) { dx = 0; dz = 1; }
    const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    if (GL.length >= 2) GL.shift();
    GL.push({ dx, dz, t: 0, dur: Math.max(0.8, Number(ev.seconds) || 2.5), k: Math.max(0.6, Math.min(1.6, (Number(ev.strength) || 4.5) / 4.5)) });
  }
  const COL5 = { shimmer: lin('#ffb070', 1.0, 0.045), shimmerEnd: lin('#ff9a50', 1.0, 0), streak: lin('#ffd24a', 1.35), streakEnd: lin('#e85a1c', 1.1, 0), front: lin('#fff2b8', 1.5) };
  function stepGale(dt) {
    // the gust HUGS THE GROUND — fine warm streaks 0.2–2.5 m over the terrain that follow the slope
    // downhill (their vertical speed follows the ground's gradient), none within 5 m of the lens (no speed-line overlay),
    // no shimmer discs; a few ember motes at the running front
    camera.getWorldPosition(camPos);
    for (let i = GL.length - 1; i >= 0; i--) {
      const q = GL[i]; q.t += dt; if (q.t > q.dur) { GL.splice(i, 1); continue; }
      const u = q.t / q.dur, fade = Math.min(1, q.t / 0.25, (q.dur - q.t) / 0.4), px = -q.dz, pz = q.dx;
      const x0 = ARENA.keep.x0 + 2, x1 = ARENA.keep.x1 + 6, wallZ = ARENA.keep.z1 + 0.6, front = 2 + 26 * u, sp = 11 * q.k;
      const n = Math.round(cnt(9) * fade);
      for (let k = 0; k < n; k++) {
        const along = rr(0, Math.max(1, front - 1)), x = x0 + (x1 - x0) * R() + q.dx * along, z = wallZ + q.dz * along;
        const gy = groundHeight(x, z), h = rr(0.2, 2.5), y = gy + h;
        if ((x - camPos.x) ** 2 + (y - camPos.y) ** 2 + (z - camPos.z) ** 2 < 25) continue;
        const vx = q.dx * sp * rr(0.85, 1.15), vz = q.dz * sp * rr(0.85, 1.15);
        const slope = (groundHeight(x + q.dx, z + q.dz) - gy);   // metres of drop per metre downhill
        alpha.spawn({ x, y, z, vx, vy: slope * Math.hypot(vx, vz) + rr(-0.2, 0.2), vz, life: rr(0.3, 0.5), size: rr(0.05, 0.075),
          col: COL5.streak, col1: COL5.streakEnd, fout: 0.5, tile: TILE.streak, mode: MODE.stretch, stretch: 1.4, flags: FLAG.alignVel, drag: 0.2 });
      }
      // a barely-there warm haze skimming the ground just behind the front
      if (R() < 0.25 * fade) {
        const x = x0 + (x1 - x0) * R(), z = wallZ + q.dz * Math.max(0, front - rr(1, 6)), gy = groundHeight(x, z);
        if ((x - camPos.x) ** 2 + (z - camPos.z) ** 2 > 64) alpha.spawn({ x, y: gy + rr(0.3, 0.9), z, vx: q.dx * sp * 0.5, vz: q.dz * sp * 0.5, life: rr(0.5, 0.8), size: rr(1.2, 1.8), size1: rr(2.4, 3.2), sizeK: 2,
          col: COL5.shimmer, col1: COL5.shimmerEnd, fin: 0.4, fout: 0.6, tile: TILE.puff, drag: 0.6, rot: rr(0, 6.28) });
      }
      // the front: a few ember motes skipping along the ground ahead of the gust
      if (u < 0.92) for (let k = 0; k < cnt(2); k++) {
        const x = x0 + (x1 - x0) * R() + q.dx * front, z = wallZ + q.dz * front, gy = groundHeight(x, z);
        if ((x - camPos.x) ** 2 + (z - camPos.z) ** 2 < 25) continue;
        alpha.spawn({ x, y: gy + rr(0.2, 0.9), z, vx: q.dx * sp, vy: rr(0.2, 1), vz: q.dz * sp, life: rr(0.2, 0.32), size: 0.06, col: COL5.front, col1: COL5.streakEnd, fout: 0.5, tile: TILE.ember, drag: 0.5, grav: 3 });
      }
    }
  }
  /** Cinder Steps on the wall walk: a short lilac spill over the parapet, a few bigger glowing cinders among
   *  small ones falling to `pos` at the wall's foot, and a flash + a small ring where they land */
  function wallCinders(ev) {
    const f = P(ev.from), p = P(ev.pos); if (!f || !p) return;
    const L = HUE.lilac, fy = Number.isFinite(f.y) ? f.y : ARENA.keep.walkY + 1.1, gy = floorAt(p.x, p.z);
    const drop = Math.max(0.5, fy - gy), T = Math.sqrt((2 * drop) / 12);   // grav 12
    // the spill: a handful of small lilac motes tipping over the parapet edge (billboards: no velocity streaks, which
    // projected as long lines from a lens a metre above them on the walk)
    for (let k = 0; k < cnt(5); k++) alpha.spawn({ x: f.x + rr(-0.35, 0.35), y: fy + 0.05, z: f.z + rr(0, 0.2), vx: rr(-0.3, 0.3), vy: rr(-0.8, 0.4), vz: rr(0.6, 1.2), life: 0.4, size: 0.1, size1: 0.04,
      col: L.hot, col1: [L.body[0], L.body[1], L.body[2], 0], fout: 0.4, tile: TILE.ember, grav: 8 });
    hflash(f.x, fy + 0.1, f.z, 0.55, 'lilac', 0.12);
    // the cinders: 3 big glowing ones and a few small ones, each with a short streak
    for (let k = 0; k < cnt(9); k++) {
      const big = k < 3, tt = T * rr(0.92, 1.12), vx = (p.x - f.x) / tt + rr(-0.35, 0.35), vz = (p.z - f.z) / tt + rr(-0.25, 0.25), vy = rr(-0.2, 0.5);
      const x = f.x + rr(-0.3, 0.3), y = fy + rr(-0.05, 0.15), z = f.z + rr(0, 0.15);
      alpha.spawn({ x, y, z, vx, vy, vz, life: tt + 0.12, size: big ? rr(0.42, 0.52) : rr(0.18, 0.26), size1: big ? 0.2 : 0.1, col: big ? L.core : L.hot, col1: L.body, fout: 0.25, tile: TILE.ember, grav: 12, drag: 0.1, floor: gy + 0.05 });
    }
    queue.schedule(T, () => {
      hflash(p.x, gy + 0.3, p.z, 1.0, 'lilac', 0.16);
      ring(p.x, gy, p.z, 1.1, { col: L.hot, col1: [L.body[0], L.body[1], L.body[2], 0], life: 0.3, start: 0.2, tile: TILE.thinRing });
      embers(p.x, gy + 0.2, p.z, cnt(5), { spread: 0.4, rise: 2.4, life: 0.9, size: 0.12, hue: 'lilac' });
    });
  }

  // ---------------------------------------------------------------------------------------------- DESIGN §4.5: heavy ground hits
  // Every round's impact goes into a small typed-array queue (no closure per pellet) and lands when its tracer arrives.
  // Surfaces: the sim's `surf` on the pellet ('enemy' | 'ground' | 'stone' | 'wood' | 'air'), else inferred from hitId and
  // `to` against the ground and the keep's boxes. The THUNDER ORGAN's ground hits are heavy (a dirt spray of chunks + dust,
  // a pock mark that lingers ≈ 3 s, a churn of dust between consecutive hits so a sweep chews a line); stone throws sparks
  // and chips; the Kestrel and the Blunderbuss get lighter versions. No sounds (the audio code's one-sound-per-gun rule).
  const SURF = { air: 0, enemy: 1, ground: 2, stone: 3, wood: 4 };
  const IMP_N = 256;
  const impX = new Float32Array(IMP_N), impY = new Float32Array(IMP_N), impZ = new Float32Array(IMP_N), impT = new Float32Array(IMP_N);
  const impUx = new Float32Array(IMP_N), impUz = new Float32Array(IMP_N), impS = new Uint8Array(IMP_N), impW = new Uint8Array(IMP_N);
  let impN = 0;
  const COL6 = { dirt: lin('#5a4030', 1.0), dirt2: lin('#7d5c3c', 1.05), dust: lin('#a08c70', 1.0, 0.5), smoke: lin('#6a5e54', 1, 0.34), smokeEnd: lin('#4a423c', 1, 0), churned: lin('#5e4028', 1.05, 0.95), churnedEnd: lin('#3a2818', 1, 0), scorch: lin('#ff8a3a', 1.6), scorchEnd: lin('#a02a10', 1, 0), dustEnd: lin('#8a7c6a', 1, 0), pock: lin('#0e0905', 1, 0.75), pockEnd: lin('#2a1c12', 1, 0),
    chip: lin('#8a949c', 1.1), chip2: lin('#5a646c', 1.0), spark: lin('#fff2b8', 1.5), sparkEnd: lin('#ff9a2e', 1.2, 0), stoneDust: lin('#9aa2a8', 1, 0.45), stoneDustEnd: lin('#9aa2a8', 1, 0), stoneMark: lin('#1a1c1e', 1, 0.7), stoneMarkEnd: lin('#1a1c1e', 1, 0), dirtEnd: lin('#5a4030', 1.0, 0) };
  const KEEP6 = (() => { const k = ARENA.keep, out = [], wh = k.wallHeight + (k.parapetH || 1.1);
    for (const tw of k.towers || []) out.push([tw.x - tw.half, tw.z - tw.half, tw.x + tw.half, tw.z + tw.half, tw.height + 1.6]);
    out.push([k.x0, k.z1 - k.wallThick, k.x1, k.z1, wh], [k.x0, k.z0, k.x1, k.z0 + k.wallThick, wh], [k.x0, k.z0, k.x0 + k.wallThick, k.z1, wh], [k.x1 - k.wallThick, k.z0, k.x1, k.z1, wh]);
    return out; })();
  function surfOf(pl, to) {
    const s = pl?.surf;
    if (typeof s === 'string' && s in SURF) return SURF[s];
    if (pl?.hitId != null) return SURF.enemy;
    const g = ARENA.gate, gy = groundHeight(to.x, to.z);
    if (Math.abs(to.z - g.z) < 0.7 && to.x > g.x0 - 0.2 && to.x < g.x1 + 0.2 && to.y < g.height + 0.3) return SURF.wood;
    for (const b of KEEP6) if (to.x > b[0] - 0.25 && to.x < b[2] + 0.25 && to.z > b[1] - 0.25 && to.z < b[3] + 0.25 && to.y < b[4] + 0.2) return SURF.stone;
    if (to.y - gy < 0.45) return SURF.ground;
    return SURF.air;   // the ray ran out of range in the air: no impact
  }
  function queueImpact(x, y, z, ux, uz, delay, surf, wcode) {
    if (surf === SURF.air) return;
    if (impN >= IMP_N) return;   // a full queue drops the newest impacts (never allocates)
    const i = impN++;
    impX[i] = x; impY[i] = y; impZ[i] = z; impUx[i] = ux; impUz[i] = uz; impT[i] = clock + delay; impS[i] = surf; impW[i] = wcode;
  }
  let lastGx = 0, lastGz = 0, lastGt = -9;
  const impLanded = [0, 0, 0, 0, 0];   // by surface (tools / the cost report)
  function landImpact(x, y, z, ux, uz, surf, wcode) {
    impLanded[surf]++;
    const heavy = wcode === 2, light = wcode === 1;   // 2 Organ, 1 Blunderbuss pellet, 0 Kestrel
    if (surf === SURF.enemy) { hitMark(x, y, z, false); debris(x, y, z, cnt(heavy ? 2 : light ? 2 : 4), COL.ichor, COL.ichor2, { speed: 2.4, up: 2.5, size: 0.09, life: 0.5, grav: 14 }); return; }
    if (surf === SURF.wood) { splinters(x, y, z, cnt(heavy ? 2 : 1)); return; }
    // readable at range: the spray, dust and flashes grow with the distance from the lens (×1 within 9 m … ×2.4)
    const kd = Math.max(1, Math.min(2.4, distCam(x, y, z) / 9));
    if (surf === SURF.stone) {
      alpha.spawn({ x: x - ux * 0.05, y, z: z - uz * 0.05, life: 0.05, size: 0.3 * kd, col: COL6.spark, fout: 0.5, tile: TILE.disc });
      sparks(x, y, z, cnt(heavy ? 6 : light ? 2 : 4), { speed: 7, up: 2.5, life: 0.3, size: 0.065 * kd, col: COL6.spark, col1: COL6.sparkEnd, dirX: -ux * 0.8, dirZ: -uz * 0.8 });
      if (!light || R() < 0.5) debris(x, y, z, cnt(heavy ? 3 : 1), COL6.chip, COL6.chip2, { speed: 2.8, up: 3, size: 0.07 * kd, life: 0.7, grav: 16 });
      if (heavy || !light) { alpha.spawn({ x, y, z, vy: 0.35, life: 0.6, size: 0.3 * kd, size1: 0.9 * kd, sizeK: 3, col: COL6.stoneDust, col1: COL6.stoneDustEnd, fout: 0.3, tile: TILE.puff, drag: 2, rot: rr(0, 6) });
        alpha.spawn({ x: x - ux * 0.02, y, z: z - uz * 0.02, life: heavy ? 2.2 : 1.4, size: 0.16, col: COL6.stoneMark, col1: COL6.stoneMarkEnd, fout: 0.6, tile: TILE.square, rot: rr(0, 6) }); }
      return;
    }
    // the ground: a quick flash, a geyser of dirt chunks and spray kicked back toward the shooter and up, a dust burst,
    // and a dark pock mark that lingers (raised a little so the environment's grass does not swallow it)
    const gy = groundHeight(x, z), y0 = gy + 0.06;
    if (!light || R() < 0.35) alpha.spawn({ x, y: y0 + 0.15, z, life: 0.05, size: (heavy ? 0.4 : 0.3) * kd, size1: 0.1 * kd, col: COL6.spark, fout: 0.5, tile: TILE.disc });
    const nChunks = heavy ? cnt(6) : light ? (R() < 0.7 ? 1 : 2) : cnt(3);
    for (let k = 0; k < nChunks; k++) {
      const a = rr(0, 6.283), sp2 = rr(0.8, 2.6);
      alpha.spawn({ x, y: y0 + 0.05, z, vx: Math.cos(a) * sp2 - ux * rr(0.8, 2.4), vy: rr(heavy ? 4 : 2.8, heavy ? 7 : 4.6), vz: Math.sin(a) * sp2 - uz * rr(0.8, 2.4), life: rr(0.6, 1.0), size: rr(0.09, heavy ? 0.17 : 0.12) * kd,
        col: R() < 0.5 ? COL6.dirt : COL6.dirt2, fout: 0.75, tile: TILE.chunk, grav: 16, drag: 0.4, rot: rr(0, 6.28), rotV: rr(-12, 12), flags: FLAG.bounce, floor: y0 + 0.02 });
    }
    if (heavy || !light) for (let k = 0; k < (heavy && K > 0.6 ? 2 : 1); k++) alpha.spawn({ x, y: y0 + 0.1, z, vx: -ux * rr(0.5, 1.5) + rr(-0.8, 0.8), vy: rr(5, 8), vz: -uz * rr(0.5, 1.5) + rr(-0.8, 0.8), life: rr(0.25, 0.4), size: 0.05 * kd,
      col: COL6.dirt2, col1: COL6.dirtEnd, fout: 0.5, tile: TILE.streak, mode: MODE.stretch, stretch: 0.5 * kd, flags: FLAG.alignVel, grav: 14 });
    if (heavy || !light || R() < 0.5) alpha.spawn({ x: x - ux * 0.15, y: y0 + 0.25, z: z - uz * 0.15, vx: -ux * 0.8, vy: heavy ? 1.3 : 0.8, vz: -uz * 0.8, life: heavy ? 0.9 : 0.7, size: (heavy ? 0.45 : 0.32) * kd, size1: (heavy ? 1.5 : 1.1) * kd, sizeK: 3,
      col: COL6.dust, col1: COL6.dustEnd, fout: 0.3, tile: TILE.puff, drag: 2, rot: rr(0, 6) });
    // the scorch: an Organ round leaves a hot ember point that cools, and a thin smoulder that lingers above the grass
    if (heavy) {
      add.spawn({ x, y: y0 + 0.08, z, life: 0.9, size: 0.16 * kd, size1: 0.06 * kd, col: COL6.scorch, col1: COL6.scorchEnd, fout: 0.8, tile: TILE.disc });
      if (R() < 0.5 * K * K) alpha.spawn({ x, y: y0 + 0.35, z, vx: rr(-0.1, 0.1), vy: 0.45, life: 2.6, size: 0.22 * kd, size1: 0.75 * kd, sizeK: 2, col: COL6.smoke, col1: COL6.smokeEnd, fin: 0.2, fout: 0.5, tile: TILE.puff, drag: 1, rot: rr(0, 6) });
    }
    // the pock: a ring of thrown-up brown earth (it reads against the night grass, where a black mark alone did not) with a
    // dark crater at its heart; both fade over the last two thirds of their life
    if (heavy || !light || R() < 0.5) {
      const ps = heavy ? rr(0.6, 0.8) : light ? rr(0.26, 0.34) : rr(0.38, 0.46), pl = heavy ? 3.2 : light ? 1.8 : 2.4;
      alpha.spawn({ x, y: y0 + 0.06, z, life: pl, size: ps, col: COL6.churned, col1: COL6.churnedEnd, fout: 0.65, tile: TILE.disc, mode: MODE.flat, rot: rr(0, 6.28) });
      if (K > 0.6) alpha.spawn({ x, y: y0 + 0.08, z, life: pl, size: ps * 0.5, col: COL6.pock, col1: COL6.pockEnd, fout: 0.65, tile: TILE.disc, mode: MODE.flat, rot: rr(0, 6.28) });
    }
    // the churn: consecutive Organ hits close together raise a low sheet of dust between them, so a sweep chews a line
    if (heavy) {
      const dx = x - lastGx, dz = z - lastGz, d2 = dx * dx + dz * dz;
      if (clock - lastGt < 0.2 && d2 < 9 && d2 > 0.01 && (K > 0.6 || R() < 0.5)) {
        const mx = (x + lastGx) / 2, mz = (z + lastGz) / 2, my = groundHeight(mx, mz) + 0.3, dd = Math.sqrt(d2);
        alpha.spawn({ x: mx, y: my, z: mz, vy: 0.5, life: 0.8, size: (0.7 + dd * 0.4) * kd, size1: (1.8 + dd * 0.5) * kd, sizeK: 3, col: COL6.dust, col1: COL6.dustEnd, fout: 0.35, tile: TILE.puff, drag: 2, rot: rr(0, 6) });
      }
      lastGx = x; lastGz = z; lastGt = clock;
    }
  }
  function stepImpacts() {
    let landed = 0;
    for (let i = impN - 1; i >= 0; i--) {
      if (impT[i] > clock) continue;
      if (landed < BUDGET.imp) { landed++; landImpact(impX[i], impY[i], impZ[i], impUx[i], impUz[i], impS[i], impW[i]); }
      const j = --impN;   // swap-remove (a skipped impact past the budget is dropped: never a backlog)
      impX[i] = impX[j]; impY[i] = impY[j]; impZ[i] = impZ[j]; impT[i] = impT[j]; impUx[i] = impUx[j]; impUz[i] = impUz[j]; impS[i] = impS[j]; impW[i] = impW[j];
    }
  }

  // no more "1111111" strings over a big fight. Hits merge per target over NUM_MERGE s into one number; at
  // most NUM_CAP numbers are on screen; ticks that are not the player's own shots (towers, the orbit, pyres, blasts) get a
  // number only when their merged total is large (NUM_BIG); the troll's always do. Fixed typed slots, no allocation.
  const NUM_MERGE = 0.25, NUM_CAP = Math.round(12 + 8 * K), NUM_BIG = 40, NS = 48;
  const nsId = new Int32Array(NS), nsT = new Float32Array(NS), nsSum = new Float32Array(NS), nsF = new Uint8Array(NS);   // flags: 1 crit, 4 troll
  const nsX = new Float32Array(NS), nsY = new Float32Array(NS), nsZ = new Float32Array(NS);
  let nsN = 0;
  const numEnd = new Float32Array(64); let numEndI = 0;   // when each recent number fades (the on-screen count)
  const myId = new Int32Array(32).fill(-999999), myT = new Float32Array(32); let myI = 0;   // the player's recent hits (EV.SHOT hitId)
  function noteMine(id) { myId[myI] = id; myT[myI] = clock; myI = (myI + 1) & 31; }
  function isMine(id) { for (let k = 0; k < 32; k++) if (myId[k] === id && clock - myT[k] < 0.6) return true; return false; }
  function queueNum(id, x, y, z, dmg, flags) {
    if (!(dmg > 0)) return;
    for (let k = 0; k < nsN; k++) if (nsId[k] === id) { nsSum[k] += dmg; nsX[k] = x; nsY[k] = y; nsZ[k] = z; nsF[k] |= flags; return; }
    if (nsN >= NS) return;
    const k = nsN++; nsId[k] = id; nsT[k] = clock; nsSum[k] = dmg; nsX[k] = x; nsY[k] = y; nsZ[k] = z; nsF[k] = flags;
  }
  // and no pile-ups: a number that would land on one shown less than NUM_GAP_T s ago (within NUM_GAP in screen space) is dropped
  const NUM_GAP = [0.045, 0.06], NUM_GAP_T = 0.22, nsSx = new Float32Array(24), nsSy = new Float32Array(24), nsSt = new Float32Array(24).fill(-9); let nsSi = 0;
  const numV = new THREE.Vector3();
  function numCrowded(x, y, z) {
    numV.set(x, y, z).project(camera);
    if (numV.z > 1 || Math.abs(numV.x) > 1.1 || Math.abs(numV.y) > 1.1) return true;   // behind the lens or off screen
    for (let q = 0; q < 24; q++) if (clock - nsSt[q] < NUM_GAP_T && Math.abs(nsSx[q] - numV.x) < NUM_GAP[0] && Math.abs(nsSy[q] - numV.y) < NUM_GAP[1]) return true;
    nsSx[nsSi] = numV.x; nsSy[nsSi] = numV.y; nsSt[nsSi] = clock; nsSi = (nsSi + 1) % 24;
    return false;
  }
  function numOnScreen() { let c = 0; for (let q = 0; q < 64; q++) if (numEnd[q] > clock) c++; return c; }
  function stepNums() {
    if (!nsN) return;
    let onScreen = -1;
    for (let k = nsN - 1; k >= 0; k--) {
      if (clock - nsT[k] < NUM_MERGE) continue;
      const f = nsF[k], sum = nsSum[k];
      // (the SHOT that made a hit is emitted after its E_HIT, so "mine" is asked here, at the flush)
      if ((f & 5) || sum >= NUM_BIG || (nsId[k] >= 0 && isMine(nsId[k]))) {
        if (onScreen < 0) onScreen = numOnScreen();
        if (onScreen < NUM_CAP && ((f & 4) || !numCrowded(nsX[k], nsY[k], nsZ[k])) && take('num')) { number(nsX[k] + rr(-0.15, 0.15), nsY[k], nsZ[k] + rr(-0.15, 0.15), sum, !!(f & 1), !!(f & 4)); onScreen++; }
      }
      const j = --nsN;
      nsId[k] = nsId[j]; nsT[k] = nsT[j]; nsSum[k] = nsSum[j]; nsF[k] = nsF[j]; nsX[k] = nsX[j]; nsY[k] = nsY[j]; nsZ[k] = nsZ[j];
    }
  }

  /** a floating damage number (pixel digits, constant-ish screen size) */
  function number(x, y, z, value, crit = false, troll = false) {
    const v = Math.max(1, Math.round(value));
    const s = String(Math.min(99999, v));
    camera.getWorldPosition(camPos);
    const dist = Math.max(1, Math.hypot(x - camPos.x, y - camPos.y, z - camPos.z));
    let size = Math.min(2.6, Math.max(0.1, dist * 0.026)) * (crit ? 1.7 : troll ? 1.3 : 1);
    const col = crit ? COL.numCrit : troll ? COL.numTroll : COL.num;
    const vy0 = size * rr(2.6, 3.4), vx0 = rr(-0.6, 0.6) * size * 2, life = crit ? 0.95 : 0.7;
    const n = s.length + (crit ? 1 : 0);
    numEnd[numEndI] = clock + life; numEndI = (numEndI + 1) & 63;
    for (let i = 0; i < n; i++) {
      const tile = i < s.length ? TILE.digit0 + (s.charCodeAt(i) - 48) : TILE.bang;
      nums.spawn({ x, y, z, vx: vx0, vy: vy0, vz: 0, life, size: size * 1.7, size1: size, sizeK: 8, col, fout: 0.65, tile, offX: (i - (n - 1) / 2) * 0.68, drag: 3.2, grav: 0 });
    }
  }

  /** a cyan wisp from a kill toward the XP bar (merged: kills within 0.08 s of the last wisp ride it) */
  function wisp(x, y, z) {
    if (wAlive >= WN || (lastWispAt >= 0 && clock - lastWispAt < WISP.every)) return;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    lastWispAt = clock;
    const gy = groundHeight(x, z);
    const y0 = (Number.isFinite(y) ? Math.max(y, gy) : gy) + 1.3;
    camera.getWorldPosition(camPos);
    const i = wAlive++;
    wsx[i] = x; wsy[i] = y0; wsz[i] = z;
    // the arc's control point: halfway, lifted 1.5–3.5 m and pushed sideways so a batch fans out
    const mx = (x + camPos.x) / 2, mz = (z + camPos.z) / 2, d = Math.hypot(camPos.x - x, camPos.z - z) || 1;
    const side = rr(-0.35, 0.35) * Math.min(8, d);
    wcx[i] = mx + (-(camPos.z - z) / d) * side; wcz[i] = mz + ((camPos.x - x) / d) * side;
    wcy[i] = Math.max(y0, camPos.y) + rr(1.5, 3.5);
    wt[i] = 0; wdur[i] = rr(WISP.flight[0], WISP.flight[1]) * Math.min(1.35, 0.8 + d / 60);
    wpx[i] = x; wpy[i] = y0; wpz[i] = z;
    const fh = frameH(Math.hypot(x - camPos.x, y0 - camPos.y, z - camPos.z));
    alpha.spawn({ x, y: y0, z, life: 0.16, size: WISP.head * 1.8 * fh, size1: WISP.head * 0.6 * fh, col: COL.wisp, fout: 0.5, tile: TILE.disc });
  }
  function stepWisps(dt) {
    if (!wAlive) return;
    // the target: a point WISP.depth m ahead that projects onto the XP bar (top left), so the wisps fly into the bar
    camera.getWorldPosition(camPos); camera.getWorldDirection(camFwd);
    camera.updateMatrixWorld(); wR.setFromMatrixColumn(camera.matrixWorld, 0).normalize(); wU.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const tv = Math.tan(((/** @type {any} */ (camera).fov || 78) * Math.PI) / 360), th = tv * (/** @type {any} */ (camera).aspect || 16 / 9), D = WISP.depth;
    wTo.copy(camPos).addScaledVector(camFwd, D).addScaledVector(wR, WISP.ndc[0] * D * th).addScaledVector(wU, WISP.ndc[1] * D * tv);
    for (let i = wAlive - 1; i >= 0; i--) {
      wt[i] += dt;
      const u0 = Math.min(1, wt[i] / wdur[i]), u = u0 * u0 * (1.6 - 0.6 * u0); // accelerates toward the player
      const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
      const x = a * wsx[i] + b * wcx[i] + c * wTo.x, y = a * wsy[i] + b * wcy[i] + c * wTo.y, z = a * wsz[i] + b * wcz[i] + c * wTo.z;
      const vx = (x - wpx[i]) / Math.max(1e-3, dt), vy = (y - wpy[i]) / Math.max(1e-3, dt), vz = (z - wpz[i]) / Math.max(1e-3, dt);
      const sp = Math.hypot(vx, vy, vz);
      // drawn through the alpha pool (saturated cyan stays cyan over the orange fire), sized in screen space: a few-px
      // round head and a short tail at any distance, so a wisp never grows into a beam or a cross near the lens
      const fh = frameH(Math.hypot(x - camPos.x, y - camPos.y, z - camPos.z));
      if (sp > 0.01) alpha.spawn({ x, y, z, vx: vx * 0.02, vy: vy * 0.02, vz: vz * 0.02, life: 0.1, size: WISP.width * fh, col: COL.wisp, col1: COL.wispTail, fout: 0.4, tile: TILE.streak, mode: MODE.stretch, stretch: Math.min(sp * 0.035, WISP.tail * fh), flags: FLAG.alignVel });
      alpha.spawn({ x, y, z, life: 0.03, size: WISP.head * fh, col: COL.wisp, fout: 0.9, tile: TILE.disc });
      wpx[i] = x; wpy[i] = y; wpz[i] = z;
      if (u0 >= 1) { // arrived: swap-remove
        const j = --wAlive;
        wsx[i] = wsx[j]; wsy[i] = wsy[j]; wsz[i] = wsz[j]; wcx[i] = wcx[j]; wcy[i] = wcy[j]; wcz[i] = wcz[j];
        wt[i] = wt[j]; wdur[i] = wdur[j]; wpx[i] = wpx[j]; wpy[i] = wpy[j]; wpz[i] = wpz[j];
      }
    }
  }

  // ---------------------------------------------------------------------------------------------- events
  const isHorde = (k) => typeof k === 'string' ? ENEMY_KINDS.includes(k) : Number.isInteger(k);
  /** @param {any} p */
  const P = (p) => (p && Number.isFinite(p.x) ? p : null);

  function onShot(ev) {
    const w = ev.weapon;
    const m = muzzle(tmp.set(0, 0, 0), null);
    const mx = m.x, my = m.y, mz = m.z;
    if (w === 'blunderbuss') {
      flash(mx, my, mz, 0.75, COL.core, 0.07); flash(mx, my, mz, 1.1, COL.yellow, 0.05, TILE.bigStar);
      camera.getWorldDirection(camFwd);
      for (let i = 0; i < 3; i++) alpha.spawn({ x: mx + camFwd.x * (0.9 + i * 0.35), y: my + camFwd.y * 0.9 + 0.05, z: mz + camFwd.z * (0.9 + i * 0.35), vx: camFwd.x * rr(1.5, 3), vy: rr(0.2, 0.6), vz: camFwd.z * rr(1.5, 3),
        life: rr(0.35, 0.55), size: 0.14, size1: 0.5, sizeK: 3, col: lin('#8f8878', 1, 0.4), fout: 0.25, tile: TILE.puff, drag: 3, rot: rr(0, 6) });
    } else if (w === 'organ' || w === 'minigun') { // DESIGN §4.2: 18 rounds/s — a small flash that alternates, a casing every third shot
      organN++;   // (no casings: at the muzzle, 0.5 m from the lens, any brass square drew as a big yellow block)
      flash(mx, my, mz, organN % 2 ? 0.34 : 0.26, COL.core, 0.04); if (organN % 2) flash(mx, my, mz, 0.48, COL.yellow, 0.035, TILE.star);

    } else if (w !== 'lance') {
      flash(mx, my, mz, 0.42, COL.core, 0.055); flash(mx, my, mz, 0.6, COL.yellow, 0.04, TILE.star);
    }
    const pel = Array.isArray(ev.pellets) ? ev.pellets : [];
    const thin = w === 'blunderbuss' || w === 'organ' || w === 'minigun';
    for (let i = 0; i < pel.length; i++) {
      const hid = pel[i]?.hitId; if (Number.isInteger(hid) && hid >= 0) noteMine(hid);
      const to = P(pel[i]?.to); if (!to) continue;
      const ddx = to.x - mx, ddy = to.y - my, ddz = to.z - mz, dist = Math.hypot(ddx, ddy, ddz);
      if (dist < 0.3) continue;
      const sp = 240, ux = ddx / dist, uy = ddy / dist, uz = ddz / dist;
      alpha.spawn({ x: mx + ux * 0.6, y: my + uy * 0.6, z: mz + uz * 0.6, vx: ux * sp, vy: uy * sp, vz: uz * sp, life: Math.max(0.03, (dist - 0.6) / sp), size: thin ? 0.045 : 0.06,
        col: COL.tracer, col1: COL.tracerEnd, fout: 0.8, tile: TILE.streak, mode: MODE.stretch, stretch: thin ? 2.4 : 3.4, flags: FLAG.alignVel | FLAG.growStretch });
      // impact (after the tracer arrives): into the impact queue (DESIGN §4.5; no closure per pellet)
      queueImpact(to.x, to.y, to.z, ux, uz, dist / sp, surfOf(pel[i], to), w === 'organ' || w === 'minigun' ? 2 : w === 'blunderbuss' ? 1 : 0);
    }
  }

  function onEvent(ev, state) {
    if (!ev || !ev.type) return;
    if (state) lastState = state;
    // DESIGN §12: the ending's lens passes close to the pads; the towers' combat FX keep out of it
    if (state?.mode === 'ending' && (ev.type === EV.OBELISK_PULSE || ev.type === EV.CHAIN_THROW || ev.type === EV.CHAIN_HOOK || ev.type === EV.SHOT)) return;
    const p = P(ev.pos);
    if (ev.type === EV_XP) { // { value, n, from: [{x,y,z}…] }
      xpEvSeen = true;
      if (xpDropSeen) return;   // DESIGN §9: the XP gems spill and fly from EV.XP_DROP instead
      const fr = Array.isArray(ev.from) ? ev.from : ev.pos ? [ev.pos] : [];
      const q = P(fr[(fr.length / 2) | 0]); if (q && distCam(q.x, q.y ?? 0, q.z) > 5) wisp(q.x, q.y, q.z);   // one wisp for the batch; gems credited at the chest only pulse the bar
      return;
    }
    switch (ev.type) {
      case EV.SHOT: onShot(ev); break;
      case EV.DRY: { const m = muzzle(tmp, null); alpha.spawn({ x: m.x, y: m.y, z: m.z, vy: 0.4, life: 0.5, size: 0.08, size1: 0.25, col: COL.dustPale, fout: 0.3, tile: TILE.puff, drag: 2 }); break; }
      case EV.E_HIT: {
        if (!p) break;
        const src = ev.source;
        if (src === 'fire') break; // burn ticks: the burning sprite and its embers say it
        if (ev.crit && src === 'bullet') hitMark(p.x, p.y + 0.3, p.z, true);
        {
          const hy = p.y < groundHeight(p.x, p.z) + 0.5 ? p.y + (ev.kind === 'brute' || ev.kind === 3 ? 2.1 : 1.25) : p.y + 0.35;
          queueNum(Number.isInteger(ev.id) ? ev.id : -1, p.x, hy, p.z, ev.dmg || 0, ev.crit ? 1 : 0);
        }
        if (src === 'blast' && take('hit')) debris(p.x, p.y + 0.5, p.z, cnt(3), COL.ichor, COL.ichor2, { speed: 3, up: 4, size: 0.1, life: 0.6 });
        break;
      }
      case EV.E_DEATH: {
        if (p && (ev.kind === 'bat' || (Number.isInteger(ev.kind) && ev.kind === BAT_KIND() && ev.kind >= 0))) { if (take('death')) batDeath(p, !!ev.burned); break; }
        if (p && !xpEvSeen && state?.mode !== 'victory' && state?.mode !== 'fallen') wisp(p.x, p.y, p.z); // XP per kill until the sim's xp.gain arrives
        if (!p || !take('death')) break;
        const imp = ev.kind === 'imp' || ev.kind === 1;
        const y0 = p.y < groundHeight(p.x, p.z) + 0.5 ? p.y + 0.5 : p.y;
        if (ev.burned) {
          puffs(p.x, y0, p.z, 1, COL.smoke, { col1: COL.smokeEnd, r: 0.3, size: 0.45, size1: 1.1, rise: 1.4, life: 1.0, spread: 0.6 });
          embers(p.x, y0, p.z, cnt(4), { spread: 0.35, rise: 2.5, life: 0.9 });
        } else {
          alpha.spawn({ x: p.x, y: y0, z: p.z, life: 0.32, size: 0.5, size1: 1.1, sizeK: 3, col: COL.dustPale, fout: 0.2, tile: TILE.puff, rot: rr(0, 6) });
          debris(p.x, y0, p.z, cnt(6), imp ? COL.impIchor : COL.ichor, imp ? COL.crimson : COL.ichor2, { speed: 3.2, up: 4.5, size: 0.1, life: 0.75 });
        }
        break;
      }
      case EV.E_IGNITE: if (p && take('ignite')) { alpha.spawn({ x: p.x, y: p.y + 0.6, z: p.z, life: 0.18, size: 0.8, size1: 0.15, col: COL.yellow, col1: COL.ember, fout: 0.85, tile: TILE.disc }); embers(p.x, p.y + 0.6, p.z, cnt(2), { spread: 0.25 }); } break;
      case EV.BOMB_BURST: if (p) burst(p.x, p.y, p.z, ev.r || 3.5, false); break;
      case EV.BARREL_BURST: if (p) burst(p.x, p.y, p.z, 4.2, true); break;
      case EV.SUNBURST: if (p) sunburst(p.x, p.y, p.z, ev.r || 14); break;
      case EV.PICKUP: {
        if (!p) break;
        if (ev.kind === 'gold') debris(p.x, p.y + 0.3, p.z, cnt(5), COL.gold, lin('#d9c26a', 1.4), { speed: 1.5, up: 3, size: 0.08, life: 0.5, pool: add, tile: TILE.diamond, grav: 10 });
        // DESIGN §3.4: heart pickups are gone (no heal drops); 'xp' gems sparkle nothing
        break;
      }
      case EV.LEVEL_UP: {
        const pl = state?.player;
        camera.getWorldPosition(camPos); camera.getWorldDirection(camFwd);
        const x = pl ? pl.x : camPos.x, z = pl ? pl.z : camPos.z, y = camPos.y - 0.2;
        stars(x + camFwd.x * 1.5, y, z + camFwd.z * 1.5, cnt(28), { r: 2.5, speed: 4.5, life: 1.1, size: 0.16, up: 2.5 });
        stars(x, y - 1.2, z, cnt(20), { r: 3, speed: 3.5, life: 1.3, size: 0.2, up: 3.5 });
        ring(x, floorAt(x, z) - 0.05, z, 3.2, { col: COL.cyan, life: 0.6, tile: TILE.thinRing });
        break;
      }
      case EV.KINDLE: kindle(); break;
      case EV.TROUGH_LIT: {
        const tr = ARENA.oil.troughs.find((t) => t.id === ev.id);
        if (!tr) break;
        const n = cnt(10);
        for (let i = 0; i < n; i++) {
          const u = (i + 0.5) / n, long = tr.x1 - tr.x0 > tr.z1 - tr.z0;
          const x = long ? tr.x0 + (tr.x1 - tr.x0) * u : (tr.x0 + tr.x1) / 2, z = long ? (tr.z0 + tr.z1) / 2 : tr.z0 + (tr.z1 - tr.z0) * u;
          queue.schedule(u * 0.35, () => { flash(x, floorAt(x, z) + 0.5, z, 1.4, COL.yellow, 0.25); embers(x, floorAt(x, z) + 0.4, z, cnt(3), { spread: 0.5, rise: 4 }); });
        }
        break;
      }
      case EV.T_STEP: if (p) puffs(p.x, floorAt(p.x, p.z), p.z, cnt(3), COL.dust, { r: 1.2, size: 0.8, size1: 2, rise: 0.6, life: 1, spread: 1.8 }); break;
      case EV.T_STOMP: if (p) {
        const r = ev.r || 5, y = floorAt(p.x, p.z);
        ring(p.x, y, p.z, r, { col: COL.ringDust, pool: alpha, life: 0.55, tile: TILE.ring, start: 1 });
        ring(p.x, y, p.z, r * 0.8, { col: lin('#d8d1c4', 1.2, 0.8), life: 0.35, tile: TILE.thinRing, start: 1 });
        for (let i = 0; i < cnt(14); i++) { const a = rr(0, 6.283); puffs(p.x + Math.cos(a) * r * 0.6, y, p.z + Math.sin(a) * r * 0.6, 1, COL.dust, { r: 0.4, size: 0.9, size1: 2.2, rise: 0.8, life: 1.1, spread: 2.5 }); }
        debris(p.x, y + 0.2, p.z, cnt(12), COL.stone, COL.dust, { speed: 6, up: 6, size: 0.18, life: 1.1, tile: TILE.chunk });
      } break;
      case EV.T_BOULDER: if (p) {
        const y = floorAt(p.x, p.z);
        ring(p.x, y, p.z, ev.r || 2.5, { col: COL.ringDust, pool: alpha, life: 0.5, start: 0.6 });
        debris(p.x, y + 0.3, p.z, cnt(16), COL.stone, COL.stone2, { speed: 6, up: 7, size: 0.22, life: 1.3, tile: TILE.chunk });
        puffs(p.x, y, p.z, cnt(8), COL.dust, { r: 1.2, size: 1, size1: 2.6, rise: 1, life: 1.3, spread: 2.2 });
      } break;
      case EV.T_SMASH: if (p) {
        const y = floorAt(p.x, p.z);
        if (ev.target === 'gate') { splinters(p.x, Math.max(y + 1.5, p.y), p.z, cnt(18)); puffs(p.x, y, p.z, cnt(6), COL.dust, { r: 1.5, size: 1, size1: 2.4, rise: 1.2, life: 1.2 }); }
        else { ring(p.x, y, p.z, 3.5, { col: COL.ringDust, pool: alpha, life: 0.5, start: 0.8 }); puffs(p.x, y, p.z, cnt(8), COL.dust, { r: 1.5, size: 1, size1: 2.4, rise: 1, life: 1.2, spread: 2 }); }
      } break;
      case EV.T_WINDUP: if (ev.move === 'roar') { roarWindup(ev); break; } if (p && ev.move === 'stomp') puffs(p.x, floorAt(p.x, p.z), p.z, cnt(2), COL.dust, { r: 1, size: 0.6, size1: 1.4, rise: 0.4, life: 0.8 }); break;
      case EV.T_GLOW: if (ev.on) { const t = state?.troll; if (t) { sparks(t.x, t.y + 4, t.z, cnt(18), { speed: 6, up: 4, life: 0.6, size: 0.07 }); embers(t.x, t.y + 3.5, t.z, cnt(14), { spread: 1.6, rise: 3 }); } } break;
      case EV.T_HURT: if (p) queueNum(-2, p.x + rr(-0.6, 0.6), (p.y < groundHeight(p.x, p.z) + 1 ? p.y + rr(3.5, 5.5) : p.y), p.z + rr(-0.6, 0.6), ev.dmg || 0, ev.glowing ? 5 : 4); break;
      case EV.T_DEATH: if (p) {
        const y = floorAt(p.x, p.z);
        for (let i = 0; i < 4; i++) queue.schedule(i * 0.18, () => puffs(p.x + rr(-1.5, 1.5), y + rr(0.5, 4), p.z + rr(-1.5, 1.5), cnt(6), COL.ash, { r: 1.5, size: 1.4, size1: 3.4, rise: 1.6, life: 2, spread: 1.8 }));
        embers(p.x, y + 2, p.z, cnt(30), { spread: 2, rise: 4, life: 1.6, size: 0.1 });
        ring(p.x, y, p.z, 7, { col: COL.ringDust, pool: alpha, life: 0.8, start: 2 });
      } break;
      case EV.GATE_HIT: if (p && take('gate') && clock - lastGateT > 0.12) { lastGateT = clock; splinters(p.x, Math.max(p.y, 0.8 + R() * 2.2), p.z, cnt(Math.min(6, 1 + (ev.dmg || 4) / 6))); } break;
      case EV.GATE_BREACH: { const g = ARENA.gate; splinters((g.x0 + g.x1) / 2, 2, g.z + 0.4, cnt(48)); puffs(0, 0.2, 1, cnt(12), COL.dust, { r: 2.5, size: 1.2, size1: 3, rise: 1.4, life: 1.6, spread: 2 }); } break;
      case EV.SPEAR_HIT: if (p && ev.target !== 'player') { sparks(p.x, p.y, p.z, cnt(3), { speed: 3, life: 0.25, size: 0.03 }); puffs(p.x, floorAt(p.x, p.z), p.z, 1, COL.dust, { r: 0.1, size: 0.3, size1: 0.8, rise: 0.4, life: 0.6, spread: 0.4 }); } break;
      case EV.P_HEAL: { // DESIGN §3.4: heals come only from a level-up (+10 % max HP: the level-up stars say it) and Hearthblood in fire
        if (ev.source !== 'hearthblood') break;
        camera.getWorldPosition(camPos); camera.getWorldDirection(camFwd);
        embers(camPos.x + camFwd.x * 1.4, camPos.y - 1.3, camPos.z + camFwd.z * 1.4, cnt(6), { spread: 0.6, rise: 1.8, life: 0.8, size: 0.06 });
        break;
      }
      case EV.RETRY: clear(); break;
      // ---- DESIGN §9
      case EV.OBELISK_PULSE: if (p) obeliskPulse(p, ev.r || 4.5, ev.level || 1); break;
      case EV.CHAIN_THROW: chainThrow(ev); break;
      case EV.CHAIN_HOOK: chainHook(ev); break;
      case EV.ORBIT_HIT: if (p && take('hit')) { hflash(p.x, p.y + 0.6, p.z, 0.7, 'blue', 0.1); sparks(p.x, p.y + 0.6, p.z, cnt(5), { speed: 4, up: 2, life: 0.3, size: 0.045, col: HUE.blue.hot, col1: HUE.blue.edge }); } break;
      case EV.METEOR: launch('meteor', P(ev.from), p, Number(ev.flight) || 0.8, { r: ev.r || 3 }); break;
      case EV.GALE: case 'gale': gale(ev); break;   // DESIGN §10.4 Ember Gale
      case EV.TRAIL: if (ev.wall && ev.from) { if (take('ignite')) wallCinders(ev); break; }   // Cinder Steps from the wall walk
        if (p && take('ignite')) { const gy = floorAt(p.x, p.z); hflash(p.x, gy + 0.3, p.z, 0.75, 'lilac', 0.14); embers(p.x, gy + 0.2, p.z, cnt(6), { spread: 0.4, rise: 2.2, life: 0.9, size: 0.1, hue: 'lilac' }); } break;
      case EV.GOLD_DROP: spill('gold', ev.pos, ev.n || 1); break;
      case EV.XP_DROP: xpDropSeen = true; spill('xp', ev.pos, ev.n || 1); break;
      case EV.CHARM_DROP: if (p) charmDrop(p); break;
      case EV.CHARM_PICKUP: charmPickup(); break;
      case EV.DOUSE_THROW: { // thrown now, lands after ev.flight; the actors draw the bucket in flight when state.splashes exists
        const f = P(ev.from), to = P(ev.to);
        if (f && to) launch('water', { x: f.x, y: (f.y ?? groundHeight(f.x, f.z)) + 1.3, z: f.z }, to, Number(ev.flight) > 0 ? Number(ev.flight) : Math.min(0.9, Math.max(0.35, Math.hypot(to.x - f.x, to.z - f.z) / 11)), { r: ev.r || 2.5, hidden: Array.isArray(state?.splashes) });
        break;
      }
      case EV.HEX: { // HEX comes at the landing (the actors drew the orb in flight); without state.hexes the bench flies its own
        const f = P(ev.from), to = P(ev.to); if (!to) break;
        const end = { x: to.x, y: (to.y ?? groundHeight(to.x, to.z)) + (ev.hit ? 1.1 : 0.3), z: to.z };
        if (Array.isArray(state?.hexes) || !f) land({ kind: 'hex', ex: end.x, ey: end.y, ez: end.z, hit: !!ev.hit });
        else launch('hex', { x: f.x, y: (f.y ?? groundHeight(f.x, f.z)) + 1.2, z: f.z }, end, 0.45, { hit: !!ev.hit });
        break;
      }
      case EV.TOWER_BUILD: towerBurst(ev, false); break;    // { pad, tower, level, cost, pos } (`tower`, not `type`)
      case EV.TOWER_UPGRADE: towerBurst(ev, true); break;
      case EV.CAMP_ENTER: case EV.RUN_START: clear(); break;
      // ---- the Organ, bats, Pyre Burst (the sim's own names are accepted too)
      case 'air.dive': case 'bat.dive': batDive(ev); break;
      case 'air.death': case 'bat.death': if (p && take('death')) batDeath(p, !!ev.burned); break;
      case 'air.crash': case 'bat.crash': if (p) { const gy = floorAt(p.x, p.z); hflash(p.x, gy + 0.4, p.z, 1.2, 'orange', 0.14); ring(p.x, gy, p.z, 1.6, { col: COL.ring, life: 0.3, start: 0.3, tile: TILE.thinRing }); sparks(p.x, gy + 0.3, p.z, cnt(10), { speed: 6, up: 4, life: 0.45, size: 0.05 }); embers(p.x, gy + 0.3, p.z, cnt(6), { spread: 0.5, rise: 3 }); } break;
      case 'pyre.burst': if (p && take('pyre')) pyrePop(p, Number(ev.r) || 1.6); break;
      case 'troll.roar': roarRelease(ev); break;
      // ---- DESIGN §6.3 (aliases accepted)
      case 'boss.hex': { const to = P(ev.to); if (to) land({ kind: 'hex', ex: to.x, ey: (to.y ?? groundHeight(to.x, to.z)) + (ev.hit ? 1.1 : 0.3), ez: to.z, hit: !!ev.hit }); break; }   // her shamans' hex
      case 'boss.tide': case 'boss.wave': tideWave({ ...ev, warn: ev.windup ?? ev.warn }); break;   // the sim: {from, to, width, windup}
      case 'boss.whirl': case 'boss.whirlpool': whirlpool(ev); break;                              // the sim: {pos, r, seconds}
      case 'boss.death': case 'rainmother.death': if (p) { puffs(p.x, floorAt(p.x, p.z) + 4, p.z, cnt(14), COL2.steam, { col1: COL2.steamEnd, r: 5, size: 3, size1: 8, rise: 2.4, life: 3.5, spread: 3 }); } break;
      case EV.CAMP_LEAVE: queue.schedule(1.45, () => kindle()); break;   // accents on the environment's lamp flare (1.4 s)
      default: break;
    }
  }

  function splinters(x, y, z, n) {
    debris(x, y, z, n, COL.wood, COL.wood2, { speed: 4.5, up: 5, size: 0.14, life: 1.1, tile: TILE.shard, grav: 16 });
  }

  /** firebomb / barrel: white-hot flash, pixel bang, debris, sparks, a ground shock ring, smoke puffs above the fluid fire */
  function burst(x, y, z, r, barrel) {
    const gy = floorAt(x, z), cy = Math.max(gy + 0.4, y);
    alpha.spawn({ x, y: cy + 0.4, z, life: 0.16, size: r * 1.25, size1: r * 0.2, sizeK: 1.6, col: COL.core, col1: COL.ember, fout: 0.9, tile: TILE.disc, rot: rr(0, 6.28) });
    alpha.spawn({ x, y: cy + 0.5, z, life: 0.1, size: r * 1.25, size1: r * 0.6, col: COL.yellow, fout: 0.1, tile: TILE.bigStar, rot: rr(0, 6.28) });
    alpha.spawn({ x, y: cy + 0.6, z, life: 0.08, size: r * 0.55, col: [1, 1, 1, 1], fout: 0.5, tile: TILE.disc });
    // chunky pixel fireball discs (round pixel blobs)
    const nb = cnt(barrel ? 9 : 6);
    for (let i = 0; i < nb; i++) {
      const a = rr(0, 6.283), d = rr(0.2, 0.7) * r;
      alpha.spawn({ x: x + Math.cos(a) * d * 0.6, y: cy + rr(0.2, 1.2) * (barrel ? 1.4 : 1), z: z + Math.sin(a) * d * 0.6, vx: Math.cos(a) * rr(1, 3), vy: rr(1.5, 3.5), vz: Math.sin(a) * rr(1, 3),
        life: rr(0.3, 0.5), size: r * rr(0.3, 0.5), size1: r * rr(0.12, 0.25), col: R() < 0.35 ? COL.yellow : R() < 0.7 ? COL.orange : COL.ember, col1: COL.crimson, fout: 0.85, tile: TILE.disc, drag: 3 });
    }
    ring(x, gy, z, r * 1.15, { col: COL.ring, life: 0.32, start: r * 0.3 });
    ring(x, gy, z, r * 1.25, { col: COL.ringDust, pool: alpha, life: 0.4, start: r * 0.4 });
    sparks(x, cy, z, cnt(barrel ? 26 : 18), { speed: 9, up: 4, life: 0.55, size: 0.06 });
    debris(x, cy, z, cnt(barrel ? 10 : 8), COL.clay, COL.stone, { speed: 5, up: 6, size: 0.13, life: 1 });
    if (barrel) debris(x, cy + 0.5, z, cnt(10), COL.wood, COL.wood2, { speed: 6, up: 8, size: 0.2, life: 1.3, tile: TILE.shard });
    queue.schedule(0.08, () => puffs(x, cy + 0.6, z, cnt(barrel ? 6 : 4), COL.smokeLit, { col1: COL.smokeEnd, r: r * 0.35, size: r * 0.3, size1: r * 0.75, rise: 2.4, life: 1.6, spread: 1.4 }));
    queue.schedule(0.05, () => embers(x, cy, z, cnt(barrel ? 24 : 14), { spread: r * 0.3, rise: 4.5, life: 1.3 }));
  }

  function sunburst(x, y, z, r) {
    const gy = floorAt(x, z);
    ring(x, gy, z, r, { col: COL.core, col1: [COL.orange[0], COL.orange[1], COL.orange[2], 0], life: 0.9, start: 1, tile: TILE.ring });
    queue.schedule(0.12, () => ring(x, gy + 0.05, z, r * 0.92, { col: COL.yellow, life: 0.85, start: 0.8, tile: TILE.thinRing }));
    const n = cnt(48);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283, s = r / 0.9;
      alpha.spawn({ x: x + Math.cos(a) * 1.2, y: gy + 0.4, z: z + Math.sin(a) * 1.2, vx: Math.cos(a) * s, vy: rr(0.5, 2), vz: Math.sin(a) * s, life: 0.9 * rr(0.8, 1),
        size: 0.09, col: COL.yellow, col1: COL.crimson, fout: 0.6, tile: TILE.streak, mode: MODE.stretch, stretch: 1.4, flags: FLAG.alignVel | FLAG.growStretch, drag: 0.4 });
    }
  }

  function kindle() {
    const b = ARENA.beacon.basket;
    // every kindle sprite is capped to ≈ ¼ of the frame height at the kindle glance's lens (≈ 7.5 m from the
    // basket, FOV ≈ 66°; the kindle is only ever made from the pan, so the viewer is always that close) and the blooms
    // are soft discs only: the pixel bigStars (5–7.5 m) and the flat rings (r 6 / 11) filled the glance with hard
    // cream wedges. The environment's flare gives the glow, the column and the light; these are the accents.
    camera.getWorldPosition(camPos);
    const dCam = Math.min(7.5, Math.max(3, Math.hypot(camPos.x - b.x, camPos.y - b.y, camPos.z - b.z)));
    const cap = 0.25 * 2 * dCam * Math.tan((66 / 2) * Math.PI / 180);   // ≈ 2.4 m
    const S = (v) => Math.min(v, cap);
    alpha.spawn({ x: b.x, y: b.y + 1, z: b.z, life: 0.4, size: S(4.2), size1: 0.5, sizeK: 1.5, col: COL.core, col1: COL.ember, fout: 0.85, tile: TILE.disc });
    for (let i = 0; i < cnt(7); i++) { const a = rr(0, 6.283), d = rr(0.3, 1.6); alpha.spawn({ x: b.x + Math.cos(a) * d, y: b.y + rr(0.5, 2.5), z: b.z + Math.sin(a) * d, vx: Math.cos(a) * 1.5, vy: rr(2, 4), vz: Math.sin(a) * 1.5, life: rr(0.35, 0.6), size: S(rr(1.0, 1.8)), size1: 0.3, col: R() < 0.5 ? COL.yellow : COL.orange, col1: COL.crimson, fout: 0.85, tile: TILE.disc, drag: 2 }); }
    sparks(b.x, b.y + 1, b.z, cnt(40), { speed: 12, up: 8, life: 0.9, size: 0.09, grav: 9 });
    for (let i = 0; i < 4; i++) queue.schedule(i * 0.15, () => embers(b.x, b.y + 0.8, b.z, cnt(14), { spread: 1.2, rise: 7, life: 2.2, size: 0.12 }));
    queue.schedule(0.2, () => puffs(b.x, b.y + 2.2, b.z, cnt(4), COL.smoke, { col1: COL.smokeEnd, r: 1, size: S(1.2), size1: S(3.2), rise: 2.8, life: 2.2, spread: 0.8 }));
    // at the flare beat: a second soft white-gold bloom and a pillar of sparks shooting 12–18 m up; then an ember fountain
    queue.schedule(0.22, () => {
      alpha.spawn({ x: b.x, y: b.y + 1.6, z: b.z, life: 0.5, size: S(5.2), size1: 1.2, sizeK: 1.4, col: COL.core, col1: COL.orange, fout: 0.55, tile: TILE.disc });
      const n = cnt(46);
      for (let i = 0; i < n; i++) {
        const a = rr(0, 6.283), r0 = rr(0, 0.9), up = rr(14, 24);
        alpha.spawn({ x: b.x + Math.cos(a) * r0, y: b.y + 1, z: b.z + Math.sin(a) * r0, vx: Math.cos(a) * rr(0.5, 2.2), vy: up, vz: Math.sin(a) * rr(0.5, 2.2), life: rr(0.6, 1.1),
          size: rr(0.08, 0.14), col: R() < 0.5 ? COL.core : COL.yellow, col1: COL.ember, fout: 0.55, tile: TILE.streak, mode: MODE.stretch, flags: FLAG.alignVel, grav: 14, drag: 0.6 });
      }
    });
    for (let i = 0; i < 6; i++) queue.schedule(0.3 + i * 0.25, () => embers(b.x, b.y + 1.4, b.z, cnt(12), { spread: 0.9, rise: 9, life: 1.8, size: 0.14 }));
  }

  // ---------------------------------------------------------------------------------------------- per frame
  /** @param {number} dt @param {any} state */
  // the ending's own light (the environment owns the sky and the grade): a full-frame additive wash (a black-point
  // lift, a red flood from the top) and red glows: a halo round the lamp's pillar (lamp → portal), and the opened gate lit
  // from the inside behind the marching host, so the host reads as black silhouettes against red instead of black on
  // black. Driven by the ending's clock and TIMELINE.ending's beats; off (invisible, no draw) outside the ending.
  // (the shading is per edition, decision 0001: gfx().materials.fxWashMaterial in src/gfx/{webgl2,webgpu}/materials/fx.js)
  const washMat = gfx().materials.fxWashMaterial();
  const washU = washMat.uniforms;   // uTop, uBot: THREE.Vector3 (linear RGB)
  const wash = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), washMat);
  wash.frustumCulled = false; wash.renderOrder = 35; wash.visible = false; wash.name = 'ew-fx-ending-wash';
  root.add(wash);
  const EB6 = (() => { const b = {}; for (const x of (TIMELINE?.ending?.beats || [])) b[x.id] = x.at; return { lamp: b.lamp ?? 5, portal: b.portal ?? 8, world: b.world ?? 12, host: b.host ?? 18, gloves: b.gloves ?? 25, black: b.black ?? 50 }; })();
  const ramp6 = (t, a, b) => (t <= a ? 0 : t >= b ? 1 : ((t - a) / (b - a)) * ((t - a) / (b - a)) * (3 - 2 * ((t - a) / (b - a))));
  const ENDLIGHT = Object.freeze({
    // (the environment lifts the changed world's black point in the look and reddens the sky from 'portal': this is the cinema's
    // share on top, kept small so the two do not wash the frame out)
    lift: [0.005, 0.0011, 0.0008],       // linear: the black point at full lift (≈ +0.05 sRGB in red)
    flood: [0.035, 0.0065, 0.0025],      // linear: the red flood at the top of the frame at full
    halo: lin('#ff4a22', 1.0, 0.38), gate: lin('#ff3a1a', 1.4, 0.9), gate2: lin('#c8261a', 1.0, 0.5),
  });
  let endLightOn = false, endLightEnabled = true;   // (benches: `setEndingLight(false)` measures the environment's frame without it)
  function stepEndingLight(st, dt) {
    const e = st?.mode === 'ending' && endLightEnabled ? st.ending : null, t = e && Number.isFinite(e.t) ? e.t : -1;
    if (t < 0 || t >= EB6.black) { if (endLightOn) { endLightOn = false; wash.visible = false; } return; }
    endLightOn = true;
    // the lift: the lamp beat (murky) and the host beat (black on black); the flood: from the portal (red light floods),
    // held under the environment's own red sky from 'world', and strongest behind the host
    const lampK = ramp6(t, EB6.lamp, EB6.lamp + 1.5) * (1 - ramp6(t, EB6.world, EB6.world + 2));
    const hostK = ramp6(t, EB6.host - 0.5, EB6.host + 1.5) * (1 - ramp6(t, EB6.gloves - 0.6, EB6.gloves));
    const floodK = Math.max(ramp6(t, EB6.portal, EB6.portal + 3) * (1 - 0.5 * ramp6(t, EB6.world, EB6.world + 4)), hostK * 0.8) * (1 - ramp6(t, EB6.gloves - 0.6, EB6.gloves));
    const liftK = Math.max(lampK * 0.6, hostK);
    const L = ENDLIGHT.lift, F = ENDLIGHT.flood;
    washU.uBot.value.set(L[0] * liftK, L[1] * liftK, L[2] * liftK);
    washU.uTop.value.set(L[0] * liftK + F[0] * floodK, L[1] * liftK + F[1] * floodK, L[2] * liftK + F[2] * floodK);
    wash.visible = liftK + floodK > 0.002;
    // the halo round the pillar: from the lamp until the camera leaves it at 'world'
    const haloK = ramp6(t, EB6.lamp + 0.3, EB6.lamp + 2.5) * (1 - ramp6(t, EB6.world - 1, EB6.world));
    if (haloK > 0.01 && dt > 0) {
      const bk = ARENA.beacon.basket, H = ENDLIGHT.halo;
      add.spawn({ x: bk.x, y: bk.y + 3.5, z: bk.z, life: fdt(), size: 9 + 5 * haloK, col: [H[0], H[1], H[2], H[3] * haloK], fout: 0, tile: TILE.puff });
      add.spawn({ x: bk.x, y: bk.y + 9, z: bk.z, life: fdt(), size: 16, col: [H[0], H[1], H[2], 0.22 * haloK], fout: 0, tile: TILE.puff });
    }
    // the gate lit from the inside as it opens: a hot core in the passage and a wide spill over the wall's top, both behind
    // the host (depth-tested: the walls and the marching ranks hide them, so the figures cut out against red)
    const gateK = hostK;
    if (gateK > 0.01 && dt > 0) {
      const G = ENDLIGHT.gate, G2 = ENDLIGHT.gate2, gz = ARENA.gate.z;
      add.spawn({ x: 0, y: 2.0, z: gz - 2.2, life: fdt(), size: 7.5, col: [G[0], G[1], G[2], G[3] * gateK], fout: 0, tile: TILE.puff });
      add.spawn({ x: 0, y: 1.0, z: gz - 1.2, life: fdt(), size: 4.5, col: [G[0], G[1], G[2], 0.7 * gateK], fout: 0, tile: TILE.puff });
      add.spawn({ x: 0, y: 7.5, z: gz - 6, life: fdt(), size: 26, col: [G2[0], G2[1], G2[2], G2[3] * gateK], fout: 0, tile: TILE.puff });
      // the wall's foot washed red either side of the gate (the ranks fan out in front of it)
      for (let k = -1; k <= 1; k += 2) add.spawn({ x: k * 6.5, y: 1.3, z: gz + 0.25, life: fdt(), size: 8, col: [G2[0], G2[1], G2[2], 0.45 * gateK], fout: 0, tile: TILE.puff });
    }
  }

  function update(dt, state) {
    if (state) lastState = state;
    dt = Math.min(0.1, Math.max(0, dt || 0));
    if (state?.paused) dt = 0;
    clock += dt;
    used.death = used.ignite = used.hit = used.num = used.gate = used.pyre = 0;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    queue.advance(dt);
    stepImpacts();
    stepNums();
    stepEndingLight(state || lastState, dt);
    stepWisps(dt);
    frameDt = dt > 0 ? dt : frameDt; dropNew = 0;
    if (dt > 0) { const st0 = state || lastState; stepChains(dt, st0); stepOrbit(dt, st0); stepProjectiles(dt); stepDrops(dt); stepCharms(dt); stepAir(dt, st0); stepRoar(dt); stepTide(dt); stepGale(dt); }
    const st = state || lastState;
    if (st && dt > 0) {
      const pl = st.player;
      // gold + heart twinkles and their magnet trail (XP gems are gone: 'xp' pickups are skipped if any remain)
      const pk = Array.isArray(st.pickups) ? st.pickups : [];
      twinkleT -= dt; trailT -= dt;
      if (pk.length && twinkleT <= 0) {
        twinkleT = 0.09 / K;
        for (let n = 0; n < 2; n++) {
          const g = pk[(R() * pk.length) | 0];
          if (g && g.kind !== 'xp' && Number.isFinite(g.x)) add.spawn({ x: g.x + rr(-0.12, 0.12), y: (g.y ?? 0) + rr(0.15, 0.45), z: g.z + rr(-0.12, 0.12), life: 0.45, size: 0.06, size1: 0.2, col: g.kind === 'gold' ? COL.gold : COL.cyan, fin: 0.3, fout: 0.5, tile: TILE.star });
        }
      }
      if (pl && pk.length && trailT <= 0) {
        trailT = 1 / 40;
        const mr = (pl.magnet || 3) + 0.5, mr2 = mr * mr;
        let n = 0;
        for (let i = 0; i < pk.length && n < 10; i++) {
          const g = pk[i]; if (g.kind === 'xp') continue;
          const ddx = g.x - pl.x, ddz = g.z - pl.z;
          if (ddx * ddx + ddz * ddz < mr2) { n++; add.spawn({ x: g.x, y: (g.y ?? 0) + 0.25, z: g.z, life: 0.22, size: 0.08, size1: 0.02, col: g.kind === 'gold' ? COL.gold : COL.cyanSoft, fout: 0.3, tile: TILE.ember }); }
        }
      }
      // spear trails
      const sp = Array.isArray(st.spears) ? st.spears : [];
      for (let i = 0; i < sp.length && i < 40; i++) {
        const s = sp[i]; if (!s || !Number.isFinite(s.x)) continue;
        alpha.spawn({ x: s.x, y: s.y, z: s.z, life: 0.28, size: 0.07, size1: 0.02, col: lin('#c9d4dc', 1, 0.55), fout: 0.2, tile: TILE.square, rot: 0.785 });
      }
      // boulder dust trail
      const bo = Array.isArray(st.boulders) ? st.boulders : [];
      for (let i = 0; i < bo.length && i < 6; i++) { const b = bo[i]; if (b && Number.isFinite(b.x) && R() < 0.5) alpha.spawn({ x: b.x, y: b.y, z: b.z, vy: 0.3, life: 0.6, size: 0.4, size1: 0.9, sizeK: 3, col: COL.dust, fout: 0.2, tile: TILE.puff, rot: rr(0, 6) }); }
      // the red-hot troll sheds embers
      const t = st.troll;
      if (t && t.glowing && t.hp > 0) { glowT -= dt; if (glowT <= 0) { glowT = 0.05 / K; embers(t.x + rr(-1.2, 1.2), (t.y ?? 0) + rr(1.5, 5.5), t.z + rr(-1.2, 1.2), 1, { spread: 0.4, rise: 2.5, life: 1 }); } }
      // lance nozzle sparks while spraying
      if (pl && pl.weapon === 'lance' && pl.firing && (pl.fuel ?? 1) > 0) {
        nozzleT -= dt;
        if (nozzleT <= 0) {
          nozzleT = 0.03 / K;
          const m = muzzle(tmp, null); camera.getWorldDirection(camFwd);
          alpha.spawn({ x: m.x, y: m.y, z: m.z, vx: camFwd.x * rr(4, 8) + rr(-1, 1), vy: camFwd.y * 6 + rr(0, 1.5), vz: camFwd.z * rr(4, 8) + rr(-1, 1), life: rr(0.2, 0.4), size: 0.035, col: COL.yellow, col1: COL.ember, fout: 0.4, tile: TILE.ember, grav: 4, drag: 1 });
        }
      }
    }
    add.update(dt); alpha.update(dt); nums.update(dt);
    if (t0) { const ms = performance.now() - t0; cpuAvg += (ms - cpuAvg) * 0.05; if (ms > cpuMax) cpuMax = ms; }
  }
  let cpuAvg = 0, cpuMax = 0;

  function clear() { add.clear(); alpha.clear(); nums.clear(); queue.clear(); wAlive = 0; CH.length = 0; PR.length = 0; DR.length = 0; CHM.length = 0; DV.length = 0; RO.length = 0; TW.length = 0; WP.length = 0; GL.length = 0; impN = 0; nsN = 0; numEnd.fill(0); nsSt.fill(-9); }

  /** Make every FX program compile before play (an invisible particle in each pool for a moment). */
  function warm() {
    for (const pool of [add, alpha, nums]) pool.spawn({ x: 0, y: -50, z: 0, life: 0.5, size: 0.01, col: [0, 0, 0, 0.001], tile: TILE.square });
  }
  warm();

  const api = {
    onEvent, update, warm, clear,
    /** the FX group (3 instanced meshes): the look may render it after the fluid pass */
    root,
    stats() { return { add: add.alive, alpha: alpha.alive, nums: nums.alive, wisps: wAlive, chains: CH.length, flying: PR.length, drops: DR.length, charms: CHM.length, tides: TW.length, whirls: WP.length, gales: GL.length, impacts: impN, landed: impLanded.join('/'), numbers: numOnScreen(), numQueued: nsN, cpuMs: +cpuAvg.toFixed(3), cpuMaxMs: +cpuMax.toFixed(3), roars: RO.length, dives: DV.length, draws: (add.alive ? 1 : 0) + (alpha.alive ? 1 : 0) + (nums.alive ? 1 : 0) }; },
    /** for previews and tests: fire a named burst at a point */
    debugBurst(kind, x, y, z) { if (kind === 'bomb') burst(x, y, z, 3.5, false); else if (kind === 'barrel') burst(x, y, z, 4.2, true); else if (kind === 'sunburst') sunburst(x, y, z, 14); else if (kind === 'kindle') kindle(); else if (kind === 'hit') hitMark(x, y, z, false); else if (kind === 'crit') hitMark(x, y, z, true); else if (kind === 'pyre') pyrePop({ x, y, z }, 2.2); else if (kind === 'batdeath') batDeath({ x, y, z }, false); },
    /** reset the CPU timing (tools: measure a burst) */
    setEndingLight(on = true) { endLightEnabled = !!on; },
    resetCpu() { cpuAvg = 0; cpuMax = 0; },
    dispose() { clear(); scene.remove(root); add.dispose(); alpha.dispose(); nums.dispose(); map?.dispose(); },
  };
  try { if (typeof window !== 'undefined') /** @type {any} */ (window).__ewFx = api; } catch { /* tests and tools read it */ }
  return api;
}
