// VALLEYWARD · the WebGL2 edition's custom materials for the environment (GLSL, moved verbatim from src/env/; decision 0001,
// docs/WEBGPU-PORT.md). Each factory has a TSL twin of the same name in src/gfx/webgpu/materials/env.js. Factories take the
// environment's uniform objects ({ value }) and return a material whose `.uniforms` are those same objects; patches take the
// standard material the environment built. Names carry an `env` prefix (the layers' registries merge every module's exports).
import * as THREE from 'three';
import { GROUND_GLSL } from '../../../shared/firelight.js';

// ------------------------------------------------------------------------------------------------ sky (src/env/sky.js)
const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main(){
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;            // on the far plane
  }`;

const SKY_FRAG = /* glsl */`
  uniform vec3 uMoonDir; uniform float uMoonR; uniform float uTime; uniform float uDawn;
  uniform vec3 uZenithTop, uZenith, uHorizon, uHalo, uMoon, uMFar, uMMid, uMNear, uDZenith, uDHorizon, uDSun;
  uniform float uMoonGain; uniform vec4 uMoonScr;
  uniform float uDusk; uniform vec3 uSunDir, uKZenith, uKWest, uKEast, uKSun, uFogCol;
  uniform float uCorona, uRain, uFlash, uWorld;   // the black moon's corona, rain overcast, lightning, the world change
  uniform vec3 uPortalDir; uniform float uPortal;  // the portal's direction from the scene and how open it is
  uniform vec3 uBeaconPos; uniform float uLamp;     // the lamp's pillar lights the sky round it
  varying vec3 vDir;
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n1(float x){ float i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f); return mix(h21(vec2(i, 7.1)), h21(vec2(i + 1.0, 7.1)), f); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y); }
  float ridge(float az, float freq, float seed){
    float r = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++){ float n = n1(az * freq + seed); n = 1.0 - abs(n * 2.0 - 1.0); r += n * n * a; a *= 0.5; freq *= 2.1; seed += 13.7; }
    return r;
  }
  void main(){
    vec3 d = normalize(vDir);
    float el = d.y;
    float az = atan(d.z, d.x);
    vec3 east = vec3(1.0, 0.0, 0.0);
    // ---------------- gradient (night → dawn)
    vec3 zen = mix(uZenith, uDZenith, uDawn), zenTop = mix(uZenithTop, uDZenith * 0.8, uDawn);
    float eastness = max(0.0, dot(normalize(vec3(d.x, 0.0, d.z)), east));
    vec3 hor = mix(uHorizon, mix(uDZenith * 1.2, uDHorizon, eastness * eastness), uDawn);
    vec3 col = mix(hor, zen, smoothstep(-0.02, 0.42, el));
    col = mix(col, zenTop, smoothstep(0.45, 1.0, el));
    // ---------------- dusk (the camp): amber hugging the western horizon, teal in the east, the low sun
    vec3 sunH = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
    float w01 = dot(normalize(vec3(d.x, 0.0, d.z) + vec3(1e-5)), sunH) * 0.5 + 0.5;    // 1 toward the sun
    float sa = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
    vec3 kHor = mix(uKEast, uKWest, smoothstep(0.2, 1.0, w01));
    kHor = mix(kHor, uFogCol, 0.25);
    {
      vec3 k = mix(kHor, uKZenith, smoothstep(-0.02, mix(0.2, 0.55, w01 * w01), el));
      k = mix(k, uKZenith * 0.72, smoothstep(0.5, 1.0, el));
      k += uKSun * (exp(-sa / 0.32) * 0.28 + exp(-sa / 0.08) * 0.45) * smoothstep(-0.1, 0.05, el);
      col = mix(col, k, uDusk);
      hor = mix(hor, kHor, uDusk);
      zen = mix(zen, uKZenith, uDusk);
    }
    // ---------------- moon halo + fanned rays
    float cosA = dot(d, uMoonDir);
    float ang = acos(clamp(cosA, -1.0, 1.0));
    // the disc and its tight halo are measured in screen pixels around the moon's projected
    // centre, so the moon stays round anywhere on a wide-angle frame (the angular disc stretched into an oval off-centre)
    vec2 qs = (gl_FragCoord.xy - uMoonScr.xy) / max(1.0, uMoonScr.z);
    float angM = uMoonScr.w > 0.5 ? length(qs) * uMoonR : ang;
    float night = (1.0 - uDawn) * (1.0 - uDusk);
    col += uHalo * (exp(-ang * ang / (0.42 * 0.42)) * 0.85 + exp(-angM / 0.07) * 0.9) * night * uMoonGain;
    vec3 tU = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
    vec3 tV = cross(uMoonDir, tU);
    vec2 mp = vec2(dot(d, tU), dot(d, tV));
    float rayAng = atan(mp.x, -mp.y);   // 0 straight below the moon
    float rays = n1(rayAng * 9.0 + 3.0) * n1(rayAng * 23.0 + uTime * 0.03);
    float below = smoothstep(0.2, 1.4, -mp.y / max(0.001, length(mp))) ;
    col += uHalo * 0.55 * rays * below * smoothstep(uMoonR * 1.1, uMoonR * 1.6, ang) * exp(-ang / 0.55) * night * uMoonGain;
    // ---------------- clouds: thin bands lit from the moon side
    if (el > 0.0) {
      vec2 cp = d.xz / (el + 0.18) * 1.6 + vec2(uTime * 0.004, 0.0);
      float c = n2(cp * 1.3) * 0.6 + n2(cp * 3.1 + 5.0) * 0.4;
      c = smoothstep(0.58, 0.82, c) * smoothstep(0.02, 0.12, el) * (1.0 - smoothstep(0.35, 0.7, el));
      vec3 cc = mix(zen * 0.75, uHalo * 1.6, exp(-ang / 0.5));
      cc = mix(cc, mix(uKZenith * 0.9, uKWest * 1.35 + uKSun * 0.2, exp(-sa / 0.7)), uDusk);   // dusk: underlit by the sun
      col = mix(col, cc, c * mix(0.55, 0.7, uDusk));
      // in the changed world only the clouds near the portal are lit, red-orange from below; the rest are smoke
      float angPc = acos(clamp(dot(d, uPortalDir), -1.0, 1.0));
      col = mix(col, vec3(0.05, 0.032, 0.04), c * uWorld * 0.7);
      col += vec3(1.6, 0.3, 0.06) * c * uWorld * exp(-angPc / 0.45) * (0.3 + 0.7 * uPortal);
    }
    // ---------------- stars
    {
      vec3 sd = d * 160.0; vec3 cell = floor(sd);
      float h = h21(cell.xy + cell.z * 17.31);
      vec3 sp = fract(sd) - 0.5;
      float star = step(0.9965, h) * smoothstep(0.17, 0.0, length(sp)) * (0.6 + 0.4 * sin(uTime * (1.5 + h * 4.0) + h * 40.0));
      star *= smoothstep(0.12, 0.4, el) * smoothstep(0.25, 0.6, ang) * night * (1.0 - uRain);
      col += vec3(0.75, 0.9, 1.0) * star * 0.8;
    }
    // ---------------- the moon: a pixelated disc with craters
    {
      vec2 q = uMoonScr.w > 0.5 ? vec2(qs.x, qs.y) : mp / uMoonR;
      vec2 qp = (floor(q * 30.0) + 0.5) / 30.0;          // 60 px across: the retro moon of the references
      float r = length(qp);
      if (r < 1.0 && cosA > 0.0) {
        float cr = n2(qp * 3.2 + 4.0) * 0.55 + n2(qp * 7.0 + 1.3) * 0.3 + n2(qp * 15.0) * 0.15;
        float maria = smoothstep(0.52, 0.62, cr);
        float limb = 1.0 - 0.28 * r * r;
        vec3 mc = uMoon * (1.0 - 0.32 * maria) * limb;
        mc = mix(mc, mc * vec3(0.82, 0.92, 0.95), step(0.66, n2(qp * 11.0 + 9.0)) * 0.6);
        // Night X (and the world change) — a black disc with a faint ember limb
        mc = mix(mc, vec3(0.012, 0.003, 0.002) + vec3(0.5, 0.05, 0.02) * smoothstep(0.82, 1.0, r) * 0.5, uCorona);
        col = mix(col, mc * uMoonGain, night * night);
        col = mix(col, mix(col, vec3(0.75, 0.82, 0.86) * (1.0 - 0.25 * maria), 0.32), uDusk * (1.0 - uDawn));   // a pale moon at dusk
      }
    }
    // ---------------- the black moon's red corona (a ragged ring of red fire round the disc, screen-pixel sized)
    if (uCorona > 0.001 && cosA > 0.0) {
      vec2 q = uMoonScr.w > 0.5 ? qs : mp / uMoonR;
      vec2 qp = (floor(q * 30.0) + 0.5) / 30.0;
      float r = length(qp);
      float a = atan(qp.y, qp.x);
      float tongue = n1(a * 5.0 + uTime * 0.6) * 0.6 + n1(a * 13.0 - uTime * 1.1) * 0.4;
      float ring = smoothstep(0.98, 1.02, r) * (1.0 - smoothstep(1.04, 1.12 + 0.28 * tongue, r));
      float haze = smoothstep(0.98, 1.0, r) * exp(-(r - 1.0) / 0.35);
      col += (vec3(2.6, 0.32, 0.08) * ring + vec3(0.55, 0.05, 0.02) * haze) * uCorona * (1.0 - uDawn) * (1.0 - uDusk * 0.7) * (1.0 - 0.6 * uRain);
    }
    // ---------------- rain — a low overcast sweeps over the stars and the moon; lightning lights it from inside
    if (uRain > 0.001) {
      vec2 op = d.xz / (max(el, 0.0) + 0.12) * 0.9 + vec2(uTime * 0.03, uTime * 0.012);
      float o = n2(op * 1.1) * 0.65 + n2(op * 2.7 + 3.0) * 0.35;
      float cover = smoothstep(0.75 - 0.65 * uRain, 0.95 - 0.5 * uRain, o) * smoothstep(-0.05, 0.08, el);
      vec3 oc = mix(uFogCol * 0.8, zen * 0.55, smoothstep(0.0, 0.5, el)) * (0.75 + 0.25 * o);
      oc += vec3(0.75, 0.8, 1.0) * uFlash * (0.25 + 0.9 * o);
      col = mix(col, oc, cover * min(1.0, uRain * 1.4));
    }
    col += vec3(0.5, 0.55, 0.7) * uFlash * 0.12 * step(0.0, el);
    // ---------------- the changed world's sky — rolling dark smoke, and a red bloom of torn sky round the portal
    if (uWorld > 0.001 || uPortal > 0.001 || uLamp > 0.001) {
      float angP = acos(clamp(dot(d, uPortalDir), -1.0, 1.0));
      // from the portal beat red light floods the sky — a crimson dome, brightest low on the horizon and
      // toward the portal — and dark smoke rolls across it in patches, so the keep, the pines and the host stand as
      // silhouettes against red (not a flat wash: the smoke and the ridges keep the structure)
      vec3 redSky = mix(vec3(0.3, 0.045, 0.025), vec3(0.05, 0.008, 0.012), smoothstep(-0.02, 0.7, el));
      redSky += vec3(0.45, 0.065, 0.02) * exp(-angP / 0.6);
      // the black moon and its corona stay on top of the red (they were drawn above; keep their disc and ring)
      vec2 qmo = uMoonScr.w > 0.5 ? qs : mp / uMoonR;
      float keepMoon = (1.0 - smoothstep(1.05, 1.45, length(qmo))) * step(0.0, cosA) * uCorona;
      col = mix(col, redSky, uPortal * 0.88 * (1.0 - keepMoon));
      // smoke banks: a noise on the dome itself (works looking up as well as at the horizon), drifting
      vec2 sp2 = vec2(atan(d.z, d.x) * 2.2, d.y * 4.5) + vec2(uTime * 0.015, -uTime * 0.01);
      float sm = n2(sp2 * 1.4) * 0.55 + n2(sp2 * 3.1 + 2.0) * 0.3 + n2(sp2 * 7.0 + 5.0) * 0.15;
      float patchy = smoothstep(0.38, 0.66, sm);
      col = mix(col, vec3(0.018, 0.01, 0.013), max(uWorld, uPortal * 0.8) * 0.8 * patchy * smoothstep(-0.02, 0.08, el) * (1.0 - exp(-angP / 0.22)) * (1.0 - keepMoon));
      col += vec3(0.55, 0.06, 0.02) * exp(-angP / 0.3) * uPortal * 0.6 + vec3(0.14, 0.025, 0.01) * exp(-angP / 0.55) * uPortal * 0.4;
      // the lamp's pillar glows on the sky round it (from the lamp beat, before the portal opens)
      vec3 dB = normalize(uBeaconPos - cameraPosition);
      float angB = acos(clamp(dot(d, dB), -1.0, 1.0));
      col += (vec3(0.5, 0.07, 0.025) * exp(-angB / 0.3) + vec3(0.09, 0.014, 0.008) * exp(-angB / 0.9)) * uLamp * (1.0 - 0.5 * uPortal);
    }
    // ---------------- far mountains (three ridges), drawn over the sky below their crest
    {
      float h3 = 0.015 + 0.21 * ridge(az, 1.7, 2.0) - 0.035;
      float h2 = 0.006 + 0.13 * ridge(az, 2.6, 21.0) - 0.03;
      float h1 = -0.004 + 0.07 * ridge(az, 4.2, 41.0) - 0.02;
      vec3 rimDir = normalize(mix(normalize(vec3(uMoonDir.x, 0.0, uMoonDir.z)), sunH, uDusk));
      float moonSide = 0.5 + 0.5 * dot(normalize(vec3(d.x, 0.0, d.z)), rimDir);
      vec3 dawnTint = mix(vec3(1.0), vec3(1.25, 1.1, 1.05), uDawn);
      // dusk: ridges toward the sun stand dark violet against the glow, the eastern ones catch a little warm haze
      dawnTint *= mix(vec3(1.0), mix(vec3(1.55, 1.4, 1.45), vec3(0.78, 0.72, 0.9), smoothstep(0.3, 0.95, w01)), uDusk);
      if (el < h3) {
        vec3 m = uMFar * dawnTint;
        float snow = smoothstep(h3 - 0.022, h3 - 0.004, el) * smoothstep(0.1, 0.15, h3);
        m = mix(m, m * 1.55 + vec3(0.02, 0.05, 0.06), snow * 0.55);
        m *= 0.92 + 0.22 * moonSide;
        col = mix(col, m, 0.92);
      }
      if (el < h2) { vec3 m = uMMid * dawnTint * (0.9 + 0.25 * moonSide); col = mix(col, m, 0.96); }
      if (el < h1) { vec3 m = uMNear * dawnTint * (0.9 + 0.2 * moonSide); col = m; }
      // haze at the feet of the ridges
      col = mix(col, hor, (1.0 - smoothstep(-0.02, 0.05, el)) * 0.55);
    }
    // ---------------- the dusk sun: a pixel disc (20 px across) low in the west-south-west, behind the ridges' haze
    {
      vec3 sU = normalize(cross(vec3(0.0, 1.0, 0.0), uSunDir)); vec3 sV = cross(uSunDir, sU);
      vec2 sp = vec2(dot(d, sU), dot(d, sV)) / 0.045;
      vec2 spp = (floor(sp * 10.0) + 0.5) / 10.0;
      float disc = step(length(spp), 1.0) * step(0.0, dot(d, uSunDir));
      float hidden = step(el, 0.015 + 0.21 * ridge(az, 1.7, 2.0) - 0.035);          // the far ridge covers it
      col += uKSun * disc * 5.0 * (1.0 - 0.85 * hidden) * uDusk;
    }
    // ---------------- dawn sun
    {
      vec3 sunDir = normalize(vec3(0.97, -0.06 + 0.16 * uDawn, 0.22));
      float sa = acos(clamp(dot(d, sunDir), -1.0, 1.0));
      col += uDSun * (smoothstep(0.045, 0.035, sa) * 6.0 + exp(-sa / 0.18) * 0.6) * uDawn;
    }
    // below the horizon the fog takes over (the far terrain meets it without a seam)
    col = mix(col, hor * 0.92, smoothstep(0.0, -0.08, el));
    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }`;

/** The sky dome. @param {Record<string, { value: any }>} uniforms */
export function envSkyMaterial(uniforms) {
  return new THREE.ShaderMaterial({ uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
}

/** The sky's environment map for Standard materials (PMREM of a scene holding a second sky). */
export function envMapFromScene(renderer, scene) {
  const pm = new THREE.PMREMGenerator(renderer);
  const envMap = pm.fromScene(scene, 0, 0.1, 1000).texture;
  pm.dispose();
  return envMap;
}

// ------------------------------------------------------------------------------------------------ terrain (src/env/terrain.js)
/** The ground's three tiles blended per texel (grass = the material's map, earth, road). @param {THREE.MeshLambertMaterial} m
 *  @param {{ uRoad: { value: THREE.Texture }, uEarth: { value: THREE.Texture } }} U */
export function envPatchTerrain(m, U) {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aMix; varying vec2 vMix; varying vec3 vTW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMix = aMix; vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uRoad; uniform sampler2D uEarth; varying vec2 vMix; varying vec3 vTW;
float ewH(vec2 p){ return fract(sin(dot(p, vec2(41.37, 289.13))) * 15731.743); }`)
      .replace('#include <map_fragment>', `
      vec2 wuv = vTW.xz / 4.0;                       // 64 px per 4 m = 16 texels per metre
      vec2 cell = floor(vTW.xz * 16.0);
      float h = ewH(cell), h2 = ewH(cell + 17.0);
      vec4 tg = texture(map, wuv), te = texture(uEarth, wuv + 0.37), tr = texture(uRoad, wuv);
      float wr = clamp((vMix.x - 0.5) * 2.2 + 0.5, 0.0, 1.0);
      float we = clamp((vMix.y - 0.5) * 2.2 + 0.5, 0.0, 1.0);
      vec4 tc = tg;
      if (h2 < we) tc = te;
      if (h < wr) tc = tr;
      diffuseColor *= tc;
`);
  };
  m.customProgramCacheKey = () => 'ewterrain1';
  return m;
}

