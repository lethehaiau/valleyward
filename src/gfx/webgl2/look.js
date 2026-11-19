// @ts-check
// VALLEYWARD · the WebGL2 edition's look (moved from src/look/index.js, decision 0001) · the render path (docs/DESIGN.md §14.3, §14.7). Hand-written, no composer, so the fluid can sit between the
// world and the viewmodel:
//   1. world (env + actors + fx) → sceneRT (HalfFloat linear HDR + DepthTexture)
//   2. god-ray mask from the open sky (depth = 1, bright pixels near the moon) → ¼-res radial blur toward the moon
//   3. fluid.pass.render(): composites the fire volume over sceneRT into compRT (skipped when the fluid is missing)
//   4. the viewmodel scene with its own camera after clearing depth (its depth texture doubles as the viewmodel mask)
//   5. bloom (soft threshold on bright pixels only, dual-filter chain at ½…1/32 res)
//   6. one output pass: + bloom + rays → exposure → split-tone grade → tone map (Khronos Neutral by default, AgX on
//      ?tone=agx) → saturation/contrast → dawn grade → vignette → hurt edge → flash → dither → sRGB → the canvas.
// No SSR, TAA, DOF or MSAA. Resolution scale (the core's adaptive resolution drives it): setResolutionScale(0.5..1).
import * as THREE from 'three';
import { ARENA } from '../../shared/arena.js';
import { MOOD } from '../../look/mood.js';

const MOON = new THREE.Vector3(ARENA.moonDir.x, ARENA.moonDir.y, ARENA.moonDir.z).normalize();
const DUSK_SUN = new THREE.Vector3(ARENA.camp.sunDir.x, ARENA.camp.sunDir.y, ARENA.camp.sunDir.z).normalize(); // the camp's low sun
const Q = {
  high: { bloomLevels: 5, rays: 40, raysScale: 0.25 },
  medium: { bloomLevels: 5, rays: 28, raysScale: 0.25 },
  low: { bloomLevels: 4, rays: 20, raysScale: 0.2 },
};

/** The night grade (without it the frame body was 20–45 % darker than the key art). `?exp=` / `?mid=` override
 *  for tuning benches. */
export const GRADE = { exposure: 1.15, mid: 0.2, rays: 0.5 };   // tuned at m1/m2 without fire: p50 ≈ 0.22–0.24 (docs/ENV.md §5); rays: the god rays' strength (`?rays=`): the moon keeps a soft halo as in the key art, the treeline stays clear
{
  const P = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (P?.get('exp')) GRADE.exposure = Number(P.get('exp'));
  if (P?.get('mid')) GRADE.mid = Number(P.get('mid'));
  if (P?.get('rays')) GRADE.rays = Number(P.get('rays'));
}

const VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PREFILTER = /* glsl */`
  uniform sampler2D tColor; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee; varying vec2 vUv;
  vec3 safe(vec3 c){ return (any(isnan(c)) || any(isinf(c))) ? vec3(0.0) : min(c, vec3(64.0)); }
  void main(){
    vec3 c = safe(texture2D(tColor, vUv + uTexel * vec2(-0.5, -0.5)).rgb) + safe(texture2D(tColor, vUv + uTexel * vec2(0.5, -0.5)).rgb)
           + safe(texture2D(tColor, vUv + uTexel * vec2(-0.5, 0.5)).rgb) + safe(texture2D(tColor, vUv + uTexel * vec2(0.5, 0.5)).rgb);
    c *= 0.25;
    float br = max(c.r, max(c.g, c.b));
    float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-4);
    float w = max(soft, br - uThreshold) / max(br, 1e-4);
    gl_FragColor = vec4(c * w, 1.0);
  }`;
const DOWN = /* glsl */`
  uniform sampler2D tIn; uniform vec2 uTexel; varying vec2 vUv;
  void main(){
    vec3 s = texture2D(tIn, vUv).rgb * 4.0;
    s += texture2D(tIn, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tIn, vUv + uTexel * vec2(1.0, -1.0)).rgb;
    s += texture2D(tIn, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tIn, vUv + uTexel * vec2(1.0, 1.0)).rgb;
    gl_FragColor = vec4(s / 8.0, 1.0);
  }`;
