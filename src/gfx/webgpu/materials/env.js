// VALLEYWARD · the WebGPU edition's custom materials for the environment: the TSL twins of src/gfx/webgl2/materials/env.js
// (decision 0001, docs/WEBGPU-PORT.md), same names, same uniform names, same render state. READY = every factory the environment
// uses exists here: it then runs in this edition.
//
// How the twins keep the environment's code shared:
//   - Uniforms. A factory takes the environment's uniform objects ({ value }) and returns a node material whose `.uniforms` are
//     those same objects (as in the GL edition). Each becomes a TSL node once (cached, so uniforms shared between
//     materials stay shared): vectors and colours are held by reference (in-place writes show), numbers are read back
//     from their { value } before every draw (`onObjectUpdate`), textures are sampled directly.
//   - Shader materials become NodeMaterials with a `vertexNode` (clip position) and an `outputNode` (the fragment's
//     colour), like a ShaderMaterial: no lights, no fog (ShaderMaterial's defaults), the GLSL translated line by line.
//   - Points with gl_PointSize (sparks, embers, the far horde): WebGPU draws 1-px points only, so `envPoints` turns the
//     point cloud into instanced quads (one per point, the point attributes per instance, `position` → `aPos`) and the
//     point materials size the quad in pixels (gl_PointCoord → the quad's uv, y down; sizes below 1 px clamp to 1 px as
//     GL clamps gl_PointSize).
//   - Patches on built-in materials set node properties on the same material (WebGPURenderer copies them across when it
//     converts the material): `colorNode` for what GL did at map_fragment (the terrain's tiles, the bevel, the soot), and
//     an own `setupLighting` for what GL did to the outgoing light (the light tint before the fire light, the wall fire,
//     the rain sheen and the world change after it). A built-in material's program cache key does not see node
//     identities, so every patched material gets its own key.
import * as THREE from 'three';
import { NodeMaterial, PMREMGenerator } from 'three/webgpu';
import {
  Fn, If, Discard, select, uniform, uniformArray, texture, attribute, varying, varyingProperty,
  vec2, vec3, vec4, float, int, floor, fract, sin, cos, dot, mix, clamp, min, max, abs, exp, log, pow, length, normalize,
  cross, acos, atan, mod, step, smoothstep,
  positionGeometry, positionWorld, normalWorld, cameraPosition, cameraViewMatrix, cameraProjectionMatrix, modelViewMatrix,
  modelWorldMatrix, instanceIndex, uv, screenCoordinate, screenSize, viewportSize,
  materialColor, materialEmissive, materialReference, diffuseColor,
} from 'three/tsl';
import { FIRELIGHT } from '../../../shared/firelight.js';
import { ewGround } from '../firelight.js';

export const READY = true;

// ------------------------------------------------------------------------------------------------ helpers
const NODES = new WeakMap();
/** The node for one of the environment's uniforms ({ value }; a node passes through). */
function U(o) {
  if (o && o.isNode) return o;
  let n = NODES.get(o);
  if (n) return n;
  const v = o.value;
  if (v && v.isTexture) n = texture(v);
  else if (Array.isArray(v)) n = uniformArray(v, v[0]?.isVector4 ? 'vec4' : v[0]?.isVector3 ? 'vec3' : v[0]?.isVector2 ? 'vec2' : 'float');
  else n = uniform(v).onObjectUpdate(() => o.value);
  NODES.set(o, n);
  return n;
}
/** Every uniform of a module's uniforms object as nodes (same names). */
function nodesOf(uniforms) {
  /** @type {Record<string, any>} */
  const u = {};
  for (const k of Object.keys(uniforms)) u[k] = U(uniforms[k]);
  return u;
}
/**
 * A ShaderMaterial's twin: a NodeMaterial with the same render state, no lights, no fog; `build(u, m)` sets its
 * vertexNode and fragmentNode. The fragment goes in as the material's `outputNode` (the colour it writes), not as
 * `fragmentNode`: r186 builds a fragmentNode material without the MRT path, and a look that renders the scene into a
 * multiple-render-target pass needs it.
 */
function twin(uniforms, state, build) {
  const m = new NodeMaterial();
  m.lights = false; m.fog = false;
  Object.assign(m, state);
  build(nodesOf(uniforms), m);
  if (m.fragmentNode) { m.outputNode = m.fragmentNode; m.fragmentNode = null; }
  /** @type {any} */ (m).uniforms = uniforms;
  return m;
}
/** smoothstep with falling edges (e0 > e1), written out (GLSL's smoothstep(0.17, 0.0, x) and the like). */
const rss = (e0, e1, x) => { const t = clamp(float(x).sub(e0).div(e1 - e0), 0.0, 1.0); return t.mul(t).mul(t.mul(-2.0).add(3.0)); };
const one = (x) => float(1.0).sub(x);

const h21 = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)))
  .setLayout({ name: 'ewH21', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });
const n1 = Fn(([x]) => {
  const i = floor(x), f0 = fract(x);
  const f = f0.mul(f0).mul(f0.mul(-2.0).add(3.0));
  return mix(h21(vec2(i, 7.1)), h21(vec2(i.add(1.0), 7.1)), f);
}).setLayout({ name: 'ewN1', type: 'float', inputs: [{ name: 'x', type: 'float' }] });
const n2 = Fn(([p]) => {
  const i = floor(p).toVar(), f0 = fract(p);
  const f = f0.mul(f0).mul(f0.mul(-2.0).add(3.0)).toVar();
  return mix(mix(h21(i), h21(i.add(vec2(1.0, 0.0))), f.x), mix(h21(i.add(vec2(0.0, 1.0))), h21(i.add(vec2(1.0, 1.0))), f.x), f.y);
}).setLayout({ name: 'ewN2', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });
const fbm = Fn(([p0]) => {
  const s = float(0.0).toVar(), a = float(0.5).toVar(), p = vec2(p0).toVar();
  for (let i = 0; i < 4; i++) { s.addAssign(n2(p).mul(a)); p.assign(p.mul(2.03).add(7.1)); a.mulAssign(0.5); }
  return s;
}).setLayout({ name: 'ewFbm', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });
const sdSeg = Fn(([p, a, b]) => {
  const pa = p.sub(a), ba = b.sub(a);
  const h = clamp(dot(pa, ba).div(dot(ba, ba)), 0.0, 1.0);
  return length(pa.sub(ba.mul(h)));
}).setLayout({ name: 'ewSdSeg', type: 'float', inputs: [{ name: 'p', type: 'vec2' }, { name: 'a', type: 'vec2' }, { name: 'b', type: 'vec2' }] });

/** A point's quad: the clip position moved by the corner (positionGeometry.xy in ±0.5) × the size in pixels. */
const pointQuad = (clip, sizePx) => clip.add(vec4(positionGeometry.xy.mul(max(sizePx, 1.0)).mul(2.0).div(viewportSize).mul(clip.w), 0.0, 0.0));
/** gl_PointCoord on a point's quad (x right, y down). */
const pointCoord = () => vec2(uv().x, one(uv().y));

// ------------------------------------------------------------------------------------------------ the fire light map (FIRELIGHT)
// The wall fire and the wet sheen sample the fire light map their own way; these nodes follow FIRELIGHT like
// src/gfx/webgpu/firelight.js does (the map is re-pointed when the fire host swaps it).
const mapNodes = new Set();
let mapNow = FIRELIGHT.uFireLightMap.value;
function syncMap() { const m = FIRELIGHT.uFireLightMap.value; if (m !== mapNow) { mapNow = m; for (const n of mapNodes) n.value = m; } }
const FL_RECT = uniform(FIRELIGHT.uFireLightRect.value).onObjectUpdate(() => { syncMap(); return FIRELIGHT.uFireLightRect.value; });
const FL_GAIN = U(FIRELIGHT.uFireLightGain);
function fireMap(uvNode) { const t = texture(mapNow, uvNode); mapNodes.add(t); return t; }

// ------------------------------------------------------------------------------------------------ sky (src/env/sky.js)
const ridge = Fn(([az, freq0, seed0]) => {
  const r = float(0.0).toVar(), a = float(0.5).toVar(), freq = float(freq0).toVar(), seed = float(seed0).toVar();
  for (let i = 0; i < 5; i++) {
    const n = n1(az.mul(freq).add(seed)).toVar();
    n.assign(one(abs(n.mul(2.0).sub(1.0))));
    r.addAssign(n.mul(n).mul(a)); a.mulAssign(0.5); freq.mulAssign(2.1); seed.addAssign(13.7);
  }
  return r;
}).setLayout({ name: 'ewRidge', type: 'float', inputs: [{ name: 'az', type: 'float' }, { name: 'freq', type: 'float' }, { name: 'seed', type: 'float' }] });

