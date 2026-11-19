// @ts-check
// The environment's entry (docs/DESIGN.md §14.3): Valleyward Keep on its hilltop: terrain + road, the keep (cube-cut blocks, merged
// by material), the gate with damage states from state.gate.hp, the timber stair, the oil troughs (level from
// state.troughs, soot after fire), oil barrels (burst on EV.BARREL_BURST), braziers + the beacon (pixel flames + warm
// point lights, the beacon flares on EV.KINDLE), fences, palisades, pines, valley fog, the sky (moon, stars, mountains)
// and the dawn (setDawn). Layout: src/shared/arena.js. Every lit material carries the shared fire light.
//
// Light budget (constant, never toggled): 1 moon DirectionalLight (2048 shadow map on high, tight frustum that follows
// the camera) + 1 HemisphereLight + 5 PointLights (4 braziers + the beacon). Nothing here adds or removes a light later.
import * as THREE from 'three';
import { ARENA } from '../shared/arena.js';
import { EV } from '../shared/events.js';
import { FIRELIGHT } from '../shared/firelight.js';
import { gfx } from '../gfx/current.js';
import { loadTextures, makeFlameAtlas, makeTuftTexture, makeFogNoise } from './textures.js';
import { lambert, BURN } from './materials.js';
import { createTerrain } from './terrain.js';
import { buildKeep } from './keep.js';
import { buildProps } from './props.js';
import { buildPines, buildValleyFog } from './nature.js';
import { createSky, MOON_DIR, SKY_COLORS } from './sky.js';
import { createGate } from './gate.js';
import { buildBeaconFx } from './beaconfx.js';
import { buildFarHorde } from './farhorde.js';
import { buildStall, buildBanners, createPads } from './camp.js';
import { createHornedShadow } from './hints.js';
import { DUSK_SUN_DIR } from './sky.js';
import { MOOD } from '../look/mood.js';
import { ENVFX, patchEnvFx } from './materials.js';
import { makeLook, nightLook, lerpLook, WORLD_LOOK } from './nights.js';
import { createRain } from './weather.js';
import { buildVillage, createVillageGlow, VILLAGE } from './village.js';
import { createEnding, PORTAL } from './ending.js';
import { TIMELINE } from '../shared/timeline.js';

export { MOON_DIR };

const SHADOW = { high: 2048, medium: 2048, low: 1024 };
const _dm = new THREE.Matrix4(), _dq = new THREE.Quaternion(), _ds = new THREE.Vector3();
export const NIGHT = {
  fog: new THREE.Color('#2b5064'), fogDensity: 0.0068,
  moon: new THREE.Color('#9fd3e0'), moonI: 7.0,
  // a fuller, less saturated fill so the stone reads slate, not cobalt, and the mid-tones lift
  hemiSky: new THREE.Color().setRGB(0.64, 0.8, 0.9), hemiGround: new THREE.Color().setRGB(0.3, 0.32, 0.31), hemiI: 3.9,
  // the braziers light their stretch of wall (M1: the wall beside the fire is warm and bright)
  // colours in linear RGB = the fluid's fire-light colour (FIRE_LIGHT_COLOR): '#ff8a3a' (linear 1, 0.25, 0.04) mixed
  // with the teal night into mauve on the stone; this one mixes into M1's orange-brown
  brazier: new THREE.Color().setRGB(1, 0.42, 0.13), brazierI: 55, brazierRange: 17, brazierDecay: 1.4,
  beacon: new THREE.Color().setRGB(1, 0.45, 0.14), beaconI: 60,
  /** The slate stone's tint: neutralises the teal light on the cool tile, so unlit stone sits at ≈ #3a4652–#4a5560. */
  stoneTint: new THREE.Color().setRGB(1.42, 1.14, 0.95),
};
/** Night II (DESIGN §8.1): the moonlight turns rose-grey under the blood moon, fog and fill a little warmer and darker. */
const NIGHT2 = {
  fog: new THREE.Color('#2f3d54'), fogDensity: 0.0071, moon: new THREE.Color('#a9a8c6'), moonI: 6.9,
  hemiSky: new THREE.Color().setRGB(0.68, 0.66, 0.84), hemiGround: new THREE.Color().setRGB(0.31, 0.29, 0.31), hemiI: 3.9,
  valley: new THREE.Color('#5b5c7a'),
};
/** The camp at dusk (DESIGN §9.2): a low amber sun from ARENA.camp.sunDir, long shadows, a lavender sky fill. */
export const DUSK = {
  fog: new THREE.Color('#6a6472'), fogDensity: 0.0046, sun: new THREE.Color('#ffbf8e'), sunI: 5.6, shadow: 0.82,
  hemiSky: new THREE.Color().setRGB(0.62, 0.66, 0.84), hemiGround: new THREE.Color().setRGB(0.38, 0.32, 0.29), hemiI: 3.1,
  valley: new THREE.Color('#8d8089'), brazier: 0.55, beacon: 0.25, beaconFlame: 0.45,
};
const DAWN = {
  fog: new THREE.Color('#9fb0b0'), sun: new THREE.Color('#ffc996'), sunI: 6.5,
  hemiSky: new THREE.Color().setRGB(0.8, 0.9, 1.0), hemiGround: new THREE.Color().setRGB(0.45, 0.4, 0.35), hemiI: 3.2,
};

/**
 * @param {{ renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, quality?: 'high'|'medium'|'low', assetsBase?: string }} o
 */