const UP = /* glsl */`
  uniform sampler2D tIn; uniform sampler2D tAdd; uniform vec2 uTexel; uniform float uSpread; uniform float uUpW; varying vec2 vUv;
  void main(){
    vec2 o = uTexel * uSpread;
    vec3 s = texture2D(tIn, vUv + vec2(-o.x * 2.0, 0.0)).rgb + texture2D(tIn, vUv + vec2(o.x * 2.0, 0.0)).rgb
           + texture2D(tIn, vUv + vec2(0.0, -o.y * 2.0)).rgb + texture2D(tIn, vUv + vec2(0.0, o.y * 2.0)).rgb;
    s += (texture2D(tIn, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tIn, vUv + vec2(o.x, -o.y)).rgb
        + texture2D(tIn, vUv + vec2(-o.x, o.y)).rgb + texture2D(tIn, vUv + vec2(o.x, o.y)).rgb) * 2.0;
    gl_FragColor = vec4(s / 12.0 * uUpW + texture2D(tAdd, vUv).rgb, 1.0);   // uUpW < 1: the widest halos fade (a big fire no longer tints the whole sky)
  }`;
const RAYMASK = /* glsl */`
  uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uMoon; uniform float uAspect; uniform float uThr; varying vec2 vUv;
  void main(){
    float d = texture2D(tDepth, vUv).r;
    vec3 c = texture2D(tColor, vUv).rgb;
    float sky = step(0.99999, d);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec2 dv = (vUv - uMoon) * vec2(uAspect, 1.0);
    float near = exp(-dot(dv, dv) / 0.09);
    gl_FragColor = vec4(c * sky * smoothstep(uThr, uThr + 0.35, l) * near, 1.0);
  }`;
const RAYBLUR = /* glsl */`
  uniform sampler2D tIn; uniform vec2 uMoon; uniform float uDecay; uniform float uDensity; varying vec2 vUv;
  #define N RAY_SAMPLES
  void main(){
    vec2 delta = (vUv - uMoon) * uDensity / float(N);
    vec2 uv = vUv; float w = 1.0; vec3 acc = vec3(0.0);
    for (int i = 0; i < N; i++){ uv -= delta; acc += texture2D(tIn, uv).rgb * w; w *= uDecay; }
    gl_FragColor = vec4(acc / float(N), 1.0);
  }`;
