// @ts-check
// Environment (DESIGN §8.1): the moon and sky of each of the ten nights. The moon reddens night by night: I
// teal-white, II blood, III rust, IV crimson, V dark red, VI red-violet, VII violet, VIII deep red, IX black-red and X a
// black disc with a red corona; the sky, fog and moonlight shift with it (a little darker and warmer each night, never
// so dark the night cannot be played). `nightLook(f, out)` lerps between whole nights (f 1..10, fractional while a
// night's palette ramps in). The world change of the ending (DESIGN §12.3) has its own palette, WORLD_LOOK.
import * as THREE from 'three';

const C = (h) => new THREE.Color(h);
/**
 * moon (disc colour), gain (its HDR), halo, sky zenithTop / zenith / horizon, mountains far / mid / near, fog, moonlight
 * colour and intensity, hemisphere sky colour and intensity, fog density, corona (the black moon's ring, 0..1).
 */
const ROWS = [
  // I  teal-white (the tuned night)
  ['#9ee1e9', 2.3, '#2f6a80', '#0d2a38', '#184255', '#2c5168', '#1f4659', '#173a4c', '#11303f', '#2b5064', '#9fd3e0', 7.0, [0.64, 0.8, 0.9], 3.9, 0.0068, 0],
  // II blood
  ['#e3261a', 0.9, '#6a2422', '#141a2c', '#212f48', '#3b4260', '#283550', '#1f2b44', '#172238', '#2f3d54', '#a9a8c6', 6.9, [0.68, 0.66, 0.84], 3.9, 0.0071, 0],
  // III rust
  ['#c8561c', 1.0, '#5e3420', '#151a26', '#232c3c', '#423f4e', '#2b3346', '#222a3a', '#1a2130', '#323a4a', '#b2a8b2', 6.8, [0.7, 0.66, 0.78], 3.85, 0.0071, 0],
  // IV crimson
  ['#d21a2c', 0.95, '#64202e', '#131625', '#1e2438', '#3a3652', '#2a2e48', '#21263c', '#191d30', '#2e3448', '#a6a0ba', 6.6, [0.68, 0.64, 0.82], 3.8, 0.0072, 0],
  // V dark red
  ['#a01410', 0.85, '#4c1614', '#120f1a', '#1c1c2c', '#33293a', '#272436', '#1f1c2c', '#181522', '#2a2a38', '#9a90a6', 6.4, [0.66, 0.6, 0.76], 3.75, 0.0072, 0],
  // VI red-violet
  ['#c01e5e', 0.95, '#5a1c42', '#140e22', '#221b38', '#3b2c4c', '#2c2442', '#221c36', '#1a152a', '#2e2a40', '#a294ba', 6.4, [0.68, 0.6, 0.82], 3.75, 0.0073, 0],
  // VII violet
  ['#8c2ed6', 1.0, '#401c5c', '#100c22', '#1c1838', '#2e2a4c', '#262440', '#1e1c36', '#17152a', '#28283e', '#9c96c4', 6.3, [0.64, 0.6, 0.86], 3.7, 0.0073, 0],
  // VIII deep red
  ['#8e0a0a', 0.8, '#400c0c', '#0e0a12', '#1a1220', '#2e1e28', '#241a24', '#1c141c', '#151016', '#262028', '#8e8292', 6.0, [0.62, 0.54, 0.66], 3.6, 0.0074, 0],
  // IX black-red
  ['#5e0808', 1.0, '#320808', '#0a0608', '#140c10', '#24161a', '#1e1418', '#181014', '#120c0e', '#201a1e', '#7e7078', 5.7, [0.58, 0.5, 0.58], 3.5, 0.0075, 0.06],
  // X a black disc with a red corona
  ['#060203', 1.0, '#5a0a06', '#070405', '#100809', '#1e1012', '#1a1012', '#140c0e', '#0f090a', '#1a1416', '#76605e', 5.4, [0.58, 0.46, 0.5], 3.45, 0.0076, 1],
];
const toLook = (r) => ({
  moon: C(r[0]), gain: r[1], halo: C(r[2]), zenithTop: C(r[3]), zenith: C(r[4]), horizon: C(r[5]),
  mFar: C(r[6]), mMid: C(r[7]), mNear: C(r[8]), fog: C(r[9]), moonLight: C(r[10]), moonI: r[11],
  hemiSky: new THREE.Color().setRGB(r[12][0], r[12][1], r[12][2]), hemiI: r[13], fogDensity: r[14], corona: r[15],
});
export const NIGHT_LOOKS = ROWS.map(toLook);
/** The ending's world change (DESIGN §12.3): a red-black sky, a dark red fog, a black moon with a red corona. */
export const WORLD_LOOK = toLook(['#040203', 1.0, '#2e0604', '#0a0610', '#140c18', '#341812', '#120c14', '#0e0910', '#0a070b', '#20131a', '#7a7090', 3.0, [0.36, 0.32, 0.46], 2.6, 0.0072, 1]);
/** Night names on the moon (for docs and benches). */
export const MOON_NAMES = ['teal-white', 'blood', 'rust', 'crimson', 'dark red', 'red-violet', 'violet', 'deep red', 'black-red', 'black disc, red corona'];

const KEYS = ['moon', 'halo', 'zenithTop', 'zenith', 'horizon', 'mFar', 'mMid', 'mNear', 'fog', 'moonLight', 'hemiSky'];
const NUMS = ['gain', 'moonI', 'hemiI', 'fogDensity', 'corona'];
/** A fresh palette object to lerp into. */
export function makeLook() { return toLook(ROWS[0]); }
/**
 * The palette of night `f` (1..10, fractional between nights) into `out`.
 * @param {number} f @param {ReturnType<typeof makeLook>} out
 */
export function nightLook(f, out) {
  const x = Math.max(1, Math.min(10, f || 1)) - 1;
  const i = Math.min(8, Math.floor(x)), k = x - i;
  const A = NIGHT_LOOKS[i], B = NIGHT_LOOKS[Math.min(9, i + 1)];
  for (const key of KEYS) out[key].copy(A[key]).lerp(B[key], k);
  for (const key of NUMS) out[key] = A[key] + (B[key] - A[key]) * k;
  return out;
}
/** Blend `out` toward palette `P` by `w`. */
export function lerpLook(out, P, w) {
  if (w <= 0) return out;
  for (const key of KEYS) out[key].lerp(P[key], w);
  for (const key of NUMS) out[key] += (P[key] - out[key]) * w;
  return out;
}