/** The sky dome. @param {Record<string, { value: any }>} uniforms */
export function envSkyMaterial(uniforms) {
  return twin(uniforms, { side: THREE.BackSide, depthWrite: false, depthTest: false }, (u, m) => {
    const vDir = varying(positionGeometry);
    m.vertexNode = Fn(() => cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(positionGeometry, 1.0)).xyww)();   // on the far plane
    m.fragmentNode = Fn(() => {
      const dawn = u.uDawn, dusk = u.uDusk;
      const d = normalize(vDir).toVar();
      const el = d.y.toVar();
      const az = atan(d.z, d.x).toVar();
      // ---------------- gradient (night → dawn)
      const zen0 = mix(u.uZenith, u.uDZenith, dawn).toVar();
      const zenTop = mix(u.uZenithTop, u.uDZenith.mul(0.8), dawn);
      const eastness = max(0.0, dot(normalize(vec3(d.x, 0.0, d.z)), vec3(1.0, 0.0, 0.0)));
      const hor0 = mix(u.uHorizon, mix(u.uDZenith.mul(1.2), u.uDHorizon, eastness.mul(eastness)), dawn).toVar();
      const col = mix(hor0, zen0, smoothstep(-0.02, 0.42, el)).toVar();
      col.assign(mix(col, zenTop, smoothstep(0.45, 1.0, el)));
      // ---------------- dusk (the camp)
      const sunH = normalize(vec3(u.uSunDir.x, 0.0, u.uSunDir.z)).toVar();
      const w01 = dot(normalize(vec3(d.x, 0.0, d.z).add(vec3(1e-5))), sunH).mul(0.5).add(0.5).toVar();
      const sa = acos(clamp(dot(d, u.uSunDir), -1.0, 1.0)).toVar();
      const kHor = mix(mix(u.uKEast, u.uKWest, smoothstep(0.2, 1.0, w01)), u.uFogCol, 0.25).toVar();
      {
        const k = mix(kHor, u.uKZenith, smoothstep(-0.02, mix(float(0.2), float(0.55), w01.mul(w01)), el)).toVar();
        k.assign(mix(k, u.uKZenith.mul(0.72), smoothstep(0.5, 1.0, el)));
        k.addAssign(u.uKSun.mul(exp(sa.negate().div(0.32)).mul(0.28).add(exp(sa.negate().div(0.08)).mul(0.45))).mul(smoothstep(-0.1, 0.05, el)));
        col.assign(mix(col, k, dusk));
      }
      const hor = mix(hor0, kHor, dusk).toVar();
      const zen = mix(zen0, u.uKZenith, dusk).toVar();
      // ---------------- moon halo + fanned rays (the disc and its halo in screen pixels round the moon's centre; GL's
      // gl_FragCoord has its origin bottom-left, screenCoordinate top-left)
      const cosA = dot(d, u.uMoonDir).toVar();
      const ang = acos(clamp(cosA, -1.0, 1.0)).toVar();
      const fragGL = vec2(screenCoordinate.x, screenSize.y.sub(screenCoordinate.y));
      const qs = fragGL.sub(u.uMoonScr.xy).div(max(1.0, u.uMoonScr.z)).toVar();
      const scrOn = u.uMoonScr.w.greaterThan(0.5);
      const angM = select(scrOn, length(qs).mul(u.uMoonR), ang);
      const night = one(dawn).mul(one(dusk)).toVar();
      col.addAssign(u.uHalo.mul(exp(ang.mul(ang).negate().div(0.42 * 0.42)).mul(0.85).add(exp(angM.negate().div(0.07)).mul(0.9))).mul(night).mul(u.uMoonGain));
      const tU = normalize(cross(vec3(0.0, 1.0, 0.0), u.uMoonDir)).toVar();
      const tV = cross(u.uMoonDir, tU);
      const mp = vec2(dot(d, tU), dot(d, tV)).toVar();
      const rayAng = atan(mp.x, mp.y.negate()).toVar();
      const rays = n1(rayAng.mul(9.0).add(3.0)).mul(n1(rayAng.mul(23.0).add(u.uTime.mul(0.03))));
      const below = smoothstep(0.2, 1.4, mp.y.negate().div(max(0.001, length(mp))));
      col.addAssign(u.uHalo.mul(0.55).mul(rays).mul(below).mul(smoothstep(u.uMoonR.mul(1.1), u.uMoonR.mul(1.6), ang)).mul(exp(ang.negate().div(0.55))).mul(night).mul(u.uMoonGain));
      // ---------------- clouds: thin bands lit from the moon side
      If(el.greaterThan(0.0), () => {
        const cp = d.xz.div(el.add(0.18)).mul(1.6).add(vec2(u.uTime.mul(0.004), 0.0)).toVar();
        const c = n2(cp.mul(1.3)).mul(0.6).add(n2(cp.mul(3.1).add(5.0)).mul(0.4)).toVar();
        c.assign(smoothstep(0.58, 0.82, c).mul(smoothstep(0.02, 0.12, el)).mul(one(smoothstep(0.35, 0.7, el))));
        const cc = mix(zen.mul(0.75), u.uHalo.mul(1.6), exp(ang.negate().div(0.5))).toVar();
        cc.assign(mix(cc, mix(u.uKZenith.mul(0.9), u.uKWest.mul(1.35).add(u.uKSun.mul(0.2)), exp(sa.negate().div(0.7))), dusk));
        col.assign(mix(col, cc, c.mul(mix(float(0.55), float(0.7), dusk))));
        const angPc = acos(clamp(dot(d, u.uPortalDir), -1.0, 1.0));
        col.assign(mix(col, vec3(0.05, 0.032, 0.04), c.mul(u.uWorld).mul(0.7)));
        col.addAssign(vec3(1.6, 0.3, 0.06).mul(c).mul(u.uWorld).mul(exp(angPc.negate().div(0.45))).mul(u.uPortal.mul(0.7).add(0.3)));
      });
      // ---------------- stars
      {
        const sd = d.mul(160.0).toVar();
        const cell = floor(sd);
        const h = h21(cell.xy.add(cell.z.mul(17.31))).toVar();
        const sp = fract(sd).sub(0.5);
        const star = step(0.9965, h).mul(rss(0.17, 0.0, length(sp))).mul(sin(u.uTime.mul(h.mul(4.0).add(1.5)).add(h.mul(40.0))).mul(0.4).add(0.6))
          .mul(smoothstep(0.12, 0.4, el)).mul(smoothstep(0.25, 0.6, ang)).mul(night).mul(one(u.uRain));
        col.addAssign(vec3(0.75, 0.9, 1.0).mul(star).mul(0.8));
      }
      // ---------------- the moon: a pixelated disc with craters
      const q = select(scrOn, qs, mp.div(u.uMoonR)).toVar();
      const qp = floor(q.mul(30.0)).add(0.5).div(30.0).toVar();
      const r = length(qp).toVar();
      If(r.lessThan(1.0).and(cosA.greaterThan(0.0)), () => {
        const cr = n2(qp.mul(3.2).add(4.0)).mul(0.55).add(n2(qp.mul(7.0).add(1.3)).mul(0.3)).add(n2(qp.mul(15.0)).mul(0.15));
        const maria = smoothstep(0.52, 0.62, cr).toVar();
        const limb = one(r.mul(r).mul(0.28));
        const mc = u.uMoon.mul(one(maria.mul(0.32))).mul(limb).toVar();
        mc.assign(mix(mc, mc.mul(vec3(0.82, 0.92, 0.95)), step(0.66, n2(qp.mul(11.0).add(9.0))).mul(0.6)));
        // Night X (and the world change) — a black disc with a faint ember limb
        mc.assign(mix(mc, vec3(0.012, 0.003, 0.002).add(vec3(0.5, 0.05, 0.02).mul(smoothstep(0.82, 1.0, r)).mul(0.5)), u.uCorona));
        col.assign(mix(col, mc.mul(u.uMoonGain), night.mul(night)));
        col.assign(mix(col, mix(col, vec3(0.75, 0.82, 0.86).mul(one(maria.mul(0.25))), 0.32), dusk.mul(one(dawn))));   // a pale moon at dusk
      });
      // ---------------- the black moon's red corona
      If(u.uCorona.greaterThan(0.001).and(cosA.greaterThan(0.0)), () => {
        const a = atan(qp.y, qp.x).toVar();
        const tongue = n1(a.mul(5.0).add(u.uTime.mul(0.6))).mul(0.6).add(n1(a.mul(13.0).sub(u.uTime.mul(1.1))).mul(0.4));
        const ring = smoothstep(0.98, 1.02, r).mul(one(smoothstep(1.04, tongue.mul(0.28).add(1.12), r)));
        const haze = smoothstep(0.98, 1.0, r).mul(exp(r.sub(1.0).negate().div(0.35)));
        col.addAssign(vec3(2.6, 0.32, 0.08).mul(ring).add(vec3(0.55, 0.05, 0.02).mul(haze)).mul(u.uCorona).mul(one(dawn)).mul(one(dusk.mul(0.7))).mul(one(u.uRain.mul(0.6))));
      });
      // ---------------- rain — a low overcast; lightning lights it from inside
      If(u.uRain.greaterThan(0.001), () => {
        const op = d.xz.div(max(el, 0.0).add(0.12)).mul(0.9).add(vec2(u.uTime.mul(0.03), u.uTime.mul(0.012))).toVar();
        const o = n2(op.mul(1.1)).mul(0.65).add(n2(op.mul(2.7).add(3.0)).mul(0.35)).toVar();
        const cover = smoothstep(float(0.75).sub(u.uRain.mul(0.65)), float(0.95).sub(u.uRain.mul(0.5)), o).mul(smoothstep(-0.05, 0.08, el));
        const oc = mix(u.uFogCol.mul(0.8), zen.mul(0.55), smoothstep(0.0, 0.5, el)).mul(o.mul(0.25).add(0.75)).toVar();
        oc.addAssign(vec3(0.75, 0.8, 1.0).mul(u.uFlash).mul(o.mul(0.9).add(0.25)));
        col.assign(mix(col, oc, cover.mul(min(1.0, u.uRain.mul(1.4)))));
      });
      col.addAssign(vec3(0.5, 0.55, 0.7).mul(u.uFlash).mul(0.12).mul(step(0.0, el)));
      // ---------------- the changed world's sky — rolling dark smoke, a red bloom of torn sky round the portal
      If(u.uWorld.greaterThan(0.001).or(u.uPortal.greaterThan(0.001)).or(u.uLamp.greaterThan(0.001)), () => {
        const angP = acos(clamp(dot(d, u.uPortalDir), -1.0, 1.0)).toVar();
        const redSky = mix(vec3(0.3, 0.045, 0.025), vec3(0.05, 0.008, 0.012), smoothstep(-0.02, 0.7, el)).add(vec3(0.45, 0.065, 0.02).mul(exp(angP.negate().div(0.6))));
        const keepMoon = one(smoothstep(1.05, 1.45, length(q))).mul(step(0.0, cosA)).mul(u.uCorona).toVar();
        col.assign(mix(col, redSky, u.uPortal.mul(0.88).mul(one(keepMoon))));
        const sp2 = vec2(atan(d.z, d.x).mul(2.2), d.y.mul(4.5)).add(vec2(u.uTime.mul(0.015), u.uTime.mul(-0.01))).toVar();
        const sm = n2(sp2.mul(1.4)).mul(0.55).add(n2(sp2.mul(3.1).add(2.0)).mul(0.3)).add(n2(sp2.mul(7.0).add(5.0)).mul(0.15));
        const patchy = smoothstep(0.38, 0.66, sm);
        col.assign(mix(col, vec3(0.018, 0.01, 0.013), max(u.uWorld, u.uPortal.mul(0.8)).mul(0.8).mul(patchy).mul(smoothstep(-0.02, 0.08, el))
          .mul(one(exp(angP.negate().div(0.22)))).mul(one(keepMoon))));
        col.addAssign(vec3(0.55, 0.06, 0.02).mul(exp(angP.negate().div(0.3))).mul(u.uPortal).mul(0.6).add(vec3(0.14, 0.025, 0.01).mul(exp(angP.negate().div(0.55))).mul(u.uPortal).mul(0.4)));
        // the lamp's pillar glows on the sky round it
        const dB = normalize(u.uBeaconPos.sub(cameraPosition));
        const angB = acos(clamp(dot(d, dB), -1.0, 1.0)).toVar();
        col.addAssign(vec3(0.5, 0.07, 0.025).mul(exp(angB.negate().div(0.3))).add(vec3(0.09, 0.014, 0.008).mul(exp(angB.negate().div(0.9)))).mul(u.uLamp).mul(one(u.uPortal.mul(0.5))));
      });
      // ---------------- far mountains (three ridges), drawn over the sky below their crest
      const h3 = float(0.015).add(ridge(az, 1.7, 2.0).mul(0.21)).sub(0.035).toVar();
      {
        const h2 = float(0.006).add(ridge(az, 2.6, 21.0).mul(0.13)).sub(0.03).toVar();
        const h1 = float(-0.004).add(ridge(az, 4.2, 41.0).mul(0.07)).sub(0.02).toVar();
        const rimDir = normalize(mix(normalize(vec3(u.uMoonDir.x, 0.0, u.uMoonDir.z)), sunH, dusk));
        const moonSide = dot(normalize(vec3(d.x, 0.0, d.z)), rimDir).mul(0.5).add(0.5).toVar();
        const dawnTint = mix(vec3(1.0), vec3(1.25, 1.1, 1.05), dawn)
          .mul(mix(vec3(1.0), mix(vec3(1.55, 1.4, 1.45), vec3(0.78, 0.72, 0.9), smoothstep(0.3, 0.95, w01)), dusk)).toVar();
        If(el.lessThan(h3), () => {
          const mm = u.uMFar.mul(dawnTint).toVar();
          const snow = smoothstep(h3.sub(0.022), h3.sub(0.004), el).mul(smoothstep(0.1, 0.15, h3));
          mm.assign(mix(mm, mm.mul(1.55).add(vec3(0.02, 0.05, 0.06)), snow.mul(0.55)));
          mm.mulAssign(moonSide.mul(0.22).add(0.92));
          col.assign(mix(col, mm, 0.92));
        });
        If(el.lessThan(h2), () => { col.assign(mix(col, u.uMMid.mul(dawnTint).mul(moonSide.mul(0.25).add(0.9)), 0.96)); });
        If(el.lessThan(h1), () => { col.assign(u.uMNear.mul(dawnTint).mul(moonSide.mul(0.2).add(0.9))); });
        col.assign(mix(col, hor, one(smoothstep(-0.02, 0.05, el)).mul(0.55)));   // haze at the feet of the ridges
      }
      // ---------------- the dusk sun: a pixel disc low in the west-south-west, behind the ridges' haze
      {
        const sU = normalize(cross(vec3(0.0, 1.0, 0.0), u.uSunDir)).toVar();
        const sV = cross(u.uSunDir, sU);
        const sp = vec2(dot(d, sU), dot(d, sV)).div(0.045);
        const spp = floor(sp.mul(10.0)).add(0.5).div(10.0);
        const disc = step(length(spp), 1.0).mul(step(0.0, dot(d, u.uSunDir)));
        const hidden = step(el, h3);                                                   // the far ridge covers it
        col.addAssign(u.uKSun.mul(disc).mul(5.0).mul(one(hidden.mul(0.85))).mul(dusk));
      }
      // ---------------- dawn sun
      {
        const sunDir = normalize(vec3(0.97, float(-0.06).add(dawn.mul(0.16)), 0.22));
        const sa2 = acos(clamp(dot(d, sunDir), -1.0, 1.0)).toVar();
        col.addAssign(u.uDSun.mul(rss(0.045, 0.035, sa2).mul(6.0).add(exp(sa2.negate().div(0.18)).mul(0.6))).mul(dawn));
      }
      // below the horizon the fog takes over
      col.assign(mix(col, hor.mul(0.92), rss(0.0, -0.08, el)));
      return vec4(max(col, 0.0), 1.0);
    })();
  });
}