const OUTPUT = /* glsl */`
  ${THREE.ShaderChunk.tonemapping_pars_fragment}
  uniform sampler2D tColor; uniform sampler2D tBloom; uniform sampler2D tRays; uniform sampler2D tVmDepth;
  uniform float uBloom; uniform float uRays; uniform float uExposure; uniform float uVignette; uniform float uHurt;
  uniform float uDawn; uniform float uTime; uniform vec3 uFlash; uniform float uFlashAmt; uniform float uSat; uniform float uContrast;
  uniform vec3 uShadowTint; uniform vec3 uHighTint; uniform float uLift; uniform int uTone; uniform vec2 uRes; uniform float uMid;
  uniform float uRainG; uniform float uWorld;
  varying vec2 vUv;
  float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  vec3 ewSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
  void main(){
    vec3 c = texture2D(tColor, vUv).rgb;
    if (any(isnan(c)) || any(isinf(c))) c = vec3(0.03, 0.06, 0.08);
    float vm = 1.0 - step(0.99999, texture2D(tVmDepth, vUv).r);
    c += texture2D(tBloom, vUv).rgb * uBloom;
    c += texture2D(tRays, vUv).rgb * uRays * (1.0 - vm);
    c = max(c * uExposure, 0.0);
    // split tone (linear): cool teal darks, warm highlights (the fire); dawn warms the lot
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // DESIGN §11.5: the warm highlight push only touches warm or neutral light; a saturated violet, blue, green
    // or lilac fire (and its light on the walls) keeps the hue the fluid writes
    float mxc = max(c.r, max(c.g, c.b)), mnc = min(c.r, min(c.g, c.b));
    float cool = smoothstep(0.35, 0.6, (mxc - mnc) / max(mxc, 1e-4)) * smoothstep(0.0, 0.08, (max(c.g, c.b) - c.r) / max(mxc, 1e-4));
    c *= mix(uShadowTint, mix(uHighTint, vec3(1.0), cool), smoothstep(0.03, 0.7, l));
    c *= mix(vec3(1.0), vec3(1.07, 1.0, 0.9), uDawn);
    // rain grades cooler and a touch darker; the ending's world change grades red-black (fire stays bright)
    c *= mix(vec3(1.0), vec3(0.86, 0.93, 1.03), uRainG);
    {
      float Lw = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // the world change (contrast, not a red wash): darks fall to near-black with a cold indigo cast, mid
      // tones lose colour, and only bright light (the portal, the pillar, lava, fire) keeps its red-orange
      float bright = smoothstep(0.25, 0.9, Lw);
      vec3 grey = mix(vec3(Lw), c, 0.45 + 0.55 * bright);
      vec3 dark = grey * (0.62 + 0.38 * smoothstep(0.0, 0.3, Lw)) * mix(vec3(0.85, 0.82, 1.0), vec3(1.0), bright);
      c = mix(c, dark, uWorld * 0.9);
    }
    // tone map
    if (uTone == 1) c = AgXToneMapping(c); else c = NeutralToneMapping(c);
    c = clamp(c, 0.0, 1.0);
    // saturation by luminance (calm darks, rich glows) + contrast around mid-grey + a lifted floor (never crushed)
    float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(L), c, uSat * mix(0.9, 1.12, smoothstep(0.1, 0.6, L)));
    c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);
    // the changed world keeps readable darks — the black point lifts to a dark red floor
    float liftK = uLift + 0.03 * uWorld;
    c = c * (1.0 - liftK) + liftK * mix(vec3(0.55, 0.8, 0.9), vec3(0.3, 0.12, 0.1), uWorld);
    // vignette + hurt edge + flash
    vec2 q = vUv - 0.5;
    float r = length(q * vec2(uRes.x / uRes.y, 1.0)) / 0.9;
    c *= 1.0 - uVignette * smoothstep(0.45, 1.15, r);
    float pulse = 0.8 + 0.2 * sin(uTime * 7.0);
    c = mix(c, vec3(0.55, 0.03, 0.02), uHurt * smoothstep(0.35, 1.05, r) * pulse * 0.9);
    c += uFlash * uFlashAmt;
    c = ewSRGB(clamp(c, 0.0, 1.0));
    // mid-tone lift in display space: raises the body of the frame toward the key art's p50
    // (0.22–0.25) while the highlights (fire, moon) and the deepest darks barely move
    c += (uMid + 0.35 * uWorld) * c * (1.0 - c) * (1.0 - c);   // + more mid-tone lift in the changed world
    c += (h21(vUv * uRes + fract(uTime) * 61.0) - 0.5) / 255.0;   // dither against sky banding
    gl_FragColor = vec4(c, 1.0);
  }`;

