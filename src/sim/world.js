// @ts-check
// VALLEYWARD · the static world the sim needs, built once from src/shared/arena.js: the horde's flow field toward the
// gate (1 m grid, the road cheaper, walls/towers/stair blocked), a spatial-hash grid on the same cells, the player's
// colliders, the solid boxes bullets stop at, and the road distance. Pure JS.
import { ARENA, groundHeight, standHeight } from '../shared/arena.js';

export const GRID = Object.freeze({ x0: -40, z0: -6, w: 112, h: 96 });   // x −40..72, z −6..90, 1 m cells
const W = GRID.w, H = GRID.h;

const inflate = (b, r) => ({ x0: b.x0 - r, x1: b.x1 + r, z0: b.z0 - r, z1: b.z1 + r });
const towerBox = (t) => ({ x0: t.x - t.half, x1: t.x + t.half, z0: t.z - t.half, z1: t.z + t.half, y1: t.height });
export const TOWERS = ARENA.keep.towers.map(towerBox);
const K = ARENA.keep;
export const KEEP_BOX = { x0: K.x0, x1: K.x1, z0: K.z0, z1: K.z1, y1: K.wallHeight };
const S = ARENA.stair;
export const STAIR_BOX = { x0: S.x0, x1: S.x1, z0: S.zTop, z1: S.zBottom };
/** Solid boxes for bullets and bombs (y from 0 to y1). */
export const SOLIDS = [KEEP_BOX, ...TOWERS];

/** Distance from (x, z) to the road centreline. */
export function roadDist(x, z) {
  const P = ARENA.road.points;
  let best = Infinity;
  for (let i = 0; i < P.length - 1; i++) {
    const [ax, az] = P[i], [bx, bz] = P[i + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

const inBox = (b, x, z) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;

/** @param {{x:number,z:number,r:number}[]} [circles] extra round obstacles (DESIGN §9.6: the towers on their pads) */
function buildFlowField(circles = []) {
  const blocked = new Uint8Array(W * H), cost = new Float32Array(W * H), dist = new Float32Array(W * H).fill(Infinity);
  const dirX = new Float32Array(W * H), dirZ = new Float32Array(W * H);
  const r = 0.35;
  const keepB = inflate({ x0: K.x0, x1: K.x1, z0: K.z0, z1: 0.15 }, r), stairB = inflate(STAIR_BOX, r), towersB = TOWERS.map((t) => inflate(t, r));
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = GRID.x0 + i + 0.5, z = GRID.z0 + j + 0.5, k = j * W + i;
    if (inBox(keepB, x, z) || inBox(stairB, x, z) || towersB.some((b) => inBox(b, x, z)) || circles.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + r)) { blocked[k] = 1; continue; }
    cost[k] = roadDist(x, z) <= ARENA.road.width / 2 ? 0.55 : 1;
  }
  // Dijkstra from the gate target (binary heap)
  const T = ARENA.gate.target;
  const gi = Math.floor(T.x - GRID.x0), gj = Math.floor(T.z - GRID.z0), goal = gj * W + gi;
  const heap = new Int32Array(W * H * 8), hv = new Float32Array(W * H * 8);
  let n = 0;
  const push = (k, v) => { let c = n++; heap[c] = k; hv[c] = v; while (c > 0) { const p = (c - 1) >> 1; if (hv[p] <= hv[c]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; [hv[p], hv[c]] = [hv[c], hv[p]]; c = p; } };
  const pop = () => { const k = heap[0], v = hv[0]; n--; heap[0] = heap[n]; hv[0] = hv[n]; let c = 0; for (;;) { const l = 2 * c + 1, rr = l + 1; let m = c; if (l < n && hv[l] < hv[m]) m = l; if (rr < n && hv[rr] < hv[m]) m = rr; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; [hv[m], hv[c]] = [hv[c], hv[m]]; c = m; } return [k, v]; };
  dist[goal] = 0; push(goal, 0);
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (n > 0) {
    const [k, v] = pop();
    if (v > dist[k]) continue;
    const i = k % W, j = (k / W) | 0;
    for (const [di, dj, c] of NB) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nk = nj * W + ni;
      if (blocked[nk]) continue;
      if (di && dj && (blocked[j * W + ni] || blocked[nj * W + i])) continue;   // no corner cutting
      const nv = v + c * 0.5 * (cost[k] + cost[nk]);
      if (nv < dist[nk]) { dist[nk] = nv; push(nk, nv); }
    }
  }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (blocked[k] || !Number.isFinite(dist[k])) continue;
    if (k === goal) { const x = GRID.x0 + i + 0.5, z = GRID.z0 + j + 0.5, d = Math.hypot(T.x - x, T.z - z) || 1; dirX[k] = (T.x - x) / d; dirZ[k] = (T.z - z) / d; continue; }
    let best = dist[k], bx = 0, bz = 0;
    for (const [di, dj] of NB) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nk = nj * W + ni;
      if (blocked[nk] || (di && dj && (blocked[j * W + ni] || blocked[nj * W + i]))) continue;
      if (dist[nk] < best) { best = dist[nk]; bx = di; bz = dj; }
    }
    const m = Math.hypot(bx, bz) || 1;
    dirX[k] = bx / m; dirZ[k] = bz / m;
  }
  return { blocked, cost, dist, dirX, dirZ, goal };
}