/** The sky's environment map for Standard materials (PMREM of a scene holding a second sky): WebGPU's PMREMGenerator. */
export function envMapFromScene(renderer, scene) {
  const pm = new PMREMGenerator(renderer);
  const envMap = pm.fromScene(scene, 0, 0.1, 1000).texture;
  pm.dispose();
  return envMap;
}

// ------------------------------------------------------------------------------------------------ terrain (src/env/terrain.js)
const ewH = Fn(([p]) => fract(sin(dot(p, vec2(41.37, 289.13))).mul(15731.743)))
  .setLayout({ name: 'ewTerrainH', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });
/** The ground's three tiles blended per texel with a hashed dither (grass = the material's map, earth, road). */
export function envPatchTerrain(m, Uo) {
  const grass = m.map, earth = Uo.uEarth.value, road = Uo.uRoad.value;
  m.colorNode = Fn(() => {
    const tw = positionWorld;
    const wuv = tw.xz.div(4.0).toVar();                       // 64 px per 4 m = 16 texels per metre
    const cell = floor(tw.xz.mul(16.0)).toVar();
    const h = ewH(cell), h2 = ewH(cell.add(17.0));
    // all three tiles are sampled (outside any branch, as in GL), then one is picked
    const tg = texture(grass, wuv), te = texture(earth, wuv.add(0.37)), tr = texture(road, wuv);
    const mx = attribute('aMix', 'vec2');
    const wr = clamp(mx.x.sub(0.5).mul(2.2).add(0.5), 0.0, 1.0);
    const we = clamp(mx.y.sub(0.5).mul(2.2).add(0.5), 0.0, 1.0);
    const tc = select(h.lessThan(wr), tr, select(h2.lessThan(we), te, tg));
    return vec4(materialReference('color', 'color'), 1.0).mul(tc);
  })();
  m.customProgramCacheKey = () => `ewterrain:${m.uuid}`;
  m.needsUpdate = true;
  return m;
}

// ------------------------------------------------------------------------------------------------ the material family (src/env/materials.js)
/**
 * The post-lighting chain of a patched lambert (GL: the light tint before the fire light, then the wall fire and the env
 * fx on gl_FragColor before tone mapping). One own `setupLighting` per material runs the steps in patch order.
 */
function post(m) {
  /** @type {{ tint: any, steps: ((c: any) => any)[] }} */
  let P = m.userData.__ewPost;
  if (P) return P;
  P = m.userData.__ewPost = { tint: null, steps: [] };
  // `this` is the node material WebGPURenderer converted `m` into (a copy of m's own properties, this one included)
  m.setupLighting = function (builder) {
    const base = Object.getPrototypeOf(this).setupLighting;
    let col;
    if (P.tint) {
      // the tint is on the moon / sky / brazier light only: the lighting plus the material's own emissive, without the
      // fire light that the fire-light patch put into emissiveNode (it is added back untinted)
      const em = this.emissiveNode;
      this.emissiveNode = null;
      col = base.call(this, builder).mul(P.tint);
      this.emissiveNode = em;
      if (em) col = col.add(vec3(em).sub(materialEmissive));
    } else col = base.call(this, builder);
    for (const s of P.steps) col = s(col);
    return col;
  };
  m.customProgramCacheKey = () => `ewlambert:${m.uuid}`;
  m.needsUpdate = true;
  return P;
}
/** Extra fire light on vertical stone (the light map further out along the normal). */
function wallFireStep(W) {
  const wf = U(W.uWallFire), reach = U(W.uWallReach), height = U(W.uWallHeight);
  return Fn(([col]) => {
    const wn = normalize(normalWorld).toVar();
    const P = positionWorld.toVar();
    const vert = one(abs(wn.y));
    const q = P.add(wn.mul(reach));
    const fuv = q.xz.sub(FL_RECT.xy).div(FL_RECT.zw).toVar();
    const fe = min(fuv, vec2(1.0).sub(fuv));
    const FL = fireMap(clamp(fuv, 0.0, 1.0)).rgb.mul(smoothstep(0.0, 0.02, min(fe.x, fe.y)));
    const above = max(0.0, P.y.sub(ewGround(P.xz))).div(height).toVar();
    return col.add(FL.mul(diffuseColor.rgb).mul(vert).mul(wf).mul(FL_GAIN).div(above.mul(above).add(1.0)));
  });
}
/**
 * The lambert family's shading: the pixel bevel and the trough soot (on the albedo), the light tint and the wall fire
 * (on the outgoing light). @param {THREE.MeshLambertMaterial} m
 */