/**
 * @param {{ renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, quality?: 'high'|'medium'|'low' }} o
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
  };

  // ---------------------------------------------------------------- targets
  const mkRT = (w, h, depth) => {
    const rt = new THREE.WebGLRenderTarget(w, h, {
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
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;

  // ---------------------------------------------------------------- full-screen passes
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(tri);
  quad.frustumCulled = false;
  const mat = (frag, uniforms, defines = {}) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, defines, depthTest: false, depthWrite: false, toneMapped: false });
  const mPre = mat(PREFILTER, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.0 }, uKnee: { value: 0.45 } });
  const mDown = mat(DOWN, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const mUp = mat(UP, { tIn: { value: null }, tAdd: { value: null }, uTexel: { value: new THREE.Vector2() }, uSpread: { value: 1.0 }, uUpW: { value: 0.8 } });
  const mMask = mat(RAYMASK, { tColor: { value: null }, tDepth: { value: null }, uMoon: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uThr: { value: 0.12 } });
  const mBlur = mat(RAYBLUR, { tIn: { value: null }, uMoon: { value: new THREE.Vector2() }, uDecay: { value: 0.965 }, uDensity: { value: 0.9 } }, { RAY_SAMPLES: q.rays });
  const mOut = mat(OUTPUT, {
    tColor: { value: null }, tBloom: { value: black }, tRays: { value: black }, tVmDepth: { value: white },
    uBloom: { value: 0.75 }, uRays: { value: 1.6 }, uExposure: { value: 1.0 }, uVignette: { value: 0.32 }, uHurt: { value: 0 },
    uDawn: { value: 0 }, uTime: { value: 0 }, uFlash: { value: new THREE.Color(1, 1, 1) }, uFlashAmt: { value: 0 },
    uSat: { value: 1.08 }, uContrast: { value: 1.04 }, uShadowTint: { value: new THREE.Vector3(0.97, 1.0, 1.03) }, uMid: { value: GRADE.mid },
    uHighTint: { value: new THREE.Vector3(1.06, 1.0, 0.94) }, uLift: { value: 0.012 }, uTone: { value: st.tone },
    uRes: { value: new THREE.Vector2(1, 1) }, toneMappingExposure: { value: 1.0 }, uRainG: { value: 0 }, uWorld: { value: 0 },
  });
  const draw = (m, target) => { quad.material = m; renderer.setRenderTarget(target); renderer.render(quad, quadCam); };

  const _v = new THREE.Vector3(), _db = new THREE.Vector2();
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
    mOut.uniforms.uRes.value.set(_db.x, _db.y);
  }
  alloc();

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
      renderer.autoClear = false;
      // 1. world
      renderer.setRenderTarget(sceneRT);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, false);
      renderer.render(scene, camera);
      if (!renderer.info.autoReset) { look.stats.worldCalls = renderer.info.render.calls; look.stats.worldTris = renderer.info.render.triangles; }
      // 2. god rays (open sky near the moon → radial blur)
      // by night the rays fan from the moon; in the camp at dusk they stream from the low western sun
      if (MOOD.dawnReset !== st.dawnReset) { st.dawnReset = MOOD.dawnReset; st.dawn = 0; }
      const camp = MOOD.camp, dawnE = st.dawn * (1 - camp);
      const SRC = camp > 0.5 ? DUSK_SUN : MOON;
      const srcK = camp > 0.5 ? (camp - 0.5) * 2 * 0.7 : (1 - dawnE) * (1 - camp * 2);
      _v.copy(camera.position).addScaledVector(SRC, 400).project(camera);
      const camDir = camera.getWorldDirection(new THREE.Vector3());
      const facing = camDir.dot(SRC);
      let rays = 0;
      if (facing > 0.05 && srcK > 0.02) {
        const mx = _v.x * 0.5 + 0.5, my = _v.y * 0.5 + 0.5;
        const off = Math.max(Math.abs(mx - 0.5), Math.abs(my - 0.5));
        // (MathUtils.smoothstep takes (x, min, max), not GLSL's (edge0, edge1, x): the old (1.2, 0.45, off) × (0.05, 0.4, facing) was always 0)
        rays = (1 - THREE.MathUtils.smoothstep(off, 0.45, 1.2)) * THREE.MathUtils.smoothstep(facing, 0.05, 0.4) * srcK;
        if (rays > 0.001) {
          mMask.uniforms.tColor.value = sceneRT.texture; mMask.uniforms.tDepth.value = sceneRT.depthTexture;
          mMask.uniforms.uMoon.value.set(mx, my); mMask.uniforms.uAspect.value = st.w / st.h;
          draw(mMask, rayA);
          mBlur.uniforms.tIn.value = rayA.texture; mBlur.uniforms.uMoon.value.set(mx, my);
          draw(mBlur, rayB);
        }
      }
      mOut.uniforms.tRays.value = rays > 0.001 ? rayB.texture : black;
      mOut.uniforms.uRays.value = GRADE.rays * rays;
      // 3. the fluid's fire volume
      let target = sceneRT;
      if (st.fluid && typeof st.fluid.render === 'function') {
        try {
          renderer.setRenderTarget(compRT); renderer.clearDepth();
          st.fluid.render(renderer, { colorTex: sceneRT.texture, depthTex: sceneRT.depthTexture, camera, target: compRT, width: st.w, height: st.h });
          target = compRT;
        } catch (e) { console.warn('[look] fluid pass failed, disabled', e); st.fluid = null; }
        renderer.autoClear = false;
      }
      // 4. the viewmodel (own camera, depth cleared); its depth doubles as the mask that keeps rays off the hands
      renderer.setRenderTarget(target);
      renderer.clearDepth();
      if (st.vm && st.vm.scene && st.vm.camera) renderer.render(st.vm.scene, st.vm.camera);
      mOut.uniforms.tVmDepth.value = target.depthTexture;
      // 5. bloom
      mPre.uniforms.tColor.value = target.texture; mPre.uniforms.uTexel.value.set(1 / st.w, 1 / st.h);
      draw(mPre, bloomRT[0]);
      for (let i = 1; i < bloomRT.length; i++) {
        mDown.uniforms.tIn.value = bloomRT[i - 1].texture; mDown.uniforms.uTexel.value.set(1 / bloomRT[i - 1].width, 1 / bloomRT[i - 1].height);
        draw(mDown, bloomRT[i]);
      }
      let up = bloomRT[bloomRT.length - 1];
      for (let i = bloomRT.length - 2; i >= 0; i--) {
        mUp.uniforms.tIn.value = up.texture; mUp.uniforms.tAdd.value = bloomRT[i].texture;
        mUp.uniforms.uTexel.value.set(1 / up.width, 1 / up.height);
        draw(mUp, bloomUp[i]); up = bloomUp[i];
      }
      mOut.uniforms.tBloom.value = up.texture;
      // 6. output
      st.flashAmt *= Math.exp(-dt * st.flashDecay);
      st.hurt += (st.hurtTarget - st.hurt) * Math.min(1, dt * 6);
      const U = mOut.uniforms;
      U.tColor.value = target.texture; U.uTime.value = st.t; U.uFlashAmt.value = st.flashAmt; U.uHurt.value = st.hurt;
      U.uDawn.value = dawnE; U.uExposure.value = st.exposure * (1.0 + 0.1 * dawnE) * (1.0 - 0.04 * MOOD.rain);
      U.uRainG.value = MOOD.rain; U.uWorld.value = MOOD.world;
      // lightning: a cold flash on top of whatever the cinema flashes
      if (MOOD.flash > 0.01) { U.uFlash.value.setRGB(0.75, 0.82, 1.0); U.uFlashAmt.value = Math.max(U.uFlashAmt.value, MOOD.flash * 0.1); }
      draw(mOut, null);
      renderer.autoClear = prevAuto;
    },
    /** CSS size is ignored: the look reads the renderer's drawing-buffer size (call after renderer.setSize). */
    setSize(_w, _h) { alloc(); },
    /** @param {number} s 0.5..1 of the drawing buffer (adaptive resolution) */
    setResolutionScale(s) { const v = Math.max(0.35, Math.min(1, s)); if (Math.abs(v - st.scale) > 1e-3) { st.scale = v; alloc(); } },
    /** @param {{ render: Function }|null} pass */
    setFluidPass(pass) { st.fluid = pass || null; },
    /** @param {{ scene: THREE.Scene, camera: THREE.Camera }|null} v */
    setViewmodel(v) { st.vm = v || null; },
    /** @param {THREE.ColorRepresentation|number[]} rgb @param {number} amount @param {number} seconds */
    flash(rgb = 0xffffff, amount = 0.3, seconds = 0.25) {
      const c = mOut.uniforms.uFlash.value;
      if (Array.isArray(rgb)) c.setRGB(rgb[0], rgb[1], rgb[2]); else c.set(rgb);
      st.flashAmt = Math.max(st.flashAmt, amount); st.flashDecay = 4.6 / Math.max(0.05, seconds);
    },
    /** @param {number} x 0..1 red edge */
    setHurt(x) { st.hurtTarget = Math.max(0, Math.min(1, x)); },
    /** @param {number} x 0..1 */
    setDawn(x) { st.dawn = Math.max(0, Math.min(1, x)); },
    /** @param {number} e linear exposure multiplier before the tone map (1.15 = the tuned night: m1 + fire ≈ M1's mean luma) */
    setExposure(e) { st.exposure = Math.max(0.1, Math.min(4, e)); },
    /** @param {'neutral'|'agx'} t */
    setTone(t) { st.tone = t === 'agx' ? 1 : 0; mOut.uniforms.uTone.value = st.tone; },
    /** Grade knobs (exposure, bloom, rays, vignette, sat, contrast) for tuning benches. */
    grade: mOut.uniforms,
    /** Compile every program once (scene under its lights + all post passes). */
    async warm() {
      try { await renderer.compileAsync(scene, camera); } catch { try { renderer.compile(scene, camera); } catch { /* */ } }
      look.render(0);
    },
    dispose() {
      for (const rt of [sceneRT, compRT, rayA, rayB, ...bloomRT, ...bloomUp]) { rt.depthTexture?.dispose(); rt.dispose(); }
      for (const m of [mPre, mDown, mUp, mMask, mBlur, mOut]) m.dispose();
      tri.dispose(); black.dispose(); white.dispose();
    },
  };
  if (typeof window !== 'undefined') /** @type {any} */ (window).__ewLook = look;   // tuning hook (grade uniforms, exposure)
  return look;
}
