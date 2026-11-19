// VALLEYWARD · the WebGL2 edition's custom materials for the FX (GLSL, moved verbatim from src/fx/; decision 0001,
// docs/WEBGPU-PORT.md). Each factory has a TSL twin of the same name in src/gfx/webgpu/materials/fx.js.
//   fxPoolMaterial({ name, map, tiles, blending, depthTest })  the particle pools' instanced quads (src/fx/pool.js)
//   fxWashMaterial()                                          the ending's full-frame additive wash (src/fx/index.js)
// src/fx/ animates `.uniforms.<name>.value` only: uMap, uTiles (pool); uTop, uBot (wash).
import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------- the particle pools
// (moved from src/fx/pool.js)
const VERT = /* glsl */`
attribute vec3 aPos; attribute vec2 aSize; attribute vec3 aDir; attribute vec4 aCol; attribute vec4 aTile;
uniform float uTiles;
varying vec2 vUv; varying vec4 vCol; varying vec2 vQ; varying float vTile;
void main(){
  vec2 q = position.xy;
  vec4 mvc = viewMatrix * vec4(aPos, 1.0);
  vec2 uv = q + 0.5;
  float tile = aTile.x, mode = aTile.y, rot = aTile.z;
  vec2 txy = vec2(mod(tile, uTiles), floor(tile / uTiles));
  vUv = vec2((txy.x + uv.x) / uTiles, 1.0 - (txy.y + 1.0 - uv.y) / uTiles);
  vCol = aCol; vQ = q; vTile = tile;
  float c = cos(rot), s = sin(rot);
  vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  vec4 mv;
  if (mode < 0.5) {                       // billboard (+ a glyph offset in size units)
    mv = viewMatrix * vec4(aPos, 1.0);
    mv.xy += (r + vec2(aTile.w, 0.0)) * aSize.x;
  } else if (mode < 1.5) {                // stretched from the head back along -aDir
    vec4 a = viewMatrix * vec4(aPos, 1.0);
    vec4 b = viewMatrix * vec4(aPos - aDir * aSize.y, 1.0);
    vec2 ax = a.xy - b.xy;
    float l = length(ax);
    ax = l > 1e-4 ? ax / l : vec2(0.0, 1.0);
    vec2 pp = vec2(-ax.y, ax.x);
    mv = mix(b, a, uv.y);
    mv.xy += pp * q.x * aSize.x;
  } else {                                // flat on the ground (rings, decals)
    mv = viewMatrix * vec4(aPos + vec3(r.x, 0.0, r.y) * aSize.x, 1.0);
  }
  vCol.a *= smoothstep(0.12, 0.42, -mvc.z); // particles that reach the lens fade instead of filling the screen
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv; varying vec4 vCol; varying vec2 vQ; varying float vTile;
void main(){
  vec4 t = texture2D(uMap, vUv);
  // tile 6 (puff: smoke, dust, ash) is a procedural soft round alpha instead of the 16 px texel blob: magnified near the
  // lens, the blob's texels and its dithered rim drew as hard rotated squares in the sky
  if (vTile > 5.5 && vTile < 6.5) { float r = length(vQ) * 2.0; t = vec4(1.0, 1.0, 1.0, (1.0 - smoothstep(0.25, 1.0, r)) * (1.0 - 0.18 * r)); }
  float a = t.a * vCol.a;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vCol.rgb * t.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * One particle pool's material: camera-facing / velocity-stretched / flat quads from the instanced attributes aPos,
 * aSize, aDir, aCol, aTile (src/fx/pool.js), textured from the FX atlas (`tiles` tiles per row).
 * @param {{ name?: string, map: THREE.Texture | null, tiles: number, blending?: THREE.Blending, depthTest?: boolean }} o
 */
export function fxPoolMaterial({ name = 'ew-fx', map, tiles, blending = THREE.NormalBlending, depthTest = true }) {
  return new THREE.ShaderMaterial({
    name, vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { uMap: { value: map }, uTiles: { value: tiles } },
    transparent: true, depthWrite: false, depthTest, blending, side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------------------------- the ending's wash
// (moved from src/fx/index.js) a full-frame quad (PlaneGeometry 2 × 2, drawn in clip space): uBot at the bottom → uTop at
// the top (on vY²), added to the frame
/** The ending's full-frame additive wash; `.uniforms.uTop / uBot` (THREE.Vector3, linear RGB). */
export function fxWashMaterial() {
  const washU = { uTop: { value: new THREE.Vector3() }, uBot: { value: new THREE.Vector3() } };
  return new THREE.ShaderMaterial({
    uniforms: washU, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: 'varying float vY; void main(){ vY = position.y * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform vec3 uTop; uniform vec3 uBot; varying float vY; void main(){ gl_FragColor = vec4(mix(uBot, uTop, vY * vY), 1.0);\n#include <colorspace_fragment>\n}',
  });
}