export function envPatchLambert(m, o) {
  const texel = Number((1 / (o.texelsPerM || 16)).toFixed(5));   // GL's EW_TEXEL define
  if (o.bevel || o.burn) {
    const burn = U(o.BURN.uBurn);
    m.colorNode = Fn(() => {
      const c = vec4(materialColor).toVar();
      if (o.bevel) {
        const blk = attribute('aBlk', 'vec4');
        If(blk.z.greaterThan(0.0), () => {
          const px = float(texel);
          const q = floor(blk.xy.div(px)).add(0.5).mul(px).toVar();
          const bot = q.y, top = blk.w.sub(q.y), lef = q.x, rig = blk.z.sub(q.x);
          const e = float(1.0).toVar();
          If(bot.lessThan(px), () => { e.assign(0.58); }).ElseIf(rig.lessThan(px), () => { e.assign(0.72); })
            .ElseIf(top.lessThan(px), () => { e.assign(1.28); }).ElseIf(lef.lessThan(px), () => { e.assign(1.12); })
            .ElseIf(bot.lessThan(px.mul(2.0)), () => { e.assign(0.84); }).ElseIf(top.lessThan(px.mul(2.0)), () => { e.assign(1.08); });
          c.assign(vec4(c.rgb.mul(e), c.a));
        });
      }
      if (o.burn) {
        const tag = attribute('aTag', 'float');
        const tb = select(tag.lessThan(0.5), float(0.0), select(tag.lessThan(1.5), burn.x, select(tag.lessThan(2.5), burn.y, burn.z)));
        c.assign(vec4(c.rgb.mul(mix(vec3(1.0), vec3(0.24, 0.2, 0.19), tb)), c.a));
      }
      return c;
    })();
    m.customProgramCacheKey = () => `ewlambert:${m.uuid}`;
  }
  if (o.lightTint || o.wallFire) {
    const P = post(m);
    if (o.lightTint) P.tint = U(o.lightTint);
    if (o.wallFire) P.steps.push(wallFireStep(o.WALLFIRE));
  }
  m.needsUpdate = true;
  return m;
}

const ewFxH2 = Fn(([p]) => fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))).mul(43758.5453)))
  .setLayout({ name: 'ewFxH2', type: 'vec2', inputs: [{ name: 'p', type: 'vec2' }] });