export const FLOW = buildFlowField();
let flowKey = '';
/**
 * Rebuild the flow field (in place: FLOW's arrays are replaced) with extra round obstacles, e.g. the run's towers
 * (DESIGN §9.6). A no-op when the set is unchanged. ≈ 10–20 ms; called at nightfall and at the camp, never per tick.
 * @param {{x:number,z:number,r:number}[]} circles
 */
export function setFlowObstacles(circles) {
  const key = circles.map((c) => `${c.x.toFixed(2)},${c.z.toFixed(2)},${c.r}`).sort().join(';');
  if (key === flowKey) return false;
  flowKey = key;
  Object.assign(FLOW, buildFlowField(circles));
  return true;
}

/** Grid cell index of (x, z), clamped to the grid. */
export function cellOf(x, z) {
  let i = Math.floor(x - GRID.x0), j = Math.floor(z - GRID.z0);
  if (i < 0) i = 0; else if (i >= W) i = W - 1;
  if (j < 0) j = 0; else if (j >= H) j = H - 1;
  return j * W + i;
}
export const isBlocked = (x, z) => FLOW.blocked[cellOf(x, z)] === 1;
export const flowDist = (x, z) => FLOW.dist[cellOf(x, z)];

const out = { x: 0, z: 0 };
/** Smoothed flow direction at (x, z) (bilinear over the 4 nearest open cells). Returns a shared object. */
export function flowDir(x, z) {
  const gx = x - GRID.x0 - 0.5, gz = z - GRID.z0 - 0.5;
  const i = Math.floor(gx), j = Math.floor(gz), tx = gx - i, tz = gz - j;
  let sx = 0, sz = 0;
  for (let b = 0; b < 4; b++) {
    const ii = i + (b & 1), jj = j + (b >> 1);
    if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
    const k = jj * W + ii;
    if (FLOW.blocked[k]) continue;
    const w = ((b & 1) ? tx : 1 - tx) * ((b >> 1) ? tz : 1 - tz);
    sx += FLOW.dirX[k] * w; sz += FLOW.dirZ[k] * w;
  }
  const m = Math.hypot(sx, sz);
  if (m < 1e-4) { const k = cellOf(x, z); out.x = FLOW.dirX[k]; out.z = FLOW.dirZ[k]; if (!out.x && !out.z) { const T = ARENA.gate.target, d = Math.hypot(T.x - x, T.z - z) || 1; out.x = (T.x - x) / d; out.z = (T.z - z) / d; } return out; }
  out.x = sx / m; out.z = sz / m;
  return out;
}

/** A counting-sort spatial hash over GRID (1 m cells), rebuilt every tick. */
export function createSpatialHash(cap) {
  const counts = new Int32Array(W * H + 1), start = new Int32Array(W * H + 1), items = new Int32Array(cap), cellOfItem = new Int32Array(cap), fill = new Int32Array(W * H);
  return {
    counts, start, items,
    /** @param {number} n @param {Float32Array} xs @param {Float32Array} zs @param {Uint8Array} state */
    build(n, xs, zs, state) {
      counts.fill(0);
      for (let i = 0; i < n; i++) { if (state[i] === 0 || state[i] === 4) { cellOfItem[i] = -1; continue; } const c = cellOf(xs[i], zs[i]); cellOfItem[i] = c; counts[c]++; }
      let s = 0;
      for (let c = 0; c < W * H; c++) { start[c] = s; s += counts[c]; }
      start[W * H] = s;
      fill.fill(0);   // (reused: no per-tick allocation; DESIGN §15.4)
      for (let i = 0; i < n; i++) { const c = cellOfItem[i]; if (c < 0) continue; items[start[c] + fill[c]++] = i; }
    },
    /** Visit items in the cells overlapping the square of half-size r around (x, z); cb returns true to stop. */
    query(x, z, r, cb) {
      const i0 = Math.max(0, Math.floor(x - r - GRID.x0)), i1 = Math.min(W - 1, Math.floor(x + r - GRID.x0));
      const j0 = Math.max(0, Math.floor(z - r - GRID.z0)), j1 = Math.min(H - 1, Math.floor(z + r - GRID.z0));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const c = j * W + i;
        for (let p = start[c], e = start[c] + counts[c]; p < e; p++) if (cb(items[p])) return;
      }
    },
    countAt: (x, z) => counts[cellOf(x, z)],
  };
}

