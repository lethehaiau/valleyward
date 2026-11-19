// @ts-check
// VALLEYWARD · the WebGPU edition's look (the render path; the twin of src/gfx/webgl2/look.js, decision 0001). The same
// hand-written passes, as RenderTargets + QuadMesh passes with TSL node materials, so both editions grade alike:
//   1. world (env + actors + fx) → sceneRT (HalfFloat linear HDR + DepthTexture)
//   2. god-ray mask from the open sky (depth = 1, bright pixels near the moon) → ¼-res radial blur toward the moon
//   3. fluid.pass.render(): composites the fire volume over sceneRT into compRT (skipped when there is no fire pass)
//   4. the viewmodel scene with its own camera after clearing depth (its depth texture doubles as the viewmodel mask)
//   5. bloom (soft threshold on bright pixels only, dual-filter chain at ½…1/32 res)
//   6. one output pass: + bloom + rays → exposure → split-tone grade → tone map (Khronos Neutral by default, AgX on
//      ?tone=agx) → saturation/contrast → dawn grade → vignette → hurt edge → flash → sRGB → mid-tone lift → dither → the canvas.
// WebGPURenderer would tone-map and sRGB-encode a canvas draw itself (an extra framebuffer pass); the output pass encodes
// sRGB itself (like the GLSL), so for that one draw the renderer's output is set to the working (linear) colour space and
// no tone mapping, as three's RenderPipeline does: no double tone map, no double sRGB.
// Texture coordinates: WebGPU render targets are top-down, so the quads' uv() has y = 0 at the top of the frame; the
// moon's screen position is flipped into that convention, and the vignette / dither use the GL-convention uv (y up).
import * as THREE from 'three/webgpu';
import {
  Fn, Loop, uniform, texture, uv, vec2, vec3, vec4, float, int, uint, select, dot, max, min, mix, clamp, smoothstep, step,
  exp, length, sin, fract, pow, floatBitsToUint, neutralToneMapping, agxToneMapping,
} from 'three/tsl';
import { ARENA } from '../../shared/arena.js';
import { MOOD } from '../../look/mood.js';

export const READY = true;

const MOON = new THREE.Vector3(ARENA.moonDir.x, ARENA.moonDir.y, ARENA.moonDir.z).normalize();
const DUSK_SUN = new THREE.Vector3(ARENA.camp.sunDir.x, ARENA.camp.sunDir.y, ARENA.camp.sunDir.z).normalize(); // the camp's low sun
const Q = {
  high: { bloomLevels: 5, rays: 40, raysScale: 0.25 },
  medium: { bloomLevels: 5, rays: 28, raysScale: 0.25 },
  low: { bloomLevels: 4, rays: 20, raysScale: 0.2 },
};

/** The night grade (the same as the WebGL2 look's GRADE). `?exp=` / `?mid=` / `?rays=` override for tuning benches. */
export const GRADE = { exposure: 1.15, mid: 0.2, rays: 0.5 };
{
  const P = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (P?.get('exp')) GRADE.exposure = Number(P.get('exp'));
  if (P?.get('mid')) GRADE.mid = Number(P.get('mid'));
  if (P?.get('rays')) GRADE.rays = Number(P.get('rays'));
}

// ---------------------------------------------------------------------------------------------- TSL helpers
const LUMA = vec3(0.2126, 0.7152, 0.0722);
/** NaN or ±Inf (exponent bits all set): a bit test, because WGSL may assume no NaN in float comparisons. */
const nonFinite1 = (x) => floatBitsToUint(x).bitAnd(uint(0x7f800000)).equal(uint(0x7f800000));
const nonFinite3 = (v) => nonFinite1(v.x).or(nonFinite1(v.y)).or(nonFinite1(v.z));
/** PREFILTER's safe(): NaN / Inf → 0, else min(c, 64). */
const safe = (c) => select(nonFinite3(c), vec3(0.0), min(c, vec3(64.0)));
/** The GLSL ewSRGB (linear → sRGB transfer). */
const ewSRGB = (c) => mix(c.mul(12.92), pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)).mul(1.055).sub(0.055), step(vec3(0.0031308), c));
const h21 = (p) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));