// ------------------------------------------------------------------------------------------------ the material family (src/env/materials.js)
/**
 * The lambert family's shading: the pixel bevel, the trough soot, the wall fire, the light tint (src/env/materials.js lambert()).
 * @param {THREE.MeshLambertMaterial} m @param {{ bevel?: boolean, burn?: boolean, wallFire?: boolean, texelsPerM?: number,
 *   lightTint?: { value: THREE.Color } | null, BURN: { uBurn: { value: THREE.Vector3 } }, WALLFIRE: Record<string, { value: number }> }} o
 */
export function envPatchLambert(m, o) {
  const { BURN, WALLFIRE } = o;
  m.defines = m.defines || {};
  if (o.bevel) m.defines.EW_BEVEL = '';
  if (o.burn) m.defines.EW_BURN = '';
  if (o.wallFire) m.defines.EW_WALLFIRE = '';
  const lightTint = o.lightTint || { value: new THREE.Color(1, 1, 1) };
  if (o.lightTint) m.defines.EW_LTINT = '';
  m.defines.EW_TEXEL = (1 / (o.texelsPerM || 16)).toFixed(5);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBurn = BURN.uBurn;
    sh.uniforms.uLightTint = lightTint;
    Object.assign(sh.uniforms, WALLFIRE);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aBlk; attribute float aTag; varying vec4 vBlk; varying float vTag;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlk = aBlk; vTag = aTag;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vBlk; varying float vTag; uniform vec3 uBurn; uniform float uWallFire; uniform float uWallReach; uniform float uWallHeight; uniform vec3 uLightTint;')
      .replace('#include <envmap_fragment>', '#ifdef EW_LTINT\n      outgoingLight *= uLightTint;\n#endif\n#include <envmap_fragment>')
      .replace('#include <tonemapping_fragment>', `
#ifdef EW_WALLFIRE
      {
        // runs after the shared fire light (patchFireLight declares vFireWorldPos/Normal, the map and ewGround)
        vec3 wn = vFireWorldNormal; wn = dot(wn, wn) > 1e-8 ? normalize(wn) : vec3(0.0, 1.0, 0.0);
        float vert = 1.0 - abs(wn.y);
        vec3 q = vFireWorldPos + wn * uWallReach;
        vec2 fuv = (q.xz - uFireLightRect.xy) / uFireLightRect.zw;
        vec2 fe = min(fuv, 1.0 - fuv);
        vec3 FL = texture2D(uFireLightMap, clamp(fuv, 0.0, 1.0)).rgb * smoothstep(0.0, 0.02, min(fe.x, fe.y));
        float above = max(0.0, vFireWorldPos.y - ewGround(vFireWorldPos.xz)) / uWallHeight;
        gl_FragColor.rgb += FL * diffuseColor.rgb * vert * uWallFire * uFireLightGain / (1.0 + above * above);
      }
#endif
#include <tonemapping_fragment>`)
      .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef EW_BEVEL
      if (vBlk.z > 0.0) {
        float px = EW_TEXEL;
        vec2 q = (floor(vBlk.xy / px) + 0.5) * px;
        float bot = q.y, top = vBlk.w - q.y, lef = q.x, rig = vBlk.z - q.x;
        float e = 1.0;
        if (bot < px) e = 0.58; else if (rig < px) e = 0.72; else if (top < px) e = 1.28; else if (lef < px) e = 1.12;
        else if (bot < 2.0 * px) e = 0.84; else if (top < 2.0 * px) e = 1.08;
        diffuseColor.rgb *= e;
      }
#endif
#ifdef EW_BURN
      {
        float tb = vTag < 0.5 ? 0.0 : (vTag < 1.5 ? uBurn.x : (vTag < 2.5 ? uBurn.y : uBurn.z));
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.24, 0.2, 0.19), tb);
      }