/**
 * Where the player stands at (x, z) given their height y: ARENA.standHeight plus the gap between the stair's top tread
 * (z = stair.zTop) and the wall walk's south edge (z = walk.z1), which counts as walk.
 */
export function supportHeight(x, z, y) {
  const w = ARENA.keep.walk;
  if (x >= S.x0 && x <= S.x1 && z < S.zTop && z >= w.z1 - 0.01 && y >= w.y - 0.9) return w.y;
  return standHeight(x, z, y);
}

/** Is the player (feet y) on the raised level: the wall walk, or the stair above `above` m? */
export function onWalk(x, z, y) {
  const w = ARENA.keep.walk;
  return y >= w.y - 0.6 && x >= w.x0 - 0.01 && x <= w.x1 + 0.01 && z >= w.z0 - 0.01 && z <= S.zTop + 0.01;
}
export function onStair(x, z, y) {
  if (x < S.x0 - 0.01 || x > S.x1 + 0.01 || z < S.zTop || z > S.zBottom) return false;
  const yS = S.yTop * (S.zBottom - z) / (S.zBottom - S.zTop);
  return y >= yS - 0.9;
}
export const stairY = (z) => S.yTop * (S.zBottom - Math.min(S.zBottom, Math.max(S.zTop, z))) / (S.zBottom - S.zTop);

/**
 * Ray (o + d t, |d| = 1) against the solid boxes (keep walls, towers): the nearest hit t, or maxT.
 * @param {{x:number,y:number,z:number}} o @param {{x:number,y:number,z:number}} d @param {number} maxT
 */
export function raySolids(o, d, maxT) {
  let best = maxT;
  for (const b of SOLIDS) {
    const t = rayBox(o, d, b.x0, 0, b.z0, b.x1, b.y1, b.z1);
    if (t >= 0 && t < best) best = t;
  }
  return best;
}
function rayBox(o, d, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = Infinity;
  for (const [oo, dd, lo, hi] of [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]]) {
    if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) return -1; continue; }
    let t1 = (lo - oo) / dd, t2 = (hi - oo) / dd;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}
/** Ray against the terrain (marching 0.5 m, then bisection): t of the first point under the ground, or maxT. */
export function rayGround(o, d, maxT) {
  let prevT = 0;
  for (let t = 0.5; t <= maxT; t += 0.5) {
    const y = o.y + d.y * t, x = o.x + d.x * t, z = o.z + d.z * t;
    if (y <= groundHeight(x, z)) {
      let a = prevT, b = t;
      for (let i = 0; i < 6; i++) { const m = (a + b) / 2; if (o.y + d.y * m <= groundHeight(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
      return b;
    }
    prevT = t;
  }
  return maxT;
}
/** Is (x, z, y) inside a solid box? (bombs, boulders) */
export function insideSolid(x, y, z) {
  for (const b of SOLIDS) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && y <= b.y1 && y >= 0) return true;
  return false;
}
export { W as GRID_W, H as GRID_H };

/** DESIGN §15.4: the ground height from a 0.5 m table over GRID, bilinear (the horde's per-tick feet; ≤ 2 cm from
 *  groundHeight on the slope, exact on the flat plaza); outside the grid, groundHeight itself. */
const GS = 0.5, GW = Math.round(W / GS) + 1, GHh = Math.round(H / GS) + 1, GTAB = new Float32Array(GW * GHh);
for (let j = 0; j < GHh; j++) for (let i = 0; i < GW; i++) GTAB[j * GW + i] = groundHeight(GRID.x0 + i * GS, GRID.z0 + j * GS);
export function groundFast(x, z) {
  if (z <= 9) return 0;   // the plaza (arena.js: flat north of z 9)
  const gx = (x - GRID.x0) / GS, gz = (z - GRID.z0) / GS, i = Math.floor(gx), j = Math.floor(gz);
  if (i < 0 || j < 0 || i >= GW - 1 || j >= GHh - 1) return groundHeight(x, z);
  const tx = gx - i, tz = gz - j, k = j * GW + i;
  return (GTAB[k] * (1 - tx) + GTAB[k + 1] * tx) * (1 - tz) + (GTAB[k + GW] * (1 - tx) + GTAB[k + GW + 1] * tx) * tz;
}
