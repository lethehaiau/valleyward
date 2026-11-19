// @ts-check
// Environment · the sky dome (one draw, behind everything, no depth write so the look's god rays find the open sky by
// depth = 1): the teal gradient, a huge pixelated cyan-white moon at ARENA.moonDir with craters and a wide soft halo,
// faint rays fanning down from it, faint twinkling stars, thin moonlit clouds, three ridges of far blue mountains with
// moon-side rims and snow, and the dawn (the east brightens, the moon and stars fade, a warm sun rises).
import * as THREE from 'three';
import { ARENA } from '../shared/arena.js';
import { gfx } from '../gfx/current.js';

export const MOON_DIR = new THREE.Vector3(ARENA.moonDir.x, ARENA.moonDir.y, ARENA.moonDir.z).normalize();
export const MOON_RADIUS = 0.105; // radians (≈ 12° across: a big moon, as in the M1/M2 mockups)

export const SKY_COLORS = {
  zenithTop: new THREE.Color('#0d2a38'), zenith: new THREE.Color('#184255'), horizon: new THREE.Color('#2c5168'),
  halo: new THREE.Color('#2f6a80'), moon: new THREE.Color('#9ee1e9'),
  mFar: new THREE.Color('#1f4659'), mMid: new THREE.Color('#173a4c'), mNear: new THREE.Color('#11303f'),
  // dawn
  dZenith: new THREE.Color('#4f7f9e'), dHorizon: new THREE.Color('#e9a27a'), dSun: new THREE.Color('#fff0c8'),
  // DESIGN §9 · the camp at dusk: amber low in the west (toward ARENA.camp.sunDir), teal in the east, a deep blue zenith
  kZenith: new THREE.Color('#2a4d68'), kWest: new THREE.Color('#e48a4c'), kEast: new THREE.Color('#4d7482'), kSun: new THREE.Color('#ffd49a'),
};
/** Night II's sky (DESIGN §8.1: the blood moon; the sky a little warmer and darker). Lerped by MOOD.red. */
export const SKY_RED = {
  zenithTop: new THREE.Color('#141a2c'), zenith: new THREE.Color('#212f48'), horizon: new THREE.Color('#3b4260'),
  halo: new THREE.Color('#6a2422'), moon: new THREE.Color('#e3261a'),
  mFar: new THREE.Color('#283550'), mMid: new THREE.Color('#1f2b44'), mNear: new THREE.Color('#172238'),
};
export const DUSK_SUN_DIR = new THREE.Vector3(ARENA.camp.sunDir.x, ARENA.camp.sunDir.y, ARENA.camp.sunDir.z).normalize();

