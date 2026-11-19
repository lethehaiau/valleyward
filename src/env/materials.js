// @ts-check
// Environment · the material family (docs/ART-DIRECTION.md §5): Lambert + pixel tile + vertex colour, a one-texel pixel
// bevel on cut blocks (light top-left edge, dark bottom-right edge: the cube-cut look of the mockups), the burnt-trough
// soot term, and the shared fire light (src/shared/firelight.js) patched into every lit material.
import * as THREE from 'three';
import { gfx } from '../gfx/current.js';

/** Burn level (0..1) of the three troughs, read by the stone material through aTag (1..3). */
export const BURN = { uBurn: { value: new THREE.Vector3(0, 0, 0) } };
/** Extra fire light on vertical stone (walls, towers, merlons): the shared light map sampled
 *  further out along the normal with a gentle height falloff, so a burning trough or a road fire warms the whole wall
 *  beside it, as in M1. Reads the shared fire-light uniforms only (never writes them). */
export const WALLFIRE = { uWallFire: { value: 1.6 }, uWallReach: { value: 2.4 }, uWallHeight: { value: 8.0 } };

/**
 * @param {{ map?: THREE.Texture|null, color?: THREE.ColorRepresentation, bevel?: boolean, burn?: boolean, texelsPerM?: number,
 *   alphaTest?: number, side?: THREE.Side, emissive?: THREE.ColorRepresentation, fire?: boolean, wallFire?: boolean,
 *   lightTint?: THREE.Color }} o
 * `lightTint` (DESIGN §11.5): a tint on the moon / sky / brazier light only (multiplied into the outgoing light
 * before the fire light is added), instead of on the albedo, so the fire light, violet / blue / green included, lands
 * on the stone in its own hue (the old `color: stoneTint` warmed every fire light ×1.2 red / ×0.8 blue).
 */
export function lambert(o = {}) {
  const m = new THREE.MeshLambertMaterial({
    map: o.map || null, color: o.color ?? 0xffffff, vertexColors: true,
    alphaTest: o.alphaTest ?? 0, side: o.side ?? THREE.FrontSide,
  });
  if (o.emissive) m.emissive = new THREE.Color(o.emissive);
  let lightTint = null;
  if (o.lightTint) {
    // keep the albedo's brightness (its luminance moves into the colour, neutral) and only the chroma into the light tint:
    // moonlit stone is unchanged, and a fire light lands as bright as before but in its own hue
    const T = o.lightTint, L = 0.2126 * T.r + 0.7152 * T.g + 0.0722 * T.b;
    m.color.setRGB(L, L, L);
    lightTint = { value: new THREE.Color(1, 1, 1) };
    lightTint.value.setRGB(T.r / L, T.g / L, T.b / L);
  }
  // the bevel, the soot, the wall fire and the light tint are per edition (decision 0001): src/gfx/{webgl2,webgpu}/materials/env.js
  gfx().materials.envPatchLambert(m, { bevel: !!o.bevel, burn: !!o.burn, wallFire: !!(o.wallFire && o.fire !== false),
    texelsPerM: o.texelsPerM, lightTint, BURN, WALLFIRE });
  if (o.fire !== false) gfx().patchFireLight(m);
  return m;
}

// ------------------------------------------------------------------------------------------------ DESIGN §8: weather + the ending
/** Shared uniforms for rain and the ending's world change (one write updates every patched material). */
export const ENVFX = {
  uWet: { value: 0 },                                   // 0 dry .. 1 soaked (rain)
  uWetSky: { value: new THREE.Color(0.06, 0.09, 0.12) }, // what a wet surface mirrors (the sky near the horizon, linear)
  uAsh: { value: 0 },                                   // the world change: grass to ash, pines to black spikes
  uLava: { value: 0 },                                  // lava cracks open across the slope (0..1)
  uFxTime: { value: 0 },
};
/**
 * DESIGN §8: rain sheen and the ending's world change on an env material (chained after patchFireLight, which declares
 * vFireWorldPos / vFireWorldNormal). kind: 'ground' (wet + ash on the grass + lava cracks), 'stone' (wet), 'pine'
 * (burnt black with ember specks), 'tuft' (ash), 'wood' (wet, a little ash).
 * @template {THREE.Material} M @param {M} material @param {'ground'|'stone'|'pine'|'tuft'|'wood'} kind @returns {M}
 */
export function patchEnvFx(material, kind) {
  const m = /** @type {any} */ (material);
  if (m.userData.__envfx) return material;
  m.userData.__envfx = kind;
  return gfx().materials.envPatchFx(material, kind, ENVFX);   // per edition (decision 0001)
}