/** Distance to the nearest cell edge of a jittered grid (lava cracks), in cells. */
const ewCrack = Fn(([p]) => {
  const i = floor(p).toVar(), f = fract(p).toVar();
  const d1 = float(8.0).toVar(), d2 = float(8.0).toVar();
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    const g = vec2(x, y);
    const o = ewFxH2(i.add(g)).mul(0.8).add(0.1);
    const d = length(g.add(o).sub(f)).toVar();
    If(d.lessThan(d1), () => { d2.assign(d1); d1.assign(d); }).ElseIf(d.lessThan(d2), () => { d2.assign(d); });
  }
  return d2.sub(d1);
}).setLayout({ name: 'ewCrack', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

function envFxStep(kind, E) {
  const wet = U(E.uWet), wetSky = U(E.uWetSky), ash = U(E.uAsh), lava = U(E.uLava), t = U(E.uFxTime);
  const wetK = kind === 'pine' || kind === 'tuft' ? 0.4 : 1.0;
  return Fn(([col0]) => {
    const col = vec3(col0).toVar();
    const fn = normalize(normalWorld).toVar();
    const P = positionWorld.toVar();
    const V = normalize(cameraPosition.sub(P));
    const up = smoothstep(0.45, 0.9, fn.y);
    const fr = pow(one(max(dot(fn, V), 0.0)), 4.0);
    // rain: darker, and a sheen of the sky (plus the fire light on wet ground) on what faces up
    col.mulAssign(one(wet.mul(0.3).mul(wetK)));
    const fuv = P.xz.sub(FL_RECT.xy).div(FL_RECT.zw).toVar();
    const FLw = fireMap(clamp(fuv, 0.0, 1.0)).rgb.mul(step(0.0, min(min(fuv.x, fuv.y), one(max(fuv.x, fuv.y)))));
    col.addAssign(wet.mul(wetK).mul(up.mul(0.75).add(0.25)).mul(fr).mul(wetSky.mul(1.6).add(FLw.mul(0.8))));
    const lum = dot(col, vec3(0.3, 0.55, 0.15)).toVar();
    if (kind === 'ground') {
      // the world change: grass (green-dominant) turns to ash, lava cracks glow open across the slope and the plaza
      const green = smoothstep(0.0, 0.03, col.g.sub(max(col.r, col.b).mul(0.92)));
      col.assign(mix(col, vec3(lum).mul(vec3(0.95, 0.88, 0.85)).mul(0.7), ash.mul(green.mul(0.55).add(0.45))));
      If(lava.greaterThan(0.001).and(P.z.greaterThan(0.8)), () => {
        const lp = floor(P.xz.mul(8.0)).add(0.5).div(8.0).toVar();          // 8 texels per metre: chunky pixel cracks
        const cp = lp.mul(0.2).add(3.1).toVar();
        cp.addAssign(vec2(h21(floor(cp.mul(3.0))), h21(floor(cp.mul(3.0)).add(7.0))).mul(0.18).sub(0.09));
        const e = ewCrack(cp).toVar();
        const rift = smoothstep(0.62, 0.72, fract(sin(dot(floor(lp.div(9.0)), vec2(12.9, 78.2))).mul(437.5)).mul(0.55).add(h21(floor(lp.div(23.0))).mul(0.45))).toVar();
        const w = lava.mul(0.028).add(0.012).mul(h21(floor(cp.mul(1.7))).mul(0.8).add(0.5)).toVar();
        // a river of cracks runs from the gate down the slope
        const band = one(smoothstep(1.6, 3.6, abs(P.x.sub(sin(P.z.mul(0.12)).mul(2.0))))).mul(step(0.8, P.z)).mul(one(smoothstep(30.0, 45.0, P.z)));
        rift.assign(max(rift, band));
        const crack = one(smoothstep(w.mul(0.6), w, e)).mul(rift).toVar();
        const hot = one(smoothstep(0.0, w.mul(0.45), e)).mul(rift);
        const pulse = sin(t.mul(2.2).add(lp.x.mul(0.7)).add(lp.y.mul(0.5))).mul(0.3).add(0.7);
        const on = smoothstep(0.0, 0.15, lava).mul(smoothstep(-2.0, 5.0, P.z.add(lava.mul(6.0)))).toVar();
        col.assign(mix(col, col.mul(0.35), crack.mul(on)));
        col.addAssign(vec3(2.4, 0.42, 0.06).mul(crack).add(vec3(1.6, 1.0, 0.35).mul(hot)).mul(pulse).mul(on));
        col.addAssign(vec3(0.6, 0.08, 0.02).mul(one(smoothstep(0.0, 0.12, e))).mul(rift).mul(on).mul(0.3));   // the glow round a crack
      });
    }
    if (kind === 'pine') {
      // burnt to black spikes: the needles go to charcoal; ember specks crawl on the trunks and tiers
      const sp = floor(P.xz.mul(6.0).add(P.y.mul(3.0)));
      const speck = step(0.965, h21(sp.add(floor(t.mul(1.5)))));
      col.assign(mix(col, vec3(0.018, 0.014, 0.014).add(vec3(0.03, 0.006, 0.004).mul(one(fn.y))), ash));
      col.addAssign(vec3(2.2, 0.45, 0.08).mul(speck).mul(ash));
    }
    if (kind === 'tuft') col.assign(mix(col, vec3(lum).mul(vec3(0.8, 0.74, 0.72)).mul(0.55), ash));
    if (kind === 'wood') col.assign(mix(col, col.mul(vec3(0.55, 0.42, 0.4)), ash.mul(0.6)));
    return col;
  });
}
/** Rain sheen and the ending's world change on an env material (after the fire light). */
export function envPatchFx(material, kind, ENVFX) {
  post(material).steps.push(envFxStep(kind, ENVFX));
  material.needsUpdate = true;
  return material;
}

// ------------------------------------------------------------------------------------------------ rain (src/env/weather.js)
/** Rain streaks (instanced quads wrapped round the camera). */
export function envRainStreakMaterial(uniforms) {
  return twin(uniforms, { transparent: true, depthWrite: false, side: THREE.DoubleSide }, (u, m) => {
    const vA = varyingProperty('float', 'vRainA');
    m.vertexNode = Fn(() => {
      const seed = attribute('aSeed', 'vec4');
      const speed = seed.w.mul(5.0).add(11.0);
      const vel = vec3(u.uWind.x, speed.negate(), u.uWind.y).toVar();
      const half = u.uCam.sub(u.uBox.mul(0.5)).toVar();
      const p = seed.xyz.mul(u.uBox).add(vel.mul(u.uTime)).toVar();
      p.assign(mod(p.sub(half), u.uBox).add(half));                              // wrap round the camera
      const axis = normalize(vel).toVar();
      const len = seed.w.mul(0.4).add(0.55);
      const toCam = normalize(u.uCam.sub(p));
      const side = normalize(cross(axis, toCam));
      const w = p.sub(axis.mul(len).mul(positionGeometry.y)).add(side.mul(positionGeometry.x).mul(0.03));
      const mv = cameraViewMatrix.mul(vec4(w, 1.0)).toVar();
      const d = length(mv.xyz).toVar();
      vA.assign(exp(u.uFogDensity.mul(u.uFogDensity).mul(d).mul(d).mul(4.0).negate()).mul(smoothstep(1.2, 4.0, d)).mul(one(smoothstep(15.0, 22.0, d))));
      return cameraProjectionMatrix.mul(mv);
    })();
    m.fragmentNode = Fn(() => {
      const vUv = uv();
      const a = vA.mul(u.uRain.mul(0.24).add(0.24)).mul(smoothstep(0.0, 0.3, vUv.y)).mul(one(abs(vUv.x.sub(0.5)).mul(1.2))).toVar();
      If(a.lessThan(0.004), () => { Discard(); });
      return vec4(u.uTint.mul(u.uFlash.mul(4.0).add(1.0)), a);
    })();
  });
}
/** Rain splashes (pixel crowns on the ground). */
export function envRainSplashMaterial(uniforms) {
  return twin(uniforms, { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, (u, m) => {
    const vT = varyingProperty('float', 'vSplashT'), vA = varyingProperty('float', 'vSplashA');
    m.vertexNode = Fn(() => {
      const seed = attribute('aSeed', 'vec4');
      const period = seed.z.mul(0.35).add(0.45);
      const k = u.uTime.div(period).add(seed.w).toVar();
      const cyc = floor(k).toVar();
      vT.assign(fract(k));
      // a new spot each cycle, scattered round the camera (denser near it)
      const r2 = fract(vec2(sin(cyc.mul(12.9898).add(seed.x.mul(78.233))), sin(cyc.mul(39.346).add(seed.y.mul(11.135)))).mul(43758.5453)).toVar();
      const rad = float(1.2).add(r2.x.mul(16.0).mul(r2.x));
      const ang = r2.y.mul(6.2832).toVar();
      const xz = u.uCam.xz.add(vec2(cos(ang), sin(ang)).mul(rad)).toVar();
      const gy = ewGround(xz);
      const w = vec3(xz.x, gy.add(0.035), xz.y).add(positionGeometry.mul(seed.x.mul(0.18).add(0.22)));
      const mv = cameraViewMatrix.mul(vec4(w, 1.0)).toVar();
      vA.assign(one(smoothstep(10.0, 18.0, length(mv.xyz))));
      return cameraProjectionMatrix.mul(mv);
    })();
    m.fragmentNode = Fn(() => {
      const q = floor(uv().mul(12.0)).add(0.5).div(12.0).sub(0.5);               // 12 px across: a pixel crown
      const r = length(q).mul(2.0);
      const ring = one(smoothstep(0.0, 0.16, abs(r.sub(vT.mul(0.7).add(0.25)))));
      const a = ring.mul(one(vT)).mul(vA).mul(u.uRain).mul(0.32).toVar();
      If(a.lessThan(0.01), () => { Discard(); });
      return vec4(u.uTint.mul(0.9).mul(u.uFlash.mul(2.0).add(1.0)), a);
    })();
  });
}

// ------------------------------------------------------------------------------------------------ valley fog (src/env/nature.js)
/** The valley fog layers: drifting noise, manual exp² fog. */
export function envValleyFogMaterial(uniforms) {
  return twin(uniforms, { transparent: true, depthWrite: false, vertexColors: true }, (u, m) => {
    const vW = varyingProperty('vec3', 'vFogW'), vL = varyingProperty('float', 'vFogL');
    m.vertexNode = Fn(() => {
      const w = modelWorldMatrix.mul(vec4(positionGeometry, 1.0)).toVar();
      vW.assign(w.xyz); vL.assign(attribute('color', 'vec3').x);
      return cameraProjectionMatrix.mul(cameraViewMatrix).mul(w);
    })();
    const noise = uniforms.uNoise.value;
    m.fragmentNode = Fn(() => {
      const p = vW.xz.mul(0.006).add(vec2(u.uTime.mul(0.004).mul(vL.add(1.0)), u.uTime.mul(0.002))).toVar();
      const n = texture(noise, p).r.mul(0.65).add(texture(noise, p.mul(2.7).add(0.31)).r.mul(0.35));
      const a = smoothstep(0.32, 0.78, n).mul(u.uAlpha).mul(vL.mul(0.45).add(0.55)).toVar();
      // fade the near edge (the plaza end of the valley) and the far end
      a.mulAssign(smoothstep(30.0, 80.0, vW.z).mul(one(smoothstep(420.0, 560.0, vW.z))));
      a.mulAssign(smoothstep(0.0, 3.5, vW.y.sub(ewGround(vW.xz))));               // soft where the layer meets the slope
      const d = length(vW.sub(cameraPosition)).toVar();
      const f = one(exp(u.uFogDensity.mul(u.uFogDensity).mul(d).mul(d).negate()));
      return vec4(mix(u.uColor, u.uFogColor, f.mul(0.8)), a);
    })();
  });
}

// ------------------------------------------------------------------------------------------------ pixel flames (src/env/props.js)
/** The instanced pixel flame billboards (screen-plane, upright along world-up as it falls on the screen). */
export function envFlameMaterial(uniforms) {
  return twin(uniforms, {}, (u, m) => {
    const vPhase = varyingProperty('float', 'vFlPhase'), vBig = varyingProperty('float', 'vFlBig'), vDark = varyingProperty('float', 'vFlDark');
    m.vertexNode = Fn(() => {
      const fl = attribute('aFlame', 'vec4');                                       // xyz base, w scale
      vPhase.assign(attribute('aPhase', 'float'));
      const iid = float(instanceIndex);
      vDark.assign(u.uDark.mul(step(u.uDarkFrom.sub(0.5), iid)).mul(step(iid, u.uDarkTo.add(0.5))));   // the lamp's flames turn black-red
      vBig.assign(clamp(float(4.0).div(max(fl.w, 0.01)), 0.5, 1.0));               // big flare flames burn orange, not blown white
      const mv = cameraViewMatrix.mul(vec4(fl.xyz, 1.0)).toVar();
      const wu = cameraViewMatrix.mul(vec4(0.0, 1.0, 0.0, 0.0)).xyz.toVar();
      const su = select(dot(wu.xy, wu.xy).greaterThan(1e-6), normalize(wu.xy), vec2(0.0, 1.0)).toVar();
      const up = vec3(su, 0.0), right = vec3(su.y, su.x.negate(), 0.0);
      // a flame never grows past ≈ 0.5 rad on screen when the camera is close
      const s = min(fl.w.mul(0.62), max(0.9, max(0.5, mv.z.negate()).mul(0.36))).toVar();
      mv.assign(vec4(mv.xyz.add(right.mul(positionGeometry.x).mul(s)).add(up.mul(positionGeometry.y).mul(s)), mv.w));
      return cameraProjectionMatrix.mul(mv);
    })();
    const map = uniforms.uMap.value;
    m.fragmentNode = Fn(() => {
      const vUv = uv();
      const f = floor(mod(u.uTime.mul(11.0).add(vPhase.mul(6.0)), 6.0));
      const c = texture(map, vec2(f.add(vUv.x).div(6.0), vUv.y)).toVar();
      If(c.a.lessThan(0.5), () => { Discard(); });
      const flick = sin(u.uTime.mul(23.0).add(vPhase.mul(40.0))).mul(0.15).add(0.85).toVar();
      const col = c.rgb.mul(u.uGain).mul(flick).mul(vBig).toVar();
      // black core, crimson body: the brighter the ramp pixel, the darker it turns
      const lum = dot(c.rgb, vec3(0.3, 0.55, 0.15));
      col.assign(mix(col, mix(vec3(1.4, 0.06, 0.03), vec3(0.03, 0.0, 0.0), smoothstep(0.45, 0.85, lum)).mul(flick), vDark));
      return vec4(col, 1.0);
    })();
  });
}

// ------------------------------------------------------------------------------------------------ camera-facing glows
/** A quad of `scale` (vec2 or float node) centred on the object's origin, in the view plane; vQ = the corner in ±1. */
function viewQuad(m, scale, vQ, push = null) {
  m.vertexNode = Fn(() => {
    vQ.assign(positionGeometry.xy);
    const mv = modelViewMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0)).toVar();
    if (push) mv.assign(vec4(mv.xyz.add(normalize(mv.xyz.negate()).mul(push)), mv.w));
    mv.assign(vec4(mv.xy.add(positionGeometry.xy.mul(scale())), mv.zw));
    return cameraProjectionMatrix.mul(mv);
  })();
}
/** The wide fire glow over the burning village (src/env/village.js). */
export function envVillageGlowMaterial(uniforms) {
  return twin(uniforms, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }, (u, m) => {
    const vQ = varyingProperty('vec2', 'vVgQ');
    viewQuad(m, () => vec2(34.0, 16.0), vQ);
    m.fragmentNode = Fn(() => {
      const r = length(vQ.mul(vec2(1.0, 1.3))).toVar();
      If(r.greaterThan(1.0), () => { Discard(); });
      const r2 = r.mul(r);
      const g = exp(r2.negate().mul(3.5)).mul(one(r2)).mul(one(r2));
      const fl = sin(u.uTime.mul(7.0)).mul(sin(u.uTime.mul(3.1).add(1.0))).mul(0.15).add(0.85);
      return vec4(vec3(1.0, 0.3, 0.07).mul(g).mul(u.uBurn).mul(0.9).mul(fl), 1.0);
    })();
  });
}

