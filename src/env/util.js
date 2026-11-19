// @ts-check
// Environment · geometry helpers: a seeded RNG and a mesh builder that merges boxes and three.js geometries into one
// indexed BufferGeometry per material (position, normal, uv in tile units, colour, aBlk = block-local metres + face
// size for the pixel bevel). Everything static in the keep goes through this, so a material is one draw call.
import * as THREE from 'three';

/** mulberry32 */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

// Box faces: normal, the two in-face axes (u right, v up) as indices/signs into local corners.
const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];
export const FACE = { px: 1, nx: 2, py: 4, ny: 8, pz: 16, nz: 32, all: 63, sides: 51, noBottom: 55 };

export class Builder {
  /** @param {number} metresPerTile world metres covered by one texture tile (64 px at 16 texels/m = 4 m) */
  constructor(metresPerTile = 4) {
    this.mpt = metresPerTile;
    /** @type {number[]} */ this.p = []; /** @type {number[]} */ this.n = []; /** @type {number[]} */ this.uv = [];
    /** @type {number[]} */ this.c = []; /** @type {number[]} */ this.b = []; /** @type {number[]} */ this.i = [];
    /** @type {number[]} */ this.x = []; // extra float attribute (aTag: trough index etc.)
  }
  get count() { return this.p.length / 3; }

  /**
   * An oriented box. `m` places the unit-centred box (size sx, sy, sz) in the world (translation + rotation; no scale).
   * @param {number} sx @param {number} sy @param {number} sz @param {THREE.Matrix4} m
   * @param {{ color?: THREE.Color|number[], faces?: number, uvOff?: number[], bevel?: boolean, footDark?: number, tag?: number, topTint?: number }} [o]
   */
  box(sx, sy, sz, m, o = {}) {
    const faces = o.faces ?? 63;
    const col = o.color ? (Array.isArray(o.color) ? o.color : [o.color.r, o.color.g, o.color.b]) : [1, 1, 1];
    const uo = o.uvOff || [0, 0];
    const half = [sx / 2, sy / 2, sz / 2];
    const size = [sx, sy, sz];
    _m3.getNormalMatrix(m);
    for (let f = 0; f < 6; f++) {
      if (!(faces & (1 << f))) continue;
      const F = FACES[f];
      const ui = F.u.findIndex((x) => x !== 0), vi = F.v.findIndex((x) => x !== 0);
      const us = F.u[ui], vs = F.v[vi];
      const ni = F.n.findIndex((x) => x !== 0);
      const w = size[ui], h = size[vi];
      _n.set(F.n[0], F.n[1], F.n[2]).applyMatrix3(_m3).normalize();
      const base = this.count;
      for (let k = 0; k < 4; k++) {
        const a = k === 1 || k === 2 ? 1 : 0, bb = k >= 2 ? 1 : 0; // (0,0) (1,0) (1,1) (0,1)
        const l = [0, 0, 0];
        l[ni] = F.n[ni] * half[ni];
        l[ui] = us * (a ? half[ui] : -half[ui]);
        l[vi] = vs * (bb ? half[vi] : -half[vi]);
        _v.set(l[0], l[1], l[2]).applyMatrix4(m);
        this.p.push(_v.x, _v.y, _v.z);
        this.n.push(_n.x, _n.y, _n.z);
        this.uv.push((a * w) / this.mpt + uo[0], (bb * h) / this.mpt + uo[1]);
        let shade = 1;
        if (o.footDark && _n.y < 0.5) shade *= 1 - o.footDark * Math.max(0, 1 - _v.y / 1.6);
        if (o.topTint && _n.y > 0.5) shade *= o.topTint;
        this.c.push(col[0] * shade, col[1] * shade, col[2] * shade);
        this.b.push(o.bevel ? a * w : 0, o.bevel ? bb * h : 0, o.bevel ? w : 0, o.bevel ? h : 0);
        this.x.push(o.tag || 0);
      }
      this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  /** Axis-aligned box from min/max corners. */
  aabb(x0, y0, z0, x1, y1, z1, o) {
    const m = new THREE.Matrix4().makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.box(x1 - x0, y1 - y0, z1 - z0, m, o);
  }

  /**
   * Append any BufferGeometry (indexed or not) under matrix m. UVs: its own uv × uvScale, else planar world xz / tile.
   * @param {THREE.BufferGeometry} g @param {THREE.Matrix4} m
   * @param {{ color?: THREE.Color|number[], uvScale?: number[], worldUV?: boolean, shadeY?: number[], tag?: number }} [o]
   */
  geom(g, m, o = {}) {
    const col = o.color ? (Array.isArray(o.color) ? o.color : [o.color.r, o.color.g, o.color.b]) : [1, 1, 1];
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    const C = g.attributes.color;
    _m3.getNormalMatrix(m);
    const base = this.count;
    const us = o.uvScale || [1, 1];
    for (let k = 0; k < P.count; k++) {
      _v.fromBufferAttribute(P, k);
      const ly = _v.y;
      _v.applyMatrix4(m);
      this.p.push(_v.x, _v.y, _v.z);
      if (N) { _n.fromBufferAttribute(N, k).applyMatrix3(_m3).normalize(); } else _n.set(0, 1, 0);
      this.n.push(_n.x, _n.y, _n.z);
      if (U && !o.worldUV) this.uv.push(U.getX(k) * us[0], U.getY(k) * us[1]);
      else {
        // triplanar-ish pick by the dominant normal axis
        const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
        if (ay >= ax && ay >= az) this.uv.push(_v.x / this.mpt, _v.z / this.mpt);
        else if (ax >= az) this.uv.push(_v.z / this.mpt, _v.y / this.mpt);
        else this.uv.push(_v.x / this.mpt, _v.y / this.mpt);
      }
      let s = 1;
      if (o.shadeY) s = o.shadeY[0] + (o.shadeY[1] - o.shadeY[0]) * Math.min(1, Math.max(0, ly));
      const cr = C ? C.getX(k) : 1, cg = C ? C.getY(k) : 1, cb = C ? C.getZ(k) : 1;
      this.c.push(col[0] * s * cr, col[1] * s * cg, col[2] * s * cb);
      this.b.push(0, 0, 0, 0);
      this.x.push(o.tag || 0);
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) this.i.push(base + g.index.getX(k));
    else for (let k = 0; k < P.count; k++) this.i.push(base + k);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aBlk', new THREE.Float32BufferAttribute(this.b, 4));
    g.setAttribute('aTag', new THREE.Float32BufferAttribute(this.x, 1));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Distance from (x, z) to a polyline [[x, z], ...]; also returns the arc position. */
export function polyDist(pts, x, z) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const ex = ax + dx * t - x, ez = az + dz * t - z;
    const d = Math.sqrt(ex * ex + ez * ez);
    if (d < best) best = d;
  }
  return best;
}

/** Smooth value noise (2D), deterministic. */
export function vnoise(x, y) {
  const h = (i, j) => { let n = Math.imul(i, 374761393) + Math.imul(j, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