#endif
`);
  };
  m.customProgramCacheKey = () => 'ewlambert2';
  return m;
}

const ENVFX_GLSL = /* glsl */`
uniform float uWet; uniform vec3 uWetSky; uniform float uAsh; uniform float uLava; uniform float uFxTime;
float ewFxH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 ewFxH2(vec2 p){ return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
// distance to the nearest cell edge of a jittered grid (lava cracks), in cells
float ewCrack(vec2 p){
  vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)); vec2 o = ewFxH2(i + g) * 0.8 + 0.1;
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return d2 - d1;
}`;
/**
 * Rain sheen and the ending's world change (src/env/materials.js patchEnvFx; chained after the fire light, which declares
 * vFireWorldPos / vFireWorldNormal). @template {THREE.Material} M @param {M} material
 * @param {'ground'|'stone'|'pine'|'tuft'|'wood'} kind @param {Record<string, { value: any }>} ENVFX @returns {M}
 */
export function envPatchFx(material, kind, ENVFX) {
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (sh, r) => {
    prev?.call(material, sh, r);
    Object.assign(sh.uniforms, ENVFX);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + ENVFX_GLSL)
      .replace('#include <tonemapping_fragment>', `
      {
        vec3 fn = vFireWorldNormal; fn = dot(fn, fn) > 1e-8 ? normalize(fn) : vec3(0.0, 1.0, 0.0);
        vec3 V = normalize(cameraPosition - vFireWorldPos);
        float up = smoothstep(0.45, 0.9, fn.y);
        float fr = pow(1.0 - max(dot(fn, V), 0.0), 4.0);
        float wetK = ${kind === 'pine' || kind === 'tuft' ? '0.4' : '1.0'};
        // rain: darker, and a sheen of the sky (plus the fire light on wet ground) on what faces up
        gl_FragColor.rgb *= 1.0 - 0.3 * uWet * wetK;
        vec2 fuv = (vFireWorldPos.xz - uFireLightRect.xy) / uFireLightRect.zw;
        vec3 FLw = texture2D(uFireLightMap, clamp(fuv, 0.0, 1.0)).rgb * step(0.0, min(min(fuv.x, fuv.y), 1.0 - max(fuv.x, fuv.y)));
        gl_FragColor.rgb += uWet * wetK * (0.25 + 0.75 * up) * fr * (uWetSky * 1.6 + FLw * 0.8);
        float lum = dot(gl_FragColor.rgb, vec3(0.3, 0.55, 0.15));
${kind === 'ground' ? `
        // the world change: grass (green-dominant) turns to ash, lava cracks glow open across the slope and the plaza
        float green = smoothstep(0.0, 0.03, gl_FragColor.g - max(gl_FragColor.r, gl_FragColor.b) * 0.92);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(lum) * vec3(0.95, 0.88, 0.85) * 0.7, uAsh * (0.45 + 0.55 * green));
        if (uLava > 0.001 && vFireWorldPos.z > 0.8) {
          vec2 lp = (floor(vFireWorldPos.xz * 8.0) + 0.5) / 8.0;          // 8 texels per metre: chunky pixel cracks
          // a jagged crack field (jittered cells, warped), only along a few rifts (a large noise mask), widening with uLava
          vec2 cp = lp * 0.2 + 3.1;
          cp += vec2(ewFxH(floor(cp * 3.0)), ewFxH(floor(cp * 3.0) + 7.0)) * 0.18 - 0.09;
          float e = ewCrack(cp);
          float rift = smoothstep(0.62, 0.72, fract(sin(dot(floor(lp / 9.0), vec2(12.9, 78.2))) * 437.5) * 0.55 + 0.45 * ewFxH(floor(lp / 23.0)));
          float w = (0.012 + 0.028 * uLava) * (0.5 + 0.8 * ewFxH(floor(cp * 1.7)));
          // a river of cracks runs from the gate down the slope (the host marches along it, black against it)
          float band = (1.0 - smoothstep(1.6, 3.6, abs(vFireWorldPos.x - 2.0 * sin(vFireWorldPos.z * 0.12)))) * step(0.8, vFireWorldPos.z) * (1.0 - smoothstep(30.0, 45.0, vFireWorldPos.z));
          rift = max(rift, band);
          float crack = (1.0 - smoothstep(w * 0.6, w, e)) * rift;
          float hot = (1.0 - smoothstep(0.0, w * 0.45, e)) * rift;
          float pulse = 0.7 + 0.3 * sin(uFxTime * 2.2 + lp.x * 0.7 + lp.y * 0.5);
          float on = smoothstep(0.0, 0.15, uLava) * smoothstep(-2.0, 5.0, vFireWorldPos.z + 6.0 * uLava);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.35, crack * on);
          gl_FragColor.rgb += (vec3(2.4, 0.42, 0.06) * crack + vec3(1.6, 1.0, 0.35) * hot) * pulse * on;
          gl_FragColor.rgb += vec3(0.6, 0.08, 0.02) * (1.0 - smoothstep(0.0, 0.12, e)) * rift * on * 0.3;   // the glow round a crack
        }` : ''}
${kind === 'pine' ? `
        // burnt to black spikes: the needles go to charcoal; ember specks crawl on the trunks and tiers
        vec2 sp = floor(vFireWorldPos.xz * 6.0 + vFireWorldPos.y * 3.0);
        float speck = step(0.965, ewFxH(sp + floor(uFxTime * 1.5)));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.018, 0.014, 0.014) + vec3(0.03, 0.006, 0.004) * (1.0 - fn.y), uAsh);
        gl_FragColor.rgb += vec3(2.2, 0.45, 0.08) * speck * uAsh;` : ''}
${kind === 'tuft' ? `
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(lum) * vec3(0.8, 0.74, 0.72) * 0.55, uAsh);` : ''}
${kind === 'wood' ? `
        gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.55, 0.42, 0.4), uAsh * 0.6);` : ''}
      }