export async function createEnvironment({ renderer, scene, camera, quality = 'high', assetsBase = './assets/' }) {
  const t0 = performance.now();
  const root = new THREE.Group(); root.name = 'env'; scene.add(root);
  const tex = await loadTextures(assetsBase, renderer);

  scene.fog = new THREE.FogExp2(NIGHT.fog.clone(), NIGHT.fogDensity);
  scene.background = null;

  // ---------------------------------------------------------------- materials (one family)
  const mats = {
    stone: lambert({ map: tex.stone, bevel: true, burn: true, wallFire: true, lightTint: NIGHT.stoneTint }),
    flag: lambert({ map: tex.flag, bevel: true, lightTint: NIGHT.stoneTint }),
    timber: lambert({ map: tex.timber, bevel: true, color: new THREE.Color(0.7, 0.75, 0.86) }),   // cooler (the fences read red)
    roof: lambert({ map: tex.roof }),
    iron: lambert({ map: tex.iron, texelsPerM: 16 }),
    palisade: lambert({ map: tex.timber, color: new THREE.Color(0.66, 0.71, 0.82) }),
    barrel: lambert({ map: tex.timber, color: new THREE.Color(0.8, 0.8, 0.86) }),
    rock: lambert({ map: tex.stone, lightTint: NIGHT.stoneTint }),
    pine: lambert({ map: tex.pine }),
    tuft: lambert({ map: makeTuftTexture(), alphaTest: 0.5, side: THREE.DoubleSide }),
    voids: new THREE.MeshBasicMaterial({ color: '#0a1014', fog: true }),
    coals: new THREE.MeshBasicMaterial({ color: new THREE.Color(5.5, 1.6, 0.5), vertexColors: true, fog: true }),
  };
  // DESIGN §8: rain sheen and the ending's world change on every lit env material (ENVFX uniforms, src/env/materials.js)
  for (const [k, kind] of /** @type {const} */ ([['stone', 'stone'], ['flag', 'stone'], ['rock', 'stone'], ['iron', 'stone'], ['timber', 'wood'],
    ['roof', 'wood'], ['palisade', 'wood'], ['barrel', 'wood'], ['pine', 'pine'], ['tuft', 'tuft']])) patchEnvFx(mats[k], kind);
  // InstancedMesh materials need the per-instance aBlk/aTag defaults: give the instanced geometries zero attributes
  const ensureAttrs = (/** @type {THREE.BufferGeometry} */ g) => {
    const n = g.attributes.position.count;
    if (!g.attributes.aBlk) g.setAttribute('aBlk', new THREE.Float32BufferAttribute(new Float32Array(n * 4), 4));
    if (!g.attributes.aTag) g.setAttribute('aTag', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
    if (!g.attributes.color) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  };

  // ---------------------------------------------------------------- ground
  const terrain = createTerrain(tex, quality);
  patchEnvFx(/** @type {THREE.Material} */ (terrain.material), 'ground');
  root.add(terrain);

  // ---------------------------------------------------------------- the keep + props (merged by material)
  const K = buildKeep(11);
  const flameTex = makeFlameAtlas();
  // DESIGN §9: Brother Cinder's stall and the goblins' dropped banners (timber / iron / stone merge with the keep)
  const R2 = (() => { let a = 977; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const stall = buildStall(K, R2);
  const banners = buildBanners(K, R2);
  // DESIGN §8: the goblins' village in the valley (its fires are light-less flame instances, asleep until the hunt)
  const village = buildVillage(K);
  const vFireScale = village.fires.map((f) => f.s);
  const props = buildProps(K, mats, tex, flameTex, null, quality, {
    flames: [...stall.flames, ...village.fires.map((f) => ({ ...f, s: 0 }))], glows: [...stall.glows, ...village.glows] });
  const vFireFirst = props.extraFlames.first + stall.flames.length;
  for (const im of [props.barrels, props.hoops, props.debris, props.tufts, props.rocks]) ensureAttrs(im.geometry);
  root.add(props.group);
  /** @type {THREE.Mesh[]} */
  const statics = [];
  for (const [name, B, mat, shadow] of /** @type {const} */ ([
    ['stone', K.stone, mats.stone, true], ['flag', K.flag, mats.flag, true], ['timber', K.timber, mats.timber, true],
    ['roof', K.roof, mats.roof, true], ['iron', K.iron, mats.iron, true], ['voids', K.voids, mats.voids, false],
    ['palisade', K.palisade, mats.palisade, true],
  ])) {
    if (!B.count) continue;
    const mesh = new THREE.Mesh(B.build(), mat);
    mesh.name = `keep-${name}`;
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    root.add(mesh); statics.push(mesh);
  }

  // ---------------------------------------------------------------- DESIGN §9: the stall's awning, the banners, the pads, the shadow
  mats.cloth = lambert({ map: tex.cloth, color: new THREE.Color(0.95, 0.95, 0.95) });
  mats.banner = lambert({ map: tex.banner, alphaTest: 0.5, side: THREE.DoubleSide });
  const clothMesh = new THREE.Mesh(stall.cloth.build(), mats.cloth);
  clothMesh.name = 'camp-awning'; clothMesh.castShadow = true; clothMesh.receiveShadow = true; clothMesh.matrixAutoUpdate = false;
  const bannerMesh = new THREE.Mesh(banners.cloth.build(), mats.banner);
  bannerMesh.name = 'banners'; bannerMesh.receiveShadow = true; bannerMesh.matrixAutoUpdate = false;
  root.add(clothMesh, bannerMesh); statics.push(clothMesh, bannerMesh);
  mats.mud = patchEnvFx(lambert({ map: tex.mud }), 'wood');
  mats.thatch = patchEnvFx(lambert({ map: tex.thatch }), 'wood');
  const villageMeshes = [[village.mud, mats.mud, 'village-walls'], [village.thatch, mats.thatch, 'village-roofs']].map(([B, mat, name]) => {
    const mesh = new THREE.Mesh(/** @type {any} */ (B).build(), /** @type {THREE.Material} */ (mat));
    mesh.name = /** @type {string} */ (name); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    root.add(mesh); statics.push(mesh); return mesh;
  });
  const villageGlow = createVillageGlow();
  root.add(villageGlow.mesh);
  const pads = createPads();
  root.add(pads.mesh);
  const horned = createHornedShadow();
  root.add(horned.mesh);

  // ---------------------------------------------------------------- the gate (instanced planks, damage states)
  const gate = createGate(mats, ensureAttrs);
  root.add(gate.group);

  // ---------------------------------------------------------------- oil surfaces
  const oilMats = [], oilMeshes = [];
  for (const r of K.oilRects) {
    const m = new THREE.MeshStandardMaterial({ color: '#141210', roughness: 0.28, metalness: 0.0 });
    gfx().patchFireLight(m);
    const g = new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0); g.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set((r.x0 + r.x1) / 2, r.y1, (r.z0 + r.z1) / 2);
    mesh.receiveShadow = true;
    mesh.name = `oil-${r.id}`;
    root.add(mesh); oilMats.push(m); oilMeshes.push({ mesh, rect: r, level: 1, burn: 0, lit: false });
  }

  // ---------------------------------------------------------------- pines + valley fog
  const pines = buildPines(mats.pine, quality);
  root.add(pines);
  const fogNoise = makeFogNoise();
  const valleyFog = buildValleyFog(fogNoise, /** @type {THREE.FogExp2} */ (scene.fog));
  root.add(valleyFog);

  // ---------------------------------------------------------------- sky
  const sky = createSky();
  root.add(sky.mesh);
  // DESIGN §8: rain (streaks, splashes, lightning) and the ending (portal, the lamp's pillar, falling embers)
  const rainFx = createRain(quality);
  root.add(rainFx.group);
  const ending = createEnding(quality);
  root.add(ending.group);

  // ---------------------------------------------------------------- the far horde in the valley fog
  const farHorde = buildFarHorde(/** @type {THREE.FogExp2} */ (scene.fog), quality);
  root.add(farHorde.points);
  // ---------------------------------------------------------------- the beacon's flare glow + sparks
  const beaconFlame = props.flames[props.flames.length - 1];
  const beaconFx = buildBeaconFx(beaconFlame);
  root.add(beaconFx.group);

  // ---------------------------------------------------------------- lights (constant set)
  const moon = new THREE.DirectionalLight(NIGHT.moon.clone(), NIGHT.moonI);
  moon.name = 'moon';
  moon.castShadow = true;
  const sm = SHADOW[quality] || 2048;
  moon.shadow.mapSize.set(sm, sm);
  const SH = 30;
  Object.assign(moon.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 160 });
  moon.shadow.camera.updateProjectionMatrix();
  moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.035; moon.shadow.radius = 2.5;
  moon.shadow.intensity = 0.65;
  root.add(moon, moon.target);
  const hemi = new THREE.HemisphereLight(NIGHT.hemiSky.clone(), NIGHT.hemiGround.clone(), NIGHT.hemiI);
  hemi.name = 'hemi';
  root.add(hemi);
  /** @type {THREE.PointLight[]} */
  const points = [];
  props.flames.forEach((f, i) => {
    const beacon = i === props.flames.length - 1;
    const L = new THREE.PointLight(beacon ? NIGHT.beacon : NIGHT.brazier, beacon ? NIGHT.beaconI : NIGHT.brazierI,
      beacon ? 60 : NIGHT.brazierRange, beacon ? 2 : NIGHT.brazierDecay);
    // a brazier's light sits above its flame and a little off the wall, so it washes its stretch of wall evenly
    L.position.set(f.x, f.y + (beacon ? 1.2 : 1.1), f.z + (!beacon && f.z < 2 ? 0.45 : 0));
    L.name = beacon ? 'beacon-light' : `brazier-light-${i}`;
    root.add(L); points.push(L);
  });

  // ---------------------------------------------------------------- environment map for Standard materials (viewmodels)
  let envMap = null;
  try {
    const sScene = new THREE.Scene();
    const sk2 = createSky(); sScene.add(sk2.mesh);
    envMap = gfx().materials.envMapFromScene(renderer, sScene);   // a PMREM per edition (decision 0001)
    sk2.mesh.geometry.dispose(); /** @type {THREE.Material} */ (sk2.mesh.material).dispose();
  } catch { envMap = null; }

  // ---------------------------------------------------------------- state
  const st = { t: 0, dawn: 0, flare: 0, flareDirty: false, flicker: 0, gateFrac: 1, troughs: K.oilRects.map(() => ({ oil: 1, burn: 0, lit: false, soot: 0 })),
    // DESIGN §9: the camp ramp (x linear, eased when applied), the night's moon redness, the kindle vision clock
    camp: 0, campTarget: 0, campRate: 1, campE: -1, pendingFlare: 0, nf: 1, nfTarget: 1, nfE: -1,
    // DESIGN §8: rain (smoothed), wetness, the ending's channels (auto from the ending clock unless a setter took them)
    rain: 0, rainE: -1, wet: 0, world: 0, portal: 0, lamp: 0, gateOpen: 0, village: 0, endT: -1, endHold: false,
    manual: /** @type {Record<string, boolean|undefined>} */ ({}), sig: '', strikes: 0, villageApplied: -1, visionT: 99, lastMode: /** @type {string|undefined} */ (undefined),
    beaconBase: 3.2 };
  const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _db = new THREE.Vector2();
  const tmpC = new THREE.Color();

  const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color();
  /** Night (Night I / II by `red`) → dawn → the camp at dusk; every light, the fog, the sky and the look's mood. */
  const LK = makeLook();
  const RAIN = { fog: new THREE.Color('#2a3238'), hemi: new THREE.Color().setRGB(0.55, 0.62, 0.72) };
  const PORTAL_RED = new THREE.Color('#ff4a2a'), FLASH_SKY = new THREE.Color().setRGB(0.8, 0.86, 1.0);
  /** Night (the palette of night n, DESIGN §8) → rain → the world change → dawn → the camp at dusk; lights, fog, sky, look. */
  function applyMood() {
    const camp = st.campE, dawn = st.dawn * (1 - camp), rain = st.rainE, world = st.world, portal = st.portal, flash = rainFx.flash;
    nightLook(st.nfE, LK);
    lerpLook(LK, WORLD_LOOK, world);
    sky.setLook(LK);
    sky.uniforms.uDawn.value = dawn;
    sky.uniforms.uDusk.value = camp;
    sky.uniforms.uRain.value = rain; sky.uniforms.uFlash.value = flash; sky.uniforms.uWorld.value = world;
    sky.uniforms.uPortal.value = portal; sky.uniforms.uPortalDir.value.copy(PORTAL_DIR); sky.uniforms.uLamp.value = st.lamp;
    sky.uniforms.uMoonGain.value = 1 - 0.55 * rain;
    const f = /** @type {FogExp2} */ (scene.fog);
    f.color.copy(LK.fog).lerp(RAIN.fog, 0.55 * rain * (1 - world)).lerp(_c3.setRGB(0.1, 0.018, 0.013), portal * 0.75).lerp(DAWN.fog, dawn).lerp(DUSK.fog, camp);   // the far world fades into dark red once the portal opens
    f.density = LK.fogDensity * (1 + 0.5 * rain) * (1 - 0.35 * dawn);
    f.density += (DUSK.fogDensity - f.density) * camp;
    sky.uniforms.uFogCol.value.copy(f.color);
    moon.color.copy(LK.moonLight).lerp(PORTAL_RED, portal).lerp(DAWN.sun, dawn).lerp(DUSK.sun, camp);
    const mi = LK.moonI * (1 - 0.3 * rain) + 4.2 * portal;            // the portal is the key light once it is open
    moon.intensity = mi + (DAWN.sunI - mi) * dawn;
    moon.intensity += (DUSK.sunI - moon.intensity) * camp;
    moon.shadow.intensity = 0.65 + (DUSK.shadow - 0.65) * camp;
    moon.shadow.normalBias = 0.035 + 0.035 * camp;   // grazing dusk light: a little more normal bias against acne
    hemi.color.copy(LK.hemiSky).lerp(RAIN.hemi, 0.5 * rain).lerp(PORTAL_RED, portal * 0.18 * (1 - world)).lerp(FLASH_SKY, Math.min(1, flash)).lerp(DAWN.hemiSky, dawn).lerp(DUSK.hemiSky, camp);
    hemi.groundColor.copy(NIGHT.hemiGround).lerp(_c2.setRGB(0.1, 0.07, 0.07), Math.max(world, portal * 0.4)).lerp(DAWN.hemiGround, dawn).lerp(DUSK.hemiGround, camp);
    const hi = LK.hemiI * (1 - 0.1 * rain) + 1.5 * flash;
    hemi.intensity = hi + (DAWN.hemiI - hi) * dawn;
    hemi.intensity += (DUSK.hemiI - hemi.intensity) * camp;
    valleyFog.material.uniforms.uColor.value.copy(LK.fog).multiplyScalar(1.65).lerp(_c1.set('#c8c4b8'), dawn).lerp(DUSK.valley, camp);
    st.beaconBase = 3.2 * (1 - (1 - DUSK.beaconFlame) * camp) * (1 + 1.2 * st.lamp);
    ENVFX.uWetSky.value.copy(f.color).multiplyScalar(1.3).lerp(FLASH_SKY, Math.min(1, flash));
    MOOD.camp = camp; MOOD.red = (st.nfE - 1) / 9; MOOD.night = st.nfE; MOOD.dawn = dawn;
    MOOD.rain = rain; MOOD.world = world; MOOD.flash = flash;
    const L = lightDir(); MOOD.sunDir.x = L.x; MOOD.sunDir.y = L.y; MOOD.sunDir.z = L.z;
  }
  function applyDawn(x) { st.dawn = x; applyMood(); }
  const ease = (x) => x * x * (3 - 2 * x);
  /** @param {number} x 0..1 @param {number} seconds 0 = at once */
  function campTo(x, seconds) {
    st.campTarget = x;
    if (!(seconds > 0)) { st.camp = x; st.campRate = 1e9; } else st.campRate = 1 / seconds;
  }

  function lightDir() {
    // the moon by night; at dawn the key swings to the rising sun in the east
    const d = st.dawn * (1 - Math.max(0, st.campE));
    _v.copy(MOON_DIR).lerp(DAWN_SUN, d).normalize();
    _v.lerp(PORTAL_DIR, THREE.MathUtils.smoothstep(st.portal, 0.0, 0.6)).normalize();   // DESIGN §8: the portal is the key light: from above-north, so south faces stay dark (red rims on what faces it)
    return _v.lerp(DUSK_SUN_DIR, Math.max(0, st.campE)).normalize();
  }

  function syncTroughs(state) {
    const T = state?.troughs;
    K.oilRects.forEach((r, i) => {
      const s = st.troughs[i];
      const want = T && T[i] ? Math.max(0, Math.min(1, T[i].oil)) : s.oil;
      s.oil += (want - s.oil) * 0.15;
      if (T && T[i]) s.lit = !!T[i].lit;
    });
  }

  // ---------------------------------------------------------------- DESIGN §8: the ending's clock → its channels
  const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
  /** 0..1 ramp from beat `id` over `len` s on the ending clock (0 outside the ending). */
  function endingRamp(id, len) {
    if (st.endT < 0) return 0;
    const t0 = beatAt(id);
    return THREE.MathUtils.smoothstep(st.endT, t0, t0 + len);
  }
  function endingDrive() {
    if (!st.manual.lamp) st.lamp = endingRamp('lamp', 4);
    if (!st.manual.portal) st.portal = endingRamp('portal', 5);
    if (!st.manual.world) st.world = endingRamp('world', 6);
    if (!st.manual.gate) st.gateOpen = endingRamp('host', 2.5);
    if (!st.manual.village) st.village = st.endT >= 0 ? THREE.MathUtils.smoothstep(st.endT, beatAt('hunt') - 1.2, beatAt('hunt') + 1.0) : 0;
  }
  function endingReset() {
    st.endT = -1; st.endHold = false;
    for (const k of ['lamp', 'portal', 'world', 'gate', 'village']) st.manual[k] = false;
    st.lamp = st.portal = st.world = st.gateOpen = st.village = 0;
  }

  const env = {
    envMap,
    root, mats, sky, moon, hemi, points, terrain, gate, statics, pines, farHorde, beaconFx, pads, horned,
    /** @param {number} dt @param {number} t @param {any} state */
    update(dt, t, state) {
      st.t = t;
      // ---- DESIGN §9: the camp at dusk follows state.mode (and CAMP_ENTER / CAMP_LEAVE); the moon follows state.night.n
      const mode = state?.mode;
      if (mode !== 'camp' && typeof state?.night?.n === 'number') st.nfTarget = nightOf(state.night.n);
      if (mode !== undefined && mode !== st.lastMode) {
        if (st.lastMode === undefined) st.nf = st.nfTarget;            // a page that starts in Night II starts red
        if (mode === 'ending') { if (!st.endHold) st.endT = 0; }        // DESIGN §8: the ending's clock starts
        else if (st.lastMode === 'ending') endingReset();
        if (mode === 'camp') campTo(1, st.lastMode === undefined ? 0 : 1.2);
        else if (st.lastMode === 'camp') campTo(0, CAMP_SUNSET);
        st.lastMode = mode;
      }
      if (st.camp !== st.campTarget) {
        const k = Math.min(1, st.campRate * dt);
        st.camp = Math.abs(st.campTarget - st.camp) <= k ? st.campTarget : st.camp + Math.sign(st.campTarget - st.camp) * k;
      }
      // one night to the next ramps over 1.5 s; a jump of several nights (a new run after Night X, a debug goto) snaps
      if (Math.abs(st.nfTarget - st.nf) > 1.01) st.nf = st.nfTarget;
      if (st.nf !== st.nfTarget) st.nf = Math.abs(st.nfTarget - st.nf) < dt / 1.5 ? st.nfTarget : st.nf + Math.sign(st.nfTarget - st.nf) * dt / 1.5;
      const ce = ease(st.camp);
      // ---- DESIGN §8: rain from state.weather.rain (smoothed); the ending's channels from its clock (TIMELINE.ending)
      if (mode === 'ending' && st.endT >= 0 && !st.endHold) st.endT = typeof state?.ending?.t === 'number' ? state.ending.t : st.endT + dt;   // the sim's clock (skips included)
      if (st.endT >= 0) endingDrive();
      const wantRain = st.manual.rain ? st.rain : Math.max(0, Math.min(1, Number(state?.weather?.rain) || 0)) * (1 - endingRamp('flood', 3));
      if (!st.manual.rain) st.rain += (wantRain - st.rain) * Math.min(1, dt * 1.5);
      if (Math.abs(st.rain - wantRain) < 0.002) st.rain = wantRain;
      st.wet += ((st.rain > 0.05 ? 1 : 0) * Math.min(1, st.rain * 1.6) - st.wet) * Math.min(1, dt * (st.rain > st.wet ? 0.35 : 0.06));
      ENVFX.uWet.value = st.wet; ENVFX.uFxTime.value = t;
      ENVFX.uAsh.value = st.world; ENVFX.uLava.value = THREE.MathUtils.smoothstep(st.world, 0.25, 1.0);
      const storm = st.nfE >= 9.5 || !!state?.weather?.storm || st.manual.storm === true;
      rainFx.update(dt, t, st.rain, camera, /** @type {FogExp2} */ (scene.fog).density, storm);
      if (rainFx.strikes !== st.strikes) { st.strikes = rainFx.strikes; MOOD.lightning = st.strikes; }
      const sig = `${ce.toFixed(4)}|${st.nf.toFixed(4)}|${st.rain.toFixed(3)}|${st.world.toFixed(4)}|${st.portal.toFixed(4)}|${st.lamp.toFixed(4)}|${rainFx.flash.toFixed(3)}`;
      if (sig !== st.sig) { st.sig = sig; st.campE = ce; st.nfE = st.nf; st.rainE = st.rain; applyMood(); }
      gate.setOpen(st.gateOpen);
      // the lamp turns black-red: its basket flame and fire column, then the pillar; the portal; the falling embers
      props.flameMat.uniforms.uDark.value = st.lamp;
      props.flameMat.uniforms.uDarkFrom.value = props.flames.length - 1;
      props.flameMat.uniforms.uDarkTo.value = props.flames.length - 1 + props.column.count;
      ending.update(t, { portal: st.portal, lamp: st.lamp, world: st.world, gate: st.gateOpen }, camera, _db.y || 900);
      // the village burns in the hunt: roof fires catch one after another, the glow swells
      if (st.village !== st.villageApplied) {
        st.villageApplied = st.village;
        const a = props.flameAttr, n = vFireScale.length;
        for (let k = 0; k < n; k++) {
          const on = THREE.MathUtils.smoothstep(st.village, (k / n) * 0.55, (k / n) * 0.55 + 0.35);
          a.setW(vFireFirst + k, vFireScale[k] * on);
        }
        a.needsUpdate = true;
        villageGlow.mesh.visible = st.village > 0.01; villageGlow.uniforms.uBurn.value = st.village;
        mats.thatch.color.setScalar(1 - 0.55 * st.village);
      }
      villageGlow.uniforms.uTime.value = t;
      farHorde.points.visible = st.campE < 0.995 && st.world < 0.5;  // no valley torches at the camp (nor once the world changes)
      const near = campNear(state), built = campBuilt(state);
      pads.update(dt, t, st.campE, /** @type {FogExp2} */ (scene.fog).density, near, built);
      const P = state?.player;
      horned.update(st.campE, P && Number.isFinite(P.x) ? { x: P.x, y: Number.isFinite(P.y) ? P.y : 0, z: P.z } : null);
      st.visionT += dt;
      if (st.pendingFlare > 0) { st.pendingFlare -= dt; if (st.pendingFlare <= 0) { st.flare = 1; if (st.visionT > 1.5) st.visionT = 0; } }
      sky.uniforms.uTime.value = t;
      props.flameMat.uniforms.uTime.value = t;
      renderer.getDrawingBufferSize(_db);
      farHorde.update(t, _db.y, Math.max(st.dawn * (1 - st.campE), st.campE));
      const vt = st.visionT;
      beaconFx.update(t, Math.max(st.flare, 0.75 * st.lamp), _db.y, THREE.MathUtils.smoothstep(vt, 0.18, 0.28) * (1 - THREE.MathUtils.smoothstep(vt, 0.62, 0.74)));
      valleyFog.material.uniforms.uTime.value = t;
      valleyFog.material.uniforms.uFogDensity.value = /** @type {THREE.FogExp2} */ (scene.fog).density;
      // shadow frustum follows the camera (a point ahead of it), snapped to texels
      camera.getWorldDirection(_f); _f.y = 0; if (_f.lengthSq() < 1e-6) _f.set(1, 0, 0); _f.normalize();
      const c = _v.copy(camera.position).addScaledVector(_f, 14); c.y = Math.min(c.y, 4);
      const texel = (2 * SH) / sm;
      c.x = Math.round(c.x / texel) * texel; c.z = Math.round(c.z / texel) * texel;
      moon.target.position.copy(c);
      moon.position.copy(c).addScaledVector(lightDir(), 80);
      moon.target.updateMatrixWorld();
      // braziers flicker (intensity only; the light count never changes)
      for (let i = 0; i < points.length; i++) {
        const L = points[i];
        const beacon = L.name === 'beacon-light';
        const base = (beacon ? NIGHT.beaconI : NIGHT.brazierI) * (1 - 0.6 * st.dawn * (1 - st.campE)) * (1 - (1 - (beacon ? DUSK.beacon : DUSK.brazier)) * st.campE);
        const fl = 0.85 + 0.1 * Math.sin(t * 13 + i * 2.1) + 0.06 * Math.sin(t * 31 + i * 5.3);
        const fk = beacon && st.flicker > 0 ? 0.35 + 0.65 * Math.abs(Math.sin(t * 17) * Math.sin(t * 5.3)) : 1;
        L.intensity = base * fl * fk * (beacon ? (1 + 7 * st.flare) * (1 + 5 * st.lamp) : 1);
        if (beacon) L.color.copy(NIGHT.beacon).lerp(PORTAL_RED, st.lamp);   // DESIGN §8: the lamp's light turns red
      }
      if (st.flicker > 0) st.flicker = Math.max(0, st.flicker - dt);
      if (st.flare > 0 || st.flareDirty) {
        st.flare = Math.max(0, st.flare - dt / 3.4);
        st.flareDirty = st.flare > 0;
        // the basket flame swells to ≈ 3× and a column of flame stands over it while the flare lasts
        const a = props.flameAttr; const bi = props.flames.length - 1;
        const k = st.flare > 0.85 ? (1 - st.flare) / 0.15 : st.flare / 0.85;        // a fast rise, a slow fall
        const e = Math.sqrt(Math.max(0, k));
        a.setW(bi, st.beaconBase * (1 + 2.0 * e / (st.beaconBase / 3.2)));
        for (let j = 0; j < props.column.count; j++) a.setW(props.column.first + j, e * (7.5 - 1.8 * j) * (j < 2 || e > 0.3 ? 1 : 0));
        a.needsUpdate = true;
      }
      else if (Math.abs(props.flameAttr.getW(props.flames.length - 1) - st.beaconBase) > 1e-3) {
        props.flameAttr.setW(props.flames.length - 1, st.beaconBase); props.flameAttr.needsUpdate = true;   // the lamp smoulders at the camp
      }
      // gate damage from hp
      if (state?.gate) gate.setHp(state.gate.hp / Math.max(1, state.gate.hpMax || ARENA.gate.hp));
      gate.update(dt);
      // troughs: oil level + soot
      syncTroughs(state);
      const burn = BURN.uBurn.value;
      oilMeshes.forEach((o, i) => {
        const s = st.troughs[i];
        if (s.lit) s.soot = Math.min(1, s.soot + dt / 6);
        else if (s.oil > 0.95) s.soot = Math.max(0, s.soot - dt / 20);
        o.mesh.position.y = o.rect.y0 + (o.rect.y1 - o.rect.y0) * s.oil;
        o.mesh.visible = s.oil > 0.02;
        const m = /** @type {THREE.MeshStandardMaterial} */ (o.mesh.material);
        m.color.setRGB(0.08 * (1 - 0.6 * s.soot), 0.07 * (1 - 0.6 * s.soot), 0.065 * (1 - 0.6 * s.soot));
        m.roughness = 0.28 + 0.6 * s.soot;
        burn.setComponent(i, s.soot);
      });
      // barrels follow state.barrels (a retry restores them)
      if (state?.barrels) {
        state.barrels.forEach((b, i) => {
          const alive = !!b.alive;
          if (alive !== props.barrelAlive[i]) {
            props.barrelAlive[i] = alive;
            const m = alive ? props.barrelM[i] : props.zero;
            props.barrels.setMatrixAt(i, m); props.hoops.setMatrixAt(i, m);
            props.barrels.instanceMatrix.needsUpdate = true; props.hoops.instanceMatrix.needsUpdate = true;
          }
        });
      }
      // debris staves
      let any = false;
      const _m = _dm, _q = _dq, _sv = _ds;
      for (let i = 0; i < props.deb.length; i++) {
        const d = props.deb[i];
        if (d.t <= 0) continue;
        any = true;
        d.t -= dt;
        d.v.y -= 9.8 * dt;
        d.p.addScaledVector(d.v, dt);
        const gy = ARENA.oil.barrels.length ? Math.max(-30, envGround(d.p.x, d.p.z)) : 0;
        if (d.p.y < gy + 0.04) { d.p.y = gy + 0.04; d.v.multiplyScalar(0.4); d.v.y = Math.abs(d.v.y) * 0.3; d.w.multiplyScalar(0.5); }
        d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
        const s = d.t < 0.6 ? Math.max(0, d.t / 0.6) : 1;
        _q.setFromEuler(d.r);
        _m.compose(d.p, _q, _sv.set(s, s, s));
        props.debris.setMatrixAt(i, d.t > 0 ? _m : props.zero);
      }
      if (any) props.debris.instanceMatrix.needsUpdate = true;
    },
    /** @param {any} ev @param {any} state */
    onEvent(ev, state) {
      if (!ev) return;
      switch (ev.type) {
        case EV.BARREL_BURST: {
          const i = ev.idx;
          if (i >= 0 && i < props.barrelM.length) {
            props.barrelAlive[i] = false;
            props.barrels.setMatrixAt(i, props.zero); props.hoops.setMatrixAt(i, props.zero);
            props.barrels.instanceMatrix.needsUpdate = true; props.hoops.instanceMatrix.needsUpdate = true;
            const [bx, bz] = ARENA.oil.barrels[i];
            const by = envGround(bx, bz);
            for (let k = 0; k < 10; k++) {
              const d = props.deb[props.nextDebris()];
              const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 5;
              d.t = 2.2 + Math.random() * 1.2;
              d.p.set(bx + Math.cos(a) * 0.3, by + 0.5, bz + Math.sin(a) * 0.3);
              d.v.set(Math.cos(a) * sp, 4 + Math.random() * 5, Math.sin(a) * sp);
              d.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
              d.w.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
            }
          }
          break;
        }
        case EV.KINDLE: st.flare = 1; if (st.visionT > 1.5) st.visionT = 0; break;
        // DESIGN §9: the camp. Entering ramps to dusk (1.2 s; the dawn card covers it); leaving plays the sunset back into
        // night (CAMP_SUNSET s) and the lamp flares with its vision as the night begins
        case EV.CAMP_ENTER:
          campTo(1, 1.2);                                   // under the cinema's 'camp' fade ("THE DAY PASSES")
          st.dawn = 0; MOOD.dawnReset++;                    // the dawn is over: leaving the camp falls back to night, not dawn
          if (typeof ev.nextNight === 'number') st.nfTarget = nightOf(ev.nextNight);
          break;
        case EV.CAMP_LEAVE:
          campTo(0, CAMP_SUNSET);
          if (typeof ev.night === 'number') st.nfTarget = nightOf(ev.night);
          st.pendingFlare = CAMP_SUNSET - 0.2;               // the lamp flares as night falls: the vision lands on the cinema's beat
          break;
        case EV.RUN_START: st.troughs.forEach((s) => { s.soot = 0; }); break;
        case 'cinema.beacon': st.flicker = Math.max(st.flicker, 1.2); break;
        case EV.GATE_HIT: gate.hit(ev.dmg || 1); break;
        case EV.TROUGH_LIT: { const i = ARENA.oil.troughs.findIndex((T) => T.id === ev.id); if (i >= 0) st.troughs[i].lit = true; break; }
        case EV.TROUGH_OUT: { const i = ARENA.oil.troughs.findIndex((T) => T.id === ev.id); if (i >= 0) { st.troughs[i].lit = false; st.troughs[i].soot = 1; } break; }
        case EV.TROUGH_FULL: { const i = ARENA.oil.troughs.findIndex((T) => T.id === ev.id); if (i >= 0) st.troughs[i].lit = false; break; }
        case EV.RETRY: {
          gate.setHp(1, true);
          st.troughs.forEach((s) => { s.soot = 0; s.lit = false; s.oil = 1; });
          for (let i = 0; i < props.barrelM.length; i++) { props.barrelAlive[i] = true; props.barrels.setMatrixAt(i, props.barrelM[i]); props.hoops.setMatrixAt(i, props.barrelM[i]); }
          props.barrels.instanceMatrix.needsUpdate = true; props.hoops.instanceMatrix.needsUpdate = true;
          applyDawn(0);
          break;
        }
        default: break;
      }
      void state;
    },
    /** @param {number} x 0 night .. 1 sunrise */
    setDawn(x) { applyDawn(Math.max(0, Math.min(1, x))); },
    /** The camp at dusk: 0 night .. 1 dusk; `seconds` > 0 ramps (env.update also follows state.mode by itself). */
    setCamp(x, seconds = 0) { campTo(Math.max(0, Math.min(1, x)), seconds); if (!(seconds > 0)) { st.campE = -1; } },
    /** Night n's moon (I teal-white, II blood-red, redder each night); ramps over 1.5 s unless `now`. */
    setNight(n, now = false) { st.nfTarget = nightOf(n); if (now) { st.nf = st.nfTarget; st.nfE = -1; } },
    // ---- DESIGN §8 setters (each takes its channel from the ending clock for the rest of the ending; all guarded, 0..1)
    /** Rain 0..1 (overrides state.weather.rain until `setRain(null)`). */
    setRain(x) { if (x == null) { st.manual.rain = false; return; } st.manual.rain = true; st.rain = clamp01(x); },
    /** Lightning on / off regardless of the night (Night X's storm turns it on by itself); `strike()` flashes now. */
    setStorm(on) { st.manual.storm = on == null ? undefined : !!on; },
    strike() { rainFx.strike(); },
    /** The ending's world change (DESIGN §12.3): red-black grade, black moon, burnt pines, ash, lava cracks, embers. */
    setWorldChange(x) { st.manual.world = true; st.world = clamp01(x); },
    /** The portal tearing open above the keep (0 shut .. 1 wide), with its red light. */
    setPortal(x) { st.manual.portal = true; st.portal = clamp01(x); },
    /** The lamp's flame turning black-red and swelling into a pillar of fire. */
    setLamp(x) { st.manual.lamp = true; st.lamp = clamp01(x); },
    /** The keep's gate opening from the inside (0 shut .. 1 wide). */
    setGateOpen(x) { st.manual.gate = true; st.gateOpen = clamp01(x); },
    /** The goblin village burning (the hunt). */
    setVillageBurn(x) { st.manual.village = true; st.village = clamp01(x); },
    /** Bench / capture: hold the ending clock at `t` s (null releases it). */
    setEndingTime(t) { if (t == null) { st.endHold = false; return; } st.endHold = true; st.endT = Math.max(0, t); },
    /** The ending's beat times the environment uses (TIMELINE.ending when present, else ENDING_DEFAULT). */
    get endingBeats() { return Object.fromEntries(Object.keys(ENDING_DEFAULT).map((k) => [k, beatAt(k)])); },
    /** The kindle vision alone (the horned file in the flames), e.g. for a cinema beat. */
    vision(t0 = 0) { st.visionT = t0; },
    /** Bench / capture hook: hold the beacon flare at a level (1 = the kindle instant, decays over 3.4 s). */
    setFlare(x) { st.flare = Math.max(0, Math.min(1, x)); st.flareDirty = true; },
    /** Current mood (camp 0..1 eased, red 0..1, the sunset length in s). */
    get mood() { return { camp: st.campE, night: st.nfE, red: (st.nfE - 1) / 9, sunset: CAMP_SUNSET, rain: st.rain, wet: st.wet, world: st.world, portal: st.portal, lamp: st.lamp, gate: st.gateOpen, village: st.village, endT: st.endT, lightning: rainFx.strikes }; },
    /** The intro's beacon beat: the beacon light sputters for `seconds`. */
    beaconFlicker(seconds = 1.2) { st.flicker = Math.max(st.flicker, seconds); },
    /** The beacon flare (also on EV.KINDLE). */
    flare() { st.flare = 1; if (st.visionT > 1.5) st.visionT = 0; },
    stats() {
      let tris = 0;
      root.traverse((o) => {
        const m = /** @type {any} */ (o);
        if (!m.isMesh || !m.geometry) return;
        const n = m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3;
        tris += n * (m.isInstancedMesh ? m.count : m.geometry.isInstancedBufferGeometry ? m.geometry.instanceCount : 1);
      });
      return { buildMs: Math.round(buildMs), objects: root.children.length, sceneTriangles: Math.round(tris), pines: pines.userData.count };
    },
    dispose() {
      scene.remove(root);
      root.traverse((o) => {
        const m = /** @type {any} */ (o);
        if (m.geometry) m.geometry.dispose();
        if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
      });
      Object.values(tex).forEach((t) => t.dispose());
      flameTex.dispose(); fogNoise.dispose();
      envMap?.dispose();
      if (scene.fog && scene.fog === env.fog) scene.fog = null;
    },
    fog: scene.fog,
  };
  if (typeof window !== 'undefined') /** @type {any} */ (window).__ewEnv = env;   // + `.firelight` (read-only debug handle on the shared fire-light uniforms, for layer tests)
  /** @type {any} */ (env).firelight = FIRELIGHT;   // capture / tuning hook (like __ewLook)
  st.campE = 0; st.nfE = 1;
  applyDawn(0);
  // place the shadow camera once before the first frame
  env.update(0, 0, null);
  const buildMs = performance.now() - t0;
  return env;
}

import { envHeight as envGround } from './terrain.js';

/** The ending's beats the environment follows (s from mode 'ending'): TIMELINE.ending's own when the core writes them
 *  (`TIMELINE.ending.beats [{ at, id }]` or `TIMELINE.ending[id]`), else these (DESIGN §12, ≈ 45 s). */
export const ENDING_DEFAULT = Object.freeze({ flood: 0, lamp: 4, portal: 6, world: 11, host: 17, reveal: 23, cinder: 32, hunt: 35, credits: 44 });
const ENDING_ALIAS = { host: ['host', 'gate', 'march'], world: ['world', 'change', 'worldChange'], lamp: ['lamp', 'lampOpens', 'pillar'], portal: ['portal'], hunt: ['hunt'], flood: ['flood', 'fall'] };
function beatAt(id) {
  const E = /** @type {any} */ (TIMELINE).ending;
  const ids = ENDING_ALIAS[id] || [id];
  if (E) {
    const beats = Array.isArray(E.beats) ? E.beats : null;
    for (const k of ids) {
      const b = beats && beats.find((x) => x.id === k);
      if (b && typeof b.at === 'number') return b.at;
      if (typeof E[k] === 'number') return E[k];
    }
  }
  return ENDING_DEFAULT[id] ?? 0;
}
/** Night n → the palette's night value 1..10. */
function nightOf(n) { return Math.max(1, Math.min(10, Number(n) || 1)); }
const PORTAL_DIR = new THREE.Vector3(PORTAL.x, PORTAL.y, PORTAL.z).normalize();

/** Seconds of the sunset when the camp is left: night has fallen by the cinema's vision beat (TIMELINE.campLeave.vision 1.6 s);
 *  the lamp flares 0.2 s before it so the horned file shows on the beat. */
export const CAMP_SUNSET = TIMELINE.campLeave?.vision ?? 1.6;
const DAWN_SUN = new THREE.Vector3(0.95, 0.18, 0.25).normalize();
/** @typedef {import('three').FogExp2} FogExp2 */

/** state.camp.near → the pad index the player stands at (−1 none). Accepts a pad id, an index or { id | pad | index }. */
function campNear(state) {
  const n = state?.camp?.near;
  if (n == null || state?.mode !== 'camp') return -1;
  const pads = ARENA.camp.pads;
  if (typeof n === 'number') return n >= 0 && n < pads.length ? n : -1;
  const id = typeof n === 'string' ? n : (n.id ?? n.pad ?? n.index);
  if (typeof id === 'number') return id;
  return pads.findIndex((p) => p.id === id);
}
/** state.towers (or state.camp.towers) → which pads carry a tower. Accepts [{ pad }] or { [padId]: tower }. */
function campBuilt(state) {
  const T = state?.towers ?? state?.camp?.towers;
  const pads = ARENA.camp.pads;
  const out = pads.map(() => false);
  if (!T) return out;
  const mark = (p) => { const i = typeof p === 'number' ? p : pads.findIndex((q) => q.id === p); if (i >= 0 && i < out.length) out[i] = true; };
  if (Array.isArray(T)) T.forEach((t, i) => { if (!t) return; if (typeof t === 'object' && t.pad != null) mark(t.pad); else if (t) mark(i); });
  else for (const k of Object.keys(T)) if (T[k]) mark(k);
  return out;
}