// ------------------------------------------------------------------------------------------------ the camp's build pads (src/env/camp.js)
const h11 = Fn(([n]) => fract(sin(n.mul(91.345)).mul(47453.5453))).setLayout({ name: 'ewH11', type: 'float', inputs: [{ name: 'n', type: 'float' }] });
const padSeg = (p, a, b, w) => step(sdSeg(p, a, b), w);
/** The six build pads: pixel rune circles burnt into the ground (ember glow over a scorched disc). */
export function envPadMaterial(uniforms) {
  return twin(uniforms, {
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }, (u, m) => {
    const vLocal = varyingProperty('vec2', 'vPadLocal'), vPad = varyingProperty('float', 'vPadId'), vFog = varyingProperty('float', 'vPadFog');
    m.vertexNode = Fn(() => {
      vLocal.assign(attribute('aLocal', 'vec2')); vPad.assign(attribute('aPad', 'float'));
      const mv = modelViewMatrix.mul(vec4(positionGeometry, 1.0)).toVar();
      const d = length(mv.xyz).toVar();
      vFog.assign(exp(u.uFogDensity.mul(u.uFogDensity).mul(d).mul(d).negate()));
      return cameraProjectionMatrix.mul(mv);
    })();
    m.fragmentNode = Fn(() => {
      const i = int(vPad.add(0.5)).toVar();
      const P = u.uPad.element(select(i.greaterThanEqual(1).and(i.lessThan(6)), i, int(0))).toVar();   // x glow, y near, z built, w seed
      // pixel grid: 16 texels per metre, like every tile in the world
      const q = floor(vLocal.mul(16.0)).add(0.5).div(16.0).toVar();
      const r = length(q).toVar(), a = atan(q.y, q.x).toVar();
      const px = 1.0 / 16.0;
      const charA = one(smoothstep(0.92, 1.25, r)).mul(0.42);                       // the scorched disc under the circle
      const ring = step(abs(r.sub(0.93)), px * 1.0).add(step(abs(r.sub(0.66)), px * 0.6));
      const ca = a.add(3.14159265).div(6.2831853).mul(12.0).toVar();
      const cell = floor(ca);
      const g = vec2(fract(ca), r.sub(0.70).div(0.19)).toVar();                   // glyph space: u across, v outward
      const glyph = float(0.0).toVar();
      If(g.y.greaterThan(0.0).and(g.y.lessThan(1.0)), () => {
        const hb = h11(cell.add(P.w.mul(13.0))).toVar();
        glyph.addAssign(step(abs(g.x.sub(0.5)), 0.09));                              // the stem
        If(hb.greaterThan(0.25), () => { glyph.addAssign(step(abs(g.y.sub(select(hb.greaterThan(0.6), float(0.25), float(0.7)))), 0.09).mul(step(abs(g.x.sub(0.5)), 0.3))); });
        If(fract(hb.mul(7.3)).greaterThan(0.5), () => { glyph.addAssign(step(abs(g.x.sub(0.5).sub(g.y.sub(0.5).mul(0.6))), 0.08).mul(step(g.y, 0.5))); });
        If(fract(hb.mul(3.7)).greaterThan(0.6), () => { glyph.addAssign(step(abs(g.y.sub(0.92)), 0.08).mul(step(abs(g.x.sub(0.5)), 0.22))); });
        glyph.mulAssign(step(0.12, g.x).mul(step(g.x, 0.88)));
      });
      const t0 = vec2(0.0, -0.5), t1 = vec2(0.43, 0.25), t2 = vec2(-0.43, 0.25), w = px * 0.75;
      const tri = padSeg(q, t0, t1, w).add(padSeg(q, t1, t2, w)).add(padSeg(q, t2, t0, w))
        .add(padSeg(q, t1, vec2(0.52, 0.47), w)).add(padSeg(q, t2, vec2(-0.52, 0.47), w))   // the hooks
        .add(step(abs(length(q).sub(0.12)), px * 0.6));
      const mark = clamp(ring.add(glyph).add(tri), 0.0, 1.0).mul(step(r, 1.0));
      // ember glow: a slow breath per pad, a crawl of brighter cells round the ring; hotter when the player is near
      const breath = sin(u.uTime.mul(P.y.mul(2.2).add(1.6)).add(P.w.mul(9.0))).mul(0.18).add(0.82);
      const crawl = step(0.5, fract(ca.mul(0.5).sub(u.uTime.mul(0.35)))).mul(0.25).add(0.75);
      const lvl = P.x.mul(breath).mul(mix(float(1.0), crawl, 0.6)).mul(P.y.mul(1.4).add(1.0)).toVar();
      const hot = mix(vec3(0.85, 0.11, 0.03), vec3(1.0, 0.5, 0.14), clamp(lvl.mul(0.6), 0.0, 1.0));
      const glow = hot.mul(mark).mul(lvl).mul(2.6).toVar();
      glow.addAssign(vec3(0.9, 0.2, 0.05).mul(lvl).mul(0.16).mul(one(smoothstep(0.0, 1.15, r))).mul(P.y.mul(0.4).add(0.6)));   // a soft under-glow
      return vec4(glow.mul(vFog), charA.mul(vFog).mul(one(P.z.mul(0.6))));
    })();
  });
}

// ------------------------------------------------------------------------------------------------ the horned shadow (src/env/hints.js)
/** The player's horned shadow at dusk (multiply-blended on the wall and the ground). */
export function envHornedShadowMaterial(uniforms) {
  return twin(uniforms, {
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }, (u, m) => {
    const vW = varyingProperty('vec3', 'vHsW'), vKind = varyingProperty('float', 'vHsKind');
    m.vertexNode = Fn(() => {
      const kind = attribute('aKind', 'float');                                    // 0 wall strip, 1 ground strip
      vKind.assign(kind);
      const c = positionGeometry.xy;                                                // corners in [0, 1]^2
      const t = u.uP.z.sub(u.uWallZ).div(max(u.uL.z, 0.05));
      const xh = u.uP.x.sub(u.uL.x.mul(t));                                         // where the ray through the shoulders meets the wall
      const wWall = vec3(xh.add(c.x.sub(0.5).mul(3.6)), c.y.mul(3.4), u.uWallZ);
      const D = normalize(vec2(u.uL.x.negate(), u.uL.z.negate())).toVar();          // the shadow's direction on the ground
      const S = vec2(D.y, D.x.negate());
      const len = min(10.5, u.uP.z.sub(u.uWallZ).div(max(abs(D.y), 0.05)));
      const xz = u.uP.xz.add(D.mul(mix(float(-0.4), len, c.x))).add(S.mul(c.y.sub(0.5)).mul(2.2));
      const wGround = vec3(xz.x, u.uP.y.add(0.035), xz.y);
      const w = select(kind.lessThan(0.5), wWall, wGround).toVar();
      vW.assign(w);
      return cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(w, 1.0));
    })();
    m.fragmentNode = Fn(() => {
      const Nh = normalize(vec3(u.uL.x, 0.0, u.uL.z)).toVar();
      const s = dot(u.uP.sub(vW), Nh).div(dot(u.uL, Nh)).toVar();                  // distance along the ray back to the silhouette plane
      If(s.lessThan(0.05), () => { Discard(); });
      const Q = vW.add(u.uL.mul(s)).toVar();
      const T = normalize(vec3(Nh.z, 0.0, Nh.x.negate()));
      const q = vec2(abs(dot(Q.sub(u.uP), T)), Q.y.sub(u.uP.y)).toVar();
      // the silhouette: a cloaked body, a head, two short curled horns
      const hw = mix(float(0.16), float(0.27), smoothstep(0.1, 1.3, q.y)).sub(smoothstep(1.3, 1.44, q.y).mul(0.05));
      const body = max(q.x.sub(hw), max(q.y.negate(), q.y.sub(1.44)));
      const head = length(q.sub(vec2(0.0, 1.58))).sub(0.125);
      const horn = min(sdSeg(q, vec2(0.075, 1.64), vec2(0.17, 1.79)).sub(0.038), sdSeg(q, vec2(0.17, 1.79), vec2(0.145, 1.93)).sub(0.022));
      const d = min(min(body, head), horn);
      const soft = s.mul(0.012).add(0.018).toVar();
      const a = one(smoothstep(soft.negate(), soft, d)).toVar();
      // where the sun does not reach anyway: does the ray from p toward the sun hit the SW tower
      {
        const p = vW.add(u.uL.mul(0.05));
        const inv = vec3(1.0).div(u.uL).toVar();
        const t0 = vec3(-19.2, 0.0, -3.2).sub(p).mul(inv), t1 = vec3(-12.8, 10.0, 3.2).sub(p).mul(inv);
        const lo = min(t0, t1).toVar(), hi = max(t0, t1).toVar();
        const tn = max(max(lo.x, lo.y), lo.z), tf = min(min(hi.x, hi.y), hi.z);
        a.mulAssign(one(step(max(tn, 0.0), tf)));
      }
      a.mulAssign(select(vKind.lessThan(0.5), float(0.85), float(0.75)));
      a.mulAssign(u.uK);
      If(a.lessThan(0.003), () => { Discard(); });
      return vec4(mix(vec3(1.0), u.uTint, a), 1.0);
    })();
  });
}