#include <tonemapping_fragment>`);
  };
  material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + '|envfx1' + kind;
  material.needsUpdate = true;
  return material;
}

// ------------------------------------------------------------------------------------------------ rain (src/env/weather.js)
/** Rain streaks (instanced quads wrapped round the camera). @param {Record<string, { value: any }>} uniforms */
export function envRainStreakMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec2 uWind; uniform float uFogDensity;
      attribute vec4 aSeed; varying float vA; varying vec2 vUv;
      void main(){
        float speed = 11.0 + 5.0 * aSeed.w;
        vec3 vel = vec3(uWind.x, -speed, uWind.y);
        vec3 p = aSeed.xyz * uBox + vel * uTime;
        p = mod(p - (uCam - uBox * 0.5), uBox) + (uCam - uBox * 0.5);   // wrap round the camera
        vec3 axis = normalize(vel);
        float len = 0.55 + 0.4 * aSeed.w;
        vec3 toCam = normalize(uCam - p);
        vec3 side = normalize(cross(axis, toCam));
        vec3 w = p - axis * len * position.y + side * position.x * 0.03;
        vec4 mv = viewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = length(mv.xyz);
        vA = exp(-uFogDensity * uFogDensity * d * d * 4.0) * smoothstep(1.2, 4.0, d) * (1.0 - smoothstep(15.0, 22.0, d));
        vUv = uv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uRain; uniform vec3 uTint; uniform float uFlash; varying float vA; varying vec2 vUv;
      void main(){
        float a = vA * (0.24 + 0.24 * uRain) * smoothstep(0.0, 0.3, vUv.y) * (1.0 - abs(vUv.x - 0.5) * 1.2);
        if (a < 0.004) discard;
        gl_FragColor = vec4(uTint * (1.0 + 4.0 * uFlash), a);
      }`,
  });
}
/** Rain splashes (pixel crowns on the ground). @param {Record<string, { value: any }>} uniforms */
export function envRainSplashMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: /* glsl */`
      uniform float uTime; uniform vec3 uCam; attribute vec4 aSeed; varying vec2 vUv; varying float vT; varying float vA;
      ${GROUND_GLSL}
      void main(){
        float period = 0.45 + 0.35 * aSeed.z;
        float k = uTime / period + aSeed.w;
        float cyc = floor(k); vT = fract(k);
        // a new spot each cycle, scattered round the camera (denser near it)
        vec2 r2 = fract(vec2(sin(cyc * 12.9898 + aSeed.x * 78.233), sin(cyc * 39.346 + aSeed.y * 11.135)) * 43758.5453);
        float rad = 1.2 + 16.0 * r2.x * r2.x; float ang = r2.y * 6.2832;
        vec2 xz = uCam.xz + vec2(cos(ang), sin(ang)) * rad;
        float gy = ewGround(xz);
        vec3 w = vec3(xz.x, gy + 0.035, xz.y) + position * (0.22 + 0.18 * aSeed.x);
        vec4 mv = viewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mv;
        vUv = uv; vA = 1.0 - smoothstep(10.0, 18.0, length(mv.xyz));
      }`,
    fragmentShader: /* glsl */`
      uniform float uRain; uniform vec3 uTint; uniform float uFlash; varying vec2 vUv; varying float vT; varying float vA;
      void main(){
        vec2 q = (floor(vUv * 12.0) + 0.5) / 12.0 - 0.5;           // 12 px across: a pixel crown
        float r = length(q) * 2.0;
        float ring = 1.0 - smoothstep(0.0, 0.16, abs(r - (0.25 + 0.7 * vT)));
        float a = ring * (1.0 - vT) * vA * uRain * 0.32;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uTint * 0.9 * (1.0 + 2.0 * uFlash), a);
      }`,
  });
}

// ------------------------------------------------------------------------------------------------ valley fog (src/env/nature.js)
/** The valley fog layers. @param {Record<string, { value: any }>} uniforms uNoise, uTime, uColor, uFogColor, uFogDensity, uAlpha */
export function envValleyFogMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vW; varying float vL;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vL = color.r; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uNoise; uniform float uTime; uniform vec3 uColor; uniform vec3 uFogColor; uniform float uFogDensity; uniform float uAlpha;
      varying vec3 vW; varying float vL;
      ${GROUND_GLSL}
      void main(){
        vec2 p = vW.xz * 0.006 + vec2(uTime * 0.004 * (1.0 + vL), uTime * 0.002);
        float n = texture2D(uNoise, p).r * 0.65 + texture2D(uNoise, p * 2.7 + 0.31).r * 0.35;
        float a = smoothstep(0.32, 0.78, n) * uAlpha * (0.55 + 0.45 * vL);
        // fade the near edge (the plaza end of the valley) and the far end
        a *= smoothstep(30.0, 80.0, vW.z) * (1.0 - smoothstep(420.0, 560.0, vW.z));
        a *= smoothstep(0.0, 3.5, vW.y - ewGround(vW.xz));          // soft where the layer meets the slope
        float d = length(vW - cameraPosition);
        float f = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
        vec3 c = mix(uColor, uFogColor, f * 0.8);
        gl_FragColor = vec4(c, a);
      }`,
    vertexColors: true,
  });
}

