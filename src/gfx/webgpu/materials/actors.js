// VALLEYWARD · the WebGPU edition's custom materials for the actors (TSL twins of src/gfx/webgl2/materials/actors.js;
// decision 0001, docs/WEBGPU-PORT.md). READY = every factory the actors use exists here: they then run in this edition.
//
// Same factory names, same `.uniforms` names (each a TSL uniform / texture slot with `.value`, so the actors'
// `mat.uniforms.uTime.value = t` is shared), the same per-instance attributes and the same render state as the GLSL.
// What differs by construction:
//   - tone mapping and the output colour space are the renderer's (WebGPURenderer applies them at the output, not per
//     material); fog is the scene's fog node, mixed in before them (the GLSL mixes it after: the same in a render target);
//   - the dither's pixel grid starts at the top-left (WebGPU's frag coordinates), so its 4×4 pattern is mirrored in y.
import { NodeMaterial, PointsNodeMaterial } from 'three/webgpu';
import {
  Fn, uniform, texture, textureLoad, attribute, instancedBufferAttribute, varying, varyingProperty, property, output, If, Discard, select,
  vec2, vec3, vec4, float, int, ivec2, bool, abs, floor, fract, sin, cos, atan, normalize, distance, dot, length, step,
  exp2, log2, min, max, mix, clamp, smoothstep, dFdx, dFdy, positionGeometry, cameraViewMatrix, cameraProjectionMatrix,
  cameraPosition, screenCoordinate,
} from 'three/tsl';
import { Color, Vector2, Vector3, Vector4, DoubleSide, AdditiveBlending, InstancedBufferAttribute, DynamicDrawUsage, Sprite } from 'three';
import { emberFireLight, ewGround } from '../firelight.js';

export const READY = true;

// ------------------------------------------------------------------------------------------------ helpers
/**
 * A texture "uniform" with `.value` for the actors (like a ShaderMaterial uniform): every TSL node that samples it is made
 * from the Texture itself (a node's texture is fixed when it is cloned) and re-pointed when `.value` changes.
 * @param {import('three').Texture} tex
 */
function textureSlot(tex) {
  const nodes = new Set();
  let cur = tex;
  return {
    get value() { return cur; },
    set value(t) { cur = t; for (const n of nodes) n.value = t; },
    /** sample at an explicit mip level (textureSampleLevel) */
    level(uvNode, lodNode) { const n = texture(cur, uvNode).level(lodNode); nodes.add(n); return n; },
    /** fetch one texel (textureLoad; integer coordinates) */
    load(ivNode) { const n = textureLoad(cur, ivNode); nodes.add(n); return n; },
  };
}

/** GLSL's mod (x − y·floor(x / y)) on a node, with a number y. */
const fmod = (x, y) => x.sub(floor(x.div(y)).mul(y));

/** The 4×4 ordered dither of the GLSL `bayer4` (int[16] { 0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5 }[x + 4y]),
 *  without an array: m(x, y) = 4·b2(x & 1, y & 1) + b2(x >> 1, y >> 1), b2 the 2×2 matrix { 0, 2, 3, 1 } = 2x + 3y − 4xy. */
function bayer4(p) {
  const q = floor(fmod(p, 4.0));
  const lo = fmod(q, 2.0), hi = floor(q.div(2.0));
  const b2 = (v) => v.x.mul(2.0).add(v.y.mul(3.0)).sub(v.x.mul(v.y).mul(4.0));
  return b2(lo).mul(4.0).add(b2(hi)).add(0.5).div(16.0);
}

