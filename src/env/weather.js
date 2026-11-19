// @ts-check
// Environment (DESIGN §8.3): rain. `state.weather.rain` 0..1 (Night IV's squalls, Night X's storm) drives:
//   streaks   one instanced draw of thin world-space streaks in a box that follows the camera (wrapped in the shader,
//             slanted by the wind, fogged), as many instances as the rain is heavy;
//   splashes  one instanced draw of small pixel crowns on the ground round the camera (ewGround, phase per instance);
//   lightning in the storm (Night X, rain ≥ 0.5): double flashes every 4–10 s; the env lifts the sky light, the sky
//             shader lights the overcast, the look adds a cold flash (MOOD.flash) — the audio code can follow MOOD.lightning.
// The wet ground sheen and the darker, cooler sky / fog live in materials.js (ENVFX.uWet) and index.js (applyMood).
import * as THREE from 'three';
import { gfx } from '../gfx/current.js';

const BOX = new THREE.Vector3(44, 26, 44);

export function createRain(quality = 'high') {
  const N = quality === 'low' ? 1800 : quality === 'medium' ? 3500 : 6000;
  const NS = quality === 'low' ? 250 : 600;
  const group = new THREE.Group(); group.name = 'rain';
  const uniforms = {
    uTime: { value: 0 }, uRain: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: BOX.clone() },
    uWind: { value: new THREE.Vector2(1.6, 0.8) }, uFogDensity: { value: 0.007 }, uTint: { value: new THREE.Color(0.75, 0.82, 0.92) },
    uFlash: { value: 0 },
  };

  // ---------------------------------------------------------------- streaks
  const quad = new THREE.PlaneGeometry(1, 1); quad.translate(0, 0.5, 0);
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index; g.attributes.position = quad.attributes.position; g.attributes.uv = quad.attributes.uv;
  const seed = new Float32Array(N * 4);
  for (let i = 0; i < N * 4; i++) seed[i] = Math.random();
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  g.instanceCount = 0;
  const streakMat = gfx().materials.envRainStreakMaterial(uniforms);   // per edition (decision 0001); transparent, double-sided
  const streaks = new THREE.Mesh(g, streakMat);
  streaks.frustumCulled = false; streaks.renderOrder = 6; streaks.name = 'rain-streaks';
  group.add(streaks);

  // ---------------------------------------------------------------- splashes (pixel crowns on the ground)
  const sg = new THREE.InstancedBufferGeometry();
  const sq = new THREE.PlaneGeometry(1, 1); sq.rotateX(-Math.PI / 2);
  sg.index = sq.index; sg.attributes.position = sq.attributes.position; sg.attributes.uv = sq.attributes.uv;
  const sseed = new Float32Array(NS * 4);
  for (let i = 0; i < NS * 4; i++) sseed[i] = Math.random();
  sg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sseed, 4));
  sg.instanceCount = 0;
  const splashMat = gfx().materials.envRainSplashMaterial(uniforms);   // per edition (decision 0001); polygon offset, transparent
  const splashes = new THREE.Mesh(sg, splashMat);
  splashes.frustumCulled = false; splashes.renderOrder = 5; splashes.name = 'rain-splashes';
  group.add(splashes);

  // ---------------------------------------------------------------- lightning (a timer; the effects are applied by the env)
  const L = { next: 3 + Math.random() * 4, t: 99, flash: 0, count: 0 };

  return {
    group, uniforms, streaks, splashes,
    /** the current lightning flash 0..1 (≈ 0.35 s double pulse) */
    get flash() { return L.flash; },
    get strikes() { return L.count; },
    /**
     * @param {number} dt @param {number} t @param {number} rain 0..1 @param {THREE.Camera} camera @param {number} fogDensity
     * @param {boolean} storm lightning on (Night X's storm, or state.weather.storm)
     */
    update(dt, t, rain, camera, fogDensity, storm) {
      uniforms.uTime.value = t; uniforms.uRain.value = rain; uniforms.uFogDensity.value = fogDensity;
      uniforms.uCam.value.setFromMatrixPosition(camera.matrixWorld);
      g.instanceCount = Math.round(N * Math.min(1, rain * 1.15));
      sg.instanceCount = Math.round(NS * Math.min(1, rain * 1.2));
      streaks.visible = g.instanceCount > 0; splashes.visible = sg.instanceCount > 0;
      // lightning
      L.t += dt;
      if (storm && rain >= 0.45) {
        L.next -= dt;
        if (L.next <= 0) { L.t = 0; L.count++; L.next = 4 + Math.random() * 6; }
      }
      const x = L.t;
      L.flash = x < 0.4 ? Math.max(Math.exp(-x / 0.05) * 1.0, x > 0.12 ? Math.exp(-(x - 0.12) / 0.09) * 0.8 : 0) : 0;
      uniforms.uFlash.value = L.flash;
    },
    /** Force a strike now (benches, the cinema). */
    strike() { L.t = 0; L.count++; },
  };
}