/**
 * @param {{ renderer: any, scene: THREE.Scene, camera: THREE.PerspectiveCamera, quality?: 'high'|'medium'|'low' }} o
 */
export function createLook({ renderer, scene, camera, quality = 'high' }) {
  const q = Q[quality] || Q.high;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const toneParam = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('tone') : null;
  const st = {
    scale: 1, w: 2, h: 2, t: 0, dawnReset: MOOD.dawnReset, exposure: GRADE.exposure, hurt: 0, hurtTarget: 0, flashAmt: 0, flashDecay: 1, dawn: 0, tone: toneParam === 'agx' ? 1 : 0,
    /** @type {any} */ fluid: null, /** @type {{scene: THREE.Scene, camera: THREE.Camera}|null} */ vm: null,
    raysLive: false,
  };

  // ---------------------------------------------------------------- targets
  /** @returns {any} */
  const mkRT = (w, h, depth) => {
    const rt = new THREE.RenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: !!depth, stencilBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false,
    });
    if (depth) { rt.depthTexture = new THREE.DepthTexture(w, h); rt.depthTexture.type = THREE.UnsignedIntType; }
    return rt;
  };
  const sceneRT = mkRT(2, 2, true);
  const compRT = mkRT(2, 2, true);
  const bloomRT = [], bloomUp = [];
  for (let i = 0; i < q.bloomLevels; i++) { bloomRT.push(mkRT(2, 2, false)); bloomUp.push(mkRT(2, 2, false)); }
  const rayA = mkRT(2, 2, false), rayB = mkRT(2, 2, false);

  // ---------------------------------------------------------------- full-screen passes (one QuadMesh per pass)
  /** @param {any} node @param {string} name */
  const pass = (node, name) => {
    const m = new THREE.NodeMaterial();
    m.name = name; m.fragmentNode = node;
    m.depthTest = false; m.depthWrite = false; m.fog = false; m.lights = false; m.toneMapped = false;
    const quad = new THREE.QuadMesh(m); quad.name = name;
    return quad;
  };
  const draw = (quad, target) => { renderer.setRenderTarget(target); quad.render(renderer); };
  const tex = (t) => texture(t);

  // bloom prefilter (soft threshold) at ½ res
  const pre = { tColor: tex(sceneRT.texture), uTexel: uniform(new THREE.Vector2()), uThreshold: uniform(1.0), uKnee: uniform(0.45) };
  const qPre = pass(Fn(() => {
    const p = uv();
    const tap = (o) => safe(pre.tColor.sample(p.add(pre.uTexel.mul(o))).rgb.toVar());
    const c = tap(vec2(-0.5, -0.5)).add(tap(vec2(0.5, -0.5))).add(tap(vec2(-0.5, 0.5))).add(tap(vec2(0.5, 0.5))).mul(0.25).toVar();
    const br = max(c.r, max(c.g, c.b)).toVar();
    const soft0 = clamp(br.sub(pre.uThreshold).add(pre.uKnee), 0.0, pre.uKnee.mul(2.0)).toVar();
    const soft = soft0.mul(soft0).div(pre.uKnee.mul(4.0).add(1e-4));
    const w = max(soft, br.sub(pre.uThreshold)).div(max(br, 1e-4));
    return vec4(c.mul(w), 1.0);
  })(), 'ew-look-prefilter');

  // the dual-filter chain: one material per level (each reads fixed targets; only the texel size changes on resize)
  const downs = [], ups = [];
  const upSpread = uniform(1.0), upW = uniform(0.8);
  for (let i = 1; i < q.bloomLevels; i++) {
    const tIn = tex(bloomRT[i - 1].texture), uTexel = uniform(new THREE.Vector2());
    const quad = pass(Fn(() => {
      const p = uv();
      const s = tIn.sample(p).rgb.mul(4.0).toVar();
      s.addAssign(tIn.sample(p.add(uTexel.mul(vec2(-1.0, -1.0)))).rgb.add(tIn.sample(p.add(uTexel.mul(vec2(1.0, -1.0)))).rgb));
      s.addAssign(tIn.sample(p.add(uTexel.mul(vec2(-1.0, 1.0)))).rgb.add(tIn.sample(p.add(uTexel.mul(vec2(1.0, 1.0)))).rgb));
      return vec4(s.div(8.0), 1.0);
    })(), `ew-look-down${i}`);
    downs[i] = { quad, uTexel };
  }
  for (let i = q.bloomLevels - 2; i >= 0; i--) {
    const src = i === q.bloomLevels - 2 ? bloomRT[q.bloomLevels - 1] : bloomUp[i + 1];
    const tIn = tex(src.texture), tAdd = tex(bloomRT[i].texture), uTexel = uniform(new THREE.Vector2());
    const quad = pass(Fn(() => {
      const p = uv();
      const o = uTexel.mul(upSpread).toVar();
      const s = tIn.sample(p.add(vec2(o.x.mul(-2.0), 0.0))).rgb.add(tIn.sample(p.add(vec2(o.x.mul(2.0), 0.0))).rgb)
        .add(tIn.sample(p.add(vec2(0.0, o.y.mul(-2.0)))).rgb).add(tIn.sample(p.add(vec2(0.0, o.y.mul(2.0)))).rgb).toVar();
      s.addAssign(tIn.sample(p.add(vec2(o.x.negate(), o.y.negate()))).rgb.add(tIn.sample(p.add(vec2(o.x, o.y.negate()))).rgb)
        .add(tIn.sample(p.add(vec2(o.x.negate(), o.y))).rgb).add(tIn.sample(p.add(vec2(o.x, o.y))).rgb).mul(2.0));
      // upW < 1: the widest halos fade (a big fire no longer tints the whole sky)
      return vec4(s.div(12.0).mul(upW).add(tAdd.sample(p).rgb), 1.0);
    })(), `ew-look-up${i}`);
    ups[i] = { quad, src, uTexel };
  }

  // god rays: the mask (open sky near the source, ¼ res) and the radial blur toward the source
  const uMoon = uniform(new THREE.Vector2(0.5, 0.5));   // the source in uv (y down)
  const ray = { tColor: tex(sceneRT.texture), tDepth: tex(sceneRT.depthTexture), uAspect: uniform(1.0), uThr: uniform(0.12), uDecay: uniform(0.965), uDensity: uniform(0.9) };
  const qMask = pass(Fn(() => {
    const p = uv();
    const d = ray.tDepth.sample(p).r;
    const c = ray.tColor.sample(p).rgb.toVar();
    const sky = step(0.99999, d);
    const l = dot(c, LUMA);
    const dv = p.sub(uMoon).mul(vec2(ray.uAspect, 1.0)).toVar();
    const near = exp(dot(dv, dv).negate().div(0.09));
    return vec4(c.mul(sky).mul(smoothstep(ray.uThr, ray.uThr.add(0.35), l)).mul(near), 1.0);
  })(), 'ew-look-raymask');
  const tRayIn = tex(rayA.texture);
  const N = q.rays;
  const qBlur = pass(Fn(() => {
    const p = uv();
    const delta = p.sub(uMoon).mul(ray.uDensity).div(N).toVar();
    const at = p.toVar(), w = float(1.0).toVar(), acc = vec3(0.0).toVar();
    Loop(N, () => {
      at.subAssign(delta);
      acc.addAssign(tRayIn.sample(at).rgb.mul(w));
      w.mulAssign(ray.uDecay);
    });
    return vec4(acc.div(N), 1.0);
  })(), 'ew-look-rayblur');

  // the output pass; `grade` exposes these by the GLSL uniform names (objects with .value)
  const U = {
    tColor: tex(sceneRT.texture), tBloom: tex(bloomUp[0].texture), tRays: tex(rayB.texture), tVmDepth: tex(sceneRT.depthTexture),
    uBloom: uniform(0.75), uRays: uniform(1.6), uExposure: uniform(1.0), uVignette: uniform(0.32), uHurt: uniform(0.0),
    uDawn: uniform(0.0), uTime: uniform(0.0), uFlash: uniform(new THREE.Color(1, 1, 1)), uFlashAmt: uniform(0.0),
    uSat: uniform(1.08), uContrast: uniform(1.04), uShadowTint: uniform(new THREE.Vector3(0.97, 1.0, 1.03)), uMid: uniform(GRADE.mid),
    uHighTint: uniform(new THREE.Vector3(1.06, 1.0, 0.94)), uLift: uniform(0.012), uTone: uniform(st.tone, 'int'),
    uRes: uniform(new THREE.Vector2(1, 1)), toneMappingExposure: uniform(1.0), uRainG: uniform(0.0), uWorld: uniform(0.0),
  };
  const qOut = pass(Fn(() => {
    const p = uv();
    const g = vec2(p.x, p.y.oneMinus());   // the GLSL's vUv (y up)
    const c = U.tColor.sample(p).rgb.toVar();
    c.assign(select(nonFinite3(c), vec3(0.03, 0.06, 0.08), c));
    const vm = float(1.0).sub(step(0.99999, U.tVmDepth.sample(p).r)).toVar();
    c.addAssign(U.tBloom.sample(p).rgb.mul(U.uBloom));
    c.addAssign(U.tRays.sample(p).rgb.mul(U.uRays).mul(vm.oneMinus()));
    c.assign(max(c.mul(U.uExposure), 0.0));
    // split tone (linear): cool teal darks, warm highlights (the fire); dawn warms the lot. The warm highlight push only
    // touches warm or neutral light (DESIGN §11.5): a saturated violet, blue, green or lilac fire keeps its hue
    const l = dot(c, LUMA).toVar();
    const mxc = max(c.r, max(c.g, c.b)).toVar(), mnc = min(c.r, min(c.g, c.b)).toVar();
    const cool = smoothstep(0.35, 0.6, mxc.sub(mnc).div(max(mxc, 1e-4))).mul(smoothstep(0.0, 0.08, max(c.g, c.b).sub(c.r).div(max(mxc, 1e-4)))).toVar();
    c.mulAssign(mix(U.uShadowTint, mix(U.uHighTint, vec3(1.0), cool), smoothstep(0.03, 0.7, l)));
    c.mulAssign(mix(vec3(1.0), vec3(1.07, 1.0, 0.9), U.uDawn));
    // rain grades cooler and a touch darker; the ending's world change grades red-black (fire stays bright)
    c.mulAssign(mix(vec3(1.0), vec3(0.86, 0.93, 1.03), U.uRainG));
    {
      const Lw = dot(c, LUMA).toVar();
      const bright = smoothstep(0.25, 0.9, Lw).toVar();
      const grey = mix(vec3(Lw), c, bright.mul(0.55).add(0.45));
      const dark = grey.mul(smoothstep(0.0, 0.3, Lw).mul(0.38).add(0.62)).mul(mix(vec3(0.85, 0.82, 1.0), vec3(1.0), bright)).toVar();
      c.assign(mix(c, dark, U.uWorld.mul(0.9)));
    }
    // tone map
    c.assign(select(U.uTone.equal(int(1)), agxToneMapping(c, U.toneMappingExposure), neutralToneMapping(c, U.toneMappingExposure)));
    c.assign(clamp(c, 0.0, 1.0));
    // saturation by luminance (calm darks, rich glows) + contrast around mid-grey + a lifted floor (never crushed)
    const L = dot(c, LUMA).toVar();
    c.assign(mix(vec3(L), c, U.uSat.mul(mix(float(0.9), float(1.12), smoothstep(0.1, 0.6, L)))));
    c.assign(clamp(c.sub(0.5).mul(U.uContrast).add(0.5), 0.0, 1.0));
    // the changed world keeps readable darks — the black point lifts to a dark red floor
    const liftK = U.uLift.add(U.uWorld.mul(0.03)).toVar();
    c.assign(c.mul(liftK.oneMinus()).add(mix(vec3(0.55, 0.8, 0.9), vec3(0.3, 0.12, 0.1), U.uWorld).mul(liftK)));
    // vignette + hurt edge + flash
    const qd = g.sub(0.5);
    const r = length(qd.mul(vec2(U.uRes.x.div(U.uRes.y), 1.0))).div(0.9).toVar();
    c.mulAssign(float(1.0).sub(U.uVignette.mul(smoothstep(0.45, 1.15, r))));
    const pulse = sin(U.uTime.mul(7.0)).mul(0.2).add(0.8);
    c.assign(mix(c, vec3(0.55, 0.03, 0.02), U.uHurt.mul(smoothstep(0.35, 1.05, r)).mul(pulse).mul(0.9)));
    c.addAssign(U.uFlash.mul(U.uFlashAmt));
    const lin = clamp(c, 0.0, 1.0).toVar();
    c.assign(ewSRGB(lin));
    // mid-tone lift in display space + more mid-tone lift in the changed world
    c.addAssign(U.uMid.add(U.uWorld.mul(0.35)).mul(c).mul(c.oneMinus()).mul(c.oneMinus()));
    c.addAssign(h21(g.mul(U.uRes).add(fract(U.uTime).mul(61.0))).sub(0.5).div(255.0));   // dither against sky banding
    return vec4(c, 1.0);
  })(), 'ew-look-output');
  U.uTone.value = st.tone;

  const _v = new THREE.Vector3(), _db = new THREE.Vector2(), _dir = new THREE.Vector3();
  function alloc() {
    renderer.getDrawingBufferSize(_db);
    const W = Math.max(2, Math.round(_db.x * st.scale)), H = Math.max(2, Math.round(_db.y * st.scale));
    st.w = W; st.h = H;
    sceneRT.setSize(W, H); compRT.setSize(W, H);
    let bw = W, bh = H;
    for (let i = 0; i < bloomRT.length; i++) {
      bw = Math.max(2, Math.round(bw / 2)); bh = Math.max(2, Math.round(bh / 2));
      bloomRT[i].setSize(bw, bh); bloomUp[i].setSize(bw, bh);
    }
    const rw = Math.max(2, Math.round(W * q.raysScale)), rh = Math.max(2, Math.round(H * q.raysScale));
    rayA.setSize(rw, rh); rayB.setSize(rw, rh);
    st.raysLive = false;   // a resized target starts black
    // texel sizes (fixed per level until the next resize)
    pre.uTexel.value.set(1 / W, 1 / H);
    for (let i = 1; i < bloomRT.length; i++) downs[i].uTexel.value.set(1 / bloomRT[i - 1].width, 1 / bloomRT[i - 1].height);
    for (let i = bloomRT.length - 2; i >= 0; i--) ups[i].uTexel.value.set(1 / ups[i].src.width, 1 / ups[i].src.height);
    U.uRes.value.set(_db.x, _db.y);
  }
  alloc();

  /** Draw to the canvas with the output pass's own encoding (no renderer tone map, no renderer sRGB pass). */
  function drawToCanvas(quad) {
    const cs = renderer.outputColorSpace, tm = renderer.toneMapping;
    renderer.outputColorSpace = THREE.ColorManagement.workingColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    try { draw(quad, null); } finally { renderer.outputColorSpace = cs; renderer.toneMapping = tm; }
  }

  const look = {
    sceneRT, compRT,
    /** World-pass counters (shadow pass included), filled when the caller sets renderer.info.autoReset = false and resets per frame. */
    stats: { worldCalls: 0, worldTris: 0 },
    /** The world colour + depth of the current frame (after render): for modules that need the scene depth. */
    get depthTexture() { return sceneRT.depthTexture; },
    get resolutionScale() { return st.scale; },
    get size() { return { width: st.w, height: st.h }; },
    /** @param {number} dt */
    render(dt = 1 / 60) {
      st.t += dt;
      const prevAuto = renderer.autoClear;
      // 1. world (cleared to black in its own pass, as the GLSL look's clear + render)
      renderer.setClearColor(0x000000, 1);
      renderer.autoClear = true;
      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);
      if (!renderer.info.autoReset) { look.stats.worldCalls = renderer.info.render.drawCalls ?? renderer.info.render.calls; look.stats.worldTris = renderer.info.render.triangles; }
      // 2. god rays (open sky near the moon → radial blur)
      // by night the rays fan from the moon; in the camp at dusk they stream from the low western sun
      if (MOOD.dawnReset !== st.dawnReset) { st.dawnReset = MOOD.dawnReset; st.dawn = 0; }
      const camp = MOOD.camp, dawnE = st.dawn * (1 - camp);
      const SRC = camp > 0.5 ? DUSK_SUN : MOON;
      const srcK = camp > 0.5 ? (camp - 0.5) * 2 * 0.7 : (1 - dawnE) * (1 - camp * 2);
      _v.copy(camera.position).addScaledVector(SRC, 400).project(camera);
      const facing = camera.getWorldDirection(_dir).dot(SRC);
      let rays = 0;
      if (facing > 0.05 && srcK > 0.02) {
        const mx = _v.x * 0.5 + 0.5, my = _v.y * 0.5 + 0.5;
        const off = Math.max(Math.abs(mx - 0.5), Math.abs(my - 0.5));
        // (MathUtils.smoothstep takes (x, min, max), not GLSL's (edge0, edge1, x): the old (1.2, 0.45, off) × (0.05, 0.4, facing) was always 0)
        rays = (1 - THREE.MathUtils.smoothstep(off, 0.45, 1.2)) * THREE.MathUtils.smoothstep(facing, 0.05, 0.4) * srcK;
        if (rays > 0.001) {
          uMoon.value.set(mx, 1 - my);   // uv, y down
          ray.uAspect.value = st.w / st.h;
          draw(qMask, rayA);
          draw(qBlur, rayB);
          st.raysLive = true;
        }
      }
      // (the rays texture stays bound: when the rays stop it is cleared once, as the GLSL look binds a black texture)
      if (rays <= 0.001 && st.raysLive) { renderer.setRenderTarget(rayB); renderer.clear(true, false, false); st.raysLive = false; }
      U.uRays.value = rays > 0.001 ? GRADE.rays * rays : 0;
      // 3. the fire modules' pass
      let target = sceneRT;
      if (st.fluid && typeof st.fluid.render === 'function') {
        try {
          renderer.autoClear = false;
          renderer.setRenderTarget(compRT); renderer.clearDepth();
          st.fluid.render(renderer, { colorTex: sceneRT.texture, depthTex: sceneRT.depthTexture, camera, target: compRT, width: st.w, height: st.h });
          target = compRT;
        } catch (e) { console.warn('[look] fluid pass failed, disabled', e); st.fluid = null; }
      }
      // 4. the viewmodel (own camera, depth cleared); its depth doubles as the mask that keeps rays off the hands
      renderer.setRenderTarget(target);
      if (st.vm && st.vm.scene && st.vm.camera) {
        // one pass: keep the colour, clear the depth
        const cc = renderer.autoClearColor, cs = renderer.autoClearStencil, cd = renderer.autoClearDepth;
        renderer.autoClear = true; renderer.autoClearColor = false; renderer.autoClearDepth = true; renderer.autoClearStencil = false;
        try { renderer.render(st.vm.scene, st.vm.camera); } finally { renderer.autoClearColor = cc; renderer.autoClearStencil = cs; renderer.autoClearDepth = cd; }
      } else {
        renderer.autoClear = false;
        renderer.clearDepth();
      }
      if (U.tVmDepth.value !== target.depthTexture) U.tVmDepth.value = target.depthTexture;
      // 5. bloom (every full-screen pass overwrites its whole target: cleared, not loaded)
      renderer.autoClear = true;
      if (pre.tColor.value !== target.texture) pre.tColor.value = target.texture;
      draw(qPre, bloomRT[0]);
      for (let i = 1; i < bloomRT.length; i++) draw(downs[i].quad, bloomRT[i]);
      for (let i = bloomRT.length - 2; i >= 0; i--) draw(ups[i].quad, bloomUp[i]);
      // 6. output
      st.flashAmt *= Math.exp(-dt * st.flashDecay);
      st.hurt += (st.hurtTarget - st.hurt) * Math.min(1, dt * 6);
      if (U.tColor.value !== target.texture) U.tColor.value = target.texture;
      U.uTime.value = st.t; U.uFlashAmt.value = st.flashAmt; U.uHurt.value = st.hurt;
      U.uDawn.value = dawnE; U.uExposure.value = st.exposure * (1.0 + 0.1 * dawnE) * (1.0 - 0.04 * MOOD.rain);
      U.uRainG.value = MOOD.rain; U.uWorld.value = MOOD.world;
      // lightning: a cold flash on top of whatever the cinema flashes
      if (MOOD.flash > 0.01) { U.uFlash.value.setRGB(0.75, 0.82, 1.0); U.uFlashAmt.value = Math.max(U.uFlashAmt.value, MOOD.flash * 0.1); }
      drawToCanvas(qOut);
      renderer.autoClear = prevAuto;
    },
    /** CSS size is ignored: the look reads the renderer's drawing-buffer size (call after renderer.setSize). */
    setSize(_w, _h) { alloc(); },
    /** @param {number} s 0.5..1 of the drawing buffer (adaptive resolution) */
    setResolutionScale(s) { const v = Math.max(0.35, Math.min(1, s)); if (Math.abs(v - st.scale) > 1e-3) { st.scale = v; alloc(); } },
    /** @param {{ render: Function }|null} p */
    setFluidPass(p) { st.fluid = p || null; },
    /** @param {{ scene: THREE.Scene, camera: THREE.Camera }|null} v */
    setViewmodel(v) { st.vm = v || null; },
    /** @param {THREE.ColorRepresentation|number[]} rgb @param {number} amount @param {number} seconds */
    flash(rgb = 0xffffff, amount = 0.3, seconds = 0.25) {
      const c = U.uFlash.value;
      if (Array.isArray(rgb)) c.setRGB(rgb[0], rgb[1], rgb[2]); else c.set(rgb);
      st.flashAmt = Math.max(st.flashAmt, amount); st.flashDecay = 4.6 / Math.max(0.05, seconds);
    },
    /** @param {number} x 0..1 red edge */
    setHurt(x) { st.hurtTarget = Math.max(0, Math.min(1, x)); },
    /** @param {number} x 0..1 */
    setDawn(x) { st.dawn = Math.max(0, Math.min(1, x)); },
    /** @param {number} e linear exposure multiplier before the tone map (1.15 = the tuned night) */
    setExposure(e) { st.exposure = Math.max(0.1, Math.min(4, e)); },
    /** @param {'neutral'|'agx'} t */
    setTone(t) { st.tone = t === 'agx' ? 1 : 0; U.uTone.value = st.tone; },
    /** Grade knobs (exposure, bloom, rays, vignette, sat, contrast) for tuning benches: TSL uniforms with .value, by the GLSL names. */
    grade: U,
    /** Compile every pipeline once (the scene for its HDR target + all post passes). */
    async warm() {
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(sceneRT);
      try { await renderer.compileAsync(scene, camera); } catch (e) { console.warn('[look] compileAsync', e); }
      renderer.setRenderTarget(prev);
      look.render(0);
    },
    dispose() {
      for (const rt of [sceneRT, compRT, rayA, rayB, ...bloomRT, ...bloomUp]) { rt.depthTexture?.dispose(); rt.dispose(); }
      for (const quad of [qPre, qMask, qBlur, qOut, ...downs.filter(Boolean).map((d) => d.quad), ...ups.filter(Boolean).map((u) => u.quad)]) quad.material.dispose();
    },
  };
  if (typeof window !== 'undefined') /** @type {any} */ (window).__ewLook = look;   // tuning hook (grade uniforms, exposure)
  return look;
}