// ------------------------------------------------------------------------------------------------ pixel flames (src/env/props.js)
/** The instanced pixel flame billboards. @param {Record<string, { value: any }>} uniforms uMap, uTime, uGain, uDark, uDarkFrom, uDarkTo */
export function envFlameMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      attribute vec4 aFlame; // xyz base, w scale
      attribute float aPhase;
      varying vec2 vUv; varying float vPhase; varying float vBig; varying float vDark;
      uniform float uDark; uniform float uDarkFrom; uniform float uDarkTo;
      void main(){
        vUv = uv; vPhase = aPhase;
        float iid = float(gl_InstanceID);
        vDark = uDark * step(uDarkFrom - 0.5, iid) * step(iid, uDarkTo + 0.5);   // the lamp's flames turn black-red
        vBig = clamp(4.0 / max(aFlame.w, 0.01), 0.5, 1.0);   // big flare flames burn orange, not blown white
        vec4 mv = viewMatrix * vec4(aFlame.xyz, 1.0);
        // screen-plane billboard, upright along world-up as it falls on the screen. (An earlier cylindrical
        // billboard was a vertical plane; seen from below, e.g. from the pan during the kindle glance, its pixel rows
        // converged into big flat wedges radiating from the basket.)
        vec3 wu = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
        vec2 su = dot(wu.xy, wu.xy) > 1e-6 ? normalize(wu.xy) : vec2(0.0, 1.0);
        vec3 up = vec3(su, 0.0);
        vec3 right = vec3(su.y, -su.x, 0.0);
        // a flame never grows past ≈ 0.5 rad on screen when the camera is close (the flare column under the glance)
        float s = min(aFlame.w * 0.62, max(0.9, 0.36 * max(0.5, -mv.z)));
        mv.xyz += right * position.x * s + up * position.y * s;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; uniform float uTime; uniform float uGain;
      varying vec2 vUv; varying float vPhase; varying float vBig; varying float vDark;
      void main(){
        float f = floor(mod(uTime * 11.0 + vPhase * 6.0, 6.0));
        vec4 c = texture2D(uMap, vec2((f + vUv.x) / 6.0, vUv.y));
        if (c.a < 0.5) discard;
        float flick = 0.85 + 0.15 * sin(uTime * 23.0 + vPhase * 40.0);
        vec3 col = c.rgb * uGain * flick * vBig;
        // black core, crimson body: the brighter the ramp pixel, the darker it turns
        float lum = dot(c.rgb, vec3(0.3, 0.55, 0.15));
        col = mix(col, mix(vec3(1.4, 0.06, 0.03), vec3(0.03, 0.0, 0.0), smoothstep(0.45, 0.85, lum)) * flick, vDark);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ------------------------------------------------------------------------------------------------ the burning village's glow (src/env/village.js)
/** @param {Record<string, { value: any }>} uniforms uBurn, uTime */
export function envVillageGlowMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: /* glsl */`
      varying vec2 vQ;
      void main(){
        vQ = position.xy;
        vec4 mv = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mv.xy += position.xy * vec2(34.0, 16.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uBurn; uniform float uTime; varying vec2 vQ;
      void main(){
        float r = length(vQ * vec2(1.0, 1.3));
        if (r > 1.0) discard;
        float g = exp(-r * r * 3.5) * (1.0 - r * r) * (1.0 - r * r);
        float fl = 0.85 + 0.15 * sin(uTime * 7.0) * sin(uTime * 3.1 + 1.0);
        gl_FragColor = vec4(vec3(1.0, 0.3, 0.07) * g * uBurn * 0.9 * fl, 1.0);
      }`,
  });
}

// ------------------------------------------------------------------------------------------------ the camp's build pads (src/env/camp.js)
const PAD_VERT = /* glsl */`
  attribute vec2 aLocal; attribute float aPad;
  varying vec2 vLocal; varying float vPad; varying float vFog;
  uniform float uFogDensity;
  void main(){
    vLocal = aLocal; vPad = aPad;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = length(mv.xyz);
    vFog = exp(-uFogDensity * uFogDensity * d * d);
    gl_Position = projectionMatrix * mv;
  }`;