// ------------------------------------------------------------------------------------------------ the ending (src/env/ending.js)
/** The portal torn in the sky above the keep. */
export function envPortalMaterial(uniforms) {
  return twin(uniforms, { transparent: true, depthWrite: false, side: THREE.DoubleSide }, (u, m) => {
    const vQ = varyingProperty('vec2', 'vPortalQ');
    m.vertexNode = Fn(() => { vQ.assign(positionGeometry.xy); return cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(positionGeometry.mul(1.35), 1.0)); })();
    m.fragmentNode = Fn(() => {
      If(u.uOpen.lessThan(0.002), () => { Discard(); });
      const q = floor(vQ.mul(1.35).mul(90.0)).add(0.5).div(90.0).toVar();       // ≈ 240 px across the disc
      const r = length(q).toVar(), a = atan(q.y, q.x).toVar();
      const R = u.uOpen.mul(0.88).add(0.12);                                         // the tear widens
      const rn = r.div(R).toVar();
      // the vortex: a spiral of fire filaments sucked toward a black-red eye
      const sw = a.add(float(2.6).div(rn.add(0.25))).sub(u.uTime.mul(0.9));
      const v = fbm(vec2(sw.mul(1.6), log(rn.add(0.05)).mul(3.0).sub(u.uTime.mul(0.7))));
      const fil = smoothstep(0.55, 0.85, v).toVar();
      const inner = mix(vec3(0.05, 0.0, 0.0), vec3(0.6, 0.04, 0.01), smoothstep(0.0, 0.9, rn)).toVar();
      inner.addAssign(vec3(1.5, 0.32, 0.05).mul(fil).mul(smoothstep(0.08, 0.6, rn)));
      inner.addAssign(vec3(1.9, 0.75, 0.2).mul(pow(fil, 3.0)).mul(smoothstep(0.4, 0.95, rn)));
      // the ring: ragged tongues of fire licking outward from the torn edge
      const tongues = fbm(vec2(a.mul(3.0), u.uTime.mul(1.3))).mul(0.22).add(fbm(vec2(a.mul(9.0), u.uTime.mul(-2.1))).mul(0.1)).toVar();
      const edge = one(smoothstep(0.0, tongues.add(0.05), abs(rn.sub(1.0)).sub(0.0))).toVar();
      const out1 = one(smoothstep(1.0, tongues.mul(1.4).add(1.0), rn)).mul(step(1.0, rn)).toVar();
      const ring = vec3(1.9, 0.5, 0.08).mul(edge).add(vec3(1.2, 0.2, 0.03).mul(out1));
      const inside = one(smoothstep(0.97, 1.0, rn)).toVar();
      const c = inner.mul(inside).add(ring).toVar();
      const a0 = max(inside, max(edge, out1)).toVar();
      // a dim red bloom of torn sky round it
      const halo = exp(max(0.0, rn.sub(1.0)).negate().mul(2.2)).mul(one(inside)).mul(0.35).toVar();
      c.addAssign(vec3(0.5, 0.04, 0.02).mul(halo));
      a0.assign(max(a0, halo));
      If(a0.lessThan(0.01), () => { Discard(); });
      return vec4(c.mul(smoothstep(0.0, 0.15, u.uOpen)), a0.mul(smoothstep(0.0, 0.1, u.uOpen)));
    })();
  });
}
/** The lamp's pillar of black-red fire (a cylindrical billboard from the basket). */
export function envPillarMaterial(uniforms) {
  return twin(uniforms, { transparent: true, depthWrite: false }, (u, m) => {
    const vH = varyingProperty('float', 'vPillarH');
    m.vertexNode = Fn(() => {
      const vu = uv();
      const H = u.uLamp.mul(34.0).add(6.0).toVar(), W = u.uLamp.mul(3.2).add(1.4);
      const base = modelWorldMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0)).xyz.toVar();
      const tc = cameraPosition.sub(base);
      const toCam = vec3(tc.x, 0.0, tc.z);
      const side = normalize(cross(vec3(0.0, 1.0, 0.0), normalize(toCam.add(vec3(1e-4)))));
      const w = base.add(side.mul(vu.x.sub(0.5)).mul(W).mul(one(vu.y.mul(0.45)))).add(vec3(0.0, vu.y.mul(H), 0.0));
      vH.assign(H);
      return cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(w, 1.0));
    })();
    m.fragmentNode = Fn(() => {
      If(u.uLamp.lessThan(0.01), () => { Discard(); });
      const vUv = uv();
      const cells = vec2(24.0, vH.mul(3.0)).toVar();
      const q = floor(vec2(vUv.x.mul(24.0), vUv.y.mul(vH).mul(3.0))).add(0.5).div(cells).toVar();
      const x = abs(q.x.sub(0.5)).mul(2.0).toVar();
      const n = n2(vec2(q.x.mul(5.0), q.y.mul(vH).mul(0.6).sub(u.uTime.mul(4.0)))).mul(0.6).add(n2(vec2(q.x.mul(11.0), q.y.mul(vH).mul(1.4).sub(u.uTime.mul(7.0)))).mul(0.4)).toVar();
      const body = one(smoothstep(n.mul(0.5).add(0.35), 0.95, x)).toVar();
      const top = one(smoothstep(n.mul(0.3).add(0.55), 1.0, q.y));
      const a = body.mul(top).toVar();
      If(a.lessThan(0.05), () => { Discard(); });
      // black core, crimson body, ember-orange edges
      const edge = smoothstep(0.2, 0.9, x.add(n.mul(0.25)));
      const c = mix(vec3(0.03, 0.0, 0.0), vec3(0.95, 0.05, 0.02), edge).toVar();
      c.addAssign(vec3(1.5, 0.38, 0.06).mul(smoothstep(0.75, 0.95, x.add(n.mul(0.3)))).mul(body));
      return vec4(c, a.mul(smoothstep(0.0, 0.2, u.uLamp)));
    })();
  });
}
/** Hellfire inside the open gate (opaque). */
export function envHellGateMaterial(uniforms) {
  return twin(uniforms, { transparent: false }, (u, m) => {
    m.vertexNode = Fn(() => cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(positionGeometry, 1.0)))();
    m.fragmentNode = Fn(() => {
      const cells = vec2(40.0, 34.0);
      const q = floor(uv().mul(cells)).add(0.5).div(cells).toVar();                // pixel rows like the flames
      const n = n2(vec2(q.x.mul(6.0), q.y.mul(5.0).sub(u.uTime.mul(2.2)))).mul(0.6).add(n2(vec2(q.x.mul(13.0), q.y.mul(9.0).sub(u.uTime.mul(3.7)))).mul(0.4)).toVar();
      const tongue = smoothstep(0.0, 1.0, one(q.y).add(n.sub(0.5).mul(0.45))).toVar();
      const c = mix(vec3(0.05, 0.004, 0.003), vec3(1.25, 0.2, 0.04), tongue).toVar();
      c.addAssign(vec3(1.6, 0.55, 0.1).mul(smoothstep(0.55, 0.95, tongue)).mul(n));
      return vec4(c.mul(u.uGate).mul(sin(u.uTime.mul(9.0)).mul(0.12).add(0.88)), 1.0);
    })();
  });
}
/** Embers falling like snow (a point cloud: draw it with envPoints). */
export function envEmberMaterial(uniforms) {
  return twin(uniforms, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }, (u, m) => {
    const vA = varyingProperty('float', 'vEmA'), vHot = varyingProperty('float', 'vEmHot');
    m.vertexNode = Fn(() => {
      const seed = attribute('aSeed', 'vec4');
      const box = vec3(50.0, 30.0, 50.0);
      const p = seed.xyz.mul(box).add(vec3(sin(u.uTime.mul(0.7).add(seed.w.mul(30.0))).mul(1.2), u.uTime.negate().mul(seed.w.mul(0.9).add(0.8)),
        cos(u.uTime.mul(0.5).add(seed.x.mul(20.0))).mul(1.0))).toVar();
      const half = u.uCam.sub(box.mul(0.5)).toVar();
      p.assign(mod(p.sub(half), box).add(half));
      const mv = cameraViewMatrix.mul(vec4(p, 1.0)).toVar();
      const d = mv.z.negate().toVar();
      vA.assign(u.uWorld.mul(smoothstep(0.5, 2.0, d)).mul(one(smoothstep(18.0, 25.0, length(mv.xyz)))));
      vHot.assign(sin(u.uTime.mul(seed.y.mul(5.0).add(3.0)).add(seed.z.mul(40.0))).mul(0.4).add(0.6));
      const size = clamp(u.uPx.mul(0.06).div(max(1.0, d)), 1.0, 5.0).mul(step(0.001, u.uWorld));
      return pointQuad(cameraProjectionMatrix.mul(mv), size);
    })();
    m.fragmentNode = Fn(() => {
      const q = pointCoord().sub(0.5);
      If(max(abs(q.x), abs(q.y)).greaterThan(0.5).or(vA.lessThan(0.01)), () => { Discard(); });
      return vec4(mix(vec3(1.6, 0.25, 0.05), vec3(2.6, 1.1, 0.3), vHot).mul(vA), 1.0);
    })();
  });
}