// the dome's shader is per edition: envSkyMaterial in src/gfx/{webgl2,webgpu}/materials/env.js (decision 0001)
export function createSky() {
  const C = SKY_COLORS;
  const uniforms = {
    uMoonDir: { value: MOON_DIR.clone() }, uMoonR: { value: MOON_RADIUS }, uTime: { value: 0 }, uDawn: { value: 0 },
    uZenithTop: { value: C.zenithTop.clone() }, uZenith: { value: C.zenith.clone() }, uHorizon: { value: C.horizon.clone() },
    uHalo: { value: C.halo.clone() }, uMoon: { value: C.moon.clone().multiplyScalar(2.3) },
    uMFar: { value: C.mFar.clone() }, uMMid: { value: C.mMid.clone() }, uMNear: { value: C.mNear.clone() },
    uDZenith: { value: C.dZenith.clone() }, uDHorizon: { value: C.dHorizon.clone() }, uDSun: { value: C.dSun.clone() },
    uMoonGain: { value: 1 }, uMoonScr: { value: new THREE.Vector4(0, 0, 1, 0) },
    uDusk: { value: 0 }, uSunDir: { value: DUSK_SUN_DIR.clone() }, uKZenith: { value: C.kZenith.clone() },
    uKWest: { value: C.kWest.clone() }, uKEast: { value: C.kEast.clone() }, uKSun: { value: C.kSun.clone() },
    uFogCol: { value: new THREE.Color('#2b5064') },
    uCorona: { value: 0 }, uRain: { value: 0 }, uFlash: { value: 0 }, uWorld: { value: 0 },
    uPortalDir: { value: new THREE.Vector3(0, 0.89, -0.45) }, uPortal: { value: 0 },
    uBeaconPos: { value: new THREE.Vector3(ARENA.beacon.basket.x, ARENA.beacon.basket.y + 6, ARENA.beacon.basket.z) }, uLamp: { value: 0 },
  };
  /** DESIGN §8 · set the night palette (src/env/nights.js `nightLook` / `WORLD_LOOK` blend). */
  function setLook(L) {
    uniforms.uZenithTop.value.copy(L.zenithTop); uniforms.uZenith.value.copy(L.zenith); uniforms.uHorizon.value.copy(L.horizon);
    uniforms.uHalo.value.copy(L.halo); uniforms.uMoon.value.copy(L.moon).multiplyScalar(L.gain);
    uniforms.uMFar.value.copy(L.mFar); uniforms.uMMid.value.copy(L.mMid); uniforms.uMNear.value.copy(L.mNear);
    uniforms.uCorona.value = L.corona;
  }
  /** DESIGN §9 · lerp the night palette toward Night II's (0 Night I .. 1 a full blood moon). @param {number} r */
  function setRed(r) {
    const R = SKY_RED;
    uniforms.uZenithTop.value.copy(C.zenithTop).lerp(R.zenithTop, r);
    uniforms.uZenith.value.copy(C.zenith).lerp(R.zenith, r);
    uniforms.uHorizon.value.copy(C.horizon).lerp(R.horizon, r);
    uniforms.uHalo.value.copy(C.halo).lerp(R.halo, r);
    uniforms.uMoon.value.copy(C.moon).lerp(R.moon, r).multiplyScalar(2.3 - 1.65 * r);   // a deep red disc, not a tone-mapped salmon
    uniforms.uMFar.value.copy(C.mFar).lerp(R.mFar, r);
    uniforms.uMMid.value.copy(C.mMid).lerp(R.mMid, r);
    uniforms.uMNear.value.copy(C.mNear).lerp(R.mNear, r);
  }
  const mat = gfx().materials.envSkyMaterial(uniforms);   // BackSide, no depth test / write, no fog
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), mat);
  mesh.name = 'sky';
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _db = new THREE.Vector2(), _vp = new THREE.Vector4();
  mesh.onBeforeRender = (r, _s, cam) => {
    mesh.position.copy(cam.position); mesh.updateMatrix(); mesh.updateMatrixWorld();
    // the moon's screen centre and radius in the current target's pixels (the disc is drawn in screen space)
    const c = /** @type {THREE.PerspectiveCamera} */ (cam);
    const rt = r.getRenderTarget();
    let W, H;
    if (rt) { W = rt.width; H = rt.height; } else { r.getDrawingBufferSize(_db); W = _db.x; H = _db.y; }
    // (WebGPURenderer has no getCurrentViewport: the target's viewport, else the canvas viewport in pixels)
    const vp = r.getCurrentViewport ? r.getCurrentViewport(_vp) : rt ? _vp.copy(rt.viewport) : r.getViewport(_vp).multiplyScalar(r.getPixelRatio());
    if (vp.z > 0 && vp.w > 0) { W = vp.z; H = vp.w; }
    c.getWorldDirection(_f);
    const front = _f.dot(MOON_DIR) > 0.05 && /** @type {any} */ (c).isPerspectiveCamera;
    if (front) {
      _p.copy(c.position).addScaledVector(MOON_DIR, 400).project(c);
      const py = c.projectionMatrix.elements[5];
      uniforms.uMoonScr.value.set((_p.x * 0.5 + 0.5) * W + vp.x, (_p.y * 0.5 + 0.5) * H + vp.y, Math.tan(MOON_RADIUS) * py * H * 0.5, 1);
    } else uniforms.uMoonScr.value.w = 0;
  };
  return { mesh, uniforms, setRed, setLook };
}