const PAD_FRAG = /* glsl */`
  uniform vec4 uPad[6];   // x glow 0..1, y near 0..1, z built 0..1, w seed
  uniform float uTime;
  varying vec2 vLocal; varying float vPad; varying float vFog;
  float h11(float n){ return fract(sin(n * 91.345) * 47453.5453); }
  float seg(vec2 p, vec2 a, vec2 b, float w){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return step(length(pa - ba * h), w); }
  void main(){
    int i = int(vPad + 0.5);
    vec4 P = uPad[0];
    for (int k = 1; k < 6; k++) if (k == i) P = uPad[k];
    // pixel grid: 16 texels per metre, like every tile in the world
    vec2 q = (floor(vLocal * 16.0) + 0.5) / 16.0;
    float r = length(q), a = atan(q.y, q.x);
    float px = 1.0 / 16.0;
    // the scorched disc under the circle
    float charA = (1.0 - smoothstep(0.92, 1.25, r)) * 0.42;
    // two rings, runes between them, a sigil inside (an inverted triangle with two horn hooks: the lamp's mark)
    float ring = step(abs(r - 0.93), px * 1.0) + step(abs(r - 0.66), px * 0.6);
    float cells = 12.0;
    float ca = (a + 3.14159265) / 6.2831853 * cells;
    float cell = floor(ca);
    vec2 g = vec2(fract(ca), (r - 0.70) / 0.19);                       // glyph space: u across, v outward
    float glyph = 0.0;
    if (g.y > 0.0 && g.y < 1.0) {
      float hb = h11(cell + P.w * 13.0);
      glyph += step(abs(g.x - 0.5), 0.09);                                       // the stem
      if (hb > 0.25) glyph += step(abs(g.y - (hb > 0.6 ? 0.25 : 0.7)), 0.09) * step(abs(g.x - 0.5), 0.3);
      if (fract(hb * 7.3) > 0.5) glyph += step(abs((g.x - 0.5) - (g.y - 0.5) * 0.6), 0.08) * step(g.y, 0.5);
      if (fract(hb * 3.7) > 0.6) glyph += step(abs(g.y - 0.92), 0.08) * step(abs(g.x - 0.5), 0.22);
      glyph *= step(0.12, g.x) * step(g.x, 0.88);
    }
    float tri = 0.0;
    vec2 t0 = vec2(0.0, -0.5), t1 = vec2(0.43, 0.25), t2 = vec2(-0.43, 0.25);
    tri += seg(q, t0, t1, px * 0.75) + seg(q, t1, t2, px * 0.75) + seg(q, t2, t0, px * 0.75);
    tri += seg(q, t1, vec2(0.52, 0.47), px * 0.75) + seg(q, t2, vec2(-0.52, 0.47), px * 0.75);   // the hooks
    tri += step(abs(length(q - vec2(0.0, 0.0)) - 0.12), px * 0.6);
    float mark = clamp(ring + glyph + tri, 0.0, 1.0) * step(r, 1.0);
    // ember glow: a slow breath per pad, a crawl of brighter cells round the ring; hotter when the player is near
    float breath = 0.82 + 0.18 * sin(uTime * (1.6 + P.y * 2.2) + P.w * 9.0);
    float crawl = 0.75 + 0.25 * step(0.5, fract(ca * 0.5 - uTime * 0.35));
    float lvl = P.x * breath * mix(1.0, crawl, 0.6) * (1.0 + 1.4 * P.y);
    vec3 hot = mix(vec3(0.85, 0.11, 0.03), vec3(1.0, 0.5, 0.14), clamp(lvl * 0.6, 0.0, 1.0));
    vec3 glow = hot * mark * lvl * 2.6;
    // a soft under-glow so the circle reads from the wall walk (and blooms a little)
    glow += vec3(0.9, 0.2, 0.05) * lvl * 0.16 * (1.0 - smoothstep(0.0, 1.15, r)) * (0.6 + 0.4 * P.y);
    gl_FragColor = vec4(glow * vFog, charA * vFog * (1.0 - 0.6 * P.z));
  }`;
/** @param {Record<string, { value: any }>} uniforms uPad (6 × Vector4), uTime, uFogDensity */
export function envPadMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: PAD_VERT, fragmentShader: PAD_FRAG, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

// ------------------------------------------------------------------------------------------------ the horned shadow (src/env/hints.js)
const HORNED_VERT = /* glsl */`
  attribute float aKind;              // 0 wall strip, 1 ground strip
  uniform vec3 uP; uniform vec3 uL; uniform float uWallZ;
  varying vec3 vW; varying float vKind;
  void main(){
    vKind = aKind;
    vec2 c = position.xy;             // corners in [0, 1]^2
    vec3 w;
    if (aKind < 0.5) {
      float t = (uP.z - uWallZ) / max(uL.z, 0.05);
      float xh = uP.x - uL.x * t;     // where the ray through the shoulders meets the wall
      w = vec3(xh + (c.x - 0.5) * 3.6, c.y * 3.4, uWallZ);
    } else {
      vec2 D = normalize(vec2(-uL.x, -uL.z));            // the shadow's direction on the ground
      vec2 S = vec2(D.y, -D.x);
      float len = min(10.5, (uP.z - uWallZ) / max(abs(D.y), 0.05));
      vec2 xz = uP.xz + D * mix(-0.4, len, c.x) + S * (c.y - 0.5) * 2.2;
      w = vec3(xz.x, uP.y + 0.035, xz.y);
    }
    vW = w;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }`;

const HORNED_FRAG = /* glsl */`
  uniform vec3 uP; uniform vec3 uL; uniform float uK; uniform vec3 uTint;
  varying vec3 vW; varying float vKind;
  float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
  // does the ray from p toward the sun hit the SW tower (then the sun never reaches p: no second shadow)
  float towerShade(vec3 p){
    vec3 bmin = vec3(-19.2, 0.0, -3.2), bmax = vec3(-12.8, 10.0, 3.2);
    vec3 inv = 1.0 / uL;
    vec3 t0 = (bmin - p) * inv, t1 = (bmax - p) * inv;
    vec3 lo = min(t0, t1), hi = max(t0, t1);
    float tn = max(max(lo.x, lo.y), lo.z), tf = min(min(hi.x, hi.y), hi.z);
    return step(max(tn, 0.0), tf);
  }
  void main(){
    vec3 Nh = normalize(vec3(uL.x, 0.0, uL.z));
    float s = dot(uP - vW, Nh) / dot(uL, Nh);          // distance along the ray back to the silhouette plane
    if (s < 0.05) discard;
    vec3 Q = vW + uL * s;
    vec3 T = normalize(vec3(Nh.z, 0.0, -Nh.x));
    vec2 q = vec2(abs(dot(Q - uP, T)), Q.y - uP.y);
    // the silhouette: a cloaked body (narrow at the boots, wide at the shoulders), a head, two short curled horns
    float hw = mix(0.16, 0.27, smoothstep(0.1, 1.3, q.y)) - 0.05 * smoothstep(1.3, 1.44, q.y);
    float body = max(q.x - hw, max(-q.y, q.y - 1.44));
    float head = length(q - vec2(0.0, 1.58)) - 0.125;
    float horn = min(sdSeg(q, vec2(0.075, 1.64), vec2(0.17, 1.79)) - 0.038, sdSeg(q, vec2(0.17, 1.79), vec2(0.145, 1.93)) - 0.022);
    float d = min(min(body, head), horn);
    float soft = 0.018 + 0.012 * s;
    float a = 1.0 - smoothstep(-soft, soft, d);
    // where the sun does not reach anyway
    a *= 1.0 - towerShade(vW + uL * 0.05);
    a *= vKind < 0.5 ? 0.85 : 0.75;
    a *= uK;
    if (a < 0.003) discard;
    gl_FragColor = vec4(mix(vec3(1.0), uTint, a), 1.0);
  }`;
/** @param {Record<string, { value: any }>} uniforms uP, uL, uWallZ, uK, uTint */
export function envHornedShadowMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: HORNED_VERT, fragmentShader: HORNED_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