// ------------------------------------------------------------------------------------------------ the beacon's flare (src/env/beaconfx.js)
/** The warm sky glow round the basket. */
export function envBeaconGlowMaterial(uniforms) {
  return twin(uniforms, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }, (u, m) => {
    const vQ = varyingProperty('vec2', 'vBgQ');
    viewQuad(m, () => u.uFlare.mul(11.0).add(7.0), vQ);
    m.fragmentNode = Fn(() => {
      const r = length(vQ).toVar();
      If(r.greaterThan(1.0), () => { Discard(); });
      const r2 = r.mul(r);
      const g = exp(r2.negate().mul(7.0)).mul(0.75).add(exp(r.negate().mul(4.0)).mul(0.25)).mul(one(r2)).mul(one(r2));   // no visible rim
      const a = u.uFlare.mul(0.55).mul(sin(u.uTime.mul(19.0)).mul(0.12).add(0.88)).add(0.07);
      return vec4(vec3(1.0, 0.36, 0.1).mul(g).mul(a), 1.0);
    })();
  });
}
/** The spark fountain (a point cloud: draw it with envPoints). */
export function envBeaconSparkMaterial(uniforms) {
  return twin(uniforms, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }, (u, m) => {
    const vA = varyingProperty('float', 'vSpA'), vHot = varyingProperty('float', 'vSpHot');
    m.vertexNode = Fn(() => {
      const seed = attribute('aSeed', 'vec4');
      const life = seed.z.mul(1.3).add(1.1);
      const t = fract(u.uTime.div(life).add(seed.w)).toVar();
      const on = step(seed.x, u.uFlare.mul(0.93).add(0.07)).toVar();             // idle: a few sparks; flare: all of them
      const ang = seed.y.mul(6.2832).toVar();
      const sp = seed.x.mul(3.2).add(1.2).mul(u.uFlare.mul(0.8).add(0.6)).toVar();
      const p = u.uBase.add(vec3(cos(ang).mul(sp).mul(t), seed.z.mul(9.0).add(3.0).mul(t).sub(t.mul(2.2).mul(t)), sin(ang).mul(sp).mul(t))).toVar();
      p.assign(vec3(p.x.add(sin(u.uTime.mul(3.0).add(seed.y.mul(40.0))).mul(0.35).mul(t)), p.y, p.z));
      const mv = cameraViewMatrix.mul(vec4(p, 1.0)).toVar();
      vA.assign(on.mul(one(t)).mul(smoothstep(0.0, 0.06, t)));
      vHot.assign(one(t));
      const size = clamp(u.uPx.mul(0.07).div(max(1.0, mv.z.negate())), 1.0, 6.0).mul(on);
      return pointQuad(cameraProjectionMatrix.mul(mv), size);
    })();
    m.fragmentNode = Fn(() => {
      const q = pointCoord().sub(0.5);
      If(max(abs(q.x), abs(q.y)).greaterThan(0.5).or(vA.lessThan(0.01)), () => { Discard(); });   // square pixel sparks
      const c = mix(vec3(0.9, 0.18, 0.05), vec3(1.0, 0.75, 0.3), vHot);
      return vec4(c.mul(6.0).mul(vA), 1.0);
    })();
  });
}
const figure = Fn(([p0, ph]) => {
  // a hunched horned walker, about 1 unit tall, feet at y 0
  const step1 = sin(ph).toVar(), bob = abs(cos(ph)).mul(0.04);
  const p = vec2(p0.x, p0.y.sub(bob)).toVar();
  const body = length(p.sub(vec2(0.0, 0.55)).mul(vec2(1.25, 0.8))).sub(0.24);
  const head = length(p.sub(vec2(0.08, 0.86))).sub(0.11);
  const horns = min(sdSeg(p, vec2(0.03, 0.93), vec2(-0.06, 1.08)).sub(0.03), sdSeg(p, vec2(0.14, 0.93), vec2(0.2, 1.08)).sub(0.03));
  const legs = min(sdSeg(p, vec2(-0.05, 0.36), vec2(step1.mul(0.13).add(-0.05), 0.0)).sub(0.05), sdSeg(p, vec2(0.06, 0.36), vec2(float(0.06).sub(step1.mul(0.13)), 0.0)).sub(0.05));
  const spear = sdSeg(p, vec2(0.2, 0.15), vec2(0.28, 1.2)).sub(0.018);
  return min(min(min(body, head), min(horns, legs)), spear);
}).setLayout({ name: 'ewFigure', type: 'float', inputs: [{ name: 'p', type: 'vec2' }, { name: 'ph', type: 'float' }] });
/** The vision in the flare: a file of small horned figures marching through the fire column. */
export function envBeaconVisionMaterial(uniforms) {
  return twin(uniforms, { transparent: true, depthWrite: false }, (u, m) => {
    const vQ = varyingProperty('vec2', 'vVisQ');
    viewQuad(m, () => vec2(1.7, 1.35), vQ, 1.6);                                    // in front of the flame billboards
    m.fragmentNode = Fn(() => {
      If(u.uVision.lessThan(0.01), () => { Discard(); });
      const cells = vec2(64.0, 40.0);
      const q = floor(vQ.mul(0.5).add(0.5).mul(cells)).add(0.5).div(cells).toVar();   // pixel grid: 40 rows over the quad's height
      const fire = one(smoothstep(0.2, 0.48, length(q.sub(vec2(0.5, 0.42)).mul(vec2(1.0, 1.35)))));   // inside the flame only
      // two files at different depths march left to right
      const d = float(1e3).toVar();
      for (const [row, sc, y0, sp] of [[0, 0.46, 0.1, 0.36], [1, 0.3, 0.46, 0.22]]) {
        const x = q.x.mul(1.5).div(sc).sub(u.uTime.mul(sp).div(sc)).toVar();
        const cell = floor(x.div(1.15));
        const p = vec2(mod(x, 1.15).sub(0.5), q.y.sub(y0).div(sc));
        d.assign(min(d, figure(p, u.uTime.mul(7.0).add(cell.mul(1.7)).add(row))));
      }
      const a = step(d, 0.0).mul(smoothstep(0.0, 0.35, fire)).mul(u.uVision).mul(0.94).toVar();
      If(a.lessThan(0.01), () => { Discard(); });
      return vec4(0.03, 0.004, 0.0, a);
    })();
  });
}

// ------------------------------------------------------------------------------------------------ the far horde (src/env/farhorde.js)
/** Specks and torches streaming toward the keep (a point cloud: draw it with envPoints). */
export function envFarHordeMaterial(uniforms) {
  return twin(uniforms, { transparent: false, depthWrite: true }, (u, m) => {
    const vFog = varyingProperty('float', 'vFhFog'), vTorch = varyingProperty('float', 'vFhTorch'), vTint = varyingProperty('float', 'vFhTint'), vFlick = varyingProperty('float', 'vFhFlick');
    m.vertexNode = Fn(() => {
      const pos = attribute('aPos', 'vec3'), dir = attribute('aDir', 'vec3'), meta = attribute('aMeta', 'vec4');
      const walk = fract(u.uTime.mul(meta.y).div(6.0).add(meta.x)).toVar();       // 0..1 over a 6 m shuffle
      const p = pos.add(dir.mul(walk.sub(0.5))).toVar();
      p.assign(vec3(p.x, p.y.add(abs(sin(u.uTime.mul(7.0).mul(meta.y).add(meta.x.mul(30.0)))).mul(0.12)), p.z));   // the bob of a marching body
      const fade = smoothstep(0.0, 0.12, walk).mul(rss(1.0, 0.88, walk));
      const mv = cameraViewMatrix.mul(vec4(p.add(vec3(0.0, 0.55, 0.0)), 1.0)).toVar();
      const d = mv.z.negate().toVar();
      const f = one(exp(u.uFogDensity.mul(u.uFogDensity).mul(d).mul(d).negate())).toVar();
      vTorch.assign(meta.z); vTint.assign(meta.w);
      vFog.assign(select(meta.z.greaterThan(0.5), f.mul(0.45), f.mul(0.8)));
      vFlick.assign(sin(u.uTime.mul(13.0).add(meta.x.mul(50.0))).mul(0.25).add(0.75));
      const size = select(meta.z.greaterThan(0.5), float(0.9), float(1.5)).mul(u.uPx).div(max(1.0, d)).mul(0.62);   // a goblin ≈ 1.1 m tall
      return pointQuad(cameraProjectionMatrix.mul(mv), clamp(size, 1.5, 6.0).mul(fade));
    })();
    m.fragmentNode = Fn(() => {
      const q = pointCoord().sub(0.5).toVar();
      const c = vec3(0.0).toVar();
      If(vTorch.greaterThan(0.5), () => {
        If(max(abs(q.x), abs(q.y)).greaterThan(0.5), () => { Discard(); });
        c.assign(vec3(3.2, 1.25, 0.32).mul(vFlick).mul(one(u.uDawn.mul(0.7))));
      }).Else(() => {
        If(abs(q.x).greaterThan(0.3).or(q.y.lessThan(-0.5)), () => { Discard(); });   // a narrow upright body
        c.assign(mix(vec3(0.085, 0.08, 0.045), vec3(0.12, 0.05, 0.04), step(0.7, vTint)));   // olive grunts, brick-red imps
        c.addAssign(vec3(0.03, 0.07, 0.08).mul(step(0.2, q.y.negate())));         // a moonlit head and shoulders
      });
      return vec4(mix(c, u.uFogColor, vFog), 1.0);
    })();
  });
}

/**
 * A point cloud drawn with one of the point materials above. WebGPU rasterises 1-px points only, so each point becomes
 * one instance of a quad: the cloud's attributes become instance attributes (`position` → `aPos`).
 * @param {THREE.BufferGeometry} geometry @param {THREE.Material} material
 */
export function envPoints(geometry, material) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(quad.index);
  g.setAttribute('position', quad.attributes.position);
  g.setAttribute('uv', quad.attributes.uv);
  for (const [name, a] of Object.entries(geometry.attributes)) {
    const ia = /** @type {THREE.BufferAttribute} */ (a);
    g.setAttribute(name === 'position' ? 'aPos' : name, new THREE.InstancedBufferAttribute(/** @type {any} */ (ia.array), ia.itemSize));
  }
  g.instanceCount = geometry.attributes.position.count;
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'points';
  return mesh;
}
