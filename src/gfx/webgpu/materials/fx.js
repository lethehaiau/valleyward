// VALLEYWARD · the WebGPU edition's custom materials for the FX (TSL twins of src/gfx/webgl2/materials/fx.js;
// decision 0001, docs/WEBGPU-PORT.md). READY = every factory src/fx/ uses exists here: the FX then run in this edition.
//   fxPoolMaterial({ name, map, tiles, blending, depthTest })  the particle pools' instanced quads (src/fx/pool.js)
//   fxWashMaterial()                                          the ending's full-frame additive wash (src/fx/index.js)
// Same control surface as the GLSL: `.uniforms.uMap / uTiles` (pool), `.uniforms.uTop / uBot` (wash) are TSL nodes with
// `.value`; same render state (transparent, blending, depthWrite off, depthTest, DoubleSide, no fog).
import { NodeMaterial, DataTexture, NormalBlending, AdditiveBlending, DoubleSide, Vector3 } from 'three/webgpu';
import {
  Fn, If, Discard, uniform, texture, attribute, varyingProperty, positionGeometry, cameraViewMatrix, cameraProjectionMatrix,
  vec2, vec3, vec4, float, mod, floor, cos, sin, length, max, mix, select, smoothstep,
} from 'three/tsl';

export const READY = true;

/** A 1 × 1 white texture: the pool's map when the atlas could not be made (no canvas). */
let WHITE = null;
const white = () => { if (!WHITE) { WHITE = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); WHITE.needsUpdate = true; } return WHITE; };

// ---------------------------------------------------------------------------------------------- the particle pools
/**
 * One particle pool's material: camera-facing / velocity-stretched / flat quads from the instanced attributes aPos,
 * aSize, aDir, aCol, aTile (src/fx/pool.js), textured from the FX atlas (`tiles` tiles per row). The twin of the GLSL
 * pool shader line by line (the mesh's own matrix is ignored there too: aPos is in world space).
 * @param {{ name?: string, map: any, tiles: number, blending?: number, depthTest?: boolean }} o
 */
export function fxPoolMaterial({ name = 'ew-fx', map, tiles, blending = NormalBlending, depthTest = true }) {
  const uMap = texture(map || white());
  const uTiles = uniform(tiles);
  const vUv = varyingProperty('vec2', 'vUv'), vCol = varyingProperty('vec4', 'vCol'), vQ = varyingProperty('vec2', 'vQ'), vTile = varyingProperty('float', 'vTile');

  const m = new NodeMaterial();
  m.name = name;
  m.transparent = true; m.depthWrite = false; m.depthTest = depthTest; m.blending = blending; m.side = DoubleSide;
  m.fog = false; m.lights = false;

  m.vertexNode = Fn(() => {
    const aPos = attribute('aPos', 'vec3'), aSize = attribute('aSize', 'vec2'), aDir = attribute('aDir', 'vec3');
    const aCol = attribute('aCol', 'vec4'), aTile = attribute('aTile', 'vec4');
    const q = positionGeometry.xy.toVar();
    const head = cameraViewMatrix.mul(vec4(aPos, 1.0)).toVar();   // (mvc in the GLSL; also the billboard's and the streak's head)
    const uvq = q.add(0.5);
    const tile = aTile.x, mode = aTile.y, rot = aTile.z;
    const txy = vec2(mod(tile, uTiles), floor(tile.div(uTiles)));
    vUv.assign(vec2(txy.x.add(uvq.x).div(uTiles), float(1.0).sub(txy.y.add(1.0).sub(uvq.y).div(uTiles))));
    vQ.assign(q); vTile.assign(tile);
    const c = cos(rot), s = sin(rot);
    const r = vec2(c.mul(q.x).sub(s.mul(q.y)), s.mul(q.x).add(c.mul(q.y))).toVar();
    const mv = vec4(0.0).toVar();
    If(mode.lessThan(0.5), () => {                        // billboard (+ a glyph offset in size units)
      mv.assign(vec4(head.xy.add(r.add(vec2(aTile.w, 0.0)).mul(aSize.x)), head.zw));
    }).ElseIf(mode.lessThan(1.5), () => {                 // stretched from the head back along -aDir
      const b = cameraViewMatrix.mul(vec4(aPos.sub(aDir.mul(aSize.y)), 1.0)).toVar();
      const ax = head.xy.sub(b.xy).toVar();
      const l = length(ax).toVar();
      ax.assign(select(l.greaterThan(1e-4), ax.div(max(l, 1e-4)), vec2(0.0, 1.0)));
      const pp = vec2(ax.y.negate(), ax.x);
      const m0 = mix(b, head, uvq.y).toVar();
      mv.assign(vec4(m0.xy.add(pp.mul(q.x).mul(aSize.x)), m0.zw));
    }).Else(() => {                                       // flat on the ground (rings, decals)
      mv.assign(cameraViewMatrix.mul(vec4(aPos.add(vec3(r.x, 0.0, r.y).mul(aSize.x)), 1.0)));
    });
    // particles that reach the lens fade instead of filling the screen
    vCol.assign(vec4(aCol.rgb, aCol.a.mul(smoothstep(0.12, 0.42, head.z.negate()))));
    return cameraProjectionMatrix.mul(mv);
  })();

  m.fragmentNode = Fn(() => {
    const t = uMap.sample(vUv).toVar();
    // tile 6 (puff: smoke, dust, ash) is a procedural soft round alpha instead of the 16 px texel blob
    If(vTile.greaterThan(5.5).and(vTile.lessThan(6.5)), () => {
      const r = length(vQ).mul(2.0);
      t.assign(vec4(1.0, 1.0, 1.0, float(1.0).sub(smoothstep(0.25, 1.0, r)).mul(float(1.0).sub(r.mul(0.18)))));
    });
    const a = t.a.mul(vCol.a).toVar();
    Discard(a.lessThan(0.02));
    return vec4(vCol.rgb.mul(t.rgb), a);
  })();

  /** the FX's control surface (same names as the GLSL uniforms) */
  m.uniforms = { uMap, uTiles };
  return m;
}

// ---------------------------------------------------------------------------------------------- the ending's wash
/** The ending's full-frame additive wash; `.uniforms.uTop / uBot` (THREE.Vector3, linear RGB). */
export function fxWashMaterial() {
  const uTop = uniform(new Vector3()), uBot = uniform(new Vector3());
  const vY = varyingProperty('float', 'vY');
  const m = new NodeMaterial();
  m.name = 'ew-fx-ending-wash';
  m.transparent = true; m.depthTest = false; m.depthWrite = false; m.blending = AdditiveBlending;
  m.fog = false; m.lights = false;
  // a PlaneGeometry(2, 2) drawn straight in clip space: vY 0 at the bottom of the frame, 1 at the top
  m.vertexNode = Fn(() => {
    vY.assign(positionGeometry.y.mul(0.5).add(0.5));
    return vec4(positionGeometry.xy, 0.0, 1.0);
  })();
  m.fragmentNode = Fn(() => vec4(mix(uBot, uTop, vY.mul(vY)), 1.0))();
  m.uniforms = { uTop, uBot };
  return m;
}