// ------------------------------------------------------------------------------------------------ the horde sprites
/** The sprite material with its fog scaled per fragment (the hunt's silhouettes take a quarter of the scene's fog). */
class ActorSpriteNodeMaterial extends NodeMaterial {
  static get type() { return 'ActorSpriteNodeMaterial'; }
  constructor() {
    super();
    /** the share of the fog this fragment takes (written by the colour node) */
    this.fogShareNode = property('float', 'ewFogShare');
  }
  setupFog(builder, outputNode) {
    const fogNode = builder.fogNode;
    if (!fogNode) return outputNode;
    output.assign(outputNode);
    // fog(color, f) = mix(output, color, f); mixing that back toward output by `share` = fog with f × share
    return mix(output, vec4(fogNode.toVar()), this.fogShareNode);
  }
}

/**
 * The horde: instanced camera-facing billboards with the frame table, the melee screen-height cap, the fire tint ramp,
 * the hit flash, the dissolve dither, the rims, the fire light map and fog (the GLSL's twin, line by line).
 * @param {{ atlas: import('three').Texture, frameTex: import('three').DataTexture, width: number, height: number }} o
 */
export function actorSpriteMaterial({ atlas, frameTex, width, height }) {
  const U = {
    uAtlas: textureSlot(atlas), uFrames: textureSlot(frameTex), uAtlasSize: uniform(new Vector2(width, height)),
    uLodBias: uniform(0.0), uTilt: uniform(0.25), uTime: uniform(0), uSat: uniform(0.72), uNearFade: uniform(new Vector2(0.9, 1.9)),
    uMaxScreenH: uniform(0.5),
    uAmbient: uniform(new Color().setRGB(0.22, 0.33, 0.37)),
    uMoon: uniform(new Color().setRGB(0.15, 0.24, 0.27)),
    uSpriteFireGain: uniform(1.0),
    uNearFire: uniform(new Color(0, 0, 0)),
    uFloor: uniform(new Color().setRGB(0.3, 0.42, 0.46)),
    uRimSource: uniform(new Vector3(0, 0, 0)),
    uBossLight: uniform(new Vector4(0, 0, 0, 0)),
    uBossLightCol: uniform(new Color().setRGB(0.18, 0.42, 0.75)),
  };
  const m = new ActorSpriteNodeMaterial();
  const iPos = attribute('iPos', 'vec4'), iA = attribute('iA', 'vec4'), iB = attribute('iB', 'vec4');
  const vUv = varyingProperty('vec2', 'ewUv'), vA = varyingProperty('vec4', 'ewA'), vB = varyingProperty('vec4', 'ewB');
  const vWorld = varyingProperty('vec3', 'ewWorld'), vToCam = varyingProperty('vec3', 'ewToCam'), vLocal = varyingProperty('vec2', 'ewLocal');
  const vRimDir = varyingProperty('vec2', 'ewRimDir'), vRimK = varyingProperty('float', 'ewRimK');

  // ---- vertex: the world position of this corner (the mesh sits at the origin, as the GLSL assumes: wp is world space)
  const vertex = Fn(() => {
    const V = cameraViewMatrix, Pm = cameraProjectionMatrix;
    const f = int(iA.x.add(0.5)).toVar();
    const r = U.uFrames.load(ivec2(f, int(0))).toVar();
    const s = U.uFrames.load(ivec2(f, int(1))).toVar();
    const flip = select(iA.w.lessThan(0.0), float(-1.0), float(1.0)).toVar();
    const camRight = vec3(V.element(0).x, V.element(1).x, V.element(2).x);
    const camUp = vec3(V.element(0).y, V.element(1).y, V.element(2).y);
    const right = normalize(vec3(camRight.x, 0.0, camRight.z).add(vec3(1e-5, 0.0, 0.0))).toVar();
    const up = normalize(mix(vec3(0.0, 1.0, 0.0), camUp, U.uTilt)).toVar();
    const c = positionGeometry.xy.toVar();                 // corner 0..1
    // the melee-range cap: past uMaxScreenH of the frame height a sprite shrinks about its feet
    const sc = abs(iPos.w).toVar();
    If(iPos.w.greaterThan(0.0).and(U.uMaxScreenH.greaterThan(0.0)), () => {
      const dView = max(0.05, V.mul(vec4(iPos.xyz, 1.0)).z.negate());
      const frac = s.y.mul(sc).mul(Pm.element(1).y).div(dView.mul(2.0));
      sc.mulAssign(min(1.0, U.uMaxScreenH.div(max(frac, 1e-4))));
    });
    const l0 = vec2(c.x.mul(s.x).sub(s.z), c.y.mul(s.y).sub(s.w)).mul(sc).toVar();
    const cr = cos(iB.x).toVar(), sr = sin(iB.x).toVar();
    const l = vec2(l0.x.mul(cr).sub(l0.y.mul(sr)), l0.x.mul(sr).add(l0.y.mul(cr))).toVar();
    const wp = iPos.xyz.add(right.mul(l.x)).add(up.mul(l.y)).toVar();
    const u = select(flip.greaterThan(0.0), c.x, float(1.0).sub(c.x));
    vUv.assign(vec2(mix(r.x, r.z, u), mix(r.y, r.w, c.y)));
    vA.assign(iA); vB.assign(iB);
    vLocal.assign(c);
    // the rim source's direction on screen, in the sprite's own u/v axes (u mirrored when the sprite is flipped)
    const PV = Pm.mul(V);
    const rs0 = PV.mul(vec4(iPos.xyz.add(vec3(0.0, s.y.mul(0.5).mul(sc), 0.0)), 1.0)).toVar();
    const rs1 = PV.mul(vec4(U.uRimSource, 1.0)).toVar();
    const rd = select(rs1.w.greaterThan(0.01), rs1.xy.div(rs1.w).sub(rs0.xy.div(max(rs0.w, 1e-3))), vec2(0.0, 1.0)).toVar();
    rd.x.assign(rd.x.mul(Pm.element(1).y.div(max(Pm.element(0).x, 1e-5))));
    vRimDir.assign(normalize(vec2(rd.x.mul(flip), rd.y).add(vec2(0.0, 1e-5))));
    vRimK.assign(float(1.0).sub(smoothstep(25.0, 45.0, distance(iPos.xz, U.uRimSource.xz))));
    vWorld.assign(wp);
    vToCam.assign(normalize(vec3(cameraPosition.x.sub(wp.x), 0.0, cameraPosition.z.sub(wp.z)).add(vec3(0.0, 0.0, 1e-5))));
    return wp;
  });

  // ---- fragment
  const LUMA_A = vec3(0.299, 0.587, 0.114), LUMA_B = vec3(0.3, 0.59, 0.11), LUMA_709 = vec3(0.2126, 0.7152, 0.0722);
  /** 0 crimson → 1 white-yellow (ART-DIRECTION §7 ramp, linear-ish) */
  const fireRamp = (x) => {
    const a = vec3(0.37, 0.016, 0.010), b = vec3(0.81, 0.10, 0.012), c = vec3(1.0, 0.33, 0.027), d = vec3(1.0, 0.64, 0.07), e = vec3(1.0, 0.89, 0.48);
    return select(x.lessThan(0.25), mix(a, b, x.div(0.25)), select(x.lessThan(0.5), mix(b, c, x.sub(0.25).div(0.25)),
      select(x.lessThan(0.75), mix(c, d, x.sub(0.5).div(0.25)), mix(d, e, x.sub(0.75).div(0.25)))));
  };
  /** the hue wheel of a variant (fract → RGB) */
  const hueOf = (variant) => clamp(abs(fmod(variant.mul(6.0).add(vec3(0.0, 4.0, 2.0)), 6.0).sub(3.0)).sub(1.0), 0.0, 1.0);

  const fragment = Fn(() => {
    const tp = vUv.mul(U.uAtlasSize).toVar();
    const dx = dFdx(tp).toVar(), dy = dFdy(tp).toVar();
    const foot = max(length(dx), length(dy));
    const lod = clamp(floor(log2(max(foot, 1e-4)).add(U.uLodBias).add(0.5)), 0.0, 3.0).toVar();
    const tpW = abs(dx).add(abs(dy)).toVar();   // derivatives taken here, in uniform control flow
    const A = (uvN) => U.uAtlas.level(uvN, lod);
    /** a thin rim registered to the silhouette: the outermost widthPx screen pixels of the edge texels facing dir */
    const thinRim = (widthPx, dir, bias) => {
      const sc = exp2(lod);
      const ts = vec2(sc, sc).div(U.uAtlasSize);
      const fq = fract(vUv.mul(U.uAtlasSize).div(sc)).toVar();
      const ppx = max(tpW.div(sc), vec2(1e-5)).toVar();
      const side = (off, cond, d) => select(A(vUv.add(off)).a.lessThan(0.5), step(cond, float(widthPx)).mul(clamp(d.add(bias), 0.0, 1.0)), float(0.0));
      return max(max(side(vec2(ts.x, 0.0), float(1.0).sub(fq.x).div(ppx.x), dir.x), side(vec2(ts.x.negate(), 0.0), fq.x.div(ppx.x), dir.x.negate())),
        max(side(vec2(0.0, ts.y), float(1.0).sub(fq.y).div(ppx.y), dir.y), side(vec2(0.0, ts.y.negate()), fq.y.div(ppx.y), dir.y.negate())));
    };
    const tex = A(vUv).toVar();
    If(tex.a.lessThan(0.5), () => { Discard(); });
    // dissolve (death fade) and a near-camera fade: a goblin at arm's length dithers out instead of filling the screen
    const camD = distance(vWorld, cameraPosition).toVar();
    const nearFade = float(1.0).sub(smoothstep(U.uNearFade.x, U.uNearFade.y, camD));
    const diss = max(vB.z, nearFade).toVar();
    If(diss.greaterThan(0.0).and(bayer4(screenCoordinate.xy).lessThan(diss)), () => { Discard(); });
    const variant = fract(abs(vA.w)).toVar();
    const cls = floor(abs(vA.w)).toVar();
    const demonRim = float(0.0).toVar();
    const rimCol = vec3(1.0, 0.36, 0.07).mul(2.2).toVar();
    const bossK = float(0.0).toVar(), huntK = float(0.0).toVar();
    const col = vec3(0.0).toVar();
    const done = bool(false).toVar();   // an unlit early-out of the GLSL (a return after its own fog)
    const emberEyes = tex.r.greaterThan(0.5).and(tex.r.greaterThan(tex.g.mul(1.6))).and(tex.b.lessThan(tex.r.mul(0.35)));
    If(cls.greaterThan(1.5).and(cls.lessThan(2.5)).and(tex.a.lessThan(0.9)), () => {
      // an elite's gold rim glows, unlit (it fades with the near dissolve, back to the dark outline within ≈ 4 m)
      const rimK = smoothstep(1.6, 4.0, camD).mul(float(1.0).sub(diss));
      const gold = vec3(1.0, 0.62, 0.12).mul(sin(U.uTime.mul(5.0).add(vWorld.x.mul(2.0)).add(vWorld.z)).mul(0.35).add(1.25));
      col.assign(mix(vec3(0.016, 0.01, 0.012), gold, rimK));
      done.assign(true);
    }).ElseIf(vB.w.lessThan(-0.5), () => {
      // the troll's hot-crack layer: its seam pixels through crimson → ember → orange, eyes amber; emissive only
      const g = tex.g;
      const crimson = vec3(0.366, 0.018, 0.010), ember = vec3(0.807, 0.102, 0.011), orange = vec3(1.0, 0.323, 0.027), amber = vec3(1.0, 0.52, 0.05);
      const hot = select(g.lessThan(0.45), mix(crimson, ember, 0.35), select(g.lessThan(0.7), ember, select(g.lessThan(0.9), orange, amber)));
      col.assign(hot.mul(vB.y));
      done.assign(true);
    }).Else(() => {
      const base = tex.rgb.mul(vec3(variant, fract(variant.mul(7.13)), fract(variant.mul(3.71))).sub(0.5).mul(0.14).add(1.0)).toVar();
      base.assign(mix(vec3(dot(base, LUMA_A)), base, U.uSat));   // muted night palette (ART-DIRECTION §3.3)
      If(cls.greaterThan(2.5).and(cls.lessThan(3.5)), () => {
        // a tinted item (the charm): the hue in fract(|flipV|), luma kept
        base.assign(mix(base, dot(base, LUMA_B).mul(hueOf(variant).mul(1.3).add(0.35)), 0.75));
      }).ElseIf(cls.greaterThan(6.5), () => {
        // class 7, the demon revealed: its fire pixels glow unlit; the silhouette's upper edge takes a hot rim
        If(tex.r.greaterThan(0.6).and(tex.g.greaterThan(0.22)).and(tex.r.greaterThan(tex.b.mul(2.2))), () => {
          col.assign(tex.rgb.mul(sin(U.uTime.mul(6.0).add(vWorld.y.mul(3.0))).mul(0.4).add(2.2)));
          done.assign(true);
        }).Else(() => {
          const ts = vec2(exp2(lod), exp2(lod)).div(U.uAtlasSize);
          const edge = float(1.0).sub(min(min(A(vUv.add(vec2(ts.x, 0.0))).a, A(vUv.sub(vec2(ts.x, 0.0))).a),
            min(A(vUv.add(vec2(0.0, ts.y))).a, A(vUv.sub(vec2(0.0, ts.y))).a)));
          demonRim.assign(step(0.5, edge).mul(smoothstep(0.3, 0.7, vLocal.y)));
        });
      }).ElseIf(cls.greaterThan(5.5), () => {
        // class 6, the Rainmother: her crown of lanterns and her eyes glow unlit, × fract = the share still alive
        If(tex.b.greaterThan(0.45).and(tex.b.greaterThan(tex.r.mul(1.4))).and(tex.g.greaterThan(0.3)), () => {
          col.assign(vec3(0.45, 0.8, 1.0).mul(variant.mul(2.6).mul(sin(U.uTime.mul(7.0).add(vWorld.x)).mul(0.15).add(0.85)).add(0.25)));
          done.assign(true);
        }).Else(() => {
          // a solid dark-water body, the foam veins as cold detail, a 2-px cyan rim on every edge
          const lw = dot(tex.rgb, LUMA_B).toVar();
          base.assign(mix(vec3(0.03, 0.065, 0.11), vec3(0.09, 0.19, 0.29), smoothstep(0.08, 0.55, lw)));
          If(lw.greaterThan(0.62), () => { base.assign(vec3(0.15, 0.3, 0.42)); });
          demonRim.assign(thinRim(2.0, vec2(0.0, 0.0), 1.0));
          rimCol.assign(vec3(0.35, 0.9, 1.0).mul(2.0));
          bossK.assign(1.0);
        });
      }).ElseIf(cls.greaterThan(4.5), () => {
        // class 5, silhouettes in firelight (the host, the fleeing villagers and animals); emissive flags: > 0.165 the
        // hunt's prey, 0.12–0.165 the hunt's horned chasers, below that the marching host
        const hunt = vB.y.greaterThan(0.12), prey = vB.y.greaterThan(0.165);
        If(prey.not().and(emberEyes), () => {
          col.assign(vec3(1.0, 0.38, 0.06).mul(2.4));
          done.assign(true);
        }).ElseIf(hunt, () => {
          // a solid near-black silhouette with a ≤ 1.25-px ember rim on the edge texels facing the village
          base.assign(vec3(0.03, 0.022, 0.02));
          demonRim.assign(thinRim(1.25, vRimDir, 0.15).mul(vRimK));
          rimCol.assign(vec3(1.0, 0.46, 0.12).mul(1.2));
          huntK.assign(1.0);
        }).Else(() => {
          base.assign(mix(vec3(dot(base, LUMA_B)), base, 0.5).mul(mix(0.32, 1.0, variant)));
          // the host: a registered red rim on the sides facing the gate's fire behind it
          demonRim.assign(thinRim(1.25, vRimDir, 0.2).mul(vRimK));
          rimCol.assign(vec3(1.0, 0.3, 0.07).mul(1.5));
        });
      }).ElseIf(cls.greaterThan(3.5), () => {
        // class 4, the camp characters: ember eyes glow unlit, the near-black art lifted into a readable warm hue
        If(emberEyes, () => {
          col.assign(vec3(1.0, 0.42, 0.07).mul(2.6));
          done.assign(true);
        }).Else(() => {
          base.assign(dot(base, LUMA_B).mul(1.5).add(0.035).mul(hueOf(variant).mul(1.3).add(0.35)));
        });
      });
      If(done.not(), () => {
        // light: the night (hemisphere + the moon from the front), the fire light map, and near the camera the fire
        // around the player as a front fill; never below uFloor. The fire terms are soft-compressed (hue kept).
        const nearW = float(1.0).sub(smoothstep(2.5, 9.0, camD));
        // sprites sample the light a little toward the camera (a camera-facing card has no real normal)
        const fire = emberFireLight(vWorld, vToCam.mul(0.35)).mul(U.uSpriteFireGain).add(U.uNearFire.mul(nearW)).toVar();
        fire.divAssign(max(fire.r, max(fire.g, fire.b)).mul(0.35).add(1.0));
        const light = max(U.uAmbient.add(U.uMoon).add(fire), U.uFloor).toVar();
        If(cls.greaterThan(6.5), () => { light.assign(max(light, vec3(0.7, 0.5, 0.46))); });   // the demon reads in any grade
        If(bossK.greaterThan(0.0), () => { light.assign(max(light, vec3(0.55, 0.65, 0.8))); })
          .ElseIf(U.uBossLight.w.greaterThan(0.0), () => {
            light.addAssign(U.uBossLightCol.mul(float(1.0).sub(smoothstep(0.0, U.uBossLight.w, distance(vWorld.xz, U.uBossLight.xz)))));
          });
        col.assign(base.mul(light));
        If(huntK.greaterThan(0.0), () => { col.assign(base); });   // the hunt's silhouettes stay solid near-black
        const lumB = dot(base, LUMA_709).toVar();
        const burn = vA.y;
        If(burn.greaterThan(0.0), () => {   // a burning goblin: lit from inside by its own flames (the fire ramp, flickering)
          const fl = sin(U.uTime.mul(23.0).add(variant.mul(40.0)).add(vWorld.y.mul(9.0))).mul(0.5).add(0.5).toVar();
          const h = clamp(lumB.mul(0.8).add(0.2).add(fl.mul(0.15)), 0.0, 0.78).toVar();   // crimson → orange
          const hot = fireRamp(h).toVar();
          col.assign(mix(col, base.mul(hot).mul(fl.mul(0.3).add(1.35)).add(hot.mul(0.12)), burn.mul(0.8)));
        }).ElseIf(burn.lessThan(0.0), () => {   // the troll's heat: the ash hide multiplies toward ember (a dark red-hot body)
          const ember = vec3(0.807, 0.102, 0.011);
          col.assign(mix(col, lumB.mul(1.6).add(0.05).mul(ember).mul(dot(light, vec3(0.33)).mul(0.4).add(0.8)), burn.negate().mul(0.7)));
        });
        If(vB.w.greaterThan(0.0), () => {   // a corpse sinking to ash: a dark warm-grey smudge
          const l = dot(col, LUMA_709);
          col.assign(mix(col, vec3(l.mul(0.34)).mul(vec3(1.0, 0.88, 0.8)), vB.w.mul(0.85)));
        });
        col.addAssign(base.mul(vB.y));
        col.addAssign(vec3(0.012, 0.035, 0.06).mul(bossK));   // her water holds a little cold light of its own
        If(demonRim.greaterThan(0.0), () => { col.assign(mix(col, rimCol, demonRim)); });
        If(vA.z.greaterThan(0.0), () => { col.assign(mix(col, vec3(1.0, 0.97, 0.9).mul(1.6), vA.z.mul(0.85))); })
          .ElseIf(vA.z.lessThan(0.0), () => { col.assign(mix(col, vec3(0.95, 0.2, 0.03).mul(1.2), vA.z.negate().mul(0.6))); });
      });
    });
    // three's fog, with the hunt's silhouettes taking a quarter of it
    m.fogShareNode.assign(select(huntK.greaterThan(0.0), float(0.25), float(1.0)));
    return vec4(col, 1.0);
  });

  m.name = 'actors.sprite';
  m.positionNode = vertex();
  m.colorNode = fragment();
  m.fog = true;
  m.side = DoubleSide;
  m.transparent = false;
  m.uniforms = U;
  return m;
}