// ------------------------------------------------------------------------------------------------ the ending (src/env/ending.js)
/** The portal torn in the sky. @param {Record<string, { value: any }>} uniforms uTime, uOpen, … */
export function envPortalMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vQ; void main(){ vQ = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position * 1.35, 1.0); }',
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uOpen; varying vec2 vQ;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += n2(p) * a; p = p * 2.03 + 7.1; a *= 0.5; } return s; }
      void main(){
        if (uOpen < 0.002) discard;
        vec2 q = (floor(vQ * 1.35 * 90.0) + 0.5) / 90.0;      // ≈ 240 px across the disc: chunky pixels like the moon
        float r = length(q), a = atan(q.y, q.x);
        float R = 0.12 + 0.88 * uOpen;                          // the tear widens
        float rn = r / R;
        // the vortex: a spiral of fire filaments sucked toward a black-red eye
        float sw = a + 2.6 / (rn + 0.25) - uTime * 0.9;
        float v = fbm(vec2(sw * 1.6, log(rn + 0.05) * 3.0 - uTime * 0.7));
        float fil = smoothstep(0.55, 0.85, v);
        vec3 inner = mix(vec3(0.05, 0.0, 0.0), vec3(0.6, 0.04, 0.01), smoothstep(0.0, 0.9, rn));
        inner += vec3(1.5, 0.32, 0.05) * fil * smoothstep(0.08, 0.6, rn);
        inner += vec3(1.9, 0.75, 0.2) * pow(fil, 3.0) * smoothstep(0.4, 0.95, rn);
        // the ring: ragged tongues of fire licking outward from the torn edge
        float tongues = fbm(vec2(a * 3.0, uTime * 1.3)) * 0.22 + fbm(vec2(a * 9.0, -uTime * 2.1)) * 0.1;
        float edge = 1.0 - smoothstep(0.0, 0.05 + tongues, abs(rn - 1.0) - 0.0);
        float out1 = (1.0 - smoothstep(1.0, 1.0 + tongues * 1.4, rn)) * step(1.0, rn);
        vec3 ring = vec3(1.9, 0.5, 0.08) * edge + vec3(1.2, 0.2, 0.03) * out1;
        float inside = 1.0 - smoothstep(0.97, 1.0, rn);
        vec3 c = inner * inside + ring;
        float a0 = max(inside, max(edge, out1));
        // a dim red bloom of torn sky round it
        float halo = exp(-max(0.0, rn - 1.0) * 2.2) * (1.0 - inside) * 0.35;
        c += vec3(0.5, 0.04, 0.02) * halo;
        a0 = max(a0, halo);
        if (a0 < 0.01) discard;
        gl_FragColor = vec4(c * smoothstep(0.0, 0.15, uOpen), a0 * smoothstep(0.0, 0.1, uOpen));
      }`,
  });
}
/** The lamp's pillar of black-red fire. @param {Record<string, { value: any }>} uniforms uTime, uLamp, … */
export function envPillarMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, fog: false,
    vertexShader: /* glsl */`
      uniform float uLamp; varying vec2 vUv; varying float vH;
      void main(){
        vUv = uv;
        float H = 6.0 + 34.0 * uLamp, W = 1.4 + 3.2 * uLamp;
        vec3 base = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 toCam = cameraPosition - base; toCam.y = 0.0;
        vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), normalize(toCam + vec3(1e-4))));
        vec3 w = base + side * (uv.x - 0.5) * W * (1.0 - 0.45 * uv.y) + vec3(0.0, uv.y * H, 0.0);
        vH = H;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uLamp; varying vec2 vUv; varying float vH;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y); }
      void main(){
        if (uLamp < 0.01) discard;
        vec2 q = (floor(vec2(vUv.x * 24.0, vUv.y * vH * 3.0)) + 0.5) / vec2(24.0, vH * 3.0);
        float x = abs(q.x - 0.5) * 2.0;
        float n = n2(vec2(q.x * 5.0, q.y * vH * 0.6 - uTime * 4.0)) * 0.6 + n2(vec2(q.x * 11.0, q.y * vH * 1.4 - uTime * 7.0)) * 0.4;
        float body = 1.0 - smoothstep(0.35 + 0.5 * n, 0.95, x);
        float top = 1.0 - smoothstep(0.55 + 0.3 * n, 1.0, q.y);
        float a = body * top;
        if (a < 0.05) discard;
        // black core, crimson body, ember-orange edges (the lamp's flame turned black-red)
        float edge = smoothstep(0.2, 0.9, x + 0.25 * n);
        vec3 c = mix(vec3(0.03, 0.0, 0.0), vec3(0.95, 0.05, 0.02), edge);
        c += vec3(1.5, 0.38, 0.06) * smoothstep(0.75, 0.95, x + 0.3 * n) * body;
        gl_FragColor = vec4(c, a * smoothstep(0.0, 0.2, uLamp));
      }`,
  });
}
/** Hellfire inside the open gate. @param {Record<string, { value: any }>} uniforms uTime, uGate */
export function envHellGateMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, transparent: false, fog: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uGate; varying vec2 vUv;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y); }
      void main(){
        vec2 q = (floor(vUv * vec2(40.0, 34.0)) + 0.5) / vec2(40.0, 34.0);       // pixel rows like the flames
        float n = n2(vec2(q.x * 6.0, q.y * 5.0 - uTime * 2.2)) * 0.6 + n2(vec2(q.x * 13.0, q.y * 9.0 - uTime * 3.7)) * 0.4;
        float tongue = smoothstep(0.0, 1.0, 1.0 - q.y + 0.45 * (n - 0.5));
        vec3 c = mix(vec3(0.05, 0.004, 0.003), vec3(1.25, 0.2, 0.04), tongue);
        c += vec3(1.6, 0.55, 0.1) * smoothstep(0.55, 0.95, tongue) * n;
        gl_FragColor = vec4(c * uGate * (0.88 + 0.12 * sin(uTime * 9.0)), 1.0);
      }`,
  });
}
/** Embers falling like snow (Points: draw it with envPoints). @param {Record<string, { value: any }>} uniforms uTime, uWorld, uPx, uCam */
export function envEmberMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: /* glsl */`
      uniform float uTime; uniform float uWorld; uniform float uPx; uniform vec3 uCam; attribute vec4 aSeed; varying float vA; varying float vHot;
      void main(){
        vec3 box = vec3(50.0, 30.0, 50.0);
        vec3 p = aSeed.xyz * box + vec3(sin(uTime * 0.7 + aSeed.w * 30.0) * 1.2, -uTime * (0.8 + 0.9 * aSeed.w), cos(uTime * 0.5 + aSeed.x * 20.0) * 1.0);
        p = mod(p - (uCam - box * 0.5), box) + (uCam - box * 0.5);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        vA = uWorld * smoothstep(0.5, 2.0, d) * (1.0 - smoothstep(18.0, 25.0, length(mv.xyz)));
        vHot = 0.6 + 0.4 * sin(uTime * (3.0 + aSeed.y * 5.0) + aSeed.z * 40.0);
        gl_PointSize = clamp(uPx * 0.06 / max(1.0, d), 1.0, 5.0) * step(0.001, uWorld);
      }`,
    fragmentShader: /* glsl */`
      varying float vA; varying float vHot;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        if (max(abs(q.x), abs(q.y)) > 0.5 || vA < 0.01) discard;
        gl_FragColor = vec4(mix(vec3(1.6, 0.25, 0.05), vec3(2.6, 1.1, 0.3), vHot) * vA, 1.0);
      }`,
  });
}

