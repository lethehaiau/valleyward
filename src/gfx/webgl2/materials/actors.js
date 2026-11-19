// VALLEYWARD · the WebGL2 edition's custom materials for the actors (GLSL, moved verbatim from src/actors/; decision 0001,
// docs/WEBGPU-PORT.md). Each factory has a TSL twin of the same name in src/gfx/webgpu/materials/actors.js:
//   actorSpriteMaterial({ atlas, frameTex, width, height })   the horde sprite shader (src/actors/spriteMaterial.js)
//   actorTelegraphMaterial({ walk })                          the Ash Troll's ground telegraphs (src/actors/telegraph.js)
//   actorBossLightMaterial({ radius })                        the Rainmother's pool of cold light (src/actors/bosslight.js)
import * as THREE from 'three';
import * as FL from '../../../shared/firelight.js';

const { FIRELIGHT, GROUND_GLSL } = FL;

// ------------------------------------------------------------------------------------------------ the horde sprites
// The one sprite shader: instanced, camera-facing (cylindrical, with an optional small tilt toward the camera so sprites
// seen from the wall walk do not flatten), alpha-tested and depth-writing (the fire volume sits right), flat moonlight from
// the front + the shared fire light map (src/shared/firelight.js uniforms, the same objects the fire code writes), a fire tint ramp
// for burning sprites, a hit flash, an ordered-dither dissolve, scene fog, and an explicit mip level from the texel
// footprint so far sprites stay crisp without shimmer. The per-instance attributes are documented in
// src/actors/spriteMaterial.js (the geometry stays in src/actors/).
const SPRITE_VERT = /* glsl */`
uniform sampler2D uFrames;
uniform float uTilt;
uniform float uMaxScreenH;   // melee: a sprite never takes more than this fraction of the frame height
attribute vec4 iPos;
attribute vec4 iA;
attribute vec4 iB;
varying vec2 vUv;
varying vec4 vA;
varying vec4 vB;
varying vec3 vWorld;
varying vec3 vToCam;
varying vec2 vLocal;
varying vec2 vRimDir;
varying float vRimK;
uniform vec3 uRimSource;   // the world point a silhouette's rim faces (the burning village during the hunt)
#include <fog_pars_vertex>
void main() {
  int f = int(iA.x + 0.5);
  vec4 r = texelFetch(uFrames, ivec2(f, 0), 0);
  vec4 s = texelFetch(uFrames, ivec2(f, 1), 0);
  float flip = iA.w < 0.0 ? -1.0 : 1.0;
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 right = normalize(vec3(camRight.x, 0.0, camRight.z) + vec3(1e-5, 0.0, 0.0));
  vec3 up = normalize(mix(vec3(0.0, 1.0, 0.0), camUp, uTilt));
  vec2 c = position.xy;                         // corner 0..1
  // melee-range cap: a goblin at contact range (or a Chieftain with its banner) would fill the frame with 15–20 px texels;
  // past uMaxScreenH of the frame height it shrinks about its feet instead (its screen height then stays constant), so a
  // crowd on the player stays readable. Far sprites are untouched (the cap only acts within a few metres).
  float sc = abs(iPos.w);
  if (iPos.w > 0.0 && uMaxScreenH > 0.0) {
    float dView = max(0.05, -(viewMatrix * vec4(iPos.xyz, 1.0)).z);
    float frac = s.y * sc * projectionMatrix[1][1] / (2.0 * dView);
    sc *= min(1.0, uMaxScreenH / max(frac, 1e-4));
  }
  vec2 l = vec2(c.x * s.x - s.z, c.y * s.y - s.w) * sc;
  float cr = cos(iB.x), sr = sin(iB.x);
  l = vec2(l.x * cr - l.y * sr, l.x * sr + l.y * cr);
  vec3 wp = iPos.xyz + right * l.x + up * l.y;
  float u = flip > 0.0 ? c.x : 1.0 - c.x;
  vUv = vec2(mix(r.x, r.z, u), mix(r.y, r.w, c.y));
  vA = iA; vB = iB;
  vLocal = c;
  // the rim source's direction on screen, in the sprite's own u/v axes (u mirrored when the sprite is flipped)
  vec4 rs0 = projectionMatrix * viewMatrix * vec4(iPos.xyz + vec3(0.0, 0.5 * s.y * sc, 0.0), 1.0);
  vec4 rs1 = projectionMatrix * viewMatrix * vec4(uRimSource, 1.0);
  vec2 rd = rs1.w > 0.01 ? rs1.xy / rs1.w - rs0.xy / max(rs0.w, 1e-3) : vec2(0.0, 1.0);
  rd.x *= projectionMatrix[1][1] / max(projectionMatrix[0][0], 1e-5);
  vRimDir = normalize(vec2(rd.x * flip, rd.y) + vec2(0.0, 1e-5));
  vRimK = 1.0 - smoothstep(25.0, 45.0, distance(iPos.xz, uRimSource.xz));   // the fire's backlit rim fades far from the village
  vWorld = wp;
  vToCam = normalize(vec3(cameraPosition.x - wp.x, 0.0, cameraPosition.z - wp.z) + vec3(0.0, 0.0, 1e-5));
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

// the fire code's shared helper (src/shared/firelight.js FIRELIGHT_GLSL: emberFireLight(p, n)); our own copy if it is missing
const OWN_FIRELIGHT = /* glsl */`
uniform sampler2D uFireLightMap; uniform vec4 uFireLightRect; uniform float uFireLightGain;
uniform float uFireLightReach; uniform float uFireLightHeight;
vec3 emberFireLight(vec3 p, vec3 n) {
  vec3 q = p + n * uFireLightReach;
  vec2 uv = (q.xz - uFireLightRect.xy) / uFireLightRect.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec3(0.0);
  vec3 L = texture2D(uFireLightMap, uv).rgb;
  float above = max(0.0, p.y) / max(0.001, uFireLightHeight);
  return L / (1.0 + above * above) * uFireLightGain;
}`;
const FIRELIGHT_GLSL = typeof FL.FIRELIGHT_GLSL === 'string' && FL.FIRELIGHT_GLSL.includes('emberFireLight') ? FL.FIRELIGHT_GLSL : OWN_FIRELIGHT;

const SPRITE_FRAG = /* glsl */`
uniform sampler2D uAtlas;
uniform vec2 uAtlasSize;
uniform float uLodBias;
uniform vec3 uAmbient;
uniform vec3 uMoon;
uniform float uTime;
uniform float uSat;
uniform vec2 uNearFade;
uniform float uSpriteFireGain;
uniform vec3 uNearFire;
uniform vec3 uFloor;
uniform vec4 uBossLight;      // the Rainmother's cold light on nearby sprites (xyz, radius; radius 0 = off)
uniform vec3 uBossLightCol;
__FIRELIGHT__
varying vec2 vUv;
varying vec4 vA;
varying vec4 vB;
varying vec3 vWorld;
varying vec3 vToCam;
varying vec2 vLocal;
varying vec2 vRimDir;
varying float vRimK;
#include <common>
#include <fog_pars_fragment>