// ------------------------------------------------------------------------------------------------ the troll's telegraphs
/** @param {{ walk: { x0: number, z0: number, x1: number, z1: number } }} o the wall walk's rectangle (ARENA.keep.walk) */
export function actorTelegraphMaterial({ walk }) {
  const U = { uTime: uniform(0), uWalk: uniform(new Vector4(walk.x0, walk.z0, walk.x1, walk.z1)) };
  const iC = attribute('iC', 'vec4'), iD = attribute('iD', 'vec4');
  const vL = varyingProperty('vec2', 'ewTL'), vD = varyingProperty('vec4', 'ewTD'), vR = varyingProperty('float', 'ewTR');
  const vW = varyingProperty('vec3', 'ewTW');   // world x, z, and 1 when the decal lies flat on the wall walk
  const vertex = Fn(() => {
    const l = positionGeometry.xy.mul(iC.z).mul(iD.w).toVar();
    const xz = iC.xy.add(l).toVar();
    const flat = iC.w.greaterThan(-100.0);
    const y = select(flat, iC.w, ewGround(xz));
    vL.assign(l); vD.assign(iD); vR.assign(iC.z);
    vW.assign(vec3(xz, select(flat, float(1.0), float(0.0))));
    return vec3(xz.x, y.add(0.07), xz.y);   // world space (the mesh sits at the origin, as the GLSL assumes)
  });
  const fragment = Fn(() => {
    // a decal that lies flat at the walk's height is clipped to the walk
    If(vW.z.greaterThan(0.5).and(vW.x.lessThan(U.uWalk.x).or(vW.x.greaterThan(U.uWalk.z)).or(vW.y.lessThan(U.uWalk.y)).or(vW.y.greaterThan(U.uWalk.w))), () => { Discard(); });
    const PX = 0.125;                    // 8 texels per metre: the world's chunky pixel grid
    const cell = floor(vL.div(PX)).toVar();
    const q = cell.add(0.5).mul(PX).toVar();
    const d = length(q).toVar();
    const R = vR, prog = vD.y;
    const dith = bayer4(cell).toVar();
    const red = vec3(0.62, 0.1, 0.05), hot = vec3(0.8, 0.26, 0.07);
    const col = vec3(red).toVar(), a = float(0.0).toVar();
    If(vD.x.lessThan(0.5), () => {
      // stomp: the danger edge at r, and a fill growing from the feet to the edge as the windup runs out
      const fillR = R.mul(prog).toVar();
      If(abs(d.sub(R)).lessThan(0.16), () => { a.assign(0.85); col.assign(red.mul(prog.mul(0.3).add(0.85).add(sin(U.uTime.mul(18.0)).mul(0.15)))); })
        .ElseIf(prog.greaterThan(0.02).and(abs(d.sub(fillR)).lessThan(0.13)), () => { a.assign(0.7); col.assign(hot.mul(0.8)); })
        .ElseIf(d.lessThan(fillR), () => { a.assign(select(dith.lessThan(prog.mul(0.25).add(0.22)), float(0.38), float(0.0))); col.assign(red.mul(0.6)); });
    }).Else(() => {
      // boulder: a dithered shadow that shrinks to the impact radius and darkens as the boulder falls; a dashed red rim
      const rS = R.mul(float(1.8).sub(prog.mul(0.8)));
      If(d.lessThan(rS), () => {
        a.assign(select(dith.lessThan(prog.mul(0.55).add(0.4)), prog.mul(0.5).add(0.3), float(0.0)));
        col.assign(vec3(0.02, 0.016, 0.016));
      });
      const dash = step(0.5, fract(atan(q.y, q.x).mul(2.546).add(U.uTime.mul(0.5))));
      If(abs(d.sub(R)).lessThan(0.13).and(dash.greaterThan(0.5)).and(prog.greaterThan(0.0)), () => { a.assign(0.85); col.assign(red.mul(0.95)); });
    });
    a.mulAssign(vD.z);
    If(a.lessThan(0.01), () => { Discard(); });
    return vec4(col, a);
  });
  const m = new NodeMaterial();
  m.name = 'actors.telegraph';
  m.positionNode = vertex();
  m.colorNode = fragment();
  m.fog = true;
  m.transparent = true; m.depthWrite = false; m.side = DoubleSide;
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
  m.uniforms = U;
  return m;
}

