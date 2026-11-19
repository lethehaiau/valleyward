// @ts-check
// Environment · the far horde (so the valley is not empty): thousands of tiny dark specks and a scatter of
// torch dots streaming toward the keep beyond the sim's horde — down the far valley road (ROAD_DRAWN past z 86), across
// the east plateau toward the east muster, and out of the south-west valley — like the columns in M1/M2. One Points
// draw; each speck shuffles a few metres along its stream and fades at the ends of its walk, so nothing visibly
// wraps. Specks are set dressing only (the sim never sees them) and stay far outside the player's bounds.
import * as THREE from 'three';
import { envHeight, ROAD_DRAWN } from './terrain.js';
import { rng } from './util.js';
import { gfx } from '../gfx/current.js';

/** Streams from far to near ([x, z] polylines), their width (m) and share of the specks. */
const STREAMS = [
  { path: [[33, 260], [44, 215], [30, 178], [40, 150], [27, 126], [38, 104], [31, 90]], width: 13, share: 0.4 },
  { path: [[230, 66], [180, 54], [140, 47], [104, 41], [76, 35]], width: 16, share: 0.36 },
  { path: [[-80, 200], [-52, 150], [-30, 116], [-16, 96]], width: 14, share: 0.24 },
];
void ROAD_DRAWN;

/**
 * @param {THREE.FogExp2} fog @param {string} quality
 */
export function buildFarHorde(fog, quality) {
  const R = rng(911);
  const total = quality === 'low' ? 1600 : quality === 'medium' ? 2800 : 4200;
  const pos = [], dir = [], meta = [];
  for (const S of STREAMS) {
    const pts = S.path;
    const lens = []; let L = 0;
    for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); lens.push(l); L += l; }
    const n = Math.round(total * S.share);
    for (let k = 0; k < n; k++) {
      // denser toward the near end (the column bunches up as it nears the keep), clumped along the path
      let u = Math.pow(R(), 1.35) * L;
      let i = 0; while (i < lens.length - 1 && u > lens[i]) { u -= lens[i]; i++; }
      const t = Math.min(1, u / lens[i]);
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const tx = (bx - ax) / lens[i], tz = (bz - az) / lens[i];
      const w = S.width * (0.35 + 0.65 * (1 - k / n * 0.5)) * (R() + R() + R() - 1.5) / 1.5;
      const x = ax + (bx - ax) * t - tz * w, z = az + (bz - az) * t + tx * w;
      const y = envHeight(x, z);
      const y2 = envHeight(x + tx * 6, z + tz * 6);
      pos.push(x, y, z);
      dir.push(tx * 6, y2 - y, tz * 6);
      const torch = R() < 0.075 ? 1 : 0;
      meta.push(R(), 0.6 + 0.8 * R(), torch, R());   // phase, speed, torch, tint
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3));
  g.setAttribute('aMeta', new THREE.Float32BufferAttribute(meta, 4));
  const mat = gfx().materials.envFarHordeMaterial({   // per edition (decision 0001); opaque points
    uTime: { value: 0 }, uPx: { value: 900 }, uFogColor: { value: fog.color }, uFogDensity: { value: fog.density },
    uDawn: { value: 0 },
  });
  const points = gfx().materials.envPoints(g, mat);
  points.name = 'far-horde';
  points.frustumCulled = false;
  return {
    points,
    /** @param {number} t @param {number} px render-target height (px) @param {number} dawn */
    update(t, px, dawn) { mat.uniforms.uTime.value = t; mat.uniforms.uPx.value = px; mat.uniforms.uFogDensity.value = fog.density; mat.uniforms.uDawn.value = dawn; },
    count: pos.length / 3,
  };
}
