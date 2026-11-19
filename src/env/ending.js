// @ts-check
// Environment (DESIGN §12): the ending's sky and fire, three draws that sleep until the ending.
//   portal  a ring of fire torn in the sky above the keep (north of it, facing the plaza and the valley) with a swirling
//           vortex of fire inside: one shader disc, pixel-quantised, HDR so the bloom floods it. `open` 0..1 tears it
//           wider. (a fire module may supply a live vortex later; the disc keeps working without it.)
//   pillar  the lamp's flame turned black-red and swollen into a pillar of fire from the basket toward the portal: a
//           cylindrical billboard with a scrolling flame shader (black core, crimson body, ember edges).
//   embers  the world change's embers falling like snow round the camera: one Points draw, wrapped in a box.
import * as THREE from 'three';
import { ARENA } from '../shared/arena.js';
import { gfx } from '../gfx/current.js';

/** Where the portal opens: high above the keep's courtyard, tilted to face the plaza and the valley below. */
export const PORTAL = Object.freeze({ x: 0, y: 52, z: -26, radius: 24, tilt: 0.42 });

export function createEnding(quality = 'high') {
  const group = new THREE.Group(); group.name = 'ending';
  const uniforms = { uTime: { value: 0 }, uOpen: { value: 0 }, uLamp: { value: 0 }, uWorld: { value: 0 }, uPx: { value: 900 } };

  // ---------------------------------------------------------------- the portal
  const portalMat = gfx().materials.envPortalMaterial(uniforms);   // per edition (decision 0001); transparent, double-sided
  const portal = new THREE.Mesh(new THREE.CircleGeometry(1, 48), portalMat);
  portal.scale.setScalar(PORTAL.radius);
  portal.position.set(PORTAL.x, PORTAL.y, PORTAL.z);
  portal.rotation.x = PORTAL.tilt;           // faces south and a little down: the plaza, the wall walk and the valley
  portal.frustumCulled = false; portal.renderOrder = -500; portal.name = 'portal'; portal.visible = false;
  group.add(portal);

  // ---------------------------------------------------------------- the pillar of black-red fire from the lamp
  const B = ARENA.beacon.basket;
  const pillarMat = gfx().materials.envPillarMaterial(uniforms);   // per edition (decision 0001); transparent
  const pillar = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1).translate(0.5, 0.5, 0), pillarMat);
  pillar.position.set(B.x, B.y + 0.1, B.z);
  pillar.frustumCulled = false; pillar.renderOrder = 4; pillar.name = 'lamp-pillar'; pillar.visible = false;
  group.add(pillar);

  // ---------------------------------------------------------------- hellfire inside the open gate
  // When the gate swings open (the host beat) the passage behind it is full of red-orange fire light: a glowing card at
  // the back of the passage, so the horned host marching out reads as silhouettes against it.
  const hgU = { uTime: uniforms.uTime, uGate: { value: 0 } };
  const G = ARENA.gate;
  const hellMat = gfx().materials.envHellGateMaterial(hgU);   // per edition (decision 0001); opaque
  const hellgate = new THREE.Mesh(new THREE.PlaneGeometry(G.x1 - G.x0 - 0.1, G.height - 0.1), hellMat);
  hellgate.position.set((G.x0 + G.x1) / 2, (G.height - 0.1) / 2, -ARENA.keep.wallThick + 0.2);
  hellgate.name = 'hell-gate'; hellgate.visible = false;
  group.add(hellgate);

  // ---------------------------------------------------------------- embers falling like snow (the world change)
  const N = quality === 'low' ? 900 : 2400;
  const seed = new Float32Array(N * 4);
  for (let i = 0; i < N * 4; i++) seed[i] = Math.random();
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
  eg.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
  const emberU = { ...uniforms, uCam: { value: new THREE.Vector3() } };
  const emberMat = gfx().materials.envEmberMaterial(emberU);   // per edition (decision 0001); additive points
  const embers = gfx().materials.envPoints(eg, emberMat);
  embers.frustumCulled = false; embers.renderOrder = 6; embers.name = 'ending-embers'; embers.visible = false;
  group.add(embers);

  return {
    group, uniforms, portal, pillar, embers, hellgate,
    /**
     * @param {number} t @param {{ portal: number, lamp: number, world: number, gate?: number }} k @param {THREE.Camera} camera @param {number} px
     */
    update(t, k, camera, px) {
      uniforms.uTime.value = t; uniforms.uOpen.value = k.portal; uniforms.uLamp.value = k.lamp; uniforms.uWorld.value = k.world;
      uniforms.uPx.value = px;
      emberU.uCam.value.setFromMatrixPosition(camera.matrixWorld);
      portal.visible = k.portal > 0.002; pillar.visible = k.lamp > 0.01; embers.visible = k.world > 0.01;
      hgU.uGate.value = Math.min(1, (k.gate ?? 0) * 1.6) * Math.max(k.world, k.portal);
      hellgate.visible = hgU.uGate.value > 0.01;
    },
  };
}
