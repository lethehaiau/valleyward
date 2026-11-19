// VALLEYWARD · actors · the one sprite shader: instanced, camera-facing (cylindrical, with an optional small tilt toward
// the camera so sprites seen from the wall walk do not flatten), alpha-tested and depth-writing (the fire volume sits
// right), flat moonlight from the front + the shared fire light map (src/shared/firelight.js uniforms, the same objects
// the fire code writes), a fire tint ramp for burning sprites, a hit flash, an ordered-dither dissolve, scene fog, and an explicit
// mip level from the texel footprint so far sprites stay crisp without shimmer (nearest texels on the mip level whose
// texel is about one screen pixel; the atlas has 8-px gutters, clean down to level 3).
//
// Per-instance attributes (vec4 each):
//   iPos = (x, y, z, scale)            world feet position, uniform scale (< 0: exempt from the screen-height cap: the
//                                      troll, the Chain Imp towers)
//   iA   = (frame, burn, flash, flipV) frame index into the frame table; burn 0..1 fire tint (< 0: the troll's heat,
//                                      a red-hot multiply); flash 0..1 white hit flash (< 0: an ember-orange flash);
//                                      sign(flipV) mirrors the sprite, fract(|flipV|) is a per-instance tint variant;
//                                      floor(|flipV|) is the class: 1 plain, 2 ELITE (its gold-rim texels, alpha 204 in
//                                      the atlas, glow gold), 3 TINTED (fract = the hue: one charm sprite, 9 colours)
//   iB   = (rot, emissive, dissolve, char) rotation in the billboard plane (rad, about the pivot); self-light 0..2;
//                                      dissolve 0..1 (dithered); char 0..1 charred to ash grey (−1: the troll's hot-crack
//                                      layer, its pixels drawn through the crimson → orange ramp × emissive)
//
// The shader itself is per edition (decision 0001, docs/WEBGPU-PORT.md): `actorSpriteMaterial` in
// src/gfx/webgl2/materials/actors.js (GLSL) and src/gfx/webgpu/materials/actors.js (TSL), with the same uniform names.
// The geometry below is shared.
import * as THREE from 'three';
import { gfx } from '../gfx/current.js';

/**
 * @param {{ atlas: THREE.Texture, frameTex: THREE.DataTexture, width: number, height: number }} o
 * @returns {THREE.Material & { uniforms: Record<string, { value: any }> }}
 */
export function createSpriteMaterial(o) {
  return gfx().materials.actorSpriteMaterial(o);
}

/** A unit quad (corners 0..1 in x/y) as an InstancedBufferGeometry with the three instance attributes. */
export function createSpriteGeometry(maxInstances) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const mk = () => new THREE.InstancedBufferAttribute(new Float32Array(maxInstances * 4), 4).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iPos', mk());
  g.setAttribute('iA', mk());
  g.setAttribute('iB', mk());
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}