float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  int i = q.x + q.y * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}
// sprites sample the light a little toward the camera (a camera-facing card has no real normal)
vec3 spriteFireLight(vec3 p, vec3 n) { return emberFireLight(p, n * 0.35); }
// a thin rim registered exactly to the silhouette: only the outermost widthPx screen pixels of the edge
// texels (the ones whose neighbour at this mip level is transparent), on the sides facing dir (sprite u/v axes;
// bias 1 = every side). One texel at the sampled level, never an offset copy. tpW = texels per screen pixel at level 0.
float thinRim(vec2 uv, float lod, vec2 tpW, float widthPx, vec2 dir, float bias) {
  float sc = exp2(lod);
  vec2 ts = sc / uAtlasSize;
  vec2 f = fract(uv * uAtlasSize / sc);
  vec2 ppx = max(tpW / sc, vec2(1e-5));
  float r = 0.0;
  if (textureLod(uAtlas, uv + vec2(ts.x, 0.0), lod).a < 0.5) r = max(r, step((1.0 - f.x) / ppx.x, widthPx) * clamp(dir.x + bias, 0.0, 1.0));
  if (textureLod(uAtlas, uv - vec2(ts.x, 0.0), lod).a < 0.5) r = max(r, step(f.x / ppx.x, widthPx) * clamp(-dir.x + bias, 0.0, 1.0));
  if (textureLod(uAtlas, uv + vec2(0.0, ts.y), lod).a < 0.5) r = max(r, step((1.0 - f.y) / ppx.y, widthPx) * clamp(dir.y + bias, 0.0, 1.0));
  if (textureLod(uAtlas, uv - vec2(0.0, ts.y), lod).a < 0.5) r = max(r, step(f.y / ppx.y, widthPx) * clamp(-dir.y + bias, 0.0, 1.0));
  return r;
}
vec3 fireRamp(float x) {          // 0 crimson → 1 white-yellow (ART-DIRECTION §7 ramp, linear-ish)
  vec3 a = vec3(0.37, 0.016, 0.010), b = vec3(0.81, 0.10, 0.012), c = vec3(1.0, 0.33, 0.027), d = vec3(1.0, 0.64, 0.07), e = vec3(1.0, 0.89, 0.48);
  return x < 0.25 ? mix(a, b, x / 0.25) : x < 0.5 ? mix(b, c, (x - 0.25) / 0.25) : x < 0.75 ? mix(c, d, (x - 0.5) / 0.25) : mix(d, e, (x - 0.75) / 0.25);
}
void main() {
  vec2 tp = vUv * uAtlasSize;
  vec2 dx = dFdx(tp), dy = dFdy(tp);
  float foot = max(length(dx), length(dy));
  float lod = clamp(floor(log2(max(foot, 1e-4)) + uLodBias + 0.5), 0.0, 3.0);
  vec2 tpW = abs(dx) + abs(dy);   // derivatives taken here, in uniform control flow
  vec4 tex = textureLod(uAtlas, vUv, lod);
  if (tex.a < 0.5) discard;
  // dissolve (death fade) and a near-camera fade: a goblin at arm's length dithers out instead of filling the screen
  float nearFade = 1.0 - smoothstep(uNearFade.x, uNearFade.y, distance(vWorld, cameraPosition));
  float diss = max(vB.z, nearFade);
  if (diss > 0.0 && bayer4(gl_FragCoord.xy) < diss) discard;
  float variant = fract(abs(vA.w));
  float cls = floor(abs(vA.w));
  float demonRim = 0.0;
  vec3 rimCol = vec3(1.0, 0.36, 0.07) * 2.2;
  float bossK = 0.0, huntK = 0.0;
  // an elite's gold rim (pipeline goldRim(): 1-px ring outside the dark outline, alpha 0.8) glows, unlit
  // (in melee the rim fades with the near dissolve and turns back into the dark outline within ≈ 4 m, so an elite at
  // contact range is not ringed by 15-px gold bars)
  if (cls > 1.5 && cls < 2.5 && tex.a < 0.9) {
    float rimK = smoothstep(1.6, 4.0, distance(vWorld, cameraPosition)) * (1.0 - diss);
    vec3 gold = vec3(1.0, 0.62, 0.12) * (1.25 + 0.35 * sin(uTime * 5.0 + vWorld.x * 2.0 + vWorld.z));
    gl_FragColor = vec4(mix(vec3(0.016, 0.01, 0.012), gold, rimK), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
    return;
  }
  // the troll's hot-crack layer: its seam pixels (sorted by thickness in the green channel) through crimson → ember →
  // orange, eyes amber; emissive only, never white (red-hot, not pale pink)
  if (vB.w < -0.5) {
    float g = tex.g;
    vec3 crimson = vec3(0.366, 0.018, 0.010), ember = vec3(0.807, 0.102, 0.011), orange = vec3(1.0, 0.323, 0.027), amber = vec3(1.0, 0.52, 0.05);
    vec3 hot = g < 0.45 ? mix(crimson, ember, 0.35) : g < 0.7 ? ember : g < 0.9 ? orange : amber;
    gl_FragColor = vec4(hot * vB.y, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
    return;
  }
  vec3 base = tex.rgb * (1.0 + (vec3(variant, fract(variant * 7.13), fract(variant * 3.71)) - 0.5) * 0.14);
  base = mix(vec3(dot(base, vec3(0.299, 0.587, 0.114))), base, uSat);   // muted night palette (ART-DIRECTION §3.3)
  if (cls > 2.5 && cls < 3.5) {   // a tinted item (the charm): the hue in fract(|flipV|), luma kept
    vec3 hue = clamp(abs(mod(variant * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    base = mix(base, dot(base, vec3(0.3, 0.59, 0.11)) * (0.35 + hue * 1.3), 0.75);
  } else if (cls > 6.5) {
    // class 7 (DESIGN §12.5), the demon revealed: its fire pixels (eyes, furnace mouth, ember cracks, wing flames) glow
    // unlit in their own colour; the silhouette's upper edge (horns, shoulders, wings) takes a hot rim from the portal
    if (tex.r > 0.6 && tex.g > 0.22 && tex.r > tex.b * 2.2) {
      gl_FragColor = vec4(tex.rgb * (2.2 + 0.4 * sin(uTime * 6.0 + vWorld.y * 3.0)), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
      return;
    }
    vec2 ts = exp2(lod) / uAtlasSize;
    float edge = 1.0 - min(min(textureLod(uAtlas, vUv + vec2(ts.x, 0.0), lod).a, textureLod(uAtlas, vUv - vec2(ts.x, 0.0), lod).a),
                           min(textureLod(uAtlas, vUv + vec2(0.0, ts.y), lod).a, textureLod(uAtlas, vUv - vec2(0.0, ts.y), lod).a));
    demonRim = step(0.5, edge) * smoothstep(0.3, 0.7, vLocal.y);
  } else if (cls > 5.5) {
    // class 6 (DESIGN §6.3), the Rainmother: her crown of pale-blue lanterns and her eyes glow unlit, × fract = the share of
    // lanterns still alive (shot out one by one → the glow dims to dark sockets)
    if (tex.b > 0.45 && tex.b > tex.r * 1.4 && tex.g > 0.3) {
      vec3 lamp = vec3(0.45, 0.8, 1.0) * (0.25 + 2.6 * variant * (0.85 + 0.15 * sin(uTime * 7.0 + vWorld.x)));
      gl_FragColor = vec4(lamp, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
      return;
    }
    // a SOLID dark-water body (the art's luma kept as soft relief, no see-through sparkle), the bright foam
    // veins kept as cold detail, and a 2-px cyan rim on every edge so she reads as one huge figure at night
    float lw = dot(tex.rgb, vec3(0.3, 0.59, 0.11));
    base = mix(vec3(0.03, 0.065, 0.11), vec3(0.09, 0.19, 0.29), smoothstep(0.08, 0.55, lw));
    if (lw > 0.62) base = vec3(0.15, 0.3, 0.42);   // the foam veins: cold detail, not a sparkle
    demonRim = thinRim(vUv, lod, tpW, 2.0, vec2(0.0), 1.0);
    rimCol = vec3(0.35, 0.9, 1.0) * 2.0;
    bossK = 1.0;
  } else if (cls > 4.5) {
    // class 5 (DESIGN §12), silhouettes in firelight (the host, the fleeing villagers and animals): the art darkened to a
    // silhouette (the fire light map still lights its front), ember eyes glow unlit
    // emissive flags (crowd.js): > 0.165 the hunt's prey (villagers, animals: no ember test, their reds are not eyes),
    // 0.12–0.165 the hunt's horned chasers, below that the marching host
    bool hunt = vB.y > 0.12, prey = vB.y > 0.165;
    if (!prey && tex.r > 0.5 && tex.r > tex.g * 1.6 && tex.b < tex.r * 0.35) {
      gl_FragColor = vec4(vec3(1.0, 0.38, 0.06) * 2.4, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
      return;
    }
    if (hunt) {
      // a SOLID near-black silhouette (a plain 40 % darkening left the dark bodies invisible and only the light
      // parts, heads and beards, as grey patches) with a ≤ 1.25-px ember rim on the edge texels facing the burning village
      base = vec3(0.03, 0.022, 0.02);
      demonRim = thinRim(vUv, lod, tpW, 1.25, vRimDir, 0.15) * vRimK;   // the fire-facing edge only, near the fire
      rimCol = vec3(1.0, 0.46, 0.12) * 1.2;                      // below the bloom threshold: a line, not a scribble
      huntK = 1.0;
    } else {
      base = mix(vec3(dot(base, vec3(0.3, 0.59, 0.11))), base, 0.5) * mix(0.32, 1.0, variant);   // fract = how much of the art shows
      // the host: each horned figure separates from the mass with a registered red rim on the sides facing the
      // gate's fire behind it (uRimSource = the gate during the host beat; vRimK fades it far from the source)
      demonRim = thinRim(vUv, lod, tpW, 1.25, vRimDir, 0.2) * vRimK;
      rimCol = vec3(1.0, 0.3, 0.07) * 1.5;
    }
  } else if (cls > 3.5) {
    // class 4, the camp characters (without this, Brother Cinder and the Chain Imp read as black silhouettes): ember eyes
    // glow unlit, and the near-black art is lifted into a readable warm hue (fract = hue: umber robe, brick-red imp)
    if (tex.r > 0.5 && tex.r > tex.g * 1.6 && tex.b < tex.r * 0.35) {
      gl_FragColor = vec4(vec3(1.0, 0.42, 0.07) * 2.6, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
      return;
    }
    vec3 hue = clamp(abs(mod(variant * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    base = (dot(base, vec3(0.3, 0.59, 0.11)) * 1.5 + 0.035) * (0.35 + hue * 1.3);
  }
  // light: the night (hemisphere + the moon from the front), the fire light map, and near the camera the fire around the
  // player (FIRELIGHT.nearCamera) as a front fill, so a goblin at arm's length in a burning road has a fire-lit face
  // like M1's; never below uFloor (without it near sprites rendered black)
  float camD = distance(vWorld, cameraPosition);
  float nearW = 1.0 - smoothstep(2.5, 9.0, camD);
  // the fire terms are soft-compressed (hue kept, ≤ ≈ 2.9): next to a burst the light map is so strong that sprites went
  // pale pink-white after tone mapping; M1's goblins in the fire stay saturated orange with dark outlines
  vec3 fire = spriteFireLight(vWorld, vToCam) * uSpriteFireGain + uNearFire * nearW;
  fire /= 1.0 + max(fire.r, max(fire.g, fire.b)) * 0.35;
  vec3 light = max(uAmbient + uMoon + fire, uFloor);
  if (cls > 6.5) light = max(light, vec3(0.7, 0.5, 0.46));   // the demon reads in any grade
  if (bossK > 0.0) light = max(light, vec3(0.55, 0.65, 0.8));
  else if (uBossLight.w > 0.0) light += uBossLightCol * (1.0 - smoothstep(0.0, uBossLight.w, distance(vWorld.xz, uBossLight.xz)));
  vec3 col = base * light;
  if (huntK > 0.0) col = base;   // the hunt's silhouettes stay solid near-black whatever the fire light map says
  float lumB = dot(base, vec3(0.2126, 0.7152, 0.0722));
  float burn = vA.y;
  if (burn > 0.0) {   // a burning goblin: lit from inside by its own flames (the fire ramp, flickering), never darker
    float fl = 0.5 + 0.5 * sin(uTime * 23.0 + variant * 40.0 + vWorld.y * 9.0);
    float h = clamp(0.2 + lumB * 0.8 + 0.15 * fl, 0.0, 0.78);   // crimson → orange, never the white-yellow core
    vec3 hot = fireRamp(h);
    col = mix(col, base * hot * (1.35 + 0.3 * fl) + hot * 0.12, burn * 0.8);
  } else if (burn < 0.0) {   // the troll's heat: the ash hide multiplies toward ember #e85a1c (a dark red-hot body)
    float th = -burn;
    vec3 ember = vec3(0.807, 0.102, 0.011);
    col = mix(col, (lumB * 1.6 + 0.05) * ember * (0.8 + 0.4 * dot(light, vec3(0.33))), th * 0.7);
  }
  if (vB.w > 0.0) {   // a corpse sinking to ash: a dark warm-grey smudge, never a pale grey rug
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, vec3(l * 0.34) * vec3(1.0, 0.88, 0.8), vB.w * 0.85);
  }
  col += base * vB.y;
  col += vec3(0.012, 0.035, 0.06) * bossK;   // her water holds a little cold light of its own
  if (demonRim > 0.0) col = mix(col, rimCol, demonRim);
  if (vA.z > 0.0) col = mix(col, vec3(1.0, 0.97, 0.9) * 1.6, vA.z * 0.85);
  else if (vA.z < 0.0) col = mix(col, vec3(0.95, 0.2, 0.03) * 1.2, -vA.z * 0.6);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // three's fog, with the hunt's silhouettes taking a quarter of it (the ending's thick glow fog washed
  // their dark fills into the village glow while the bright rims survived, the "gold scribble")
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogF = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogF = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogF * (huntK > 0.0 ? 0.25 : 1.0));
  #endif
}`;

/**
 * @param {{ atlas: THREE.Texture, frameTex: THREE.DataTexture, width: number, height: number }} o
 * @returns {THREE.ShaderMaterial}
 */
export function actorSpriteMaterial({ atlas, frameTex, width, height }) {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uAtlas: { value: null }, uFrames: { value: null }, uAtlasSize: { value: new THREE.Vector2(width, height) },
      uLodBias: { value: 0.0 }, uTilt: { value: 0.25 }, uTime: { value: 0 }, uSat: { value: 0.72 }, uNearFade: { value: new THREE.Vector2(0.9, 1.9) },
      uMaxScreenH: { value: 0.5 },   // melee: ≤ 50 % of the frame height (0 = off); actors.setLighting({ maxScreenH })
      // flat night light (ART-DIRECTION §4: moon #9fd3e0, hemisphere fill); the environment/the look may retune via actors.setLighting
      uAmbient: { value: new THREE.Color().setRGB(0.22, 0.33, 0.37) },   // linear
      uMoon: { value: new THREE.Color().setRGB(0.15, 0.24, 0.27) },      // linear
      uSpriteFireGain: { value: 1.0 },
      uNearFire: { value: new THREE.Color(0, 0, 0) },                    // linear; crowd.js copies FIRELIGHT.nearCamera each frame
      uFloor: { value: new THREE.Color().setRGB(0.3, 0.42, 0.46) },      // linear: the least light a sprite gets
      uRimSource: { value: new THREE.Vector3(0, 0, 0) },                 // crowd.js sets the village fire
      uBossLight: { value: new THREE.Vector4(0, 0, 0, 0) },              // crowd.js sets the Rainmother
      uBossLightCol: { value: new THREE.Color().setRGB(0.18, 0.42, 0.75) },
    }]),
    vertexShader: SPRITE_VERT,
    fragmentShader: SPRITE_FRAG.replace('__FIRELIGHT__', FIRELIGHT_GLSL),
    fog: true,
    side: THREE.DoubleSide,
    transparent: false,
  });
  // textures and the shared fire-light uniforms are assigned after merge (merge clones values; these must stay shared)
  m.uniforms.uAtlas.value = atlas;
  m.uniforms.uFrames.value = frameTex;
  m.uniforms.uFireLightMap = FIRELIGHT.uFireLightMap;
  m.uniforms.uFireLightRect = FIRELIGHT.uFireLightRect;
  m.uniforms.uFireLightGain = FIRELIGHT.uFireLightGain;
  m.uniforms.uFireLightReach = FIRELIGHT.uFireLightReach;
  m.uniforms.uFireLightHeight = FIRELIGHT.uFireLightHeight;
  return m;
}

// ------------------------------------------------------------------------------------------------ the troll's telegraphs
const TELEGRAPH_VERT = /* glsl */`
attribute vec4 iC;   // centre x, centre z, radius (m), flat y (< -100: follow the terrain)
attribute vec4 iD;   // kind (0 stomp ring, 1 boulder shadow), progress 0..1, alpha, quad half-size / radius
varying vec2 vL;
varying vec4 vD;
varying float vR;
varying vec3 vW;     // world x, z, and 1 when the decal lies flat on the wall walk
${GROUND_GLSL}
#include <fog_pars_vertex>
void main() {
  vec2 l = position.xy * iC.z * iD.w;
  vec2 xz = iC.xy + l;
  float y = iC.w > -100.0 ? iC.w : ewGround(xz);
  vL = l; vD = iD; vR = iC.z;
  vW = vec3(xz, iC.w > -100.0 ? 1.0 : 0.0);
  vec4 mvPosition = viewMatrix * vec4(xz.x, y + 0.07, xz.y, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const TELEGRAPH_FRAG = /* glsl */`
uniform float uTime;
uniform vec4 uWalk;  // the wall walk's rectangle (x0, z0, x1, z1): a flat decal is clipped to it
varying vec2 vL;
varying vec4 vD;
varying float vR;
varying vec3 vW;
#include <common>
#include <fog_pars_fragment>
float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  int i = q.x + q.y * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}
void main() {
  // a decal that lies flat at the walk's height must not overhang the parapet (it hung in the air over
  // the wall foot and the merlons cut it into 1 m steps): clip it to the walk
  if (vW.z > 0.5 && (vW.x < uWalk.x || vW.x > uWalk.z || vW.y < uWalk.y || vW.y > uWalk.w)) discard;
  const float PX = 0.125;                    // 8 texels per metre: the world's chunky pixel grid
  vec2 cell = floor(vL / PX);
  vec2 q = (cell + 0.5) * PX;
  float d = length(q);
  float R = vR, prog = vD.y;
  float dith = bayer4(cell);
  // the warning colours (muted, not a flat saturated red): a dark ember red rim, a warmer fill edge; the decal is
  // unlit, so it stays below the scene's lit ground in brightness
  vec3 red = vec3(0.62, 0.1, 0.05), hot = vec3(0.8, 0.26, 0.07);
  vec3 col = red; float a = 0.0;
  if (vD.x < 0.5) {
    // stomp: the danger edge at r, and a fill growing from the feet to the edge as the windup runs out
    float fillR = R * prog;
    if (abs(d - R) < 0.16) { a = 0.85; col = red * (0.85 + 0.3 * prog + 0.15 * sin(uTime * 18.0)); }
    else if (prog > 0.02 && abs(d - fillR) < 0.13) { a = 0.7; col = hot * 0.8; }
    else if (d < fillR) { a = dith < 0.22 + 0.25 * prog ? 0.38 : 0.0; col = red * 0.6; }
  } else {
    // boulder: a dithered shadow that shrinks to the impact radius and darkens as the boulder falls; a dashed red rim
    float rS = R * (1.8 - 0.8 * prog);
    if (d < rS) { a = dith < 0.4 + 0.55 * prog ? 0.3 + 0.5 * prog : 0.0; col = vec3(0.02, 0.016, 0.016); }
    float dash = step(0.5, fract(atan(q.y, q.x) * 2.546 + uTime * 0.5));
    if (abs(d - R) < 0.13 && dash > 0.5 && prog > 0.0) { a = 0.85; col = red * 0.95; }
  }
  a *= vD.z;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** @param {{ walk: { x0: number, z0: number, x1: number, z1: number } }} o the wall walk's rectangle (ARENA.keep.walk) */
export function actorTelegraphMaterial({ walk }) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 },
      uWalk: { value: new THREE.Vector4(walk.x0, walk.z0, walk.x1, walk.z1) } }]),
    vertexShader: TELEGRAPH_VERT, fragmentShader: TELEGRAPH_FRAG, fog: true,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

// ------------------------------------------------------------------------------------------------ the boss light
/** The Rainmother's pool of cold light: an additive disc of `radius` metres (the actors' plane has that half-size). */
export function actorBossLightMaterial({ radius: R }) {
  return new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(0.16, 0.45, 0.95) }, uK: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */`varying vec2 vL; void main() { vL = position.xz; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform vec3 uCol; uniform float uK; uniform float uTime; varying vec2 vL;
      void main() {
        float d = length(vL) / ${R.toFixed(1)};
        float a = (1.0 - smoothstep(0.0, 1.0, d)) * (0.75 + 0.25 * sin(uTime * 1.7 + d * 9.0));
        gl_FragColor = vec4(uCol * a * uK, 1.0);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

// ------------------------------------------------------------------------------------------------ the viewmodel's sparks
/** The gloves' smoulder sparks (src/actors/viewmodel.js): `count` 3-px additive points; the actors code writes
 *  `geo.attributes.position / color` (hand-local positions, linear colours) and toggles `pts.visible`. */
export function actorSparkPoints({ count }) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  return { pts, geo };
}