// ------------------------------------------------------------------------------------------------ the beacon's flare (src/env/beaconfx.js)
/** The warm sky glow round the basket. @param {Record<string, { value: any }>} uniforms uFlare, uTime */
export function envBeaconGlowMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: /* glsl */`
      uniform float uFlare; varying vec2 vQ;
      void main(){
        vQ = position.xy;
        vec4 mv = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float R = 7.0 + 11.0 * uFlare;
        mv.xy += position.xy * R;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uFlare; uniform float uTime; varying vec2 vQ;
      void main(){
        float r = length(vQ);
        if (r > 1.0) discard;
        float g = exp(-r * r * 7.0) * 0.75 + exp(-r * 4.0) * 0.25;
        g *= (1.0 - r * r) * (1.0 - r * r);                          // no visible rim
        float a = 0.07 + 0.55 * uFlare * (0.88 + 0.12 * sin(uTime * 19.0));
        gl_FragColor = vec4(vec3(1.0, 0.36, 0.1) * g * a, 1.0);
      }`,
  });
}
/** The spark fountain (Points: draw it with envPoints). @param {Record<string, { value: any }>} uniforms uFlare, uTime, uPx, uBase */
export function envBeaconSparkMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: /* glsl */`
      uniform float uFlare; uniform float uTime; uniform float uPx; uniform vec3 uBase;
      attribute vec4 aSeed; varying float vA; varying float vHot;
      void main(){
        float life = 1.1 + 1.3 * aSeed.z;
        float t = fract(uTime / life + aSeed.w);
        float on = step(aSeed.x, 0.07 + 0.93 * uFlare);           // idle: a few sparks; flare: all of them
        float ang = aSeed.y * 6.2832;
        float sp = (1.2 + 3.2 * aSeed.x) * (0.6 + 0.8 * uFlare);
        vec3 p = uBase + vec3(cos(ang) * sp * t, (3.0 + 9.0 * aSeed.z) * t - 2.2 * t * t, sin(ang) * sp * t);
        p.x += sin(uTime * 3.0 + aSeed.y * 40.0) * 0.35 * t;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = on * (1.0 - t) * smoothstep(0.0, 0.06, t);
        vHot = 1.0 - t;
        gl_PointSize = clamp(uPx * 0.07 / max(1.0, -mv.z), 1.0, 6.0) * on;
      }`,
    fragmentShader: /* glsl */`
      varying float vA; varying float vHot;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        if (max(abs(q.x), abs(q.y)) > 0.5 || vA < 0.01) discard;      // square pixel sparks
        vec3 c = mix(vec3(0.9, 0.18, 0.05), vec3(1.0, 0.75, 0.3), vHot);
        gl_FragColor = vec4(c * 6.0 * vA, 1.0);
      }`,
  });
}
/** The vision in the flare (the horned file). @param {Record<string, { value: any }>} uniforms uVision, uTime */
export function envBeaconVisionMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, fog: false,
    vertexShader: /* glsl */`
      varying vec2 vQ;
      void main(){
        vQ = position.xy;
        vec4 mv = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mv.xyz += normalize(-mv.xyz) * 1.6;            // in front of the flame billboards and the basket's near bars
        mv.xy += position.xy * vec2(1.7, 1.35);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uVision; uniform float uTime; varying vec2 vQ;
      float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
      float figure(vec2 p, float ph){
        // a hunched horned walker, about 1 unit tall, feet at y 0 (pixel-snapped by the caller)
        float step1 = sin(ph), bob = abs(cos(ph)) * 0.04;
        p.y -= bob;
        float body = length((p - vec2(0.0, 0.55)) * vec2(1.25, 0.8)) - 0.24;
        float head = length(p - vec2(0.08, 0.86)) - 0.11;
        float horns = min(sdSeg(p, vec2(0.03, 0.93), vec2(-0.06, 1.08)) - 0.03, sdSeg(p, vec2(0.14, 0.93), vec2(0.2, 1.08)) - 0.03);
        float legs = min(sdSeg(p, vec2(-0.05, 0.36), vec2(-0.05 + 0.13 * step1, 0.0)) - 0.05, sdSeg(p, vec2(0.06, 0.36), vec2(0.06 - 0.13 * step1, 0.0)) - 0.05);
        float spear = sdSeg(p, vec2(0.2, 0.15), vec2(0.28, 1.2)) - 0.018;
        return min(min(min(body, head), min(horns, legs)), spear);
      }
      void main(){
        if (uVision < 0.01) discard;
        // pixel grid: 40 rows over the quad's height
        vec2 q = (floor((vQ * 0.5 + 0.5) * vec2(64.0, 40.0)) + 0.5) / vec2(64.0, 40.0);
        float fire = 1.0 - smoothstep(0.2, 0.48, length((q - vec2(0.5, 0.42)) * vec2(1.0, 1.35)));   // inside the flame only
        // two files at different depths march left to right
        float d = 1e3;
        for (int row = 0; row < 2; row++) {
          float sc = row == 0 ? 0.46 : 0.3, y0 = row == 0 ? 0.1 : 0.46, sp = row == 0 ? 0.36 : 0.22;
          float x = (q.x * 1.5) / sc - uTime * sp / sc;
          float cell = floor(x / 1.15);
          vec2 p = vec2(mod(x, 1.15) - 0.5, (q.y - y0) / sc);
          d = min(d, figure(p, uTime * 7.0 + cell * 1.7 + float(row)));
        }
        float a = step(d, 0.0) * smoothstep(0.0, 0.35, fire) * uVision * 0.94;
        if (a < 0.01) discard;
        gl_FragColor = vec4(0.03, 0.004, 0.0, a);
      }`,
  });
}

// ------------------------------------------------------------------------------------------------ the far horde (src/env/farhorde.js)
/** Specks and torches in the valley (Points: draw it with envPoints). @param {Record<string, { value: any }>} uniforms uTime, uPx, uFogColor, uFogDensity, uDawn */
export function envFarHordeMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: false, depthWrite: true, fog: false,
    vertexShader: /* glsl */`
      uniform float uTime; uniform float uPx; uniform float uFogDensity;
      attribute vec3 aDir; attribute vec4 aMeta;
      varying float vFog; varying float vTorch; varying float vTint; varying float vFlick;
      void main(){
        float walk = fract(uTime * aMeta.y / 6.0 + aMeta.x);              // 0..1 over a 6 m shuffle
        vec3 p = position + aDir * (walk - 0.5);
        p.y += abs(sin(uTime * 7.0 * aMeta.y + aMeta.x * 30.0)) * 0.12;      // the bob of a marching body
        float fade = smoothstep(0.0, 0.12, walk) * smoothstep(1.0, 0.88, walk);
        vec4 mv = viewMatrix * vec4(p + vec3(0.0, 0.55, 0.0), 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        float f = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
        vTorch = aMeta.z; vTint = aMeta.w;
        vFog = aMeta.z > 0.5 ? f * 0.45 : f * 0.8;
        vFlick = 0.75 + 0.25 * sin(uTime * 13.0 + aMeta.x * 50.0);
        float size = (aMeta.z > 0.5 ? 0.9 : 1.5) * uPx / max(1.0, d) * 0.62;   // a goblin ≈ 1.1 m tall
        gl_PointSize = clamp(size, 1.5, 6.0) * fade;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uFogColor; uniform float uDawn;
      varying float vFog; varying float vTorch; varying float vTint; varying float vFlick;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        vec3 c;
        if (vTorch > 0.5) {
          if (max(abs(q.x), abs(q.y)) > 0.5) discard;
          c = vec3(3.2, 1.25, 0.32) * vFlick * (1.0 - 0.7 * uDawn);
        } else {
          if (abs(q.x) > 0.3 || q.y < -0.5) discard;                    // a narrow upright body
          c = mix(vec3(0.085, 0.08, 0.045), vec3(0.12, 0.05, 0.04), step(0.7, vTint));   // olive grunts, brick-red imps
          c += vec3(0.03, 0.07, 0.08) * step(0.2, -q.y);                // a moonlit head and shoulders
        }
        gl_FragColor = vec4(mix(c, uFogColor, vFog), 1.0);
      }`,
  });
}

/** A point cloud drawn with one of the point materials above (gl_PointSize): a THREE.Points in this edition. */
export function envPoints(geometry, material) { return new THREE.Points(geometry, material); }