// ------------------------------------------------------------------------------------------------ the boss light
/** The Rainmother's pool of cold light: an additive disc of `radius` metres (the actors' plane has that half-size). */
export function actorBossLightMaterial({ radius: R }) {
  const U = { uCol: uniform(new Color(0.16, 0.45, 0.95)), uK: uniform(0), uTime: uniform(0) };
  const vL = varying(positionGeometry.xz);
  const fragment = Fn(() => {
    const d = length(vL).div(R).toVar();
    const a = float(1.0).sub(smoothstep(0.0, 1.0, d)).mul(sin(U.uTime.mul(1.7).add(d.mul(9.0))).mul(0.25).add(0.75));
    return vec4(U.uCol.mul(a).mul(U.uK), 1.0);
  });
  const m = new NodeMaterial();
  m.name = 'actors.bossLight';
  m.colorNode = fragment();
  m.fog = false;   // (the GLSL ShaderMaterial has no fog)
  m.transparent = true; m.blending = AdditiveBlending; m.depthWrite = false;
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
  m.uniforms = U;
  return m;
}

// ------------------------------------------------------------------------------------------------ the viewmodel's sparks
/** The gloves' smoulder sparks: WebGPU draws a `Points` object 1 px wide whatever its size, so the 3-px points are an
 *  instanced Sprite with a PointsNodeMaterial (one screen-aligned quad per spark, three's sized-points path). The actors code
 *  writes `geo.attributes.position / color` (instanced attributes here) and toggles `pts.visible`, as in WebGL2. */
export function actorSparkPoints({ count }) {
  const position = new InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(DynamicDrawUsage);
  const color = new InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(DynamicDrawUsage);
  const mat = new PointsNodeMaterial({ size: 3, sizeAttenuation: false, transparent: true, blending: AdditiveBlending, depthWrite: false });
  mat.positionNode = instancedBufferAttribute(position);
  mat.colorNode = vec4(instancedBufferAttribute(color), 1.0);   // vertexColors × white
  const pts = new Sprite(mat);
  pts.count = count;
  return { pts, geo: { attributes: { position, color }, dispose() {} } };
}
